import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.RATE_LIMIT_DISABLED = 'true';
});

import { getDb, upsertUser } from '@/lib/db';
import { createProject, deleteProject, type ProjectRow } from '@/lib/analytics/projects';
import { summarize, type ReplayChunk } from '@/lib/analytics/replay-core';
import { getRecording, listRecordings, recordingIdFor, runReplayRetention, storeChunk } from '@/lib/analytics/replay';
import { listReplayTrash, restoreReplayTrash } from '@/lib/analytics/trash';
import { runAnalyticsCron } from '@/lib/analytics/cron';
import { deletePerson } from '@/lib/analytics/persons';
import { storeEvents } from '@/lib/analytics/ingest';
import { getSoftDeleted, purgeDueSoftDeleted } from '@/lib/soft-delete';

// Todo se mide contra NOW (la grabación se guarda con ts de NOW y la retención corre con su propio `now`).
const DAY = 86_400_000;
const NOW = Date.now();

const meta = (ts: number) => ({ type: 4, timestamp: ts, data: { href: 'https://shop.test/pricing', width: 1280, height: 720 } });
const full = (ts: number) => ({ type: 2, timestamp: ts, data: { node: { type: 0, id: 1, childNodes: [] }, initialOffset: { top: 0, left: 0 } } });
const uid = () => Math.random().toString(36).slice(2, 10);

async function record(project: ProjectRow, distinctId = 'user-1'): Promise<string> {
  const sid = `sd-${uid()}`;
  const events = [meta(NOW), full(NOW)];
  const chunk: ReplayChunk = { sessionId: sid, windowId: 'window-0001', seq: 0, distinctId, events: events as never, skewMs: 0 };
  expect((await storeChunk(project, chunk, summarize(events as never, 0))).status).toBe('stored');
  return recordingIdFor(project.id, sid, 'window-0001');
}

const chunksOf = async (id: string) => Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM analytics_replay_chunks WHERE recording_id = ?').get(id)) as { n: number }).n);

