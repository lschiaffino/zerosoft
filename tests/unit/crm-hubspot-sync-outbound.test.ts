import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createContact, createCompany, deleteContact, moveDeal, updateCompany, updateContact, updateDeal } from '@/lib/crm';
import { associateDealContact } from '@/lib/crm-assoc';
import { listTrash, restoreTrash } from '@/lib/crm-trash';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeHubspotPortal, seedSyncPortal, type FakeHubspotPortal } from '@/lib/hubspot/fake-portal';
import { connectSync } from '@/lib/crm-hubspot-sync/connection';
import { getInbound, runInboundStep, setInboundObjects, setInboundPaused, startInbound } from '@/lib/crm-hubspot-sync/inbound';
import { DAILY_WAIT_MS } from '@/lib/crm-hubspot-sync/inbound';
import { getOutbound, previewOutbound, processHubspotOutbound, runOutboundStep, setOutboundMode } from '@/lib/crm-hubspot-sync/outbound';
import { planPush, toHubspot, fitProperty } from '@/lib/crm-hubspot-sync/outbound-map';
import { makeUser } from './helpers';

/**
 * Sync zerosoft → HubSpot (bloque S3) contra la cuenta falsa de
 * lib/hubspot/fake-portal.ts (seedSyncPortal). Cada test arranca con la
 * entrada (S2) al día: tres empresas, tres contactos y dos negocios
 * vinculados. Nunca se llama a un HubSpot real.
 */

const KEY = 'pat-na1-outbound-legacy';
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
  for (let i = 0; i < 20; i++) {
    const r = await runOutboundStep(ws, { budgetMs: 30_000 });
    if (r === 'idle') return r;
    if (r !== 'progress') return r;
  }
  throw new Error('outbound pass did not finish');
}

/** Workspace con la entrada al día. `people`: Ines (81) es el owner y Teo (82) una persona del equipo. */
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

async function writing(label: string) {
  const s = await live(label);
  expect((await previewOutbound(s.w.id)).ok).toBe(true);
  expect((await setOutboundMode(s.w.id, s.w.id, true)).ok).toBe(true);
  portal.calls.length = 0;
  return s;
}

const linkOf = (ws: string, hubspotId: string, object = 'contact') =>
  one<{ record_id: string; shadow: string; state: string }>('SELECT record_id, shadow, state FROM crm_hubspot_links WHERE user_id = ? AND object = ? AND hubspot_id = ?', ws, object, hubspotId);

describe('apagado por defecto', () => {
  it('con la entrada al día, editar acá no encola ni escribe nada en HubSpot', async () => {
    const { w } = await live('hsout-off');
    const mara = (await linkOf(w.id, '4001'))!;
    portal.calls.length = 0;
    await updateContact(w.id, mara.record_id, { jobTitle: 'CFO' });
    expect(await count('crm_hubspot_outbox', 'user_id = ?', w.id)).toBe(0);
    expect((await getOutbound(w.id)).state).toBe('off');
    expect(await runOutboundStep(w.id)).toBe('not_claimed');
    expect(writes()).toEqual([]);
    // El cron no lo toma (otros workspaces de la misma base sí pueden tener la escritura prendida).
    await processHubspotOutbound({ budgetMs: 10_000 });
    expect(writes().filter((c) => c.path.includes('/4001'))).toEqual([]);
    expect(portal.contacts.get('4001')!.properties.jobtitle ?? '').toBe('');
  });

  it('no se prende sin la entrada al día ni sin una vista previa reciente', async () => {
    const w = await makeUser('hsout-gate');
    expect((await setOutboundMode(w.id, w.id, true)).ok).toBe(false);
    expect((await connectSync(w.id, w.id, KEY)).ok).toBe(true);
    expect(await setOutboundMode(w.id, w.id, true)).toMatchObject({ ok: false, code: 'read_sync_first' });
    expect((await getOutbound(w.id)).blocker).toBe('read_sync_first');
    expect((await startInbound(w.id, w.id)).ok).toBe(true);
    await inboundPass(w.id);
    expect(await setOutboundMode(w.id, w.id, true)).toMatchObject({ ok: false, code: 'preview_required' });
    expect((await previewOutbound(w.id)).ok).toBe(true);
    // Una vista previa vieja no alcanza.
    await db().prepare(`UPDATE crm_hubspot_outbound SET preview_at = '2026-01-01T00:00:00.000Z' WHERE user_id = ?`).run(w.id);
    expect(await setOutboundMode(w.id, w.id, true)).toMatchObject({ ok: false, code: 'preview_required' });
    expect((await previewOutbound(w.id)).ok).toBe(true);
    expect((await setOutboundMode(w.id, w.id, true)).ok).toBe(true);
    expect((await getOutbound(w.id)).state).toBe('on');
  });

  it('sin permiso de escritura en la clave no se prende', async () => {
    const w = await makeUser('hsout-readonly');
    expect((await connectSync(w.id, w.id, 'pat-na1-readonly-out')).ok).toBe(true);
    expect((await startInbound(w.id, w.id)).ok).toBe(true);
    await inboundPass(w.id);
    const res = await setOutboundMode(w.id, w.id, true);
    expect(res).toMatchObject({ ok: false, code: 'missing_write_scope' });
    expect((await getOutbound(w.id)).blocker).toBe('missing_write_scope');
  });
});

