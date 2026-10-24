import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createCompany, createContact } from '@/lib/crm';
import {
  backoffMs,
  createHttpClient,
  dbTimestamp,
  fieldNameFrom,
  htmlToText,
  RateLimiter,
  SourceError,
} from '@/lib/crm-import-source';
import { createHubspotSource, hubspotFieldType } from '@/lib/crm-import-hubspot';
import { createPipedriveSource, pipedriveFieldType, refId, wonStageId } from '@/lib/crm-import-pipedrive';
import { fakeHubspotFetch, fakePipedriveFetch, fakeImportAllowed, isFakeToken } from '@/lib/crm-import-fake';
import {
  cancelImportJob,
  createImportPreview,
  getImportJob,
  groupTotals,
  jobProgress,
  listImportJobs,
  processImportJobs,
  runImportStep,
  setImportSourceFactory,
  startImportJob,
  type ImportJobView,
} from '@/lib/crm-import-jobs';
import { makeUser } from './helpers';

const noSleep = async () => {};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

beforeAll(() => {
  process.env.CRM_IMPORT_FAKE = '1';
});

afterEach(() => setImportSourceFactory(null));

/** Corre el job de a una página por vez hasta que termina (como varios ticks del cron). */
async function runToEnd(jobId: string, maxSteps = 500): Promise<number> {
  let steps = 0;
  for (; steps < maxSteps; steps++) {
    const r = await runImportStep(jobId, { maxPages: 1 });
    if (r === 'done' || r === 'failed' || r === 'cancelled') break;
  }
  return steps + 1;
}

async function previewAndStart(userId: string, provider: 'hubspot' | 'pipedrive', token = 'fake'): Promise<ImportJobView> {
  const res = await createImportPreview(userId, userId, provider, token);
  if (!res.ok) throw new Error(res.code);
  const started = await startImportJob(userId, res.job.id, {
    groups: ['companies', 'contacts', 'deals', 'activities'],
    ownerMap: res.job.options.ownerMap,
    defaultOwnerId: userId,
  });
  if (!started.ok) throw new Error(started.code);
  return started.job;
}

describe('Import por API: ritmo y reintentos', () => {
  it('la ventana deslizante espera a que salga el pedido más viejo', async () => {
    let t = 0;
    const waits: number[] = [];
    const limiter = new RateLimiter(2, 1000, () => t, async (ms) => {
      waits.push(ms);
      t += ms;
    });
    await limiter.take();
    t = 100;
    await limiter.take();
    await limiter.take();
    expect(waits).toEqual([900]);
    expect(t).toBe(1000);
  });

  it('100 pedidos cada 10 s: el 101 espera', async () => {
    let t = 0;
    const waits: number[] = [];
    const limiter = new RateLimiter(100, 10_000, () => t, async (ms) => {
      waits.push(ms);
      t += ms;
    });
    for (let i = 0; i < 100; i++) await limiter.take();
    expect(waits).toEqual([]);
    await limiter.take();
    expect(waits).toEqual([10_000]);
  });

  it('429 con Retry-After reintenta y espera lo que pide el servidor', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const request = createHttpClient({
      headers: { authorization: 'Bearer secret-token' },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetch: async () => {
        calls++;
        return calls === 1 ? json({}, 429, { 'retry-after': '2' }) : json({ ok: true });
      },
    });
    expect(await request<{ ok: boolean }>('https://api.hubapi.com/crm/v3/owners')).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(sleeps).toEqual([2000]);
  });

  it('sin Retry-After hace backoff exponencial y corta después de los reintentos', async () => {
    const sleeps: number[] = [];
    const request = createHttpClient({
      headers: {},
      maxRetries: 3,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetch: async () => json({}, 503),
    });
    await expect(request('https://api.pipedrive.com/v1/persons?start=0')).rejects.toMatchObject({ code: 'http', status: 503 });
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(backoffMs(10, null)).toBe(30_000);
  });

  it('401 y 403 no se reintentan y el error no lleva el token ni la query', async () => {
    const request = createHttpClient({ headers: { 'x-api-token': 'tok-123' }, sleep: noSleep, fetch: async () => json({}, 401) });
    const err = (await request('https://api.pipedrive.com/v1/users?api_token=tok-123').catch((e) => e)) as SourceError;
    expect(err).toBeInstanceOf(SourceError);
    expect(err.code).toBe('auth');
    expect(err.message).not.toContain('tok-123');
    const scoped = createHttpClient({ headers: {}, sleep: noSleep, fetch: async () => json({}, 403) });
    await expect(scoped('https://api.hubapi.com/crm/v3/objects/emails')).rejects.toMatchObject({ code: 'scope' });
  });
});

