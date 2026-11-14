import { randomUUID } from 'crypto';
import { dbBatch, getDb, type BatchStatement } from '@/lib/db';
import {
  REPORT_STALE_MS,
  STATUS_COMPONENTS,
  PUBLIC_COMPONENTS,
  componentById,
  type ComponentStatus,
  type PublicComponentId,
  type StatusComponent,
} from './components';
import { STATUS_CODE, step, worstStatus, type MachineEvent, type MachineState } from './machine';
import { publicText, redactSecrets } from './redact';
import type { CheckResult } from './checks';

/**
 * Persistencia del monitoreo (tablas de 20261114_1912_status_monitoring).
 *
 * Lecturas por minuto, a propósito chicas (Turso cobra por fila leída): el
 * claim de status_meta, status_components (una fila por componente) y
 * status_public (una por fila pública). Las barras de 90 días viven como JSON
 * en status_public.days (un contador por día), así la página lee 4 filas y no
 * 90 días de minutos.
 *
 * Cada cambio de un componente va en un batch (transacción) cuyas sentencias
 * dependen de status_components.rev: si otra escritura lo cambió en el medio
 * (un reporte del watcher contra el chequeo de vencido del cron), no se aplica
 * nada y se reintenta.
 */

export const MINUTES_KEEP_DAYS = 7;
export const HOURS_KEEP_DAYS = 90;
export const PUBLIC_DAYS = 90;
/** Si el componente vuelve a fallar dentro de este tiempo, se reabre el incidente anterior. */
export const REOPEN_WINDOW_MS = 30 * 60_000;
/** Mínimo entre dos emails de apertura/reapertura del mismo incidente. */
export const NOTIFY_COOLDOWN_MS = 30 * 60_000;
/** Tope global de emails de alerta por hora. */
export const NOTIFY_MAX_PER_HOUR = 20;

export interface ComponentRow {
  id: string;
  status: ComponentStatus;
  fail_streak: number;
  ok_streak: number;
  severity: Exclude<ComponentStatus, 'up'> | null;
  checked_at: number | null;
  last_ok_at: number | null;
  last_error: string | null;
  detail: string | null;
  metrics: string | null;
  reported_at: number | null;
  incident_id: string | null;
  rev: number;
}

export interface Observation {
  status: ComponentStatus;
  error?: string | null;
  detail?: string | null;
  metrics?: Record<string, number> | null;
  /** Reporte del watcher: actualiza reported_at. */
  reported?: boolean;
}

export interface Notification {
  kind: 'open' | 'reopen' | 'worse' | 'resolve';
  incidentId: string;
  component: StatusComponent;
  severity: ComponentStatus;
  error: string | null;
  detail: string | null;
  startedAt: number;
}

function num(v: unknown): number {
  return Number(v ?? 0) || 0;
}

function toRow(r: Record<string, unknown>): ComponentRow {
  return {
    id: String(r.id),
    status: (r.status as ComponentStatus) ?? 'unknown',
    fail_streak: num(r.fail_streak),
    ok_streak: num(r.ok_streak),
    severity: (r.severity as ComponentRow['severity']) ?? null,
    checked_at: r.checked_at == null ? null : num(r.checked_at),
    last_ok_at: r.last_ok_at == null ? null : num(r.last_ok_at),
    last_error: (r.last_error as string) ?? null,
    detail: (r.detail as string) ?? null,
    metrics: (r.metrics as string) ?? null,
    reported_at: r.reported_at == null ? null : num(r.reported_at),
    incident_id: (r.incident_id as string) ?? null,
    rev: num(r.rev),
  };
}

export async function loadComponents(): Promise<Map<string, ComponentRow>> {
  const rows = (await getDb().prepare('SELECT * FROM status_components').all()) as Record<string, unknown>[];
  const map = new Map(rows.map((r) => [String(r.id), toRow(r)]));
  const missing = STATUS_COMPONENTS.filter((c) => !map.has(c.id));
  if (missing.length) {
    await dbBatch(missing.map((c) => ({ sql: 'INSERT OR IGNORE INTO status_components (id) VALUES (?)', args: [c.id] })));
    for (const c of missing) map.set(c.id, toRow({ id: c.id, status: 'unknown', rev: 0 }));
  }
  return map;
}

const SEVERITY_WORD: Record<string, string> = { down: 'down', degraded: 'degraded', unknown: 'not reporting' };

