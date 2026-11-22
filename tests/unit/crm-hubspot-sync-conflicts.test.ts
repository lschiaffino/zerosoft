import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { updateCompany, updateContact } from '@/lib/crm';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeHubspotPortal, seedSyncPortal, type FakeHubspotPortal } from '@/lib/hubspot/fake-portal';
import { connectSync } from '@/lib/crm-hubspot-sync/connection';
import { getInbound, runInboundStep, startInbound } from '@/lib/crm-hubspot-sync/inbound';
import { getOutbound, previewOutbound, runOutboundStep, setOutboundMode } from '@/lib/crm-hubspot-sync/outbound';
import { conflictDetail, dismissConflict, listConflicts, resolveAllConflicts, resolveConflict, retryFailedOutbound } from '@/lib/crm-hubspot-sync/conflicts';
import { makeUser } from './helpers';

/**
 * Bloque S4: resolver a mano los conflictos del sync y reintentar los cambios
 * rechazados, contra la cuenta falsa (lib/hubspot/fake-portal.ts). Nunca se
 * llama a un HubSpot real.
 */

const KEY = 'pat-na1-conflicts-legacy';
let portal: FakeHubspotPortal;

beforeEach(() => {
  vi.stubEnv('CRM_IMPORT_FAKE', '1');
  portal = resetFakeHubspotPortal('crm', seedSyncPortal);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const db = () => getDb();
const one = <T>(q: string, ...a: Array<string | number | null>) => db().prepare(q).get(...a) as Promise<T | undefined>;
const all = <T>(q: string, ...a: Array<string | number | null>) => db().prepare(q).all(...a) as Promise<T[]>;
const count = async (table: string, where: string, ...a: string[]) => Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...a))!.n);
/** Escrituras que llegaron a HubSpot (no lecturas). */
const writes = () => portal.calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/search') && !c.path.endsWith('/batch/read'));

async function inboundPass(ws: string) {
  await db().prepare('UPDATE crm_hubspot_inbound SET next_run_at = NULL, locked_until = NULL WHERE user_id = ?').run(ws);
  for (let i = 0; i < 100; i++) {
    const r = await runInboundStep(ws, { budgetMs: 30_000 });
    if (r === 'idle') return;
    expect(r).toBe('progress');
  }
  throw new Error('inbound pass did not finish');
}

async function outboundPass(ws: string) {
  await db().prepare('UPDATE crm_hubspot_outbound SET next_run_at = NULL, locked_until = NULL WHERE user_id = ?').run(ws);
  await db().prepare(`UPDATE crm_hubspot_outbox SET next_at = '' WHERE user_id = ? AND state = 'pending'`).run(ws);
  for (let i = 0; i < 20; i++) {
    const r = await runOutboundStep(ws, { budgetMs: 30_000 });
    if (r !== 'progress') return r;
  }
  throw new Error('outbound pass did not finish');
}

async function live(label: string) {
  const w = await makeUser(label);
  const mate = await makeUser(`${label}-mate`);
  const team = await createTeam(w.id, 'Sales');
  await addMember(team.id, mate.id, 'member');
  portal.owners.get('81')!.email = w.email;
  portal.owners.get('82')!.email = mate.email;
  expect((await connectSync(w.id, w.id, KEY)).ok).toBe(true);
  expect((await startInbound(w.id, w.id)).ok).toBe(true);
  await inboundPass(w.id);
  expect((await getInbound(w.id)).state).toBe('live');
  return { w, mate };
}

async function enableWriting(ws: string) {
  expect((await previewOutbound(ws)).ok).toBe(true);
  expect((await setOutboundMode(ws, ws, true)).ok).toBe(true);
}

const linkOf = (ws: string, hubspotId: string, object = 'contact') =>
  one<{ record_id: string; shadow: string; state: string }>('SELECT record_id, shadow, state FROM crm_hubspot_links WHERE user_id = ? AND object = ? AND hubspot_id = ?', ws, object, hubspotId);
const conflictOf = (ws: string, recordId: string) => one<{ fields: string; kind: string }>('SELECT fields, kind FROM crm_hubspot_sync_conflicts WHERE user_id = ? AND record_id = ?', ws, recordId);

/** Un contacto vinculado con el cargo y la ciudad cambiados de los dos lados (la escritura apagada). */
async function withConflict(label: string) {
  const s = await live(label);
  const c = (await linkOf(s.w.id, '4001'))!;
  await updateContact(s.w.id, c.record_id, { jobTitle: 'Title here', lastName: 'Last here' });
  portal.edit('contacts', '4001', { jobtitle: 'Title there', lastname: 'Last there' });
  await inboundPass(s.w.id);
  expect(await conflictOf(s.w.id, c.record_id)).toEqual({ fields: 'last_name,job_title', kind: 'fields' });
  portal.calls.length = 0;
  return { ...s, id: c.record_id };
}

