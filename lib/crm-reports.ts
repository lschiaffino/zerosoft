/**
 * CRM — reportes con rango de tiempo, bucket y filtros (owner, source, priority, pipeline).
 * Usado por /app/crm/reports.
 */
import { getDb } from './db';
import { baseAmountSql } from './crm-currency';

/** Montos de deals convertidos a la moneda base del workspace (tipos de cambio manuales). */
const AMT = baseAmountSql('d');
import type { FunnelStage } from './crm';

export type ReportBucket = 'day' | 'week' | 'month' | 'quarter';
export type ReportRangeLabel = '7d' | '30d' | '90d' | 'quarter' | '12m';

export interface ReportRange {
  label: ReportRangeLabel;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  prevFrom: string;
  prevTo: string;
}

export interface ReportFilters {
  pipelineId?: string;
  source?: string;
  priority?: string;
  ownerId?: string;
}

interface OwnerMetricInput {
  id: string;
  email: string;
  name: string | null;
}

export interface OwnerMetric extends OwnerMetricInput {
  contacts: number;
  deals: number;
  wonAmount: number;
  activities: number;
}

export interface TimeseriesPoint {
  bucket: string;
  contacts: number;
  deals: number;
  wonAmount: number;
}

export interface Kpis {
  newContacts: number;
  newContactsDelta: number;
  newDeals: number;
  newDealsDelta: number;
  wonAmount: number;
  wonAmountDelta: number;
  activities: number;
  activitiesDelta: number;
}

const DAY_MS = 86_400_000;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

export function reportRange(label: ReportRangeLabel): ReportRange {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  let days = 30;
  if (label === '7d') days = 7;
  if (label === '30d') days = 30;
  if (label === '90d') days = 90;
  if (label === 'quarter') days = 90;
  if (label === '12m') days = 365;
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);
  const prevEnd = new Date(start.getTime() - DAY_MS);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * DAY_MS);
  return {
    label,
    from: isoDay(start),
    to: isoDay(end),
    prevFrom: isoDay(prevStart),
    prevTo: isoDay(prevEnd),
  };
}

export function defaultBucket(label: ReportRangeLabel): ReportBucket {
  if (label === '7d') return 'day';
  if (label === '30d') return 'week';
  if (label === '90d' || label === 'quarter') return 'month';
  return 'quarter';
}

function bucketExpr(bucket: ReportBucket): string {
  if (bucket === 'day') return "strftime('%Y-%m-%d', created_at)";
  if (bucket === 'week') return "strftime('%Y-W%W', created_at)";
  if (bucket === 'month') return "strftime('%Y-%m', created_at)";
  return "strftime('%Y', created_at) || '-Q' || ((CAST(strftime('%m', created_at) AS INTEGER) + 2) / 3)";
}

function ownerClause(alias: string, ownerId?: string): { sql: string; arg: string | undefined } {
  if (!ownerId) return { sql: '', arg: undefined };
  return { sql: ` AND COALESCE(${alias}.owner_id, ${alias}.user_id) = ?`, arg: ownerId };
}

function filterClauses(filters: ReportFilters): { sql: string; args: (string | undefined)[] } {
  const parts: string[] = [];
  const args: (string | undefined)[] = [];
  if (filters.source) {
    parts.push(' AND source = ?');
    args.push(filters.source);
  }
  if (filters.priority) {
    parts.push(' AND priority = ?');
    args.push(filters.priority);
  }
  const owner = ownerClause('d', filters.ownerId);
  if (owner.sql) {
    parts.push(owner.sql);
    args.push(owner.arg);
  }
  return { sql: parts.join(''), args };
}

function delta(now: number, prev: number): number {
  if (prev === 0) return now > 0 ? 100 : 0;
  return Math.round(((now - prev) / prev) * 100);
}