export function incidentTitle(c: StatusComponent, severity: ComponentStatus, error: string | null): string {
  const quota = c.id === 'database' && error && /quota\/blocked/.test(error) ? ' (plan quota: blocked)' : '';
  const stale = severity === 'unknown' ? ` (no report for ${REPORT_STALE_MS / 60_000}+ min: is the watcher down?)` : '';
  return `${c.label} ${SEVERITY_WORD[severity] ?? severity}${quota}${stale}`;
}

/** ¿El incidente con esta severidad se ve en la página pública? */
export function visiblePublicly(c: StatusComponent, severity: ComponentStatus): boolean {
  if (severity === 'unknown' || severity === 'up') return false;
  return c.publicFrom === 'degraded' || severity === 'down';
}

/**
 * Arma el batch de un componente para una observación. `prevIncident` es el
 * último incidente del componente (para reabrir en vez de duplicar).
 */
export function planObservation(
  c: StatusComponent,
  row: ComponentRow,
  obs: Observation,
  now: number,
  prevIncident: { id: string; state: string; resolved_at: number | null; started_at: number } | null,
): { stmts: BatchStatement[]; notifications: Notification[]; events: MachineEvent[]; next: MachineState; incidentId: string | null } {
  const state: MachineState = { failStreak: row.fail_streak, okStreak: row.ok_streak, incident: row.severity };
  const { next, events } = step(state, obs.status);
  const error = obs.status === 'up' ? null : redactSecrets(obs.error ?? obs.detail ?? obs.status, 1000);
  const detail = obs.detail ? redactSecrets(obs.detail, 300) : null;
  // Todo depende de que la fila siga en la misma revisión (ver arriba).
  const guard = 'EXISTS (SELECT 1 FROM status_components WHERE id = ? AND rev = ?)';
  const g = [c.id, row.rev];
  const stmts: BatchStatement[] = [];
  const notifications: Notification[] = [];
  let incidentId = row.incident_id;

  const note = (incident: string, kind: string, text: string) =>
    stmts.push({
      sql: `INSERT INTO status_incident_notes (id, incident_id, at, by, kind, text, is_public) SELECT ?, ?, ?, 'system', ?, ?, 1 WHERE ${guard}`,
      args: [randomUUID(), incident, now, kind, text, ...g],
    });

  for (const ev of events) {
    if (ev.type === 'open') {
      const pub = visiblePublicly(c, ev.severity) ? 1 : 0;
      const reopen = prevIncident && prevIncident.state === 'resolved' && prevIncident.resolved_at != null && now - prevIncident.resolved_at < REOPEN_WINDOW_MS;
      if (reopen && prevIncident) {
        incidentId = prevIncident.id;
        stmts.push({
          // Reabierto por "sin reportes" no le baja la severidad a un incidente que ya era de una caída medida.
          sql: `UPDATE status_incidents SET state = 'open', resolved_at = NULL, severity = CASE WHEN ? = 'unknown' THEN severity ELSE ? END,
                  is_public = MAX(is_public, ?), last_failure_at = ?, failures = failures + ?, last_error = ?, title = ? WHERE id = ? AND state = 'resolved' AND ${guard}`,
          args: [ev.severity, ev.severity, pub, now, next.failStreak, error, incidentTitle(c, ev.severity, error), incidentId, ...g],
        });
        note(incidentId, 'reopened', `Failing again (${next.failStreak} consecutive failed checks): ${error ?? ''}`);
        notifications.push({ kind: 'reopen', incidentId, component: c, severity: ev.severity, error, detail, startedAt: prevIncident.started_at });
      } else {
        incidentId = randomUUID();
        stmts.push({
          sql: `INSERT OR IGNORE INTO status_incidents (id, component, public_id, title, severity, state, is_public, started_at, last_failure_at, failures, last_error)
                SELECT ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ? WHERE ${guard}`,
          args: [incidentId, c.id, c.publicId, incidentTitle(c, ev.severity, error), ev.severity, pub, now, now, next.failStreak, error, ...g],
        });
        note(incidentId, 'opened', `${next.failStreak} consecutive failed checks: ${error ?? ''}`);
        notifications.push({ kind: 'open', incidentId, component: c, severity: ev.severity, error, detail, startedAt: now });
      }
    } else if (ev.type === 'fail' && incidentId) {
      stmts.push({
        sql: `UPDATE status_incidents SET failures = failures + 1, last_failure_at = ?, last_error = ? WHERE id = ? AND state = 'open' AND ${guard}`,
        args: [now, error, incidentId, ...g],
      });
    } else if (ev.type === 'change' && incidentId) {
      const pub = visiblePublicly(c, ev.to) ? 1 : 0;
      stmts.push({
        sql: `UPDATE status_incidents SET severity = ?, is_public = MAX(is_public, ?), title = ? WHERE id = ? AND state = 'open' AND ${guard}`,
        args: [ev.to, pub, incidentTitle(c, ev.to, error), incidentId, ...g],
      });
      note(incidentId, `now_${ev.to}`, `Now ${ev.to} (was ${ev.from}): ${error ?? ''}`);
      notifications.push({ kind: 'worse', incidentId, component: c, severity: ev.to, error, detail, startedAt: now });
    } else if (ev.type === 'resolve' && incidentId) {
      stmts.push({
        sql: `UPDATE status_incidents SET state = 'resolved', resolved_at = ? WHERE id = ? AND state = 'open' AND ${guard}`,
        args: [now, incidentId, ...g],
      });
      note(incidentId, 'resolved', `${next.okStreak} consecutive passing checks.`);
      notifications.push({ kind: 'resolve', incidentId, component: c, severity: 'up', error: null, detail, startedAt: now });
    }
  }

  stmts.push({
    sql: `UPDATE status_components SET status = ?, fail_streak = ?, ok_streak = ?, severity = ?, checked_at = ?, last_ok_at = ?,
            last_error = ?, detail = ?, metrics = COALESCE(?, metrics), reported_at = ?, incident_id = ?, rev = rev + 1
          WHERE id = ? AND rev = ?`,
    args: [
      obs.status,
      next.failStreak,
      next.okStreak,
      next.incident,
      now,
      obs.status === 'up' ? now : row.last_ok_at,
      error,
      detail,
      obs.metrics ? JSON.stringify(obs.metrics) : null,
      obs.reported ? now : row.reported_at,
      incidentId,
      c.id,
      row.rev,
    ],
  });
  return { stmts, notifications, events, next, incidentId };
}