describe('listado y detalle', () => {
  it('lista con nombre y campos; el detalle lee HubSpot y no guarda ni escribe nada', async () => {
    const { w, id } = await withConflict('hsconf-list');
    const log = vi.spyOn(console, 'log');
    const err = vi.spyOn(console, 'error');
    const list = await listConflicts(w.id);
    expect(list.total).toBe(1);
    expect(list.byObject).toEqual({ contact: 1 });
    expect(list.items[0]).toMatchObject({ object: 'contact', recordId: id, kind: 'fields', fields: ['last_name', 'job_title'], resolvable: true });
    expect(list.items[0].name).not.toBe('');

    const before = JSON.stringify(await all('SELECT * FROM crm_hubspot_sync_conflicts WHERE user_id = ?', w.id)) + (await linkOf(w.id, '4001'))!.shadow;
    const d = await conflictDetail(w.id, 'contact', id);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.values).toEqual([
      { field: 'last_name', here: 'Last here', hubspot: 'Last there', equal: false },
      { field: 'job_title', here: 'Title here', hubspot: 'Title there', equal: false },
    ]);
    expect(writes()).toEqual([]);
    const after = JSON.stringify(await all('SELECT * FROM crm_hubspot_sync_conflicts WHERE user_id = ?', w.id)) + (await linkOf(w.id, '4001'))!.shadow;
    expect(after).toBe(before);
    expect(after).not.toContain('Title there');
    for (const spy of [log, err]) expect(spy).not.toHaveBeenCalled();
  });

  it('otro workspace no ve ni resuelve los conflictos de este', async () => {
    const { w, id } = await withConflict('hsconf-iso');
    const other = await makeUser('hsconf-iso-other');
    expect((await listConflicts(other.id)).total).toBe(0);
    expect(await conflictDetail(other.id, 'contact', id)).toEqual({ ok: false, code: 'not_found' });
    expect(await resolveConflict(other.id, 'contact', id, { job_title: 'hubspot' })).toEqual({ ok: false, code: 'not_found' });
    expect(await dismissConflict(other.id, 'contact', id)).toBe(false);
    expect(await resolveAllConflicts(other.id, 'hubspot')).toEqual({ ok: false, code: 'not_connected' });
    expect(await conflictOf(w.id, id)).toEqual({ fields: 'last_name,job_title', kind: 'fields' });
    expect(await one('SELECT job_title FROM crm_contacts WHERE id = ?', id)).toEqual({ job_title: 'Title here' });
  });
});

describe('dejar HubSpot', () => {
  it('escribe acá el valor de HubSpot, corre el shadow y la entrada no lo vuelve a marcar; nada sale a HubSpot', async () => {
    const { w, id } = await withConflict('hsconf-hs');
    const res = await resolveConflict(w.id, 'contact', id, { job_title: 'hubspot', last_name: 'hubspot' });
    expect(res).toMatchObject({ ok: true, resolved: 2, kept: [], remaining: 0 });
    expect(await one('SELECT job_title, last_name FROM crm_contacts WHERE id = ?', id)).toEqual({ job_title: 'Title there', last_name: 'Last there' });
    expect(JSON.parse((await linkOf(w.id, '4001'))!.shadow)).toMatchObject({ job_title: 'Title there', last_name: 'Last there' });
    expect(await conflictOf(w.id, id)).toBeUndefined();
    await inboundPass(w.id);
    expect(await count('crm_hubspot_sync_conflicts', 'user_id = ?', w.id)).toBe(0);
    expect(writes()).toEqual([]);
  });

  it('con la escritura prendida, lo que trae no vuelve a HubSpot (guardia de eco)', async () => {
    const { w, id } = await withConflict('hsconf-hs-echo');
    await enableWriting(w.id);
    portal.calls.length = 0;
    await resolveConflict(w.id, 'contact', id, { job_title: 'hubspot', last_name: 'hubspot' });
    expect(await count('crm_hubspot_outbox', 'user_id = ? AND record_id = ?', w.id, id)).toBe(1);
    await outboundPass(w.id);
    expect(writes()).toEqual([]);
    expect(await count('crm_hubspot_outbox', 'user_id = ?', w.id)).toBe(0);
  });

  it('un valor de HubSpot sin equivalente acá no se puede dejar: sigue en conflicto con su código', async () => {
    const { w, mate, id } = await withConflict('hsconf-unmapped');
    await updateContact(w.id, id, { ownerId: mate.id });
    portal.edit('contacts', '4001', { hubspot_owner_id: '83' });
    await db().prepare(`UPDATE crm_hubspot_sync_conflicts SET fields = 'last_name,job_title,owner_id' WHERE user_id = ? AND record_id = ?`).run(w.id, id);
    const d = await conflictDetail(w.id, 'contact', id);
    expect(d.ok && d.values.find((v) => v.field === 'owner_id')).toMatchObject({ hubspot: null });
    const res = await resolveConflict(w.id, 'contact', id, { owner_id: 'hubspot', job_title: 'hubspot' });
    expect(res).toMatchObject({ ok: true, resolved: 1, kept: [{ field: 'owner_id', code: 'hubspot_value_unmapped' }] });
    expect(await conflictOf(w.id, id)).toEqual({ fields: 'last_name,owner_id', kind: 'fields' });
    expect(await one('SELECT owner_id FROM crm_contacts WHERE id = ?', id)).toEqual({ owner_id: mate.id });
  });

  it('un campo que no está en el conflicto no se toca aunque el pedido lo nombre', async () => {
    const { w, id } = await withConflict('hsconf-only');
    portal.edit('contacts', '4001', { phone: '+00 000 0000' });
    const res = await resolveConflict(w.id, 'contact', id, { phone: 'hubspot', job_title: 'hubspot' });
    expect(res).toMatchObject({ ok: true, resolved: 1 });
    expect(await one('SELECT phone FROM crm_contacts WHERE id = ?', id)).not.toEqual({ phone: '+00 000 0000' });
    expect(await conflictOf(w.id, id)).toEqual({ fields: 'last_name', kind: 'fields' });
  });
});

