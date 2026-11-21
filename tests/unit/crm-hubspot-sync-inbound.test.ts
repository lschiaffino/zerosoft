import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createContact, createCompany } from '@/lib/crm';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeHubspotPortal, seedSyncPortal, type FakeHubspotPortal } from '@/lib/hubspot/fake-portal';
import { connectSync, disconnectSync, syncGate } from '@/lib/crm-hubspot-sync/connection';
import { BACKOFF_BASE_MS, DAILY_WAIT_MS, backoffMs, getInbound, processHubspotInbound, runInboundStep, setInboundObjects, setInboundPaused, startInbound } from '@/lib/crm-hubspot-sync/inbound';
import { resolve } from '@/lib/crm-hubspot-sync/inbound-map';
import { makeUser } from './helpers';

/**
 * Sync HubSpot → CRM (bloque S2) contra la cuenta falsa de
 * lib/hubspot/fake-portal.ts (seedSyncPortal): tres empresas (dos con el
 * mismo dominio), tres contactos (uno sin email), dos negocios en el pipeline
 * por defecto, dueños y campos propios con opciones.
 */

const KEY = 'pat-na1-inbound-legacy';
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
const all = <T>(q: string, ...a: Array<string | number | null>) => db().prepare(q).all(...a) as Promise<T[]>;
const one = <T>(q: string, ...a: Array<string | number | null>) => db().prepare(q).get(...a) as Promise<T | undefined>;
const count = async (table: string, where: string, ...a: string[]) => Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...a))!.n);

async function connected(label: string) {
  const owner = await makeUser(label);
  expect((await connectSync(owner.id, owner.id, KEY)).ok).toBe(true);
  return owner;
}

/** Deja el turno vencido (en vivo, el próximo tramo espera un minuto). */
const due = (ws: string) => db().prepare('UPDATE crm_hubspot_inbound SET next_run_at = NULL, locked_until = NULL WHERE user_id = ?').run(ws);

/** Corre tramos hasta cerrar una vuelta. */
async function pass(ws: string, opts: { maxPages?: number; pageSize?: number } = {}): Promise<number> {
  await due(ws);
  for (let i = 1; i < 300; i++) {
    const r = await runInboundStep(ws, { budgetMs: 30_000, ...opts });
    if (r === 'idle') return i;
    expect(r).toBe('progress');
  }
  throw new Error('pass did not finish');
}

async function started(label: string) {
  const owner = await connected(label);
  const res = await startInbound(owner.id, owner.id);
  expect(res.ok).toBe(true);
  return owner;
}

const contactsOf = (ws: string) => all<{ id: string; email: string; first_name: string; job_title: string; owner_id: string | null; custom: string; city: string; phone: string }>('SELECT * FROM crm_contacts WHERE user_id = ? ORDER BY email', ws);

describe('apagado por defecto', () => {
  it('conectar no trae nada; el cron no toca un workspace hasta que un admin lo arranca', async () => {
    const owner = await connected('hsin-off');
    expect((await syncGate(owner.id)).reason).toBe('off');
    expect((await getInbound(owner.id)).state).toBe('off');
    await processHubspotInbound({ budgetMs: 10_000 });
    expect(await runInboundStep(owner.id)).toBe('not_claimed');
    expect(await count('crm_contacts', 'user_id = ?', owner.id)).toBe(0);
    expect(await count('crm_hubspot_links', 'user_id = ?', owner.id)).toBe(0);
  });
});

