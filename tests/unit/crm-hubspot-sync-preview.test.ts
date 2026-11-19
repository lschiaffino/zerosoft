import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import os from 'os';
import path from 'path';
import { getDb } from '@/lib/db';
import { createCompany, createContact, createCustomField, createDeal, createPipeline } from '@/lib/crm';
import { MIGRATIONS } from '@/lib/schema/migrations';
import { resetFakeHubspotPortal, seedSyncPortal, type FakeHubspotPortal } from '@/lib/hubspot/fake-portal';
import { connectSync, disconnectSync, getSyncSettings, getSyncStatus, syncGate } from '@/lib/crm-hubspot-sync/connection';
import { cancelPreview, getPreview, processHubspotPreviews, runPreviewStep, startPreview, sweepOrphanRows } from '@/lib/crm-hubspot-sync/preview';
import type { ObjectReport, PreviewReport } from '@/lib/crm-hubspot-sync/types';
import { makeUser } from './helpers';

/**
 * Sync CRM ↔ HubSpot: la vista previa. Cada grupo del informe, la corrida por
 * tramos, cancelar, el límite diario y que nada se escribe (ni en HubSpot ni
 * en el CRM). Contra la cuenta falsa de lib/hubspot/fake-portal.ts
 * (seedSyncPortal: dos empresas con el mismo dominio y un contacto sin email).
 */

// Una private app heredada: HubSpot informa sus permisos, así que conectar no prueba nada con un PATCH.
const KEY = 'pat-na1-preview-legacy';
let portal: FakeHubspotPortal;

beforeEach(() => {
  vi.stubEnv('CRM_IMPORT_FAKE', '1');
  portal = resetFakeHubspotPortal('crm', seedSyncPortal);
});

const sql = (q: string, ...args: Array<string | number | null>) => getDb().prepare(q).run(...args);
const count = async (table: string, where: string, ...args: string[]) => Number(((await getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args)) as { n: number }).n);

async function workspace(label: string) {
  const owner = await makeUser(label);
  const res = await connectSync(owner.id, owner.id, KEY);
  expect(res.ok).toBe(true);
  return owner;
}

/** Vincula como lo deja el importador: id de HubSpot → registro nuestro. */
const imported = (ws: string, object: string, hubspotId: string, recordId: string) =>
  sql(`INSERT INTO crm_external_ids (user_id, provider, object, external_id, record_id) VALUES (?, 'hubspot', ?, ?, ?)`, ws, object, hubspotId, recordId);

async function runToEnd(ws: string, opts: { maxPages?: number; pageSize?: number } = {}): Promise<{ steps: number; report: PreviewReport }> {
  const started = await startPreview(ws, ws);
  expect(started.ok).toBe(true);
  let steps = 0;
  for (; steps < 400; steps++) {
    const r = await runPreviewStep(ws, { budgetMs: 30_000, ...opts });
    if (r === 'done') break;
    expect(r).toBe('progress');
  }
  const view = (await getPreview(ws))!;
  expect(view.status).toBe('done');
  return { steps: steps + 1, report: view.report! };
}

const labels = (r: ObjectReport, bucket: keyof ObjectReport['counts']) => (r.samples[bucket] ?? []).map((s) => s.label);