describe('Analytics: la retención de replay pasa por la papelera', () => {
  let ws: string;
  let other: string;

  beforeAll(async () => {
    ws = `an-sd-${uid()}`;
    other = `an-sd-other-${uid()}`;
    await upsertUser({ id: ws, email: `${ws}@test.local`, name: 'Owner' });
    await upsertUser({ id: other, email: `${other}@test.local`, name: 'Other' });
  });

  it('entra a la papelera un tercio del plazo antes y se purga el mismo día que antes se borraba', async () => {
    const p = await createProject(ws, ws, `P ${uid()}`);
    const id = await record(p);
    // Día 15 de 30: todavía nada.
    await runReplayRetention({ now: NOW + 15 * DAY });
    expect(await listReplayTrash(ws, p.id)).toEqual([]);
    // Día 21: pasó a la papelera (gracia de 10 días), sale de la lista y no se puede leer.
    expect(await runReplayRetention({ now: NOW + 21 * DAY })).toBeGreaterThanOrEqual(1);
    const trash = await listReplayTrash(ws, p.id);
    expect(trash).toHaveLength(1);
    expect(trash[0].startedAt).toBe(new Date(NOW).toISOString());
    expect(Date.parse(trash[0].purgeAt)).toBe(NOW + 30 * DAY);
    expect(await getRecording(p, id, NOW + 21 * DAY)).toBeNull();
    expect((await listRecordings(p, {}, NOW + 21 * DAY)).recordings).toEqual([]);
    // Los chunks siguen hasta la purga, sin nada que los lea.
    expect(await chunksOf(id)).toBe(1);
    // Antes del plazo, la purga no la toca; en el plazo, se va con sus chunks.
    await purgeDueSoftDeleted(new Date(NOW + 29 * DAY));
    expect(await listReplayTrash(ws, p.id)).toHaveLength(1);
    await purgeDueSoftDeleted(new Date(NOW + 30 * DAY + 1000));
    expect(await listReplayTrash(ws, p.id)).toEqual([]);
    expect(await chunksOf(id)).toBe(0);
  });

  it('restaurar la devuelve con sus chunks y su retención vuelve a contar desde ahí', async () => {
    const p = await createProject(ws, ws, `P ${uid()}`);
    const id = await record(p);
    await runReplayRetention({ now: NOW + 21 * DAY });
    const [entry] = await listReplayTrash(ws, p.id);
    // Otro workspace no la ve ni la restaura.
    expect(await listReplayTrash(other, p.id)).toEqual([]);
    expect(await restoreReplayTrash(other, p.id, entry.id)).toEqual({ ok: false, reason: 'not_found' });
    // Por otro proyecto del mismo workspace tampoco.
    const q = await createProject(ws, ws, `Q ${uid()}`);
    expect(await restoreReplayTrash(ws, q.id, entry.id)).toEqual({ ok: false, reason: 'not_found' });

    const restoredAt = NOW + 22 * DAY;
    const res = await restoreReplayTrash(ws, p.id, entry.id, restoredAt);
    expect(res.ok).toBe(true);
    expect(await getSoftDeleted(ws, 'analytics', entry.id)).toBeNull();
    expect((await getRecording(p, id, restoredAt))?.id).toBe(id);
    expect((await listRecordings(p, {}, restoredAt)).recordings.map((r) => r.id)).toEqual([id]);
    expect(await chunksOf(id)).toBe(1);
    // La limpieza siguiente no la vuelve a mandar enseguida (cuenta desde la restauración).
    await getDb().prepare('UPDATE analytics_projects SET replay_purged_at = NULL WHERE id = ?').run(p.id);
    await runReplayRetention({ now: restoredAt + 2 * DAY });
    expect((await listRecordings(p, {}, restoredAt + 2 * DAY)).recordings).toHaveLength(1);
    // Una segunda restauración de la misma entrada: ya no está.
    expect(await restoreReplayTrash(ws, p.id, entry.id)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('si la misma sesión se volvió a grabar, restaurar da conflicto y la entrada queda', async () => {
    const p = await createProject(ws, ws, `P ${uid()}`);
    const id = await record(p);
    await runReplayRetention({ now: NOW + 21 * DAY });
    const [entry] = await listReplayTrash(ws, p.id);
    // Algo ocupó su lugar (misma sesión y ventana: mismo id).
    await getDb()
      .prepare(
        `INSERT INTO analytics_replay_recordings (id, project_id, session_id, window_id, distinct_id, start_ts, end_ts, has_snapshot, created_at)
         SELECT ?, ?, 'other-session', 'w', 'user-1', ?, ?, 1, ?`,
      )
      .run(id, p.id, NOW, NOW, NOW);
    expect(await restoreReplayTrash(ws, p.id, entry.id)).toEqual({ ok: false, reason: 'conflict' });
    expect(await listReplayTrash(ws, p.id)).toHaveLength(1);
  });

  it('borrar una persona se lleva sus grabaciones de la papelera con sus chunks', async () => {
    const p = await createProject(ws, ws, `P ${uid()}`);
    await storeEvents(p, [{ event: '$pageview', distinctId: 'gone-user', properties: {}, ts: NOW, uuid: null, set: null, setOnce: null }], null);
    const gone = await record(p, 'gone-user');
    const kept = await record(p, 'kept-user');
    await runReplayRetention({ now: NOW + 21 * DAY });
    expect(await listReplayTrash(ws, p.id)).toHaveLength(2);
    const person = (await getDb().prepare('SELECT person_id FROM analytics_person_ids WHERE project_id = ? AND distinct_id = ?').get(p.id, 'gone-user')) as { person_id: string };
    await deletePerson(p.id, person.person_id);
    expect(await listReplayTrash(ws, p.id)).toHaveLength(1);
    expect(await chunksOf(gone)).toBe(0);
    expect(await chunksOf(kept)).toBe(1);
  });

  it('un proyecto borrado se lleva su papelera', async () => {
    const p = await createProject(ws, ws, `P ${uid()}`);
    const id = await record(p);
    await runReplayRetention({ now: NOW + 21 * DAY });
    expect(await listReplayTrash(ws, p.id)).toHaveLength(1);
    await deleteProject(ws, p.id);
    await runAnalyticsCron({ budgetMs: 10_000 });
    const left = (await getDb().prepare("SELECT COUNT(*) AS n FROM soft_deleted WHERE app = 'analytics' AND scope_id = ?").get(p.id)) as { n: number };
    expect(Number(left.n)).toBe(0);
    expect(await chunksOf(id)).toBe(0);
  });
});
