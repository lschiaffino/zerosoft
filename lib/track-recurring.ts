/**
 * Track — issues que se repiten (diario, semanal, mensual o anual, cada N).
 *
 * Cada regla guarda la próxima fecha (next_run_on, día local de su zona
 * horaria). El tick horario crea el issue cuando llega ese día: primero
 * reclama la regla con un compare-and-set de next_run_on (dos ticks a la vez
 * no crean dos issues) y después crea el issue a nombre de quien armó la
 * regla, con origen 'recurring' (no pasa por triage). Si el tick estuvo
 * parado, se crea uno solo y la próxima fecha salta al futuro.
 */
import { getDb } from './db';
import type { TrackProjectRow, TrackRecurringIssueRow } from './db';
import { createIssue, getProject } from './track-data';
import { validateIssueRefs } from './track-bulk';
import { normalizeIssueLabels, parseIssueLabels, projectWorkspaceId } from './track-labels';
import { firstRunOn, localDayIn, nextRunAfter, safeTimeZone } from './track-recurrence';
import { addDays } from './track-tasks';
import type { RecurringCreatePayload, RecurringUpdatePayload } from './track-schema';

function nowIso(): string {
  return new Date().toISOString();
}

export async function listRecurring(projectId: string): Promise<TrackRecurringIssueRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM track_recurring_issues WHERE project_id = ? ORDER BY active DESC, next_run_on ASC, created_at ASC')
    .all(projectId)) as TrackRecurringIssueRow[];
}

export async function getRecurring(id: string): Promise<TrackRecurringIssueRow | undefined> {
  return (await getDb().prepare('SELECT * FROM track_recurring_issues WHERE id = ?').get(id)) as
    | TrackRecurringIssueRow
    | undefined;
}

async function labelsJson(project: TrackProjectRow, labels: RecurringCreatePayload['labels']): Promise<string> {
  const ws = projectWorkspaceId(project);
  if (!labels || !ws) return '[]';
  return JSON.stringify(await normalizeIssueLabels(ws, labels));
}

export async function createRecurring(
  project: TrackProjectRow,
  creatorId: string,
  payload: RecurringCreatePayload,
  now = new Date(),
): Promise<TrackRecurringIssueRow> {
  const id = crypto.randomUUID();
  const ts = now.toISOString();
  const timezone = safeTimeZone(payload.timezone);
  const every = payload.every ?? 1;
  const next = firstRunOn(payload.startOn, localDayIn(timezone, now), payload.frequency, every);
  await getDb()
    .prepare(
      `INSERT INTO track_recurring_issues (id, project_id, creator_id, title, description, status_id, priority, assignee_id, labels,
         frequency, every, start_on, next_run_on, due_days, timezone, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      project.id,
      creatorId,
      payload.title.trim(),
      payload.description?.trim() ?? '',
      payload.statusId ?? null,
      payload.priority ?? 'medium',
      payload.assigneeId ?? null,
      await labelsJson(project, payload.labels),
      payload.frequency,
      every,
      payload.startOn,
      next,
      payload.dueDays ?? null,
      timezone,
      payload.active === false ? 0 : 1,
      ts,
      ts,
    );
  return (await getRecurring(id)) as TrackRecurringIssueRow;
}

export async function updateRecurring(
  project: TrackProjectRow,
  existing: TrackRecurringIssueRow,
  payload: RecurringUpdatePayload,
  now = new Date(),
): Promise<TrackRecurringIssueRow | undefined> {
  const fields: string[] = [];
  const args: Array<string | number | null> = [];
  const set = (column: string, value: string | number | null) => {
    fields.push(`${column} = ?`);
    args.push(value);
  };
  if (payload.title !== undefined) set('title', payload.title.trim());
  if (payload.description !== undefined) set('description', payload.description.trim());
  if (payload.statusId !== undefined) set('status_id', payload.statusId ?? null);
  if (payload.priority !== undefined) set('priority', payload.priority);
  if (payload.assigneeId !== undefined) set('assignee_id', payload.assigneeId ?? null);
  if (payload.labels !== undefined) set('labels', await labelsJson(project, payload.labels));
  if (payload.dueDays !== undefined) set('due_days', payload.dueDays ?? null);
  if (payload.active !== undefined) set('active', payload.active ? 1 : 0);
  const timezone = payload.timezone !== undefined ? safeTimeZone(payload.timezone) : existing.timezone;
  if (payload.timezone !== undefined) set('timezone', timezone);
  // Cambió la regla (o se reactivó): la próxima fecha se recalcula desde hoy.
  // Mandar los mismos valores (el formulario manda todo) no la toca: si ya
  // corrió hoy, no se vuelve a crear.
  const scheduleChanged =
    (payload.frequency !== undefined && payload.frequency !== existing.frequency) ||
    (payload.every !== undefined && payload.every !== existing.every) ||
    (payload.startOn !== undefined && payload.startOn !== existing.start_on) ||
    (payload.active === true && !existing.active);
  if (payload.frequency !== undefined) set('frequency', payload.frequency);
  if (payload.every !== undefined) set('every', payload.every);
  if (payload.startOn !== undefined) set('start_on', payload.startOn);
  if (scheduleChanged) {
    const startOn = payload.startOn ?? existing.start_on;
    const frequency = payload.frequency ?? existing.frequency;
    const every = payload.every ?? existing.every;
    let next = firstRunOn(startOn, localDayIn(timezone, now), frequency, every);
    // Si ya corrió ese día (pausar y reanudar en el mismo día), no se repite.
    const lastDay = existing.last_run_at ? localDayIn(timezone, new Date(existing.last_run_at)) : null;
    if (lastDay && next <= lastDay) next = nextRunAfter(next, lastDay, frequency, every, startOn);
    set('next_run_on', next);
  }
  if (fields.length > 0) {
    set('updated_at', now.toISOString());
    args.push(existing.id);
    await getDb().prepare(`UPDATE track_recurring_issues SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }
  return getRecurring(existing.id);
}