describe('vista previa sobre la cuenta sembrada', () => {
  it('conteos, coincidencias por email y dominio, lo que se crearía de cada lado, lo ambiguo y lo que no se puede emparejar', async () => {
    const owner = await workspace('hsprev');
    const ws = owner.id;
    // Un dueño de HubSpot es una persona del workspace; el otro no.
    portal.owners.get('81')!.email = owner.email.toUpperCase();

    // Contactos: uno con el email de Mara en otras mayúsculas y con espacios, uno solo nuestro y uno sin email.
    const mara = await createContact(ws, { firstName: 'Mara', lastName: 'Q.', email: 'Mara@Northwind-Parts.example', jobTitle: 'CEO' });
    await sql('UPDATE crm_contacts SET email = ? WHERE id = ?', '  Mara@Northwind-Parts.example ', mara.id);
    await createContact(ws, { firstName: 'Only', lastName: 'Here', email: 'only-here@zs-side.example' });
    await createContact(ws, { firstName: 'No', lastName: 'Email' });
    // Empresas: el dominio de Northwind escrito como URL, el de Tallgrass (dos en HubSpot), una solo nuestra y una sin dominio.
    const northwind = await createCompany(ws, { name: 'Northwind Parts', domain: 'https://www.Northwind-Parts.example/about', city: 'San Rafael' });
    const tallgrass = await createCompany(ws, { name: 'Tallgrass Labs', domain: 'tallgrass-labs.example' });
    await createCompany(ws, { name: 'Only Here Co', domain: 'only-here.example' });
    await createCompany(ws, { name: 'No Domain Co' });
    // Negocios: uno importado de HubSpot (6001) en otra etapa, uno solo nuestro y uno importado que HubSpot ya no tiene.
    const pipe = await createPipeline(ws, 'Sales pipeline');
    await sql(`INSERT INTO crm_stages (id, pipeline_id, name, probability, position, is_won, is_lost) VALUES (?, ?, 'Appointment scheduled', 20, 0, 0, 0)`, `${pipe.id}-s1`, pipe.id);
    await sql(`INSERT INTO crm_stages (id, pipeline_id, name, probability, position, is_won, is_lost) VALUES (?, ?, 'Contract sent', 80, 1, 0, 0)`, `${pipe.id}-s2`, pipe.id);
    await sql(`INSERT INTO crm_stages (id, pipeline_id, name, probability, position, is_won, is_lost) VALUES (?, ?, 'Legal review', 90, 2, 0, 0)`, `${pipe.id}-s3`, pipe.id);
    await createPipeline(ws, 'Partners');
    const deal = async (name: string, amount: number) => {
      const r = await createDeal(ws, { pipelineId: pipe.id, stageId: `${pipe.id}-s1`, name, amount, currency: 'USD' });
      if (!r.ok) throw new Error(r.reason);
      return r.deal;
    };
    const d1 = await deal('Northwind annual plan', 18000);
    await deal('Only here deal', 500);
    const d3 = await deal('Gone in HubSpot', 700);
    await imported(ws, 'deal', '6001', d1.id);
    await imported(ws, 'deal', '99999', d3.id);
    // Campos propios: uno que HubSpot también tiene (segment) y uno solo nuestro.
    await createCustomField(ws, { entity: 'companies', name: 'segment', label: 'Segment', type: 'select', options: ['SMB'] });
    await createCustomField(ws, { entity: 'contacts', name: 'internal_code', label: 'Internal code', type: 'text' });

    const before = {
      contacts: await getDb().prepare('SELECT id, email, updated_at FROM crm_contacts WHERE user_id = ? ORDER BY id').all(ws),
      companies: await getDb().prepare('SELECT id, domain, updated_at FROM crm_companies WHERE user_id = ? ORDER BY id').all(ws),
      deals: await getDb().prepare('SELECT id, stage_id, amount, updated_at FROM crm_deals WHERE user_id = ? ORDER BY id').all(ws),
      external: await count('crm_external_ids', 'user_id = ?', ws),
      hubspot: JSON.stringify([...portal.contacts.values(), ...portal.companies.values(), ...portal.deals.values()]),
    };
    portal.calls.length = 0;

    const { report } = await runToEnd(ws);

    const c = report.objects.contacts!;
    expect([c.hubspot, c.zerosoft]).toEqual([3, 3]);
    expect(c.counts).toMatchObject({ linked: 0, matched: 1, create_zerosoft: 1, create_hubspot: 1, update: 1, no_key_hubspot: 1, no_key_zerosoft: 1, multi_hubspot: 0, multi_zerosoft: 0, conflict: 0, gone_hubspot: 0 });
    expect(labels(c, 'matched')).toEqual(['Mara Quiroga']);
    expect(c.samples.matched![0]).toMatchObject({ hubspotId: '4001', zerosoftId: mara.id, detail: 'mara@northwind-parts.example' });
    expect(labels(c, 'create_zerosoft')).toEqual(['Joel Hart']);
    expect(labels(c, 'no_key_hubspot')).toEqual(['Bia Nunes']);
    expect(labels(c, 'create_hubspot')).toEqual(['Only Here']);
    expect(labels(c, 'no_key_zerosoft')).toEqual(['No Email']);
    // Mara: el apellido choca, el teléfono y el cargo están de un solo lado. El lifecycle 'lead' nuestro es el valor por defecto... pero HubSpot dice customer.
    expect(c.samples.update![0]).toMatchObject({ label: 'Mara Quiroga', conflicting: ['last_name', 'lifecycle_stage'], filling: ['phone', 'job_title'] });
    expect(c.update.conflicting).toBe(1);

    const co = report.objects.companies!;
    expect([co.hubspot, co.zerosoft]).toEqual([3, 4]);
    expect(co.counts).toMatchObject({ matched: 1, multi_hubspot: 2, create_zerosoft: 0, create_hubspot: 1, no_key_zerosoft: 1, no_key_hubspot: 0, update: 1 });
    expect(co.samples.matched![0]).toMatchObject({ label: 'Northwind Parts', hubspotId: '3001', zerosoftId: northwind.id });
    // HubSpot no deduplica dominios: las dos Tallgrass quedan para que alguien decida.
    expect(labels(co, 'multi_hubspot').sort()).toEqual(['Tallgrass Labs', 'Tallgrass Labs (EU)']);
    expect(co.samples.multi_hubspot!.every((s) => s.zerosoftId === tallgrass.id)).toBe(true);
    expect(labels(co, 'create_hubspot')).toEqual(['Only Here Co']);
    expect(labels(co, 'no_key_zerosoft')).toEqual(['No Domain Co']);
    expect(co.samples.update![0].conflicting).toEqual(['city']);

    const d = report.objects.deals!;
    expect([d.hubspot, d.zerosoft]).toEqual([2, 3]);
    expect(d.counts).toMatchObject({ linked: 1, matched: 0, create_zerosoft: 1, create_hubspot: 1, gone_hubspot: 1, update: 1 });
    expect(d.samples.linked![0]).toMatchObject({ hubspotId: '6001', zerosoftId: d1.id });
    expect(labels(d, 'create_zerosoft')).toEqual(['Tallgrass pilot']);
    expect(d.samples.create_hubspot![0]).toMatchObject({ label: 'Only here deal', detail: '500 USD' });
    expect(labels(d, 'gone_hubspot')).toEqual(['Gone in HubSpot']);
    // 6001 está en "Contract sent" en HubSpot y en "Appointment scheduled" acá.
    expect(d.samples.update![0].conflicting).toEqual(['stage_id']);

    // Dueños, pipelines y propiedades.
    expect(report.owners).toMatchObject({ hubspot: 2, zerosoft: 1, matched: 1, hubspotOnlyTotal: 1, zerosoftOnlyTotal: 0, archived: 1 });
    expect(report.owners!.hubspotOnly).toEqual([{ name: 'Teo Rojas', email: 'teo@fake-portal.example' }]);
    const pipes = report.pipelines!;
    expect(pipes.hubspot.map((p) => [p.name, p.match])).toEqual([
      ['Sales pipeline', 'Sales pipeline'],
      ['Renewals', null],
    ]);
    expect(pipes.hubspot[0].stages.filter((s) => !s.matched).map((s) => s.name)).toEqual(['Closed won', 'Closed lost']);
    expect(pipes.zerosoftOnly.map((p) => p.name)).toEqual(['Partners']);
    expect(pipes.zerosoftOnlyStages).toEqual([{ pipeline: 'Sales pipeline', stage: 'Legal review' }]);
    const props = report.properties!;
    expect(props.contacts!.hubspotOnly).toEqual([{ name: 'preferred_language', label: 'Preferred language' }]);
    expect(props.contacts!.zerosoftOnly).toEqual([{ name: 'internal_code', label: 'Internal code' }]);
    expect(props.contacts!.standard).toContain('email');
    expect(props.companies).toMatchObject({ customMatched: 1, hubspotOnlyTotal: 0, zerosoftOnlyTotal: 0 });
    expect(props.deals!.hubspotOnly.map((p) => p.name)).toEqual(['renewal_type']);
    expect(props.contacts!.hubspotBuiltIn).toBeGreaterThan(0);

    // No escribió nada: ni en el CRM, ni vínculos, ni en HubSpot. Y a HubSpot solo le leyó.
    expect(await getDb().prepare('SELECT id, email, updated_at FROM crm_contacts WHERE user_id = ? ORDER BY id').all(ws)).toEqual(before.contacts);
    expect(await getDb().prepare('SELECT id, domain, updated_at FROM crm_companies WHERE user_id = ? ORDER BY id').all(ws)).toEqual(before.companies);
    expect(await getDb().prepare('SELECT id, stage_id, amount, updated_at FROM crm_deals WHERE user_id = ? ORDER BY id').all(ws)).toEqual(before.deals);
    expect(await count('crm_external_ids', 'user_id = ?', ws)).toBe(before.external);
    expect(await count('crm_hubspot_links', 'user_id = ?', ws)).toBe(0);
    expect(JSON.stringify([...portal.contacts.values(), ...portal.companies.values(), ...portal.deals.values()])).toBe(before.hubspot);
    expect(portal.calls.length).toBeGreaterThan(5);
    for (const call of portal.calls) expect(call.method === 'GET' || (call.method === 'POST' && call.path.endsWith('/search')), `${call.method} ${call.path}`).toBe(true);
    // La tabla de trabajo se borra al terminar: queda solo el informe.
    expect(await count('crm_hubspot_preview_rows', 'preview_id IN (SELECT id FROM crm_hubspot_previews WHERE user_id = ?)', ws)).toBe(0);
    // El sync sigue apagado.
    expect(await getSyncSettings(ws)).toEqual({ enabled: false, direction: 'hubspot_to_zerosoft', paused: false });
    expect(await syncGate(ws)).toEqual({ run: false, reason: 'off' });
  });

  it('con el CRM vacío todo se crearía en zerosoft, menos lo que HubSpot tiene repetido o sin email', async () => {
    const owner = await workspace('hsprev-empty');
    const { report } = await runToEnd(owner.id);
    expect(report.objects.contacts!.counts).toMatchObject({ create_zerosoft: 2, no_key_hubspot: 1, matched: 0, create_hubspot: 0 });
    expect(report.objects.companies!.counts).toMatchObject({ create_zerosoft: 1, multi_hubspot: 2 });
    expect(labels(report.objects.companies!, 'multi_hubspot').sort()).toEqual(['Tallgrass Labs', 'Tallgrass Labs (EU)']);
    expect(report.objects.deals!.counts).toMatchObject({ create_zerosoft: 2, linked: 0 });
    expect(report.objects.contacts!.zerosoft).toBe(0);
  });
});

