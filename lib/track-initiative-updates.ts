/**
 * Track — updates de initiatives (los "initiative updates" de Linear): salud
 * (on track, at risk, off track) y texto. La salud de la initiative es la de
 * su último update; sin updates, la peor de sus projects activos. Avisan en el
 * Inbox al responsable, a quien la creó y a los leads de sus projects; solo el
 * autor edita su update y el autor o un admin lo borra.
 */
import { getDb } from './db';
import { createNotification } from './notifications';
import type { TrackInitiativeRow } from './track-initiatives';
import type { PlanHealth } from './track-planning-schema';

export interface InitiativeUpdate {
  id: string;
  initiative_id: string;
  user_id: string;
  user_name: string | null;
  user_email: string;
  health: PlanHealth;
  body: string;
  created_at: string;
  updated_at: string | null;
}

/** El último update de cada initiative (para la salud y "Latest update" en las listas). */
export interface LatestInitiativeUpdate {
  initiative_id: string;
  health: PlanHealth;
  created_at: string;
  user_name: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function listInitiativeUpdates(initiativeId: string): Promise<InitiativeUpdate[]> {
  return (await getDb()
    .prepare(
      `SELECT x.*, u.name AS user_name, u.email AS user_email
       FROM track_initiative_updates x JOIN users u ON u.id = x.user_id
       WHERE x.initiative_id = ? ORDER BY x.created_at DESC, x.id DESC LIMIT 200`,
    )
    .all(initiativeId)) as InitiativeUpdate[];
}

export async function getInitiativeUpdate(id: string): Promise<InitiativeUpdate | undefined> {
  return (await getDb()
    .prepare(
      `SELECT x.*, u.name AS user_name, u.email AS user_email
       FROM track_initiative_updates x JOIN users u ON u.id = x.user_id WHERE x.id = ?`,
    )
    .get(id)) as InitiativeUpdate | undefined;
}

export async function latestInitiativeUpdates(ids: string[]): Promise<Map<string, LatestInitiativeUpdate>> {
  const out = new Map<string, LatestInitiativeUpdate>();
  if (!ids.length) return out;
  const rows = (await getDb()
    .prepare(
      `SELECT x.initiative_id, x.health, x.created_at, u.name AS user_name
       FROM track_initiative_updates x JOIN users u ON u.id = x.user_id
       WHERE x.initiative_id IN (${ids.map(() => '?').join(', ')})
       ORDER BY x.created_at DESC, x.id DESC`,
    )
    .all(...ids)) as LatestInitiativeUpdate[];
  for (const r of rows) if (!out.has(r.initiative_id)) out.set(r.initiative_id, r);
  return out;
}

async function actorName(userId: string): Promise<string> {
  const u = (await getDb().prepare('SELECT name, email FROM users WHERE id = ?').get(userId)) as
    | { name: string | null; email: string }
    | undefined;
  return u?.name || u?.email || 'Someone';
}

/** Quién se entera de un update: responsable, quien la creó y los leads de sus projects. */
async function recipients(initiative: TrackInitiativeRow): Promise<string[]> {
  const leads = (await getDb()
    .prepare(
      `SELECT DISTINCT p.lead_id FROM track_initiative_plans ip JOIN track_plans p ON p.id = ip.plan_id
       WHERE ip.initiative_id = ? AND p.lead_id IS NOT NULL`,
    )
    .all(initiative.id)) as Array<{ lead_id: string }>;
  const set = new Set<string>();
  for (const id of [initiative.lead_id, initiative.created_by, ...leads.map((l) => l.lead_id)]) if (id) set.add(id);
  return [...set];
}

export async function createInitiativeUpdate(
  initiative: TrackInitiativeRow,
  userId: string,
  payload: { health: PlanHealth; body: string },
): Promise<InitiativeUpdate> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare('INSERT INTO track_initiative_updates (id, initiative_id, user_id, health, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, initiative.id, userId, payload.health, payload.body, now);
  await db.prepare('UPDATE track_initiatives SET updated_at = ? WHERE id = ?').run(now, initiative.id);
  const name = await actorName(userId);
  for (const r of await recipients(initiative)) {
    if (r === userId) continue;
    await createNotification({
      userId: r,
      type: 'project_update',
      title: `${name} posted an update on ${initiative.name}`,
      body: payload.body.slice(0, 280),
      href: `/app/track/initiatives/${initiative.id}#updates`,
      sourceType: 'track_initiative',
      sourceId: initiative.id,
      meta: { initiativeName: initiative.name, actorName: name, actorId: userId, health: payload.health, kind: 'update' },
    }).catch(() => undefined);
  }
  return (await getInitiativeUpdate(id)) as InitiativeUpdate;
}

export async function editInitiativeUpdate(id: string, payload: { health?: PlanHealth; body?: string }): Promise<void> {
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
  await getDb().prepare(`UPDATE track_initiative_updates SET ${fields.join(', ')} WHERE id = ?`).run(...args, id);
}

export async function deleteInitiativeUpdate(id: string): Promise<void> {
  await getDb().prepare('DELETE FROM track_initiative_updates WHERE id = ?').run(id);
}
