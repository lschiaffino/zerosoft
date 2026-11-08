/**
 * Ajustes › Miembros y permisos: registro de cambios, última actividad,
 * desactivar (con traspaso de lo suyo) y reactivar.
 *
 * - Cada cambio de rol, apps, equipos, invitación o baja deja una fila en
 *   `workspace_audit` con lo de antes y lo de después. "Deshacer" en la
 *   pantalla vuelve a llamar a la misma ruta con lo de antes, así que pasa
 *   por los mismos chequeos (lib/permissions.ts).
 * - Desactivar = sacar del workspace (corta el acceso en todas las apps, ver
 *   lib/workspace-lifecycle.ts) guardando rol, apps y equipos en
 *   `workspace_removed_members`, para reactivar con lo mismo.
 * - Lo suyo (issues de Track asignados, registros del CRM de los que es
 *   dueño) puede pasar a otra persona del workspace al desactivarla.
 */
import { getDb, type Db, type TeamRow } from './db';
import { addMember, removeMember } from './teams';
import { getMembership, normalizeWorkspaceRole, parseApps, serializeApps, type AppAccess, type WorkspaceRole } from './workspace';
import { groupIdsOf, setPersonGroups } from './workspace-groups';
import { trackVisibleExpr } from './track-access';

export type AuditAction =
  | 'member.role'
  | 'member.apps'
  | 'member.teams'
  | 'member.remove'
  | 'member.reactivate'
  | 'member.transfer'
  | 'invite.create'
  | 'invite.revoke';

export interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  targetId: string | null;
  targetLabel: string;
  action: AuditAction;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string;
}

function json(raw: unknown): Record<string, unknown> {
  try {
    const v = JSON.parse(String(raw ?? '{}')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function recordAudit(
  entry: { teamId: string; actorId: string; targetId?: string | null; targetLabel?: string; action: AuditAction; before?: unknown; after?: unknown },
  db: Db = getDb(),
): Promise<string> {
  const id = `wa_${crypto.randomUUID()}`;
  await db
    .prepare('INSERT INTO workspace_audit (id, team_id, actor_id, target_id, target_label, action, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      id,
      entry.teamId,
      entry.actorId,
      entry.targetId ?? null,
      (entry.targetLabel ?? '').slice(0, 200),
      entry.action,
      JSON.stringify(entry.before ?? {}),
      JSON.stringify(entry.after ?? {}),
    );
  return id;
}

/** Registro sin tirar: un cambio que ya se hizo no falla por el registro. */
export async function audit(entry: Parameters<typeof recordAudit>[0]): Promise<void> {
  await recordAudit(entry).catch((err) => console.error('[workspace] audit', err));
}

export async function listAudit(teamId: string, opts: { targetId?: string; limit?: number } = {}, db: Db = getDb()): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = (await db
    .prepare(
      `SELECT a.*, COALESCE(NULLIF(u.name, ''), u.email, '') AS actor_name FROM workspace_audit a
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.team_id = ? ${opts.targetId ? 'AND a.target_id = ?' : ''}
       ORDER BY a.created_at DESC, a.rowid DESC LIMIT ${limit}`,
    )
    .all(...(opts.targetId ? [teamId, opts.targetId] : [teamId]))) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    actorId: String(r.actor_id),
    actorName: String(r.actor_name ?? ''),
    targetId: (r.target_id as string | null) ?? null,
    targetLabel: String(r.target_label ?? ''),
    action: String(r.action) as AuditAction,
    before: json(r.before),
    after: json(r.after),
    createdAt: String(r.created_at),
  }));
}

// ---------- Última actividad ----------

const touched = new Map<string, number>();
const TOUCH_EVERY_MS = 10 * 60 * 1000;

/**
 * Marca la actividad de la persona en el workspace (a lo sumo cada 10
 * minutos por proceso). Nunca tira ni demora el pedido.
 */