describe('los demás grupos', () => {
  it('varios nuestros con el mismo email, vínculo que choca con el email, dos de HubSpot en uno nuestro, fusionados, email secundario y vínculo a un registro borrado', async () => {
    const owner = await workspace('hsprev-edge');
    const ws = owner.id;
    const insert = (id: string, email: string, first: string) =>
      sql(`INSERT INTO crm_contacts (id, user_id, owner_id, first_name, last_name, email, lifecycle_stage, lead_status, custom) VALUES (?, ?, ?, ?, 'Edge', ?, 'lead', 'new', '{}')`, id, ws, ws, first, email);
    // Duplicados de antes de la regla de un contacto por email: dos con el email de Joel (4002).
    await insert(`${ws}-j1`, 'joel@tallgrass-labs.example', 'JoelOne');
    await insert(`${ws}-j2`, 'JOEL@tallgrass-labs.example', 'JoelTwo');
    // Mara (4001) vino de un import y quedó en un contacto con otro email; otro contacto nuestro tiene el suyo.
    await insert(`${ws}-m1`, 'old-address@northwind-parts.example', 'MaraLinked');
    await insert(`${ws}-m2`, 'mara@northwind-parts.example', 'MaraOther');
    await imported(ws, 'contact', '4001', `${ws}-m1`);
    // Un contacto de HubSpot con email secundario: el nuestro tiene el secundario.
    portal.add('contacts', { firstname: 'Alt', lastname: 'Mail', email: 'main@alt.example', hs_additional_emails: 'second@alt.example;third@alt.example' }, '4010');
    await insert(`${ws}-a1`, 'Second@alt.example', 'AltLocal');
    // HubSpot fusionó 4020 en 4021: el vínculo viejo sigue valiendo.
    portal.add('contacts', { firstname: 'Merged', lastname: 'Kept', email: 'kept@merge.example', hs_merged_object_ids: '4020' }, '4021');
    await insert(`${ws}-g1`, 'someone-else@merge.example', 'MergedLocal');
    await imported(ws, 'contact', '4020', `${ws}-g1`);
    // Vínculo de un import a un registro que ya se borró de este lado: se empareja de nuevo por email.
    portal.add('contacts', { firstname: 'Dangling', lastname: 'Link', email: 'dangling@link.example' }, '4030');
    await imported(ws, 'contact', '4030', 'deleted-record-id');
    // Un vínculo del sync manda sobre el del importador.
    portal.add('contacts', { firstname: 'Sync', lastname: 'Wins', email: 'sync@wins.example' }, '4040');
    await insert(`${ws}-s1`, 'x1@wins.example', 'ByImport');
    await insert(`${ws}-s2`, 'x2@wins.example', 'BySync');
    await imported(ws, 'contact', '4040', `${ws}-s1`);
    await sql(`INSERT INTO crm_hubspot_links (user_id, object, record_id, portal_id, hubspot_id) VALUES (?, 'contact', ?, '515151', '4040')`, ws, `${ws}-s2`);
    // Las dos Tallgrass de HubSpot quedaron en una sola empresa nuestra en un import.
    const tall = await createCompany(ws, { name: 'Tallgrass Labs', domain: 'tallgrass-labs.example' });
    await imported(ws, 'company', '3002', tall.id);
    await imported(ws, 'company', '3003', tall.id);
    // Y otra empresa nuestra con ese mismo dominio.
    await createCompany(ws, { name: 'Tallgrass copy', domain: 'www.tallgrass-labs.example' });
    // Dos empresas nuestras con el dominio de Northwind.
    await createCompany(ws, { name: 'Northwind A', domain: 'northwind-parts.example' });
    await createCompany(ws, { name: 'Northwind B', domain: 'NORTHWIND-PARTS.example' });

    const { report } = await runToEnd(ws);
    const c = report.objects.contacts!;
    expect(c.hubspot).toBe(7);
    expect(c.counts).toMatchObject({ multi_zerosoft: 1, conflict: 1, matched: 1, linked: 2, create_zerosoft: 1, no_key_hubspot: 1, duplicate_zerosoft: 3 });
    expect(labels(c, 'multi_zerosoft')).toEqual(['Joel Hart']);
    expect(c.samples.conflict![0]).toMatchObject({ label: 'Mara Quiroga', zerosoftId: `${ws}-m1` });
    expect(c.samples.matched![0]).toMatchObject({ label: 'Alt Mail', zerosoftId: `${ws}-a1` });
    expect(c.samples.linked!.map((s) => [s.hubspotId, s.zerosoftId]).sort()).toEqual([
      ['4021', `${ws}-g1`],
      ['4040', `${ws}-s2`],
    ]);
    expect(labels(c, 'create_zerosoft')).toEqual(['Dangling Link']);
    // Los dos Joel y el otro contacto con el email de Mara: repetidos de este lado.
    expect(labels(c, 'duplicate_zerosoft').sort()).toEqual(['JoelOne Edge', 'JoelTwo Edge', 'MaraOther Edge']);
    // El que quedó con el vínculo viejo del importador (4040 → s1) ya no tiene par: iría a HubSpot... pero figura como importado.
    expect(c.counts.gone_hubspot).toBe(1);
    expect(labels(c, 'gone_hubspot')).toEqual(['ByImport Edge']);
    // Las cuentas cierran: cada contacto nuestro está en un solo grupo.
    const mine = c.counts.matched + c.counts.linked + c.counts.conflict + c.counts.duplicate_zerosoft + c.counts.gone_hubspot + c.counts.create_hubspot + c.counts.no_key_zerosoft;
    expect(mine).toBe(c.zerosoft);

    const co = report.objects.companies!;
    expect(co.counts).toMatchObject({ multi_hubspot: 2, multi_zerosoft: 1, duplicate_zerosoft: 3, linked: 0, matched: 0 });
    expect(labels(co, 'multi_zerosoft')).toEqual(['Northwind Parts']);
    expect(labels(co, 'duplicate_zerosoft').sort()).toEqual(['Northwind A', 'Northwind B', 'Tallgrass copy']);
  });

  it('vínculos de otra cuenta de HubSpot no cuentan', async () => {
    const owner = await workspace('hsprev-portal');
    const ws = owner.id;
    const c = await createContact(ws, { firstName: 'Other', lastName: 'Portal', email: 'other@portal.example' });
    await sql(`INSERT INTO crm_hubspot_links (user_id, object, record_id, portal_id, hubspot_id) VALUES (?, 'contact', ?, '999999', '4002')`, ws, c.id);
    const { report } = await runToEnd(ws);
    expect(report.objects.contacts!.counts).toMatchObject({ linked: 0, create_zerosoft: 2, create_hubspot: 1 });
  });
});

