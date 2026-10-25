/**
 * Track, planificación: cálculos puros (sin base) para plans, updates,
 * métricas de cycle, insights y auto-cierre. Se testean en tests/unit.
 */

export type StatusCategory = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';

// ---------- Progreso ----------

export interface ProgressIssue {
  category: StatusCategory | null;
  estimate: number | null;
}

export interface Progress {
  /** Issues que cuentan (sin cancelados). */
  total: number;
  started: number;
  done: number;
  /** Puntos de estimación, si algún issue tiene. */
  points: number;
  donePoints: number;
  startedPoints: number;
  /** 0..100: hechos sobre el alcance (por puntos si hay estimaciones, si no por cantidad). */
  percent: number;
  byPoints: boolean;
}

/**
 * Progreso como Linear: los cancelados salen del alcance; con estimaciones
 * cuenta por puntos (un issue sin estimar vale 1), si no por cantidad.
 */
export function computeProgress(issues: ProgressIssue[]): Progress {
  const scope = issues.filter((i) => i.category !== 'cancelled');
  const byPoints = scope.some((i) => (i.estimate ?? 0) > 0);
  const w = (i: ProgressIssue) => (byPoints ? Math.max(i.estimate ?? 1, 0) || 1 : 1);
  let points = 0;
  let donePoints = 0;
  let startedPoints = 0;
  let done = 0;
  let started = 0;
  for (const i of scope) {
    points += w(i);
    if (i.category === 'done') {
      done++;
      donePoints += w(i);
    } else if (i.category === 'in_progress') {
      started++;
      startedPoints += w(i);
    }
  }
  const percent = points > 0 ? Math.round((donePoints / points) * 100) : 0;
  return { total: scope.length, started, done, points, donePoints, startedPoints, percent, byPoints };
}

// ---------- Updates y recordatorios ----------

export type HealthState = 'on_track' | 'at_risk' | 'off_track' | 'missing' | 'none';

const DAY_MS = 86_400_000;

export function cadenceDays(cadence: 'weekly' | 'biweekly' | 'off'): number {
  return cadence === 'biweekly' ? 14 : 7;
}

/**
 * Estado de salud de un plan: el del último update; "missing" cuando el plan
 * está en curso, tiene recordatorios y el último update (o el inicio) quedó
 * más viejo que un ciclo de recordatorio más 3 días.
 */
export function healthState(args: {
  status: string;
  cadence: 'weekly' | 'biweekly' | 'off';
  lastUpdateHealth: string | null;
  lastUpdateAt: string | null;
  since: string;
  now: Date;
}): HealthState {
  const { status, cadence, lastUpdateHealth, lastUpdateAt, since, now } = args;
  const active = status === 'in_progress';
  if (active && cadence !== 'off') {
    const ref = Date.parse(lastUpdateAt ?? since);
    if (Number.isFinite(ref) && now.getTime() - ref > (cadenceDays(cadence) + 3) * DAY_MS) return 'missing';
  }
  if (lastUpdateHealth === 'on_track' || lastUpdateHealth === 'at_risk' || lastUpdateHealth === 'off_track') {
    return lastUpdateHealth;
  }
  return 'none';
}

/** Desfase (minutos) de una zona horaria IANA respecto de UTC en ese instante. */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return Math.round((asUtc - at.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

/**
 * Próximo recordatorio: el `day` de la semana (1 = lunes … 7 = domingo) a las
 * `hour` en la zona del lead, estrictamente después de `after`. Con cadencia
 * cada dos semanas, salta una semana si el anterior fue hace menos de 8 días.
 */
export function nextReminderAt(args: {
  after: Date;
  day: number;
  cadence: 'weekly' | 'biweekly' | 'off';
  timeZone?: string | null;
  hour?: number;
  lastReminderAt?: Date | null;
}): Date | null {
  if (args.cadence === 'off') return null;
  const hour = args.hour ?? 9;
  const tz = args.timeZone || 'UTC';
  const offset = tzOffsetMinutes(tz, args.after);
  // "Ahora" en la hora local del lead, como si fuera UTC.
  const local = new Date(args.after.getTime() + offset * 60_000);
  const dow = ((local.getUTCDay() + 6) % 7) + 1; // 1 = lunes
  let add = (args.day - dow + 7) % 7;
  let candidate = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + add, hour, 0, 0);
  if (candidate <= local.getTime()) {
    add += 7;
    candidate = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + add, hour, 0, 0);
  }
  let at = new Date(candidate - tzOffsetMinutes(tz, new Date(candidate - offset * 60_000)) * 60_000);
  if (args.cadence === 'biweekly' && args.lastReminderAt && at.getTime() - args.lastReminderAt.getTime() < 8 * DAY_MS) {
    at = new Date(at.getTime() + 7 * DAY_MS);
  }
  return at;
}