describe('vista previa (dry run)', () => {
  it('muestra campos y conteos de lo cambiado acá, sin llamar a HubSpot ni guardar valores; prender encola eso', async () => {
    const { w } = await live('hsout-preview');
    const mara = (await linkOf(w.id, '4001'))!;
    const joel = (await linkOf(w.id, '4002'))!;
    await updateContact(w.id, mara.record_id, { jobTitle: 'Head of sales', city: 'Lujan' });
    await updateContact(w.id, joel.record_id, { jobTitle: 'Engineer' });
    portal.calls.length = 0;
    const res = await previewOutbound(w.id);
    expect(res.ok).toBe(true);
    expect(portal.calls).toEqual([]);
    const preview = res.ok ? res.outbound.preview! : null;
    expect(preview!.objects.contacts).toMatchObject({ records: 2, fields: { job_title: 2, city: 1 }, create: 0 });
    expect(preview!.objects.companies).toMatchObject({ records: 0 });
    const stored = (await one<{ preview: string }>('SELECT preview FROM crm_hubspot_outbound WHERE user_id = ?', w.id))!.preview;
    expect(stored).not.toContain('Head of sales');
    expect(stored).not.toContain('Lujan');
    expect(writes()).toEqual([]);

    expect((await setOutboundMode(w.id, w.id, true)).ok).toBe(true);
    expect(await count('crm_hubspot_outbox', 'user_id = ?', w.id)).toBe(2);
    expect(writes()).toEqual([]);
    await outboundPass(w.id);
    expect(portal.contacts.get('4001')!.properties.jobtitle).toBe('Head of sales');
    expect(portal.contacts.get('4002')!.properties.jobtitle).toBe('Engineer');
  });
});