async function lastIncident(id: string | null) {
  if (!id) return null;
  const r = (await getDb().prepare('SELECT id, state, resolved_at, started_at FROM status_incidents WHERE id = ?').get(id)) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  return { id: String(r.id), state: String(r.state), resolved_at: r.resolved_at == null ? null : num(r.resolved_at), started_at: num(r.started_at) };
}

/** Aplica una observación a un componente con reintento si otra escritura lo cambió en el medio. */
export async function observe(c: StatusComponent, obs: Observation, now: number, row?: ComponentRow): Promise<{ applied: boolean; row?: ComponentRow; notifications: Notification[] }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = row && attempt === 0 ? row : (await loadComponents()).get(c.id)!;
    const willOpen = step({ failStreak: current.fail_streak, okStreak: current.ok_streak, incident: current.severity }, obs.status).events.some((e) => e.type === 'open');
    const prev = willOpen ? await lastIncident(current.incident_id) : null;
    const plan = planObservation(c, current, obs, now, prev);
    const res = await dbBatch(plan.stmts);
    if (res[res.length - 1]?.changes === 1) {
      return {
        applied: true,
        row: {
          ...current,
          status: obs.status,
          fail_streak: plan.next.failStreak,
          ok_streak: plan.next.okStreak,
          severity: plan.next.incident,
          checked_at: now,
          reported_at: obs.reported ? now : current.reported_at,
          incident_id: plan.incidentId,
          rev: current.rev + 1,
        },
        notifications: plan.notifications,
      };
    }
  }
  return { applied: false, notifications: [] };
}

// ---------- Cron ----------

/** ¿Lo que reporta el watcher sigue vigente? null = nunca reportó (no se cuenta como caído). */
export function reportFreshness(row: ComponentRow, now: number): 'fresh' | 'stale' | 'never' {
  if (row.reported_at == null) return 'never';
  return now - row.reported_at > REPORT_STALE_MS ? 'stale' : 'fresh';
}

