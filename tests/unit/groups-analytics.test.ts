import { randomUUID } from 'crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createLabel, createNumber, deleteNumber, getNumberRowById, updateChat, upsertChat } from '@/lib/groups';
import { groupsViewer, setLabelAccess, updatePlatformSettings, type GroupsViewer } from '@/lib/groups-access';
import { setLineAccess } from '@/lib/groups-lines';
import { createTicket, updateTicket } from '@/lib/groups-tickets';
import { createGroupTask } from '@/lib/groups-tasks';
import { analyticsContext, cachedLinesAnalytics, clearAnalyticsCache, firstResponses, linesAnalytics, messageFactsSql } from '@/lib/groups-analytics';
import {
  ANALYTICS_TABS,
  analyticsCsvRows,
  analyticsRange,
  analyticsTab,
  delta,
  isEmptyData,
  localDay,
  median,
  responseBuckets,
  share,
  toCsv,
  tzOffsetSec,
  tzOffsetSql,
  tzSegments,
  weightedQuantile,
  zonedMidnight,
  type AnalyticsData,
  type BroadcastsData,
  type ConversationsData,
  type GroupsData,
  type LabelsData,
  type OverviewData,
  type ResponseData,
  type TeamData,
  type TicketsData,
} from '@/lib/groups-analytics-shared';
import { makeUser as newUser } from './helpers';

/**
 * La base es una sola para toda la corrida y hay crons que miran todos los
 * workspaces (recordatorios de tareas, tickets vencidos, chats sin responder).
 * Lo que este archivo deja a medias (una tarea atrasada, chats esperando) se
 * limpia al final para no cambiarle la cuenta a otro test.
 */
const workspaces: string[] = [];
async function makeUser(label: string) {
  const u = await newUser(label);
  workspaces.push(u.id);
  return u;
}

afterAll(async () => {
  const db = getDb();
  for (const ws of workspaces) {
    await db.prepare('UPDATE crm_activities SET done = 1 WHERE id IN (SELECT activity_id FROM groups_tasks WHERE user_id = ?)').run(ws);
    await db.prepare('DELETE FROM groups_tasks WHERE user_id = ?').run(ws);
    await db.prepare('DELETE FROM groups_tickets WHERE user_id = ?').run(ws);
    await db.prepare('DELETE FROM groups_broadcasts WHERE user_id = ?').run(ws);
    await db.prepare('UPDATE groups_chats SET awaiting_since = NULL, flagged_at = NULL WHERE user_id = ?').run(ws);
  }
});

/** Un "ahora" fijo: miércoles 11 de noviembre de 2026, 15:00 UTC. */
const NOW = new Date('2026-11-11T15:00:00.000Z');

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  clearAnalyticsCache();
});

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  return (await getNumberRowById(n.id))!;
}

type Line = Awaited<ReturnType<typeof line>>;

async function chat(number: Line, name: string, kind: 'dm' | 'group' = 'dm') {
  const id = `${Math.floor(Math.random() * 1e12)}${kind === 'group' ? '@g.us' : '@c.us'}`;
  return upsertChat(number, { providerChatId: id, kind, name }, { silent: true });
}

type Chat = Awaited<ReturnType<typeof chat>>;

