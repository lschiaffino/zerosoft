/**
 * Track — updates de plans (los "project updates" de Linear): salud (on track,
 * at risk, off track) y texto, con el progreso del momento. Avisan en el
 * Inbox a lead, miembros y seguidores; solo el autor edita o borra. El tick
 * horario recuerda al lead que escriba el update (claim por compare-and-set
 * sobre next_reminder_at).
 */
import { getDb } from './db';
import { createNotification } from './notifications';
import { getPlan, listPlans, planRecipients, scheduleReminder, type TrackPlanRow, type WorkspaceScope } from './track-plans';
import { cadenceDays, computeProgress, type StatusCategory } from './track-planning-core';
import type { PlanHealth } from './track-planning-schema';

export interface PlanUpdate {
  id: string;
  plan_id: string;
  user_id: string;
  user_name: string | null;
  user_email: string;
  health: PlanHealth;
  body: string;
  progress: number | null;
  meta: string;
  created_at: string;
  updated_at: string | null;
  comment_count: number;
}

export interface PlanUpdateComment {
  id: string;
  update_id: string;
  user_id: string;
  user_name: string | null;
  user_email: string;
  body: string;
  created_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function planProgress(planId: string): Promise<number> {
  const rows = (await getDb()
    .prepare(
      `SELECT s.category, i.estimate FROM track_issues i LEFT JOIN track_statuses s ON s.id = i.status_id
       WHERE i.plan_id = ? AND i.triage = 0`,
    )
    .all(planId)) as Array<{ category: StatusCategory | null; estimate: number | null }>;
  return computeProgress(rows).percent;
}

export async function listPlanUpdates(planId: string): Promise<PlanUpdate[]> {
  return (await getDb()
    .prepare(
      `SELECT x.*, u.name AS user_name, u.email AS user_email,
         (SELECT COUNT(*) FROM track_plan_update_comments c WHERE c.update_id = x.id) AS comment_count
       FROM track_plan_updates x JOIN users u ON u.id = x.user_id
       WHERE x.plan_id = ? ORDER BY x.created_at DESC LIMIT 200`,
    )
    .all(planId)) as PlanUpdate[];
}

export async function getPlanUpdate(id: string): Promise<(PlanUpdate & { plan: TrackPlanRow }) | undefined> {
  const row = (await getDb()
    .prepare(
      `SELECT x.*, u.name AS user_name, u.email AS user_email, 0 AS comment_count
       FROM track_plan_updates x JOIN users u ON u.id = x.user_id WHERE x.id = ?`,
    )
    .get(id)) as PlanUpdate | undefined;
  if (!row) return undefined;
  const plan = await getPlan(row.plan_id);
  return plan ? { ...row, plan } : undefined;
}

async function actorName(userId: string): Promise<string> {
  const u = (await getDb().prepare('SELECT name, email FROM users WHERE id = ?').get(userId)) as
    | { name: string | null; email: string }
    | undefined;
  return u?.name || u?.email || 'Someone';
}

/**
 * Publica un update: guarda el progreso actual (y cuánto cambió desde el
 * anterior), reprograma el recordatorio y avisa a lead, miembros y seguidores.
 */
export async function createPlanUpdate(
  plan: TrackPlanRow,
  userId: string,
  payload: { health: PlanHealth; body: string },
): Promise<PlanUpdate> {
  const db = getDb();
  const progress = await planProgress(plan.id);
  const prev = (await db
    .prepare('SELECT progress, created_at FROM track_plan_updates WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(plan.id)) as { progress: number | null; created_at: string } | undefined;
  const targetChanged = prev
    ? ((await db
        .prepare("SELECT meta FROM track_plan_events WHERE plan_id = ? AND type = 'target_date' AND created_at > ? ORDER BY created_at DESC LIMIT 1")
        .get(plan.id, prev.created_at)) as { meta: string } | undefined)
    : undefined;
  const meta = {
    previousProgress: prev?.progress ?? null,
    targetDate: plan.target_date,
    targetChangedFrom: targetChanged ? (JSON.parse(targetChanged.meta) as { from: string | null }).from : undefined,
  };
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare('INSERT INTO track_plan_updates (id, plan_id, user_id, health, body, progress, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, plan.id, userId, payload.health, payload.body, progress, JSON.stringify(meta), now);
  await db.prepare('UPDATE track_plans SET updated_at = ? WHERE id = ?').run(now, plan.id);
  await scheduleReminder(plan.id, new Date());
  const name = await actorName(userId);
  for (const r of await planRecipients(plan.id)) {
    if (r === userId) continue;
    await createNotification({
      userId: r,
      type: 'project_update',
      title: `${name} posted an update on ${plan.name}`,
      body: payload.body.slice(0, 280),
      href: `/app/track/plans/${plan.id}?tab=updates`,
      sourceType: 'track_plan',
      sourceId: plan.id,
      meta: { planName: plan.name, actorName: name, actorId: userId, health: payload.health, kind: 'update' },
    }).catch(() => undefined);
  }
  return (await listPlanUpdates(plan.id)).find((u) => u.id === id) as PlanUpdate;
}

export async function editPlanUpdate(id: string, payload: { health?: PlanHealth; body?: string }): Promise<void> {
  const fields: string[] = [];
  const args: Array<string | null> = [];
  if (payload.health !== undefined) {
    fields.push('health = ?');
    args.push(payload.health);
  }
  if (payload.body !== undefined) {
    fields.push('body = ?');
    args.push(payload.body);
  }
  if (!fields.length) return;
  fields.push('updated_at = ?');
  args.push(nowIso());
  await getDb().prepare(`UPDATE track_plan_updates SET ${fields.join(', ')} WHERE id = ?`).run(...args, id);
}

export async function deletePlanUpdate(id: string): Promise<void> {
  await getDb().prepare('DELETE FROM track_plan_updates WHERE id = ?').run(id);
}

export async function listUpdateComments(updateId: string): Promise<PlanUpdateComment[]> {
  return (await getDb()
    .prepare(
      `SELECT c.*, u.name AS user_name, u.email AS user_email FROM track_plan_update_comments c
       JOIN users u ON u.id = c.user_id WHERE c.update_id = ? ORDER BY c.created_at ASC LIMIT 500`,
    )
    .all(updateId)) as PlanUpdateComment[];
}

/** Comentario en un update: avisa al autor del update y a quienes ya comentaron. */
export async function createUpdateComment(
  update: PlanUpdate & { plan: TrackPlanRow },
  userId: string,
  body: string,
): Promise<PlanUpdateComment> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO track_plan_update_comments (id, update_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, update.id, userId, body.trim(), nowIso());
  const name = await actorName(userId);
  const thread = (await db.prepare('SELECT DISTINCT user_id FROM track_plan_update_comments WHERE update_id = ?').all(update.id)) as Array<{
    user_id: string;
  }>;
  const recipients = new Set([update.user_id, ...thread.map((t) => t.user_id)]);
  recipients.delete(userId);
  for (const r of recipients) {
    await createNotification({
      userId: r,
      type: 'comment',
      title: `${name} commented on an update of ${update.plan.name}`,
      body: body.slice(0, 280),
      href: `/app/track/plans/${update.plan.id}?tab=updates`,
      sourceType: 'track_plan',
      sourceId: update.plan.id,
      meta: { planName: update.plan.name, actorName: name, actorId: userId, kind: 'comment' },
    }).catch(() => undefined);
  }
  return (await listUpdateComments(update.id)).find((c) => c.id === id) as PlanUpdateComment;
}

export async function deleteUpdateComment(id: string, userId: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_plan_update_comments WHERE id = ? AND user_id = ?').run(id, userId);
  return res.changes > 0;
}

/**
 * Tick: recuerda al lead los updates que tocan. Cada plan se reclama moviendo
 * next_reminder_at al próximo turno (compare-and-set con el valor leído), así
 * dos corridas no mandan dos avisos. Si hubo un update dentro del período, no
 * avisa.
 */
export async function runPlanUpdateReminders(opts: { now?: Date; limit?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const db = getDb();
  const due = (await db
    .prepare(
      `SELECT * FROM track_plans WHERE next_reminder_at IS NOT NULL AND next_reminder_at <= ?
       ORDER BY next_reminder_at ASC LIMIT ?`,
    )
    .all(now.toISOString(), Math.min(Math.max(opts.limit ?? 200, 1), 1000))) as TrackPlanRow[];
  let sent = 0;
  for (const plan of due) {
    const claimed = await db
      .prepare('UPDATE track_plans SET next_reminder_at = NULL, reminder_claimed_at = ? WHERE id = ? AND next_reminder_at = ?')
      .run(now.toISOString(), plan.id, plan.next_reminder_at);
    if (!claimed.changes) continue;
    await scheduleReminder(plan.id, new Date(now.getTime() + 60_000));
    if (plan.status !== 'in_progress' || !plan.lead_id || plan.update_cadence === 'off') continue;
    const windowStart = new Date(now.getTime() - (cadenceDays(plan.update_cadence) - 1) * 86_400_000).toISOString();
    const recent = await db.prepare('SELECT id FROM track_plan_updates WHERE plan_id = ? AND created_at >= ? LIMIT 1').get(plan.id, windowStart);
    if (recent) continue;
    await createNotification({
      userId: plan.lead_id,
      type: 'track_reminder',
      title: `Time to post an update on ${plan.name}`,
      body: plan.summary || undefined,
      href: `/app/track/plans/${plan.id}?tab=updates&new=1`,
      sourceType: 'track_plan',
      sourceId: plan.id,
      meta: { planName: plan.name, kind: 'reminder' },
    }).catch(() => undefined);
    sent++;
  }
  return sent;
}

/** Plans en curso del workspace con su salud: lo usa la iniciativa y el overview. */
export async function activePlansHealth(scope: WorkspaceScope, ids: string[]) {
  return listPlans(scope, { ids });
}