/** Lo que aporta un componente interno a su fila pública ahora (null = sin datos). */
export function publicContribution(c: StatusComponent, row: ComponentRow | undefined, now: number): ComponentStatus | null {
  if (!row || row.checked_at == null) return null;
  if (c.source === 'report' && reportFreshness(row, now) !== 'fresh') return null;
  if (c.source === 'cron' && now - row.checked_at > REPORT_STALE_MS) return null;
  const sev = row.severity;
  if (!sev || sev === 'unknown') return 'up';
  return visiblePublicly(c, sev) ? sev : 'up';
}

export function publicStatusOf(id: PublicComponentId, rows: Map<string, ComponentRow>, now: number): ComponentStatus {
  const list = STATUS_COMPONENTS.filter((c) => c.publicId === id)
    .map((c) => publicContribution(c, rows.get(c.id), now))
    .filter((s): s is ComponentStatus => s != null);
  return list.length ? worstStatus(list) : 'unknown';
}

/** [día UTC, minutos up, degraded, down] */
export type DayBucket = [number, number, number, number];

export function addMinute(days: DayBucket[], day: number, status: ComponentStatus): DayBucket[] {
  if (status === 'unknown') return days;
  const out = days.filter((d) => Array.isArray(d) && d[0] > day - PUBLIC_DAYS);
  let bucket = out.find((d) => d[0] === day);
  if (!bucket) {
    bucket = [day, 0, 0, 0];
    out.push(bucket);
    out.sort((a, b) => a[0] - b[0]);
  }
  bucket[status === 'up' ? 1 : status === 'degraded' ? 2 : 3] += 1;
  return out;
}

function parseDays(raw: unknown): DayBucket[] {
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? (v.filter((d) => Array.isArray(d) && d.length === 4) as DayBucket[]) : [];
  } catch {
    return [];
  }
}

export interface CronRunResult {
  skipped?: 'claimed' | 'db_unavailable';
  checks: Record<string, { status: string; ms: number }>;
  notifications: number;
}

/**
 * Lo llama /api/cron/minute. Reclama el minuto (compare-and-set en
 * status_meta: dos corridas superpuestas no chequean dos veces), corre los
 * chequeos, avanza la máquina de cada componente, marca "unknown" los que el
 * watcher dejó de reportar, guarda el minuto y manda los emails.
 *
 * Si la base no responde (Turso bloqueado por cuota, caído), no hay dónde
 * guardar: manda un email directo, con clave de idempotencia de Resend por
 * franja de 3 horas para no repetirlo cada minuto.
 */
export async function runStatusCron(opts: { now?: number; runChecks: () => Promise<Record<string, CheckResult>> }): Promise<CronRunResult> {
  const now = opts.now ?? Date.now();
  const minute = Math.floor(now / 60_000);
  let claimed: boolean;
  try {
    const r = await getDb().prepare('UPDATE status_meta SET last_minute = ?, last_run_at = ? WHERE id = 1 AND last_minute < ?').run(minute, now, minute);
    claimed = r.changes === 1;
  } catch (err) {
    const checks = await opts.runChecks();
    const { sendFallbackAlert } = await import('./notify');
    await sendFallbackAlert(redactSecrets(err), checks, now).catch(() => null);
    return { skipped: 'db_unavailable', checks: summarize(checks), notifications: 1 };
  }
  if (!claimed) return { skipped: 'claimed', checks: {}, notifications: 0 };

  const checks = await opts.runChecks();
  const rows = await loadComponents();
  const notifications: Notification[] = [];

  for (const c of STATUS_COMPONENTS) {
    const row = rows.get(c.id)!;
    let obs: Observation | null = null;
    if (c.source === 'cron') {
      const r = checks[c.id];
      if (r) obs = { status: r.status, error: r.error ?? null, detail: r.detail ?? null };
    } else if (reportFreshness(row, now) === 'stale') {
      obs = { status: 'unknown', error: `no report from the watcher since ${new Date(row.reported_at!).toISOString()}`, detail: row.detail };
    }
    if (!obs) continue;
    const res = await observe(c, obs, now, row).catch(() => ({ applied: false, notifications: [] as Notification[], row: undefined }));
    if (res.applied && res.row) rows.set(c.id, { ...row, ...res.row, checked_at: now, detail: obs.detail ?? row.detail });
    notifications.push(...res.notifications);
  }

  // Historial: un minuto por componente con datos, y los contadores por día de cada fila pública.
  const history: BatchStatement[] = [];
  for (const c of STATUS_COMPONENTS) {
    const row = rows.get(c.id)!;
    let status: ComponentStatus | null = null;
    if (c.source === 'cron') status = checks[c.id]?.status ?? null;
    else {
      const f = reportFreshness(row, now);
      status = f === 'fresh' ? row.status : f === 'stale' ? 'unknown' : null;
    }
    if (status) history.push({ sql: 'INSERT OR REPLACE INTO status_minutes (component, minute, status) VALUES (?, ?, ?)', args: [c.id, minute, STATUS_CODE[status]] });
  }
  const publicRows = (await getDb().prepare('SELECT id, days FROM status_public').all()) as Record<string, unknown>[];
  const day = Math.floor(now / 86_400_000);
  for (const id of PUBLIC_COMPONENTS) {
    const status = publicStatusOf(id, rows, now);
    if (status === 'unknown') continue;
    const days = addMinute(parseDays(publicRows.find((r) => r.id === id)?.days), day, status);
    history.push({
      sql: 'INSERT INTO status_public (id, days, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET days = excluded.days, updated_at = excluded.updated_at',
      args: [id, JSON.stringify(days), now],
    });
  }
  if (history.length) await dbBatch(history);

  // Una vez por hora: los minutos de más de 7 días pasan a horas; se borra lo de más de 90 días.
  if (minute % 60 === 7) await rollup(now).catch(() => null);

  const { deliver } = await import('./notify');
  let sent = 0;
  for (const n of notifications) if (await deliver(n, now).catch(() => false)) sent++;
  return { checks: summarize(checks), notifications: sent };
}