export function touchActivity(teamId: string | null | undefined, userId: string): void {
  if (!teamId || !userId) return;
  const key = `${teamId}:${userId}`;
  const now = Date.now();
  if ((touched.get(key) ?? 0) > now - TOUCH_EVERY_MS) return;
  touched.set(key, now);
  if (touched.size > 5000) touched.clear();
  void Promise.resolve()
    .then(() =>
      getDb()
        .prepare(
          "UPDATE team_members SET last_active_at = datetime('now') WHERE team_id = ? AND user_id = ? AND (last_active_at IS NULL OR last_active_at < datetime('now', '-10 minutes'))",
        )
        .run(teamId, userId),
    )
    .catch(() => undefined);
}

export async function lastActiveByPerson(teamId: string, db: Db = getDb()): Promise<Map<string, string>> {
  const rows = (await db
    .prepare('SELECT user_id, last_active_at FROM team_members WHERE team_id = ? AND last_active_at IS NOT NULL')
    .all(teamId)
    .catch(() => [])) as Array<{ user_id: string; last_active_at: string }>;
  return new Map(rows.map((r) => [r.user_id, r.last_active_at]));
}

// ---------- Lo suyo: traspaso ----------

export interface OwnedStuff {
  trackIssues: number;
  crmRecords: number;
}

/** Proyectos de Track del workspace: los del owner y los del equipo de antes de 128. */
const TRACK_PROJECTS = 'SELECT id FROM track_projects WHERE owner_id IN (?, ?)';

async function count(db: Db, sql: string, ...args: string[]): Promise<number> {
  try {
    const row = (await db.prepare(sql).get(...args)) as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0; // tabla de una app que no está
  }
}

export async function ownedStuff(team: Pick<TeamRow, 'id' | 'owner_id'>, userId: string, db: Db = getDb()): Promise<OwnedStuff> {
  const [track, contacts, companies, deals] = await Promise.all([
    count(db, `SELECT COUNT(*) AS n FROM track_issues WHERE assignee_id = ? AND archived_at IS NULL AND project_id IN (${TRACK_PROJECTS})`, userId, team.owner_id, team.id),
    count(db, 'SELECT COUNT(*) AS n FROM crm_contacts WHERE user_id = ? AND owner_id = ?', team.owner_id, userId),
    count(db, 'SELECT COUNT(*) AS n FROM crm_companies WHERE user_id = ? AND owner_id = ?', team.owner_id, userId),
    count(db, 'SELECT COUNT(*) AS n FROM crm_deals WHERE user_id = ? AND owner_id = ?', team.owner_id, userId),
  ]);
  return { trackIssues: track, crmRecords: contacts + companies + deals };
}

/** Pasa a `to` los issues abiertos de Track asignados a `from` y los registros del CRM de los que es dueño. */
export async function transferStuff(
  team: Pick<TeamRow, 'id' | 'owner_id'>,
  from: string,
  to: string,
  /** Qué apps usa quien recibe: solo se le pasa lo de esas apps. */
  can: { track: boolean; crm: boolean },
  db: Db = getDb(),
): Promise<OwnedStuff> {
  const all = await ownedStuff(team, from, db);
  const moved = { trackIssues: can.track ? all.trackIssues : 0, crmRecords: can.crm ? all.crmRecords : 0 };
  const steps: Array<[string, string[]]> = [
    [
      // Solo los de proyectos que quien recibe ve (la misma regla que Track).
      `UPDATE track_issues SET assignee_id = ? WHERE assignee_id = ? AND archived_at IS NULL
       AND project_id IN (SELECT tp.id FROM track_projects tp WHERE tp.owner_id IN (?, ?) AND ${trackVisibleExpr('tp', '?')})`,
      [to, from, team.owner_id, team.id, to, to, to],
    ],
    ['UPDATE crm_contacts SET owner_id = ? WHERE user_id = ? AND owner_id = ?', [to, team.owner_id, from]],
    ['UPDATE crm_companies SET owner_id = ? WHERE user_id = ? AND owner_id = ?', [to, team.owner_id, from]],
    ['UPDATE crm_deals SET owner_id = ? WHERE user_id = ? AND owner_id = ?', [to, team.owner_id, from]],
  ].filter(([sql]) => (sql.includes('track_') ? can.track : can.crm)) as Array<[string, string[]]>;
  for (const [sql, args] of steps) {
    try {
      await db.prepare(sql).run(...args);
    } catch (err) {
      if (!/no such table|no such column/i.test(String(err))) throw err;
    }
  }
  return moved;
}