export async function reportKpis(
  userId: string,
  range: ReportRange,
  filters: ReportFilters,
): Promise<Kpis> {
  const db = getDb();
  const ownerC = ownerClause('c', filters.ownerId);

  const newContacts = await count(
    db,
    `SELECT COUNT(*) AS c FROM crm_contacts c
     WHERE c.user_id = ? AND c.created_at >= datetime(?) AND c.created_at <= datetime(?, '23:59:59')${ownerC.sql}`,
    [userId, range.from, range.to, ownerC.arg].filter((v): v is string => v !== undefined),
  );
  const prevContacts = await count(
    db,
    `SELECT COUNT(*) AS c FROM crm_contacts c
     WHERE c.user_id = ? AND c.created_at >= datetime(?) AND c.created_at <= datetime(?, '23:59:59')${ownerC.sql}`,
    [userId, range.prevFrom, range.prevTo, ownerC.arg].filter((v): v is string => v !== undefined),
  );

  const f = filterClauses(filters);
  const newDeals = await count(
    db,
    `SELECT COUNT(*) AS c FROM crm_deals d
     WHERE d.user_id = ? AND d.created_at >= datetime(?) AND d.created_at <= datetime(?, '23:59:59')${f.sql}`,
    [userId, range.from, range.to, ...f.args],
  );
  const prevDeals = await count(
    db,
    `SELECT COUNT(*) AS c FROM crm_deals d
     WHERE d.user_id = ? AND d.created_at >= datetime(?) AND d.created_at <= datetime(?, '23:59:59')${f.sql}`,
    [userId, range.prevFrom, range.prevTo, ...f.args],
  );

  const wonAmount = await sum(
    db,
    `SELECT COALESCE(SUM(${AMT}), 0) AS s FROM crm_deals d
     JOIN crm_stages s ON s.id = d.stage_id
     WHERE d.user_id = ? AND s.is_won = 1 AND d.closed_at >= datetime(?) AND d.closed_at <= datetime(?, '23:59:59')${f.sql}`,
    [userId, range.from, range.to, ...f.args],
  );
  const prevWonAmount = await sum(
    db,
    `SELECT COALESCE(SUM(${AMT}), 0) AS s FROM crm_deals d
     JOIN crm_stages s ON s.id = d.stage_id
     WHERE d.user_id = ? AND s.is_won = 1 AND d.closed_at >= datetime(?) AND d.closed_at <= datetime(?, '23:59:59')${f.sql}`,
    [userId, range.prevFrom, range.prevTo, ...f.args],
  );

  const activities = await count(
    db,
    `SELECT COUNT(*) AS c FROM crm_activities a
     WHERE a.user_id = ? AND a.created_at >= datetime(?) AND a.created_at <= datetime(?, '23:59:59')`,
    [userId, range.from, range.to],
  );
  const prevActivities = await count(
    db,
    `SELECT COUNT(*) AS c FROM crm_activities a
     WHERE a.user_id = ? AND a.created_at >= datetime(?) AND a.created_at <= datetime(?, '23:59:59')`,
    [userId, range.prevFrom, range.prevTo],
  );

  return {
    newContacts,
    newContactsDelta: delta(newContacts, prevContacts),
    newDeals,
    newDealsDelta: delta(newDeals, prevDeals),
    wonAmount,
    wonAmountDelta: delta(wonAmount, prevWonAmount),
    activities,
    activitiesDelta: delta(activities, prevActivities),
  };
}