function summarize(checks: Record<string, CheckResult>) {
  return Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, { status: v.status, ms: v.ms }]));
}

export async function rollup(now: number): Promise<void> {
  const minuteNow = Math.floor(now / 60_000);
  const cutoff = Math.floor((minuteNow - MINUTES_KEEP_DAYS * 1440) / 60) * 60;
  const hourCutoff = Math.floor(now / 3_600_000) - HOURS_KEEP_DAYS * 24;
  const oldIncidents = now - HOURS_KEEP_DAYS * 86_400_000;
  await dbBatch([
    {
      sql: `INSERT INTO status_hours (component, hour, up, degraded, down, unknown)
            SELECT component, minute / 60, SUM(status = 0), SUM(status = 1), SUM(status = 2), SUM(status = 3)
            FROM status_minutes WHERE minute < ? GROUP BY component, minute / 60
            ON CONFLICT(component, hour) DO UPDATE SET up = up + excluded.up, degraded = degraded + excluded.degraded,
              down = down + excluded.down, unknown = unknown + excluded.unknown`,
      args: [cutoff],
    },
    { sql: 'DELETE FROM status_minutes WHERE minute < ?', args: [cutoff] },
    { sql: 'DELETE FROM status_hours WHERE hour < ?', args: [hourCutoff] },
    { sql: "DELETE FROM status_incident_notes WHERE incident_id IN (SELECT id FROM status_incidents WHERE state = 'resolved' AND resolved_at < ?)", args: [oldIncidents] },
    { sql: "DELETE FROM status_incidents WHERE state = 'resolved' AND resolved_at < ?", args: [oldIncidents] },
  ]);
}

// ---------- Reportes del watcher ----------

/** Umbrales propios del disco por si el watcher manda las métricas con un estado optimista. */
export function diskStatusFromMetrics(m: { volumeUsedMB?: number; volumeSizeMB?: number } | undefined): ComponentStatus | null {
  if (!m || !(Number(m.volumeSizeMB) > 0) || !(Number(m.volumeUsedMB) >= 0)) return null;
  const ratio = Number(m.volumeUsedMB) / Number(m.volumeSizeMB);
  if (ratio >= 0.97) return 'down';
  if (ratio >= 0.9) return 'degraded';
  return 'up';
}