describe('dejar zerosoft', () => {
  it('con la escritura prendida sale por S3 y la relectura queda sin conflicto; nada vuelve a salir', async () => {
    const { w, id } = await withConflict('hsconf-here-on');
    await enableWriting(w.id);
    await outboundPass(w.id);
    // Con el conflicto abierto, la salida no manda esos campos.
    expect(portal.contacts.get('4001')!.properties.jobtitle).toBe('Title there');
    portal.calls.length = 0;
    const res = await resolveConflict(w.id, 'contact', id, { job_title: 'here', last_name: 'here' });
    expect(res).toMatchObject({ ok: true, resolved: 2, remaining: 0 });
    // La resolución en sí no escribe en HubSpot.
    expect(writes()).toEqual([]);
    expect(await one('SELECT job_title FROM crm_contacts WHERE id = ?', id)).toEqual({ job_title: 'Title here' });
    await outboundPass(w.id);
    const patch = writes().find((c) => c.method === 'PATCH' && c.path === '/crm/v3/objects/contacts/4001');
    expect((patch!.body as { properties: Record<string, string> }).properties).toEqual({ jobtitle: 'Title here', lastname: 'Last here' });
    portal.calls.length = 0;
    await inboundPass(w.id);
    expect(await count('crm_hubspot_sync_conflicts', 'user_id = ?', w.id)).toBe(0);
    expect(await one('SELECT job_title FROM crm_contacts WHERE id = ?', id)).toEqual({ job_title: 'Title here' });
    await outboundPass(w.id);
    expect(writes()).toEqual([]);
  });

  it('con la escritura apagada no sale nada; la entrada no lo pisa; al prenderla sale', async () => {
    const { w, id } = await withConflict('hsconf-here-off');
    expect(await resolveConflict(w.id, 'contact', id, { job_title: 'here', last_name: 'here' })).toMatchObject({ ok: true, resolved: 2 });
    expect(await count('crm_hubspot_outbox', 'user_id = ?', w.id)).toBe(0);
    portal.edit('contacts', '4001', { country: 'Elsewhere' });
    await inboundPass(w.id);
    expect(await one('SELECT job_title, last_name, country FROM crm_contacts WHERE id = ?', id)).toEqual({ job_title: 'Title here', last_name: 'Last here', country: 'Elsewhere' });
    expect(await count('crm_hubspot_sync_conflicts', 'user_id = ?', w.id)).toBe(0);
    expect(writes()).toEqual([]);
    await enableWriting(w.id);
    await outboundPass(w.id);
    expect(portal.contacts.get('4001')!.properties).toMatchObject({ jobtitle: 'Title here', lastname: 'Last here' });
  });

  it('si HubSpot vuelve a cambiar antes de que salga, el conflicto vuelve (no se pisa nada)', async () => {
    const { w, id } = await withConflict('hsconf-again');
    await enableWriting(w.id);
    await resolveConflict(w.id, 'contact', id, { job_title: 'here' });
    portal.edit('contacts', '4001', { jobtitle: 'Title there again' });
    await outboundPass(w.id);
    expect(portal.contacts.get('4001')!.properties.jobtitle).toBe('Title there again');
    expect((await conflictOf(w.id, id))!.fields.split(',')).toContain('job_title');
  });
});