describe('primera vuelta: todo lo de HubSpot entra al CRM', () => {
  it('empresas, contactos, negocios, pipelines y etapas, campos propios, asociaciones y dueños', async () => {
    const w = await makeUser('hsin-first');
    const mate = await makeUser('hsin-first-mate');
    const team = await createTeam(w.id, 'Sales');
    await addMember(team.id, mate.id, 'member');
    expect((await connectSync(w.id, w.id, KEY)).ok).toBe(true);
    // Ines (81) es el owner del workspace; Teo (82) es la persona del equipo. El dueño archivado (83) no es nadie.
    portal.owners.get('81')!.email = w.email.toUpperCase();
    portal.owners.get('82')!.email = mate.email;
    portal.calls.length = 0;
    expect((await startInbound(w.id, w.id)).ok).toBe(true);
    await pass(w.id, { pageSize: 2 });

    const view = await getInbound(w.id);
    expect(view.state).toBe('live');
    expect(view.linked).toMatchObject({ companies: 3, contacts: 3, deals: 2 });
    expect(view.counts.contacts).toMatchObject({ created: 3, updated: 0, conflicts: 0, failed: 0 });
    expect(view.progress.contacts).toMatchObject({ caughtUp: true, read: 3, total: 3 });

    const contacts = await contactsOf(w.id);
    expect(contacts.map((c) => c.email).sort()).toEqual(['', 'joel@tallgrass-labs.example', 'mara@northwind-parts.example']);
    const mara = contacts.find((c) => c.email.startsWith('mara'))!;
    const joel = contacts.find((c) => c.email.startsWith('joel'))!;
    const bia = contacts.find((c) => !c.email)!;
    expect(mara.owner_id).toBe(w.id);
    expect(joel.owner_id).toBe(mate.id);
    expect(bia.owner_id).toBeNull();
    expect(mara.phone).toBe('+54 261 555 0111');
    // Campo propio creado desde la definición de HubSpot, con la etiqueta de la opción.
    expect(JSON.parse(mara.custom)).toEqual({ preferred_language: 'Spanish' });
    const field = await one<{ type: string; options: string }>(`SELECT type, options FROM crm_custom_fields WHERE user_id = ? AND entity = 'contacts' AND name = 'preferred_language'`, w.id);
    expect(field?.type).toBe('select');
    expect(JSON.parse(field!.options)).toEqual(['Spanish', 'English', 'Portuguese']);

    // Empresa principal de cada contacto y la secundaria de Bia.
    const primary = await all<{ contact_id: string; name: string; is_primary: number }>(
      `SELECT cc.contact_id, co.name, cc.is_primary FROM crm_contact_companies cc JOIN crm_companies co ON co.id = cc.company_id WHERE cc.user_id = ?`,
      w.id,
    );
    expect(primary.find((p) => p.contact_id === mara.id)).toMatchObject({ name: 'Northwind Parts', is_primary: 1 });
    expect(primary.filter((p) => p.contact_id === bia.id)).toHaveLength(1);

    // Negocios: pipeline y etapas creados acá, monto, moneda, cierre, contactos y empresa principal.
    const deals = await all<{ id: string; name: string; amount: number; currency: string; close_date: string | null; stage: string; pipeline: string; owner_id: string; custom: string }>(
      `SELECT d.*, s.name AS stage, p.name AS pipeline FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id JOIN crm_pipelines p ON p.id = d.pipeline_id WHERE d.user_id = ? ORDER BY d.amount DESC`,
      w.id,
    );
    expect(deals.map((d) => [d.name, d.amount, d.currency, d.close_date, d.stage, d.pipeline])).toEqual([
      ['Northwind annual plan', 18000, 'USD', '2027-01-31', 'Contract sent', 'Sales pipeline'],
      ['Tallgrass pilot', 2400, 'USD', null, 'Appointment scheduled', 'Sales pipeline'],
    ]);
    expect(JSON.parse(deals[0].custom)).toEqual({ renewal_type: ['Annual'] });
    expect(await count('crm_stages', `pipeline_id IN (SELECT id FROM crm_pipelines WHERE user_id = ? AND name = 'Renewals')`, w.id)).toBe(2);
    expect(await count('crm_deal_contacts', 'deal_id = ?', deals[0].id)).toBe(1);
    expect(await one(`SELECT is_primary FROM crm_deal_companies WHERE deal_id = ?`, deals[0].id)).toEqual({ is_primary: 1 });

    // Nada se escribió en HubSpot.
    expect(portal.calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/search') && !c.path.endsWith('/batch/read'))).toEqual([]);
  });

  it('un contacto o una empresa que ya están acá se vinculan (email, dominio) y solo se completan; lo distinto queda y se anota', async () => {
    const w = await connected('hsin-match');
    const mara = await createContact(w.id, { firstName: 'Mara', lastName: 'Q', email: ' MARA@northwind-parts.example ', jobTitle: 'CEO' });
    const nw = await createCompany(w.id, { name: 'Northwind', domain: 'https://www.northwind-parts.example/' });
    await startInbound(w.id, w.id);
    await pass(w.id);
    expect(await count('crm_contacts', 'user_id = ?', w.id)).toBe(3);
    expect(await count('crm_companies', 'user_id = ?', w.id)).toBe(3);
    const after = (await one<{ last_name: string; phone: string; job_title: string }>('SELECT * FROM crm_contacts WHERE id = ?', mara.id))!;
    // Vacío acá: se completó. Distinto de los dos lados sin historia: queda lo nuestro y se anota.
    expect(after.phone).toBe('+54 261 555 0111');
    expect(after.last_name).toBe('Q');
    expect(after.job_title).toBe('CEO');
    const conflict = await one<{ fields: string; kind: string }>('SELECT fields, kind FROM crm_hubspot_sync_conflicts WHERE user_id = ? AND record_id = ?', w.id, mara.id);
    expect(conflict).toEqual({ fields: 'last_name', kind: 'fields' });
    expect(await one('SELECT name FROM crm_companies WHERE id = ?', nw.id)).toEqual({ name: 'Northwind' });
    expect(await one(`SELECT hubspot_id FROM crm_hubspot_links WHERE user_id = ? AND record_id = ?`, w.id, nw.id)).toEqual({ hubspot_id: '3001' });
  });

  it('lo que trajo el importador se vincula sin duplicar; si nadie lo tocó desde entonces, HubSpot manda', async () => {
    const w = await connected('hsin-imported');
    const joel = await createContact(w.id, { firstName: 'Joe', lastName: 'Hart', email: 'joel@tallgrass-labs.example', city: 'Old town' });
    await db().prepare(`UPDATE crm_contacts SET updated_at = '2026-01-01 00:00:00' WHERE id = ?`).run(joel.id);
    await db().prepare(`INSERT INTO crm_external_ids (user_id, provider, object, external_id, record_id, imported_at) VALUES (?, 'hubspot', 'contact', '4002', ?, '2026-02-01 00:00:00')`).run(w.id, joel.id);
    await startInbound(w.id, w.id);
    await pass(w.id);
    const row = (await one<{ first_name: string; city: string }>('SELECT first_name, city FROM crm_contacts WHERE id = ?', joel.id))!;
    expect(row.first_name).toBe('Joel');
    // HubSpot no tiene ciudad para Joel: un vacío de HubSpot no borra lo nuestro la primera vez.
    expect(row.city).toBe('Old town');
    expect(await count('crm_contacts', 'user_id = ?', w.id)).toBe(3);
  });
});

describe('idempotencia', () => {
  it('correr dos veces (y releer todo desde cero) no duplica nada', async () => {
    const w = await started('hsin-idem');
    await pass(w.id, { pageSize: 1 });
    const snapshot = async () => ({
      contacts: await count('crm_contacts', 'user_id = ?', w.id),
      companies: await count('crm_companies', 'user_id = ?', w.id),
      deals: await count('crm_deals', 'user_id = ?', w.id),
      links: await count('crm_hubspot_links', 'user_id = ?', w.id),
      assoc: await count('crm_contact_companies', 'user_id = ?', w.id),
      dealContacts: await count('crm_deal_contacts', `deal_id IN (SELECT id FROM crm_deals WHERE user_id = '${w.id}')`),
      pipelines: await count('crm_pipelines', 'user_id = ?', w.id),
      fields: await count('crm_custom_fields', 'user_id = ?', w.id),
    });
    const first = await snapshot();
    await pass(w.id);
    // Cursores en cero y plan vencido: se relee y se rearma todo.
    await db().prepare(`UPDATE crm_hubspot_inbound SET cursors = '{}', plan_at = NULL, initial_done_at = NULL WHERE user_id = ?`).run(w.id);
    await pass(w.id);
    expect(await snapshot()).toEqual(first);
    expect(first).toMatchObject({ contacts: 3, companies: 3, deals: 2, links: 8, pipelines: 2 });
  });

  it('una página que se corta a mitad (el proceso muere) se vuelve a escribir entera sin duplicar', async () => {
    const w = await started('hsin-crash');
    // La lectura de asociaciones de contactos falla una vez: la página de contactos no se guarda.
    portal.fail(500, 3, { path: '/associations/contacts/companies' });
    await due(w.id);
    for (let i = 0; i < 20; i++) {
      const r = await runInboundStep(w.id, { budgetMs: 30_000 });
      if (r === 'retrying') break;
    }
    expect((await getInbound(w.id)).state).toBe('retrying');
    await pass(w.id);
    expect(await count('crm_contacts', 'user_id = ?', w.id)).toBe(3);
    expect(await count('crm_hubspot_links', `user_id = ? AND object = 'contact'`, w.id)).toBe(3);
  });
});

describe('cursor incremental', () => {
  it('cada vuelta pide solo lo modificado desde la anterior (con margen) y aplica lo nuevo', async () => {
    const w = await started('hsin-incr');
    await pass(w.id);
    const before = await getInbound(w.id);
    portal.edit('contacts', '4001', { jobtitle: 'COO' });
    const newId = portal.add('contacts', { firstname: 'Nuevo', lastname: 'Contacto', email: 'nuevo@fresh.example' });
    portal.calls.length = 0;
    await pass(w.id);
    const searches = portal.calls.filter((c) => c.path === '/crm/v3/objects/contacts/search');
    expect(searches.length).toBeGreaterThan(0);
    const filter = (searches[0].body as { filterGroups?: Array<{ filters: Array<{ propertyName: string; operator: string; value: string }> }> }).filterGroups?.[0]?.filters[0];
    expect(filter).toMatchObject({ propertyName: 'lastmodifieddate', operator: 'GTE' });
    expect(Number(filter!.value)).toBeGreaterThan(0);
    const contacts = await contactsOf(w.id);
    expect(contacts.find((c) => c.email.startsWith('mara'))!.job_title).toBe('COO');
    expect(contacts.some((c) => c.email === 'nuevo@fresh.example')).toBe(true);
    const after = await getInbound(w.id);
    // Solo los dos cambiados cuentan; lo releído por el margen sin cambios no.
    expect(after.counts.contacts!.read - before.counts.contacts!.read).toBe(2);
    expect(after.counts.contacts!.created - before.counts.contacts!.created).toBe(1);
    expect(await one(`SELECT state FROM crm_hubspot_links WHERE user_id = ? AND hubspot_id = ?`, w.id, newId)).toEqual({ state: 'linked' });
  });
});

describe('regla de conflictos', () => {
  it('HubSpot gana en lo que no se tocó acá; lo editado acá queda; si cambió de los dos lados queda lo nuestro y se anota', async () => {
    const w = await started('hsin-conflict');
    await pass(w.id);
    const mara = (await contactsOf(w.id)).find((c) => c.email.startsWith('mara'))!;
    // Acá: cambia el cargo (que HubSpot también cambia) y la ciudad (que HubSpot no toca).
    await db().prepare(`UPDATE crm_contacts SET job_title = 'Founder', city = 'Lujan', updated_at = datetime('now') WHERE id = ?`).run(mara.id);
    // En HubSpot: cargo y teléfono.
    portal.edit('contacts', '4001', { jobtitle: 'CTO', phone: '+54 261 555 0999' });
    await pass(w.id);
    const row = (await one<{ job_title: string; city: string; phone: string }>('SELECT job_title, city, phone FROM crm_contacts WHERE id = ?', mara.id))!;
    expect(row).toEqual({ job_title: 'Founder', city: 'Lujan', phone: '+54 261 555 0999' });
    expect(await one('SELECT fields FROM crm_hubspot_sync_conflicts WHERE user_id = ? AND record_id = ?', w.id, mara.id)).toEqual({ fields: 'job_title' });
    expect((await getInbound(w.id)).conflicts).toBe(1);
    // HubSpot vuelve a cambiar algo que acá nadie tocó: entra, y el conflicto del cargo sigue.
    portal.edit('contacts', '4001', { firstname: 'Marita' });
    await pass(w.id);
    expect(await one('SELECT first_name, job_title FROM crm_contacts WHERE id = ?', mara.id)).toEqual({ first_name: 'Marita', job_title: 'Founder' });
  });

  it('la regla por campo', () => {
    const shadow = { a: '1', b: '1', c: '1', d: '1' };
    const r = resolve({ a: '2', b: '1', c: '2', d: '1', e: 'x', f: 'y', g: '' }, { a: '1', b: '9', c: '9', d: '1', e: '', f: 'z', g: 'k' }, shadow, { trusted: false });
    expect(r.apply.sort()).toEqual(['a', 'e']);
    expect(r.conflicts.sort()).toEqual(['c', 'f']);
    expect(r.shadow).toMatchObject({ a: '2', b: '1', c: '1', d: '1', e: 'x', g: '' });
    expect(r.shadow.f).toBeUndefined();
    expect(resolve({ f: 'y' }, { f: 'z' }, {}, { trusted: true }).apply).toEqual(['f']);
    // Un valor por defecto nuestro contra un vacío de HubSpot no es un cambio.
    expect(resolve({ lifecycle_stage: '' }, { lifecycle_stage: 'lead' }, {}, { trusted: false })).toMatchObject({ apply: [], conflicts: [] });
  });
});

describe('dueños', () => {
  it('un dueño nuevo en HubSpot renueva el plan y, si es una persona del workspace, el registro queda suyo', async () => {
    const w = await started('hsin-owner');
    await pass(w.id);
    const mate = await makeUser('hsin-owner-mate');
    const team = await createTeam(w.id, 'Sales');
    await addMember(team.id, mate.id, 'member');
    portal.owners.set('90', { id: '90', email: mate.email, firstName: 'New', lastName: 'Rep' });
    portal.edit('contacts', '4003', { hubspot_owner_id: '90' });
    await pass(w.id);
    const bia = (await contactsOf(w.id)).find((c) => !c.email)!;
    expect(bia.owner_id).toBe(mate.id);
  });
});

describe('aislamiento', () => {
  it('dos workspaces conectados a la misma cuenta: cada uno con sus registros y sus vínculos', async () => {
    const a = await connected('hsin-iso-a');
    const b = await connected('hsin-iso-b');
    // En A ya hay un contacto con el email de Mara; B no debe vincularlo ni tocarlo.
    const local = await createContact(a.id, { firstName: 'Mara', lastName: 'Local', email: 'mara@northwind-parts.example' });
    await startInbound(b.id, b.id);
    await pass(b.id);
    expect(await count('crm_contacts', 'user_id = ?', b.id)).toBe(3);
    expect(await count('crm_contacts', 'user_id = ?', a.id)).toBe(1);
    expect(await count('crm_hubspot_links', 'user_id = ?', a.id)).toBe(0);
    expect(await count('crm_hubspot_links', 'user_id = ? AND record_id = ?', b.id, local.id)).toBe(0);
    expect(await one('SELECT last_name FROM crm_contacts WHERE id = ?', local.id)).toEqual({ last_name: 'Local' });
    // A arranca después: su contacto se vincula, sin crear otro.
    await startInbound(a.id, a.id);
    await pass(a.id);
    expect(await count('crm_contacts', 'user_id = ?', a.id)).toBe(3);
    expect((await getInbound(a.id)).linked.contacts).toBe(3);
    // Las vistas no se cruzan.
    expect((await getInbound(b.id)).counts.contacts!.created).toBe(3);
    expect((await getInbound(a.id)).counts.contacts!.created).toBe(2);
  });
});

describe('límites de HubSpot', () => {
  it('ráfaga que no afloja: espera 1 minuto, después 2; una vuelta buena lo vuelve a 0', async () => {
    const w = await started('hsin-rate');
    let now = Date.parse('2026-11-21T12:00:00.000Z');
    const clock = () => now;
    portal.fail(429, 30, { retryAfter: '0' });
    await due(w.id);
    expect(await runInboundStep(w.id, { now: clock })).toBe('retrying');
    let row = (await one<{ next_run_at: string; attempts: number; failure: string }>('SELECT next_run_at, attempts, failure FROM crm_hubspot_inbound WHERE user_id = ?', w.id))!;
    expect(row).toMatchObject({ attempts: 1, failure: 'hubspot_busy' });
    expect(Date.parse(row.next_run_at) - now).toBe(BACKOFF_BASE_MS);
    // Antes de la espera no corre.
    expect(await runInboundStep(w.id, { now: clock })).toBe('not_claimed');
    now += BACKOFF_BASE_MS;
    expect(await runInboundStep(w.id, { now: clock })).toBe('retrying');
    row = (await one<{ next_run_at: string; attempts: number; failure: string }>('SELECT next_run_at, attempts, failure FROM crm_hubspot_inbound WHERE user_id = ?', w.id))!;
    expect(row.attempts).toBe(2);
    expect(Date.parse(row.next_run_at) - now).toBe(2 * BACKOFF_BASE_MS);
    expect(backoffMs(20)).toBe(30 * 60_000);
    expect((await getInbound(w.id)).state).toBe('retrying');
    portal.faults = [];
    await pass(w.id);
    expect(await one('SELECT attempts, failure FROM crm_hubspot_inbound WHERE user_id = ?', w.id)).toEqual({ attempts: 0, failure: '' });
    expect(await count('crm_contacts', 'user_id = ?', w.id)).toBe(3);
  });

  it('límite diario: espera 30 minutos sin gastar intentos', async () => {
    const w = await started('hsin-daily');
    const now = Date.parse('2026-11-21T12:00:00.000Z');
    portal.fail(429, 1, { policyName: 'DAILY' });
    await due(w.id);
    expect(await runInboundStep(w.id, { now: () => now })).toBe('waiting');
    const row = (await one<{ next_run_at: string; attempts: number }>('SELECT next_run_at, attempts FROM crm_hubspot_inbound WHERE user_id = ?', w.id))!;
    expect(row.attempts).toBe(0);
    expect(Date.parse(row.next_run_at) - now).toBe(DAILY_WAIT_MS);
    expect((await getInbound(w.id)).state).toBe('waiting');
  });
});

describe('pausa, objetos, archivados, fusiones y borrados', () => {
  it('pausado no corre; retomar sigue donde quedó', async () => {
    const w = await started('hsin-pause');
    await due(w.id);
    expect(await runInboundStep(w.id, { budgetMs: 30_000, maxPages: 1 })).toBe('progress');
    expect((await setInboundPaused(w.id, w.id, true)).ok).toBe(true);
    expect((await getInbound(w.id)).state).toBe('paused');
    await due(w.id);
    expect(await runInboundStep(w.id)).toBe('paused');
    await processHubspotInbound({ budgetMs: 10_000 });
    const mid = await count('crm_companies', 'user_id = ?', w.id);
    expect(await count('crm_contacts', 'user_id = ?', w.id)).toBe(0);
    expect((await setInboundPaused(w.id, w.id, false)).ok).toBe(true);
    await pass(w.id);
    expect(mid).toBeGreaterThan(0);
    expect(await count('crm_contacts', 'user_id = ?', w.id)).toBe(3);
  });

  it('un objeto apagado no se trae; desconectar apaga el sync', async () => {
    const w = await started('hsin-objects');
    await setInboundObjects(w.id, { deals: false });
    await pass(w.id);
    expect(await count('crm_deals', 'user_id = ?', w.id)).toBe(0);
    expect(await count('crm_contacts', 'user_id = ?', w.id)).toBe(3);
    await disconnectSync(w.id, w.id);
    expect((await getInbound(w.id)).state).toBe('off');
    await due(w.id);
    expect(await runInboundStep(w.id)).toBe('not_claimed');
  });

  it('archivado en HubSpot: el vínculo queda marcado y el registro de acá no se borra; si vuelve, se vuelve a vincular', async () => {
    const w = await started('hsin-archive');
    await pass(w.id);
    portal.archive('contacts', '4002');
    await db().prepare('UPDATE crm_hubspot_inbound SET sweep_at = NULL WHERE user_id = ?').run(w.id);
    await pass(w.id);
    expect(await one(`SELECT state FROM crm_hubspot_links WHERE user_id = ? AND hubspot_id = '4002'`, w.id)).toEqual({ state: 'archived' });
    expect(await count('crm_contacts', 'user_id = ?', w.id)).toBe(3);
    expect((await getInbound(w.id)).linked.archived).toBe(1);
    portal.restore('contacts', '4002');
    await pass(w.id);
    expect(await one(`SELECT state FROM crm_hubspot_links WHERE user_id = ? AND hubspot_id = '4002'`, w.id)).toEqual({ state: 'linked' });
  });

  it('fusión en HubSpot de dos contactos vinculados: se anota para fusionar acá, sin borrar ninguno', async () => {
    const w = await started('hsin-merge');
    await pass(w.id);
    portal.merge('contacts', '4003', '4002');
    await pass(w.id);
    expect(await count('crm_contacts', 'user_id = ?', w.id)).toBe(3);
    expect(await one(`SELECT state FROM crm_hubspot_links WHERE user_id = ? AND hubspot_id = '4003'`, w.id)).toEqual({ state: 'merged' });
    expect(await count('crm_hubspot_sync_conflicts', `user_id = ? AND kind = 'merge'`, w.id)).toBe(1);
  });

  it('un registro vinculado que se borró acá no se vuelve a crear', async () => {
    const w = await started('hsin-deleted');
    await pass(w.id);
    const joel = (await contactsOf(w.id)).find((c) => c.email.startsWith('joel'))!;
    await db().prepare('DELETE FROM crm_contacts WHERE id = ?').run(joel.id);
    portal.edit('contacts', '4002', { jobtitle: 'Back' });
    await pass(w.id);
    expect(await count('crm_contacts', 'user_id = ?', w.id)).toBe(2);
    expect(await one(`SELECT state FROM crm_hubspot_links WHERE user_id = ? AND record_id = ?`, w.id, joel.id)).toEqual({ state: 'deleted_here' });
  });
});

describe('actividades', () => {
  it('notas, tareas y llamadas entran a la actividad del registro y se actualizan', async () => {
    const w = await started('hsin-acts');
    const note = portal.add('notes', { hs_note_body: '<p>Called about <b>renewal</b></p>', hs_timestamp: '2026-11-01T10:00:00.000Z' });
    portal.associate('notes', note, 'contacts', '4001');
    const call = portal.add('calls', { hs_call_title: 'Intro', hs_call_direction: 'OUTBOUND', hs_call_duration: '300000', hs_timestamp: '2026-11-02T10:00:00.000Z' });
    portal.associate('calls', call, 'deals', '6001');
    portal.add('tasks', { hs_task_subject: 'Loose task', hs_task_status: 'NOT_STARTED', hs_timestamp: '2027-01-02T10:00:00.000Z' });
    // Sin registro donde mostrarla: una nota suelta no entra.
    portal.add('notes', { hs_note_body: 'orphan', hs_timestamp: '2026-11-01T10:00:00.000Z' });
    await pass(w.id);
    const acts = await all<{ type: string; body: string; subject: string; contact_id: string | null; deal_id: string | null; duration_min: number | null; direction: string; done: number }>(
      'SELECT * FROM crm_activities WHERE user_id = ? ORDER BY type',
      w.id,
    );
    expect(acts.map((a) => a.type)).toEqual(['call', 'note', 'task']);
    expect(acts[1].body).toBe('Called about renewal');
    expect(acts[1].contact_id).toBeTruthy();
    expect(acts[0]).toMatchObject({ subject: 'Intro', direction: 'outbound', duration_min: 5 });
    expect(acts[0].deal_id).toBeTruthy();
    expect(acts[2].done).toBe(0);
    portal.edit('tasks', [...portal.objects.tasks.keys()][0], { hs_task_status: 'COMPLETED' });
    await pass(w.id);
    expect(await one(`SELECT done FROM crm_activities WHERE user_id = ? AND type = 'task'`, w.id)).toEqual({ done: 1 });
    expect(await count('crm_activities', 'user_id = ?', w.id)).toBe(3);
  });
});

describe('nada sensible en logs ni en el estado', () => {
  it('sin clave, nombres ni emails en la consola ni en lo que guarda la fila; los errores son códigos', async () => {
    const lines: string[] = [];
    for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' ')));
    const w = await started('hsin-logs');
    portal.fail(500, 3, { path: '/objects/contacts/search' });
    await due(w.id);
    for (let i = 0; i < 20 && (await runInboundStep(w.id, { budgetMs: 30_000 })) !== 'retrying'; i++);
    await pass(w.id);
    // La clave deja de valer: queda bloqueado hasta reconectar.
    portal.grant = () => null;
    portal.edit('contacts', '4001', { jobtitle: 'X' });
    await due(w.id);
    await db().prepare('UPDATE crm_hubspot_inbound SET plan_at = NULL WHERE user_id = ?').run(w.id);
    expect(await runInboundStep(w.id, { budgetMs: 30_000 })).toBe('blocked');
    expect((await getInbound(w.id)).state).toBe('blocked');
    const row = (await one<Record<string, string>>('SELECT counts, errors, failure, cursors FROM crm_hubspot_inbound WHERE user_id = ?', w.id))!;
    const stored = JSON.stringify(row) + JSON.stringify(await getInbound(w.id)) + JSON.stringify(await all('SELECT * FROM crm_hubspot_sync_conflicts WHERE user_id = ?', w.id));
    const out = lines.join('\n') + stored;
    for (const secret of [KEY, 'mara@northwind-parts.example', 'Quiroga', 'Northwind', '+54 261']) expect(out).not.toContain(secret);
    const errors = JSON.parse(row.errors) as Array<{ code: string }>;
    expect(errors.map((e) => e.code)).toEqual(expect.arrayContaining(['provider_error', 'invalid_token']));
    expect(row.failure).toBe('invalid_token');
  });
});

