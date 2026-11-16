import { mkdtemp, realpath, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LidRepairReport } from '@/lib/wa-dedupe-repair';

/**
 * Runner de trabajos de mantenimiento del cron (lib/maintenance-jobs.ts): MAINTENANCE_JOBS, tandas que se retoman,
 * dry que no escribe, apply que espera al dry y un informe solo con cuentas.
 */
const { getClient, getDb, ensureMigrated } = await import('@/lib/db');
const { parseMaintenanceJobs, runMaintenanceJobs, listMaintenanceJobs } = await import('@/lib/maintenance-jobs');

const HOST = 'mjhost99.public.blob.vercel-storage.com';
const WS = 'ws-maint-jobs-test';
const PHONE = '5491155550000';
const photo = `https://${HOST}/chat/77777777-2222-4333-8444-555555555555-foto-de-juana.jpg`;
const doc = `https://${HOST}/docs/88888888-2222-4333-8444-555555555555-contrato-juana.pdf`;
const originals = new Map<string, Buffer>();
const deleted: string[] = [];

const files = {
  tables: ['mj_test_items'],
  sizeOf: async (url: string) => originals.get(url)?.length ?? null,
  readOriginal: async (url: string) => {
    const b = originals.get(url);
    if (!b) return null;
    return (async function* () {
      yield new Uint8Array(b);
    })();
  },
  deleteOriginal: async (url: string) => {
    deleted.push(url);
    originals.delete(url);
  },
};

const lidCalls: boolean[] = [];
const lidRepair = async (_c: unknown, opts: { apply: boolean }): Promise<LidRepairReport> => {
  lidCalls.push(opts.apply);
  const counts = { merged: 2, renamed: 1, messages: 3 };
  return { applied: opts.apply, before: { inboxLidThreads: 4 }, inbox: counts, lines: counts, inboxLidHandles: 1, after: { inboxLidThreads: opts.apply ? 2 : 4 } };
};

const lines: string[] = [];
const run = (env: string, budgetMs = 20_000) => runMaintenanceJobs({ env, budgetMs, files, lidRepair, log: (l) => lines.push(l) });
const rowUrl = async (id: string) => ((await getDb().prepare('SELECT url FROM mj_test_items WHERE id = ?').get(id)) as { url: string }).url;
const job = async (name: string, mode: string) => (await listMaintenanceJobs()).find((r) => r.job === name && r.mode === mode);

describe('MAINTENANCE_JOBS', () => {
  it('lee trabajo:modo, ignora lo desconocido, sin repetidos y con los dry primero', () => {
    const r = parseMaintenanceJobs(' files-migrate:apply , lid-repair:dry,files-migrate:dry,files-migrate:dry,lid-repair:apply-delete,nope:dry,files-scheduled, ,files-scheduled:dry:x');
    expect(r.jobs).toEqual([
      { job: 'lid-repair', mode: 'dry' },
      { job: 'files-migrate', mode: 'dry' },
      { job: 'files-migrate', mode: 'apply' },
    ]);
    expect(r.invalid).toEqual(['lid-repair:apply-delete', 'nope:dry', 'files-scheduled', 'files-scheduled:dry:x']);
    expect(parseMaintenanceJobs(undefined).jobs).toEqual([]);
    expect(parseMaintenanceJobs('files-migrate:apply-delete,files-scheduled:apply-delete').jobs).toHaveLength(2);
    expect(parseMaintenanceJobs('__proto__:dry').jobs).toEqual([]);
  });

  it('sin la variable no corre nada', async () => {
    expect(await runMaintenanceJobs({ env: '', files, lidRepair })).toBeNull();
    expect(await runMaintenanceJobs({ env: '   ', files, lidRepair })).toBeNull();
    expect(lidCalls).toEqual([]);
  });
});