describe('Import por API: mapeo', () => {
  it('tipos de propiedades de HubSpot y de campos de Pipedrive', () => {
    expect(hubspotFieldType({ type: 'number', fieldType: 'number' })).toBe('number');
    expect(hubspotFieldType({ type: 'number', fieldType: 'number', showCurrencySymbol: true })).toBe('currency');
    expect(hubspotFieldType({ type: 'datetime', fieldType: 'date' })).toBe('date');
    expect(hubspotFieldType({ type: 'enumeration', fieldType: 'booleancheckbox' })).toBe('boolean');
    expect(hubspotFieldType({ type: 'enumeration', fieldType: 'checkbox' })).toBe('multiselect');
    expect(hubspotFieldType({ type: 'enumeration', fieldType: 'select' })).toBe('select');
    expect(hubspotFieldType({ type: 'phone_number', fieldType: 'phonenumber' })).toBe('phone');
    expect(hubspotFieldType({ type: 'string', fieldType: 'textarea' })).toBe('text');
    expect(pipedriveFieldType('monetary')).toBe('currency');
    expect(pipedriveFieldType('set')).toBe('multiselect');
    expect(pipedriveFieldType('enum')).toBe('select');
    expect(pipedriveFieldType('address')).toBe('text');
  });

  it('utilidades: nombres de campo, HTML, fechas, ids de Pipedrive', () => {
    expect(fieldNameFrom('Favorite color')).toBe('favorite_color');
    expect(fieldNameFrom('3rd party ID')).toBe('f_3rd_party_id');
    expect(htmlToText('<p>Hola&nbsp;<b>mundo</b></p><p>dos</p>')).toBe('Hola mundo\ndos');
    expect(dbTimestamp('2026-03-04T10:20:30.000Z')).toBe('2026-03-04 10:20:30');
    expect(dbTimestamp('2026-03-04 10:20:30')).toBe('2026-03-04 10:20:30');
    expect(dbTimestamp('1700000000000')).toBe('2023-11-14 22:13:20');
    expect(refId({ value: 7, name: 'x' })).toBe('7');
    expect(refId(12)).toBe('12');
    expect(refId(null)).toBe('');
  });

  it('HubSpot: pipelines con probabilidad y cierre ganado/perdido', async () => {
    const src = createHubspotSource('fake', { fetch: fakeHubspotFetch({ contacts: 5, ownerEmails: ['a@x.test', 'b@x.test'] }), sleep: noSleep });
    const [p] = await src.pipelines();
    expect(p.name).toBe('Sales Pipeline');
    expect(p.stages.map((s) => [s.name, s.probability, s.isWon, s.isLost])).toEqual([
      ['Appointment scheduled', 20, false, false],
      ['Qualified to buy', 40, false, false],
      ['Closed won', 100, true, false],
      ['Closed lost', 0, false, true],
    ]);
    const fields = await src.fields();
    expect(fields.map((f) => `${f.entity}.${f.key}:${f.type}`)).toEqual([
      'contacts.favorite_color:text',
      'companies.tier:select',
      'deals.renewal:boolean',
    ]);
    expect(fields[1].optionMap).toEqual({ gold: 'Gold', silver: 'Silver' });
  });

  it('HubSpot: pagina con after y lee asociaciones por lote (la primaria primero)', async () => {
    const log: string[] = [];
    const src = createHubspotSource('fake', {
      fetch: fakeHubspotFetch({ contacts: 250, ownerEmails: ['a@x.test', 'b@x.test'] }, log),
      sleep: noSleep,
    });
    const sizes: number[] = [];
    let cursor: string | null = null;
    let first = true;
    do {
      const page = await src.page('contacts', cursor, []);
      sizes.push(page.items.length);
      if (first) {
        const c = page.items[0];
        expect(c.kind).toBe('contact');
        if (c.kind === 'contact') {
          expect(c.companies[0]).toEqual({ id: '1000', primary: true });
          expect(c.companies[1]).toEqual({ id: '1001', primary: false });
          expect(c.lifecycleStage).toBe('marketingqualifiedlead');
        }
        first = false;
      }
      cursor = page.next;
    } while (cursor);
    expect(sizes).toEqual([100, 100, 50]);
    expect(log.filter((l) => l.includes('/batch/read'))).toHaveLength(3);
    expect(await src.count('contacts')).toBe(250);
  });

  it('Pipedrive: suma etapas Won/Lost y los deals cerrados caen ahí', async () => {
    const src = createPipedriveSource('fake', { fetch: fakePipedriveFetch({ contacts: 9, ownerEmails: ['a@x.test', 'b@x.test'] }), sleep: noSleep });
    const [p] = await src.pipelines();
    expect(p.stages.map((s) => s.name)).toEqual(['Qualified', 'Proposal made', 'Won', 'Lost']);
    expect(p.stages[2]).toMatchObject({ id: wonStageId('1'), isWon: true });
    const deals = await src.page('deals', null, []);
    const won = deals.items.find((d) => d.kind === 'deal' && d.name === 'Deal 3');
    expect(won).toMatchObject({ stageId: '1:won', currency: 'EUR', contactIds: [expect.any(String)] });
    const people = await src.page('contacts', null, [], 4);
    expect(people.items).toHaveLength(4);
    expect(people.next).toBe('4');
  });

  it('el proveedor falso solo existe con CRM_IMPORT_FAKE=1 y en test/demo', () => {
    expect(fakeImportAllowed()).toBe(true);
    process.env.CRM_IMPORT_FAKE = '0';
    expect(fakeImportAllowed()).toBe(false);
    process.env.CRM_IMPORT_FAKE = '1';
    expect(isFakeToken('fake-50')).toBe(true);
    expect(isFakeToken('pat-na1-123')).toBe(false);
  });

  it('progreso y totales por grupo', () => {
    const totals = groupTotals({ companies: 10, contacts: 20, notes: 3, calls: null }, ['companies', 'contacts', 'notes', 'calls']);
    expect(totals).toEqual({ companies: 10, contacts: 20, deals: 0, activities: null });
    const c = (total: number | null, processed: number) => ({ total, processed, created: 0, updated: 0, skipped: 0, failed: 0 });
    expect(jobProgress({ companies: c(10, 5), contacts: c(10, 0), deals: c(0, 0), activities: c(0, 0) }, ['companies', 'contacts'])).toBe(0.25);
    expect(jobProgress({ companies: c(null, 5), contacts: c(10, 0), deals: c(0, 0), activities: c(0, 0) }, ['companies'])).toBeNull();
  });
});