export async function reportTimeseries(
  userId: string,
  range: ReportRange,
  bucket: ReportBucket,
  filters: ReportFilters,
): Promise<TimeseriesPoint[]> {
  const db = getDb();
  const ownerC = ownerClause('c', filters.ownerId);
  const f = filterClauses(filters);
  const b = bucketExpr(bucket);

  const contactsRows = (await db
    .prepare(
      `SELECT ${b} AS bucket, COUNT(*) AS c
       FROM crm_contacts c
       WHERE c.user_id = ? AND c.created_at >= datetime(?) AND c.created_at <= datetime(?, '23:59:59')${ownerC.sql}
       GROUP BY bucket ORDER BY bucket`,
    )
    .all(
      ...[userId, range.from, range.to, ownerC.arg].filter((v): v is string => v !== undefined),
    )) as Array<{ bucket: string; c: number }>;

  const dealsRows = (await db
    .prepare(
      `SELECT ${b} AS bucket, COUNT(*) AS c
       FROM crm_deals d
       WHERE d.user_id = ? AND d.created_at >= datetime(?) AND d.created_at <= datetime(?, '23:59:59')${f.sql}
       GROUP BY bucket ORDER BY bucket`,
    )
    .all(...[userId, range.from, range.to, ...f.args].filter((v): v is string => v !== undefined))) as Array<{ bucket: string; c: number }>;

  const wonRows = (await db
    .prepare(
      `SELECT ${b} AS bucket, COALESCE(SUM(${AMT}), 0) AS s
       FROM crm_deals d
       JOIN crm_stages s ON s.id = d.stage_id
       WHERE d.user_id = ? AND s.is_won = 1 AND d.closed_at >= datetime(?) AND d.closed_at <= datetime(?, '23:59:59')${f.sql}
       GROUP BY bucket ORDER BY bucket`,
    )
    .all(...[userId, range.from, range.to, ...f.args].filter((v): v is string => v !== undefined))) as Array<{ bucket: string; s: number }>;

  const allBuckets = new Set<string>([
    ...orderedBuckets(range, bucket),
    ...contactsRows.map((r) => r.bucket),
    ...dealsRows.map((r) => r.bucket),
    ...wonRows.map((r) => r.bucket),
  ]);
  const keys = [...allBuckets].sort();
  const map = new Map<string, TimeseriesPoint>();
  for (const k of keys) map.set(k, { bucket: k, contacts: 0, deals: 0, wonAmount: 0 });
  for (const r of contactsRows) map.get(r.bucket)!.contacts = r.c;
  for (const r of dealsRows) map.get(r.bucket)!.deals = r.c;
  for (const r of wonRows) map.get(r.bucket)!.wonAmount = r.s;
  return keys.map((k) => map.get(k)!);
}

export async function reportByOwner(
  userId: string,
  range: ReportRange,
  filters: ReportFilters,
  owners: OwnerMetricInput[],
): Promise<OwnerMetric[]> {
  const db = getDb();
  const baseFilters = filterClauses(filters);
  const out: OwnerMetric[] = [];
  for (const o of owners) {
    const f = { ...baseFilters, ownerId: o.id };
    const fc = filterClauses(f);
    const contacts = await count(
      db,
      `SELECT COUNT(*) AS c FROM crm_contacts c
       WHERE c.user_id = ? AND COALESCE(c.owner_id, c.user_id) = ? AND c.created_at >= datetime(?) AND c.created_at <= datetime(?, '23:59:59')`,
      [userId, o.id, range.from, range.to],
    );
    const deals = await count(
      db,
      `SELECT COUNT(*) AS c FROM crm_deals d
       WHERE d.user_id = ? AND COALESCE(d.owner_id, d.user_id) = ? AND d.created_at >= datetime(?) AND d.created_at <= datetime(?, '23:59:59')${fc.sql}`,
      [userId, o.id, range.from, range.to, ...fc.args],
    );
    const wonAmount = await sum(
      db,
      `SELECT COALESCE(SUM(${AMT}), 0) AS s FROM crm_deals d
       JOIN crm_stages s ON s.id = d.stage_id
       WHERE d.user_id = ? AND COALESCE(d.owner_id, d.user_id) = ? AND s.is_won = 1 AND d.closed_at >= datetime(?) AND d.closed_at <= datetime(?, '23:59:59')${fc.sql}`,
      [userId, o.id, range.from, range.to, ...fc.args],
    );
    out.push({ ...o, contacts, deals, wonAmount, activities: 0 });
  }
  return out.sort((a, b) => b.wonAmount - a.wonAmount || b.deals - a.deals);
}