/** Un mensaje con fecha propia, directo en la tabla (ingestEvents pone la de ahora). */
async function put(
  c: Pick<Chat, 'id' | 'user_id' | 'number_id'>,
  direction: 'in' | 'out' | 'system' | 'note',
  at: string,
  o: { by?: string | null; kind?: string; status?: string; meta?: Record<string, unknown>; numberId?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO groups_messages (id, user_id, chat_id, number_id, direction, author_id, author_kind, body, status, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'x', ?, ?, ?)`,
    )
    .run(id, c.user_id, c.id, o.numberId ?? c.number_id, direction, o.by ?? null, o.kind ?? (direction === 'out' ? 'person' : 'person'), o.status ?? (direction === 'in' ? 'received' : 'sent'), JSON.stringify(o.meta ?? {}), at);
  return id;
}

async function owner(ws: string): Promise<GroupsViewer> {
  return groupsViewer(ws, ws, 'owner');
}

const tab = async <T extends AnalyticsData>(ws: string, viewer: GroupsViewer, name: T['tab'], query: Parameters<typeof linesAnalytics>[3] = {}) =>
  (await linesAnalytics(ws, viewer, name, { days: 7, ...query }, { now: NOW })) as T;

/** Ningún número del resultado es NaN ni infinito. */
function assertFinite(v: unknown, path = 'data'): void {
  if (typeof v === 'number') expect(Number.isFinite(v), `${path} = ${v}`).toBe(true);
  else if (Array.isArray(v)) v.forEach((x, i) => assertFinite(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) assertFinite(x, `${path}.${k}`);
}

describe('rango y zona horaria (puro)', () => {
  it('últimos N días de calendario en la zona de quien mira, con el período anterior del mismo largo', () => {
    const r = analyticsRange({ days: 7, tz: 'America/Argentina/Buenos_Aires' }, NOW);
    expect(r).toMatchObject({ from: '2026-11-05', to: '2026-11-11', days: 7, prevFrom: '2026-10-29', prevTo: '2026-11-04', custom: false, clipped: false });
    // Medianoche de Buenos Aires = 03:00 UTC.
    expect(r.since).toBe('2026-11-05T03:00:00.000Z');
    expect(r.until).toBe('2026-11-12T03:00:00.000Z');
    expect(r.prevSince).toBe('2026-10-29T03:00:00.000Z');
  });

  it('cerca de la medianoche el día de hoy depende de la zona', () => {
    const late = new Date('2026-11-11T01:30:00Z');
    expect(analyticsRange({ days: 1, tz: 'America/Argentina/Buenos_Aires' }, late).to).toBe('2026-11-10');
    expect(analyticsRange({ days: 1, tz: 'UTC' }, late).to).toBe('2026-11-11');
    expect(analyticsRange({ days: 1, tz: 'Pacific/Kiritimati' }, late).to).toBe('2026-11-11');
    expect(analyticsRange({ days: 1, tz: 'Pacific/Pago_Pago' }, late).to).toBe('2026-11-10');
  });

  it('rango propio inclusive, invertido se ignora, enorme se recorta a un año, basura no rompe', () => {
    expect(analyticsRange({ from: '2026-10-01', to: '2026-10-07', tz: 'UTC' }, NOW)).toMatchObject({ days: 7, from: '2026-10-01', to: '2026-10-07', custom: true, prevFrom: '2026-09-24' });
    expect(analyticsRange({ days: 30, from: '2026-10-20', to: '2026-10-10', tz: 'UTC' }, NOW)).toMatchObject({ days: 30, custom: false });
    const huge = analyticsRange({ from: '1990-01-01', to: '2040-12-31', tz: 'UTC' }, NOW);
    expect(huge).toMatchObject({ days: 366, clipped: true, from: '1990-01-01' });
    for (const bad of [{ from: '2026-13-45' }, { from: 'ayer' }, { days: -5 }, { days: Number.NaN }, { days: 1e9 }, { tz: 'Marte/Olimpo' }, { from: '2026-02-30' }, { from: '0001-01-01', to: '0001-01-05' }, { from: ['2026-10-01', '2026-10-02'] }, { tz: 'x'.repeat(500) }, { from: '9999-12-31' }]) {
      const r = analyticsRange(bad as never, NOW);
      expect(r.days).toBeGreaterThanOrEqual(1);
      expect(r.days).toBeLessThanOrEqual(366);
      expect(Number.isFinite(Date.parse(r.since))).toBe(true);
    }
    expect(analyticsRange({ tz: 'Marte/Olimpo' }, NOW).tz).toBe('UTC');
    // Un año 1 no es un rango propio: cae en los últimos 30 días.
    expect(analyticsRange({ from: '0001-01-01', to: '0001-01-05', tz: 'America/New_York' }, NOW)).toMatchObject({ custom: false, days: 30 });
    // Desde en el futuro, sin hasta: un día, no un rango negativo.
    expect(analyticsRange({ from: '2027-01-01', tz: 'UTC' }, NOW)).toMatchObject({ days: 1, from: '2027-01-01', to: '2027-01-01' });
  });

  it('cambio de hora: los tramos de offset y la expresión SQL', () => {
    // Nueva York vuelve a horario estándar el 1 de noviembre de 2026 a las 06:00 UTC.
    const from = Date.parse('2026-10-25T00:00:00Z');
    const to = Date.parse('2026-11-08T00:00:00Z');
    const seg = tzSegments('America/New_York', from, to);
    expect(seg).toHaveLength(2);
    expect(seg[0].offsetSec).toBe(-4 * 3600);
    expect(seg[1]).toEqual({ fromSec: Date.parse('2026-11-01T06:00:00Z') / 1000, offsetSec: -5 * 3600 });
    expect(tzOffsetSql(seg, 'ts')).toBe(`(CASE WHEN ts < ${Date.parse('2026-11-01T06:00:00Z') / 1000} THEN -14400 ELSE -18000 END)`);
    expect(tzOffsetSql(tzSegments('UTC', from, to), 'ts')).toBe('0');
    expect(tzSegments('America/Argentina/Buenos_Aires', from, to)).toHaveLength(1);
    // Zonas con media hora y con 45 minutos.
    expect(tzOffsetSec(from, 'Asia/Kolkata')).toBe(19_800);
    expect(tzOffsetSec(from, 'Asia/Kathmandu')).toBe(20_700);
    expect(localDay(Date.parse('2026-11-10T19:00:00Z'), 'Asia/Kolkata')).toBe('2026-11-11');
    expect(new Date(zonedMidnight('2026-11-01', 'America/New_York')).toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(new Date(zonedMidnight('2026-11-02', 'America/New_York')).toISOString()).toBe('2026-11-02T05:00:00.000Z');
    // Un rango cualquiera (no alineado al minuto) termina.
    expect(tzSegments('Europe/Madrid', Date.parse('2026-03-01T00:00:17.123Z'), Date.parse('2026-04-02T11:59:01.001Z'))).toHaveLength(2);
  });

  it('percentiles, deltas y divisiones por cero', () => {
    expect(weightedQuantile([], 0.5)).toBeNull();
    expect(weightedQuantile([[7, 1]], 0.5)).toBe(7);
    expect(weightedQuantile([[7, 1]], 0.9)).toBe(7);
    expect(weightedQuantile([[5, 1], [10, 1]], 0.5)).toBe(8);
    expect(weightedQuantile([[1, 9], [100, 1]], 0.9)).toBe(1);
    expect(weightedQuantile([[1, 8], [100, 2]], 0.9)).toBe(100);
    expect(weightedQuantile([[3, 0]], 0.5)).toBeNull();
    // Igual que la mediana de siempre con los valores sueltos.
    const values = [4, 9, 1, 1, 30, 12, 7, 7];
    const pairs = [...new Set(values)].map((v) => [v, values.filter((x) => x === v).length] as [number, number]);
    expect(weightedQuantile(pairs, 0.5)).toBe(median(values));
    expect(delta(5, 0)).toBeNull();
    expect(delta(null, 3)).toBeNull();
    expect(delta(0, 4)).toBe(-1);
    expect(delta(6, 4)).toBe(0.5);
    expect(delta(Number.NaN, 4)).toBeNull();
    expect(share(1, 0)).toBe(0);
    expect(share(3, 4)).toBe(0.75);
    expect(share(9, 4)).toBe(1);
    expect(responseBuckets([[0, 2], [4, 1], [5, 1], [59, 1], [60, 1], [1440, 3], [99999, 1]])).toEqual([3, 1, 1, 1, 0, 4]);
    expect(analyticsTab('team')).toBe('team');
    expect(analyticsTab('<script>')).toBe('overview');
    expect(analyticsTab(undefined)).toBe('overview');
    expect(toCsv([['=1+1', 'a,b', 'x"y']])).toBe(`'=1+1,"a,b","x""y"\n`);
  });
});