describe('cambios de acá van a HubSpot', () => {
  it('propiedades, dueño, campo propio; el shadow queda al día y la vuelta de la entrada no lo ve como conflicto', async () => {
    const { w, mate } = await writing('hsout-props');
    const mara = (await linkOf(w.id, '4001'))!;
    await updateContact(w.id, mara.record_id, { firstName: 'Mara Sol', jobTitle: 'COO', ownerId: mate.id, lifecycleStage: 'lead', custom: { preferred_language: 'English' } });
    expect(await count('crm_hubspot_outbox', 'user_id = ? AND record_id = ?', w.id, mara.record_id)).toBe(1);
    expect(await outboundPass(w.id)).toBe('idle');
    const patch = writes().find((c) => c.method === 'PATCH' && c.path === '/crm/v3/objects/contacts/4001');
    expect(patch).toBeTruthy();
    expect((patch!.body as { properties: Record<string, string> }).properties).toEqual({
      firstname: 'Mara Sol',
      jobtitle: 'COO',
      hubspot_owner_id: '82',
      lifecyclestage: 'lead',
      preferred_language: 'en',
    });
    expect(portal.contacts.get('4001')!.properties).toMatchObject({ firstname: 'Mara Sol', jobtitle: 'COO', hubspot_owner_id: '82', preferred_language: 'en' });
    expect(JSON.parse((await linkOf(w.id, '4001'))!.shadow)).toMatchObject({ first_name: 'Mara Sol', job_title: 'COO', owner_id: mate.id, 'custom.preferred_language': '"English"' });
    expect(await count('crm_hubspot_outbox', 'user_id = ?', w.id)).toBe(0);
    expect((await getOutbound(w.id)).counts.contacts).toMatchObject({ updated: 1, conflicts: 0, failed: 0 });

    // La entrada relee lo que escribimos: igual de los dos lados, sin conflicto y sin tocar el registro.
    const before = await one<{ updated_at: string }>('SELECT updated_at FROM crm_contacts WHERE id = ?', mara.record_id);
    portal.calls.length = 0;
    await inboundPass(w.id);
    expect(await count('crm_hubspot_sync_conflicts', 'user_id = ?', w.id)).toBe(0);
    expect(await one('SELECT updated_at FROM crm_contacts WHERE id = ?', mara.record_id)).toEqual(before);
    expect((await getInbound(w.id)).counts.contacts).toMatchObject({ conflicts: 0 });
    // Y nada vuelve a salir.
    await outboundPass(w.id);
    expect(writes()).toEqual([]);
  });

  it('lo que escribió la entrada no vuelve a HubSpot (ni una lectura)', async () => {
    const { w } = await writing('hsout-echo');
    portal.edit('contacts', '4002', { jobtitle: 'Designer', city: 'Norman' });
    portal.edit('companies', '3001', { city: 'San Rafael' });
    await inboundPass(w.id);
    const joel = (await linkOf(w.id, '4002'))!;
    expect(await one('SELECT job_title FROM crm_contacts WHERE id = ?', joel.record_id)).toEqual({ job_title: 'Designer' });
    // Los triggers encolaron lo que escribió la entrada…
    expect(await count('crm_hubspot_outbox', 'user_id = ?', w.id)).toBeGreaterThan(0);
    portal.calls.length = 0;
    await outboundPass(w.id);
    // …pero contra el shadow no hay diferencia: no se escribe ni se lee nada.
    expect(portal.calls.filter((c) => c.path.includes('/objects/'))).toEqual([]);
    expect(await count('crm_hubspot_outbox', 'user_id = ?', w.id)).toBe(0);
    expect((await getOutbound(w.id)).counts.contacts).toMatchObject({ updated: 0 });
  });

  it('cambiado de los dos lados: ese campo no sale, se anota con el nombre y sin valores; lo demás sí sale', async () => {
    const { w } = await writing('hsout-conflict');
    const mara = (await linkOf(w.id, '4001'))!;
    await updateContact(w.id, mara.record_id, { jobTitle: 'Ours', phone: '+54 261 555 0999' });
    portal.edit('contacts', '4001', { jobtitle: 'Theirs' });
    await outboundPass(w.id);
    const patch = writes().find((c) => c.method === 'PATCH');
    expect((patch!.body as { properties: Record<string, string> }).properties).toEqual({ phone: '+54 261 555 0999' });
    expect(portal.contacts.get('4001')!.properties.jobtitle).toBe('Theirs');
    expect(await one('SELECT job_title FROM crm_contacts WHERE id = ?', mara.record_id)).toEqual({ job_title: 'Ours' });
    const conflict = await one<{ fields: string; kind: string }>('SELECT fields, kind FROM crm_hubspot_sync_conflicts WHERE user_id = ? AND record_id = ?', w.id, mara.record_id);
    expect(conflict).toEqual({ fields: 'job_title', kind: 'fields' });
    expect((await getOutbound(w.id)).counts.contacts).toMatchObject({ updated: 1, conflicts: 1 });
    // La entrada tampoco pisa lo nuestro.
    await inboundPass(w.id);
    expect(await one('SELECT job_title FROM crm_contacts WHERE id = ?', mara.record_id)).toEqual({ job_title: 'Ours' });
  });

  it('negocios: etapa con su pipeline, monto, fecha de cierre y dueño', async () => {
    const { w, mate } = await writing('hsout-deal');
    const d = (await linkOf(w.id, '6002', 'deal'))!;
    const won = (await one<{ id: string }>(
      `SELECT s.id FROM crm_stages s JOIN crm_external_ids e ON e.record_id = s.id AND e.object = 'stage' AND e.provider = 'hubspot' WHERE e.user_id = ? AND e.external_id = 'contractsent'`,
      w.id,
    ))!;
    await moveDeal(w.id, d.record_id, won.id, null, undefined, '', { enforceRequired: false });
    await updateDeal(w.id, d.record_id, { amount: 3100.5, closeDate: '2027-03-01', ownerId: w.id });
    await outboundPass(w.id);
    const p = portal.deals.get('6002')!.properties;
    expect(p).toMatchObject({ dealstage: 'contractsent', pipeline: 'default', amount: '3100.5', hubspot_owner_id: '81' });
    expect(p.closedate.slice(0, 10)).toBe('2027-03-01');
    portal.calls.length = 0;
    await inboundPass(w.id);
    expect(await count('crm_hubspot_sync_conflicts', 'user_id = ?', w.id)).toBe(0);
    expect(await one('SELECT stage_id, amount FROM crm_deals WHERE id = ?', d.record_id)).toEqual({ stage_id: won.id, amount: 3100.5 });
    void mate;
  });

  it('un valor que HubSpot no acepta no sale (se anota el código, nunca el valor) y no frena lo demás', async () => {
    const { w } = await writing('hsout-reject');
    const nw = (await linkOf(w.id, '3001', 'company'))!;
    // La opción de acá no existe allá: no se manda.
    await db().prepare(`UPDATE crm_custom_fields SET options = '["SMB","Mid-market","Enterprise","Global"]' WHERE user_id = ? AND name = 'segment'`).run(w.id);
    await updateCompany(w.id, nw.record_id, { custom: { segment: 'Global' }, city: 'Godoy Cruz' });
    await outboundPass(w.id);
    const p = portal.companies.get('3001')!.properties;
    expect(p.city).toBe('Godoy Cruz');
    expect(p.segment).toBe('mid');
    const view = await getOutbound(w.id);
    expect(view.errors.map((e) => e.code)).toContain('value_not_accepted');
    expect(JSON.stringify(view)).not.toContain('Global');

    // HubSpot rechaza una propiedad (400): se reintenta sin ella; el resto sale.
    portal.props.companies.find((d) => d.name === 'city')!.type = 'number';
    await updateCompany(w.id, nw.record_id, { city: 'Maipu', name: 'Northwind Parts SA' });
    await db().prepare(`UPDATE crm_hubspot_outbound SET props_at = NULL WHERE user_id = ?`).run(w.id);
    portal.props.companies.find((d) => d.name === 'city')!.type = 'string';
    // La definición guardada todavía dice texto: el 400 llega de HubSpot.
    await outboundPass(w.id);
    portal.props.companies.find((d) => d.name === 'city')!.type = 'number';
    await updateCompany(w.id, nw.record_id, { city: 'Lavalle', name: 'Northwind Parts' });
    await outboundPass(w.id);
    expect(portal.companies.get('3001')!.properties.name).toBe('Northwind Parts');
    expect(portal.companies.get('3001')!.properties.city).toBe('Maipu');
  });
});