// ---------- Métricas de cycle ----------

export interface CycleIssueHistory {
  id: string;
  estimate: number | null;
  createdAt: string;
  /** Categoría actual del status. */
  category: StatusCategory | null;
  /** Está hoy en el cycle. */
  inCycle: boolean;
  /** Entradas y salidas del cycle, en orden (por nombre de cycle en la actividad). */
  moves: Array<{ at: string; kind: 'join' | 'leave'; rollover?: boolean }>;
  /** Cambios de categoría de status, en orden. */
  statusChanges: Array<{ at: string; from: StatusCategory | null; to: StatusCategory | null }>;
}

export interface CycleDayPoint {
  day: string;
  scope: number;
  started: number;
  completed: number;
}

export interface CycleMetrics {
  points: CycleDayPoint[];
  byPoints: boolean;
  initialScope: number;
  scope: number;
  completed: number;
  started: number;
  /** Agregado después del primer día. */
  added: number;
  removed: number;
  /** Lo que pasó al cycle siguiente al cerrar. */
  carriedOver: number;
  /** 0..100 (scope creep: agregado / alcance inicial). */
  scopeCreepPercent: number;
  completionPercent: number;
}

function dayList(start: string, end: string): string[] {
  const out: string[] = [];
  const s = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const e = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return out;
  for (let t = s; t <= e && out.length < 400; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Categoría del issue al final del día `day` (fin del día UTC). */
function categoryAt(issue: CycleIssueHistory, endOfDay: string): StatusCategory | null {
  const changes = issue.statusChanges.filter((c) => c.at <= endOfDay);
  if (changes.length) return changes[changes.length - 1].to;
  if (issue.statusChanges.length) return issue.statusChanges[0].from;
  return issue.category;
}

/**
 * ¿Estaba el issue en el cycle al final de `endOfDay`? Arranca afuera, salvo
 * que su primer movimiento sea una salida (estaba desde que se creó) o que
 * esté hoy sin movimientos (se creó adentro). Una salida por rollover al
 * cerrar no lo saca del alcance del cycle que se cerró.
 */
function memberAt(issue: CycleIssueHistory, endOfDay: string): boolean {
  if (issue.createdAt.slice(0, 19) > endOfDay) return false;
  let inside = issue.moves.length ? issue.moves[0].kind === 'leave' : issue.inCycle;
  for (const m of issue.moves) {
    if (m.at > endOfDay) break;
    if (m.kind === 'join') inside = true;
    else if (!m.rollover) inside = false;
  }
  return inside;
}

/** Burn-up del cycle (alcance, empezados y terminados por día) y sus números. */
export function computeCycleMetrics(args: {
  start: string;
  end: string;
  today: string;
  issues: CycleIssueHistory[];
}): CycleMetrics {
  const { issues } = args;
  const byPoints = issues.some((i) => (i.estimate ?? 0) > 0);
  const w = (i: CycleIssueHistory) => (byPoints ? Math.max(i.estimate ?? 1, 0) || 1 : 1);
  const lastDay = args.end.slice(0, 10) < args.today ? args.end.slice(0, 10) : args.today;
  const days = dayList(args.start, lastDay < args.start.slice(0, 10) ? args.start : lastDay);
  const points: CycleDayPoint[] = days.map((d) => {
    const eod = `${d}T23:59:59`;
    let scope = 0;
    let started = 0;
    let completed = 0;
    for (const i of issues) {
      if (!memberAt(i, eod)) continue;
      const cat = categoryAt(i, eod);
      if (cat === 'cancelled') continue;
      scope += w(i);
      if (cat === 'done') completed += w(i);
      else if (cat === 'in_progress') started += w(i);
    }
    return { day: d, scope, started, completed };
  });
  const first = points[0];
  const last = points[points.length - 1];
  const startEod = `${args.start.slice(0, 10)}T23:59:59`;
  let added = 0;
  let removed = 0;
  let carriedOver = 0;
  for (const i of issues) {
    const atStart = memberAt(i, startEod);
    const now = memberAt(i, '9999-12-31T23:59:59');
    if (!atStart && now) added += w(i);
    if (atStart && !now) removed += w(i);
    if (i.moves.some((m) => m.kind === 'leave' && m.rollover)) carriedOver += w(i);
  }
  const initialScope = first?.scope ?? 0;
  const scope = last?.scope ?? 0;
  const completed = last?.completed ?? 0;
  return {
    points,
    byPoints,
    initialScope,
    scope,
    completed,
    started: last?.started ?? 0,
    added,
    removed,
    carriedOver,
    scopeCreepPercent: initialScope > 0 ? Math.round((added / initialScope) * 100) : 0,
    completionPercent: scope > 0 ? Math.round((completed / scope) * 100) : 0,
  };
}

/** Velocidad: promedio de lo terminado en los últimos 3 cycles cerrados (o null). */
export function velocity(completedPerCycle: number[]): number | null {
  const last = completedPerCycle.slice(-3);
  if (!last.length) return null;
  return Math.round((last.reduce((a, b) => a + b, 0) / last.length) * 10) / 10;
}

/** Capacidad: alcance cargado sobre la velocidad (0..∞, en %). */
export function capacityPercent(scope: number, vel: number | null): number | null {
  if (vel === null || vel <= 0) return null;
  return Math.round((scope / vel) * 100);
}

// ---------- Auto-cierre / auto-archivo ----------

/** Fecha (ISO) de corte: hace `months` meses desde `now`. */
export function monthsAgo(now: Date, months: number): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
}

// ---------- Insights ----------

export interface InsightIssue {
  id: string;
  identifier: string;
  title: string;
  projectId: string;
  projectName: string;
  statusName: string | null;
  category: StatusCategory | null;
  priority: string;
  assigneeId: string | null;
  assigneeName: string | null;
  labels: Array<{ id: string; name: string }>;
  planId: string | null;
  planName: string | null;
  cycleId: string | null;
  cycleName: string | null;
  estimate: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface InsightBucket {
  key: string;
  label: string;
  value: number;
  count: number;
  segments: Array<{ key: string; label: string; value: number; count: number }>;
  issues: Array<{ id: string; identifier: string; title: string }>;
  /** Para medidas de tiempo: promedio y percentil 90 (días). */
  avg?: number;
  p90?: number;
}

export interface InsightResult {
  measure: string;
  slice: string;
  segment: string;
  /** "days" para medidas de tiempo, "points" o "issues". */
  unit: 'issues' | 'points' | 'days';
  buckets: InsightBucket[];
  segmentKeys: Array<{ key: string; label: string }>;
  total: number;
  issueCount: number;
  burnup?: Array<{ key: string; label: string; scope: number; completed: number; started: number }>;
}

type Dim =
  | 'status'
  | 'status_type'
  | 'assignee'
  | 'priority'
  | 'label'
  | 'team'
  | 'plan'
  | 'cycle'
  | 'created_week'
  | 'created_month'
  | 'completed_week'
  | 'completed_month'
  | 'none';

const CATEGORY_ORDER: Record<string, number> = { backlog: 0, todo: 1, in_progress: 2, done: 3, cancelled: 4 };
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

/** Lunes (UTC) de la semana de la fecha. */
export function weekKey(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Claves (con etiqueta) del issue en una dimensión; label puede dar varias. */
function keysOf(issue: InsightIssue, dim: Dim): Array<{ key: string; label: string }> {
  switch (dim) {
    case 'none':
      return [{ key: 'all', label: '' }];
    case 'status':
      return [{ key: issue.statusName ?? '', label: issue.statusName ?? '' }];
    case 'status_type':
      return [{ key: issue.category ?? 'none', label: issue.category ?? 'none' }];
    case 'assignee':
      return [{ key: issue.assigneeId ?? 'none', label: issue.assigneeName ?? 'none' }];
    case 'priority':
      return [{ key: issue.priority, label: issue.priority }];
    case 'label':
      return issue.labels.length ? issue.labels.map((l) => ({ key: l.id, label: l.name })) : [{ key: 'none', label: 'none' }];
    case 'team':
      return [{ key: issue.projectId, label: issue.projectName }];
    case 'plan':
      return [{ key: issue.planId ?? 'none', label: issue.planName ?? 'none' }];
    case 'cycle':
      return [{ key: issue.cycleId ?? 'none', label: issue.cycleName ?? 'none' }];
    case 'created_week':
      return [{ key: weekKey(issue.createdAt), label: weekKey(issue.createdAt) }];
    case 'created_month':
      return [{ key: monthKey(issue.createdAt), label: monthKey(issue.createdAt) }];
    case 'completed_week':
      return issue.completedAt ? [{ key: weekKey(issue.completedAt), label: weekKey(issue.completedAt) }] : [];
    case 'completed_month':
      return issue.completedAt ? [{ key: monthKey(issue.completedAt), label: monthKey(issue.completedAt) }] : [];
  }
}

function sortBuckets(dim: Dim, a: { key: string; label: string; value: number }, b: { key: string; label: string; value: number }): number {
  if (dim === 'status_type') return (CATEGORY_ORDER[a.key] ?? 9) - (CATEGORY_ORDER[b.key] ?? 9);
  if (dim === 'priority') return (PRIORITY_ORDER[a.key] ?? 9) - (PRIORITY_ORDER[b.key] ?? 9);
  if (dim.endsWith('_week') || dim.endsWith('_month')) return a.key.localeCompare(b.key);
  if (a.key === 'none') return 1;
  if (b.key === 'none') return -1;
  return b.value - a.value || a.label.localeCompare(b.label);
}

function daysBetween(a: string, b: string): number {
  return Math.max(0, (Date.parse(b) - Date.parse(a)) / DAY_MS);
}

/** Valor de un issue para una medida de tiempo (días) o null si no aplica. */
function timeValue(issue: InsightIssue, measure: string, now: Date): number | null {
  if (measure === 'cycle_time') {
    return issue.startedAt && issue.completedAt && issue.category === 'done' ? daysBetween(issue.startedAt, issue.completedAt) : null;
  }
  if (measure === 'lead_time') {
    return issue.completedAt && issue.category === 'done' ? daysBetween(issue.createdAt, issue.completedAt) : null;
  }
  if (measure === 'issue_age') {
    return issue.category === 'done' || issue.category === 'cancelled' ? null : daysBetween(issue.createdAt, now.toISOString());
  }
  return null;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Agrega issues como el panel de Insights de Linear: medida en el eje y,
 * slice en el x y segmento como color. Las medidas de tiempo dan la mediana
 * en días (y promedio y p90 en la tabla) y no se segmentan.
 */
export function aggregateInsight(
  issues: InsightIssue[],
  query: { measure: string; slice: string; segment: string; interval?: 'week' | 'month' },
  now: Date = new Date(),
): InsightResult {
  const measure = query.measure;
  const isTime = measure === 'cycle_time' || measure === 'lead_time' || measure === 'issue_age';
  const unit: InsightResult['unit'] = isTime ? 'days' : measure === 'effort' ? 'points' : 'issues';
  const weight = (i: InsightIssue) => (measure === 'effort' ? Math.max(i.estimate ?? 0, 0) : 1);

  if (query.slice === 'burnup') {
    const interval = query.interval ?? 'week';
    const keyOf = interval === 'month' ? monthKey : weekKey;
    const keys = new Set<string>();
    for (const i of issues) {
      keys.add(keyOf(i.createdAt));
      if (i.completedAt) keys.add(keyOf(i.completedAt));
    }
    const sorted = [...keys].sort();
    const series = sorted.map((k) => {
      let scope = 0;
      let completed = 0;
      let started = 0;
      for (const i of issues) {
        if (i.category === 'cancelled') continue;
        if (keyOf(i.createdAt) > k) continue;
        scope += weight(i);
        if (i.completedAt && keyOf(i.completedAt) <= k) completed += weight(i);
        else if (i.startedAt && keyOf(i.startedAt) <= k) started += weight(i);
      }
      return { key: k, label: k, scope, completed, started };
    });
    return {
      measure,
      slice: 'burnup',
      segment: 'none',
      unit: unit === 'days' ? 'issues' : unit,
      buckets: [],
      segmentKeys: [],
      total: series.length ? series[series.length - 1].scope : 0,
      issueCount: issues.length,
      burnup: series,
    };
  }

  const slice = query.slice as Dim;
  const segment = (isTime ? 'none' : query.segment) as Dim;
  const map = new Map<
    string,
    { key: string; label: string; value: number; count: number; values: number[]; seg: Map<string, { key: string; label: string; value: number; count: number }>; issues: InsightBucket['issues'] }
  >();
  const segLabels = new Map<string, string>();
  let total = 0;
  let issueCount = 0;
  const allTimes: number[] = [];
  for (const issue of issues) {
    const tv = isTime ? timeValue(issue, measure, now) : null;
    if (isTime && tv === null) continue;
    issueCount++;
    const v = isTime ? (tv as number) : weight(issue);
    if (!isTime) total += v;
    else allTimes.push(v);
    for (const s of keysOf(issue, slice)) {
      let b = map.get(s.key);
      if (!b) {
        b = { key: s.key, label: s.label, value: 0, count: 0, values: [], seg: new Map(), issues: [] };
        map.set(s.key, b);
      }
      b.count++;
      if (isTime) b.values.push(v);
      else b.value += v;
      if (b.issues.length < 50) b.issues.push({ id: issue.id, identifier: issue.identifier, title: issue.title });
      if (segment !== 'none') {
        for (const g of keysOf(issue, segment)) {
          segLabels.set(g.key, g.label);
          const sg = b.seg.get(g.key) ?? { key: g.key, label: g.label, value: 0, count: 0 };
          sg.value += v;
          sg.count++;
          b.seg.set(g.key, sg);
        }
      }
    }
  }
  const buckets: InsightBucket[] = [...map.values()].map((b) => {
    if (isTime) {
      const sorted = [...b.values].sort((x, y) => x - y);
      return {
        key: b.key,
        label: b.label,
        value: round1(percentile(sorted, 50)),
        count: b.count,
        segments: [],
        issues: b.issues,
        avg: round1(sorted.reduce((a, c) => a + c, 0) / (sorted.length || 1)),
        p90: round1(percentile(sorted, 90)),
      };
    }
    return { key: b.key, label: b.label, value: b.value, count: b.count, segments: [...b.seg.values()], issues: b.issues };
  });
  buckets.sort((a, b) => sortBuckets(slice, a, b));
  const segmentKeys = [...segLabels.entries()]
    .map(([key, label]) => ({ key, label, value: 0 }))
    .sort((a, b) => sortBuckets(segment, a, b))
    .map(({ key, label }) => ({ key, label }));
  if (isTime) {
    const sorted = allTimes.sort((x, y) => x - y);
    total = round1(percentile(sorted, 50));
  }
  return { measure, slice, segment, unit, buckets, segmentKeys, total, issueCount };
}

/** CSV (RFC 4180) de una tabla de insights. */
export function insightCsv(result: InsightResult): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  if (result.burnup) {
    lines.push(['period', 'scope', 'started', 'completed'].join(','));
    for (const p of result.burnup) lines.push([p.label, p.scope, p.started, p.completed].map(esc).join(','));
    return lines.join('\n');
  }
  const segs = result.segmentKeys;
  const head = ['slice', result.unit === 'days' ? 'median_days' : result.unit, 'issues'];
  if (result.unit === 'days') head.push('avg_days', 'p90_days');
  for (const s of segs) head.push(s.label || s.key);
  lines.push(head.map(esc).join(','));
  for (const b of result.buckets) {
    const row: Array<string | number> = [b.label || b.key, b.value, b.count];
    if (result.unit === 'days') row.push(b.avg ?? 0, b.p90 ?? 0);
    for (const s of segs) row.push(b.segments.find((x) => x.key === s.key)?.value ?? 0);
    lines.push(row.map(esc).join(','));
  }
  return lines.join('\n');
}
