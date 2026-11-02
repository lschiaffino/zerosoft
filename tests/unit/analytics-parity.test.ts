import { gzipSync } from 'zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import { nanoid } from 'nanoid';
import { parseIngestBody } from '@/lib/analytics/ingest-core';
import { storeEvents } from '@/lib/analytics/ingest';
import { createProject, forgetProjectCache, updateProject, getProject, type ProjectRow } from '@/lib/analytics/projects';
import { scrubNode, scrubUrl } from '@/lib/analytics/replay-scrub';
import { parseChunk } from '@/lib/analytics/replay-core';
import { cleanAnswer, npsFrom } from '@/lib/analytics/surveys-core';
import { scrubMessage } from '@/lib/analytics/errors-core';
import {
  applyFormula,
  collapsePath,
  computeLifecycle,
  conversionStats,
  correlate,
  csvCell,
  formulaValue,
  meanStats,
  oddsRatio,
  parseFormula,
  percentile,
  resultRows,
  sampleRatioMismatch,
  stickinessHistogram,
} from '@/lib/analytics/compute-more';
import { runCorrelation, runFunnel, runInsight, runLifecycle, runPaths, runRetention, runStickiness, runTrends, runWeb } from '@/lib/analytics/query';
import { addCohortMembers, createAction, createAnnotation, createShare, listAnnotations, parseMemberList, revokeShare, saveEventDefinition, shareByToken, hiddenEvents, listEventDefinitions } from '@/lib/analytics/records-more';
import { createCohort, createFlag, createInsight, deleteFlag, getCohort } from '@/lib/analytics/records';
import { countPersons, listPersons } from '@/lib/analytics/persons';
import { decideFlagsFull, forgetFlagsCache } from '@/lib/analytics/flags';
import { evaluateFlag } from '@/lib/analytics/flags-core';
import { createExperiment, experimentResults, getExperiment, setExperimentStatus, shipVariant, experimentsUsingFlag } from '@/lib/analytics/experiments';
import { alertFires, createAlert, deleteAlert, listAlerts, runAlertsCron } from '@/lib/analytics/alerts';
import { publicResult, publicShareView } from '@/lib/analytics/share-view';
import { runAnalyticsCron } from '@/lib/analytics/cron';
import { cohortDefinitionSchema, insightQuerySchema, trendsQuerySchema, type FunnelResult } from '@/lib/analytics/types';
import { recordProject } from '@/lib/analytics/http';
import { bucketBefore, bucketList, bucketOf, previousAligned, resolveRange } from '@/lib/analytics/compute';
import { fromLocal, isTimeZone, offsetMsAt, transitionsIn } from '@/lib/analytics/tz';
import { isBotUserAgent } from '@/lib/analytics/bots';
import { handleCapture } from '@/lib/analytics/ingest-http';


const DAY = 86_400_000;
const NOW = Date.now();

interface Ev {
  event: string;
  distinct_id: string;
  ts?: number;
  properties?: Record<string, unknown>;
  $set?: Record<string, unknown>;
}

async function ingest(project: ProjectRow, events: Ev[]) {
  const body = JSON.stringify({
    api_key: project.public_key,
    batch: events.map((e) => ({ event: e.event, distinct_id: e.distinct_id, timestamp: new Date(e.ts ?? NOW - 1000).toISOString(), properties: { ...e.properties, ...(e.$set ? { $set: e.$set } : {}) } })),
  });
  const parsed = parseIngestBody(body);
  if (!parsed.ok) throw new Error(parsed.error);
  const fresh = (await getProject(project.workspace_id, project.id))!;
  return storeEvents(fresh, parsed.events, null);
}

async function newProject(name = 'P') {
  const user = await upsertUser({ email: `an-parity-${nanoid(8)}@test.dev` });
  const project = await createProject(user.id, user.id, name);
  return { user, project };
}

describe('analytics: fórmulas', () => {
  it('respeta precedencia y paréntesis, y dividir por 0 da 0', () => {
    const f = parseFormula('(A + B) / 2 * 100')!;
    expect(formulaValue(f, [1, 3])).toBe(200);
    expect(formulaValue(parseFormula('A / B')!, [1, 0])).toBe(0);
    expect(formulaValue(parseFormula('-A + 1')!, [3])).toBe(-2);
    expect(applyFormula(parseFormula('A/B')!, [[1, 2], [2, 4]], 2)).toEqual([0.5, 0.5]);
  });
  it('rechaza lo que no es una fórmula (nada de código ni letras fuera de A-E)', () => {
    for (const bad of ['process.exit()', 'A +', '(A', 'Z', 'A B', '', '1..2', 'A; DROP']) expect(parseFormula(bad), bad).toBeNull();
  });
});

describe('analytics: cálculos puros', () => {
  it('percentiles por interpolación', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([], 0.9)).toBe(0);
    expect(percentile([10], 0.99)).toBe(10);
  });
  it('stickiness: histograma por cantidad de intervalos', () => {
    expect(stickinessHistogram([1, 1, 2, 5], 3)).toEqual([2, 1, 1]);
  });
  it('ciclo de vida: nuevo, sigue, vuelve y deja', () => {
    const buckets = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'];
    const rows = [
      // a: nuevo el 2, sigue el 3, deja el 4, vuelve el 5.
      { person: 'a', bucket: '2026-01-02' },
      { person: 'a', bucket: '2026-01-03' },
      { person: 'a', bucket: '2026-01-05' },
      // b: venía de antes del rango (activo en la cubeta 0), deja el 2.
      { person: 'b', bucket: '2026-01-01' },
    ];
    const first = new Map([
      ['a', '2026-01-02'],
      ['b', '2025-12-01'],
    ]);
    const c = computeLifecycle(rows, first, buckets);
    expect(c.new).toEqual([1, 0, 0, 0]);
    expect(c.returning).toEqual([0, 1, 0, 0]);
    expect(c.dormant).toEqual([-1, 0, -1, 0]);
    expect(c.resurrecting).toEqual([0, 0, 0, 1]);
  });
  it('correlación: odds ratio y orden', () => {
    expect(oddsRatio(9, 1, 10, 10).odds).toBeGreaterThan(1);
    expect(oddsRatio(1, 9, 10, 10).odds).toBeLessThan(1);
    expect(oddsRatio(9, 1, 10, 10).significant).toBe(true);
    expect(oddsRatio(1, 1, 2, 2).significant).toBe(false);
    const c = new Set(['a', 'b', 'c']);
    const d = new Set(['x', 'y']);
    const r = correlate(
      [
        { person: 'a', name: 'good' },
        { person: 'b', name: 'good' },
        { person: 'c', name: 'good' },
        { person: 'x', name: 'bad' },
        { person: 'y', name: 'bad' },
        { person: 'stranger', name: 'bad' },
      ],
      c,
      d,
      'event',
    );
    expect(r.positive[0].name).toBe('good');
    expect(r.negative[0].name).toBe('bad');
    expect(r.negative[0].dropped).toBe(2);
  });
  it('junta ids en los caminos', () => {
    expect(collapsePath('/orders/123/items/9f8a7b6c5d4e')).toBe('/orders/:id/items/:id');
    expect(collapsePath('/pricing')).toBe('/pricing');
  });
  it('experimentos: la variante mucho mejor gana y el cálculo es repetible', () => {
    const v = [
      { key: 'control', exposed: 1000, conversions: 100 },
      { key: 'test', exposed: 1000, conversions: 200 },
    ];
    const a = conversionStats(v);
    expect(a[1].chanceBest).toBeGreaterThan(0.99);
    expect(a[1].uplift).toBeCloseTo(1);
    expect(a[0].uplift).toBeNull();
    expect(a[1].low).toBeLessThan(0.2);
    expect(a[1].high).toBeGreaterThan(0.2);
    expect(conversionStats(v)).toEqual(a);
    // Sin diferencia, nadie está seguro.
    const even = conversionStats([
      { key: 'control', exposed: 100, conversions: 10 },
      { key: 'test', exposed: 100, conversions: 10 },
    ]);
    expect(even[1].chanceBest).toBeGreaterThan(0.35);
    expect(even[1].chanceBest).toBeLessThan(0.65);
    const m = meanStats([
      { key: 'control', exposed: 500, sum: 500, sumSquares: 1000 },
      { key: 'test', exposed: 500, sum: 1000, sumSquares: 3000 },
    ]);
    expect(m[1].chanceBest).toBeGreaterThan(0.99);
    expect(m[1].rate).toBe(2);
  });
  it('detecta un reparto que no coincide con el flag', () => {
    expect(sampleRatioMismatch([500, 500], [0.5, 0.5])).toBe(false);
    expect(sampleRatioMismatch([800, 200], [0.5, 0.5])).toBe(true);
    expect(sampleRatioMismatch([8, 2], [0.5, 0.5])).toBe(false);
  });
  it('CSV: comillas y sin fórmulas de Excel', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
    expect(resultRows({ kind: 'lifecycle', interval: 'day', buckets: ['d'], new: [1], returning: [2], resurrecting: [3], dormant: [-4], truncated: false })).toEqual([
      ['bucket', 'new', 'returning', 'resurrecting', 'dormant'],
      ['d', 1, 2, 3, -4],
    ]);
  });
  it('lo guardado antes sigue parseando con los valores nuevos por defecto', () => {
    const old = insightQuerySchema.parse({ kind: 'trends', series: [{ event: '$pageview', math: 'unique' }], display: 'bar' });
    expect(old.kind === 'trends' && Boolean(old.excludeInternal)).toBe(false);
    expect(cohortDefinitionSchema.parse({ properties: [], behavior: { event: 'x' } }).type).toBeUndefined();
    expect(trendsQuerySchema.safeParse({ kind: 'trends', series: [{ event: 'x', math: 'evil' }] }).success).toBe(false);
  });
});