async function count(
  db: ReturnType<typeof getDb>,
  sql: string,
  args: (string | number | undefined)[],
): Promise<number> {
  const row = (await db
    .prepare(sql)
    .get(...args.filter((a): a is string | number => a !== undefined))) as { c: number } | undefined;
  return row?.c ?? 0;
}

async function sum(
  db: ReturnType<typeof getDb>,
  sql: string,
  args: (string | number | undefined)[],
): Promise<number> {
  const row = (await db
    .prepare(sql)
    .get(...args.filter((a): a is string | number => a !== undefined))) as { s: number } | undefined;
  return row?.s ?? 0;
}

function orderedBuckets(range: ReportRange, bucket: ReportBucket): string[] {
  const out: string[] = [];
  let cursor = range.from;
  const seen = new Set<string>();
  while (cursor <= range.to) {
    const key = formatBucket(cursor, bucket);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
    cursor = shiftDays(cursor, 1);
  }
  return out;
}

function formatBucket(date: string, bucket: ReportBucket): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (bucket === 'day') return date;
  if (bucket === 'week') {
    const y = d.getUTCFullYear();
    const jan1 = new Date(Date.UTC(y, 0, 1));
    const days = Math.floor((d.getTime() - jan1.getTime()) / DAY_MS);
    const w = Math.floor((days + jan1.getUTCDay()) / 7);
    return `${y}-W${String(w).padStart(2, '0')}`;
  }
  if (bucket === 'month') return date.slice(0, 7);
  const q = Math.floor((d.getUTCMonth()) / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

// ---------- Report types & functions nuevos ----------

export interface FunnelReportStage extends FunnelStage {
  conversionRate: number | null;
}

export interface ForecastReportStage {
  id: string;
  name: string;
  probability: number;
  count: number;
  amount: number;
  forecast: number;
}

export interface SourcePerformance {
  source: string;
  contacts: number;
  deals: number;
  amount: number;
}

export interface OwnerPerformance {
  id: string;
  email: string;
  name: string | null;
  contacts: number;
  deals: number;
  wonDeals: number;
  lostDeals: number;
  wonAmount: number;
  winRate: number;
  activities: number;
}

export interface ActivityLeaderboard {
  id: string;
  email: string;
  name: string | null;
  completed: number;
}

export interface ConversionRate {
  won: number;
  created: number;
  rate: number;
  delta: number;
}

function normalizeSource(source: string): string {
  return source || 'other';
}

export async function reportFunnel(
  userId: string,
  pipelineId: string | null,
): Promise<FunnelReportStage[]> {
  if (!pipelineId) return [];
  const rows = (await getDb()
    .prepare(
      `SELECT s.id, s.name, s.probability, s.is_won, s.is_lost,
         COUNT(d.id) AS count, COALESCE(SUM(${AMT}), 0) AS amount
       FROM crm_stages s
       LEFT JOIN crm_deals d ON d.stage_id = s.id AND d.user_id = ?
       WHERE s.pipeline_id = ?
       GROUP BY s.id
       ORDER BY s.position ASC`,
    )
    .all(userId, pipelineId)) as FunnelStage[];

  return rows.map((stage, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    const conversionRate =
      prev && prev.count > 0 ? Math.round((stage.count / prev.count) * 100) : null;
    return { ...stage, conversionRate };
  });
}

export async function reportForecast(
  userId: string,
  pipelineId: string | null,
): Promise<ForecastReportStage[]> {
  if (!pipelineId) return [];
  return (await getDb()
    .prepare(
      `SELECT s.id, s.name, s.probability,
         COUNT(d.id) AS count,
         COALESCE(SUM(${AMT}), 0) AS amount,
         COALESCE(SUM(${AMT} * s.probability / 100.0), 0) AS forecast
       FROM crm_stages s
       LEFT JOIN crm_deals d ON d.stage_id = s.id AND d.user_id = ? AND d.closed_at IS NULL
       WHERE s.pipeline_id = ?
       GROUP BY s.id
       ORDER BY s.position ASC`,
    )
    .all(userId, pipelineId)) as ForecastReportStage[];
}

export async function reportSourcePerformance(
  userId: string,
  range: ReportRange,
  filters: ReportFilters,
): Promise<SourcePerformance[]> {
  const db = getDb();
  const ownerC = ownerClause('c', filters.ownerId);
  const f = filterClauses(filters);

  const contactsRows = (await db
    .prepare(
      `SELECT COALESCE(NULLIF(c.source, ''), 'other') AS source, COUNT(*) AS c
       FROM crm_contacts c
       WHERE c.user_id = ? AND c.created_at >= datetime(?) AND c.created_at <= datetime(?, '23:59:59')${ownerC.sql}
       GROUP BY 1`,
    )
    .all(
      ...[userId, range.from, range.to, ownerC.arg].filter((v): v is string => v !== undefined),
    )) as Array<{ source: string; c: number }>;

  const dealsRows = (await db
    .prepare(
      `SELECT COALESCE(NULLIF(d.source, ''), 'other') AS source,
         COUNT(*) AS c, COALESCE(SUM(${AMT}), 0) AS a
       FROM crm_deals d
       WHERE d.user_id = ? AND d.created_at >= datetime(?) AND d.created_at <= datetime(?, '23:59:59')${f.sql}
       GROUP BY 1`,
    )
    .all(...[userId, range.from, range.to, ...f.args].filter((v): v is string => v !== undefined))) as Array<{
    source: string;
    c: number;
    a: number;
  }>;

  const map = new Map<string, SourcePerformance>();
  for (const r of contactsRows) {
    const source = normalizeSource(r.source);
    map.set(source, { source, contacts: r.c, deals: 0, amount: 0 });
  }
  for (const r of dealsRows) {
    const source = normalizeSource(r.source);
    const existing = map.get(source) ?? { source, contacts: 0, deals: 0, amount: 0 };
    existing.deals = r.c;
    existing.amount = r.a;
    map.set(source, existing);
  }
  return [...map.values()].sort((a, b) => b.deals - a.deals || b.amount - a.amount);
}

export async function reportOwnerPerformance(
  userId: string,
  range: ReportRange,
  filters: ReportFilters,
  owners: OwnerMetricInput[],
): Promise<OwnerPerformance[]> {
  const db = getDb();
  const baseFilters = filterClauses(filters);
  const out: OwnerPerformance[] = [];

  for (const o of owners) {
    const f = { ...baseFilters, ownerId: o.id };
    const fc = filterClauses(f);

    const contacts = await count(
      db,
      `SELECT COUNT(*) AS c FROM crm_contacts c
       WHERE c.user_id = ? AND COALESCE(c.owner_id, c.user_id) = ? AND c.created_at >= datetime(?) AND c.created_at <= datetime(?, '23:59:59')`,
      [userId, o.id, range.from, range.to],
    );

    const deals = await count(
      db,
      `SELECT COUNT(*) AS c FROM crm_deals d
       WHERE d.user_id = ? AND COALESCE(d.owner_id, d.user_id) = ? AND d.created_at >= datetime(?) AND d.created_at <= datetime(?, '23:59:59')${fc.sql}`,
      [userId, o.id, range.from, range.to, ...fc.args],
    );

    const wonRow = (await db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(${AMT}), 0) AS a FROM crm_deals d
         JOIN crm_stages s ON s.id = d.stage_id
         WHERE d.user_id = ? AND COALESCE(d.owner_id, d.user_id) = ? AND s.is_won = 1 AND d.closed_at >= datetime(?) AND d.closed_at <= datetime(?, '23:59:59')${fc.sql}`,
      )
      .get(...[userId, o.id, range.from, range.to, ...fc.args].filter((v): v is string => v !== undefined))) as {
      c: number;
      a: number;
    };

    const lostDeals = await count(
      db,
      `SELECT COUNT(*) AS c FROM crm_deals d
       JOIN crm_stages s ON s.id = d.stage_id
       WHERE d.user_id = ? AND COALESCE(d.owner_id, d.user_id) = ? AND s.is_lost = 1 AND d.closed_at >= datetime(?) AND d.closed_at <= datetime(?, '23:59:59')${fc.sql}`,
      [userId, o.id, range.from, range.to, ...fc.args],
    );

    const activities = await count(
      db,
      `SELECT COUNT(*) AS c FROM crm_activities a
       WHERE a.user_id = ? AND a.done = 1 AND COALESCE(a.done_at, a.created_at) >= datetime(?) AND COALESCE(a.done_at, a.created_at) <= datetime(?, '23:59:59')`,
      [o.id, range.from, range.to],
    );

    const wonDeals = wonRow.c;
    const wonAmount = wonRow.a;
    const closed = wonDeals + lostDeals;
    out.push({
      ...o,
      contacts,
      deals,
      wonDeals,
      lostDeals,
      wonAmount,
      winRate: closed > 0 ? Math.round((wonDeals / closed) * 100) : 0,
      activities,
    });
  }

  return out.sort((a, b) => b.wonAmount - a.wonAmount || b.deals - a.deals);
}

export async function reportActivityLeaderboard(
  userId: string,
  range: ReportRange,
  owners: OwnerMetricInput[],
): Promise<ActivityLeaderboard[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT user_id AS id, COUNT(*) AS c FROM crm_activities
       WHERE user_id = ? AND done = 1 AND COALESCE(done_at, created_at) >= datetime(?) AND COALESCE(done_at, created_at) <= datetime(?, '23:59:59')
       GROUP BY user_id`,
    )
    .all(userId, range.from, range.to)) as Array<{ id: string; c: number }>;

  const map = new Map(rows.map((r) => [r.id, r.c]));
  return owners
    .map((o) => ({ ...o, completed: map.get(o.id) ?? 0 }))
    .sort((a, b) => b.completed - a.completed);
}

