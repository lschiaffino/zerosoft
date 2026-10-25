/**
 * Track — SLAs por prioridad (como Linear: urgente 24 h, alta 1 semana por
 * defecto, configurable por proyecto en sus ajustes de triage).
 *
 * Cada issue abierto con una prioridad que tiene plazo lleva una fila en
 * track_issue_slas (inicio, en riesgo, vencimiento). syncIssueSla la mantiene
 * al crear y al editar (createIssue / updateIssue); al cerrar el issue queda
 * con completed_at y se ve si se cumplió. El cron de cada minuto avisa a los
 * suscriptos cuando pasa a "en riesgo" y cuando vence (claim por fila con
 * compare-and-set de risk_notified_at / breach_notified_at).
 * Server-only.
 */
import { getDb } from './db';
import { createNotification } from './notifications';
import { getTriageSettings } from './track-triage';
import { slaRiskAt, slaState, type IssueSla, type SlaState, type TrackPriority } from './track-triage-shared';

interface SlaRow {
  issue_id: string;
  priority: string;
  started_at: string;
  risk_at: string;
  due_at: string;
  completed_at: string | null;
  risk_notified_at: string | null;
  breach_notified_at: string | null;
}

export interface IssueSlaDto extends IssueSla {
  state: SlaState;
}

function toDto(row: SlaRow, now = new Date()): IssueSlaDto {
  const sla: IssueSla = {
    priority: row.priority,
    startedAt: row.started_at,
    riskAt: row.risk_at,
    dueAt: row.due_at,
    completedAt: row.completed_at,
  };
  return { ...sla, state: slaState(sla, now) };
}

export async function getIssueSla(issueId: string): Promise<IssueSlaDto | null> {
  const row = (await getDb().prepare('SELECT * FROM track_issue_slas WHERE issue_id = ?').get(issueId)) as SlaRow | undefined;
  return row ? toDto(row) : null;
}

/** SLAs de varios issues (listas). */
export async function getIssueSlas(issueIds: string[]): Promise<Map<string, IssueSlaDto>> {
  const out = new Map<string, IssueSlaDto>();
  if (issueIds.length === 0) return out;
  const db = getDb();
  for (let i = 0; i < issueIds.length; i += 200) {
    const chunk = issueIds.slice(i, i + 200);
    const rows = (await db
      .prepare(`SELECT * FROM track_issue_slas WHERE issue_id IN (${chunk.map(() => '?').join(', ')})`)
      .all(...chunk)) as SlaRow[];
    const now = new Date();
    for (const r of rows) out.set(r.issue_id, toDto(r, now));
  }
  return out;
}

/**
 * Recalcula el SLA de un issue según su prioridad, su estado y los ajustes del
 * proyecto:
 * - cerrado (done/cancelled): fija completed_at si había SLA;
 * - reabierto: vuelve a correr desde el inicio original;
 * - sin plazo para su prioridad (o SLAs apagados): se quita si estaba abierto;
 * - con plazo: lo crea (arranca ahora) o, si cambió la prioridad, recalcula
 *   el vencimiento desde el mismo inicio.
 */
export async function syncIssueSla(issueId: string, now = new Date()): Promise<IssueSlaDto | null> {
  const db = getDb();
  const issue = (await db
    .prepare(
      `SELECT i.id, i.project_id, i.priority, s.category AS status_category
       FROM track_issues i LEFT JOIN track_statuses s ON s.id = i.status_id WHERE i.id = ?`,
    )
    .get(issueId)) as { id: string; project_id: string; priority: TrackPriority; status_category: string | null } | undefined;
  if (!issue) return null;
  const existing = (await db.prepare('SELECT * FROM track_issue_slas WHERE issue_id = ?').get(issueId)) as SlaRow | undefined;
  const closed = issue.status_category === 'done' || issue.status_category === 'cancelled';
  const nowIso = now.toISOString();

  if (closed) {
    if (existing && !existing.completed_at) {
      await db.prepare('UPDATE track_issue_slas SET completed_at = ? WHERE issue_id = ? AND completed_at IS NULL').run(nowIso, issueId);
    }
    return getIssueSla(issueId);
  }

  const settings = await getTriageSettings(issue.project_id);
  const hours = settings.slaEnabled ? settings.slaHours[issue.priority] : null;
  if (!hours) {
    // Sin plazo para esta prioridad: un SLA ya cumplido o fallado queda como historia.
    if (existing && !existing.completed_at) await db.prepare('DELETE FROM track_issue_slas WHERE issue_id = ?').run(issueId);
    return existing?.completed_at ? toDto(existing, now) : null;
  }

  const started = existing ? new Date(existing.started_at) : now;
  const dueAt = new Date(started.getTime() + hours * 3_600_000).toISOString();
  const riskAt = slaRiskAt(started, hours).toISOString();
  if (!existing) {
    await db
      .prepare(
        `INSERT INTO track_issue_slas (issue_id, priority, started_at, risk_at, due_at, completed_at) VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(issue_id) DO NOTHING`,
      )
      .run(issueId, issue.priority, started.toISOString(), riskAt, dueAt);
  } else if (existing.completed_at) {
    // Reabierto: el reloj sigue desde el inicio original (un SLA fallado no se borra reabriendo).
    await db
      .prepare('UPDATE track_issue_slas SET completed_at = NULL, priority = ?, risk_at = ?, due_at = ? WHERE issue_id = ?')
      .run(issue.priority, riskAt, dueAt, issueId);
  } else if (existing.priority !== issue.priority || existing.due_at !== dueAt) {
    // Nueva prioridad o nueva duración: los avisos vuelven a correr si el nuevo plazo está más lejos.
    const resetRisk = riskAt > nowIso ? ', risk_notified_at = NULL' : '';
    const resetBreach = dueAt > nowIso ? ', breach_notified_at = NULL' : '';
    await db
      .prepare(`UPDATE track_issue_slas SET priority = ?, risk_at = ?, due_at = ?${resetRisk}${resetBreach} WHERE issue_id = ?`)
      .run(issue.priority, riskAt, dueAt, issueId);
  }
  return getIssueSla(issueId);
}