describe('analytics: zona horaria con cambio de hora', () => {
  const NY = 'America/New_York';
  const at = (x: string) => Date.parse(x);
  it('desfase de cada lado del cambio y hora local al instante real', () => {
    expect(offsetMsAt(NY, at('2026-03-08T06:59:00Z')) / 3_600_000).toBe(-5);
    expect(offsetMsAt(NY, at('2026-03-08T07:00:00Z')) / 3_600_000).toBe(-4);
    expect(offsetMsAt(NY, at('2026-11-01T05:59:00Z')) / 3_600_000).toBe(-4);
    expect(offsetMsAt(NY, at('2026-11-01T06:00:00Z')) / 3_600_000).toBe(-5);
    expect(fromLocal(at('2026-03-08T00:00:00Z'), NY)).toBe(at('2026-03-08T05:00:00Z'));
    expect(fromLocal(at('2026-03-09T00:00:00Z'), NY)).toBe(at('2026-03-09T04:00:00Z'));
    expect(offsetMsAt('America/Argentina/Buenos_Aires', at('2026-07-01T00:00:00Z')) / 3_600_000).toBe(-3);
    expect(transitionsIn(NY, at('2026-01-01T00:00:00Z'), at('2026-12-31T00:00:00Z')).map((x) => x.at)).toEqual([at('2026-03-08T07:00:00Z'), at('2026-11-01T06:00:00Z')]);
    expect(transitionsIn('America/Argentina/Buenos_Aires', at('2026-01-01T00:00:00Z'), at('2026-12-31T00:00:00Z'))).toEqual([]);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
  });
  it('los días de un rango que cruza el cambio empiezan a medianoche local', () => {
    const r = resolveRange({ from: '2026-03-07', to: '2026-03-09' }, at('2026-12-01T00:00:00Z'), NY);
    expect(r.from).toBe(at('2026-03-07T05:00:00Z'));
    expect(r.to).toBe(at('2026-03-10T04:00:00Z') - 1);
    expect(bucketList(r.from, r.to, 'day', NY)).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
    // Ayer, en cada lado del corte.
    expect(bucketOf(at('2026-03-08T04:59:00Z'), 'day', NY)).toBe('2026-03-07');
    expect(bucketOf(at('2026-03-09T03:59:00Z'), 'day', NY)).toBe('2026-03-08');
    expect(bucketOf(at('2026-03-09T04:00:00Z'), 'day', NY)).toBe('2026-03-09');
    // Comparar corre días locales: los mismos cortes a medianoche.
    const prev = previousAligned(r, 'day', NY);
    expect(prev.from).toBe(at('2026-03-04T05:00:00Z'));
  });
  it('SQL y JS dan la misma cubeta: eventos a cada lado de medianoche contados a mano', async () => {
    const { user, project: p } = await newProject();
    await updateProject(user.id, p.id, { tzName: NY });
    const fresh = (await getProject(user.id, p.id))!;
    expect(fresh.tz_name).toBe(NY);
    // Son fechas de 2026: dentro de la retención solo si el reloj está cerca; se escriben directo a la tabla.
    const stamps = ['2026-03-08T04:59:00Z', '2026-03-08T05:00:00Z', '2026-03-09T03:59:00Z', '2026-03-09T04:00:00Z', '2026-03-09T05:00:00Z'];
    for (const [i, ts] of stamps.entries()) {
      await getDb().prepare('INSERT INTO analytics_events (project_id, event, distinct_id, ts, properties, uuid) VALUES (?, ?, ?, ?, ?, ?)').run(p.id, 'e', `u${i}`, at(ts), '{}', `tz-${p.id}-${i}`);
    }
    const q = trendsQuerySchema.parse({ kind: 'trends', series: [{ event: 'e' }], dateRange: { from: '2026-03-07', to: '2026-03-09' } });
    const r = await runTrends(fresh, q, at('2026-12-01T00:00:00Z'));
    expect(r.buckets).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
    // 7 de marzo: el de las 23:59 locales. 8: 00:00 y 23:59 (día de 23 horas). 9: 00:00 y 01:00.
    expect(r.series[0].data).toEqual([1, 2, 2]);
    // Por hora: la hora que no existe no aparece y los números siguen cayendo donde corresponde.
    const h = await runTrends(fresh, trendsQuerySchema.parse({ kind: 'trends', series: [{ event: 'e' }], interval: 'hour', dateRange: { from: '2026-03-08', to: '2026-03-08' } }), at('2026-12-01T00:00:00Z'));
    expect(h.buckets).not.toContain('2026-03-08 02:00');
    expect(h.series[0].total).toBe(2);
    // El mismo instante, sin zona: UTC parte distinto.
    const utc = await runTrends({ ...fresh, tz_name: null, tz_offset_min: 0 }, q, at('2026-12-01T00:00:00Z'));
    expect(utc.series[0].data).toEqual([0, 2, 3]);
  });
  it('cambiar de zona descarta los rollups: se rehacen con el corte nuevo', async () => {
    const { user, project: p } = await newProject();
    await ingest(p, [{ event: 'e', distinct_id: 'a', ts: NOW - 2 * DAY }]);
    for (let i = 0; i < 3; i++) await runAnalyticsCron({ budgetMs: 10_000, now: NOW });
    const n = async () => Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM analytics_daily WHERE project_id = ?').get(p.id)) as { n: number }).n);
    expect((await getProject(user.id, p.id))?.rolled_through).toBeTruthy();
    expect(await n()).toBeGreaterThan(0);
    await updateProject(user.id, p.id, { tzName: 'Asia/Tokyo' });
    expect((await getProject(user.id, p.id))?.rolled_through).toBeNull();
    expect(await n()).toBe(0);
  });
});