describe('por tramos', () => {
  async function bigPortal(n: number) {
    for (let i = 0; i < n; i++) portal.add('contacts', { firstname: `Bulk${i}`, lastname: 'Person', email: `bulk${i}@bulk.example` }, String(70_000 + i));
  }

  it('de a una página por tramo da el mismo informe que de corrido, y pagina sin pasar el tope de la búsqueda', async () => {
    await bigPortal(57);
    portal.searchCap = 30;
    const a = await workspace('hsprev-steps');
    const b = await workspace('hsprev-steps');
    for (const ws of [a.id, b.id]) {
      for (let i = 0; i < 12; i++) await sql(`INSERT INTO crm_contacts (id, user_id, owner_id, first_name, last_name, email, lifecycle_stage, lead_status, custom) VALUES (?, ?, ?, ?, 'Person', ?, 'lead', 'new', '{}')`, `${ws}-b${i}`, ws, ws, `Bulk${i}`, `BULK${i}@bulk.example`);
    }
    const whole = await runToEnd(a.id, { pageSize: 10 });
    const stepped = await runToEnd(b.id, { pageSize: 10, maxPages: 1 });
    expect(whole.steps).toBe(1);
    expect(stepped.steps).toBeGreaterThan(12);
    const strip = (r: PreviewReport) => JSON.parse(JSON.stringify(r).replaceAll(a.id, 'WS').replaceAll(b.id, 'WS')) as PreviewReport;
    expect(strip(stepped.report)).toEqual(strip(whole.report));
    expect(whole.report.objects.contacts).toMatchObject({ hubspot: 60, zerosoft: 12 });
    expect(whole.report.objects.contacts!.counts).toMatchObject({ matched: 12, create_zerosoft: 47, no_key_hubspot: 1 });
    expect(whole.report.objects.contacts!.samples.create_zerosoft).toHaveLength(10);
  });

  it('muestra el avance mientras corre y se puede retomar desde otra corrida', async () => {
    await bigPortal(30);
    const owner = await workspace('hsprev-progress');
    await startPreview(owner.id, owner.id);
    expect((await getPreview(owner.id))!).toMatchObject({ status: 'queued', report: null });
    // schema, empresas nuestras y dos páginas de contactos.
    for (let i = 0; i < 4; i++) expect(await runPreviewStep(owner.id, { maxPages: 1, pageSize: 10 })).toBe('progress');
    const mid = (await getPreview(owner.id))!;
    expect(mid.status).toBe('running');
    expect(mid.progress.stage).toBe('contacts');
    expect(mid.progress.objects.contacts).toEqual({ read: 20, total: 33 });
    expect(mid.report).toBeNull();
    // El cron la sigue con la pestaña cerrada.
    for (let i = 0; i < 20 && (await getPreview(owner.id))!.status !== 'done'; i++) await processHubspotPreviews({ budgetMs: 20_000 });
    const done = (await getPreview(owner.id))!;
    expect(done.status).toBe('done');
    expect(done.report!.objects.contacts!.hubspot).toBe(33);
    expect(done.progress.objects.contacts).toEqual({ read: 33, total: 33 });
  });

  it('dos corridas a la vez: una sola reclama', async () => {
    const owner = await workspace('hsprev-claim');
    await startPreview(owner.id, owner.id);
    const results = await Promise.all([runPreviewStep(owner.id, { maxPages: 1 }), runPreviewStep(owner.id, { maxPages: 1 })]);
    expect(results.sort()).toEqual(['not_claimed', 'progress']);
    await cancelPreview(owner.id);
  });

  it('cancelar corta, borra la tabla de trabajo y no deja nada corriendo', async () => {
    await bigPortal(20);
    const owner = await workspace('hsprev-cancel');
    await startPreview(owner.id, owner.id);
    for (let i = 0; i < 3; i++) await runPreviewStep(owner.id, { maxPages: 1, pageSize: 10 });
    expect(await count('crm_hubspot_preview_rows', 'preview_id IN (SELECT id FROM crm_hubspot_previews WHERE user_id = ?)', owner.id)).toBeGreaterThan(0);
    expect(await cancelPreview(owner.id)).toBe(true);
    expect((await getPreview(owner.id))!).toMatchObject({ status: 'cancelled', report: null });
    expect(await count('crm_hubspot_preview_rows', 'preview_id IN (SELECT id FROM crm_hubspot_previews WHERE user_id = ?)', owner.id)).toBe(0);
    expect(await runPreviewStep(owner.id)).toBe('not_claimed');
    expect(await cancelPreview(owner.id)).toBe(false);
    // Arrancar otra reemplaza la cancelada (una por workspace).
    const { report } = await runToEnd(owner.id);
    expect(report.objects.contacts!.hubspot).toBe(23);
    expect(await count('crm_hubspot_previews', 'user_id = ?', owner.id)).toBe(1);
  });

  it('reemplazar una vista previa a mitad de un tramo no deja filas de la anterior; las huérfanas se limpian', async () => {
    await bigPortal(20);
    const owner = await workspace('hsprev-replace');
    await startPreview(owner.id, owner.id);
    for (let i = 0; i < 3; i++) await runPreviewStep(owner.id, { maxPages: 1, pageSize: 10 });
    const first = (await getPreview(owner.id))!.id;
    // Un tramo en curso y, mientras tanto, alguien arranca otra.
    const step = runPreviewStep(owner.id, { pageSize: 5 });
    await startPreview(owner.id, owner.id);
    expect(['cancelled', 'progress', 'done']).toContain(await step);
    expect((await getPreview(owner.id))!.id).not.toBe(first);
    expect(await count('crm_hubspot_preview_rows', 'preview_id = ?', first)).toBe(0);
    // Filas de una vista previa que ya no existe (un proceso que murió): el cron las saca.
    await sql(`INSERT INTO crm_hubspot_preview_rows (preview_id, side, object, ref_id) VALUES ('gone-preview', 'hs', 'contact', '1'), ('gone-preview', 'hs', 'contact', '2')`);
    expect(await sweepOrphanRows()).toBeGreaterThanOrEqual(2);
    expect(await count('crm_hubspot_preview_rows', 'preview_id = ?', 'gone-preview')).toBe(0);
    await cancelPreview(owner.id);
  });

  it('límite diario de HubSpot: queda en espera, no insiste y retoma más tarde con lo ya leído', async () => {
    await bigPortal(20);
    const owner = await workspace('hsprev-daily');
    await startPreview(owner.id, owner.id);
    for (let i = 0; i < 3; i++) await runPreviewStep(owner.id, { maxPages: 1, pageSize: 10 });
    portal.fail(429, 1, { policyName: 'DAILY', path: '/search' });
    const callsBefore = portal.calls.length;
    expect(await runPreviewStep(owner.id, { pageSize: 10 })).toBe('waiting');
    expect(portal.calls.length).toBe(callsBefore + 1);
    const waiting = (await getPreview(owner.id))!;
    expect(waiting).toMatchObject({ status: 'waiting', failure: 'daily_limit' });
    expect(Date.parse(waiting.resumeAfter!)).toBeGreaterThan(Date.now() + 20 * 60_000);
    // Hasta esa hora nadie la reclama: ni la pantalla ni el cron. (Las de otros tests no cuentan acá.)
    await sql(`UPDATE crm_hubspot_previews SET status = 'cancelled' WHERE user_id != ? AND status IN ('queued', 'running', 'waiting')`, owner.id);
    expect(await runPreviewStep(owner.id)).toBe('not_claimed');
    await processHubspotPreviews();
    expect(portal.calls.length).toBe(callsBefore + 1);
    expect((await getPreview(owner.id))!.progress.objects.contacts!.read).toBe(10);
    // Llegó la hora.
    await sql('UPDATE crm_hubspot_previews SET resume_after = ? WHERE user_id = ?', new Date(Date.now() - 1000).toISOString(), owner.id);
    expect(await runPreviewStep(owner.id, { pageSize: 10 })).toBe('done');
    expect((await getPreview(owner.id))!.report!.objects.contacts!.hubspot).toBe(23);
  });

  it('la ráfaga de HubSpot no gasta intentos; un error que no afloja termina en fallida', async () => {
    const owner = await workspace('hsprev-burst');
    await startPreview(owner.id, owner.id);
    portal.fail(429, 6, { retryAfter: '0', path: '/crm/v3/owners' });
    expect(await runPreviewStep(owner.id)).toBe('progress');
    expect((await getPreview(owner.id))!).toMatchObject({ status: 'running', failure: 'hubspot_busy' });
    expect(Number(((await getDb().prepare('SELECT attempts FROM crm_hubspot_previews WHERE user_id = ?').get(owner.id)) as { attempts: number }).attempts)).toBe(0);
    portal.faults = [];
    portal.fail(400, 500, { path: '/crm/v3/owners' });
    let last = '';
    for (let i = 0; i < 12 && last !== 'failed'; i++) last = await runPreviewStep(owner.id);
    expect(last).toBe('failed');
    expect((await getPreview(owner.id))!).toMatchObject({ status: 'failed', failure: 'provider_error', report: null });
  });

  it('la clave deja de valer a mitad: fallida con su motivo y sin filas de trabajo', async () => {
    const owner = await workspace('hsprev-auth');
    await startPreview(owner.id, owner.id);
    await runPreviewStep(owner.id, { maxPages: 2 });
    portal.grant = () => null;
    expect(await runPreviewStep(owner.id)).toBe('failed');
    expect((await getPreview(owner.id))!).toMatchObject({ status: 'failed', failure: 'invalid_token' });
    expect(await count('crm_hubspot_preview_rows', 'preview_id IN (SELECT id FROM crm_hubspot_previews WHERE user_id = ?)', owner.id)).toBe(0);
  });

  it('sin conexión no arranca; desconectar descarta la vista previa y deja el sync apagado', async () => {
    const stranger = await makeUser('hsprev-none');
    expect(await startPreview(stranger.id, stranger.id)).toEqual({ ok: false, code: 'not_connected' });
    const owner = await workspace('hsprev-disc');
    await runToEnd(owner.id);
    await sql(`INSERT INTO crm_hubspot_sync_settings (user_id, enabled) VALUES (?, 1)`, owner.id);
    expect(await syncGate(owner.id)).toEqual({ run: true, reason: '' });
    vi.stubEnv('CRM_HUBSPOT_SYNC_DISABLED', '1');
    expect(await syncGate(owner.id)).toEqual({ run: false, reason: 'disabled_globally' });
    vi.stubEnv('CRM_HUBSPOT_SYNC_DISABLED', '');
    expect(await disconnectSync(owner.id, owner.id)).toBe(true);
    expect(await getPreview(owner.id)).toBeNull();
    expect((await getSyncStatus(owner.id)).connected).toBe(false);
    expect(await count('crm_hubspot_sync', 'user_id = ?', owner.id)).toBe(0);
    expect(await getSyncSettings(owner.id)).toMatchObject({ enabled: false });
    expect(await disconnectSync(owner.id)).toBe(false);
  });
});

