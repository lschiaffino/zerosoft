/**
 * Alertas sobre insights de tendencias. El cron de cada hora reclama las que
 * vencieron (compare-and-set), mira el último intervalo cerrado y avisa solo
 * al pasar de "bien" a "disparada", así una alerta sostenida no repite el
 * aviso. Se avisa por notificación dentro de la app, a quienes siguen teniendo
 * acceso a Analytics en el workspace. Server-only.
 */
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDb } from '../db';
import { createNotification } from '../notifications';
import { localized } from '../notification-copy';
import { listOwnerSpacePeople } from '../workspace';
import { getInsight } from './records';
import { runTrends } from './query';
import type { ProjectRow } from './projects';
import type { AlertDto, AlertInput, TrendsQuery } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CLAIM_MS = 10 * 60_000;
export const ALERTS_PER_PROJECT = 50;

interface AlertRow {
  id: string;
  project_id: string;
  insight_id: string;
  insight_name?: string;
  name: string;
  series_index: number;
  condition: string;
  threshold: number;
  frequency: string;
  enabled: number;
  subscribers: string;
  state: string;
  last_value: number | null;
  last_checked_at: number | null;
  last_fired_at: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toDto(r: AlertRow): AlertDto {
  let subs: string[] = [];
  try {
    subs = z.array(z.string()).parse(JSON.parse(r.subscribers));
  } catch {
    subs = [];
  }
  return {
    id: r.id,
    name: r.name,
    insightId: r.insight_id,
    insightName: r.insight_name ?? '',
    seriesIndex: Number(r.series_index),
    condition: r.condition as AlertDto['condition'],
    threshold: Number(r.threshold),
    frequency: r.frequency as AlertDto['frequency'],
    enabled: Number(r.enabled) === 1,
    subscribers: subs,
    state: r.state as AlertDto['state'],
    lastValue: r.last_value === null ? null : Number(r.last_value),
    lastCheckedAt: r.last_checked_at === null ? null : Number(r.last_checked_at),
    lastFiredAt: r.last_fired_at === null ? null : Number(r.last_fired_at),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SELECT = `SELECT a.*, i.name AS insight_name FROM analytics_alerts a JOIN analytics_insights i ON i.id = a.insight_id`;

export async function listAlerts(projectId: string, insightId?: string): Promise<AlertDto[]> {
  const rows = insightId
    ? await getDb().prepare(`${SELECT} WHERE a.project_id = ? AND a.insight_id = ? ORDER BY a.updated_at DESC LIMIT 100`).all(projectId, insightId)
    : await getDb().prepare(`${SELECT} WHERE a.project_id = ? ORDER BY a.updated_at DESC LIMIT 200`).all(projectId);
  return (rows as unknown as AlertRow[]).map(toDto);
}

export async function getAlert(projectId: string, id: string): Promise<AlertDto | null> {
  const r = (await getDb().prepare(`${SELECT} WHERE a.id = ? AND a.project_id = ?`).get(id, projectId)) as AlertRow | undefined;
  return r ? toDto(r) : null;
}

export async function createAlert(projectId: string, personId: string, input: AlertInput): Promise<AlertDto | 'too_many' | 'insight_not_found'> {
  const insight = await getInsight(projectId, input.insightId);
  if (!insight || insight.query.kind !== 'trends') return 'insight_not_found';
  const n = (await getDb().prepare('SELECT COUNT(*) AS n FROM analytics_alerts WHERE project_id = ?').get(projectId)) as { n: number };
  if (Number(n.n) >= ALERTS_PER_PROJECT) return 'too_many';
  const id = `al_${nanoid(12)}`;
  const ts = new Date().toISOString();
  const subs = input.subscribers.length ? input.subscribers : [personId];
  await getDb()
    .prepare(
      `INSERT INTO analytics_alerts (id, project_id, insight_id, name, series_index, condition, threshold, frequency, enabled, subscribers, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, projectId, input.insightId, input.name, input.seriesIndex, input.condition, input.threshold, input.frequency, input.enabled ? 1 : 0, JSON.stringify(subs), personId, ts, ts);
  return (await getAlert(projectId, id))!;
}

export async function updateAlert(projectId: string, id: string, patch: Partial<AlertInput>): Promise<AlertDto | null> {
  const cur = await getAlert(projectId, id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  // Cambiar la condición vuelve a evaluar y olvida el estado anterior.
  const reset = patch.condition !== undefined || patch.threshold !== undefined || patch.seriesIndex !== undefined || patch.frequency !== undefined;
  await getDb()
    .prepare(
      `UPDATE analytics_alerts SET name = ?, series_index = ?, condition = ?, threshold = ?, frequency = ?, enabled = ?, subscribers = ?, updated_at = ?${reset ? ", state = 'ok', next_check_at = 0" : ''}
       WHERE id = ? AND project_id = ?`,
    )
    .run(next.name, next.seriesIndex, next.condition, next.threshold, next.frequency, next.enabled ? 1 : 0, JSON.stringify(next.subscribers), new Date().toISOString(), id, projectId);
  return getAlert(projectId, id);
}

export async function deleteAlert(projectId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM analytics_alerts WHERE id = ? AND project_id = ?').run(id, projectId);
  return res.changes > 0;
}

/** ¿El valor dispara la alerta? Los porcentajes comparan con el intervalo anterior; sin base no disparan. */
export function alertFires(condition: AlertDto['condition'], threshold: number, value: number, previous: number | null): boolean {
  switch (condition) {
    case 'above':
      return value > threshold;
    case 'below':
      return value < threshold;
    case 'increase_pct':
      return previous !== null && previous > 0 && ((value - previous) / previous) * 100 > threshold;
    case 'decrease_pct':
      return previous !== null && previous > 0 && ((previous - value) / previous) * 100 > threshold;
  }
}

/** Valor del último intervalo cerrado y el anterior. El intervalo en curso no cuenta: va por la mitad y dispararía solo. */
export async function alertValues(project: ProjectRow, query: TrendsQuery, seriesIndex: number, frequency: 'hourly' | 'daily', now: number): Promise<{ value: number; previous: number | null } | null> {
  const interval = frequency === 'hourly' ? 'hour' : 'day';
  const q: TrendsQuery = { ...query, interval, compare: false, breakdown: null, breakdownsMore: [], breakdownCohorts: null, dateRange: { from: frequency === 'hourly' ? '-4h' : '-4d' } };
  const res = await runTrends(project, q, now);
  const s = res.series[seriesIndex] ?? res.series[0];
  if (!s || s.data.length < 2) return null;
  const closed = s.data.slice(0, -1);
  return { value: closed[closed.length - 1], previous: closed.length >= 2 ? closed[closed.length - 2] : null };
}

export interface AlertsCronResult {
  checked: number;
  fired: number;
}

/**
 * Corre las alertas vencidas. Tope de tiempo propio y de alertas por proyecto
 * en cada corrida, así un proyecto con muchas no deja sin turno a los demás ni
 * se come el presupuesto del resto del cron.
 */
export async function runAlertsCron(opts: { budgetMs?: number; now?: number } = {}): Promise<AlertsCronResult> {
  const started = Date.now();
  const now = opts.now ?? Date.now();
  const budget = opts.budgetMs ?? 8000;
  const db = getDb();
  const out: AlertsCronResult = { checked: 0, fired: 0 };
  const due = (await db
    .prepare(
      `SELECT a.*, p.workspace_id AS workspace_id FROM analytics_alerts a JOIN analytics_projects p ON p.id = a.project_id
       WHERE a.enabled = 1 AND a.next_check_at <= ? AND (a.claimed_at IS NULL OR a.claimed_at < ?) AND p.deleted_at IS NULL
       ORDER BY a.next_check_at LIMIT 200`,
    )
    .all(now, now - CLAIM_MS)) as unknown as Array<AlertRow & { workspace_id: string }>;
  const perProject = new Map<string, number>();
  for (const a of due) {
    if (Date.now() - started > budget) break;
    const n = perProject.get(a.project_id) ?? 0;
    if (n >= 10) continue;
    perProject.set(a.project_id, n + 1);
    const claim = await db.prepare('UPDATE analytics_alerts SET claimed_at = ? WHERE id = ? AND enabled = 1 AND (claimed_at IS NULL OR claimed_at < ?)').run(now, a.id, now - CLAIM_MS);
    if (claim.changes !== 1) continue;
    const every = a.frequency === 'hourly' ? HOUR : DAY;
    try {
      const fired = await checkAlert(a, now);
      out.checked++;
      if (fired) out.fired++;
    } catch (err) {
      console.error('[analytics alerts]', a.id, err instanceof Error ? err.message : 'error');
      await db.prepare("UPDATE analytics_alerts SET state = 'error', last_checked_at = ? WHERE id = ?").run(now, a.id);
    } finally {
      await db.prepare('UPDATE analytics_alerts SET claimed_at = NULL, next_check_at = ? WHERE id = ?').run(now + every, a.id);
    }
  }
  return out;
}

async function checkAlert(a: AlertRow & { workspace_id: string }, now: number): Promise<boolean> {
  const db = getDb();
  const project = (await db.prepare('SELECT * FROM analytics_projects WHERE id = ? AND deleted_at IS NULL').get(a.project_id)) as ProjectRow | undefined;
  if (!project) return false;
  const insight = await getInsight(project.id, a.insight_id);
  if (!insight || insight.query.kind !== 'trends') return false;
  const v = await alertValues(project, insight.query, Number(a.series_index), a.frequency === 'hourly' ? 'hourly' : 'daily', now);
  if (!v) return false;
  const firing = alertFires(a.condition as AlertDto['condition'], Number(a.threshold), v.value, v.previous);
  const wasFiring = a.state === 'firing';
  await db
    .prepare(`UPDATE analytics_alerts SET state = ?, last_value = ?, last_checked_at = ?${firing && !wasFiring ? ', last_fired_at = ?' : ''} WHERE id = ?`)
    .run(...(firing && !wasFiring ? [firing ? 'firing' : 'ok', v.value, now, now, a.id] : [firing ? 'firing' : 'ok', v.value, now, a.id]));
  if (!firing || wasFiring) return false;
  // Solo quienes hoy tienen la app en este workspace (alguien pudo perder el acceso desde que se suscribió).
  let subs: string[] = [];
  try {
    subs = z.array(z.string()).parse(JSON.parse(a.subscribers));
  } catch {
    subs = [];
  }
  const allowed = new Set((await listOwnerSpacePeople(a.workspace_id, { app: 'analytics' })).map((p) => p.id));
  for (const userId of subs) {
    if (!allowed.has(userId)) continue;
    await createNotification({
      userId,
      type: 'analytics_alert',
      title: localized('analyticsAlertTitle', { name: a.name }),
      body: localized('analyticsAlertBody', { value: String(v.value), insight: insight.name }),
      href: `/app/analytics/insights/${insight.id}`,
      sourceType: 'analytics_alert',
      sourceId: a.id,
    });
  }
  return true;
}
