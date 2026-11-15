import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import type { CheckResult } from '@/lib/status/checks';
import { applyReport, listIncidents, publicStatus, runStatusCron, statusSummary } from '@/lib/status/store';

const incidentsRoute = await import('@/app/api/status/incidents/route');
const notesRoute = await import('@/app/api/status/incidents/[id]/notes/route');
const reportRoute = await import('@/app/api/status/report/route');
const summaryRoute = await import('@/app/api/status/summary/route');

const TOKEN = 'unit-status-token-0123456789abcdef';
const mailFile = path.join(os.tmpdir(), `zerosoft-status-mail-${process.pid}-${Date.now()}.jsonl`);
process.env.EMAIL_CAPTURE_FILE = mailFile;
process.env.ALERT_EMAIL = 'owner@example.com';
delete process.env.RESEND_API_KEY;

afterAll(() => {
  fs.rmSync(mailFile, { force: true });
});

function mails(): Array<{ to: string; subject: string; text: string }> {
  if (!fs.existsSync(mailFile)) return [];
  return fs
    .readFileSync(mailFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const MIN = 60_000;
/** Un "ahora" lejos del reloj real, alineado al minuto, distinto en cada test. */
let base = Date.UTC(2030, 0, 1, 10, 0);

function checks(over: Partial<Record<string, CheckResult>> = {}) {
  const ok: CheckResult = { status: 'up', ms: 1 };
  return async () => ({ web: ok, database: ok, whatsapp: ok, email: ok, ...over }) as Record<string, CheckResult>;
}

async function cron(minute: number, over: Partial<Record<string, CheckResult>> = {}) {
  return runStatusCron({ now: base + minute * MIN, runChecks: checks(over) });
}

function req(url: string, init: { method?: string; body?: unknown; token?: string | null } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token !== null) headers.authorization = `Bearer ${init.token ?? TOKEN}`;
  return new Request(`http://x${url}`, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

beforeEach(async () => {
  process.env.STATUS_AGENT_TOKEN = TOKEN;
  base += 400 * 24 * 60 * MIN;
  const db = getDb();
  for (const t of ['status_components', 'status_public', 'status_minutes', 'status_hours', 'status_incidents', 'status_incident_notes']) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  await db.prepare('UPDATE status_meta SET last_minute = 0, notify_hour = 0, notify_count = 0 WHERE id = 1').run();
  fs.rmSync(mailFile, { force: true });
});

describe('status: API del watcher (auth)', () => {
  it('sin STATUS_AGENT_TOKEN la API no existe (503)', async () => {
    delete process.env.STATUS_AGENT_TOKEN;
    const res = await incidentsRoute.GET(req('/api/status/incidents?state=open'));
    expect(res.status).toBe(503);
  });

  it('sin token o con uno equivocado: 401, sin el token en la respuesta', async () => {
    for (const token of [null, 'wrong', `${TOKEN}x`, TOKEN.slice(0, -1)]) {
      const res = await incidentsRoute.GET(req('/api/status/incidents', { token }));
      expect(res.status).toBe(401);
      expect(await res.text()).not.toContain(TOKEN);
    }
    const bad = new Request('http://x/api/status/report', { method: 'POST', headers: { authorization: `Basic ${TOKEN}` }, body: '{}' });
    expect((await reportRoute.POST(bad)).status).toBe(401);
    expect((await summaryRoute.GET(req('/api/status/summary', { token: 'nope' }))).status).toBe(401);
    expect((await notesRoute.POST(req('/api/status/incidents/x/notes', { method: 'POST', token: 'nope', body: { by: 'claude', text: 'x' } }), { params: Promise.resolve({ id: 'x' }) })).status).toBe(401);
  });

  it('con el token: 200 y un array', async () => {
    const res = await incidentsRoute.GET(req('/api/status/incidents?state=open'));
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
    expect((await incidentsRoute.GET(req('/api/status/incidents?state=nope'))).status).toBe(400);
  });

  it('valida el reporte', async () => {
    const post = (body: unknown) => reportRoute.POST(req('/api/status/report', { method: 'POST', body }));
    expect((await post({ component: 'web', status: 'down' })).status).toBe(400);
    expect((await post({ component: 'evolution-db', status: 'broken' })).status).toBe(400);
    expect((await post({ component: 'evolution-db-disk', status: 'up', metrics: { volumeUsedMB: 'a' } })).status).toBe(400);
    expect((await post({ component: 'evolution-db-disk', status: 'up', metrics: { volumeUsedMB: 120, volumeSizeMB: 500 } })).status).toBe(200);
  });
});

describe('status: cron e incidentes', () => {
  it('reclama el minuto: una segunda corrida del mismo minuto no hace nada', async () => {
    expect((await cron(0)).skipped).toBeUndefined();
    expect((await cron(0)).skipped).toBe('claimed');
  });

  it('abre a la segunda falla, avisa por email, y resuelve a la tercera pasada con otro email', async () => {
    const down = { database: { status: 'down', error: 'quota/blocked: SQL read operations are forbidden', ms: 3 } as CheckResult };
    await cron(0, down);
    expect(await listIncidents('open')).toHaveLength(0);
    await cron(1, down);
    const open = await listIncidents('open');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ component: 'database', failures: 2, severity: 'down', state: 'open' });
    expect(open[0].title).toMatch(/quota/);
    expect(open[0].lastError).toMatch(/forbidden/);
    expect(mails().map((m) => m.subject)).toEqual([expect.stringMatching(/Down: Database/)]);
    expect(mails()[0].text).toMatch(/forbidden/);

    await cron(2, down);
    expect((await listIncidents('open'))[0].failures).toBe(3);
    await cron(3);
    await cron(4);
    expect(await listIncidents('open')).toHaveLength(1);
    await cron(5);
    expect(await listIncidents('open')).toHaveLength(0);
    const all = await listIncidents('all');
    expect(all[0].state).toBe('resolved');
    expect(all[0].notes.map((n) => n.kind)).toEqual(['opened', 'resolved']);
    expect(mails().map((m) => m.subject)).toEqual([expect.stringMatching(/Down/), expect.stringMatching(/Resolved: Database/)]);
  });

  it('si vuelve a fallar enseguida, reabre el mismo incidente sin otro email (cooldown) y sin "resuelto" suelto', async () => {
    const down = { web: { status: 'down', error: 'home returned HTTP 502', ms: 3 } as CheckResult };
    for (const m of [0, 1]) await cron(m, down);
    for (const m of [2, 3, 4]) await cron(m);
    const first = (await listIncidents('all'))[0];
    for (const m of [5, 6]) await cron(m, down);
    const open = await listIncidents('open');
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(first.id);
    expect(open[0].notes.map((n) => n.kind)).toEqual(['opened', 'resolved', 'reopened']);
    for (const m of [7, 8, 9]) await cron(m);
    // Apertura y resuelto de la primera vuelta; la reapertura cayó en el cooldown y su "resuelto" tampoco sale.
    expect(mails().map((m) => m.subject.replace(/\[zerosoft status\] /, '').split(':')[0])).toEqual(['Down', 'Resolved']);
  });

  it('flapping no abre ni manda nada', async () => {
    const down = { whatsapp: { status: 'down', error: 'fetchInstances HTTP 500', ms: 3 } as CheckResult };
    for (let m = 0; m < 10; m++) await cron(m, m % 2 === 0 ? down : {});
    expect(await listIncidents('all')).toHaveLength(0);
    expect(mails()).toHaveLength(0);
  });

  it('reportes del watcher: misma lógica, notas internas y públicas, y la página sin nada interno', async () => {
    const now = base;
    const r1 = await applyReport({ component: 'evolution-db', status: 'down', detail: 'postgres crashed: No space left on device at evo-pg.railway.internal', now });
    expect(r1).toMatchObject({ ok: true, incidentId: null });
    const r2 = await applyReport({ component: 'evolution-db', status: 'down', detail: 'postgres crashed: No space left on device at evo-pg.railway.internal', now: now + MIN });
    expect(r2.ok && r2.incidentId).toBeTruthy();

    const listRes = await incidentsRoute.GET(req('/api/status/incidents?state=open'));
    const list = (await listRes.json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    const inc = list[0];
    expect(inc).toMatchObject({ component: 'evolution-db', failures: 2 });
    expect(typeof inc.id).toBe('string');
    expect(new Date(String(inc.startedAt)).toISOString()).toBe(inc.startedAt);
    expect(String(inc.lastError)).toMatch(/No space left/);

    const add = (body: unknown) =>
      notesRoute.POST(req(`/api/status/incidents/${inc.id}/notes`, { method: 'POST', body }), { params: Promise.resolve({ id: String(inc.id) }) });
    expect((await add({ by: 'watcher', text: 'Volume at 100%, resizing evo-pg.railway.internal to 1 GB' })).status).toBe(201);
    expect((await add({ by: 'claude', text: 'Disk resized on evo-pg.railway.internal (10.1.2.3). Messages are flowing again.', public: true })).status).toBe(201);
    expect((await add({ by: 'someone', text: 'x' })).status).toBe(400);
    expect((await add({ by: 'claude', text: '' })).status).toBe(400);
    const missing = await notesRoute.POST(req('/api/status/incidents/nope/notes', { method: 'POST', body: { by: 'claude', text: 'x' } }), { params: Promise.resolve({ id: 'nope' }) });
    expect(missing.status).toBe(404);

    // Las notas del route usan el reloj real (el test corre en 2030+): se comparan sin orden.
    const after = (await listIncidents('open'))[0];
    expect(after.notes.map((n) => `${n.by}:${n.public}`).sort()).toEqual(['claude:true', 'system:true', 'watcher:false']);

    // Lo que sale a la página pública.
    const pub = await publicStatus(now + 2 * MIN);
    const json = JSON.stringify(pub);
    expect(pub.open).toHaveLength(1);
    expect(pub.open[0]).toMatchObject({ publicId: 'whatsapp', severity: 'down' });
    expect(pub.components.find((c) => c.id === 'whatsapp')?.status).toBe('down');
    for (const leak of ['railway', '10.1.2.3', 'No space left', 'resizing', 'evolution', 'Evolution', 'postgres', TOKEN]) {
      expect(json).not.toContain(leak);
    }
    expect(json).toContain('Messages are flowing again');
  });

  it('el disco al 92 % avisa por email pero no sale en la página; lleno, sí', async () => {
    const m = { volumeUsedMB: 460, volumeSizeMB: 500 };
    await applyReport({ component: 'evolution-db-disk', status: 'up', metrics: m, now: base });
    await applyReport({ component: 'evolution-db-disk', status: 'up', metrics: m, now: base + MIN });
    const open = await listIncidents('open');
    expect(open[0]).toMatchObject({ component: 'evolution-db-disk', severity: 'degraded', public: false });
    expect(mails()[0].text).toMatch(/460 of 500 MB used \(92%\)/);
    expect((await publicStatus(base + MIN)).open).toHaveLength(0);
    await applyReport({ component: 'evolution-db-disk', status: 'down', metrics: { volumeUsedMB: 500, volumeSizeMB: 500 }, now: base + 2 * MIN });
    const pub = await publicStatus(base + 2 * MIN);
    expect(pub.open).toHaveLength(1);
    expect(pub.open[0].severity).toBe('down');
    // Empeorar avisa enseguida, aunque el email de apertura haya salido hace un minuto.
    expect(mails().map((x) => x.subject)).toEqual([expect.stringMatching(/Degraded: Evolution database disk/), expect.stringMatching(/Worse: Evolution database disk is now down/)]);
  });

  it('si el watcher deja de reportar 10 minutos, el componente queda unknown y se abre un incidente interno', async () => {
    await applyReport({ component: 'evolution-db', status: 'up', now: base });
    await cron(5);
    expect(await listIncidents('all')).toHaveLength(0);
    await cron(11);
    await cron(12);
    const open = await listIncidents('open');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ component: 'evolution-db', severity: 'unknown', public: false });
    expect(open[0].title).toMatch(/watcher/);
    expect(mails()[0].subject).toMatch(/No reports: Evolution database/);
    const summary = await statusSummary(base + 12 * MIN);
    expect(summary.components.find((c) => c.id === 'evolution-db')?.status).toBe('unknown');
    // En la página: WhatsApp sigue con el chequeo del cron (up), sin incidente.
    const pub = await publicStatus(base + 12 * MIN);
    expect(pub.open).toHaveLength(0);
    expect(pub.components.find((c) => c.id === 'whatsapp')?.status).toBe('up');
    // Vuelve: 3 reportes up y se resuelve.
    for (const m of [13, 14, 15]) await applyReport({ component: 'evolution-db', status: 'up', now: base + m * MIN });
    expect(await listIncidents('open')).toHaveLength(0);
  });

  it('nunca reportó: no se cuenta como caído', async () => {
    for (const m of [0, 20, 40]) await cron(m);
    expect(await listIncidents('all')).toHaveLength(0);
  });

  it('guarda un minuto por componente y suma los días de las filas públicas', async () => {
    await cron(0);
    await cron(1, { email: { status: 'down', error: 'Resend API HTTP 503', ms: 1 } });
    await cron(2, { email: { status: 'down', error: 'Resend API HTTP 503', ms: 1 } });
    const minutes = (await getDb().prepare('SELECT COUNT(*) AS n FROM status_minutes').get()) as { n: number };
    expect(Number(minutes.n)).toBe(12);
    const pub = await publicStatus(base + 2 * MIN);
    const email = pub.components.find((c) => c.id === 'email')!;
    expect(email.status).toBe('down');
    const today = Math.floor((base + 2 * MIN) / 86_400_000);
    // El minuto 1 todavía no tenía incidente (una falla suelta no se muestra); el 2 sí.
    expect(email.days).toEqual([[today, 2, 0, 1]]);
  });
});