/** Tras cambiar la configuración: recalcula los issues abiertos del proyecto. */
export async function resyncProjectSlas(projectId: string): Promise<number> {
  const rows = (await getDb()
    .prepare(
      `SELECT i.id FROM track_issues i LEFT JOIN track_statuses s ON s.id = i.status_id
       WHERE i.project_id = ? AND (s.category IS NULL OR s.category NOT IN ('done', 'cancelled'))
       ORDER BY i.created_at DESC LIMIT 2000`,
    )
    .all(projectId)) as Array<{ id: string }>;
  for (const r of rows) await syncIssueSla(r.id);
  return rows.length;
}

async function slaRecipients(issueId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT user_id FROM track_issue_subscriptions WHERE issue_id = ? AND subscribed = 1
       UNION SELECT assignee_id AS user_id FROM track_issues WHERE id = ? AND assignee_id IS NOT NULL`,
    )
    .all(issueId, issueId)
    .catch(() => [] as Array<{ user_id: string }>)) as Array<{ user_id: string }>;
  return [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
}

/**
 * Cron: avisa "en riesgo" y "vencido" una sola vez por SLA. Cada fila se
 * reclama con compare-and-set antes de notificar, así dos corridas en paralelo
 * no mandan el aviso dos veces.
 */
export async function runSlaChecks(opts: { now?: Date; limit?: number } = {}): Promise<{ risk: number; breach: number }> {
  const db = getDb();
  const now = (opts.now ?? new Date()).toISOString();
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const due = (await db
    .prepare(
      `SELECT s.*, i.identifier, i.title, p.name AS project_name
       FROM track_issue_slas s JOIN track_issues i ON i.id = s.issue_id JOIN track_projects p ON p.id = i.project_id
       WHERE s.completed_at IS NULL AND (
         (s.risk_notified_at IS NULL AND s.risk_at <= ?) OR (s.breach_notified_at IS NULL AND s.due_at <= ?)
       )
       ORDER BY s.risk_at ASC LIMIT ?`,
    )
    .all(now, now, limit)) as Array<SlaRow & { identifier: string; title: string; project_name: string }>;
  let risk = 0;
  let breach = 0;
  for (const r of due) {
    const breached = r.due_at <= now;
    const kind = breached ? 'sla_breach' : 'sla_risk';
    // Si ya venció sin haber avisado el riesgo, se marca también el riesgo (un solo aviso: vencido).
    const claim = breached
      ? await db
          .prepare(
            'UPDATE track_issue_slas SET breach_notified_at = ?, risk_notified_at = COALESCE(risk_notified_at, ?) WHERE issue_id = ? AND breach_notified_at IS NULL AND completed_at IS NULL',
          )
          .run(now, now, r.issue_id)
      : await db
          .prepare('UPDATE track_issue_slas SET risk_notified_at = ? WHERE issue_id = ? AND risk_notified_at IS NULL AND completed_at IS NULL')
          .run(now, r.issue_id);
    if (!claim.changes) continue;
    if (breached) breach++;
    else risk++;
    for (const userId of await slaRecipients(r.issue_id)) {
      await createNotification({
        userId,
        type: 'issue_update',
        title: breached ? `SLA breached: ${r.identifier}` : `SLA at risk: ${r.identifier}`,
        body: r.title,
        href: `/app/track/issues/${r.issue_id}`,
        sourceType: 'track_sla',
        sourceId: r.issue_id,
        meta: { issueIdentifier: r.identifier, projectName: r.project_name, kind, dueAt: r.due_at },
      }).catch(() => undefined);
    }
  }
  return { risk, breach };
}