export async function applyReport(input: {
  component: string;
  status: Exclude<ComponentStatus, 'unknown'>;
  detail?: string;
  metrics?: { volumeUsedMB?: number; volumeSizeMB?: number };
  now?: number;
}): Promise<{ ok: true; status: ComponentStatus; incidentId: string | null } | { ok: false; error: string }> {
  const c = componentById(input.component);
  if (!c || c.source !== 'report') return { ok: false, error: 'unknown_component' };
  const now = input.now ?? Date.now();
  const derived = diskStatusFromMetrics(input.metrics);
  const status = derived ? worstStatus([input.status, derived]) : input.status;
  let detail = input.detail ?? null;
  if (input.metrics && Number(input.metrics.volumeSizeMB) > 0) {
    const pct = Math.round((Number(input.metrics.volumeUsedMB) / Number(input.metrics.volumeSizeMB)) * 100);
    const usage = `${Math.round(Number(input.metrics.volumeUsedMB))} of ${Math.round(Number(input.metrics.volumeSizeMB))} MB used (${pct}%)`;
    detail = detail ? `${detail}; ${usage}` : usage;
  }
  const res = await observe(c, { status, error: detail ?? (status === 'up' ? null : `reported ${status}`), detail, metrics: input.metrics ?? null, reported: true }, now);
  if (!res.applied || !res.row) return { ok: false, error: 'conflict' };
  const { deliver } = await import('./notify');
  for (const n of res.notifications) await deliver(n, now).catch(() => false);
  return { ok: true, status, incidentId: res.row.severity ? res.row.incident_id : null };
}

// ---------- Lecturas (API del watcher y página) ----------

export interface IncidentNote {
  id: string;
  at: string;
  by: string;
  kind: string;
  text: string;
  public: boolean;
}

export interface IncidentDto {
  id: string;
  component: string;
  componentName: string;
  title: string;
  severity: string;
  state: 'open' | 'resolved';
  public: boolean;
  startedAt: string;
  lastFailureAt: string;
  resolvedAt: string | null;
  failures: number;
  lastError: string | null;
  notes: IncidentNote[];
}

const iso = (ms: unknown) => new Date(num(ms)).toISOString();

async function notesFor(ids: string[], onlyPublic: boolean): Promise<Map<string, IncidentNote[]>> {
  const out = new Map<string, IncidentNote[]>();
  if (!ids.length) return out;
  const rows = (await getDb()
    .prepare(`SELECT * FROM status_incident_notes WHERE incident_id IN (${ids.map(() => '?').join(',')})${onlyPublic ? ' AND is_public = 1' : ''} ORDER BY at ASC LIMIT 500`)
    .all(...ids)) as Record<string, unknown>[];
  for (const r of rows) {
    const list = out.get(String(r.incident_id)) ?? [];
    list.push({ id: String(r.id), at: iso(r.at), by: String(r.by), kind: String(r.kind), text: String(r.text ?? ''), public: num(r.is_public) === 1 });
    out.set(String(r.incident_id), list);
  }
  return out;
}

function toIncident(r: Record<string, unknown>, notes: IncidentNote[]): IncidentDto {
  return {
    id: String(r.id),
    component: String(r.component),
    componentName: componentById(String(r.component))?.label ?? String(r.component),
    title: String(r.title),
    severity: String(r.severity),
    state: String(r.state) === 'open' ? 'open' : 'resolved',
    public: num(r.is_public) === 1,
    startedAt: iso(r.started_at),
    lastFailureAt: iso(r.last_failure_at),
    resolvedAt: r.resolved_at == null ? null : iso(r.resolved_at),
    failures: num(r.failures),
    lastError: (r.last_error as string) ?? null,
    notes,
  };
}

export async function listIncidents(state: 'open' | 'resolved' | 'all', limit = 50): Promise<IncidentDto[]> {
  const where = state === 'all' ? '' : 'WHERE state = ?';
  const args = state === 'all' ? [] : [state];
  const rows = (await getDb()
    .prepare(`SELECT * FROM status_incidents ${where} ORDER BY started_at DESC LIMIT ?`)
    .all(...args, Math.max(1, Math.min(100, limit)))) as Record<string, unknown>[];
  const notes = await notesFor(rows.map((r) => String(r.id)), false);
  return rows.map((r) => toIncident(r, notes.get(String(r.id)) ?? []));
}

export async function addIncidentNote(input: { incidentId: string; by: 'watcher' | 'claude'; text: string; public: boolean; now?: number }): Promise<IncidentNote | null> {
  const exists = await getDb().prepare('SELECT id FROM status_incidents WHERE id = ?').get(input.incidentId);
  if (!exists) return null;
  const at = input.now ?? Date.now();
  // Lo público pasa por publicText (sin URLs, hosts, IPs, números largos ni secretos); lo interno solo sin secretos.
  const text = input.public ? publicText(input.text, 2000) : redactSecrets(input.text, 4000);
  const id = randomUUID();
  await getDb()
    .prepare("INSERT INTO status_incident_notes (id, incident_id, at, by, kind, text, is_public) VALUES (?, ?, ?, ?, 'note', ?, ?)")
    .run(id, input.incidentId, at, input.by, text, input.public ? 1 : 0);
  return { id, at: new Date(at).toISOString(), by: input.by, kind: 'note', text, public: input.public };
}