describe('en tanda, descartar y reintentar', () => {
  it('resolver todos deja el mismo lado en cada registro', async () => {
    const { w, id } = await withConflict('hsconf-all');
    const co = (await linkOf(w.id, '3001', 'company'))!;
    await updateCompany(w.id, co.record_id, { city: 'Company city here' });
    portal.edit('companies', '3001', { city: 'Company city there' });
    await inboundPass(w.id);
    expect((await listConflicts(w.id)).total).toBe(2);
    portal.calls.length = 0;
    const res = await resolveAllConflicts(w.id, 'hubspot');
    expect(res).toMatchObject({ ok: true, resolved: 3, remaining: 0 });
    expect(await one('SELECT city FROM crm_companies WHERE id = ?', co.record_id)).toEqual({ city: 'Company city there' });
    expect(await one('SELECT job_title FROM crm_contacts WHERE id = ?', id)).toEqual({ job_title: 'Title there' });
    expect(writes()).toEqual([]);
  });

  it('los de fusión y actividades solo se descartan, sin tocar valores', async () => {
    const { w } = await live('hsconf-merge');
    const c = (await linkOf(w.id, '4002'))!;
    await db().prepare(`INSERT INTO crm_hubspot_sync_conflicts (user_id, object, record_id, hubspot_id, kind, fields) VALUES (?, 'contact', ?, '4002', 'merge', '')`).run(w.id, c.record_id);
    await db().prepare(`INSERT INTO crm_hubspot_sync_conflicts (user_id, object, record_id, hubspot_id, kind, fields) VALUES (?, 'activity', 'act-1', 'notes:1', 'fields', 'body')`).run(w.id);
    const list = await listConflicts(w.id);
    expect(list.items.every((i) => !i.resolvable)).toBe(true);
    expect(await resolveConflict(w.id, 'contact', c.record_id, { email: 'hubspot' })).toEqual({ ok: false, code: 'not_resolvable' });
    expect(await resolveConflict(w.id, 'activity', 'act-1', { body: 'hubspot' })).toEqual({ ok: false, code: 'not_resolvable' });
    expect(await resolveAllConflicts(w.id, 'hubspot')).toMatchObject({ ok: true, resolved: 0, remaining: 0 });
    expect(await dismissConflict(w.id, 'contact', c.record_id)).toBe(true);
    expect(await dismissConflict(w.id, 'activity', 'act-1')).toBe(true);
    expect((await listConflicts(w.id)).total).toBe(0);
  });

  it('con la conexión rota o de otra cuenta no se lee ni se resuelve', async () => {
    const { w, id } = await withConflict('hsconf-blocked');
    await db().prepare(`UPDATE crm_hubspot_sync SET last_error = 'invalid_token' WHERE user_id = ?`).run(w.id);
    expect(await conflictDetail(w.id, 'contact', id)).toEqual({ ok: false, code: 'blocked' });
    expect(await resolveConflict(w.id, 'contact', id, { job_title: 'hubspot' })).toEqual({ ok: false, code: 'blocked' });
    await db().prepare(`UPDATE crm_hubspot_sync SET last_error = '' WHERE user_id = ?`).run(w.id);
    await db().prepare(`UPDATE crm_hubspot_inbound SET portal_id = 'another' WHERE user_id = ?`).run(w.id);
    expect(await resolveConflict(w.id, 'contact', id, { job_title: 'hubspot' })).toEqual({ ok: false, code: 'blocked' });
    expect(await one('SELECT job_title FROM crm_contacts WHERE id = ?', id)).toEqual({ job_title: 'Title here' });
  });

  it('reintentar los rechazados los vuelve a la cola solo con la escritura prendida', async () => {
    const { w } = await live('hsconf-retry');
    const c = (await linkOf(w.id, '4002'))!;
    await db()
      .prepare(`INSERT INTO crm_hubspot_outbox (user_id, object, record_id, version, attempts, state, code) VALUES (?, 'contact', ?, 'v1', 4, 'failed', 'rejected')`)
      .run(w.id, c.record_id);
    expect(await retryFailedOutbound(w.id)).toBe(0);
    await enableWriting(w.id);
    expect((await getOutbound(w.id)).failedItems).toBe(1);
    expect(await retryFailedOutbound(w.id)).toBe(1);
    expect(await one('SELECT state, attempts, code FROM crm_hubspot_outbox WHERE user_id = ? AND record_id = ?', w.id, c.record_id)).toEqual({ state: 'pending', attempts: 0, code: '' });
    const other = await makeUser('hsconf-retry-other');
    expect(await retryFailedOutbound(other.id)).toBe(0);
  });
});
