/**
 * Lines, reportes: los datos de cada pestaña del tablero. Todo se agrega en
 * SQL sobre rangos con fecha y con índice (idx_groups_messages_user,
 * idx_groups_chats_user, idx_groups_tickets_user): no se traen mensajes al
 * servidor ni se consulta por chat. Cada pestaña hace una pasada por los
 * mensajes del período y del anterior (una CTE materializada de la que salen
 * todas las series), una por los chats del workspace y, si hace falta, una
 * por los tickets.
 *
 * Quién ve qué: las mismas condiciones que la lista de chats
 * (chatAccessSql): visibilidad por línea y acceso por etiqueta.
 *
 * Server-only. Lo puro (rango, zona horaria, percentiles, CSV) está en
 * groups-analytics-shared.ts.
 */
import { getDb } from './db';
import { listPeople } from './groups';
import { chatAccessSql, maskedChatName, numberAccessSql, type GroupsViewer } from './groups-access';
import {
  analyticsRange,
  dayList,
  median,
  responseBuckets,
  tzOffsetSql,
  tzSegments,
  weightedQuantile,
  type AgentStat,
  type AnalyticsData,
  type AnalyticsRange,
  type AnalyticsTab,
  type BroadcastsData,
  type BroadcastStat,
  type ChatStat,
  type ConversationsData,
  type DayPoint,
  type GroupsData,
  type Kpi,
  type LabelsData,
  type LineStat,
  type OverviewData,
  type RangeInfo,
  type RangeInput,
  type ResponseData,
  type SenderKind,
  type TeamData,
  type TicketsData,
  type TzSegment,
} from './groups-analytics-shared';

export { median };

export interface AnalyticsFilters {
  numberId?: string;
  /** Chats asignados a esta persona. */
  agentId?: string;
  labelId?: string;
}

export interface AnalyticsQuery extends RangeInput, AnalyticsFilters {}

type Arg = string | number;

interface Ctx {
  ws: string;
  viewer: GroupsViewer;
  f: AnalyticsFilters;
  range: AnalyticsRange;
  segments: TzSegment[];
  now: Date;
}

/** Recibos de envíos masivos: se leen los de los últimos envíos hasta esta cantidad de destinatarios. */
export const BROADCAST_DETAIL_BUDGET = 5000;
const ROW_CAP = 80_000;

// ======================================================================
// Primera respuesta en memoria (referencia de los tests del SQL)
// ======================================================================

interface Msg {
  chat_id: string;
  direction: 'in' | 'out';
  author_id: string | null;
  author_kind: string;
  created_at: string;
}

/**
 * Primera respuesta: por cada tanda de mensajes del cliente, minutos hasta el
 * primer mensaje nuestro después de la tanda. El tablero la calcula en SQL
 * (ver `messageFacts`); esta versión en memoria es la referencia de los tests.
 */
export function firstResponses(messages: Msg[]): Array<{ chatId: string; minutes: number; by: string | null }> {
  const out: Array<{ chatId: string; minutes: number; by: string | null }> = [];
  const waiting = new Map<string, number>();
  for (const m of messages) {
    const t = Date.parse(m.created_at);
    if (m.direction === 'in') {
      if (!waiting.has(m.chat_id)) waiting.set(m.chat_id, t);
    } else if (waiting.has(m.chat_id)) {
      if (m.author_kind === 'broadcast') continue;
      out.push({ chatId: m.chat_id, minutes: Math.max(0, Math.round((t - (waiting.get(m.chat_id) as number)) / 60_000)), by: m.author_id });
      waiting.delete(m.chat_id);
    }
  }
  return out;
}

// ======================================================================
// Alcance
// ======================================================================

/** Condiciones sobre un alias de groups_chats: lo que ve la persona y los filtros que son del chat. */
function chatConds(ctx: Ctx, alias: string, opts: { number: boolean; kind?: 'dm' | 'group' }): { sql: string[]; args: Arg[] } {
  const sql: string[] = [];
  const args: Arg[] = [];
  const access = chatAccessSql(ctx.viewer, alias);
  if (access) {
    sql.push(access.sql);
    args.push(...access.args);
  }
  if (opts.number && ctx.f.numberId) {
    sql.push(`${alias}.number_id = ?`);
    args.push(ctx.f.numberId);
  }
  if (ctx.f.agentId) {
    sql.push(`${alias}.assigned_to = ?`);
    args.push(ctx.f.agentId);
  }
  if (ctx.f.labelId) {
    sql.push(`EXISTS (SELECT 1 FROM groups_chat_labels fl WHERE fl.chat_id = ${alias}.id AND fl.label_id = ?)`);
    args.push(ctx.f.labelId);
  }
  if (opts.kind) {
    sql.push(`${alias}.kind = ?`);
    args.push(opts.kind);
  }
  return { sql, args };
}