describe('workspace vacío y un solo mensaje', () => {
  it('sin nada: todas las pestañas dan ceros, sin NaN, y se reconocen como vacías', async () => {
    const u = await makeUser('an-empty');
    const v = await owner(u.id);
    for (const name of ANALYTICS_TABS) {
      const d = await tab(u.id, v, name);
      assertFinite(d);
      expect(isEmptyData(d), name).toBe(true);
      expect(analyticsCsvRows(d).length).toBeGreaterThanOrEqual(1);
    }
    const o = await tab<OverviewData>(u.id, v, 'overview');
    expect(o.kpis.inbound).toEqual({ value: 0, prev: 0 });
    expect(o.kpis.firstResponseMin).toEqual({ value: null, prev: null });
    expect(o.perDay).toHaveLength(7);
    expect(o.lines).toEqual([]);
    const c = await tab<ConversationsData>(u.id, v, 'conversations');
    expect(c.kpis.perChat).toEqual({ value: null, prev: null });
    expect(c.heatmap.flat().every((n) => n === 0)).toBe(true);
  });

  it('con una línea conectada y ningún mensaje tampoco hay números', async () => {
    const u = await makeUser('an-line-only');
    await line(u.id, 'Ventas');
    const o = await tab<OverviewData>(u.id, await owner(u.id), 'overview');
    expect(isEmptyData(o)).toBe(true);
  });

  it('un mensaje recibido: cuenta uno, queda sin responder y no inventa mediana', async () => {
    const u = await makeUser('an-one');
    const n = await line(u.id, 'Ventas');
    const c = await chat(n, 'Marta Roldán');
    await put(c, 'in', '2026-11-10T12:00:00.000Z');
    const v = await owner(u.id);
    const o = await tab<OverviewData>(u.id, v, 'overview');
    expect(o.kpis.inbound).toEqual({ value: 1, prev: 0 });
    expect(o.kpis.outbound.value).toBe(0);
    expect(o.kpis.activeChats).toEqual({ value: 1, prev: 0 });
    expect(o.kpis.firstResponseMin.value).toBeNull();
    expect(delta(o.kpis.inbound.value, o.kpis.inbound.prev)).toBeNull();
    expect(o.perDay.find((p) => p.day === '2026-11-10')).toMatchObject({ inbound: 1, outbound: 0 });
    expect(o.topChats).toMatchObject([{ id: c.id, name: 'Marta Roldán', inbound: 1, outbound: 0 }]);
    expect(o.lines).toMatchObject([{ id: n.id, name: 'Ventas', inbound: 1, activeChats: 1 }]);
    const r = await tab<ResponseData>(u.id, v, 'response');
    expect(r.kpis.unanswered.value).toBe(1);
    expect(r.kpis.medianMin).toEqual({ value: null, prev: null });
    expect(r.buckets).toEqual([0, 0, 0, 0, 0, 0]);
    assertFinite(r);
  });
});

describe('volumen, comparación y bordes de zona horaria', () => {
  it('cada mensaje cae en su día local y el período anterior se alinea', async () => {
    const u = await makeUser('an-tz');
    const n = await line(u.id, 'Soporte');
    const c = await chat(n, 'Pedro Giménez');
    // 02:30 UTC del 10 = 23:30 del 9 en Buenos Aires.
    await put(c, 'in', '2026-11-10T02:30:00.000Z');
    await put(c, 'out', '2026-11-10T03:10:00.000Z', { by: u.id });
    // Borde del rango: 03:00 UTC del 5 es la medianoche local del 5 (entra); un segundo antes es el 4 (período anterior).
    await put(c, 'in', '2026-11-05T03:00:00.000Z');
    await put(c, 'in', '2026-11-05T02:59:59.000Z');
    // Fuera de los dos períodos.
    await put(c, 'in', '2026-10-01T12:00:00.000Z');
    // Notas internas y mensajes del sistema no son mensajes.
    await put(c, 'note', '2026-11-10T12:00:00.000Z', { by: u.id });
    await put(c, 'system', '2026-11-10T12:00:00.000Z', { kind: 'call' });
    const v = await owner(u.id);

    const ba = await tab<ConversationsData>(u.id, v, 'conversations', { tz: 'America/Argentina/Buenos_Aires' });
    expect(ba.kpis.inbound).toEqual({ value: 2, prev: 1 });
    expect(ba.kpis.outbound).toEqual({ value: 1, prev: 0 });
    expect(ba.perDay.find((p) => p.day === '2026-11-09')).toMatchObject({ inbound: 1, outbound: 0 });
    expect(ba.perDay.find((p) => p.day === '2026-11-10')).toMatchObject({ inbound: 0, outbound: 1 });
    expect(ba.perDay[0]).toMatchObject({ day: '2026-11-05', inbound: 1 });
    expect(ba.prevPerDay[6]).toMatchObject({ day: '2026-11-04', inbound: 1 });
    // Lunes 9 a las 23 y jueves 5 a las 0, hora local.
    expect(ba.heatmap[0][23]).toBe(1);
    expect(ba.heatmap[3][0]).toBe(1);
    expect(ba.heatmap.flat().reduce((a, b) => a + b, 0)).toBe(2);
    expect(ba.kpis.perChat.value).toBe(3);

    const utc = await tab<ConversationsData>(u.id, v, 'conversations', { tz: 'UTC' });
    expect(utc.kpis.inbound).toEqual({ value: 3, prev: 0 });
    expect(utc.perDay.find((p) => p.day === '2026-11-10')).toMatchObject({ inbound: 1, outbound: 1 });
    expect(utc.heatmap[1][2]).toBe(1);
  });

  it('el día del cambio de hora no pierde ni duplica mensajes', async () => {
    const u = await makeUser('an-dst');
    const n = await line(u.id, 'Soporte');
    const c = await chat(n, 'Nora Paz');
    // 1 de noviembre de 2026 en Nueva York: 25 horas. Uno por hora UTC desde las 04:00 (medianoche local) hasta las 04:00 del 2.
    for (let h = 0; h < 25; h++) await put(c, 'in', new Date(Date.parse('2026-11-01T04:00:00.000Z') + h * 3_600_000).toISOString());
    const d = await tab<ConversationsData>(u.id, await owner(u.id), 'conversations', { from: '2026-11-01', to: '2026-11-01', tz: 'America/New_York' });
    expect(d.perDay).toEqual([{ day: '2026-11-01', inbound: 25, outbound: 0 }]);
    // Domingo: la 1 de la mañana pasa dos veces.
    expect(d.heatmap[6][1]).toBe(2);
    expect(d.heatmap[6].reduce((a, b) => a + b, 0)).toBe(25);
    const next = await tab<ConversationsData>(u.id, await owner(u.id), 'conversations', { from: '2026-11-02', to: '2026-11-02', tz: 'America/New_York' });
    expect(next.kpis.inbound).toEqual({ value: 0, prev: 25 });
  });

  it('rango enorme: se recorta, devuelve una serie de 366 días y no lee de más', async () => {
    const u = await makeUser('an-huge');
    const n = await line(u.id, 'Soporte');
    const c = await chat(n, 'Lía Sosa');
    await put(c, 'in', '2026-11-10T12:00:00.000Z');
    const d = await tab<OverviewData>(u.id, await owner(u.id), 'overview', { from: '2026-01-01', to: '2099-01-01', tz: 'UTC' });
    expect(d.range).toMatchObject({ days: 366, clipped: true, to: '2027-01-01' });
    expect(d.perDay).toHaveLength(366);
    expect(d.kpis.inbound.value).toBe(1);
    assertFinite(d);
  });
});