// ---------- Desactivar / reactivar ----------

export interface MemberSnapshot {
  role: Exclude<WorkspaceRole, 'owner'>;
  apps: AppAccess;
  groupIds: string[];
}

export async function snapshotMember(team: Pick<TeamRow, 'id' | 'owner_id'>, userId: string): Promise<MemberSnapshot | null> {
  const m = await getMembership(team, userId);
  if (!m || m.role === 'owner') return null;
  return { role: m.role, apps: m.apps, groupIds: await groupIdsOf(team.owner_id, userId) };
}

/** Saca a la persona guardando su ficha para reactivarla. Devuelve la ficha (null si no era parte). */
export async function deactivateMember(team: TeamRow, userId: string, actorId: string): Promise<MemberSnapshot | null> {
  const snap = await snapshotMember(team, userId);
  if (!snap) return null;
  await getDb()
    .prepare(
      `INSERT INTO workspace_removed_members (team_id, user_id, role, apps, group_ids, removed_by, removed_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role, apps = excluded.apps, group_ids = excluded.group_ids,
         removed_by = excluded.removed_by, removed_at = excluded.removed_at`,
    )
    .run(team.id, userId, snap.role, serializeApps(snap.apps), JSON.stringify(snap.groupIds), actorId);
  await removeMember(team.id, userId);
  return snap;
}

export interface DeactivatedDto {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: Exclude<WorkspaceRole, 'owner'>;
  apps: AppAccess;
  groupIds: string[];
  removedAt: string;
}

export async function listDeactivated(teamId: string, db: Db = getDb()): Promise<DeactivatedDto[]> {
  const rows = (await db
    .prepare(
      `SELECT r.*, u.name, u.email, u.image FROM workspace_removed_members r JOIN users u ON u.id = r.user_id
       WHERE r.team_id = ? AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = r.team_id AND m.user_id = r.user_id)
       ORDER BY r.removed_at DESC LIMIT 200`,
    )
    .all(teamId)
    .catch(() => [])) as Array<Record<string, unknown>>;
  return rows.map((r) => {
    let groupIds: string[] = [];
    try {
      const v = JSON.parse(String(r.group_ids ?? '[]')) as unknown;
      groupIds = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      groupIds = [];
    }
    const role = normalizeWorkspaceRole(r.role);
    return {
      userId: String(r.user_id),
      name: (r.name as string | null) ?? null,
      email: String(r.email),
      image: (r.image as string | null) ?? null,
      role: role === 'owner' ? 'admin' : role,
      apps: parseApps(r.apps),
      groupIds,
      removedAt: String(r.removed_at),
    };
  });
}

export async function getDeactivated(teamId: string, userId: string): Promise<MemberSnapshot | null> {
  const row = (await getDb().prepare('SELECT role, apps, group_ids FROM workspace_removed_members WHERE team_id = ? AND user_id = ?').get(teamId, userId)) as
    | { role: string; apps: string; group_ids: string }
    | undefined;
  if (!row) return null;
  const role = normalizeWorkspaceRole(row.role);
  let groupIds: string[] = [];
  try {
    const v = JSON.parse(row.group_ids) as unknown;
    groupIds = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    groupIds = [];
  }
  return { role: role === 'owner' ? 'admin' : role, apps: parseApps(row.apps), groupIds };
}

/** Vuelve a sumar a la persona con su rol, apps y equipos de antes. */
export async function reactivateMember(team: TeamRow, userId: string, snap: MemberSnapshot, actorId: string): Promise<void> {
  await addMember(team.id, userId, snap.role, { apps: snap.apps, invitedBy: actorId });
  if (snap.role !== 'guest' && snap.groupIds.length) await setPersonGroups(team.owner_id, userId, snap.groupIds);
  await getDb().prepare('DELETE FROM workspace_removed_members WHERE team_id = ? AND user_id = ?').run(team.id, userId);
}

/** Olvida la ficha de alguien desactivado (deja de aparecer para reactivar). */
export async function forgetDeactivated(teamId: string, userId: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM workspace_removed_members WHERE team_id = ? AND user_id = ?').run(teamId, userId);
  return res.changes > 0;
}