describe('revisión', () => {
  it('un conflicto que anotó la entrada no se borra al mandar otro campo; prender dos veces no suelta el turno', async () => {
    const { w } = await writing('hsout-keepconf');
    const mara = (await linkOf(w.id, '4001'))!;
    await db().prepare(`INSERT INTO crm_hubspot_sync_conflicts (user_id, object, record_id, hubspot_id, kind, fields) VALUES (?, 'contact', ?, '4001', 'fields', 'email')`).run(w.id, mara.record_id);
    await updateContact(w.id, mara.record_id, { jobTitle: 'Other field' });
    await outboundPass(w.id);
    expect(await one('SELECT fields FROM crm_hubspot_sync_conflicts WHERE user_id = ? AND record_id = ?', w.id, mara.record_id)).toEqual({ fields: 'email' });
    const until = '2999-01-01T00:00:00.000Z';
    await db().prepare('UPDATE crm_hubspot_outbound SET locked_until = ? WHERE user_id = ?').run(until, w.id);
    expect((await setOutboundMode(w.id, w.id, true)).ok).toBe(true);
    expect(await one('SELECT locked_until FROM crm_hubspot_outbound WHERE user_id = ?', w.id)).toEqual({ locked_until: until });
  });

  it('un 4xx de un registro queda en ese cambio y no frena la cola', async () => {
    const { w } = await writing('hsout-4xx');
    const nw = (await linkOf(w.id, '3001', 'company'))!;
    const mara = (await linkOf(w.id, '4001'))!;
    await updateCompany(w.id, nw.record_id, { city: 'Blocked' });
    await updateContact(w.id, mara.record_id, { jobTitle: 'Still goes' });
    portal.fail(409, 1, { path: '/crm/v3/objects/companies/3001' });
    expect(await outboundPass(w.id)).toBe('idle');
    expect(portal.contacts.get('4001')!.properties.jobtitle).toBe('Still goes');
    expect(await one('SELECT state, code FROM crm_hubspot_outbox WHERE user_id = ? AND record_id = ?', w.id, nw.record_id)).toEqual({ state: 'pending', code: 'rejected' });
  });
});