export async function deleteRecurring(projectId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_recurring_issues WHERE id = ? AND project_id = ?').run(id, projectId);
  return res.changes > 0;
}

/**
 * Crea los issues de las reglas que vencieron. Devuelve cuántos se crearon.
 * Las reglas de proyectos archivados avanzan sin crear nada.
 */
export async function runRecurringIssues(opts: { now?: Date; limit?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const db = getDb();
  // El día local de cada regla puede ir hasta un día adelante del UTC.
  const horizon = addDays(now.toISOString().slice(0, 10), 1);
  const rows = (await db
    .prepare('SELECT * FROM track_recurring_issues WHERE active = 1 AND next_run_on <= ? ORDER BY next_run_on ASC LIMIT ?')
    .all(horizon, Math.min(Math.max(opts.limit ?? 200, 1), 1000))) as TrackRecurringIssueRow[];
  let created = 0;
  for (const rule of rows) {
    const today = localDayIn(rule.timezone, now);
    if (rule.next_run_on > today) continue;
    const runDay = rule.next_run_on;
    const next = nextRunAfter(runDay, today, rule.frequency, rule.every, rule.start_on);
    const claimed = await db
      .prepare(
        'UPDATE track_recurring_issues SET next_run_on = ?, last_run_at = ?, updated_at = ? WHERE id = ? AND next_run_on = ? AND active = 1',
      )
      .run(next, now.toISOString(), nowIso(), rule.id, runDay);
    if (!claimed.changes) continue;
    try {
      const project = await getProject(rule.project_id);
      if (!project || project.status !== 'active') continue;
      // Si el asignado o el status ya no son válidos, el issue sale sin ellos.
      const ownerId = project.owner_id ?? rule.creator_id;
      const assigneeOk =
        !rule.assignee_id || !(await validateIssueRefs(project, { assigneeId: rule.assignee_id }, { ownerId }));
      const statusOk = !rule.status_id || !(await validateIssueRefs(project, { statusId: rule.status_id }, { ownerId }));
      const issue = await createIssue(
        project.id,
        rule.creator_id,
        {
          title: rule.title,
          description: rule.description ? [{ type: 'text', text: rule.description }] : [],
          statusId: statusOk ? rule.status_id : null,
          priority: rule.priority,
          assigneeId: assigneeOk ? rule.assignee_id : null,
          dueDate: rule.due_days != null ? addDays(today, rule.due_days) : null,
          labels: parseIssueLabels(rule.labels).map((l) => ({ id: l.id })),
        },
        { source: 'recurring' },
      );
      await db.prepare('UPDATE track_recurring_issues SET last_issue_id = ? WHERE id = ?').run(issue.id, rule.id);
      created++;
    } catch {
      // La regla ya avanzó: un error puntual no la deja trabada creando de más.
    }
  }
  return created;
}