describe('runner de mantenimiento', () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'zs-maint-')));
    process.env.UPLOADS_DIR = tmp;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.FILES_BLOB_READ_WRITE_TOKEN;
    delete process.env.VERCEL;
    process.env.FILES_LEGACY_BLOB_HOST = HOST;
    originals.set(photo, Buffer.alloc(2_000, 3));
    originals.set(doc, Buffer.from('%PDF-contrato'));
    await ensureMigrated();
    await getClient().execute('CREATE TABLE IF NOT EXISTS mj_test_items (id TEXT PRIMARY KEY, user_id TEXT, url TEXT, body TEXT)');
    const ins = getDb().prepare('INSERT INTO mj_test_items (id, user_id, url, body) VALUES (?, ?, ?, ?)');
    await ins.run('a', WS, photo, `Juana ${PHONE}`);
    await ins.run('b', WS, photo, '');
    await ins.run('c', WS, doc, 'contrato');
  });
  beforeEach(() => {
    lines.length = 0;
  });
  afterAll(async () => {
    delete process.env.FILES_LEGACY_BLOB_HOST;
    await rm(tmp, { recursive: true, force: true });
  });

  it('apply no arranca sin un dry terminado', async () => {
    const r = await run('lid-repair:apply,files-migrate:apply,files-migrate:apply-delete');
    expect(r!.map((x) => x.status)).toEqual(['waiting', 'waiting', 'waiting']);
    expect(lidCalls).toEqual([]);
    expect(await job('lid-repair', 'apply')).toBeUndefined();
    expect(await rowUrl('a')).toBe(photo);
    expect(lines[0]).toMatch(/^\[maintenance\] lid-repair apply: waiting/);
  });

  it('dry de a tandas: se retoma entre ticks, cuenta sin repetir y no escribe nada', async () => {
    const storedBefore = Number((await getClient().execute('SELECT COUNT(*) AS n FROM stored_files')).rows[0].n);
    // Presupuesto 0: cada tick hace lo mínimo (una fila o un paso del cursor) y guarda dónde quedó.
    let ticks = 0;
    for (; ticks < 40; ticks++) {
      const [r] = (await run('files-migrate:dry', 0))!;
      if (r.status === 'done') break;
      expect(r.status).toBe('running');
    }
    expect(ticks).toBeGreaterThan(2);
    const row = (await job('files-migrate', 'dry'))!;
    expect(row.status).toBe('done');
    expect(row.report).toMatchObject({ files: 2, bytes: 2_000 + 13, scannedRows: 3, copied: 0, registered: 0, rewrittenCells: 0, deleted: 0 });
    expect(row.report.byFolder).toEqual({ chat: { files: 1, bytes: 2_000 }, docs: { files: 1, bytes: 13 } });
    // Nada escrito: ni filas de archivos, ni celdas reescritas, ni originales borrados.
    expect(Number((await getClient().execute('SELECT COUNT(*) AS n FROM stored_files')).rows[0].n)).toBe(storedBefore);
    expect(await rowUrl('a')).toBe(photo);
    expect(await rowUrl('c')).toBe(doc);
    expect(deleted).toEqual([]);
    // Lo contado se limpia al terminar.
    expect((await getClient().execute("SELECT COUNT(*) AS n FROM maintenance_job_seen WHERE run = 'files-migrate:dry'")).rows[0].n).toBe(0);
    expect(lines.at(-1)).toMatch(/^\[maintenance\] files-migrate dry: scanned 3 rows, would migrate 2 files \(0\.0 MB\).*done$/);
    // Terminado: el tick siguiente no lo vuelve a correr.
    const [again] = (await run('files-migrate:dry'))!;
    expect(again.status).toBe('done');
    expect((await job('files-migrate', 'dry'))!.ticks).toBe(row.ticks);
  });

  it('otro tick con el claim tomado no lo corre', async () => {
    await run('lid-repair:dry');
    expect(lidCalls).toEqual([false]);
    await getClient().execute({
      sql: "INSERT INTO maintenance_jobs (job, mode, status, started_at, updated_at, locked_until) VALUES ('files-scheduled', 'dry', 'running', 0, 0, ?)",
      args: [Date.now() + 60_000],
    });
    const [r] = (await run('files-scheduled:dry'))!;
    expect(r.status).toBe('busy');
    await getClient().execute("DELETE FROM maintenance_jobs WHERE job = 'files-scheduled'");
  });

  it('después del dry, apply migra y apply-delete borra los originales recién cuando apply terminó', async () => {
    const r = await run('lid-repair:apply,files-migrate:apply,files-migrate:apply-delete');
    // En el mismo tick: lid-repair apply y files apply terminan; apply-delete ve el apply recién terminado.
    expect(r!.map((x) => `${x.job}:${x.mode}:${x.status}`)).toEqual(['lid-repair:apply:done', 'files-migrate:apply:done', 'files-migrate:apply-delete:done']);
    expect(lidCalls).toEqual([false, true]);
    expect(await rowUrl('a')).toMatch(/^\/api\/files\//);
    expect(await rowUrl('b')).toBe(await rowUrl('a'));
    expect((await job('files-migrate', 'apply'))!.report).toMatchObject({ files: 2, copied: 2, rewrittenCells: 3, failed: 0 });
    const del = (await job('files-migrate', 'apply-delete'))!.report;
    expect(del).toMatchObject({ failed: 0 });
    expect(Number(del.deleted)).toBeGreaterThanOrEqual(2);
    expect(deleted).toEqual(expect.arrayContaining([doc, photo]));
  });

  it('apply-delete sin apply terminado espera', async () => {
    await getClient().execute("DELETE FROM maintenance_jobs WHERE job = 'files-scheduled'");
    await getClient().execute("INSERT INTO maintenance_jobs (job, mode, status, started_at, updated_at) VALUES ('files-scheduled', 'dry', 'done', 0, 0)");
    const [r] = (await run('files-scheduled:apply-delete'))!;
    expect(r.status).toBe('waiting');
    expect(r.line).toMatch(/apply has not finished/);
    await getClient().execute("DELETE FROM maintenance_jobs WHERE job = 'files-scheduled'");
  });

  it('el informe y el estado tienen solo cuentas: ni URLs, ni nombres, ni teléfonos, ni workspaces', async () => {
    const rs = await getClient().execute('SELECT * FROM maintenance_jobs');
    expect(rs.rows.length).toBeGreaterThanOrEqual(4);
    const all = JSON.stringify(rs.rows) + JSON.stringify((await getClient().execute('SELECT * FROM maintenance_job_seen')).rows) + lines.join('\n');
    for (const bad of [HOST, 'juana', 'Juana', 'foto', 'contrato', PHONE, WS, '/api/files/', 'http']) expect(all).not.toContain(bad);
    const allowed = new Set([
      'phase', 'scannedRows', 'files', 'bytes', 'byFolder', 'unmappedCells', 'unmapped', 'skippedFolders', 'registered', 'copied',
      'rewrittenCells', 'deleted', 'failed', 'failedByReason', 'applied', 'before', 'after', 'inbox', 'lines', 'inboxLidHandles',
    ]);
    for (const row of await listMaintenanceJobs()) for (const k of Object.keys(row.report)) expect(allowed.has(k), k).toBe(true);
  });
});