describe('analytics: arreglos de QA contados a mano', () => {
  const trend = (series: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => trendsQuerySchema.parse({ kind: 'trends', series, dateRange: { from: '-7d' }, ...extra });

  it('con apertura, el total de cada valor es su cuenta sobre el rango y no la suma de los días', async () => {
    const { project: p } = await newProject();
    // ana y bob vienen dos días; carla uno. Pro: ana y carla. Montos 100 y 50 en pro.
    await ingest(p, [
      { event: 'v', distinct_id: 'ana', ts: NOW - 2 * DAY, properties: { plan: 'pro', amount: 100 } },
      { event: 'v', distinct_id: 'ana', ts: NOW - DAY, properties: { plan: 'pro', amount: 50 } },
      { event: 'v', distinct_id: 'bob', ts: NOW - 2 * DAY, properties: { plan: 'free', amount: 10 } },
      { event: 'v', distinct_id: 'bob', ts: NOW - DAY, properties: { plan: 'free', amount: 10 } },
      { event: 'v', distinct_id: 'carla', ts: NOW - DAY, properties: { plan: 'pro' } },
    ]);
    const by = (r: Awaited<ReturnType<typeof runTrends>>) => Object.fromEntries(r.series.map((x) => [x.breakdownValue, x.total]));
    const bd = { breakdown: { key: 'plan', type: 'event' } };
    expect(by(await runTrends(p, trend([{ event: 'v', math: 'unique' }], bd), NOW))).toEqual({ pro: 2, free: 1 });
    expect(by(await runTrends(p, trend([{ event: 'v', math: 'avg', mathProperty: 'amount' }], bd), NOW))).toEqual({ pro: 75, free: 10 });
    expect(by(await runTrends(p, trend([{ event: 'v', math: 'per_user' }], bd), NOW))).toEqual({ pro: 1.5, free: 2 });
    expect(by(await runTrends(p, trend([{ event: 'v', math: 'sum', mathProperty: 'amount' }], bd), NOW))).toEqual({ pro: 150, free: 20 });
    expect(by(await runTrends(p, trend([{ event: 'v', math: 'total' }], bd), NOW))).toEqual({ pro: 3, free: 2 });
    expect(by(await runTrends(p, trend([{ event: 'v', math: 'max', mathProperty: 'amount' }], bd), NOW))).toEqual({ pro: 100, free: 10 });
  });

  it('ciclo de vida mensual: un rango que arranca el 31 tiene sus meses', async () => {
    const { project: p } = await newProject();
    const now = Date.parse('2026-11-20T12:00:00Z');
    const r = await runLifecycle(p, { kind: 'lifecycle', event: 'e', eventFilters: [], interval: 'month', dateRange: { from: '2026-10-31', to: '2026-11-20' }, filters: [] }, now);
    expect(r.buckets).toEqual(['2026-10-01', '2026-11-01']);
    expect(bucketBefore(Date.parse('2026-10-31T00:00:00Z'), 'month')).toBe(Date.parse('2026-09-01T00:00:00Z'));
    expect(bucketBefore(Date.parse('2026-03-31T00:00:00Z'), 'month')).toBe(Date.parse('2026-02-01T00:00:00Z'));
  });

  it('un reintento con el mismo uuid no suma a la sesión: el rebote no cambia', async () => {
    const { project: p, user } = await newProject();
    const body = (uuid: string, s: string) => JSON.stringify({ api_key: p.public_key, batch: [{ event: '$pageview', distinct_id: 'r', uuid, timestamp: new Date(NOW - 5000).toISOString(), properties: { $session_id: s, $pathname: '/' } }] });
    const send = async (uuid: string, s: string) => {
      const parsed = parseIngestBody(body(uuid, s));
      if (!parsed.ok) throw new Error(parsed.error);
      return storeEvents((await getProject(user.id, p.id))!, parsed.events, null);
    };
    const uuid = '11111111-2222-4333-8444-555555555555';
    expect(await send(uuid, 'sess-bounce')).toBe(1);
    expect(await send(uuid, 'sess-bounce')).toBe(0);
    const row = (await getDb().prepare('SELECT pageviews, events FROM analytics_sessions WHERE project_id = ? AND id = ?').get(p.id, 'sess-bounce')) as { pageviews: number; events: number };
    expect(Number(row.pageviews)).toBe(1);
    expect(Number(row.events)).toBe(1);
    const web = await runWeb((await getProject(user.id, p.id))!, { kind: 'web', dateRange: { from: '-7d' }, compare: false });
    expect(web.stats.bounceRate.value).toBe(1);
    expect(web.stats.pageviews.value).toBe(1);
  });

  it('páginas de entrada: una persona con dos ids es un visitante', async () => {
    const { project: p } = await newProject();
    await ingest(p, [
      { event: '$pageview', distinct_id: 'anon-1', ts: NOW - 9000, properties: { $session_id: 's-a', $pathname: '/home' } },
      { event: '$identify', distinct_id: 'user-1', ts: NOW - 8000, properties: { $anon_distinct_id: 'anon-1' } },
      { event: '$pageview', distinct_id: 'user-1', ts: NOW - 7000, properties: { $session_id: 's-b', $pathname: '/home' } },
    ]);
    const web = await runWeb(p, { kind: 'web', dateRange: { from: '-7d' }, compare: false });
    expect(web.entries.find((x) => x.key === '/home')?.visitors).toBe(1);
    expect(web.entries.find((x) => x.key === '/home')?.views).toBe(2);
  });

  it('NPS: la escala va de 0 a 10 y un 0 cuenta como detractor', () => {
    const q = { id: 'q', type: 'rating', text: 'x', scale: 10 } as never;
    expect(cleanAnswer(q, 0)).toEqual({ kind: 'rating', value: 0 });
    expect(cleanAnswer(q, 11)).toEqual({ kind: 'invalid' });
    const five = { id: 'q', type: 'rating', text: 'x', scale: 5 } as never;
    expect(cleanAnswer(five, 0)).toEqual({ kind: 'invalid' });
    const dist = new Array(11).fill(0) as number[];
    dist[0] = 1;
    dist[7] = 1;
    dist[10] = 2;
    expect(npsFrom(dist)).toEqual({ nps: 25, promoters: 2, passives: 1, detractors: 1 });
  });

  it('mensajes de error sin URLs firmadas, emails ni números largos', () => {
    const m = scrubMessage('Failed https://a.io/x?token=abc&ok=1#frag for ana@acme.com card 4111 1111 1111 1111 token=zzz');
    expect(m).not.toContain('abc');
    expect(m).not.toContain('frag');
    expect(m).not.toContain('ana@acme.com');
    expect(m).not.toContain('4111');
    expect(m).not.toContain('zzz');
    expect(m).toContain('ok=1');
  });

  it('un cuerpo sin content-length se corta al pasar el tope, sin leerlo entero', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        if (pulled > 300) c.close();
        else c.enqueue(chunk);
      },
    });
    const res = await handleCapture(new Request('http://x/api/ingest/e', { method: 'POST', body: stream, duplex: 'half' } as RequestInit));
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(5);
  });

  it('un insight SQL no sale por un link público, ni solo ni en un tablero', async () => {
    const { project: p } = await newProject();
    const sql = await createInsight(p.id, 'u', { name: 'Leak', query: insightQuerySchema.parse({ kind: 'sql', sql: 'SELECT distinct_id FROM events' }) });
    const ok = await createInsight(p.id, 'u', { name: 'Fine', query: insightQuerySchema.parse({ kind: 'trends', series: [{ event: 'x' }] }) });
    const direct = await createShare(p.id, 'u', { insightId: sql.id });
    expect(await publicShareView(direct.token)).toBeNull();
    const { createDashboard, updateDashboard } = await import('@/lib/analytics/records');
    const d = await createDashboard(p.id, 'u', { name: 'B' });
    await updateDashboard(p.id, d.id, { insightIds: [sql.id, ok.id] });
    const board = await createShare(p.id, 'u', { dashboardId: d.id });
    expect((await publicShareView(board.token))?.tiles.map((t) => t.name)).toEqual(['Fine']);
  });
});