describe('altas y asociaciones', () => {
  it('un contacto nuevo se crea en HubSpot con su empresa; la entrada no lo duplica', async () => {
    const { w } = await writing('hsout-create');
    const nw = (await linkOf(w.id, '3001', 'company'))!;
    const c = await createContact(w.id, { firstName: 'Lia', lastName: 'Paz', email: 'lia@northwind-parts.example', companyId: nw.record_id });
    await outboundPass(w.id);
    const link = await one<{ hubspot_id: string; state: string }>(`SELECT hubspot_id, state FROM crm_hubspot_links WHERE user_id = ? AND object = 'contact' AND record_id = ?`, w.id, c.id);
    expect(link?.state).toBe('linked');
    const created = portal.contacts.get(link!.hubspot_id)!;
    expect(created.properties).toMatchObject({ firstname: 'Lia', lastname: 'Paz', email: 'lia@northwind-parts.example' });
    expect(portal.associated('contacts', link!.hubspot_id, 'companies').map((a) => String(a.toObjectId))).toEqual(['3001']);
    expect((await getOutbound(w.id)).counts.contacts).toMatchObject({ created: 1, associations: 1 });
    await inboundPass(w.id);
    expect(await count('crm_contacts', 'user_id = ?', w.id)).toBe(4);
    expect(await count('crm_hubspot_sync_conflicts', 'user_id = ?', w.id)).toBe(0);
    // Volver a vaciar la cola no crea otro.
    portal.calls.length = 0;
    await outboundPass(w.id);
    expect(writes()).toEqual([]);
  });

  it('un contacto nuevo con un email que ya está en HubSpot se vincula a ese (no se crea otro)', async () => {
    const { w } = await writing('hsout-match');
    const hs = portal.add('contacts', { firstname: 'Ana', email: 'ana@tallgrass-labs.example', jobtitle: 'CTO' });
    const c = await createContact(w.id, { firstName: 'Ana', lastName: 'Ruiz', email: 'ana@tallgrass-labs.example' });
    await outboundPass(w.id);
    expect(writes().filter((x) => x.method === 'POST' && x.path === '/crm/v3/objects/contacts')).toEqual([]);
    expect(await one(`SELECT hubspot_id FROM crm_hubspot_links WHERE user_id = ? AND record_id = ?`, w.id, c.id)).toEqual({ hubspot_id: hs });
    // Vacío allá: se completa con lo de acá. Lo que solo tiene HubSpot lo trae la entrada.
    expect(portal.contacts.get(hs)!.properties.lastname).toBe('Ruiz');
    await inboundPass(w.id);
    expect(await one('SELECT job_title FROM crm_contacts WHERE id = ?', c.id)).toEqual({ job_title: 'CTO' });
    expect(await count('crm_contacts', 'user_id = ?', w.id)).toBe(4);
    expect((await getOutbound(w.id)).counts.contacts).toMatchObject({ matched: 1, created: 0 });
  });

  it('una asociación agregada acá se agrega allá; una que ya estaba no se vuelve a escribir', async () => {
    const { w } = await writing('hsout-assoc');
    const pilot = (await linkOf(w.id, '6002', 'deal'))!;
    const mara = (await linkOf(w.id, '4001'))!;
    const joel = (await linkOf(w.id, '4002'))!;
    await associateDealContact(w.id, pilot.record_id, mara.record_id);
    // Ya asociado en HubSpot (lo trajo la entrada): se encola por el trigger, pero no se escribe.
    await db().prepare('DELETE FROM crm_deal_contacts WHERE deal_id = ? AND contact_id = ?').run(pilot.record_id, joel.record_id);
    await associateDealContact(w.id, pilot.record_id, joel.record_id);
    await outboundPass(w.id);
    const puts = writes().filter((c) => c.method === 'PUT');
    // El contacto trae su empresa principal al negocio (como HubSpot): las dos son asociaciones nuevas acá.
    expect(puts.map((c) => c.path).sort()).toEqual(['/crm/v4/objects/deals/6002/associations/default/companies/3001', '/crm/v4/objects/deals/6002/associations/default/contacts/4001']);
    expect(portal.associated('deals', '6002', 'contacts').map((a) => String(a.toObjectId)).sort()).toEqual(['4001', '4002']);
    // Nunca se quita una asociación allá.
    await db().prepare('DELETE FROM crm_deal_contacts WHERE deal_id = ? AND contact_id = ?').run(pilot.record_id, joel.record_id);
    await outboundPass(w.id);
    expect(writes().filter((c) => c.method === 'DELETE' || c.path.includes('archive'))).toEqual([]);
  });

  it('un negocio nuevo se crea con etapa y pipeline; uno en una etapa sin equivalente allá no se crea', async () => {
    const { w } = await writing('hsout-newdeal');
    const stage = (await one<{ id: string; pipeline_id: string }>(
      `SELECT s.id, s.pipeline_id FROM crm_stages s JOIN crm_external_ids e ON e.record_id = s.id AND e.object = 'stage' AND e.provider = 'hubspot' WHERE e.user_id = ? AND e.external_id = 'renewal_open'`,
      w.id,
    ))!;
    const { createDeal, createStage } = await import('@/lib/crm');
    const mine = await createDeal(w.id, { name: 'Renewal 2027', pipelineId: stage.pipeline_id, stageId: stage.id, amount: 900, currency: 'USD' });
    const local = await createStage(w.id, stage.pipeline_id, { name: 'Only here' });
    const orphan = await createDeal(w.id, { name: "Orphan", pipelineId: stage.pipeline_id, stageId: local!.id });
    await outboundPass(w.id);
    const link = await one<{ hubspot_id: string }>(`SELECT hubspot_id FROM crm_hubspot_links WHERE user_id = ? AND record_id = ?`, w.id, mine.ok ? mine.deal.id : '');
    expect(portal.deals.get(link!.hubspot_id)!.properties).toMatchObject({ dealname: 'Renewal 2027', pipeline: 'renewals', dealstage: 'renewal_open', amount: '900', deal_currency_code: 'USD' });
    expect(await one(`SELECT hubspot_id FROM crm_hubspot_links WHERE user_id = ? AND record_id = ?`, w.id, orphan.ok ? orphan.deal.id : '')).toBeUndefined();
    expect(await one(`SELECT state, code FROM crm_hubspot_outbox WHERE user_id = ? AND record_id = ?`, w.id, orphan.ok ? orphan.deal.id : '')).toEqual({ state: 'failed', code: 'stage_unmapped' });
    expect((await getOutbound(w.id)).failedItems).toBe(1);
  });
});