/** `<col> IN (chats del alcance)`, o null si no hay nada que acotar. */
function chatScopeIn(ctx: Ctx, col: string, opts: { number: boolean; kind?: 'dm' | 'group' }): { sql: string; args: Arg[] } | null {
  const c = chatConds(ctx, 'zc', opts);
  if (c.sql.length === 0) return null;
  return { sql: `${col} IN (SELECT zc.id FROM groups_chats zc WHERE zc.user_id = ? AND ${c.sql.join(' AND ')})`, args: [ctx.ws, ...c.args] };
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const idxDay = (idx: unknown): string => new Date(num(idx) * 86_400_000).toISOString().slice(0, 10);

// ======================================================================
// Mensajes: una pasada, varias series
// ======================================================================

interface FactRow {
  k: string;
  a: string | number | null;
  b: string | number | null;
  c: string | number | null;
  d: string | number | null;
  n1: number | null;
  n2: number | null;
  n3: number | null;
}

type MessageSection = 'd' | 'c' | 'hm' | 'n' | 'a' | 'ev' | 'pc' | 'r' | 'rd' | 'ru' | 'lb';

const SECTION_SQL: Record<Exclude<MessageSection, 'pc'>, string> = {
  // Mensajes por día y dirección (los dos períodos).
  d: `SELECT 'd' AS k, day AS a, direction AS b, NULL AS c, NULL AS d, COUNT(*) AS n1, 0 AS n2, 0 AS n3 FROM b WHERE direction IN ('in', 'out') GROUP BY day, direction`,
  // Chats con actividad, por período.
  c: `SELECT 'c', cur, NULL, NULL, NULL, COUNT(DISTINCT chat_id), 0, 0 FROM b WHERE direction IN ('in', 'out') GROUP BY cur`,
  // Recibidos por día de la semana (0 = lunes) y hora local. El día 0 (1970-01-01) fue jueves.
  hm: `SELECT 'hm', (day + 3) % 7 AS wd, hour, NULL, NULL, COUNT(*), 0, 0 FROM b WHERE cur = 1 AND direction = 'in' GROUP BY wd, hour`,
  // Por línea y período.
  n: `SELECT 'n', number_id, cur, NULL, NULL, SUM(direction = 'in'), SUM(direction = 'out'), COUNT(DISTINCT chat_id) FROM b WHERE direction IN ('in', 'out') GROUP BY number_id, cur`,
  // Enviados por autor y período.
  a: `SELECT 'a', author_kind, author_id, cur, NULL, COUNT(*), COUNT(DISTINCT chat_id), 0 FROM b WHERE direction = 'out' GROUP BY author_kind, author_id, cur`,
  // Asignaciones (a quién) y cierres (quién) del historial del chat.
  ev: `SELECT 'ev', ev, CASE WHEN ev = 'closed' THEN author_id ELSE ev_to END AS who, cur, NULL, COUNT(*), 0, 0 FROM b
       WHERE direction = 'system' AND ev IN ('assigned', 'auto_assigned', 'closed') GROUP BY ev, who, cur`,
  // Primera respuesta: minutos y cantidad, por período.
  r: `SELECT 'r', cur, NULL, NULL, NULL, (rts - ts + 30) / 60 AS mins, COUNT(*), 0 FROM p WHERE direction = 'in' AND rts IS NOT NULL GROUP BY cur, mins`,
  // Primera respuesta con el día de la consulta y quién respondió.
  rd: `SELECT 'r', cur, day, rkind, rby, (rts - ts + 30) / 60 AS mins, COUNT(*), 0 FROM p WHERE direction = 'in' AND rts IS NOT NULL GROUP BY cur, day, rkind, rby, mins`,
  // Tandas del cliente que nadie respondió antes del fin del rango.
  ru: `SELECT 'ru', cur, NULL, NULL, NULL, COUNT(*), 0, 0 FROM p WHERE direction = 'in' AND rts IS NULL GROUP BY cur`,
  // Mensajes del período por etiqueta (por chat primero: una búsqueda de etiquetas por chat activo, no por mensaje).
  lb: `SELECT 'lb', cl.label_id, NULL, NULL, NULL, SUM(pc.i), SUM(pc.o), COUNT(*) FROM
       (SELECT chat_id, SUM(direction = 'in') AS i, SUM(direction = 'out') AS o FROM b WHERE cur = 1 AND direction IN ('in', 'out') GROUP BY chat_id) pc
       JOIN groups_chat_labels cl ON cl.chat_id = pc.chat_id GROUP BY cl.label_id`,
};

/** El SQL de una pestaña sobre los mensajes y sus argumentos (exportado para revisar el plan en los tests). */
export function messageFactsSql(ctx: Ctx, sections: MessageSection[], opts: { kind?: 'dm' | 'group'; pcLimit?: number } = {}): { sql: string; args: Arg[] } {
  const events = sections.includes('ev');
  const pairs = sections.some((s) => s === 'r' || s === 'rd' || s === 'ru');
  const where = ['m.user_id = ?', 'm.created_at >= ?', 'm.created_at < ?'];
  const args: Arg[] = [ctx.range.since, ctx.ws, ctx.range.prevSince, ctx.range.until];
  if (ctx.f.numberId) {
    where.push('m.number_id = ?');
    args.push(ctx.f.numberId);
  }
  const scope = chatScopeIn(ctx, 'm.chat_id', { number: false, kind: opts.kind });
  if (scope) {
    where.push(scope.sql);
    args.push(...scope.args);
  }
  const off = tzOffsetSql(ctx.segments, 'x.ts');
  const parts = sections.map((s) =>
    s === 'pc'
      ? `SELECT * FROM (SELECT 'pc', chat_id, NULL, NULL, NULL, SUM(direction = 'in'), SUM(direction = 'out'), MAX(ts) FROM b
         WHERE cur = 1 AND direction IN ('in', 'out') GROUP BY chat_id ORDER BY COUNT(*) DESC, chat_id LIMIT ${Math.trunc(opts.pcLimit ?? 10)})`
      : SECTION_SQL[s],
  );
  const sql = `WITH b AS MATERIALIZED (
      SELECT x.*, (x.ts + ${off}) / 86400 AS day, ((x.ts + ${off}) % 86400) / 3600 AS hour FROM (
        SELECT m.id, m.chat_id, m.number_id, m.direction, m.author_id, m.author_kind, m.created_at AS at,
               CAST(strftime('%s', m.created_at) AS INTEGER) AS ts,
               CASE WHEN m.created_at >= ? THEN 1 ELSE 0 END AS cur${
                 events
                   ? `,
               CASE WHEN m.direction = 'system' AND m.author_kind = 'event' AND json_valid(m.meta) THEN json_extract(m.meta, '$.event') END AS ev,
               CASE WHEN m.direction = 'system' AND m.author_kind = 'event' AND json_valid(m.meta) THEN json_extract(m.meta, '$.to') END AS ev_to`
                   : ''
               }
        FROM groups_messages m
        WHERE ${where.join(' AND ')} AND m.direction IN (${events ? "'in', 'out', 'system'" : "'in', 'out'"})
      ) x
    )${
      pairs
        ? `,
    t AS (
      SELECT id, chat_id, direction, author_id, author_kind, at, ts, cur, day,
             LAG(direction) OVER (PARTITION BY chat_id ORDER BY at, direction, id) AS prev
      FROM b WHERE direction = 'in' OR (direction = 'out' AND author_kind != 'broadcast')
    ),
    p AS MATERIALIZED (
      SELECT direction, cur, day, ts, LEAD(ts) OVER w AS rts, LEAD(author_id) OVER w AS rby, LEAD(author_kind) OVER w AS rkind
      FROM t WHERE prev IS NULL OR prev != direction
      WINDOW w AS (PARTITION BY chat_id ORDER BY at, direction, id)
    )`
        : ''
    }
    SELECT NULL AS k, NULL AS a, NULL AS b, NULL AS c, NULL AS d, NULL AS n1, NULL AS n2, NULL AS n3 WHERE 0
    UNION ALL
    ${parts.join('\n    UNION ALL\n    ')}
    LIMIT ${ROW_CAP}`;
  return { sql, args };
}

async function messageFacts(ctx: Ctx, sections: MessageSection[], opts: { kind?: 'dm' | 'group'; pcLimit?: number } = {}): Promise<FactRow[]> {
  const { sql, args } = messageFactsSql(ctx, sections, opts);
  return (await getDb().prepare(sql).all(...args)) as FactRow[];
}

/** Series por día del período y del anterior, alineadas por posición. */
function daySeries(ctx: Ctx, rows: FactRow[]): { perDay: DayPoint[]; prevPerDay: DayPoint[]; totals: { inbound: Kpi; outbound: Kpi } } {
  const byDay = new Map<string, { inbound: number; outbound: number }>();
  for (const r of rows) {
    if (r.k !== 'd') continue;
    const day = idxDay(r.a);
    const v = byDay.get(day) ?? { inbound: 0, outbound: 0 };
    if (r.b === 'in') v.inbound += num(r.n1);
    else v.outbound += num(r.n1);
    byDay.set(day, v);
  }
  const series = (from: string): DayPoint[] => dayList(from, ctx.range.days).map((day) => ({ day, ...(byDay.get(day) ?? { inbound: 0, outbound: 0 }) }));
  const perDay = series(ctx.range.from);
  const prevPerDay = series(ctx.range.prevFrom);
  const sum = (list: DayPoint[], key: 'inbound' | 'outbound') => list.reduce((a, p) => a + p[key], 0);
  return {
    perDay,
    prevPerDay,
    totals: {
      inbound: { value: sum(perDay, 'inbound'), prev: sum(prevPerDay, 'inbound') },
      outbound: { value: sum(perDay, 'outbound'), prev: sum(prevPerDay, 'outbound') },
    },
  };
}

function activeChats(rows: FactRow[]): Kpi {
  const pick = (cur: number) => num(rows.find((r) => r.k === 'c' && num(r.a) === cur)?.n1);
  return { value: pick(1), prev: pick(0) };
}

function responsePairs(rows: FactRow[], cur: number): Array<[number, number]> {
  return rows.filter((r) => r.k === 'r' && num(r.a) === cur).map((r) => [Math.max(0, num(r.n1)), num(r.n2)]);
}

const countPairs = (pairs: Array<[number, number]>) => pairs.reduce((a, [, n]) => a + n, 0);

// ======================================================================
// Líneas, personas y chats con nombre
// ======================================================================

export interface FilterOptions {
  numbers: Array<{ id: string; name: string }>;
  labels: Array<{ id: string; name: string; color: string }>;
  people: Array<{ id: string; name: string }>;
}

/** Opciones de los filtros: las líneas que la persona ve, las etiquetas y la gente del workspace. Tres consultas chicas. */
export async function analyticsFilterOptions(ws: string, viewer: GroupsViewer): Promise<FilterOptions> {
  const db = getDb();
  const access = numberAccessSql(viewer, 'n');
  const [numbers, labels, people] = await Promise.all([
    db
      .prepare(`SELECT n.id, n.name, n.phone FROM groups_numbers n WHERE n.user_id = ?${access ? ` AND ${access.sql}` : ''} ORDER BY n.created_at`)
      .all(ws, ...(access?.args ?? [])) as Promise<Array<{ id: string; name: string; phone: string }>>,
    db.prepare('SELECT id, name, color FROM groups_labels WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(ws) as Promise<Array<{ id: string; name: string; color: string }>>,
    listPeople(ws),
  ]);
  return {
    numbers: numbers.map((n) => ({ id: n.id, name: n.name || (n.phone ? `+${n.phone}` : n.id.slice(0, 8)) })),
    labels,
    people: people.map((p) => ({ id: p.id, name: p.name || p.email })),
  };
}

function lineStats(rows: FactRow[], numbers: FilterOptions['numbers']): LineStat[] {
  const names = new Map(numbers.map((n) => [n.id, n.name]));
  const out = new Map<string, LineStat>();
  for (const r of rows) {
    if (r.k !== 'n') continue;
    // Una línea que ya no existe (o no figura): se junta en una sola fila sin nombre.
    const known = typeof r.a === 'string' && names.has(r.a);
    const key = known ? (r.a as string) : '';
    const s = out.get(key) ?? { id: known ? key : null, name: known ? (names.get(key) as string) : null, inbound: 0, outbound: 0, activeChats: 0, prevTotal: 0 };
    if (num(r.b) === 1) {
      s.inbound += num(r.n1);
      s.outbound += num(r.n2);
      s.activeChats += num(r.n3);
    } else {
      s.prevTotal += num(r.n1) + num(r.n2);
    }
    out.set(key, s);
  }
  return [...out.values()].filter((s) => s.inbound + s.outbound > 0).sort((x, y) => y.inbound + y.outbound - (x.inbound + x.outbound));
}

/** Nombre, tipo y miembros de los chats más activos (una consulta por ids, no una por chat). */
async function chatStats(ctx: Ctx, rows: FactRow[]): Promise<ChatStat[]> {
  const top = rows.filter((r) => r.k === 'pc' && typeof r.a === 'string');
  if (top.length === 0) return [];
  const ids = top.map((r) => r.a as string);
  const chats = (await getDb()
    .prepare(`SELECT id, name, phone, provider_chat_id, kind, member_count FROM groups_chats WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
    .all(ctx.ws, ...ids)) as Array<{ id: string; name: string; phone: string; provider_chat_id: string; kind: 'dm' | 'group'; member_count: number }>;
  const byId = new Map(chats.map((c) => [c.id, c]));
  return top.flatMap((r) => {
    const c = byId.get(r.a as string);
    if (!c) return [];
    return [
      {
        id: c.id,
        name: maskedChatName(ctx.viewer, c),
        kind: c.kind,
        inbound: num(r.n1),
        outbound: num(r.n2),
        members: num(c.member_count),
        lastAt: r.n3 ? new Date(num(r.n3) * 1000).toISOString() : null,
      },
    ];
  });
}

// ======================================================================
// Chats: una pasada por los del workspace
// ======================================================================

interface ChatFactRow {
  k: string;
  a: string | number | null;
  b: string | null;
  c: string | null;
  d: string | null;
  e: string | null;
  f: string | null;
  n1: number | null;
  n2: number | null;
  n3: number | null;
  n4: number | null;
  n5: number | null;
  n6: number | null;
  n7: number | null;
  n8: number | null;
  n9: number | null;
}

type ChatSection = 'nd' | 'aw' | 'awl' | 'ag';

async function chatFacts(ctx: Ctx, sections: ChatSection[], opts: { kind?: 'dm' | 'group' } = {}): Promise<ChatFactRow[]> {
  const conds = chatConds(ctx, 'zc', { number: true, kind: opts.kind });
  const { since, until, prevSince } = ctx.range;
  const nowSec = Math.floor(ctx.now.getTime() / 1000);
  const waiting = `awaiting_since IS NOT NULL AND status = 'open' AND archived_at IS NULL`;
  const nulls = 'NULL, NULL, NULL, NULL, NULL';
  const zeros = (n: number) => new Array(n).fill('0').join(', ');
  const off = tzOffsetSql(ctx.segments, 'ts');
  const parts: string[] = [
    `SELECT 't' AS k, NULL AS a, NULL AS b, NULL AS c, NULL AS d, NULL AS e, NULL AS f,
       COUNT(*) AS n1, SUM(kind = 'group') AS n2, SUM(${waiting}) AS n3,
       SUM(status = 'open' AND archived_at IS NULL AND assigned_to IS NULL) AS n4,
       SUM(CASE WHEN kind = 'group' THEN member_count ELSE 0 END) AS n5,
       SUM(created_at >= ? AND created_at < ?) AS n6, SUM(created_at >= ? AND created_at < ?) AS n7,
       SUM(kind = 'group' AND created_at >= ? AND created_at < ?) AS n8, SUM(kind = 'group' AND created_at >= ? AND created_at < ?) AS n9
     FROM c`,
  ];
  const args: Arg[] = [ctx.ws, ...conds.args, since, until, prevSince, since, since, until, prevSince, since];
  if (sections.includes('nd')) {
    parts.push(`SELECT 'nd', (ts + ${off}) / 86400 AS day, ${nulls}, COUNT(*), ${zeros(8)} FROM c WHERE created_at >= ? AND created_at < ? GROUP BY day`);
    args.push(since, until);
  }
  if (sections.includes('aw')) {
    const age = `(${nowSec} - CAST(strftime('%s', awaiting_since) AS INTEGER))`;
    parts.push(
      `SELECT 'aw', NULL, ${nulls}, SUM(${age} < 3600), SUM(${age} >= 3600 AND ${age} < 14400), SUM(${age} >= 14400 AND ${age} < 86400),
         SUM(${age} >= 86400 AND ${age} < 259200), SUM(${age} >= 259200), ${zeros(4)} FROM c WHERE ${waiting}`,
    );
  }
  if (sections.includes('awl')) {
    parts.push(`SELECT * FROM (SELECT 'awl', id, name, phone, provider_chat_id, kind, awaiting_since, ${zeros(9)} FROM c WHERE ${waiting} ORDER BY awaiting_since ASC LIMIT 8)`);
  }
  if (sections.includes('ag')) {
    parts.push(
      `SELECT 'ag', assigned_to, ${nulls}, SUM(status = 'open' AND archived_at IS NULL), SUM(${waiting}), ${zeros(7)} FROM c WHERE assigned_to IS NOT NULL GROUP BY assigned_to`,
    );
  }
  const sql = `WITH c AS MATERIALIZED (
      SELECT zc.id, zc.kind, zc.name, zc.phone, zc.provider_chat_id, zc.assigned_to, zc.status, zc.member_count,
             zc.awaiting_since, zc.archived_at, zc.created_at, CAST(strftime('%s', zc.created_at) AS INTEGER) AS ts
      FROM groups_chats zc WHERE zc.user_id = ? AND zc.hidden_at IS NULL${conds.sql.length ? ` AND ${conds.sql.join(' AND ')}` : ''}
    )
    ${parts.join('\n    UNION ALL\n    ')}`;
  return (await getDb().prepare(sql).all(...args)) as ChatFactRow[];
}

// ======================================================================
// Tickets y tareas
// ======================================================================

interface TicketFactRow {
  k: string;
  a: string | number | null;
  n1: number | null;
  n2: number | null;
  n3: number | null;
  n4: number | null;
  n5: number | null;
  n6: number | null;
  n7: number | null;
}

type TicketSection = 'rm' | 'dc' | 'dr' | 'pr' | 'so' | 'st' | 'as';

async function ticketFacts(ctx: Ctx, sections: TicketSection[]): Promise<TicketFactRow[]> {
  const { since, until, prevSince } = ctx.range;
  const scope = chatScopeIn(ctx, 't.chat_id', { number: true });
  const off = (col: string) => tzOffsetSql(ctx.segments, col);
  const created = 'created_at >= ? AND created_at < ?';
  const resolved = 'resolved_at >= ? AND resolved_at < ?';
  const zeros = (n: number) => new Array(n).fill('0').join(', ');
  const parts: string[] = [
    `SELECT 't' AS k, NULL AS a, SUM(${created}) AS n1, SUM(${created}) AS n2, SUM(status IN ('open', 'in_progress')) AS n3,
       SUM(resolved_at IS NOT NULL AND ${resolved}) AS n4, SUM(resolved_at IS NOT NULL AND ${resolved}) AS n5,
       SUM(breached_at IS NOT NULL AND ${created}) AS n6, SUM(breached_at IS NOT NULL AND ${created}) AS n7
     FROM tk`,
  ];
  const cur: Arg[] = [since, until];
  const prev: Arg[] = [prevSince, since];
  const args: Arg[] = [ctx.ws, until, prevSince, prevSince, ...(scope?.args ?? []), ...cur, ...prev, ...cur, ...prev, ...cur, ...prev];
  if (sections.includes('rm')) {
    parts.push(
      `SELECT 'rm', CASE WHEN resolved_at >= ? THEN 1 ELSE 0 END AS cur, (rts - ts + 30) / 60 AS mins, COUNT(*), ${zeros(5)} FROM tk
       WHERE resolved_at IS NOT NULL AND resolved_at >= ? AND resolved_at < ? GROUP BY cur, mins`,
    );
    args.push(since, prevSince, until);
  }
  if (sections.includes('dc')) {
    parts.push(`SELECT 'dc', (ts + ${off('ts')}) / 86400 AS day, COUNT(*), ${zeros(6)} FROM tk WHERE ${created} GROUP BY day`);
    args.push(...cur);
  }
  if (sections.includes('dr')) {
    parts.push(`SELECT 'dr', (rts + ${off('rts')}) / 86400 AS day, COUNT(*), ${zeros(6)} FROM tk WHERE resolved_at IS NOT NULL AND ${resolved} GROUP BY day`);
    args.push(...cur);
  }
  for (const [k, col] of [
    ['pr', 'priority'],
    ['so', 'source'],
    ['st', 'status'],
  ] as const) {
    if (!sections.includes(k)) continue;
    parts.push(`SELECT '${k}', ${col}, COUNT(*), ${zeros(6)} FROM tk WHERE ${created} GROUP BY ${col}`);
    args.push(...cur);
  }
  if (sections.includes('as')) {
    parts.push(
      `SELECT 'as', assignee_id, SUM(resolved_at IS NOT NULL AND ${resolved}), SUM(status IN ('open', 'in_progress')), ${zeros(5)} FROM tk
       WHERE assignee_id IS NOT NULL GROUP BY assignee_id`,
    );
    args.push(...cur);
  }
  const sql = `WITH tk AS MATERIALIZED (
      SELECT t.status, t.priority, t.source, t.assignee_id, t.created_at, t.resolved_at, t.breached_at,
             CAST(strftime('%s', t.created_at) AS INTEGER) AS ts,
             CASE WHEN t.resolved_at IS NOT NULL THEN CAST(strftime('%s', t.resolved_at) AS INTEGER) END AS rts
      FROM groups_tickets t
      WHERE t.user_id = ? AND t.created_at < ? AND (t.created_at >= ? OR t.resolved_at >= ? OR t.status IN ('open', 'in_progress'))${scope ? ` AND ${scope.sql}` : ''}
    )
    ${parts.join('\n    UNION ALL\n    ')}`;
  return (await getDb().prepare(sql).all(...args)) as TicketFactRow[];
}

function ticketTotals(rows: TicketFactRow[]) {
  const t = rows.find((r) => r.k === 't');
  const mins = (cur: number): Array<[number, number]> => rows.filter((r) => r.k === 'rm' && num(r.a) === cur).map((r) => [Math.max(0, num(r.n1)), num(r.n2)]);
  return {
    created: { value: num(t?.n1), prev: num(t?.n2) } as Kpi,
    open: { value: num(t?.n3) } as Kpi,
    resolved: { value: num(t?.n4), prev: num(t?.n5) } as Kpi,
    breached: { value: num(t?.n6), prev: num(t?.n7) } as Kpi,
    resolutionMin: { value: weightedQuantile(mins(1), 0.5), prev: weightedQuantile(mins(0), 0.5) } as Kpi,
  };
}

async function taskFacts(ctx: Ctx): Promise<{ created: Kpi; open: Kpi; overdue: Kpi; done: number }> {
  const { since, until, prevSince } = ctx.range;
  const scope = chatScopeIn(ctx, 't.chat_id', { number: true });
  // due_at viene en el formato del CRM ("YYYY-MM-DD HH:MM:SS") o en ISO viejo: se comparan los primeros 19 caracteres.
  const nowCrm = ctx.now.toISOString().slice(0, 19).replace('T', ' ');
  const row = (await getDb()
    .prepare(
      `SELECT SUM(t.created_at >= ? AND t.created_at < ?) AS created, SUM(t.created_at >= ? AND t.created_at < ?) AS prev,
              SUM(a.done = 0) AS open, SUM(a.done = 1 AND t.created_at >= ? AND t.created_at < ?) AS done,
              SUM(a.done = 0 AND a.due_at IS NOT NULL AND substr(replace(a.due_at, 'T', ' '), 1, 19) < ?) AS overdue
       FROM groups_tasks t JOIN crm_activities a ON a.id = t.activity_id
       WHERE t.user_id = ? AND (t.created_at >= ? OR a.done = 0)${scope ? ` AND ${scope.sql}` : ''}`,
    )
    .get(since, until, prevSince, since, since, until, nowCrm, ctx.ws, prevSince, ...(scope?.args ?? []))) as
    | { created: number | null; prev: number | null; open: number | null; done: number | null; overdue: number | null }
    | undefined;
  return { created: { value: num(row?.created), prev: num(row?.prev) }, open: { value: num(row?.open) }, overdue: { value: num(row?.overdue) }, done: num(row?.done) };
}

// ======================================================================
// Pestañas
// ======================================================================

const rangeInfo = (r: AnalyticsRange): RangeInfo => ({ from: r.from, to: r.to, days: r.days, tz: r.tz, prevFrom: r.prevFrom, prevTo: r.prevTo, custom: r.custom, clipped: r.clipped });

async function overview(ctx: Ctx, options: FilterOptions): Promise<OverviewData> {
  const [rows, chats, tickets] = await Promise.all([messageFacts(ctx, ['d', 'c', 'n', 'r', 'pc'], { pcLimit: 8 }), chatFacts(ctx, []), ticketFacts(ctx, [])]);
  const series = daySeries(ctx, rows);
  const t = chats.find((r) => r.k === 't');
  const tk = ticketTotals(tickets);
  const cur = responsePairs(rows, 1);
  return {
    tab: 'overview',
    range: rangeInfo(ctx.range),
    kpis: {
      ...series.totals,
      activeChats: activeChats(rows),
      newChats: { value: num(t?.n6), prev: num(t?.n7) },
      firstResponseMin: { value: weightedQuantile(cur, 0.5), prev: weightedQuantile(responsePairs(rows, 0), 0.5) },
      ticketsCreated: tk.created,
      awaiting: { value: num(t?.n3) },
      openTickets: tk.open,
    },
    responses: countPairs(cur),
    perDay: series.perDay,
    prevPerDay: series.prevPerDay,
    lines: lineStats(rows, options.numbers),
    topChats: await chatStats(ctx, rows),
  };
}

async function conversations(ctx: Ctx, options: FilterOptions): Promise<ConversationsData> {
  const [rows, chats] = await Promise.all([messageFacts(ctx, ['d', 'c', 'hm', 'n']), chatFacts(ctx, ['nd'])]);
  const series = daySeries(ctx, rows);
  const active = activeChats(rows);
  const t = chats.find((r) => r.k === 't');
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const r of rows) if (r.k === 'hm') heatmap[Math.min(6, Math.max(0, num(r.a)))][Math.min(23, Math.max(0, num(r.b)))] += num(r.n1);
  const newByDay = new Map(chats.filter((r) => r.k === 'nd').map((r) => [idxDay(r.a), num(r.n1)]));
  const perChat = (which: 'value' | 'prev'): number | null => {
    const chatsActive = active[which];
    return chatsActive ? Math.round((((series.totals.inbound[which] ?? 0) + (series.totals.outbound[which] ?? 0)) / chatsActive) * 10) / 10 : null;
  };
  return {
    tab: 'conversations',
    range: rangeInfo(ctx.range),
    kpis: {
      ...series.totals,
      activeChats: active,
      newChats: { value: num(t?.n6), prev: num(t?.n7) },
      newGroups: { value: num(t?.n8), prev: num(t?.n9) },
      perChat: { value: perChat('value'), prev: perChat('prev') },
    },
    perDay: series.perDay,
    prevPerDay: series.prevPerDay,
    newPerDay: dayList(ctx.range.from, ctx.range.days).map((day) => ({ day, value: newByDay.get(day) ?? 0 })),
    heatmap,
    lines: lineStats(rows, options.numbers),
  };
}

async function response(ctx: Ctx): Promise<ResponseData> {
  const [rows, chats, tickets] = await Promise.all([messageFacts(ctx, ['ru', 'rd']), chatFacts(ctx, ['aw', 'awl']), ticketFacts(ctx, ['rm'])]);
  const cur = responsePairs(rows, 1);
  const prev = responsePairs(rows, 0);
  const byDay = new Map<string, Array<[number, number]>>();
  for (const r of rows) {
    if (r.k !== 'r' || num(r.a) !== 1) continue;
    const day = idxDay(r.b);
    const list = byDay.get(day) ?? [];
    list.push([Math.max(0, num(r.n1)), num(r.n2)]);
    byDay.set(day, list);
  }
  const t = chats.find((r) => r.k === 't');
  const aw = chats.find((r) => r.k === 'aw');
  const tk = ticketTotals(tickets);
  const unanswered = (c: number) => num(rows.find((r) => r.k === 'ru' && num(r.a) === c)?.n1);
  return {
    tab: 'response',
    range: rangeInfo(ctx.range),
    kpis: {
      medianMin: { value: weightedQuantile(cur, 0.5), prev: weightedQuantile(prev, 0.5) },
      p90Min: { value: weightedQuantile(cur, 0.9), prev: weightedQuantile(prev, 0.9) },
      responses: { value: countPairs(cur), prev: countPairs(prev) },
      unanswered: { value: unanswered(1) },
      awaiting: { value: num(t?.n3) },
      resolutionMin: tk.resolutionMin,
      breached: tk.breached,
    },
    perDay: dayList(ctx.range.from, ctx.range.days).map((day) => {
      const list = byDay.get(day) ?? [];
      return { day, medianMin: weightedQuantile(list, 0.5), responses: countPairs(list) };
    }),
    buckets: responseBuckets(cur),
    waitingAges: [num(aw?.n1), num(aw?.n2), num(aw?.n3), num(aw?.n4), num(aw?.n5)],
    waiting: chats
      .filter((r) => r.k === 'awl' && typeof r.a === 'string' && r.f)
      .map((r) => ({
        id: r.a as string,
        name: maskedChatName(ctx.viewer, { name: r.b ?? '', phone: r.c ?? '', provider_chat_id: r.d ?? '' }),
        kind: r.e === 'group' ? 'group' : 'dm',
        since: r.f as string,
      })),
  };
}

/** De quién es un mensaje enviado: una persona, el teléfono, un agente de IA o una automatización. Los envíos masivos no cuentan. */
function sender(kind: unknown, id: unknown): { key: string; kind: SenderKind; id: string | null } | null {
  if (kind === 'broadcast') return null;
  if ((kind === 'person' || kind === 'scheduled') && typeof id === 'string' && id) return { key: `p:${id}`, kind: 'person', id };
  if (kind === 'phone') return { key: 'phone', kind: 'phone', id: null };
  if (kind === 'agent') return { key: 'ai', kind: 'ai', id: null };
  return { key: 'auto', kind: 'auto', id: null };
}

async function team(ctx: Ctx, options: FilterOptions): Promise<TeamData> {
  const [rows, chats, tickets] = await Promise.all([messageFacts(ctx, ['a', 'ev', 'rd']), chatFacts(ctx, ['ag']), ticketFacts(ctx, ['as'])]);
  const names = new Map(options.people.map((p) => [p.id, p.name]));
  const agents = new Map<string, AgentStat & { pairs: Array<[number, number]> }>();
  const get = (s: { key: string; kind: SenderKind; id: string | null }) => {
    let a = agents.get(s.key);
    if (!a) {
      a = { key: s.key, kind: s.kind, id: s.id, name: s.id ? (names.get(s.id) ?? null) : null, sent: 0, prevSent: 0, chats: 0, responses: 0, medianMin: null, assigned: 0, closed: 0, openChats: 0, ticketsResolved: 0, pairs: [] };
      agents.set(s.key, a);
    }
    return a;
  };
  const person = (id: unknown) => (typeof id === 'string' && id ? get({ key: `p:${id}`, kind: 'person', id }) : null);
  let assignments = 0;
  let prevAssignments = 0;
  for (const r of rows) {
    const cur = num(r.k === 'r' ? r.a : r.c) === 1;
    if (r.k === 'a') {
      const s = sender(r.a, r.b);
      if (!s) continue;
      const a = get(s);
      if (cur) {
        a.sent += num(r.n1);
        // Con dos tipos de autor de la misma persona (mensaje y programado) el chat puede contarse dos veces: es una cota.
        a.chats += num(r.n2);
      } else {
        a.prevSent += num(r.n1);
      }
    } else if (r.k === 'ev') {
      if (r.a === 'closed') {
        if (cur) {
          const a = person(r.b);
          if (a) a.closed += num(r.n1);
        }
      } else {
        if (cur) assignments += num(r.n1);
        else prevAssignments += num(r.n1);
        if (cur) {
          const a = person(r.b);
          if (a) a.assigned += num(r.n1);
        }
      }
    } else if (r.k === 'r' && cur) {
      const s = sender(r.c, r.d);
      if (s) get(s).pairs.push([Math.max(0, num(r.n1)), num(r.n2)]);
    }
  }
  for (const r of chats) {
    if (r.k !== 'ag' || !num(r.n1)) continue;
    const a = person(r.a);
    if (a) a.openChats = num(r.n1);
  }
  for (const r of tickets) {
    if (r.k !== 'as' || !num(r.n1)) continue;
    const a = person(r.a);
    if (a) a.ticketsResolved = num(r.n1);
  }
  const list: AgentStat[] = [...agents.values()]
    .map(({ pairs, ...a }) => ({ ...a, responses: countPairs(pairs), medianMin: weightedQuantile(pairs, 0.5) }))
    .filter((a) => a.sent || a.responses || a.assigned || a.closed || a.openChats || a.ticketsResolved)
    .sort((x, y) => y.sent - x.sent || y.responses - x.responses || (x.name ?? x.key).localeCompare(y.name ?? y.key));
  const people = list.filter((a) => a.kind === 'person');
  const active = people.filter((a) => a.sent > 0).length;
  const prevActive = [...agents.values()].filter((a) => a.kind === 'person' && a.prevSent > 0).length;
  const sent = people.reduce((a, p) => a + p.sent, 0);
  const prevSent = people.reduce((a, p) => a + p.prevSent, 0);
  const t = chats.find((r) => r.k === 't');
  return {
    tab: 'team',
    range: rangeInfo(ctx.range),
    kpis: {
      people: { value: active, prev: prevActive },
      sent: { value: sent, prev: prevSent },
      perPerson: { value: active ? Math.round(sent / active) : null, prev: prevActive ? Math.round(prevSent / prevActive) : null },
      assignments: { value: assignments, prev: prevAssignments },
      unassigned: { value: num(t?.n4) },
    },
    agents: list,
  };
}

async function groupsTab(ctx: Ctx): Promise<GroupsData> {
  const [rows, chats] = await Promise.all([messageFacts(ctx, ['d', 'c', 'pc'], { kind: 'group', pcLimit: 25 }), chatFacts(ctx, [], { kind: 'group' })]);
  const series = daySeries(ctx, rows);
  const active = activeChats(rows);
  const t = chats.find((r) => r.k === 't');
  const total = num(t?.n1);
  return {
    tab: 'groups',
    range: rangeInfo(ctx.range),
    kpis: {
      groups: { value: total },
      active,
      quiet: { value: Math.max(0, total - (active.value ?? 0)) },
      messages: { value: (series.totals.inbound.value ?? 0) + (series.totals.outbound.value ?? 0), prev: (series.totals.inbound.prev ?? 0) + (series.totals.outbound.prev ?? 0) },
      members: { value: num(t?.n5) },
    },
    perDay: series.perDay,
    prevPerDay: series.prevPerDay,
    top: await chatStats(ctx, rows),
  };
}

async function broadcasts(ctx: Ctx): Promise<BroadcastsData> {
  const db = getDb();
  const { since, until, prevSince } = ctx.range;
  const where = ['b.user_id = ?', "b.kind = 'broadcast'", "b.status != 'cancelled'", 'b.scheduled_at >= ?', 'b.scheduled_at < ?'];
  const args: Arg[] = [ctx.ws, prevSince, until];
  if (ctx.f.numberId) {
    where.push('b.number_id = ?');
    args.push(ctx.f.numberId);
  }
  // Como la lista de envíos: con acceso restringido, solo los que van a chats que la persona ve.
  const access = chatAccessSql(ctx.viewer, 'zc');
  if (access) {
    where.push(
      `NOT EXISTS (SELECT 1 FROM groups_broadcast_recipients zr JOIN groups_chats zc ON zc.id = zr.chat_id WHERE zr.broadcast_id = b.id AND NOT (${access.sql}))`,
    );
    args.push(...access.args);
  }
  const all = (await db
    .prepare(`SELECT b.id, b.name, b.status, b.scheduled_at, b.total, b.sent, b.failed FROM groups_broadcasts b WHERE ${where.join(' AND ')} ORDER BY b.scheduled_at DESC LIMIT 1000`)
    .all(...args)) as Array<{ id: string; name: string; status: string; scheduled_at: string; total: number; sent: number; failed: number }>;
  const cur = all.filter((b) => b.scheduled_at >= since);
  const prev = all.filter((b) => b.scheduled_at < since);
  const sum = (list: typeof all, key: 'total' | 'sent' | 'failed') => list.reduce((a, b) => a + num(b[key]), 0);

  // Recibos (entregado, leído, respondió): solo de los últimos envíos, hasta el tope de destinatarios.
  const detailIds: string[] = [];
  let budget = BROADCAST_DETAIL_BUDGET;
  for (const b of cur) {
    if (b.status === 'scheduled') continue;
    if (detailIds.length > 0 && num(b.total) > budget) break;
    detailIds.push(b.id);
    budget -= num(b.total);
    if (budget <= 0) break;
  }
  const detail = new Map<string, { delivered: number; read: number; replied: number }>();
  if (detailIds.length > 0) {
    const rows = (await db
      .prepare(
        `SELECT r.broadcast_id AS id,
                SUM(m.status IN ('delivered', 'read')) AS delivered, SUM(m.status = 'read') AS read,
                SUM(CASE WHEN r.sent_at IS NOT NULL AND r.status = 'sent' AND EXISTS (
                  SELECT 1 FROM groups_messages i WHERE i.chat_id = r.chat_id AND i.direction = 'in'
                    AND i.created_at > r.sent_at AND i.created_at <= strftime('%Y-%m-%dT%H:%M:%fZ', r.sent_at, '+3 days')
                ) THEN 1 ELSE 0 END) AS replied
         FROM groups_broadcast_recipients r LEFT JOIN groups_messages m ON m.id = r.message_id
         WHERE r.broadcast_id IN (${detailIds.map(() => '?').join(',')}) GROUP BY r.broadcast_id`,
      )
      .all(...detailIds)) as Array<{ id: string; delivered: number | null; read: number | null; replied: number | null }>;
    for (const r of rows) detail.set(r.id, { delivered: num(r.delivered), read: num(r.read), replied: num(r.replied) });
    for (const id of detailIds) if (!detail.has(id)) detail.set(id, { delivered: 0, read: 0, replied: 0 });
  }
  const rows: BroadcastStat[] = cur.slice(0, 50).map((b) => {
    const d = detail.get(b.id);
    return { id: b.id, name: b.name, at: b.scheduled_at, status: b.status, total: num(b.total), sent: num(b.sent), failed: num(b.failed), delivered: d?.delivered ?? null, read: d?.read ?? null, replied: d?.replied ?? null };
  });
  const detailed = cur.filter((b) => detail.has(b.id));
  const funnelSum = (key: 'delivered' | 'read' | 'replied') => detailed.reduce((a, b) => a + (detail.get(b.id)?.[key] ?? 0), 0);
  return {
    tab: 'broadcasts',
    range: rangeInfo(ctx.range),
    kpis: {
      broadcasts: { value: cur.length, prev: prev.length },
      recipients: { value: sum(cur, 'total'), prev: sum(prev, 'total') },
      sent: { value: sum(cur, 'sent'), prev: sum(prev, 'sent') },
      failed: { value: sum(cur, 'failed'), prev: sum(prev, 'failed') },
    },
    funnel: { broadcasts: detailed.length, sent: sum(detailed, 'sent'), delivered: funnelSum('delivered'), read: funnelSum('read'), replied: funnelSum('replied') },
    rows,
  };
}

async function ticketsTab(ctx: Ctx): Promise<TicketsData> {
  const [rows, tasks] = await Promise.all([ticketFacts(ctx, ['rm', 'dc', 'dr', 'pr', 'so', 'st']), taskFacts(ctx)]);
  const tk = ticketTotals(rows);
  const byDay = (k: string) => new Map(rows.filter((r) => r.k === k).map((r) => [idxDay(r.a), num(r.n1)]));
  const created = byDay('dc');
  const resolved = byDay('dr');
  const split = (k: string) =>
    rows
      .filter((r) => r.k === k && num(r.n1) > 0)
      .map((r) => ({ key: String(r.a ?? ''), value: num(r.n1) }))
      .sort((x, y) => y.value - x.value);
  return {
    tab: 'tickets',
    range: rangeInfo(ctx.range),
    kpis: { ...tk, tasksCreated: tasks.created, tasksOpen: tasks.open, tasksOverdue: tasks.overdue },
    perDay: dayList(ctx.range.from, ctx.range.days).map((day) => ({ day, created: created.get(day) ?? 0, resolved: resolved.get(day) ?? 0 })),
    byPriority: split('pr'),
    bySource: split('so'),
    byStatus: split('st'),
    tasksDone: tasks.done,
  };
}

async function labelsTab(ctx: Ctx, options: FilterOptions): Promise<LabelsData> {
  const conds = chatConds(ctx, 'zc', { number: true });
  const waiting = `zc.awaiting_since IS NOT NULL AND zc.status = 'open' AND zc.archived_at IS NULL`;
  const scoped = conds.sql.length ? ` AND ${conds.sql.join(' AND ')}` : '';
  const db = getDb();
  const [rows, perLabel, totals] = await Promise.all([
    messageFacts(ctx, ['lb']),
    db
      .prepare(
        `SELECT cl.label_id AS id, COUNT(*) AS chats, SUM(${waiting}) AS awaiting FROM groups_chats zc JOIN groups_chat_labels cl ON cl.chat_id = zc.id
         WHERE zc.user_id = ? AND zc.hidden_at IS NULL${scoped} GROUP BY cl.label_id`,
      )
      .all(ctx.ws, ...conds.args) as Promise<Array<{ id: string; chats: number; awaiting: number | null }>>,
    db
      .prepare(
        `SELECT COUNT(*) AS chats, SUM(EXISTS (SELECT 1 FROM groups_chat_labels cl WHERE cl.chat_id = zc.id)) AS labelled
         FROM groups_chats zc WHERE zc.user_id = ? AND zc.hidden_at IS NULL${scoped}`,
      )
      .get(ctx.ws, ...conds.args) as Promise<{ chats: number; labelled: number | null } | undefined>,
  ]);
  const chats = new Map(perLabel.map((r) => [r.id, r]));
  const msgs = new Map(rows.filter((r) => r.k === 'lb').map((r) => [String(r.a), r]));
  const list = options.labels
    .map((l) => {
      const c = chats.get(l.id);
      const m = msgs.get(l.id);
      return { id: l.id, name: l.name, color: l.color, chats: num(c?.chats), awaiting: num(c?.awaiting), activeChats: num(m?.n3), inbound: num(m?.n1), outbound: num(m?.n2) };
    })
    .filter((l) => l.chats > 0 || l.inbound + l.outbound > 0)
    .sort((x, y) => y.inbound + y.outbound - (x.inbound + x.outbound) || y.chats - x.chats || x.name.localeCompare(y.name));
  const labelled = num(totals?.labelled);
  return {
    tab: 'labels',
    range: rangeInfo(ctx.range),
    kpis: { labels: { value: list.length }, labelled: { value: labelled }, unlabelled: { value: Math.max(0, num(totals?.chats) - labelled) } },
    rows: list,
  };
}

// ======================================================================
// Entrada
// ======================================================================

export function analyticsContext(ws: string, viewer: GroupsViewer, query: AnalyticsQuery = {}, now = new Date()): Ctx {
  const range = analyticsRange(query, now);
  return {
    ws,
    viewer,
    f: { numberId: query.numberId || undefined, agentId: query.agentId || undefined, labelId: query.labelId || undefined },
    range,
    // Un día de margen a cada lado: los cortes de offset se calculan una vez por pedido.
    segments: tzSegments(range.tz, Date.parse(range.prevSince) - 86_400_000, Date.parse(range.until) + 86_400_000),
    now,
  };
}

/**
 * Los datos de una pestaña del tablero, con lo que `viewer` puede ver. Solo
 * se consulta lo de esa pestaña.
 */
export async function linesAnalytics(
  ws: string,
  viewer: GroupsViewer,
  tab: AnalyticsTab,
  query: AnalyticsQuery = {},
  opts: { now?: Date; options?: FilterOptions } = {},
): Promise<AnalyticsData> {
  const ctx = analyticsContext(ws, viewer, query, opts.now ?? new Date());
  const options = async () => opts.options ?? (await analyticsFilterOptions(ws, viewer));
  switch (tab) {
    case 'overview':
      return overview(ctx, await options());
    case 'conversations':
      return conversations(ctx, await options());
    case 'response':
      return response(ctx);
    case 'team':
      return team(ctx, await options());
    case 'groups':
      return groupsTab(ctx);
    case 'broadcasts':
      return broadcasts(ctx);
    case 'tickets':
      return ticketsTab(ctx);
    case 'labels':
      return labelsTab(ctx, await options());
  }
}

// ---------- Caché corta ----------

const CACHE_MS = 45_000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; data: Promise<AnalyticsData> }>();

/**
 * Igual que `linesAnalytics`, con una caché en memoria de 45 segundos por
 * persona, pestaña y filtros: recargar la página o bajar el CSV no vuelve a
 * leer la base. La clave lleva quién mira y qué puede ver.
 */
export function cachedLinesAnalytics(ws: string, viewer: GroupsViewer, tab: AnalyticsTab, query: AnalyticsQuery = {}, options?: FilterOptions): Promise<AnalyticsData> {
  const now = Date.now();
  const range = analyticsRange(query, new Date(now));
  const key = JSON.stringify([ws, viewer.me, viewer.role, viewer.restricted, viewer.linesScoped, viewer.mask, tab, range.since, range.until, range.tz, query.numberId ?? '', query.agentId ?? '', query.labelId ?? '']);
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.data;
  if (cache.size >= CACHE_MAX) {
    for (const [k, v] of cache) if (now - v.at >= CACHE_MS || cache.size >= CACHE_MAX) cache.delete(k);
  }
  const data = linesAnalytics(ws, viewer, tab, query, { now: new Date(now), options });
  cache.set(key, { at: now, data });
  data.catch(() => cache.delete(key));
  return data;
}

/** Para los tests. */
export function clearAnalyticsCache(): void {
  cache.clear();
}