describe('analytics: lo que queda en una grabación', () => {
  it('URLs sin tokens ni fragmentos, absolutas o relativas', () => {
    expect(scrubUrl('https://a.io/p?token=abc&x=1#access_token=zz')).toBe('https://a.io/p?x=1');
    expect(scrubUrl('/reset?code=123&utm_source=mail')).toBe('/reset?utm_source=mail');
    expect(scrubUrl('#access_token=zz')).toBe('#');
    expect(scrubUrl('javascript:alert(1)')).toBe('');
    expect(scrubUrl('mailto:ana@acme.com')).toBe('');
  });
  it('saca valores ocultos, data-* y placeholders; enmascara editables y selects siempre', () => {
    const node = {
      type: 2,
      tagName: 'div',
      attributes: { 'data-user': 'ana@acme.com', title: 'keep' },
      childNodes: [
        { type: 2, tagName: 'input', attributes: { type: 'hidden', name: 'csrf', value: 'SECRET' }, childNodes: [] },
        { type: 2, tagName: 'input', attributes: { type: 'text', placeholder: 'tu email ana@acme.com' }, childNodes: [] },
        { type: 2, tagName: 'a', attributes: { href: '/a?token=abc' }, childNodes: [{ type: 3, textContent: 'visible' }] },
        { type: 2, tagName: 'div', attributes: { contenteditable: 'true' }, childNodes: [{ type: 3, textContent: 'mi nota privada' }] },
        { type: 2, tagName: 'select', attributes: {}, childNodes: [{ type: 2, tagName: 'option', attributes: {}, childNodes: [{ type: 3, textContent: 'Diagnóstico' }] }] },
      ],
    };
    scrubNode(node);
    const json = JSON.stringify(node);
    for (const secret of ['SECRET', 'ana@acme.com', 'token=abc', 'mi nota privada', 'Diagnóstico']) expect(json).not.toContain(secret);
    expect(json).toContain('visible');
    expect(json).toContain('keep');
  });
  it('el servidor limpia aunque el snippet no lo haya hecho', () => {
    const parsed = parseChunk({
      session_id: 'sessionid1',
      window_id: 'windowid01',
      seq: 0,
      distinct_id: 'a',
      url: 'https://a.io/',
      events: [
        { type: 4, timestamp: NOW, data: { href: 'https://a.io/?token=abc#access_token=zz', width: 800, height: 600 } },
        { type: 2, timestamp: NOW, data: { node: { type: 0, id: 1, childNodes: [{ type: 2, id: 2, tagName: 'input', attributes: { type: 'hidden', value: 'CSRF' }, childNodes: [] }] }, initialOffset: { top: 0, left: 0 } } },
        { type: 3, timestamp: NOW + 1, data: { source: 0, texts: [], removes: [], adds: [], attributes: [{ id: 2, attributes: { value: 'CSRF2', 'data-x': 'y', href: '/x?token=abc' } }] } },
      ],
    });
    expect(parsed.ok).toBe(true);
    const json = JSON.stringify(parsed);
    for (const secret of ['token=abc', 'access_token', 'CSRF', 'CSRF2', 'data-x']) expect(json).not.toContain(secret);
  });
});

describe('analytics: bots', () => {
  it('reconoce crawlers y deja pasar navegadores y SDKs', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toBe(false);
    expect(isBotUserAgent('posthog-node/4.0')).toBe(false);
    // Crawlers de verdad.
    for (const ua of [
      'Mozilla/5.0 (compatible; Pinterestbot/1.0; +http://www.pinterest.com/bot.html)',
      'Pinterest/0.2 (+https://www.pinterest.com/bot.html)',
      'HubSpot Crawler 2.0 http://www.hubspot.com/',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'Mozilla/5.0 (compatible; bot/1.0)',
      'Mozilla/5.0 (compatible; SomeCrawler/3.1)',
    ]) expect(isBotUserAgent(ua), ua).toBe(true);
    // Gente de verdad en apps y teléfonos con nombres parecidos.
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Pinterest/iOS',
      'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Mobile Safari/537.36 [Pinterest/Android]',
      'Mozilla/5.0 (Linux; Android 11; CUBOT X50 Build/RP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 10; Cubot/X20) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Mobile Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/430.0]',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LinkedInApp',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Slack/4.34 Chrome/116 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/118.0 Mobile Safari/537.36 Google-Read-Aloud',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 HubSpot-Tools/1.0 Safari/537.36',
    ]) expect(isBotUserAgent(ua), ua).toBe(false);
    expect(isBotUserAgent(null)).toBe(false);
  });
  it('lo que manda un crawler con la key pública no se guarda; un navegador sí', async () => {
    const { project: p } = await newProject();
    const send = (ua: string) =>
      handleCapture(
        new Request('http://x/api/ingest/e', { method: 'POST', headers: { 'user-agent': ua, origin: 'http://shop.test' }, body: JSON.stringify({ api_key: p.public_key, event: 'pv', distinct_id: 'v' }) }),
      );
    const bot = await (await send('Googlebot/2.1')).json();
    expect(bot).toMatchObject({ stored: 0, reason: 'bot' });
    const human = await (await send('Mozilla/5.0 Chrome/130.0 Safari/537.36')).json();
    expect(human.stored).toBe(1);
    const n = (await getDb().prepare('SELECT COUNT(*) AS n FROM analytics_events WHERE project_id = ?').get(p.id)) as { n: number };
    expect(Number(n.n)).toBe(1);
    // Lo filtrado se cuenta, y el proyecto puede pedir guardarlo.
    const { user } = { user: { id: p.workspace_id } };
    expect((await getProject(user.id, p.id))?.bots_filtered).toBe(1);
    await updateProject(user.id, p.id, { keepBots: true });
    forgetProjectCache();
    const kept = await (await send('Googlebot/2.1')).json();
    expect(kept.stored).toBe(1);
    expect((await getProject(user.id, p.id))?.bots_filtered).toBe(1);
  });
});

describe('analytics: lotes en gzip de los SDKs de servidor', () => {
  it('guarda lo que llega comprimido y corta una bomba de compresión', async () => {
    const { project: p } = await newProject();
    const post = (body: Buffer) => handleCapture(new Request('http://x/api/ingest/batch', { method: 'POST', headers: { 'content-encoding': 'gzip', origin: 'http://shop.test' }, body: new Uint8Array(body) }));
    const ok = await post(gzipSync(JSON.stringify({ api_key: p.public_key, batch: [{ event: 'gz', distinct_id: 'a' }] })));
    expect((await ok.json()).stored).toBe(1);
    const bomb = await post(gzipSync(JSON.stringify({ api_key: p.public_key, event: 'x', distinct_id: 'a', properties: { pad: 'a'.repeat(5_000_000) } })));
    expect(bomb.status).toBe(413);
  });
});

describe('analytics: comparar con el período anterior', () => {
  const at = (s: string) => Date.parse(s);
  it('corre cubetas enteras: 7 días que terminan ahora contra los mismos 7 días a la misma hora', () => {
    const r = { from: at('2026-10-26T00:00:00Z'), to: at('2026-11-01T15:30:00Z') };
    expect(previousAligned(r, 'day')).toEqual({ from: at('2026-10-19T00:00:00Z'), to: at('2026-10-25T15:30:00Z') });
    expect(bucketList(previousAligned(r, 'day').from, previousAligned(r, 'day').to, 'day')).toHaveLength(7);
  });
  it('meses de distinto largo: corta en el último día, sin saltar de mes', () => {
    const r = { from: at('2026-03-01T00:00:00Z'), to: at('2026-03-31T12:00:00Z') };
    expect(previousAligned(r, 'month')).toEqual({ from: at('2026-02-01T00:00:00Z'), to: at('2026-02-28T12:00:00Z') });
  });
  it('respeta la zona del proyecto: el corte es medianoche local', () => {
    const off = -180;
    const r = { from: at('2026-10-30T03:00:00Z'), to: at('2026-10-31T15:00:00Z') };
    const p = previousAligned(r, 'day', off);
    expect(p).toEqual({ from: at('2026-10-28T03:00:00Z'), to: at('2026-10-29T15:00:00Z') });
    expect(bucketList(p.from, p.to, 'day', off)).toEqual(['2026-10-28', '2026-10-29']);
  });
  it('sobre eventos: cada cubeta frente a su equivalente y los totales contados a mano', async () => {
    const { project: p } = await newProject();
    // Hoy 3 eventos en dos cubetas de los últimos 2 días; los 2 días anteriores, 1 y 2. Uno afuera de todo.
    const dayStart = Math.floor(NOW / DAY) * DAY;
    await ingest(p, [
      { event: 'e', distinct_id: 'a', ts: dayStart + 1000 > NOW ? NOW - 1 : dayStart + 1000 },
      { event: 'e', distinct_id: 'a', ts: dayStart - DAY + 1000 },
      { event: 'e', distinct_id: 'b', ts: dayStart - DAY + 2000 },
      { event: 'e', distinct_id: 'a', ts: dayStart - 2 * DAY + 1000 },
      { event: 'e', distinct_id: 'a', ts: dayStart - 3 * DAY + 1000 },
      { event: 'e', distinct_id: 'b', ts: dayStart - 3 * DAY + 2000 },
      { event: 'e', distinct_id: 'z', ts: dayStart - 9 * DAY },
    ]);
    const r = await runTrends(p, trendsQuerySchema.parse({ kind: 'trends', series: [{ event: 'e' }], compare: true, dateRange: { from: '-2d' } }), NOW);
    expect(r.series[0].data).toEqual([2, 1]);
    expect(r.series[0].total).toBe(3);
    expect(r.series[0].compare).toEqual([2, 1]);
    expect(r.series[0].compareTotal).toBe(3);
  });
  it('únicos del rango no son la suma de los días, aunque haya rollups', async () => {
    const { project: p, user } = await newProject();
    const dayStart = Math.floor(NOW / DAY) * DAY;
    await ingest(p, [
      { event: 'e', distinct_id: 'a', ts: dayStart - 2 * DAY + 1000 },
      { event: 'e', distinct_id: 'a', ts: dayStart - DAY + 1000 },
    ]);
    for (let i = 0; i < 3; i++) await runAnalyticsCron({ budgetMs: 10_000, now: NOW });
    const fresh = (await getProject(user.id, p.id))!;
    const r = await runTrends(fresh, trendsQuerySchema.parse({ kind: 'trends', series: [{ event: 'e', math: 'unique' }], dateRange: { from: '-3d' } }), NOW);
    expect(r.series[0].data.reduce((x, y) => x + y, 0)).toBe(2);
    expect(r.series[0].total).toBe(1);
  });
});

