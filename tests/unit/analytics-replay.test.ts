import { randomBytes } from 'crypto';
import { gzipSync } from 'zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Topes chicos para poder pasarlos en el test (replay-core los lee al importarse).
vi.hoisted(() => {
  process.env.ANALYTICS_REPLAY_SESSION_BYTES = '40000';
  process.env.ANALYTICS_REPLAY_SESSIONS_PER_DAY = '3';
  process.env.ANALYTICS_REPLAY_BYTES_PER_DAY = '200000';
  process.env.RATE_LIMIT_DISABLED = 'true';
});

import { getDb, upsertUser } from '@/lib/db';
import { createProject, deleteProject, forgetProjectCache, updateProject, type ProjectRow } from '@/lib/analytics/projects';
import { framingAllowed, parseChunk, recordingRetentionDays, REPLAY_LIMITS, replayConfig, sampleBucket, sampledIn, summarize, type ReplayChunk } from '@/lib/analytics/replay-core';
import { deleteRecording, getRecording, listRecordings, purgeProjectRecordings, recordingChunks, recordingIdFor, runReplayRetention, storeChunk } from '@/lib/analytics/replay';
import { handleReplayIngest } from '@/lib/analytics/replay-http';
import { aggregateClicks, aggregateScroll, frameableUrl, HEATMAP_LIMITS, rangeStart, viewportBucket } from '@/lib/analytics/heatmap-core';
import { recordProjectId } from '@/lib/analytics/guard';
import { recordProject } from '@/lib/analytics/http';
import { runAnalyticsCron } from '@/lib/analytics/cron';
import { deletePerson } from '@/lib/analytics/persons';
import { storeEvents } from '@/lib/analytics/ingest';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const DAY = 86_400_000;
const SID = 'session-0001';

const meta = (ts: number, href = 'https://shop.test/pricing') => ({ type: 4, timestamp: ts, data: { href, width: 1280, height: 720 } });
const full = (ts: number) => ({ type: 2, timestamp: ts, data: { node: { type: 0, id: 1, childNodes: [] }, initialOffset: { top: 0, left: 0 } } });
const click = (ts: number) => ({ type: 3, timestamp: ts, data: { source: 2, type: 2, id: 5, x: 1, y: 1 } });
const envelope = (events: unknown[], extra: Record<string, unknown> = {}) => ({ session_id: SID, window_id: 'window-0001', seq: 0, distinct_id: 'user-1', events, ...extra });