describe('primera respuesta en SQL', () => {
  it('coincide con la referencia en memoria sobre un historial al azar', async () => {
    const u = await makeUser('an-fr');
    const n = await line(u.id, 'Soporte');
    const chats = [await chat(n, 'Uno'), await chat(n, 'Dos'), await chat(n, 'Tres', 'group'), await chat(n, 'Cuatro')];
    // Generador con semilla fija: el test es siempre el mismo.
    let seed = 20261111;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const base = Date.parse('2026-11-05T00:00:00.000Z');
    const all: Array<{ chat_id: string; direction: 'in' | 'out'; author_id: string | null; author_kind: string; created_at: string }> = [];
    let t = base;
    for (let i = 0; i < 260; i++) {
      t += Math.floor(rnd() * 40 * 60_000) + 1000;
      const c = chats[Math.floor(rnd() * chats.length)];
      const r = rnd();
      const m = r < 0.5 ? { direction: 'in' as const, by: null, kind: 'person' } : r < 0.85 ? { direction: 'out' as const, by: u.id, kind: 'person' } : r < 0.93 ? { direction: 'out' as const, by: null, kind: 'broadcast' } : { direction: 'out' as const, by: null, kind: 'phone' };
      const at = new Date(t).toISOString();
      await put(c, m.direction, at, { by: m.by, kind: m.kind });
      all.push({ chat_id: c.id, direction: m.direction, author_id: m.by, author_kind: m.kind, created_at: at });
    }
    expect(t).toBeLessThan(NOW.getTime());
    const ref = firstResponses(all);
    expect(ref.length).toBeGreaterThan(20);
    const d = await tab<ResponseData>(u.id, await owner(u.id), 'response', { tz: 'UTC' });
    expect(d.kpis.responses.value).toBe(ref.length);
    expect(d.kpis.medianMin.value).toBe(median(ref.map((r) => r.minutes)));
    const sorted = ref.map((r) => r.minutes).sort((a, b) => a - b);
    expect(d.kpis.p90Min.value).toBe(sorted[Math.ceil(0.9 * sorted.length) - 1]);
    expect(d.buckets.reduce((a, b) => a + b, 0)).toBe(ref.length);
    expect(d.perDay.reduce((a, p) => a + p.responses, 0)).toBe(ref.length);
    // Por persona: las respuestas del usuario y las del teléfono.
    const tm = await tab<TeamData>(u.id, await owner(u.id), 'team', { tz: 'UTC' });
    const me = tm.agents.find((a) => a.id === u.id)!;
    expect(me.responses).toBe(ref.filter((r) => r.by === u.id).length);
    expect(me.medianMin).toBe(median(ref.filter((r) => r.by === u.id).map((r) => r.minutes)));
    expect(tm.agents.find((a) => a.kind === 'phone')?.responses).toBe(ref.filter((r) => r.by === null).length);
    expect(me.sent).toBe(all.filter((m) => m.direction === 'out' && m.author_kind === 'person').length);
    // Los envíos masivos no son de nadie del equipo.
    expect(tm.agents.reduce((a, x) => a + x.sent, 0)).toBe(all.filter((m) => m.direction === 'out' && m.author_kind !== 'broadcast').length);
  });

  it('un envío masivo no cuenta como respuesta y una respuesta en el mismo segundo da 0 minutos', async () => {
    const u = await makeUser('an-fr-edge');
    const n = await line(u.id, 'Soporte');
    const a = await chat(n, 'Alma');
    const b = await chat(n, 'Blas');
    await put(a, 'in', '2026-11-10T10:00:00.000Z');
    await put(a, 'out', '2026-11-10T10:05:00.000Z', { kind: 'broadcast' });
    await put(a, 'out', '2026-11-10T11:00:00.000Z', { by: u.id });
    await put(b, 'in', '2026-11-10T10:00:00.000Z');
    await put(b, 'out', '2026-11-10T10:00:00.000Z', { by: u.id });
    const d = await tab<ResponseData>(u.id, await owner(u.id), 'response', { tz: 'UTC' });
    expect(d.kpis.responses.value).toBe(2);
    expect(d.kpis.medianMin.value).toBe(30);
    expect(d.kpis.p90Min.value).toBe(60);
    expect(d.kpis.unanswered.value).toBe(0);
    expect(d.buckets).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe('acceso: nadie ve números de lo que no puede ver', () => {
  async function world(label: string) {
    const ws = await makeUser(`${label}-ws`);
    const ana = await makeUser(`${label}-ana`);
    const beto = await makeUser(`${label}-beto`);
    const team = await createTeam(ws.id, 'Workspace');
    for (const p of [ana, beto]) await addMember(team.id, p.id, 'member');
    const pub = await line(ws.id, 'Pública');
    const priv = await line(ws.id, 'Privada');
    const pubChat = await chat(pub, 'Cliente Abierto');
    const privChat = await chat(priv, 'Cliente Reservado');
    const privGroup = await chat(priv, 'Grupo Reservado', 'group');
    await put(pubChat, 'in', '2026-11-10T10:00:00.000Z');
    await put(pubChat, 'out', '2026-11-10T10:04:00.000Z', { by: ana.id });
    for (let i = 0; i < 5; i++) await put(privChat, 'in', `2026-11-10T11:0${i}:00.000Z`);
    await put(privChat, 'out', '2026-11-10T13:00:00.000Z', { by: beto.id });
    await put(privGroup, 'in', '2026-11-10T14:00:00.000Z');
    await getDb().prepare('UPDATE groups_chats SET awaiting_since = ? WHERE id = ?').run('2026-11-10T14:00:00.000Z', privGroup.id);
    await createTicket(ws.id, ws.id, { chatId: privChat.id, title: 'Reclamo reservado' });
    // La línea privada: solo Beto.
    await setLineAccess(ws.id, priv.id, { ownerId: beto.id, visibility: 'restricted', personIds: [], teamIds: [] });
    return { ws, ana, beto, pub, priv, pubChat, privChat, privGroup };
  }

  it('un miembro sin acceso a una línea no ve sus mensajes, chats, tickets ni grupos en ninguna pestaña', async () => {
    const w = await world('an-acc');
    const boss = await owner(w.ws.id);
    const ana = await groupsViewer(w.ws.id, w.ana.id, 'member');
    const beto = await groupsViewer(w.ws.id, w.beto.id, 'member');
    const opt = { tz: 'UTC' };

    const all = await tab<OverviewData>(w.ws.id, boss, 'overview', opt);
    expect(all.kpis.inbound.value).toBe(7);
    expect(all.kpis.activeChats.value).toBe(3);
    expect(all.kpis.ticketsCreated.value).toBe(1);
    expect(all.lines.map((l) => l.name).sort()).toEqual(['Privada', 'Pública']);

    const mine = await tab<OverviewData>(w.ws.id, ana, 'overview', opt);
    expect(mine.kpis.inbound.value).toBe(1);
    expect(mine.kpis.outbound.value).toBe(1);
    expect(mine.kpis.activeChats.value).toBe(1);
    expect(mine.kpis.newChats.value).toBe(1);
    expect(mine.kpis.awaiting.value).toBe(0);
    expect(mine.kpis.ticketsCreated.value).toBe(0);
    expect(mine.kpis.openTickets.value).toBe(0);
    expect(mine.kpis.firstResponseMin.value).toBe(4);
    expect(mine.lines.map((l) => l.name)).toEqual(['Pública']);
    expect(mine.topChats.map((c) => c.name)).toEqual(['Cliente Abierto']);

    // Con acceso (dueño de la línea) sí.
    const his = await tab<OverviewData>(w.ws.id, beto, 'overview', opt);
    expect(his.kpis.inbound.value).toBe(7);
    expect(his.kpis.ticketsCreated.value).toBe(1);

    // Pedir la línea prohibida por id no devuelve nada.
    for (const name of ANALYTICS_TABS) {
      const d = await tab(w.ws.id, ana, name, { ...opt, numberId: w.priv.id });
      expect(isEmptyData(d), `${name} con la línea prohibida`).toBe(true);
      expect(JSON.stringify(d)).not.toContain('Reservado');
    }
    // Y en ninguna pestaña aparece algo de la línea privada.
    for (const name of ANALYTICS_TABS) {
      const d = await tab(w.ws.id, ana, name, opt);
      expect(JSON.stringify(d), name).not.toContain('Reservado');
      expect(JSON.stringify(d), name).not.toContain(w.priv.id);
    }
    const resp = await tab<ResponseData>(w.ws.id, ana, 'response', opt);
    expect(resp.kpis.responses.value).toBe(1);
    expect(resp.kpis.awaiting.value).toBe(0);
    expect(resp.waiting).toEqual([]);
    const tm = await tab<TeamData>(w.ws.id, ana, 'team', opt);
    expect(tm.agents.map((a) => a.id)).toEqual([w.ana.id]);
    const gr = await tab<GroupsData>(w.ws.id, ana, 'groups', opt);
    expect(gr.kpis.groups.value).toBe(0);
    expect((await tab<GroupsData>(w.ws.id, boss, 'groups', opt)).top.map((g) => g.name)).toEqual(['Grupo Reservado']);
    const tk = await tab<TicketsData>(w.ws.id, ana, 'tickets', opt);
    expect(tk.kpis.created.value).toBe(0);
    expect((await tab<TicketsData>(w.ws.id, beto, 'tickets', opt)).kpis.created.value).toBe(1);
  });

  it('acceso por etiqueta: el miembro ve solo sus etiquetas y sus chats asignados', async () => {
    const w = await world('an-lab');
    await setLineAccess(w.ws.id, w.priv.id, { ownerId: null, visibility: 'all', personIds: [], teamIds: [] });
    await updatePlatformSettings(w.ws.id, { labelAccess: true });
    const vip = await createLabel(w.ws.id, { name: 'VIP' });
    await updateChat(w.ws.id, w.privChat.id, { labelIds: [vip.id] });
    await setLabelAccess(w.ws.id, vip.id, [w.beto.id]);
    const ana = await groupsViewer(w.ws.id, w.ana.id, 'member');
    const beto = await groupsViewer(w.ws.id, w.beto.id, 'member');
    expect(ana.restricted).toBe(true);
    // Ana no tiene etiquetas ni chats asignados: nada.
    for (const name of ANALYTICS_TABS) expect(isEmptyData(await tab(w.ws.id, ana, name, { tz: 'UTC' })), name).toBe(true);
    // Beto ve el chat de su etiqueta.
    const his = await tab<OverviewData>(w.ws.id, beto, 'overview', { tz: 'UTC' });
    expect(his.kpis.inbound.value).toBe(5);
    expect(his.topChats.map((c) => c.name)).toEqual(['Cliente Reservado']);
    const labels = await tab<LabelsData>(w.ws.id, beto, 'labels', { tz: 'UTC' });
    expect(labels.rows).toMatchObject([{ name: 'VIP', chats: 1, inbound: 5, outbound: 1, activeChats: 1 }]);
    expect(labels.kpis).toMatchObject({ labelled: { value: 1 }, unlabelled: { value: 0 } });
    // Un chat asignado a Ana aparece para ella.
    await updateChat(w.ws.id, w.pubChat.id, { assignedTo: w.ana.id });
    expect((await tab<OverviewData>(w.ws.id, ana, 'overview', { tz: 'UTC' })).kpis.inbound.value).toBe(1);
    // Admin: todo.
    expect((await tab<OverviewData>(w.ws.id, await groupsViewer(w.ws.id, w.ana.id, 'admin'), 'overview', { tz: 'UTC' })).kpis.inbound.value).toBe(7);
  });

  it('teléfonos ocultos: el nombre de un chat sin nombre va enmascarado', async () => {
    const ws = await makeUser('an-mask');
    const ana = await makeUser('an-mask-ana');
    const team = await createTeam(ws.id, 'Workspace');
    await addMember(team.id, ana.id, 'member');
    await updatePlatformSettings(ws.id, { maskRoles: ['member'] });
    const n = await line(ws.id, 'Ventas');
    const c = await upsertChat(n, { providerChatId: '5491144445555@c.us', kind: 'dm', name: '', phone: '5491144445555' }, { silent: true });
    await put(c, 'in', '2026-11-10T10:00:00.000Z');
    const d = await tab<OverviewData>(ws.id, await groupsViewer(ws.id, ana.id, 'member'), 'overview', { tz: 'UTC' });
    expect(d.topChats).toHaveLength(1);
    expect(d.topChats[0].name).not.toContain('44445555');
    expect((await tab<OverviewData>(ws.id, await owner(ws.id), 'overview', { tz: 'UTC' })).topChats[0].name).toBe('+5491144445555');
  });

  it('los datos de otro workspace no se mezclan', async () => {
    const a = await makeUser('an-ws-a');
    const b = await makeUser('an-ws-b');
    const na = await line(a.id, 'A');
    const ca = await chat(na, 'Solo de A');
    await put(ca, 'in', '2026-11-10T10:00:00.000Z');
    const label = await createLabel(a.id, { name: 'De A' });
    await updateChat(a.id, ca.id, { labelIds: [label.id] });
    const v = await owner(b.id);
    for (const name of ANALYTICS_TABS) {
      // Ni pasando ids de A como filtro.
      const d = await tab(b.id, v, name, { tz: 'UTC', numberId: na.id, labelId: label.id, agentId: a.id });
      expect(isEmptyData(d), name).toBe(true);
      expect(isEmptyData(await tab(b.id, v, name, { tz: 'UTC' })), name).toBe(true);
    }
  });
});

describe('líneas borradas y filtros', () => {
  it('borrar una línea se lleva sus chats y mensajes: el tablero queda en cero sin romperse', async () => {
    const u = await makeUser('an-del');
    const n = await line(u.id, 'Vieja');
    const c = await chat(n, 'Tito');
    await put(c, 'in', '2026-11-10T10:00:00.000Z');
    await createTicket(u.id, u.id, { chatId: c.id, title: 'Queda sin chat' });
    const v = await owner(u.id);
    expect((await tab<OverviewData>(u.id, v, 'overview')).kpis.inbound.value).toBe(1);
    await deleteNumber(u.id, n.id);
    for (const name of ANALYTICS_TABS) assertFinite(await tab(u.id, v, name));
    const o = await tab<OverviewData>(u.id, v, 'overview');
    expect(o.kpis.inbound.value).toBe(0);
    expect(o.lines).toEqual([]);
    // El ticket sigue (chat_id queda en NULL): se cuenta sin filtros y no con filtro de línea.
    expect(o.kpis.ticketsCreated.value).toBe(1);
  });

  it('mensajes de una línea que ya no figura: una fila sin nombre, no un id suelto', async () => {
    const u = await makeUser('an-orphan');
    const n = await line(u.id, 'Actual');
    const c = await chat(n, 'Rita');
    await put(c, 'in', '2026-11-10T10:00:00.000Z');
    await put(c, 'in', '2026-11-10T10:01:00.000Z', { numberId: 'linea-que-no-existe' });
    await put(c, 'in', '2026-11-10T10:02:00.000Z', { numberId: 'otra-que-tampoco' });
    const d = await tab<ConversationsData>(u.id, await owner(u.id), 'conversations', { tz: 'UTC' });
    expect(d.lines).toHaveLength(2);
    expect(d.lines.find((l) => l.id === null)).toMatchObject({ name: null, inbound: 2 });
    expect(d.lines.find((l) => l.id === n.id)).toMatchObject({ name: 'Actual', inbound: 1 });
  });

  it('filtros por línea, etiqueta y persona asignada', async () => {
    const u = await makeUser('an-filters');
    const a = await line(u.id, 'A');
    const b = await line(u.id, 'B');
    const ca = await chat(a, 'En A');
    const cb = await chat(b, 'En B');
    await put(ca, 'in', '2026-11-10T10:00:00.000Z');
    await put(cb, 'in', '2026-11-10T10:00:00.000Z');
    await put(cb, 'in', '2026-11-10T10:01:00.000Z');
    const label = await createLabel(u.id, { name: 'Mayoristas' });
    await updateChat(u.id, cb.id, { labelIds: [label.id], assignedTo: u.id });
    const v = await owner(u.id);
    const inbound = async (q: Parameters<typeof linesAnalytics>[3]) => (await tab<OverviewData>(u.id, v, 'overview', { tz: 'UTC', ...q })).kpis.inbound.value;
    expect(await inbound({})).toBe(3);
    expect(await inbound({ numberId: a.id })).toBe(1);
    expect(await inbound({ numberId: b.id })).toBe(2);
    expect(await inbound({ labelId: label.id })).toBe(2);
    expect(await inbound({ agentId: u.id })).toBe(2);
    expect(await inbound({ numberId: a.id, labelId: label.id })).toBe(0);
    expect(await inbound({ labelId: 'no-existe' })).toBe(0);
    expect(await inbound({ from: '2020-01-01', to: '2020-01-31' })).toBe(0);
    const labels = await tab<LabelsData>(u.id, v, 'labels', { tz: 'UTC' });
    expect(labels.rows).toMatchObject([{ name: 'Mayoristas', chats: 1, inbound: 2 }]);
    expect(labels.kpis.unlabelled.value).toBe(1);
  });
});

describe('equipo, grupos, tickets, tareas y envíos', () => {
  it('equipo: enviados, chats, asignaciones, cierres, chats abiertos y tickets resueltos por persona', async () => {
    const ws = await makeUser('an-team');
    const ana = await makeUser('an-team-ana');
    const team = await createTeam(ws.id, 'Workspace');
    await addMember(team.id, ana.id, 'member');
    const n = await line(ws.id, 'Ventas');
    const c1 = await chat(n, 'Uno');
    const c2 = await chat(n, 'Dos');
    await put(c1, 'in', '2026-11-10T10:00:00.000Z');
    await put(c1, 'out', '2026-11-10T10:10:00.000Z', { by: ana.id });
    await put(c1, 'out', '2026-11-10T10:11:00.000Z', { by: ana.id });
    await put(c2, 'out', '2026-11-10T10:12:00.000Z', { by: ana.id });
    await put(c2, 'out', '2026-11-10T10:13:00.000Z', { kind: 'agent' });
    await put(c2, 'out', '2026-11-10T10:14:00.000Z', { kind: 'api', by: ws.id });
    await put(c2, 'out', '2026-11-03T10:14:00.000Z', { by: ana.id });
    await put(c1, 'system', '2026-11-10T10:15:00.000Z', { kind: 'event', by: ws.id, meta: { event: 'assigned', to: ana.id, by: ws.id } });
    await put(c2, 'system', '2026-11-10T10:16:00.000Z', { kind: 'event', meta: { event: 'auto_assigned', to: ana.id, rule: 'Ventas' } });
    await put(c2, 'system', '2026-11-10T10:17:00.000Z', { kind: 'event', by: ana.id, meta: { event: 'closed', by: ana.id } });
    await put(c2, 'system', '2026-11-10T10:18:00.000Z', { kind: 'event', by: ws.id, meta: { event: 'unassigned', to: null, by: ws.id } });
    // meta rota: no rompe la consulta.
    await getDb().prepare("UPDATE groups_messages SET meta = 'no es json' WHERE chat_id = ? AND created_at = ?").run(c2.id, '2026-11-10T10:18:00.000Z');
    await getDb().prepare('UPDATE groups_chats SET assigned_to = ? WHERE id = ?').run(ana.id, c1.id);
    const tk = (await createTicket(ws.id, ws.id, { chatId: c1.id, title: 'Cambio de talle', assigneeId: ana.id })).ticket;
    await updateTicket(ws.id, tk.id, { status: 'resolved' });
    await getDb().prepare('UPDATE groups_tickets SET created_at = ?, resolved_at = ? WHERE id = ?').run('2026-11-10T08:00:00.000Z', '2026-11-10T09:30:00.000Z', tk.id);

    const d = await tab<TeamData>(ws.id, await owner(ws.id), 'team', { tz: 'UTC' });
    const a = d.agents.find((x) => x.id === ana.id)!;
    expect(a).toMatchObject({ kind: 'person', name: 'an-team-ana', sent: 3, prevSent: 1, chats: 2, responses: 1, medianMin: 10, assigned: 2, closed: 1, openChats: 1, ticketsResolved: 1 });
    expect(d.agents.find((x) => x.kind === 'ai')).toMatchObject({ sent: 1, id: null, name: null });
    expect(d.agents.find((x) => x.kind === 'auto')).toMatchObject({ sent: 1 });
    expect(d.kpis).toMatchObject({ people: { value: 1, prev: 1 }, sent: { value: 3, prev: 1 }, perPerson: { value: 3, prev: 1 }, assignments: { value: 2, prev: 0 }, unassigned: { value: 1 } });
    expect(analyticsCsvRows(d)[1].slice(0, 3)).toEqual(['an-team-ana', 'person', 3]);

    const t = await tab<TicketsData>(ws.id, await owner(ws.id), 'tickets', { tz: 'UTC' });
    expect(t.kpis).toMatchObject({ created: { value: 1, prev: 0 }, resolved: { value: 1, prev: 0 }, open: { value: 0 }, resolutionMin: { value: 90, prev: null }, breached: { value: 0, prev: 0 } });
    expect(t.perDay.find((p) => p.day === '2026-11-10')).toMatchObject({ created: 1, resolved: 1 });
    expect(t.byStatus).toEqual([{ key: 'resolved', value: 1 }]);
    expect(t.byPriority).toEqual([{ key: 'medium', value: 1 }]);
  });

  it('una persona que ya no está en el workspace aparece sin nombre, no con su id', async () => {
    const ws = await makeUser('an-gone');
    const n = await line(ws.id, 'Ventas');
    const c = await chat(n, 'Uno');
    await put(c, 'out', '2026-11-10T10:10:00.000Z', { by: 'persona-que-se-fue' });
    const d = await tab<TeamData>(ws.id, await owner(ws.id), 'team', { tz: 'UTC' });
    expect(d.agents).toMatchObject([{ kind: 'person', id: 'persona-que-se-fue', name: null, sent: 1 }]);
  });

  it('grupos: los más activos, los callados y los miembros; los chats 1:1 no entran', async () => {
    const u = await makeUser('an-groups');
    const n = await line(u.id, 'Comunidad');
    const g1 = await chat(n, 'Vecinos Norte', 'group');
    const g2 = await chat(n, 'Vecinos Sur', 'group');
    const g3 = await chat(n, 'Vecinos Este', 'group');
    const dm = await chat(n, 'Una persona');
    await getDb().prepare('UPDATE groups_chats SET member_count = 12 WHERE id = ?').run(g1.id);
    await getDb().prepare('UPDATE groups_chats SET member_count = 30 WHERE id = ?').run(g2.id);
    await put(g1, 'in', '2026-11-10T10:00:00.000Z');
    await put(g2, 'in', '2026-11-10T10:00:00.000Z');
    await put(g2, 'in', '2026-11-10T10:01:00.000Z');
    await put(g2, 'out', '2026-11-10T10:02:00.000Z', { by: u.id });
    await put(g3, 'in', '2026-10-30T10:00:00.000Z');
    for (let i = 0; i < 9; i++) await put(dm, 'in', `2026-11-10T12:0${i}:00.000Z`);
    const d = await tab<GroupsData>(u.id, await owner(u.id), 'groups', { tz: 'UTC' });
    expect(d.kpis).toMatchObject({ groups: { value: 3 }, active: { value: 2, prev: 1 }, quiet: { value: 1 }, messages: { value: 4, prev: 1 }, members: { value: 42 } });
    expect(d.top.map((g) => [g.name, g.inbound, g.outbound, g.members])).toEqual([
      ['Vecinos Sur', 2, 1, 30],
      ['Vecinos Norte', 1, 0, 12],
    ]);
    expect(d.top[0].lastAt).toBe('2026-11-10T10:02:00.000Z');
  });

  it('tickets vencidos y tareas: creadas, abiertas, hechas y atrasadas', async () => {
    const u = await makeUser('an-tasks');
    const n = await line(u.id, 'Soporte');
    const c = await chat(n, 'Olga');
    const tk = (await createTicket(u.id, u.id, { chatId: c.id, title: 'Sin luz', priority: 'urgent' })).ticket;
    await getDb().prepare('UPDATE groups_tickets SET created_at = ?, breached_at = ? WHERE id = ?').run('2026-11-09T08:00:00.000Z', '2026-11-09T12:00:00.000Z', tk.id);
    const t1 = await createGroupTask(u.id, u.id, { chatId: c.id, title: 'Llamar a Olga' });
    const t2 = await createGroupTask(u.id, u.id, { chatId: c.id, title: 'Mandar presupuesto' });
    await getDb().prepare('UPDATE groups_tasks SET created_at = ? WHERE id IN (?, ?)').run('2026-11-10T08:00:00.000Z', t1.id, t2.id);
    await getDb().prepare("UPDATE crm_activities SET due_at = '2026-11-10 09:00:00' WHERE id = ?").run(t1.activityId);
    await getDb().prepare('UPDATE crm_activities SET done = 1 WHERE id = ?').run(t2.activityId);
    const d = await tab<TicketsData>(u.id, await owner(u.id), 'tickets', { tz: 'UTC' });
    expect(d.kpis).toMatchObject({ created: { value: 1 }, open: { value: 1 }, breached: { value: 1, prev: 0 }, resolutionMin: { value: null, prev: null }, tasksCreated: { value: 2, prev: 0 }, tasksOpen: { value: 1 }, tasksOverdue: { value: 1 } });
    expect(d.tasksDone).toBe(1);
    expect(d.byPriority).toEqual([{ key: 'urgent', value: 1 }]);
    const r = await tab<ResponseData>(u.id, await owner(u.id), 'response', { tz: 'UTC' });
    expect(r.kpis.breached.value).toBe(1);
  });

  it('respuesta: chats esperando ahora, por antigüedad y los más viejos primero', async () => {
    const u = await makeUser('an-wait');
    const n = await line(u.id, 'Soporte');
    const ages = [10 * 60, 2 * 3600, 10 * 3600, 30 * 3600, 100 * 3600];
    for (const [i, sec] of ages.entries()) {
      const c = await chat(n, `Espera ${i}`);
      await getDb().prepare('UPDATE groups_chats SET awaiting_since = ? WHERE id = ?').run(new Date(NOW.getTime() - sec * 1000).toISOString(), c.id);
    }
    const closed = await chat(n, 'Cerrado');
    await getDb().prepare("UPDATE groups_chats SET awaiting_since = ?, status = 'closed' WHERE id = ?").run(NOW.toISOString(), closed.id);
    const d = await tab<ResponseData>(u.id, await owner(u.id), 'response', { tz: 'UTC' });
    expect(d.kpis.awaiting.value).toBe(5);
    expect(d.waitingAges).toEqual([1, 1, 1, 1, 1]);
    expect(d.waiting.map((w) => w.name)).toEqual(['Espera 4', 'Espera 3', 'Espera 2', 'Espera 1', 'Espera 0']);
  });

  it('envíos masivos: totales, embudo de recibos y respuestas', async () => {
    const u = await makeUser('an-bc');
    const n = await line(u.id, 'Ventas');
    const chats = [await chat(n, 'Dest 1'), await chat(n, 'Dest 2'), await chat(n, 'Dest 3'), await chat(n, 'Dest 4')];
    const db = getDb();
    const bid = randomUUID();
    await db
      .prepare(
        `INSERT INTO groups_broadcasts (id, user_id, number_id, name, body, kind, status, scheduled_at, total, sent, failed, created_by, created_at, finished_at)
         VALUES (?, ?, ?, 'Promo de noviembre', 'hola', 'broadcast', 'done', ?, 4, 3, 1, ?, ?, ?)`,
      )
      .run(bid, u.id, n.id, '2026-11-09T10:00:00.000Z', u.id, '2026-11-09T09:00:00.000Z', '2026-11-09T10:05:00.000Z');
    const statuses = ['read', 'delivered', 'sent'];
    for (const [i, c] of chats.entries()) {
      const sent = i < 3;
      const mid = sent ? await put(c, 'out', '2026-11-09T10:00:00.000Z', { kind: 'broadcast', status: statuses[i] }) : null;
      await db
        .prepare('INSERT INTO groups_broadcast_recipients (id, broadcast_id, chat_id, status, message_id, sent_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), bid, c.id, sent ? 'sent' : 'failed', mid, sent ? '2026-11-09T10:00:00.000Z' : null);
    }
    // El primero respondió a la hora; el segundo había escrito antes del envío (no cuenta); el cuarto escribió pero no recibió nada.
    await put(chats[0], 'in', '2026-11-09T11:00:00.000Z');
    await put(chats[1], 'in', '2026-11-09T09:00:00.000Z');
    await put(chats[3], 'in', '2026-11-09T11:00:00.000Z');
    // Un mensaje programado y un envío cancelado no son envíos masivos.
    for (const [kind, status] of [
      ['scheduled', 'done'],
      ['broadcast', 'cancelled'],
    ]) {
      await db
        .prepare(`INSERT INTO groups_broadcasts (id, user_id, number_id, name, kind, status, scheduled_at, total, created_at) VALUES (?, ?, ?, 'otro', ?, ?, ?, 9, ?)`)
        .run(randomUUID(), u.id, n.id, kind, status, '2026-11-09T10:00:00.000Z', '2026-11-09T09:00:00.000Z');
    }
    const d = await tab<BroadcastsData>(u.id, await owner(u.id), 'broadcasts', { tz: 'UTC' });
    expect(d.kpis).toMatchObject({ broadcasts: { value: 1, prev: 0 }, recipients: { value: 4 }, sent: { value: 3 }, failed: { value: 1 } });
    expect(d.rows).toMatchObject([{ name: 'Promo de noviembre', total: 4, sent: 3, failed: 1, delivered: 2, read: 1, replied: 1 }]);
    expect(d.funnel).toEqual({ broadcasts: 1, sent: 3, delivered: 2, read: 1, replied: 1 });
    expect(share(d.funnel.read, 0)).toBe(0);
    // Los envíos masivos no cuentan como mensajes de una persona ni como respuesta.
    const tm = await tab<TeamData>(u.id, await owner(u.id), 'team', { tz: 'UTC' });
    expect(tm.agents).toEqual([]);
  });
});

describe('costo de base', () => {
  it('las consultas de mensajes buscan por índice y rango de fechas, sin recorrer la tabla', async () => {
    const u = await makeUser('an-plan');
    const ana = await makeUser('an-plan-ana');
    const viewers = [await owner(u.id), await groupsViewer(u.id, ana.id, 'member'), { ...(await groupsViewer(u.id, ana.id, 'member')), restricted: true }];
    for (const viewer of viewers) {
      for (const f of [{}, { numberId: 'n' }, { labelId: 'l', agentId: 'a' }]) {
        const ctx = analyticsContext(u.id, viewer, { days: 30, tz: 'America/New_York', ...f }, NOW);
        const { sql, args } = messageFactsSql(ctx, ['d', 'c', 'hm', 'n', 'a', 'ev', 'pc', 'rd', 'ru', 'lb']);
        const plan = (await getDb().prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args)) as Array<{ detail: string }>;
        const text = plan.map((p) => p.detail).join('\n');
        expect(text).toMatch(/SEARCH m USING INDEX idx_groups_messages_(user|chat)/);
        expect(text).not.toMatch(/SCAN m\b/);
        // (El único recorrido es el de groups_team_members que ya hace numberAccessSql: los equipos de Lines de la persona, una tabla chica.)
        expect(text).not.toMatch(/SCAN (zc|cl|fl|zn|zna|zl|za)\b/);
        // Una sola pasada por la tabla de mensajes.
        expect(text.match(/\bm USING/g)).toHaveLength(1);
      }
    }
  });

  it('caché corta: la misma persona, pestaña y filtros no vuelve a consultar; otra persona sí', async () => {
    const u = await makeUser('an-cache');
    const n = await line(u.id, 'Ventas');
    const c = await chat(n, 'Eva');
    const today = new Date().toISOString();
    await put(c, 'in', today);
    const v = await owner(u.id);
    const first = (await cachedLinesAnalytics(u.id, v, 'overview', { days: 7, tz: 'UTC' })) as OverviewData;
    expect(first.kpis.inbound.value).toBe(1);
    await put(c, 'in', today);
    expect(((await cachedLinesAnalytics(u.id, v, 'overview', { days: 7, tz: 'UTC' })) as OverviewData).kpis.inbound.value).toBe(1);
    // Otro filtro u otra persona: clave distinta.
    expect(((await cachedLinesAnalytics(u.id, v, 'overview', { days: 30, tz: 'UTC' })) as OverviewData).kpis.inbound.value).toBe(2);
    expect(((await cachedLinesAnalytics(u.id, { ...v, me: 'otra-persona' }, 'overview', { days: 7, tz: 'UTC' })) as OverviewData).kpis.inbound.value).toBe(2);
    clearAnalyticsCache();
    expect(((await cachedLinesAnalytics(u.id, v, 'overview', { days: 7, tz: 'UTC' })) as OverviewData).kpis.inbound.value).toBe(2);
  });
});