describe('Import por API: jobs de punta a punta (HubSpot falso)', () => {
  it('token inválido: no crea job', async () => {
    const u = await makeUser('imp-bad');
    setImportSourceFactory((_p, token) =>
      createHubspotSource(token, { fetch: fakeHubspotFetch({ contacts: 3, ownerEmails: [u.email, 'x@y.test'] }), sleep: noSleep }),
    );
    const res = await createImportPreview(u.id, u.id, 'hubspot', 'wrong');
    expect(res).toEqual({ ok: false, code: 'invalid_token' });
  });

  it('vista previa: conteos, muestra, owners por email, campos y pipelines; el token queda cifrado', async () => {
    const u = await makeUser('imp-prev');
    const res = await createImportPreview(u.id, u.id, 'hubspot', 'fake');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = res.job.preview;
    expect(p.counts.contacts).toBe(24);
    expect(p.counts.companies).toBe(6);
    expect(p.samples.contacts).toHaveLength(5);
    expect(p.owners.map((o) => o.matchId)).toEqual([u.id, null]);
    expect(p.fields.map((f) => f.key)).toEqual(['favorite_color', 'tier', 'renewal']);
    expect(p.pipelines[0]).toMatchObject({ name: 'Sales Pipeline', existing: false });
    const row = (await getDb().prepare('SELECT token, status FROM crm_import_jobs WHERE id = ?').get(res.job.id)) as {
      token: string;
      status: string;
    };
    expect(row.status).toBe('preview');
    expect(row.token.startsWith('enc:v1:')).toBe(true);
    expect(row.token).not.toContain('fake');
    // La vista para la UI nunca trae el token.
    expect(JSON.stringify(res.job)).not.toContain('enc:v1');
    // Nada se escribió en el CRM.
    const n = (await getDb().prepare('SELECT COUNT(*) AS c FROM crm_contacts WHERE user_id = ?').get(u.id)) as { c: number };
    expect(n.c).toBe(0);
  });

  it('importa todo en pasos cortos (cursor por página) y borra el token al terminar', async () => {
    const u = await makeUser('imp-run');
    const job = await previewAndStart(u.id, 'hubspot');
    const steps = await runToEnd(job.id);
    expect(steps).toBeGreaterThan(5);
    const done = (await getImportJob(u.id, job.id))!;
    expect(done.status).toBe('done');
    expect(done.progress).toBe(1);
    expect(done.counts.contacts).toMatchObject({ total: 24, processed: 24, created: 24, failed: 0 });
    expect(done.counts.companies).toMatchObject({ total: 6, created: 6 });
    expect(done.counts.deals).toMatchObject({ total: 8, created: 8 });
    expect(done.counts.activities.created).toBe(12 + 4);
    const tok = (await getDb().prepare('SELECT token FROM crm_import_jobs WHERE id = ?').get(job.id)) as { token: string };
    expect(tok.token).toBe('');

    const db = getDb();
    // Contactos: lifecycle, lead status y fuente traducidos; owner 1 → la persona, owner 2 → default.
    const c1 = (await db.prepare('SELECT * FROM crm_contacts WHERE user_id = ? AND email = ?').get(u.id, 'person1@company1.example')) as Record<string, string>;
    expect(c1).toMatchObject({ lifecycle_stage: 'mql', lead_status: 'in_progress', source: 'organic', owner_id: u.id });
    expect(JSON.parse(c1.custom)).toEqual({});
    const c2 = (await db.prepare('SELECT * FROM crm_contacts WHERE user_id = ? AND email = ?').get(u.id, 'person2@company2.example')) as Record<string, string>;
    expect(JSON.parse(c2.custom)).toEqual({ favorite_color: 'Blue' });
    // Contacto 1: primaria company 1 y secundaria company 2.
    const assoc = (await db
      .prepare(
        `SELECT co.domain, cc.is_primary FROM crm_contact_companies cc JOIN crm_companies co ON co.id = cc.company_id
         WHERE cc.contact_id = ? ORDER BY cc.is_primary DESC`,
      )
      .all(c1.id)) as Array<{ domain: string; is_primary: number }>;
    expect(assoc).toEqual([
      { domain: 'company1.example', is_primary: 1 },
      { domain: 'company2.example', is_primary: 0 },
    ]);
    // Empresas: select por etiqueta, madre resuelta.
    const co2 = (await db.prepare('SELECT * FROM crm_companies WHERE user_id = ? AND domain = ?').get(u.id, 'company2.example')) as Record<string, string>;
    const co1 = (await db.prepare('SELECT * FROM crm_companies WHERE user_id = ? AND domain = ?').get(u.id, 'company1.example')) as Record<string, string>;
    expect(co2.parent_company_id).toBe(co1.id);
    expect(JSON.parse(co2.custom)).toEqual({ tier: 'Gold' });
    const field = (await db.prepare(`SELECT type, options FROM crm_custom_fields WHERE user_id = ? AND name = 'tier'`).get(u.id)) as {
      type: string;
      options: string;
    };
    expect(field).toEqual({ type: 'select', options: JSON.stringify(['Gold', 'Silver']) });
    // Deals: etapa ganada cerrada con la fecha, moneda, contactos y empresa primaria.
    const won = (await db
      .prepare(
        `SELECT d.*, s.name AS stage_name, s.is_won, s.probability FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id
         WHERE d.user_id = ? AND d.name = 'Deal 3'`,
      )
      .get(u.id)) as Record<string, string | number>;
    expect(won).toMatchObject({ stage_name: 'Closed won', is_won: 1, probability: 100, amount: 3000, currency: 'USD', close_date: '2026-03-03' });
    expect(won.closed_at).toBe('2026-03-03 00:00:00');
    expect(JSON.parse(String(won.custom))).toEqual({ renewal: true });
    const dealContacts = (await db.prepare('SELECT COUNT(*) AS c FROM crm_deal_contacts WHERE deal_id = ?').get(won.id)) as { c: number };
    expect(dealContacts.c).toBe(1);
    const dealCo = (await db.prepare('SELECT is_primary FROM crm_deal_companies WHERE deal_id = ?').all(won.id)) as Array<{ is_primary: number }>;
    expect(dealCo).toEqual([{ is_primary: 1 }]);
    // Actividad con su fecha original y el owner mapeado.
    const call = (await db.prepare(`SELECT * FROM crm_activities WHERE user_id = ? AND type = 'call'`).get(u.id)) as Record<string, string | number>;
    expect(call).toMatchObject({ subject: 'Discovery call', direction: 'outbound', duration_min: 15, contact_id: c1.id, created_at: '2026-02-02 15:00:00' });
    const meeting = (await db.prepare(`SELECT owner_id FROM crm_activities WHERE user_id = ? AND type = 'meeting'`).get(u.id)) as { owner_id: string };
    expect(meeting.owner_id).toBe(u.id);
    const task = (await db.prepare(`SELECT done, due_at, due_fired_at FROM crm_activities WHERE user_id = ? AND type = 'task'`).get(u.id)) as Record<string, unknown>;
    expect(task).toEqual({ done: 0, due_at: '2030-01-15 12:00:00', due_fired_at: null });
    const note = (await db.prepare(`SELECT body, deal_id FROM crm_activities WHERE user_id = ? AND type = 'note' AND deal_id IS NOT NULL`).get(u.id)) as Record<string, string>;
    expect(note.body).toBe('Note 1 about the account');
  });

  it('reimportar la misma cuenta actualiza y no duplica', async () => {
    const u = await makeUser('imp-idem');
    const first = await previewAndStart(u.id, 'hubspot');
    await runToEnd(first.id);
    const count = async (t: string) => ((await getDb().prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE user_id = ?`).get(u.id)) as { c: number }).c;
    const before = [await count('crm_contacts'), await count('crm_companies'), await count('crm_deals'), await count('crm_activities')];
    const pipes = await count('crm_pipelines');

    const prev = await createImportPreview(u.id, u.id, 'hubspot', 'fake');
    expect(prev.ok && prev.job.preview.previouslyImported).toBe(24 + 6 + 8);
    expect(prev.ok && prev.job.preview.pipelines[0].existing).toBe(true);
    const second = await previewAndStart(u.id, 'hubspot');
    await runToEnd(second.id);
    const after = [await count('crm_contacts'), await count('crm_companies'), await count('crm_deals'), await count('crm_activities')];
    expect(after).toEqual(before);
    expect(await count('crm_pipelines')).toBe(pipes);
    const job = (await getImportJob(u.id, second.id))!;
    expect(job.counts.contacts).toMatchObject({ created: 0, updated: 24 });
    expect(job.counts.deals).toMatchObject({ created: 0, updated: 8 });
    const fields = (await getDb().prepare(`SELECT COUNT(*) AS c FROM crm_custom_fields WHERE user_id = ?`).get(u.id)) as { c: number };
    expect(fields.c).toBe(3);
  });

  it('deduplica contra lo existente: email y dominio, completando solo lo vacío', async () => {
    const u = await makeUser('imp-dedupe');
    const company = await createCompany(u.id, { name: 'Mine', domain: 'company1.example', industry: '' });
    const contact = await createContact(u.id, { email: 'Person1@Company1.example', firstName: 'Ada', lastName: '', jobTitle: 'CEO' });
    const job = await previewAndStart(u.id, 'hubspot');
    await runToEnd(job.id);
    const db = getDb();
    const companies = (await db.prepare(`SELECT * FROM crm_companies WHERE user_id = ? AND domain = 'company1.example'`).all(u.id)) as Array<Record<string, string>>;
    expect(companies).toHaveLength(1);
    expect(companies[0]).toMatchObject({ id: company.id, name: 'Mine', industry: 'Retail' });
    const contacts = (await db.prepare(`SELECT * FROM crm_contacts WHERE user_id = ? AND lower(email) = 'person1@company1.example'`).all(u.id)) as Array<Record<string, string>>;
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ id: contact.id, first_name: 'Ada', last_name: 'Fake', job_title: 'CEO' });
    const done = (await getImportJob(u.id, job.id))!;
    expect(done.counts.companies).toMatchObject({ created: 5, updated: 1 });
    expect(done.counts.contacts).toMatchObject({ created: 23, updated: 1 });
  });

  it('cancelar a mitad corta el job y borra el token', async () => {
    const u = await makeUser('imp-cancel');
    const job = await previewAndStart(u.id, 'hubspot', 'fake-300');
    expect(await runImportStep(job.id, { maxPages: 1, pageSize: 50 })).toBe('progress');
    expect(await cancelImportJob(u.id, job.id)).toBe(true);
    expect(await runImportStep(job.id, { maxPages: 1 })).toBe('not_claimed');
    const row = (await getDb().prepare('SELECT status, token FROM crm_import_jobs WHERE id = ?').get(job.id)) as Record<string, string>;
    expect(row).toEqual({ status: 'cancelled', token: '' });
  });

  it('cancelar mientras corre un tramo corta en la tanda siguiente (el tramo cede el event loop)', async () => {
    const u = await makeUser('imp-cancel-live');
    const job = await previewAndStart(u.id, 'hubspot', 'fake-300');
    // Llega como otro request: en la primera pausa del tramo.
    setImmediate(() => void cancelImportJob(u.id, job.id));
    expect(await runImportStep(job.id, { budgetMs: 30_000, pageSize: 100 })).toBe('cancelled');
    const row = (await getDb().prepare('SELECT status FROM crm_import_jobs WHERE id = ?').get(job.id)) as { status: string };
    expect(row.status).toBe('cancelled');
  });

  it('una vista previa descartada se borra y no aparece en Imports anteriores', async () => {
    const u = await makeUser('imp-drop-preview');
    const res = await createImportPreview(u.id, u.id, 'hubspot', 'fake');
    if (!res.ok) throw new Error(res.code);
    expect(await cancelImportJob(u.id, res.job.id)).toBe(true);
    expect(await getImportJob(u.id, res.job.id)).toBeNull();
    // Uno viejo (de antes del arreglo): cancelado sin haber arrancado nunca.
    await getDb()
      .prepare(`INSERT INTO crm_import_jobs (id, user_id, created_by, provider, status, token, options, preview, counts) VALUES (?, ?, ?, 'hubspot', 'cancelled', '', '{}', '{}', '{}')`)
      .run(crypto.randomUUID(), u.id, u.id);
    const started = await previewAndStart(u.id, 'hubspot');
    await runToEnd(started.id);
    expect((await listImportJobs(u.id)).map((j) => j.id)).toEqual([started.id]);
  });

  it('un job a la vez por workspace y el reclamo evita dos corridas juntas', async () => {
    const u = await makeUser('imp-claim');
    const job = await previewAndStart(u.id, 'hubspot');
    expect(await createImportPreview(u.id, u.id, 'hubspot', 'fake')).toEqual({ ok: false, code: 'import_running' });
    await getDb()
      .prepare('UPDATE crm_import_jobs SET locked_until = ? WHERE id = ?')
      .run(new Date(Date.now() + 60_000).toISOString().slice(0, 19).replace('T', ' '), job.id);
    expect(await runImportStep(job.id)).toBe('not_claimed');
    await getDb().prepare('UPDATE crm_import_jobs SET locked_until = NULL WHERE id = ?').run(job.id);
    // El cron lo toma y lo termina (dataset chico).
    const r = await processImportJobs({ budgetMs: 30_000 });
    expect(r.jobs).toBeGreaterThanOrEqual(1);
    expect((await getImportJob(u.id, job.id))!.status).toBe('done');
  });

  it('un 401 a mitad de camino falla el job y borra el token', async () => {
    const u = await makeUser('imp-401');
    const job = await previewAndStart(u.id, 'hubspot');
    setImportSourceFactory((_p, token) =>
      createHubspotSource(token, { fetch: async () => json({}, 401), sleep: noSleep }),
    );
    expect(await runImportStep(job.id)).toBe('failed');
    const row = (await getDb().prepare('SELECT status, token, failure FROM crm_import_jobs WHERE id = ?').get(job.id)) as Record<string, string>;
    expect(row).toEqual({ status: 'failed', token: '', failure: 'auth_401' });
  });

  it('un error transitorio no pierde el avance: reintenta desde el último cursor', async () => {
    const u = await makeUser('imp-resume');
    const job = await previewAndStart(u.id, 'hubspot', 'fake-40');
    const ds = { contacts: 40, ownerEmails: [u.email, 'x@y.test'] as [string, string] };
    const real = fakeHubspotFetch(ds);
    let fail = false;
    setImportSourceFactory((_p, token) =>
      createHubspotSource(token, {
        fetch: async (url, init) => (fail && url.includes('/objects/contacts') ? json({}, 500) : real(url, init)),
        sleep: noSleep,
      }),
    );
    // Empresas (1 página) y la primera página de contactos.
    await runImportStep(job.id, { maxPages: 2, pageSize: 20 });
    fail = true;
    expect(await runImportStep(job.id, { maxPages: 1, pageSize: 20 })).toBe('progress');
    const mid = (await getImportJob(u.id, job.id))!;
    expect(mid.status).toBe('running');
    expect(mid.counts.contacts.processed).toBe(20);
    expect(mid.failure).toBe('http_500');
    fail = false;
    for (let i = 0; i < 50; i++) if ((await runImportStep(job.id, { maxPages: 1, pageSize: 20 })) === 'done') break;
    const done = (await getImportJob(u.id, job.id))!;
    expect(done.status).toBe('done');
    expect(done.counts.contacts).toMatchObject({ processed: 40, created: 40 });
  });
});

describe('Import por API: Pipedrive falso', () => {
  it('personas, organizaciones, deals con Won/Lost, notas y actividades', async () => {
    const u = await makeUser('imp-pd');
    const job = await previewAndStart(u.id, 'pipedrive', 'fake-9');
    expect(job.counts.contacts.total).toBeNull();
    await runToEnd(job.id);
    const done = (await getImportJob(u.id, job.id))!;
    expect(done.status).toBe('done');
    expect(done.counts.contacts.created).toBe(9);
    expect(done.counts.companies.created).toBe(3);
    const db = getDb();
    const c = (await db.prepare(`SELECT * FROM crm_contacts WHERE user_id = ? AND email = 'person1@company1.example'`).get(u.id)) as Record<string, string>;
    expect(c).toMatchObject({ first_name: 'Person1', phone: '+1 555 0100', lifecycle_stage: 'lead', owner_id: u.id });
    const co = (await db.prepare(`SELECT custom, domain FROM crm_companies WHERE user_id = ? AND name = 'Company 2'`).get(u.id)) as Record<string, string>;
    expect(co.domain).toBe('company2.example');
    expect(JSON.parse(co.custom)).toEqual({ tier: 'Gold' });
    const stages = (await db
      .prepare(`SELECT s.name, s.is_won, s.is_lost FROM crm_stages s JOIN crm_pipelines p ON p.id = s.pipeline_id WHERE p.user_id = ? ORDER BY s.position`)
      .all(u.id)) as Array<{ name: string; is_won: number; is_lost: number }>;
    expect(stages.filter((s) => s.is_won || s.is_lost).map((s) => s.name)).toEqual(expect.arrayContaining(['Won', 'Lost']));
    const won = (await db
      .prepare(`SELECT d.currency, s.is_won FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id WHERE d.user_id = ? AND d.name = 'Deal 3'`)
      .get(u.id)) as Record<string, unknown>;
    expect(won).toEqual({ currency: 'EUR', is_won: 1 });
    const acts = (await db.prepare(`SELECT type, COUNT(*) AS c FROM crm_activities WHERE user_id = ? GROUP BY type ORDER BY type`).all(u.id)) as Array<{ type: string; c: number }>;
    expect(acts).toEqual([
      { type: 'call', c: 1 },
      { type: 'meeting', c: 1 },
      { type: 'note', c: 5 },
      { type: 'task', c: 1 },
    ]);
  });
});