describe('lo que HubSpot no puede decir no borra lo de acá (revisión)', () => {
  it('un valor que no se puede convertir, un dueño que dejó el workspace y una asociación sin leer no vacían nada', async () => {
    const w = await makeUser('hsin-keep');
    const mate = await makeUser('hsin-keep-mate');
    const team = await createTeam(w.id, 'Sales');
    await addMember(team.id, mate.id, 'member');
    expect((await connectSync(w.id, w.id, KEY)).ok).toBe(true);
    portal.owners.get('81')!.email = mate.email;
    const note = portal.add('notes', { hs_note_body: 'Follow up', hs_timestamp: '2026-11-01T10:00:00.000Z' });
    portal.associate('notes', note, 'contacts', '4001');
    await startInbound(w.id, w.id);
    await pass(w.id);
    const mara = (await contactsOf(w.id)).find((c) => c.email.startsWith('mara'))!;
    expect(mara.owner_id).toBe(mate.id);
    expect(JSON.parse(mara.custom)).toEqual({ preferred_language: 'Spanish' });
    // Una opción que nuestro campo no tiene, la persona deja de estar en el plan y los contactos se apagan.
    portal.edit('contacts', '4001', { preferred_language: 'xx-unknown', jobtitle: 'CFO' });
    portal.owners.get('81')!.email = 'someone-else@fake-portal.example';
    await db().prepare('UPDATE crm_hubspot_inbound SET plan_at = NULL WHERE user_id = ?').run(w.id);
    await setInboundObjects(w.id, { contacts: false });
    portal.edit('notes', note, { hs_note_body: 'Follow up again' });
    await pass(w.id);
    await setInboundObjects(w.id, { contacts: true });
    await pass(w.id);
    const after = (await one<{ owner_id: string; custom: string; job_title: string }>('SELECT owner_id, custom, job_title FROM crm_contacts WHERE id = ?', mara.id))!;
    expect(after.job_title).toBe('CFO');
    expect(after.owner_id).toBe(mate.id);
    expect(JSON.parse(after.custom)).toEqual({ preferred_language: 'Spanish' });
    expect(await one(`SELECT body, contact_id FROM crm_activities WHERE user_id = ? AND type = 'note'`, w.id)).toEqual({ body: 'Follow up again', contact_id: mara.id });
  });

  it('un deal en una etapa sin equivalente no se crea en otro pipeline', async () => {
    const w = await started('hsin-stage');
    portal.add('deals', { dealname: 'Old pipeline deal', pipeline: 'gone', dealstage: 'gone_won', amount: '10' });
    await pass(w.id);
    expect(await count('crm_deals', 'user_id = ?', w.id)).toBe(2);
    expect((await getInbound(w.id)).errors.map((e) => e.code)).toContain('stage_unmapped');
  });

  it('un tramo que perdió el turno no pisa el estado del que lo tomó', async () => {
    const w = await started('hsin-lock');
    await due(w.id);
    // Otro proceso toma la fila mientras este lee de HubSpot (se pasó de su turno).
    const fake = portal as unknown as { handle: (url: string, init?: RequestInit) => Promise<Response> };
    const original = fake.handle.bind(portal);
    let stolen = false;
    fake.handle = async (url, init) => {
      if (!stolen && String(url).includes('/objects/companies/search')) {
        stolen = true;
        await db().prepare(`UPDATE crm_hubspot_inbound SET locked_until = '2999-01-01T00:00:00.000Z' WHERE user_id = ?`).run(w.id);
      }
      return original(url, init);
    };
    const r = await runInboundStep(w.id, { budgetMs: 30_000 });
    fake.handle = original;
    expect(stolen).toBe(true);
    // Nada de esta página quedó: ni registros ni el cursor.
    expect(await count('crm_companies', 'user_id = ?', w.id)).toBe(0);
    expect(['not_claimed', 'progress']).toContain(r);
    expect(await one('SELECT locked_until FROM crm_hubspot_inbound WHERE user_id = ?', w.id)).toEqual({ locked_until: '2999-01-01T00:00:00.000Z' });
  });
});

describe('fusión después del import (revisión)', () => {
  it('un contacto importado desde un registro que HubSpot fusionó en otro se vincula al que quedó, sin duplicar', async () => {
    const w = await connected('hsin-merged-import');
    const x = await createContact(w.id, { firstName: 'Bia', lastName: 'Nunes', email: 'bia@merge.example' });
    await db().prepare(`INSERT INTO crm_external_ids (user_id, provider, object, external_id, record_id, imported_at) VALUES (?, 'hubspot', 'contact', '4003', ?, datetime('now'))`).run(w.id, x.id);
    portal.edit('contacts', '4002', { email: 'bia@merge.example' });
    portal.merge('contacts', '4003', '4002');
    await startInbound(w.id, w.id);
    await pass(w.id);
    expect(await count('crm_contacts', 'user_id = ?', w.id)).toBe(2);
    expect(await one(`SELECT record_id FROM crm_hubspot_links WHERE user_id = ? AND hubspot_id = '4002'`, w.id)).toEqual({ record_id: x.id });
  });
});