export async function statusSummary(now = Date.now()) {
  const meta = (await getDb().prepare('SELECT last_run_at FROM status_meta WHERE id = 1').get()) as Record<string, unknown> | undefined;
  const rows = await loadComponents();
  return {
    lastRunAt: meta?.last_run_at ? iso(meta.last_run_at) : null,
    components: STATUS_COMPONENTS.map((c) => {
      const r = rows.get(c.id)!;
      return {
        id: c.id,
        name: c.label,
        source: c.source,
        status: c.source === 'report' && reportFreshness(r, now) === 'stale' ? 'unknown' : r.status,
        incident: r.severity ? { id: r.incident_id, severity: r.severity } : null,
        checkedAt: r.checked_at ? iso(r.checked_at) : null,
        reportedAt: r.reported_at ? iso(r.reported_at) : null,
        lastOkAt: r.last_ok_at ? iso(r.last_ok_at) : null,
        lastError: r.last_error,
        detail: r.detail,
        metrics: r.metrics ? (JSON.parse(r.metrics) as unknown) : null,
      };
    }),
  };
}

// ---------- Página pública ----------

export interface PublicNote {
  at: string;
  kind: string;
  /** Solo en notas escritas a mano marcadas como públicas (ya pasaron por publicText). */
  text?: string;
}

export interface PublicIncident {
  id: string;
  publicId: PublicComponentId;
  severity: 'degraded' | 'down';
  state: 'open' | 'resolved';
  startedAt: string;
  resolvedAt: string | null;
  notes: PublicNote[];
}

export interface PublicStatus {
  generatedAt: string;
  components: Array<{ id: PublicComponentId; status: ComponentStatus; days: DayBucket[] }>;
  open: PublicIncident[];
  past: PublicIncident[];
}

/**
 * Lo único que ve la página pública: estados, contadores por día e incidentes
 * públicos con notas por tipo. Nunca el componente interno, el error, el
 * detalle ni las métricas.
 */
export async function publicStatus(now = Date.now()): Promise<PublicStatus> {
  const db = getDb();
  const [pubRows, compRows, incRows] = await Promise.all([
    db.prepare('SELECT id, days FROM status_public').all() as Promise<Record<string, unknown>[]>,
    db.prepare('SELECT * FROM status_components').all() as Promise<Record<string, unknown>[]>,
    db
      .prepare("SELECT id, public_id, severity, state, started_at, resolved_at FROM status_incidents WHERE is_public = 1 AND (state = 'open' OR resolved_at >= ?) ORDER BY started_at DESC LIMIT 30")
      .all(now - PUBLIC_DAYS * 86_400_000) as Promise<Record<string, unknown>[]>,
  ]);
  const rows = new Map(compRows.map((r) => [String(r.id), toRow(r)]));
  const notes = await notesFor(incRows.map((r) => String(r.id)), true);
  const incidents: PublicIncident[] = incRows.map((r) => ({
    id: String(r.id),
    publicId: String(r.public_id) as PublicComponentId,
    severity: String(r.severity) === 'down' ? 'down' : 'degraded',
    state: String(r.state) === 'open' ? 'open' : 'resolved',
    startedAt: iso(r.started_at),
    resolvedAt: r.resolved_at == null ? null : iso(r.resolved_at),
    notes: (notes.get(String(r.id)) ?? []).map((n) => (n.kind === 'note' ? { at: n.at, kind: n.kind, text: n.text } : { at: n.at, kind: n.kind })),
  }));
  return {
    generatedAt: new Date(now).toISOString(),
    components: PUBLIC_COMPONENTS.map((id) => ({
      id,
      status: publicStatusOf(id, rows, now),
      days: parseDays(pubRows.find((r) => r.id === id)?.days),
    })),
    open: incidents.filter((i) => i.state === 'open'),
    past: incidents.filter((i) => i.state === 'resolved').slice(0, 20),
  };
}