describe('analytics: tendencias con matemáticas', () => {
  let p: ProjectRow;
  beforeAll(async () => {
    ({ project: p } = await newProject());
    await ingest(p, [
      { event: 'order', distinct_id: 'a', properties: { total: 10, $session_id: 's1', $groups: { company: 'acme' } } },
      { event: 'order', distinct_id: 'a', properties: { total: 30, $session_id: 's1', $groups: { company: 'acme' } } },
      { event: 'order', distinct_id: 'b', properties: { total: '20', $session_id: 's2', $groups: { company: 'beta' } } },
      { event: 'order', distinct_id: 'c', properties: { total: 'not a number', $session_id: 's3' } },
      { event: 'view', distinct_id: 'a' },
      { event: 'view', distinct_id: 'b' },
    ]);
  });
  const trend = (series: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => trendsQuerySchema.parse({ kind: 'trends', series, ...extra, dateRange: { from: '-2d' } });

  it('suma, promedio, mínimo, máximo y percentil ignoran lo que no es número', async () => {
    const r = await runTrends(
      p,
      trend([
        { event: 'order', math: 'sum', mathProperty: 'total' },
        { event: 'order', math: 'avg', mathProperty: 'total' },
        { event: 'order', math: 'min', mathProperty: 'total' },
        { event: 'order', math: 'max', mathProperty: 'total' },
        { event: 'order', math: 'median', mathProperty: 'total' },
      ]),
    );
    expect(r.series.map((s) => s.total)).toEqual([60, 20, 10, 30, 20]);
    expect(r.series[0].label).toContain('sum of total');
  });
  it('sesiones, por persona y grupos únicos', async () => {
    const r = await runTrends(
      p,
      trend([
        { event: 'order', math: 'sessions' },
        { event: 'order', math: 'per_user' },
        { event: 'order', math: 'unique_group', groupType: 'company' },
      ]),
    );
    expect(r.series[0].total).toBe(3);
    expect(r.series[1].total).toBeCloseTo(1.33, 1);
    expect(r.series[2].total).toBe(2);
  });
  it('pide la propiedad cuando hace falta', async () => {
    await expect(runTrends(p, trend([{ event: 'order', math: 'sum' }]))).rejects.toMatchObject({ code: 'math_property_required' });
    await expect(runTrends(p, trend([{ event: 'order', math: 'median' }]))).rejects.toMatchObject({ code: 'math_property_required' });
  });
  it('fórmula entre series', async () => {
    const r = await runTrends(p, trend([{ event: 'order' }, { event: 'view' }], { formula: 'A / B' }));
    expect(r.series).toHaveLength(1);
    expect(r.series[0].total).toBe(2);
    await expect(runTrends(p, trend([{ event: 'order' }], { formula: 'A +' }))).rejects.toMatchObject({ code: 'invalid_formula' });
  });
  it('acciones: varios pasos con OR y un filtro de URL; una acción borrada no cuenta nada', async () => {
    const a = await createAction(p.id, 'x', { name: 'Bought or viewed', description: '', steps: [{ event: 'order', urlContains: null, filters: [] }, { event: 'view', urlContains: null, filters: [] }] });
    const r = await runTrends(p, trend([{ event: `@action:${a.id}` }]));
    expect(r.series[0].total).toBe(6);
    expect(r.series[0].label).toBe('Bought or viewed');
    const none = await runTrends(p, trend([{ event: '@action:missing' }]));
    expect(none.series[0].total).toBe(0);
    // Una acción de otro proyecto no se puede usar.
    const { project: other } = await newProject();
    const outsider = await runTrends(other, trend([{ event: `@action:${a.id}` }]));
    expect(outsider.series[0].total).toBe(0);
  });
  it('filtro de gente interna, solo si la consulta lo pide', async () => {
    const u = (await getDb().prepare('SELECT workspace_id FROM analytics_projects WHERE id = ?').get(p.id)) as { workspace_id: string };
    await updateProject(u.workspace_id, p.id, { testFilters: [{ key: 'distinct_id', op: 'neq', value: 'a', type: 'event' }] });
    const fresh = (await getProject(u.workspace_id, p.id))!;
    const on = await runTrends(fresh, trend([{ event: 'view' }], { excludeInternal: true }));
    const off = await runTrends(fresh, trend([{ event: 'view' }], { excludeInternal: false }));
    expect(on.series[0].total).toBe(1);
    expect(off.series[0].total).toBe(2);
  });
});

describe('analytics: stickiness, ciclo de vida, embudos y caminos sobre datos', () => {
  let p: ProjectRow;
  beforeAll(async () => {
    ({ project: p } = await newProject());
    await ingest(p, [
      { event: 'use', distinct_id: 'daily', ts: NOW - 2 * DAY },
      { event: 'use', distinct_id: 'daily', ts: NOW - DAY },
      { event: 'use', distinct_id: 'daily', ts: NOW - 1000 },
      { event: 'use', distinct_id: 'once', ts: NOW - DAY },
      { event: 'signup', distinct_id: 'conv1', ts: NOW - 3000, properties: { $groups: { company: 'acme' } } },
      { event: 'video', distinct_id: 'conv1', ts: NOW - 2500 },
      { event: 'paid', distinct_id: 'conv1', ts: NOW - 2000, properties: { $groups: { company: 'acme' } } },
      { event: 'signup', distinct_id: 'conv2', ts: NOW - 3000, properties: { $groups: { company: 'acme' } } },
      { event: 'video', distinct_id: 'conv2', ts: NOW - 2500 },
      { event: 'paid', distinct_id: 'conv2', ts: NOW - 2000 },
      { event: 'signup', distinct_id: 'drop1', ts: NOW - 3000, properties: { $groups: { company: 'beta' } } },
      { event: 'error', distinct_id: 'drop1', ts: NOW - 2500 },
      { event: 'signup', distinct_id: 'drop2', ts: NOW - 3000 },
      { event: 'error', distinct_id: 'drop2', ts: NOW - 2500 },
      { event: '$pageview', distinct_id: 'nav', ts: NOW - 4000, properties: { $session_id: 'n', $pathname: '/orders/123' } },
      { event: 'clicked', distinct_id: 'nav', ts: NOW - 3500, properties: { $session_id: 'n' } },
      { event: '$pageview', distinct_id: 'nav', ts: NOW - 3000, properties: { $session_id: 'n', $pathname: '/thanks' } },
    ]);
  });

  it('stickiness cuenta días activos por persona', async () => {
    const r = await runStickiness(p, { kind: 'stickiness', series: [{ event: 'use', filters: [] }], interval: 'day', dateRange: { from: '-7d' }, filters: [], excludeInternal: false });
    expect(r.series[0].total).toBe(2);
    expect(r.series[0].data[0]).toBe(1);
    expect(r.series[0].data[2]).toBe(1);
    expect(r.intervals).toBe(7);
  });
  it('ciclo de vida sobre eventos reales', async () => {
    const r = await runLifecycle(p, { kind: 'lifecycle', event: 'use', eventFilters: [], interval: 'day', dateRange: { from: '-7d' }, filters: [], excludeInternal: false });
    expect(r.buckets).toHaveLength(7);
    expect(r.new.reduce((a, b) => a + b, 0)).toBe(2);
    expect(r.returning.reduce((a, b) => a + b, 0)).toBe(2);
    // "once" dejó de venir hoy; "daily" sigue.
    expect(r.dormant[r.dormant.length - 1]).toBe(-1);
  });
  const funnel = { kind: 'funnel' as const, steps: [{ event: 'signup', filters: [] }, { event: 'paid', filters: [] }], windowDays: 14, dateRange: { from: '-7d' }, filters: [], excludeInternal: false };
  it('embudo por grupo: cuenta empresas, no personas', async () => {
    const r = await runFunnel(p, { ...funnel, groupType: 'company' });
    expect(r.steps[0].count).toBe(2);
    expect(r.steps[1].count).toBe(1);
  });
  it('correlación: el video empuja, el error aleja, y los pasos no cuentan', async () => {
    const r = await runCorrelation(p, { kind: 'correlation', funnel, source: 'events' });
    expect(r.convertedPeople).toBe(2);
    expect(r.droppedPeople).toBe(2);
    expect(r.positive.map((x) => x.name)).toContain('video');
    expect(r.negative.map((x) => x.name)).toContain('error');
    expect([...r.positive, ...r.negative].map((x) => x.name)).not.toContain('signup');
  });
  it('caminos con eventos propios, final y ids juntados', async () => {
    const pages = await runPaths(p, { kind: 'paths', dateRange: { from: '-7d' }, steps: 4, source: 'pageviews', collapseIds: true });
    expect(pages.topPaths[0].path).toEqual(['/orders/:id', '/thanks']);
    const all = await runPaths(p, { kind: 'paths', dateRange: { from: '-7d' }, steps: 4, source: 'all', collapseIds: false, endPath: '/thanks' });
    expect(all.topPaths[0].path).toEqual(['/orders/123', 'clicked', '/thanks']);
    const none = await runPaths(p, { kind: 'paths', dateRange: { from: '-7d' }, steps: 4, source: 'pageviews', collapseIds: false, endPath: '/nope' });
    expect(none.sessions).toBe(0);
  });
  it('retención acepta acciones', async () => {
    const a = await createAction(p.id, 'x', { name: 'Use', description: '', steps: [{ event: 'use', urlContains: null, filters: [] }] });
    const r = await runRetention(p, { kind: 'retention', startEvent: `@action:${a.id}`, returnEvent: `@action:${a.id}`, period: 'day', periods: 4, filters: [], excludeInternal: false });
    expect(r.cohorts.some((c) => c.size > 0)).toBe(true);
  });
});

describe('analytics: cohortes', () => {
  let p: ProjectRow;
  beforeAll(async () => {
    ({ project: p } = await newProject());
    await ingest(p, [
      { event: 'buy', distinct_id: 'ana', $set: { email: 'ana@acme.com', plan: 'pro' } },
      { event: 'buy', distinct_id: 'ana' },
      { event: 'view', distinct_id: 'bob', $set: { email: 'bob@acme.com', plan: 'free' } },
      { event: 'view', distinct_id: 'cid', $set: { email: 'cid@other.com', plan: 'free' } },
    ]);
  });
  const count = (id: string, def: Parameters<typeof countPersons>[1]) => countPersons(p.id, def, Date.now(), id);

  it('grupos con OR, reglas con AND y "no hizo"', async () => {
    const orDef = cohortDefinitionSchema.parse({
      groups: [
        { properties: [{ key: 'plan', op: 'eq', value: 'pro' }] },
        { properties: [{ key: 'email', op: 'contains', value: 'other.com' }] },
      ],
    });
    expect(await count('x', orDef)).toBe(2);
    const andDef = cohortDefinitionSchema.parse({ groups: [{ properties: [{ key: 'plan', op: 'eq', value: 'free' }], behaviors: [{ event: 'view', days: 7, minCount: 1 }] }] });
    expect(await count('x', andDef)).toBe(2);
    const notDef = cohortDefinitionSchema.parse({ groups: [{ behaviors: [{ event: 'buy', days: 7, minCount: 1, negate: true }] }] });
    expect(await count('x', notDef)).toBe(2);
    const minDef = cohortDefinitionSchema.parse({ groups: [{ behaviors: [{ event: 'buy', days: 7, minCount: 2 }] }] });
    expect(await count('x', minDef)).toBe(1);
  });
  it('una cohorte vieja (propiedades y una regla) sigue andando', async () => {
    const def = cohortDefinitionSchema.parse({ properties: [{ key: 'plan', op: 'eq', value: 'pro' }], behavior: { event: 'buy', days: 7, minCount: 1 } });
    expect(await count('x', def)).toBe(1);
  });
  it('estática: por distinct_id, por email sin distinguir mayúsculas; lo ajeno se cuenta y no entra', async () => {
    const c = await createCohort(p.id, 'x', { name: 'List', definition: cohortDefinitionSchema.parse({ type: 'static' }) });
    const res = await addCohortMembers(p.id, c.id, ['ana', 'BOB@acme.com', 'nobody', 'nobody']);
    expect(res).toEqual({ added: 2, notFound: 1 });
    expect(await count(c.id, c.definition)).toBe(2);
    const listed = await listPersons(p.id, { cohort: c.definition, cohortId: c.id });
    expect(listed.persons).toHaveLength(2);
    // Repetir no suma.
    expect((await addCohortMembers(p.id, c.id, ['ana'])).added).toBe(0);
    // Una persona de otro proyecto no se puede sumar.
    const { project: other } = await newProject();
    await ingest(other, [{ event: 'x', distinct_id: 'stranger' }]);
    expect(await addCohortMembers(p.id, c.id, ['stranger'])).toEqual({ added: 0, notFound: 1 });
    // Sirve como filtro en una tendencia.
    const r = await runTrends(p, trendsQuerySchema.parse({ kind: 'trends', series: [{ event: 'buy' }], cohortId: c.id, dateRange: { from: '-2d' } }));
    expect(r.series[0].total).toBe(2);
    expect((await getCohort(p.id, c.id))?.definition.type).toBe('static');
  });
  it('lee listas pegadas o en CSV', () => {
    expect(parseMemberList('email,name\na@b.c,Ana\n"d@e.f",Di\n\n')).toEqual(['a@b.c', 'd@e.f']);
  });
});

describe('analytics: flags con grupos y payloads', () => {
  it('el primer grupo que aplica decide; quien queda fuera del % sigue al siguiente; se puede forzar variante', () => {
    const base = { key: 'f', active: true, rollout: 100, conditions: [], variants: [{ key: 'a', rollout: 50 }, { key: 'b', rollout: 50 }] };
    const v = evaluateFlag(
      {
        ...base,
        groups: [
          { conditions: [{ key: 'plan', op: 'eq', value: 'pro', type: 'person' }], cohortId: null, rollout: 100, variant: 'b' },
          { conditions: [], cohortId: null, rollout: 0, variant: null },
        ],
      },
      'u',
      { plan: 'pro' },
    );
    expect(v).toBe('b');
    expect(evaluateFlag({ ...base, groups: [{ conditions: [{ key: 'plan', op: 'eq', value: 'pro', type: 'person' }], cohortId: null, rollout: 100, variant: null }, { conditions: [], cohortId: null, rollout: 0, variant: null }] }, 'u', { plan: 'free' })).toBe(false);
    expect(evaluateFlag({ ...base, variants: [], groups: [{ conditions: [], cohortId: 'c1', rollout: 100, variant: null }] }, 'u', {}, new Set())).toBe(false);
    expect(evaluateFlag({ ...base, variants: [], groups: [{ conditions: [], cohortId: 'c1', rollout: 100, variant: null }] }, 'u', {}, new Set(['c1']))).toBe(true);
  });
  it('decide trae payloads y entiende cohortes', async () => {
    const { project: p } = await newProject();
    await ingest(p, [{ event: 'x', distinct_id: 'vip', $set: { plan: 'pro' } }, { event: 'x', distinct_id: 'nope', $set: { plan: 'free' } }]);
    const cohort = await createCohort(p.id, 'u', { name: 'Pros', definition: cohortDefinitionSchema.parse({ groups: [{ properties: [{ key: 'plan', op: 'eq', value: 'pro' }] }] }) });
    const flag = await createFlag(p.id, 'u', { key: 'promo', name: '', active: true, rollout: 100, variants: [], conditions: [], groups: [{ conditions: [], cohortId: cohort.id, rollout: 100, variant: null }], payloads: { true: '{"color":"green"}' } });
    expect(typeof flag).toBe('object');
    forgetFlagsCache(p.id);
    const vip = await decideFlagsFull(p.id, 'vip');
    expect(vip.flags.promo).toBe(true);
    expect(vip.payloads.promo).toEqual({ color: 'green' });
    const nope = await decideFlagsFull(p.id, 'nope');
    expect(nope.flags.promo).toBe(false);
    expect(nope.payloads.promo).toBeUndefined();
  });
});

describe('analytics: experimentos', () => {
  it('mide cada variante después de la exposición, deja afuera a quien vio dos y no permite borrar el flag', async () => {
    const { project: p } = await newProject();
    const flag = await createFlag(p.id, 'u', { key: 'exp', name: '', active: false, rollout: 100, variants: [{ key: 'control', rollout: 50 }, { key: 'test', rollout: 50 }], conditions: [], groups: [], payloads: {} });
    if (typeof flag === 'string') throw new Error(flag);
    const started = NOW - 60_000;
    const x = await createExperiment(p.id, 'u', { name: 'E', hypothesis: '', flagId: flag.id, metrics: [{ event: 'paid', filters: [], type: 'conversion', mathProperty: null }, { event: 'paid', filters: [], type: 'mean', mathProperty: 'total' }] });
    if (typeof x === 'string') throw new Error(x);
    expect(await experimentsUsingFlag(p.id, flag.id)).toBe(1);
    expect((await experimentResults(p.id, x)).exposedTotal).toBe(0);
    await setExperimentStatus(p.id, x.id, 'start', started);
    expect(await setExperimentStatus(p.id, x.id, 'start', started)).toBe('invalid_state');
    const exp = (d: string, v: string, ts: number): Ev => ({ event: '$feature_flag_called', distinct_id: d, ts, properties: { $feature_flag: 'exp', $feature_flag_response: v } });
    const t = started + 1000;
    await ingest(p, [
      // Pagó antes de ver el flag: no cuenta.
      { event: 'paid', distinct_id: 'early', ts: t, properties: { total: 100 } },
      exp('early', 'control', t + 1000),
      exp('c1', 'control', t),
      exp('t1', 'test', t),
      { event: 'paid', distinct_id: 't1', ts: t + 2000, properties: { total: 50 } },
      { event: 'paid', distinct_id: 't1', ts: t + 3000, properties: { total: 10 } },
      // Vio las dos variantes.
      exp('both', 'control', t),
      exp('both', 'test', t + 1),
      // Otro flag y una variante que no existe no cuentan.
      { event: '$feature_flag_called', distinct_id: 'other', ts: t, properties: { $feature_flag: 'zzz', $feature_flag_response: 'test' } },
      exp('forged', 'hacked', t),
    ]);
    const fresh = (await getExperiment(p.id, x.id))!;
    const r = await experimentResults(p.id, fresh);
    expect(r.exposedTotal).toBe(3);
    expect(r.multipleVariants).toBe(1);
    const conv = r.metrics[0].variants;
    expect(conv.map((v) => v.key)).toEqual(['control', 'test']);
    expect(conv[0]).toMatchObject({ exposed: 2, value: 0 });
    expect(conv[1]).toMatchObject({ exposed: 1, value: 1 });
    expect(r.metrics[1].variants[1].value).toBe(60);
    // Con tan poca gente no se declara ganador.
    expect(r.metrics[0].winner).toBeNull();
    await setExperimentStatus(p.id, x.id, 'stop');
    expect(await shipVariant(p.id, x.id, 'nope')).toBe('invalid_variant');
    const done = await shipVariant(p.id, x.id, 'test');
    expect(typeof done === 'object' && done?.conclusion).toBe('test');
    forgetFlagsCache(p.id);
    expect((await decideFlagsFull(p.id, 'anyone')).flags.exp).toBe('test');
    await deleteFlag(p.id, 'none');
  });
  it('rechaza un flag sin variantes', async () => {
    const { project: p } = await newProject();
    const flag = await createFlag(p.id, 'u', { key: 'plain', name: '', active: true, rollout: 100, variants: [], conditions: [], groups: [], payloads: {} });
    if (typeof flag === 'string') throw new Error(flag);
    expect(await createExperiment(p.id, 'u', { name: 'E', hypothesis: '', flagId: flag.id, metrics: [{ event: 'x', filters: [], type: 'conversion', mathProperty: null }] })).toBe('flag_not_multivariate');
    expect(await createExperiment(p.id, 'u', { name: 'E', hypothesis: '', flagId: 'missing', metrics: [{ event: 'x', filters: [], type: 'conversion', mathProperty: null }] })).toBe('flag_not_found');
  });
});

describe('analytics: links públicos', () => {
  it('muestra el resultado sin la consulta ni ids de personas, y revocar corta al instante', async () => {
    const { project: p } = await newProject();
    await ingest(p, [{ event: 'signup', distinct_id: 'secret-person@acme.com' }]);
    const insight = await createInsight(p.id, 'u', {
      name: 'Funnel',
      query: insightQuerySchema.parse({ kind: 'funnel', steps: [{ event: 'signup', filters: [{ key: 'email', op: 'neq', value: 'hidden-filter@acme.com', type: 'person' }] }, { event: 'paid' }] }),
    });
    const share = await createShare(p.id, 'u', { insightId: insight.id });
    expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const view = await publicShareView(share.token);
    const json = JSON.stringify(view);
    expect(view?.tiles[0].result?.kind).toBe('funnel');
    expect((view?.tiles[0].result as FunnelResult).steps[0].count).toBe(1);
    expect(json).not.toContain('secret-person');
    expect(json).not.toContain('hidden-filter');
    await revokeShare(p.id, share.id);
    expect(await publicShareView(share.token)).toBeNull();
    expect(await shareByToken('nope')).toBeNull();
    expect(publicResult({ kind: 'funnel', steps: [], droppedPersons: [['x']], truncated: false })).toMatchObject({ droppedPersons: [[]] });
  });
  it('un tablero muestra solo sus insights; borrar el proyecto apaga el link', async () => {
    const { user, project: p } = await newProject();
    const a = await createInsight(p.id, 'u', { name: 'On board', query: insightQuerySchema.parse({ kind: 'trends', series: [{ event: 'x' }] }) });
    await createInsight(p.id, 'u', { name: 'Not on board', query: insightQuerySchema.parse({ kind: 'trends', series: [{ event: 'y' }] }) });
    const { createDashboard, updateDashboard } = await import('@/lib/analytics/records');
    const d = await createDashboard(p.id, 'u', { name: 'Board' });
    await updateDashboard(p.id, d.id, { insightIds: [a.id] });
    const share = await createShare(p.id, 'u', { dashboardId: d.id });
    const view = await publicShareView(share.token);
    expect(view?.tiles.map((t) => t.name)).toEqual(['On board']);
    await getDb().prepare('UPDATE analytics_projects SET deleted_at = ? WHERE id = ?').run(Date.now(), p.id);
    expect(await publicShareView(share.token)).toBeNull();
    expect(user.id).toBeTruthy();
  });
  it('un id de otro workspace responde 404 por la guarda de registros', async () => {
    const { project: p } = await newProject();
    const { user: stranger } = await newProject();
    const share = await createShare(p.id, 'u', { insightId: undefined });
    const res = await recordProject({ workspaceId: stranger.id, personId: stranger.id, role: 'owner', user: null }, 'analytics_shares', share.id);
    expect('status' in res && (res as Response).status).toBe(404);
  });
});

describe('analytics: alertas', () => {
  it('dispara por umbral o porcentaje; sin base no dispara', () => {
    expect(alertFires('above', 10, 11, null)).toBe(true);
    expect(alertFires('above', 10, 10, null)).toBe(false);
    expect(alertFires('below', 10, 9, null)).toBe(true);
    expect(alertFires('increase_pct', 50, 200, 100)).toBe(true);
    expect(alertFires('increase_pct', 50, 200, null)).toBe(false);
    expect(alertFires('increase_pct', 50, 200, 0)).toBe(false);
    expect(alertFires('decrease_pct', 50, 40, 100)).toBe(true);
  });

  async function setup() {
    const { user, project: p } = await newProject();
    const insight = await createInsight(p.id, user.id, { name: 'Daily', query: insightQuerySchema.parse({ kind: 'trends', series: [{ event: 'sale' }] }) });
    await ingest(p, [
      { event: 'sale', distinct_id: 'a', ts: NOW - DAY },
      { event: 'sale', distinct_id: 'b', ts: NOW - DAY },
      { event: 'sale', distinct_id: 'c', ts: NOW - DAY },
    ]);
    return { user, p, insight };
  }
  const notices = async (userId: string) => (await getDb().prepare("SELECT title FROM notifications WHERE user_id = ? AND type = 'analytics_alert'").all(userId)) as Array<{ title: string }>;

  it('avisa una vez al dispararse, no repite mientras siga y vuelve a avisar tras normalizarse', async () => {
    const { user, p, insight } = await setup();
    const alert = await createAlert(p.id, user.id, { name: 'Ventas altas', insightId: insight.id, seriesIndex: 0, condition: 'above', threshold: 2, frequency: 'daily', enabled: true, subscribers: [] });
    if (typeof alert === 'string') throw new Error(alert);
    expect((await runAlertsCron({ now: NOW })).fired).toBeGreaterThanOrEqual(1);
    expect(await notices(user.id)).toHaveLength(1);
    expect((await notices(user.id))[0].title).toContain('Ventas altas');
    const after = (await listAlerts(p.id))[0];
    expect(after.state).toBe('firing');
    expect(after.lastValue).toBe(3);
    // Ya corrió: no le toca hasta mañana.
    await runAlertsCron({ now: NOW + 1000 });
    expect(await notices(user.id)).toHaveLength(1);
    // Vence, sigue arriba: no repite.
    await getDb().prepare('UPDATE analytics_alerts SET next_check_at = 0 WHERE id = ?').run(alert.id);
    await runAlertsCron({ now: NOW + 2000 });
    expect(await notices(user.id)).toHaveLength(1);
    // Se normaliza y vuelve a dispararse: un aviso más.
    await getDb().prepare("UPDATE analytics_alerts SET next_check_at = 0, state = 'ok' WHERE id = ?").run(alert.id);
    await runAlertsCron({ now: NOW + 3000 });
    expect(await notices(user.id)).toHaveLength(2);
    expect(await deleteAlert(p.id, alert.id)).toBe(true);
  });
  it('una alerta reclamada por otra corrida no se corre dos veces', async () => {
    const { user, p, insight } = await setup();
    const alert = await createAlert(p.id, user.id, { name: 'A', insightId: insight.id, seriesIndex: 0, condition: 'above', threshold: 0, frequency: 'daily', enabled: true, subscribers: [] });
    if (typeof alert === 'string') throw new Error(alert);
    await getDb().prepare('UPDATE analytics_alerts SET claimed_at = ? WHERE id = ?').run(NOW, alert.id);
    await runAlertsCron({ now: NOW + 1000 });
    expect(await notices(user.id)).toHaveLength(0);
  });
  it('no avisa a quien no es del workspace; solo tendencias; tope por proyecto', async () => {
    const { user, p, insight } = await setup();
    const { user: stranger } = await newProject();
    const alert = await createAlert(p.id, user.id, { name: 'A', insightId: insight.id, seriesIndex: 0, condition: 'above', threshold: 0, frequency: 'daily', enabled: true, subscribers: [stranger.id] });
    if (typeof alert === 'string') throw new Error(alert);
    await runAlertsCron({ now: NOW });
    expect(await notices(stranger.id)).toHaveLength(0);
    const funnel = await createInsight(p.id, user.id, { name: 'F', query: insightQuerySchema.parse({ kind: 'funnel', steps: [{ event: 'a' }, { event: 'b' }] }) });
    expect(await createAlert(p.id, user.id, { name: 'B', insightId: funnel.id, seriesIndex: 0, condition: 'above', threshold: 1, frequency: 'daily', enabled: true, subscribers: [] })).toBe('insight_not_found');
    expect(await createAlert(p.id, user.id, { name: 'B', insightId: 'other', seriesIndex: 0, condition: 'above', threshold: 1, frequency: 'daily', enabled: true, subscribers: [] })).toBe('insight_not_found');
  });
});

describe('analytics: anotaciones, datos y borrado', () => {
  it('anotaciones por fecha; definiciones ocultan de los selectores', async () => {
    const { project: p } = await newProject();
    await createAnnotation(p.id, 'u', { date: '2026-10-01', content: 'Launch' });
    expect((await listAnnotations(p.id))[0].content).toBe('Launch');
    await ingest(p, [{ event: 'noise', distinct_id: 'a' }]);
    await saveEventDefinition(p.id, 'noise', { description: 'Ruido', verified: false, hidden: true });
    expect(await hiddenEvents(p.id)).toContain('noise');
    expect((await listEventDefinitions(p.id)).find((d) => d.event === 'noise')).toMatchObject({ description: 'Ruido', hidden: true, count30d: 1 });
  });
  it('borrar un proyecto no deja nada de lo nuevo', async () => {
    const { user, project: p } = await newProject();
    const insight = await createInsight(p.id, user.id, { name: 'I', query: insightQuerySchema.parse({ kind: 'trends', series: [{ event: 'x' }] }) });
    await createShare(p.id, user.id, { insightId: insight.id });
    await createAnnotation(p.id, user.id, { date: '2026-10-01', content: 'x' });
    await createAction(p.id, user.id, { name: 'a', description: '', steps: [] });
    await createAlert(p.id, user.id, { name: 'a', insightId: insight.id, seriesIndex: 0, condition: 'above', threshold: 1, frequency: 'daily', enabled: true, subscribers: [] });
    await saveEventDefinition(p.id, 'x', { description: '', verified: false, hidden: false });
    await getDb().prepare('UPDATE analytics_projects SET deleted_at = ? WHERE id = ?').run(Date.now(), p.id);
    // El cron purga de a 5 proyectos borrados: los de otros tests pueden ir antes.
    for (let i = 0; i < 6; i++) await runAnalyticsCron({ budgetMs: 15_000 });
    for (const table of ['analytics_shares', 'analytics_annotations', 'analytics_actions', 'analytics_alerts', 'analytics_event_defs', 'analytics_projects']) {
      const col = table === 'analytics_projects' ? 'id' : 'project_id';
      const r = (await getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(p.id)) as { n: number };
      expect(Number(r.n), table).toBe(0);
    }
  });
  it('un insight SQL sigue corriendo por el despacho', async () => {
    const { project: p } = await newProject();
    await expect(runInsight(p, { kind: 'stickiness', series: [{ event: 'x', filters: [] }], interval: 'week', dateRange: { from: '-14d' }, filters: [], excludeInternal: false })).resolves.toMatchObject({ kind: 'stickiness' });
  });
});