describe('replay: un chunk tiene que ser rrweb de verdad', () => {
  it('acepta un chunk válido y calcula todo en el servidor', () => {
    const r = parseChunk(envelope([meta(NOW - 5000), full(NOW - 5000), click(NOW - 3000), click(NOW - 1000)], { clicks: 999, active_seconds: 999 }), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toMatchObject({ clicks: 2, activeSeconds: 2, hasSnapshot: true, startTs: NOW - 5000, endTs: NOW - 1000, pages: ['https://shop.test/pricing'] });
  });

  it('rechaza lo que no tiene la forma', () => {
    const bad: unknown[] = [
      null,
      [],
      'x',
      envelope([]),
      envelope('nope' as never),
      envelope([{ type: 99, timestamp: NOW, data: {} }]),
      // Plugin: el player no lo usa, no entra.
      envelope([{ type: 6, timestamp: NOW, data: { plugin: 'x', payload: {} } }]),
      envelope([{ type: 3, timestamp: NOW, data: { source: 77 } }]),
      envelope([{ type: 3, timestamp: NOW, data: [] }]),
      envelope([{ type: 2, timestamp: NOW, data: { node: 'html' } }]),
      envelope([{ type: 4, timestamp: NOW, data: { href: 1 } }]),
      envelope([{ type: 3, timestamp: 'ayer', data: { source: 1 } }]),
      envelope([{ type: 3, timestamp: NaN, data: { source: 1 } }]),
      envelope([meta(NOW)], { session_id: '../../etc' }),
      envelope([meta(NOW)], { session_id: 'corto' }),
      envelope([meta(NOW)], { window_id: 'con espacios y más' }),
      envelope([meta(NOW)], { seq: -1 }),
      envelope([meta(NOW)], { seq: 1.5 }),
      envelope([meta(NOW)], { distinct_id: '' }),
    ];
    for (const b of bad) expect(parseChunk(b, NOW).ok, JSON.stringify(b)?.slice(0, 80)).toBe(false);
  });

  it('un solo evento malo rechaza el chunk, y solo se guardan type, data y timestamp', () => {
    expect(parseChunk(envelope([meta(NOW), { type: 99 }]), NOW).ok).toBe(false);
    const r = parseChunk(envelope([{ ...meta(NOW), evil: '<script>' }]), NOW);
    expect(r.ok && Object.keys(r.chunk.events[0]).sort()).toEqual(['data', 'timestamp', 'type']);
  });

  it('demasiados eventos', () => {
    const many = Array.from({ length: REPLAY_LIMITS.maxEventsPerChunk + 1 }, () => click(NOW));
    expect(parseChunk(envelope(many), NOW)).toEqual({ ok: false, error: 'too_many_events' });
  });

  it('fechas: fuera de rango se rechaza y el reloj corrido se corrige con sent_at', () => {
    expect(parseChunk(envelope([meta(NOW - 2 * DAY)]), NOW).ok).toBe(false);
    expect(parseChunk(envelope([meta(NOW + 2 * 3_600_000)]), NOW).ok).toBe(false);
    expect(parseChunk(envelope([meta(NOW - 10 * 3_600_000), meta(NOW)]), NOW).ok).toBe(false);
    // Reloj del cliente 3 horas atrás.
    const skew = 3 * 3_600_000;
    const r = parseChunk(envelope([meta(NOW - skew - 1000)], { sent_at: NOW - skew }), NOW);
    expect(r.ok && r.summary.startTs).toBe(NOW - 1000);
  });

  it('solo páginas http(s) en la metadata', () => {
    const s = summarize([meta(NOW, 'javascript:alert(1)'), meta(NOW, 'data:text/html,x'), meta(NOW, 'https://ok.test/a#frag')] as never, 0);
    expect(s.pages).toEqual(['https://ok.test/a']);
  });

  it('segundos activos sin contar mutaciones ni repetir el mismo segundo', () => {
    const mutation = { type: 3, timestamp: NOW, data: { source: 0, adds: [], removes: [], texts: [], attributes: [] } };
    const s = summarize([mutation, click(NOW), click(NOW + 100), click(NOW + 5000)] as never, 0);
    expect(s.activeSeconds).toBe(2);
    expect(s.clicks).toBe(3);
  });
});

describe('replay: ajustes', () => {
  it('muestra por sesión, igual que el snippet', () => {
    expect(sampleBucket('abcdefgh')).toBeGreaterThanOrEqual(0);
    expect(sampleBucket('abcdefgh')).toBeLessThan(100);
    expect(sampledIn('abcdefgh', 100)).toBe(true);
    let inside = 0;
    for (let i = 0; i < 2000; i++) if (sampledIn(`session-${i}-${i * 7}`, 10)) inside++;
    expect(inside).toBeGreaterThan(100);
    expect(inside).toBeLessThan(320);
  });

  it('retención: 30 días como máximo, la del proyecto si es menor', () => {
    expect(recordingRetentionDays(365)).toBe(30);
    expect(recordingRetentionDays(7)).toBe(7);
  });

  it('decide: apagado por defecto, y nada con Do Not Track', () => {
    const base = { replay_enabled: 0, replay_sample_rate: 100, replay_mask_text: 1, heatmaps_enabled: 0, autocapture: 1 };
    expect(replayConfig(base, false)).toEqual({ replay: false, heatmaps: false });
    const on = { ...base, replay_enabled: 1, heatmaps_enabled: 1, replay_sample_rate: 20 };
    expect(replayConfig(on, false)).toEqual({ replay: { enabled: true, sampleRate: 20, maskAllText: true }, heatmaps: true });
    expect(replayConfig(on, true)).toEqual({ replay: false, heatmaps: false });
    // Los heatmaps salen de los clics de autocapture.
    expect(replayConfig({ ...on, autocapture: 0 }, false).heatmaps).toBe(false);
  });

  it('enmarcar: X-Frame-Options y frame-ancestors', () => {
    const h = (o: Record<string, string>) => new Headers(o);
    const app = 'https://zerosoft.ai';
    expect(framingAllowed(h({}), app)).toBe(true);
    expect(framingAllowed(h({ 'x-frame-options': 'DENY' }), app)).toBe(false);
    expect(framingAllowed(h({ 'x-frame-options': 'sameorigin' }), app)).toBe(false);
    expect(framingAllowed(h({ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" }), app)).toBe(false);
    expect(framingAllowed(h({ 'content-security-policy': "frame-ancestors 'self'" }), app)).toBe(false);
    expect(framingAllowed(h({ 'content-security-policy': 'frame-ancestors https://zerosoft.ai' }), app)).toBe(true);
    expect(framingAllowed(h({ 'content-security-policy': 'frame-ancestors https://*.zerosoft.ai' }), 'https://app.zerosoft.ai')).toBe(true);
    expect(framingAllowed(h({ 'content-security-policy': 'frame-ancestors https://otro.test' }), app)).toBe(false);
    expect(framingAllowed(h({ 'content-security-policy': 'frame-ancestors *' }), app)).toBe(true);
    expect(framingAllowed(h({ 'content-security-policy': "default-src 'self'" }), app)).toBe(true);
  });
});

describe('heatmaps: los valores vienen del cliente', () => {
  const row = (o: Record<string, unknown> = {}) => ({ x: 0.5, y: 100, viewport: 1280, docHeight: 2000, tag: 'button', text: 'Buy', href: '', ...o });

  it('ignora la basura y no recorta valores inventados', () => {
    const junk = [
      row({ x: 999 }),
      row({ x: -0.1 }),
      row({ x: 'NaN' }),
      row({ x: null }),
      row({ y: -5 }),
      row({ y: 1e12 }),
      row({ y: {} }),
      row({ viewport: 1 }),
      row({ viewport: 1e9 }),
      row({ x: [1] }),
    ];
    const r = aggregateClicks(junk as never, 'desktop');
    expect(r.total).toBe(0);
    expect(r.ignored).toBe(junk.length);
    expect(r.points).toEqual([]);
  });

  it('agrupa por celda y por tamaño de pantalla', () => {
    const rows = [row(), row(), row({ viewport: 390 }), row({ viewport: 800 }), row({ x: 0.1, y: 300 })];
    const desktop = aggregateClicks(rows as never, 'desktop');
    expect(desktop.total).toBe(3);
    expect(desktop.maxCell).toBe(2);
    expect(desktop.elements[0]).toMatchObject({ tag: 'button', text: 'Buy', count: 3 });
    expect(aggregateClicks(rows as never, 'mobile').total).toBe(1);
    expect(aggregateClicks(rows as never, 'tablet').total).toBe(1);
    expect(viewportBucket(767)).toBe('mobile');
    expect(viewportBucket(768)).toBe('tablet');
    expect(viewportBucket(1024)).toBe('desktop');
  });

  it('un alto de página loco no estira el dibujo', () => {
    const r = aggregateClicks([row({ docHeight: 1e7 }), row({ docHeight: 1e7, y: 199_000 })] as never, 'desktop');
    expect(r.docHeight).toBeLessThanOrEqual(HEATMAP_LIMITS.maxDocHeight);
    expect(r.points.every((p) => p.y <= r.docHeight)).toBe(true);
  });

  it('scroll: el mayor por vista, solo valores de 0 a 100', () => {
    const leave = (viewId: string, depth: unknown, viewport: unknown = 1280) => ({ viewId, depth, viewport });
    const r = aggregateScroll([leave('a', 30), leave('a', 90), leave('b', 40), leave('c', 500), leave('d', 'x'), leave('e', 50, 390)] as never, 'desktop');
    expect(r.views).toBe(2);
    expect(r.steps.find((s) => s.depth === 40)).toMatchObject({ reached: 2, share: 1 });
    expect(r.steps.find((s) => s.depth === 50)).toMatchObject({ reached: 1, share: 0.5 });
    expect(r.steps.find((s) => s.depth === 100)).toMatchObject({ reached: 0 });
  });

  it('solo se enmarcan http(s), con la ruta y el dominio del proyecto', () => {
    const any = () => true;
    expect(frameableUrl('https://shop.test/a?x=1', '/a', any)).toBe('https://shop.test/a?x=1');
    expect(frameableUrl('javascript:alert(1)', '/a', any)).toBeNull();
    expect(frameableUrl('data:text/html,hola', '/a', any)).toBeNull();
    expect(frameableUrl('https://user:pw@shop.test/a', '/a', any)).toBeNull();
    expect(frameableUrl('https://shop.test/otra', '/a', any)).toBeNull();
    expect(frameableUrl('https://evil.test/a', '/a', (h) => h === 'shop.test')).toBeNull();
    expect(frameableUrl(42, '/a', any)).toBeNull();
    expect(rangeStart('-7d', NOW)).toBe(NOW - 7 * DAY);
    expect(rangeStart('; DROP', NOW)).toBeNull();
  });
});

describe('replay con base', () => {
  let p: ProjectRow;
  let other: ProjectRow;
  const now = Date.now();
  const chunkOf = (sid: string, seq: number, events: unknown[], win = 'window-0001'): ReplayChunk => ({ sessionId: sid, windowId: win, seq, distinctId: 'user-1', events: events as never, skewMs: 0 });
  const noise = (n: number) => randomBytes(n).toString('base64');
  const summary = (events: unknown[]) => summarize(events as never, 0);
  const store = (project: ProjectRow, sid: string, seq: number, events: unknown[], distinct = 'user-1') =>
    storeChunk(project, { ...chunkOf(sid, seq, events), distinctId: distinct }, summary(events));

  beforeAll(async () => {
    await upsertUser({ id: 'rep-owner', email: 'rep-owner@test.local', name: 'Owner' });
    await upsertUser({ id: 'rep-other', email: 'rep-other@test.local', name: 'Other' });
    p = await createProject('rep-owner', 'rep-owner', 'Replay');
    other = await createProject('rep-other', 'rep-other', 'Other');
  });

  it('un proyecto nuevo arranca con todo apagado', () => {
    expect(p.replay_enabled).toBe(0);
    expect(p.heatmaps_enabled).toBe(0);
  });

  it('un reintento del mismo chunk no duplica nada', async () => {
    const ev = [meta(now - 2000), full(now - 2000), click(now - 1000)];
    expect((await store(p, 'retry-session', 0, ev)).status).toBe('stored');
    const before = (await getDb().prepare('SELECT bytes, sessions FROM analytics_replay_daily WHERE project_id = ?').get(p.id)) as { bytes: number; sessions: number };
    expect((await store(p, 'retry-session', 0, ev)).status).toBe('duplicate');
    const after = (await getDb().prepare('SELECT bytes, sessions FROM analytics_replay_daily WHERE project_id = ?').get(p.id)) as { bytes: number; sessions: number };
    expect(after).toEqual(before);
    const id = recordingIdFor(p.id, 'retry-session', 'window-0001');
    const rec = await getRecording(p, id);
    expect(rec).toMatchObject({ clicks: 1, chunks: 1, firstUrl: 'https://shop.test/pricing' });
    expect(await recordingChunks(id, -1)).toMatchObject({ next: null, chunks: [{ seq: 0 }] });
  });

  it('un segundo chunk suma a la metadata', async () => {
    await store(p, 'retry-session', 1, [click(now - 500), meta(now - 400, 'https://shop.test/checkout')]);
    const rec = await getRecording(p, recordingIdFor(p.id, 'retry-session', 'window-0001'));
    expect(rec).toMatchObject({ clicks: 2, chunks: 2, pages: ['https://shop.test/pricing', 'https://shop.test/checkout'] });
  });

  it('sin foto inicial no aparece en la lista', async () => {
    const q = await createProject('rep-owner', 'rep-owner', 'NoSnap');
    await store(q, 'no-snapshot-1', 0, [click(now)]);
    expect((await listRecordings(q)).recordings).toEqual([]);
  });

  it('tope por sesión: lo que pasa se rechaza y devuelve el cupo del día', async () => {
    const q = await createProject('rep-owner', 'rep-owner', 'Cap');
    const big = (ts: number) => ({ ...meta(ts), data: { href: 'https://shop.test/x', width: 1, height: 1, junk: noise(16_000) } });
    expect((await store(q, 'cap-session-1', 0, [big(now)])).status).toBe('stored');
    expect((await store(q, 'cap-session-1', 1, [big(now)])).status).toBe('stored');
    const before = (await getDb().prepare('SELECT bytes FROM analytics_replay_daily WHERE project_id = ?').get(q.id)) as { bytes: number };
    // Este pasa el tope de 40 KB de la sesión.
    expect(await store(q, 'cap-session-1', 2, [big(now)])).toEqual({ status: 'rejected', http: 413, error: 'session_too_large' });
    const after = (await getDb().prepare('SELECT bytes FROM analytics_replay_daily WHERE project_id = ?').get(q.id)) as { bytes: number };
    expect(after.bytes).toBe(before.bytes);
    expect((await getRecording(q, recordingIdFor(q.id, 'cap-session-1', 'window-0001')))).toBeNull();
    const row = (await getDb().prepare('SELECT chunks FROM analytics_replay_recordings WHERE project_id = ?').get(q.id)) as { chunks: number };
    expect(row.chunks).toBe(2);
  });

  it('tope de duración de una sesión', async () => {
    const q = await createProject('rep-owner', 'rep-owner', 'Long');
    await store(q, 'long-session-1', 0, [meta(now - 7 * 3_600_000)]);
    expect(await store(q, 'long-session-1', 1, [meta(now)])).toEqual({ status: 'rejected', http: 413, error: 'session_too_long' });
  });

  it('tope de sesiones por día y de bytes por día', async () => {
    const q = await createProject('rep-owner', 'rep-owner', 'Daily');
    for (const s of ['daily-sess-1', 'daily-sess-2', 'daily-sess-3']) expect((await store(q, s, 0, [meta(now)])).status).toBe('stored');
    expect(await store(q, 'daily-sess-4', 0, [meta(now)])).toEqual({ status: 'rejected', http: 429, error: 'daily_sessions_cap' });
    // Una sesión que ya existe puede seguir mientras haya bytes.
    expect((await store(q, 'daily-sess-1', 1, [meta(now)])).status).toBe('stored');
    await getDb().prepare('UPDATE analytics_replay_daily SET bytes = ? WHERE project_id = ?').run(REPLAY_LIMITS.maxBytesPerDay, q.id);
    expect(await store(q, 'daily-sess-1', 2, [meta(now)])).toEqual({ status: 'rejected', http: 429, error: 'daily_bytes_cap' });
  });

  it('filtros de la lista', async () => {
    const q = await createProject('rep-owner', 'rep-owner', 'Filters');
    await store(q, 'filter-sess-1', 0, [meta(now - 60_000, 'https://shop.test/a/b'), full(now - 60_000), click(now)], 'ana');
    await store(q, 'filter-sess-2', 0, [meta(now - 2000, 'https://shop.test/c'), full(now - 1000)], 'beto');
    expect((await listRecordings(q)).recordings).toHaveLength(2);
    expect((await listRecordings(q, { person: 'ana' })).recordings.map((r) => r.distinctId)).toEqual(['ana']);
    expect((await listRecordings(q, { url: '/a/b' })).recordings.map((r) => r.distinctId)).toEqual(['ana']);
    expect((await listRecordings(q, { minDurationMs: 30_000 })).recordings.map((r) => r.distinctId)).toEqual(['ana']);
    expect((await listRecordings(q, { person: "%' OR 1=1 --" })).recordings).toEqual([]);
  });

  it('una grabación de otro workspace responde igual que una que no existe', async () => {
    const id = recordingIdFor(p.id, 'retry-session', 'window-0001');
    expect(await recordProjectId('recordings', id, 'rep-other')).toBeNull();
    expect(await recordProjectId('recordings', id, 'rep-owner')).toBe(p.id);
    const res = await recordProject({ workspaceId: 'rep-other', personId: 'rep-other', role: 'owner', user: null }, 'analytics_replay_recordings', id);
    expect((res as Response).status).toBe(404);
    const mine = await recordProject({ workspaceId: 'rep-owner', personId: 'rep-owner', role: 'member', user: null }, 'analytics_replay_recordings', id);
    expect((mine as ProjectRow).id).toBe(p.id);
    // Y por el proyecto equivocado tampoco se lee.
    expect(await getRecording(other, id)).toBeNull();
    expect(await deleteRecording(other.id, id)).toBe(false);
  });

  it('borrar una persona borra sus grabaciones', async () => {
    const q = await createProject('rep-owner', 'rep-owner', 'Person');
    await storeEvents(q, [{ event: '$pageview', distinctId: 'gone-user', properties: {}, ts: now, uuid: null, set: null, setOnce: null }], null);
    await store(q, 'gone-session', 0, [meta(now), full(now)], 'gone-user');
    await store(q, 'kept-session', 0, [meta(now), full(now)], 'kept-user');
    const person = (await getDb().prepare('SELECT person_id FROM analytics_person_ids WHERE project_id = ? AND distinct_id = ?').get(q.id, 'gone-user')) as { person_id: string };
    expect((await listRecordings(q, { personId: person.person_id })).recordings).toHaveLength(1);
    await deletePerson(q.id, person.person_id);
    expect((await listRecordings(q)).recordings.map((r) => r.distinctId)).toEqual(['kept-user']);
    const chunks = (await getDb().prepare('SELECT COUNT(*) AS n FROM analytics_replay_chunks WHERE session_id = ?').get('gone-session')) as { n: number };
    expect(Number(chunks.n)).toBe(0);
  });

  it('retención: se purga lo vencido, sin tocar a otros proyectos ni lo reciente', async () => {
    const q = await createProject('rep-owner', 'rep-owner', 'Retention');
    await store(q, 'old-session-1', 0, [meta(now), full(now)]);
    const later = now + 31 * DAY;
    await store(other, 'keep-other-1', 0, [meta(now), full(now)]);
    await getDb().prepare('UPDATE analytics_replay_recordings SET start_ts = ?, end_ts = ? WHERE project_id = ? AND session_id = ?').run(later - DAY, later - DAY, other.id, 'keep-other-1');
    const purged = await runReplayRetention({ now: later });
    expect(purged).toBeGreaterThan(0);
    expect((await getDb().prepare('SELECT COUNT(*) AS n FROM analytics_replay_recordings WHERE project_id = ?').get(q.id)) as { n: number }).toMatchObject({ n: 0 });
    expect((await getDb().prepare('SELECT COUNT(*) AS n FROM analytics_replay_chunks WHERE project_id = ?').get(q.id)) as { n: number }).toMatchObject({ n: 0 });
    expect((await getDb().prepare('SELECT COUNT(*) AS n FROM analytics_replay_recordings WHERE project_id = ?').get(other.id)) as { n: number }).toMatchObject({ n: 1 });
    // Reclamado: una segunda corrida enseguida no hace el trabajo de nuevo.
    await store(q, 'old-session-2', 0, [meta(now), full(now)]);
    expect(await runReplayRetention({ now: later + 1000 })).toBe(0);
  });

  it('proyecto con retención corta: manda la del proyecto', async () => {
    const q = await createProject('rep-owner', 'rep-owner', 'Short');
    await updateProject('rep-owner', q.id, { retentionDays: 2 });
    const fresh = (await getDb().prepare('SELECT * FROM analytics_projects WHERE id = ?').get(q.id)) as unknown as ProjectRow;
    await store(fresh, 'short-session', 0, [meta(now), full(now)]);
    expect(await runReplayRetention({ now: now + 3 * DAY })).toBeGreaterThanOrEqual(1);
    expect((await listRecordings(fresh, {}, now + 3 * DAY)).recordings).toEqual([]);
  });

  it('un proyecto borrado se purga, por tandas si hace falta', async () => {
    const q = await createProject('rep-owner', 'rep-owner', 'Deleted');
    await store(q, 'deleted-session', 0, [meta(now), full(now)]);
    // Sin tiempo: no borra nada y avisa que falta.
    expect(await purgeProjectRecordings(q.id, () => 0)).toBe(false);
    await deleteProject('rep-owner', q.id);
    await runAnalyticsCron({ budgetMs: 10_000 });
    for (const table of ['analytics_replay_chunks', 'analytics_replay_recordings', 'analytics_replay_daily', 'analytics_projects']) {
      const col = table === 'analytics_projects' ? 'id' : 'project_id';
      const row = (await getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(q.id)) as { n: number };
      expect(Number(row.n), table).toBe(0);
    }
  });

  describe('POST /api/ingest/replay', () => {
    let on: ProjectRow;
    const post = (body: BodyInit | null, headers: Record<string, string> = {}, key = on.public_key) =>
      handleReplayIngest(new Request(`http://localhost/api/ingest/replay?k=${encodeURIComponent(key)}`, { method: 'POST', body, headers: { origin: 'https://shop.test', ...headers } }));
    const ok = (seq = 0) => JSON.stringify(envelope([meta(Date.now()), full(Date.now())], { session_id: 'http-session-1', seq, sent_at: Date.now() }));

    beforeAll(async () => {
      on = await createProject('rep-owner', 'rep-owner', 'Http');
    });

    it('apagado: 403 y no se guarda', async () => {
      const res = await post(ok());
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'replay_disabled' });
    });

    it('prendido: plano y gzip guardan; key inválida, 401', async () => {
      on = (await updateProject('rep-owner', on.id, { replayEnabled: true }))!;
      forgetProjectCache();
      const plain = await post(ok(0));
      expect(plain.status).toBe(200);
      expect(await plain.json()).toMatchObject({ stored: 1 });
      const gz = await post(gzipSync(ok(1)));
      expect(gz.status).toBe(200);
      expect(await gz.json()).toMatchObject({ stored: 1 });
      const again = await post(gzipSync(ok(1)));
      expect(await again.json()).toMatchObject({ stored: 0, duplicate: true });
      expect((await post(ok(), {}, 'zsp_nope')).status).toBe(401);
    });

    it('CORS abierto en la respuesta y sin preflight (text/plain)', async () => {
      const res = await post(ok(2), { 'content-type': 'text/plain' });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://shop.test');
    });

    it('cuerpo con tope, bomba de gzip y basura', async () => {
      expect((await post('x'.repeat(REPLAY_LIMITS.maxBodyBytes + 1))).status).toBe(413);
      const bomb = gzipSync(Buffer.alloc(REPLAY_LIMITS.maxInflatedBytes + 1024, 32));
      expect(bomb.byteLength).toBeLessThan(REPLAY_LIMITS.maxBodyBytes);
      const res = await post(bomb);
      expect(res.status).toBe(413);
      expect((await post('{no json')).status).toBe(400);
      expect((await post(Buffer.from([0x1f, 0x8b, 1, 2, 3, 4]))).status).toBe(400);
      expect((await post(JSON.stringify({ events: [{ hola: 1 }] }))).status).toBe(400);
      // Un anidado absurdo no tira la función.
      const deep = '['.repeat(200_000) + ']'.repeat(200_000);
      expect((await post(`{"session_id":"${'a'.repeat(10)}","seq":0,"distinct_id":"u","events":[{"type":5,"timestamp":${Date.now()},"data":{"tag":"x","payload":${deep}}}]}`)).status).toBeLessThan(500);
    });

    it('dominios permitidos y Do Not Track', async () => {
      const q = (await updateProject('rep-owner', on.id, { allowedDomains: ['shop.test'] }))!;
      forgetProjectCache();
      on = q;
      expect((await post(ok(3), { origin: 'https://evil.test' })).status).toBe(403);
      const dnt = await post(ok(4), { dnt: '1' });
      expect(dnt.status).toBe(200);
      expect(await dnt.json()).toMatchObject({ stored: 0, reason: 'dnt' });
      expect((await post(ok(5))).status).toBe(200);
    });

    it('muestra: una sesión afuera no se guarda', async () => {
      const q = (await updateProject('rep-owner', on.id, { replaySampleRate: 1 }))!;
      forgetProjectCache();
      on = q;
      let sid = 'sampled-out-0';
      for (let i = 0; sampleBucket(sid) < 1; i++) sid = `sampled-out-${i}`;
      const res = await post(JSON.stringify(envelope([meta(Date.now())], { session_id: sid })));
      expect(await res.json()).toMatchObject({ stored: 0, reason: 'sampled_out' });
    });
  });
});