describe('borrar acá solo marca el vínculo', () => {
  it('borrar no toca HubSpot; restaurar lo vuelve a vincular', async () => {
    const { w } = await writing('hsout-delete');
    const joel = (await linkOf(w.id, '4002'))!;
    await updateContact(w.id, joel.record_id, { jobTitle: 'Pending' });
    expect(await deleteContact(w.id, joel.record_id)).toBe(true);
    expect((await linkOf(w.id, '4002'))!.state).toBe('deleted_here');
    expect(await count('crm_hubspot_outbox', 'user_id = ? AND record_id = ?', w.id, joel.record_id)).toBe(0);
    await outboundPass(w.id);
    expect(writes()).toEqual([]);
    expect(portal.contacts.has('4002')).toBe(true);
    const entry = (await listTrash(w.id, { entity: 'contact' })).find((t) => t.record_id === joel.record_id)!;
    expect((await restoreTrash(w.id, entry.id)).ok).toBe(true);
    expect((await linkOf(w.id, '4002'))!.state).toBe('linked');
  });
});

describe('límites de HubSpot, pausa y objetos', () => {
  it('límite diario: espera 30 minutos; un error pasajero: reintenta con espera; nada se pierde', async () => {
    const { w } = await writing('hsout-limits');
    const mara = (await linkOf(w.id, '4001'))!;
    await updateContact(w.id, mara.record_id, { jobTitle: 'Later' });
    portal.fail(429, 1, { policyName: 'DAILY' });
    await db().prepare('UPDATE crm_hubspot_outbound SET next_run_at = NULL, props_at = NULL WHERE user_id = ?').run(w.id);
    const t0 = Date.now();
    expect(await runOutboundStep(w.id)).toBe('waiting');
    const row = (await one<{ next_run_at: string; failure: string }>('SELECT next_run_at, failure FROM crm_hubspot_outbound WHERE user_id = ?', w.id))!;
    expect(row.failure).toBe('daily_limit');
    expect(Date.parse(row.next_run_at) - t0).toBeGreaterThanOrEqual(DAILY_WAIT_MS - 1_000);
    expect((await getOutbound(w.id)).state).toBe('waiting');
    expect(await runOutboundStep(w.id)).toBe('not_claimed');

    portal.fail(500, 10);
    expect(await outboundPass(w.id)).toBe('retrying');
    expect((await getOutbound(w.id)).state).toBe('retrying');
    portal.faults = [];
    expect(await outboundPass(w.id)).toBe('idle');
    expect(portal.contacts.get('4001')!.properties.jobtitle).toBe('Later');
    expect((await getOutbound(w.id)).state).toBe('on');
  });

  it('la pausa del sync frena la escritura; un objeto que no se trae tampoco se escribe', async () => {
    const { w } = await writing('hsout-pause');
    const mara = (await linkOf(w.id, '4001'))!;
    await updateContact(w.id, mara.record_id, { jobTitle: 'Paused' });
    await setInboundPaused(w.id, w.id, true);
    expect(await runOutboundStep(w.id)).toBe('paused');
    expect((await getOutbound(w.id)).state).toBe('paused');
    expect(writes()).toEqual([]);
    await setInboundPaused(w.id, w.id, false);
    await setInboundObjects(w.id, { contacts: false });
    await outboundPass(w.id);
    expect(writes()).toEqual([]);
    expect(await count('crm_hubspot_outbox', 'user_id = ?', w.id)).toBe(0);
  });

  it('apagar deja de encolar; nada de esto escribe en la consola ni guarda valores', async () => {
    const log = vi.spyOn(console, 'log');
    const err = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const { w } = await writing('hsout-quiet');
    const mara = (await linkOf(w.id, '4001'))!;
    await updateContact(w.id, mara.record_id, { jobTitle: 'Quiet title' });
    portal.edit('contacts', '4001', { jobtitle: 'Loud title' });
    await outboundPass(w.id);
    expect((await setOutboundMode(w.id, w.id, false)).ok).toBe(true);
    await updateContact(w.id, mara.record_id, { city: 'Nowhere' });
    expect(await count('crm_hubspot_outbox', 'user_id = ?', w.id)).toBe(0);
    for (const spy of [log, err, warn]) expect(spy).not.toHaveBeenCalled();
    const rows = await all<Record<string, string>>('SELECT * FROM crm_hubspot_outbound WHERE user_id = ?', w.id);
    const text = JSON.stringify(rows) + JSON.stringify(await all('SELECT * FROM crm_hubspot_sync_conflicts WHERE user_id = ?', w.id));
    for (const v of ['Quiet title', 'Loud title', 'Nowhere', 'mara@', KEY]) expect(text).not.toContain(v);
  });
});