async function conversionForRange(
  db: ReturnType<typeof getDb>,
  userId: string,
  range: ReportRange,
  filters: ReportFilters,
): Promise<{ created: number; won: number }> {
  const f = filterClauses(filters);
  const created = await count(
    db,
    `SELECT COUNT(*) AS c FROM crm_deals d
     WHERE d.user_id = ? AND d.created_at >= datetime(?) AND d.created_at <= datetime(?, '23:59:59')${f.sql}`,
    [userId, range.from, range.to, ...f.args],
  );
  const won = await count(
    db,
    `SELECT COUNT(*) AS c FROM crm_deals d
     JOIN crm_stages s ON s.id = d.stage_id
     WHERE d.user_id = ? AND s.is_won = 1 AND d.closed_at >= datetime(?) AND d.closed_at <= datetime(?, '23:59:59')${f.sql}`,
    [userId, range.from, range.to, ...f.args],
  );
  return { created, won };
}

export async function reportConversionRate(
  userId: string,
  range: ReportRange,
  filters: ReportFilters,
): Promise<ConversionRate> {
  const db = getDb();
  const current = await conversionForRange(db, userId, range, filters);
  const prev = await conversionForRange(db, userId, { ...range, from: range.prevFrom, to: range.prevTo }, filters);
  const rate = current.created > 0 ? Math.round((current.won / current.created) * 100) : 0;
  const prevRate = prev.created > 0 ? Math.round((prev.won / prev.created) * 100) : 0;
  return { ...current, rate, delta: rate - prevRate };
}