describe('migración 20261119_1540_crm_hubspot_sync', () => {
  it('crea las tablas, tolera correr dos veces y no toca las del CRM', async () => {
    const m = MIGRATIONS.find((x) => x.id === '20261119_1540_crm_hubspot_sync')!;
    expect(m).toBeTruthy();
    const client = createClient({ url: `file:${path.join(os.tmpdir(), `hsync-${crypto.randomUUID()}.db`)}` });
    await client.executeMultiple(`CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE crm_external_ids (user_id TEXT, provider TEXT, object TEXT, external_id TEXT, record_id TEXT); INSERT INTO users (id) VALUES ('u1'); INSERT INTO crm_external_ids VALUES ('u1', 'hubspot', 'contact', '1', 'c1');`);
    await m.up(client);
    await client.execute(`INSERT INTO crm_hubspot_links (user_id, object, record_id, portal_id, hubspot_id) VALUES ('u1', 'contact', 'c1', '1', '10')`);
    await m.up(client);
    const tables = (await client.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'crm_hubspot_%' ORDER BY name`)).rows.map((r) => String(r.name));
    expect(tables).toEqual(['crm_hubspot_links', 'crm_hubspot_preview_rows', 'crm_hubspot_previews', 'crm_hubspot_sync', 'crm_hubspot_sync_settings']);
    // El vínculo sobrevive a la segunda corrida y tiene sus valores por defecto.
    const link = (await client.execute('SELECT state, shadow, hubspot_modified_at FROM crm_hubspot_links')).rows[0];
    expect([link.state, link.shadow, link.hubspot_modified_at]).toEqual(['linked', '{}', null]);
    // Uno a uno en los dos sentidos.
    await expect(client.execute(`INSERT INTO crm_hubspot_links (user_id, object, record_id, portal_id, hubspot_id) VALUES ('u1', 'contact', 'c2', '1', '10')`)).rejects.toThrow();
    await expect(client.execute(`INSERT INTO crm_hubspot_links (user_id, object, record_id, portal_id, hubspot_id) VALUES ('u1', 'contact', 'c1', '1', '11')`)).rejects.toThrow();
    // Ajustes: apagado, de HubSpot hacia acá y sin freno.
    await client.execute(`INSERT INTO crm_hubspot_sync_settings (user_id) VALUES ('u1')`);
    const settings = (await client.execute('SELECT enabled, direction, paused FROM crm_hubspot_sync_settings')).rows[0];
    expect([settings.enabled, settings.direction, settings.paused]).toEqual([0, 'hubspot_to_zerosoft', 0]);
    // Una vista previa por workspace.
    await client.execute(`INSERT INTO crm_hubspot_previews (id, user_id) VALUES ('p1', 'u1')`);
    await expect(client.execute(`INSERT INTO crm_hubspot_previews (id, user_id) VALUES ('p2', 'u1')`)).rejects.toThrow();
    expect((await client.execute('SELECT COUNT(*) AS n FROM crm_external_ids')).rows[0].n).toBe(1);
  });
});