describe('reglas puras', () => {
  it('planPush: cambió acá, de los dos lados, igual allá, sin shadow', () => {
    const shadow = { job_title: 'A', city: 'X', phone: '1', first_name: 'N' };
    const local = { job_title: 'B', city: 'Y', phone: '2', first_name: 'N', country: 'Z' };
    const remote = { job_title: 'A', city: 'W', phone: '2', first_name: 'N', country: '' };
    expect(planPush(local, shadow, remote)).toEqual({ push: ['job_title'], agree: ['phone'], conflicts: ['city'] });
  });

  it('toHubspot: opciones, etapa, dueño, lifecycle y propiedades que allá no se pueden escribir', () => {
    const ctx = {
      owners: new Map([['p1', '81']]),
      stages: new Map([['s1', { stage: 'closedwon', pipeline: 'default' }]]),
      fields: [{ key: 'tier', name: 'tier', type: 'multiselect' as const, options: ['Gold', 'Silver'], optionMap: { g: 'Gold', s: 'Silver' } }],
      defs: {
        hubspot_owner_id: { type: 'enumeration', readOnly: false },
        lifecyclestage: { type: 'enumeration', readOnly: false, options: [{ value: 'marketingqualifiedlead', label: 'MQL' }] },
        tier: { type: 'enumeration', readOnly: false, options: [{ value: 'g', label: 'Gold' }, { value: 's', label: 'Silver' }] },
        jobtitle: { type: 'string', readOnly: true },
      },
    };
    expect(toHubspot('contacts', 'owner_id', 'p1', ctx)).toEqual({ ok: true, props: { hubspot_owner_id: '81' } });
    expect(toHubspot('contacts', 'owner_id', 'p2', ctx)).toEqual({ ok: false, code: 'owner_unmapped' });
    expect(toHubspot('contacts', 'lifecycle_stage', 'mql', ctx)).toEqual({ ok: true, props: { lifecyclestage: 'marketingqualifiedlead' } });
    expect(toHubspot('contacts', 'job_title', 'x', ctx)).toEqual({ ok: false, code: 'read_only' });
    expect(toHubspot('contacts', 'city', 'x', ctx)).toEqual({ ok: false, code: 'property_missing' });
    expect(toHubspot('contacts', 'custom.tier', '["Gold","Silver"]', ctx)).toEqual({ ok: true, props: { tier: 'g;s' } });
    expect(toHubspot('deals', 'stage_id', 's1', ctx)).toEqual({ ok: true, props: { pipeline: 'default', dealstage: 'closedwon' } });
    expect(toHubspot('deals', 'stage_id', 's9', ctx)).toEqual({ ok: false, code: 'stage_unmapped' });
    expect(fitProperty({ type: 'number', readOnly: false }, 'abc')).toEqual({ ok: false, code: 'value_not_accepted' });
    expect(fitProperty({ type: 'datetime', readOnly: false }, '2027-01-31')).toEqual({ ok: true, value: '2027-01-31T00:00:00.000Z' });
  });
});
