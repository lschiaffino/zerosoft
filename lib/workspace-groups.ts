/**
 * Subequipos del workspace (Ventas, Soporte, Producto…): un solo directorio
 * para todas las apps, en Ajustes › Equipos.
 *
 * - workspace_groups / workspace_group_members son la fuente. Cada cambio se
 *   copia con el mismo id a las tablas de equipos de las apps que ya los
 *   usaban (lib/workspace-groups-mirror.ts): visibilidad y round-robin del
 *   CRM, pools e inbox de Chat, asignación de Groups. Talk los usa para
 *   @equipo; Cal y Track para sumar a todo un equipo de una vez.
 * - Si una app edita su equipo desde su propia pantalla, syncGroupFromApp
 *   lo trae al directorio y lo vuelve a copiar a las demás.
 */
import { getDb, type Db } from './db';
import { mirrorGroups, unmirrorGroup } from './workspace-groups-mirror';
import { slugifyName } from './schema/workspace-migrations';
import { workspaceMemberSql } from './workspace';

export interface WorkspaceGroup {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  color: string;
  description: string;
  created_at: string;
  updated_at: string;
  members: Array<{ user_id: string; role: 'lead' | 'member'; name: string | null; email: string }>;
}

export class WorkspaceGroupError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

const MAX_GROUPS = 100;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function exec(db: Db) {
  return (sql: string, args: Array<string | number | null> = []) => db.prepare(sql).run(...args);
}

export async function listGroups(workspaceId: string, db: Db = getDb()): Promise<WorkspaceGroup[]> {
  const groups = (await db
    .prepare('SELECT * FROM workspace_groups WHERE workspace_id = ? ORDER BY name COLLATE NOCASE ASC, created_at ASC')
    .all(workspaceId)) as Array<Omit<WorkspaceGroup, 'members'>>;
  if (!groups.length) return [];
  const members = (await db
    .prepare(
      `SELECT m.group_id, m.user_id, m.role, u.name, u.email FROM workspace_group_members m
       JOIN workspace_groups g ON g.id = m.group_id JOIN users u ON u.id = m.user_id
       WHERE g.workspace_id = ? AND ${workspaceMemberSql('g.workspace_id', 'm.user_id')}
       ORDER BY m.role = 'lead' DESC, u.name COLLATE NOCASE, u.email`,
    )
    .all(workspaceId)) as Array<{ group_id: string; user_id: string; role: string; name: string | null; email: string }>;
  return groups.map((g) => ({
    ...g,
    members: members
      .filter((m) => m.group_id === g.id)
      .map((m) => ({ user_id: m.user_id, role: m.role === 'lead' ? 'lead' : 'member', name: m.name, email: m.email })),
  }));
}

export async function getGroup(workspaceId: string, id: string, db: Db = getDb()): Promise<WorkspaceGroup | null> {
  return (await listGroups(workspaceId, db)).find((g) => g.id === id) ?? null;
}

/** Ids de personas válidas del workspace (owner o miembros, no guests). */
async function validPeople(workspaceId: string, ids: unknown, db: Db): Promise<string[]> {
  if (!Array.isArray(ids)) return [];
  const clean = [...new Set(ids.filter((x): x is string => typeof x === 'string'))].slice(0, 500);
  const out: string[] = [];
  for (const id of clean) {
    const ok = await db.prepare(`SELECT 1 AS x WHERE ${workspaceMemberSql('?', '?')}`).get(workspaceId, id, workspaceId, id);
    if (ok) out.push(id);
  }
  return out;
}

async function uniqueSlug(workspaceId: string, name: string, exceptId: string | null, db: Db): Promise<string> {
  const base = slugifyName(name);
  for (let n = 1; n < 500; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await db.prepare('SELECT 1 AS x FROM workspace_groups WHERE workspace_id = ? AND slug = ? AND id IS NOT ?').get(workspaceId, slug, exceptId);
    if (!taken) return slug;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

function cleanName(raw: unknown): string {
  const name = String(raw ?? '').trim().slice(0, 60);
  if (!name) throw new WorkspaceGroupError('invalid_name');
  return name;
}

async function nameTaken(workspaceId: string, name: string, exceptId: string | null, db: Db): Promise<boolean> {
  return Boolean(
    await db.prepare('SELECT 1 AS x FROM workspace_groups WHERE workspace_id = ? AND name = ? COLLATE NOCASE AND id IS NOT ?').get(workspaceId, name, exceptId),
  );
}

async function writeMembers(groupId: string, members: string[], leads: string[], db: Db): Promise<void> {
  await db.prepare('DELETE FROM workspace_group_members WHERE group_id = ?').run(groupId);
  for (const id of members) {
    await db
      .prepare('INSERT OR IGNORE INTO workspace_group_members (group_id, user_id, role) VALUES (?, ?, ?)')
      .run(groupId, id, leads.includes(id) ? 'lead' : 'member');
  }
}

export async function createGroup(
  workspaceId: string,
  input: { name: unknown; description?: unknown; color?: unknown; memberIds?: unknown; leadIds?: unknown },
  db: Db = getDb(),
): Promise<WorkspaceGroup> {
  const name = cleanName(input.name);
  const count = (await db.prepare('SELECT COUNT(*) AS c FROM workspace_groups WHERE workspace_id = ?').get(workspaceId)) as { c: number };
  if (Number(count.c) >= MAX_GROUPS) throw new WorkspaceGroupError('too_many_groups');
  if (await nameTaken(workspaceId, name, null, db)) throw new WorkspaceGroupError('duplicate_name', 409);
  const id = crypto.randomUUID();
  const color = typeof input.color === 'string' && COLOR_RE.test(input.color) ? input.color : '';
  await db
    .prepare('INSERT INTO workspace_groups (id, workspace_id, name, slug, color, description) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, workspaceId, name, await uniqueSlug(workspaceId, name, null, db), color, String(input.description ?? '').trim().slice(0, 280));
  const members = await validPeople(workspaceId, input.memberIds, db);
  const leads = await validPeople(workspaceId, input.leadIds, db);
  await writeMembers(id, members, leads, db);
  await mirrorGroups(exec(db), { groupId: id });
  return (await getGroup(workspaceId, id, db))!;
}

export async function updateGroup(
  workspaceId: string,
  id: string,
  input: { name?: unknown; description?: unknown; color?: unknown; memberIds?: unknown; leadIds?: unknown },
  db: Db = getDb(),
): Promise<WorkspaceGroup | null> {
  const existing = await getGroup(workspaceId, id, db);
  if (!existing) return null;
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (await nameTaken(workspaceId, name, id, db)) throw new WorkspaceGroupError('duplicate_name', 409);
    await db
      .prepare("UPDATE workspace_groups SET name = ?, slug = ?, updated_at = datetime('now') WHERE id = ?")
      .run(name, await uniqueSlug(workspaceId, name, id, db), id);
  }
  if (input.description !== undefined) {
    await db.prepare("UPDATE workspace_groups SET description = ?, updated_at = datetime('now') WHERE id = ?").run(String(input.description ?? '').trim().slice(0, 280), id);
  }
  if (input.color !== undefined) {
    const color = typeof input.color === 'string' && COLOR_RE.test(input.color) ? input.color : '';
    await db.prepare("UPDATE workspace_groups SET color = ?, updated_at = datetime('now') WHERE id = ?").run(color, id);
  }
  if (input.memberIds !== undefined) {
    const members = await validPeople(workspaceId, input.memberIds, db);
    const leads = input.leadIds !== undefined ? await validPeople(workspaceId, input.leadIds, db) : existing.members.filter((m) => m.role === 'lead').map((m) => m.user_id);
    await writeMembers(id, members, leads, db);
  } else if (input.leadIds !== undefined) {
    const leads = await validPeople(workspaceId, input.leadIds, db);
    await writeMembers(id, existing.members.map((m) => m.user_id), leads, db);
  }
  await mirrorGroups(exec(db), { groupId: id });
  return getGroup(workspaceId, id, db);
}

/**
 * Borra el subequipo en todas las apps. Las conversaciones de Chat quedan sin
 * equipo y las reglas que asignaban a él sin destino (como al borrarlo en Chat).
 */
export async function deleteGroup(workspaceId: string, id: string, db: Db = getDb()): Promise<boolean> {
  const res = await db.prepare('DELETE FROM workspace_groups WHERE id = ? AND workspace_id = ?').run(id, workspaceId);
  if (res.changes === 0) return false;
  const run = exec(db);
  const safe = async (sql: string, args: Array<string | number | null>) => {
    try {
      await run(sql, args);
    } catch (err) {
      if (!/no such table|no such column/i.test(String(err))) throw err;
    }
  };
  await safe('UPDATE chat_conversations SET team_id = NULL WHERE team_id = ?', [id]);
  await safe('UPDATE chat_assignment_rules SET assign_team_id = NULL WHERE assign_team_id = ?', [id]);
  await safe('UPDATE groups_chats SET assigned_team_id = NULL WHERE user_id = ? AND assigned_team_id = ?', [workspaceId, id]);
  await safe('UPDATE groups_assign_rules SET team_id = NULL, enabled = 0 WHERE user_id = ? AND team_id = ?', [workspaceId, id]);
  await unmirrorGroup(run, id);
  return true;
}

/** Suma a una persona a varios subequipos (invitación aceptada). */
export async function addPersonToGroups(workspaceId: string, userId: string, groupIds: string[], db: Db = getDb()): Promise<void> {
  for (const gid of [...new Set(groupIds)].slice(0, 50)) {
    const ok = await db.prepare('SELECT 1 AS x FROM workspace_groups WHERE id = ? AND workspace_id = ?').get(gid, workspaceId);
    if (!ok) continue;
    await db.prepare("INSERT OR IGNORE INTO workspace_group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(gid, userId);
    await mirrorGroups(exec(db), { groupId: gid });
  }
}

/** Saca a una persona de todos los subequipos del workspace (y de sus copias en las apps). */
export async function removePersonFromGroups(workspaceId: string, userId: string, db: Db = getDb()): Promise<void> {
  await db
    .prepare('DELETE FROM workspace_group_members WHERE user_id = ? AND group_id IN (SELECT id FROM workspace_groups WHERE workspace_id = ?)')
    .run(userId, workspaceId);
  await mirrorGroups(exec(db), { workspaceId });
}

/** Subequipos de una persona en el workspace (ids). */
export async function groupIdsOf(workspaceId: string, userId: string, db: Db = getDb()): Promise<string[]> {
  const rows = (await db
    .prepare('SELECT m.group_id FROM workspace_group_members m JOIN workspace_groups g ON g.id = m.group_id WHERE g.workspace_id = ? AND m.user_id = ?')
    .all(workspaceId, userId)) as Array<{ group_id: string }>;
  return rows.map((r) => r.group_id);
}

/** Pone a la persona en exactamente estos subequipos (Ajustes › Miembros). */
export async function setPersonGroups(workspaceId: string, userId: string, groupIds: string[], db: Db = getDb()): Promise<void> {
  const valid = new Set(
    ((await db.prepare('SELECT id FROM workspace_groups WHERE workspace_id = ?').all(workspaceId)) as Array<{ id: string }>).map((r) => r.id),
  );
  const want = new Set(groupIds.filter((g) => valid.has(g)));
  const have = new Set(await groupIdsOf(workspaceId, userId, db));
  for (const g of have) if (!want.has(g)) await db.prepare('DELETE FROM workspace_group_members WHERE group_id = ? AND user_id = ?').run(g, userId);
  for (const g of want) if (!have.has(g)) await db.prepare("INSERT OR IGNORE INTO workspace_group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(g, userId);
  await mirrorGroups(exec(db), { workspaceId });
}

/** Miembros de un subequipo por slug (Talk: @ventas). */
export async function groupMembersBySlug(workspaceId: string, slug: string, db: Db = getDb()): Promise<string[]> {
  const rows = (await db
    .prepare(
      `SELECT m.user_id FROM workspace_group_members m JOIN workspace_groups g ON g.id = m.group_id
       WHERE g.workspace_id = ? AND g.slug = ? AND ${workspaceMemberSql('g.workspace_id', 'm.user_id')}`,
    )
    .all(workspaceId, slug.toLowerCase())) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

type AppSource = 'crm' | 'chat' | 'groups';

const APP_SQL: Record<AppSource, { team: string; ws: string; members: string; person: string }> = {
  crm: { team: 'crm_sales_teams', ws: 'user_id', members: 'crm_sales_team_members', person: 'person_id' },
  chat: { team: 'chat_teams', ws: 'workspace_id', members: 'chat_team_members', person: 'user_id' },
  groups: { team: 'groups_teams', ws: 'user_id', members: 'groups_team_members', person: 'person_id' },
};

/**
 * Una app cambió su equipo desde su pantalla: lo trae al directorio del
 * workspace (alta, nombre, miembros o baja) y lo copia a las demás apps.
 * Nunca tira: un fallo del espejo no puede romper el guardado de la app.
 */
export async function syncGroupFromApp(source: AppSource, workspaceId: string, teamId: string, db: Db = getDb()): Promise<void> {
  try {
    const t = APP_SQL[source];
    const row = (await db.prepare(`SELECT id, name, created_at FROM ${t.team} WHERE id = ? AND ${t.ws} = ?`).get(teamId, workspaceId)) as
      | { id: string; name: string; created_at: string }
      | undefined;
    if (!row) {
      // Borrado en la app: se borra del directorio y de las demás apps.
      const had = await db.prepare('SELECT 1 AS x FROM workspace_groups WHERE id = ? AND workspace_id = ?').get(teamId, workspaceId);
      if (had) await deleteGroup(workspaceId, teamId, db);
      return;
    }
    const existing = await db.prepare('SELECT id, name FROM workspace_groups WHERE id = ?').get(teamId) as { id: string; name: string } | undefined;
    if (!existing) {
      await db
        .prepare('INSERT OR IGNORE INTO workspace_groups (id, workspace_id, name, slug, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(row.id, workspaceId, row.name, await uniqueSlug(workspaceId, row.name, row.id, db), source, row.created_at, row.created_at);
    } else if (existing.name !== row.name) {
      await db
        .prepare("UPDATE workspace_groups SET name = ?, slug = ?, updated_at = datetime('now') WHERE id = ?")
        .run(row.name, await uniqueSlug(workspaceId, row.name, row.id, db), row.id);
    }
    const people = ((await db.prepare(`SELECT ${t.person} AS p FROM ${t.members} WHERE team_id = ?`).all(teamId)) as Array<{ p: string }>).map(
      (r) => r.p,
    );
    const leads = ((await db.prepare("SELECT user_id FROM workspace_group_members WHERE group_id = ? AND role = 'lead'").all(teamId)) as Array<{
      user_id: string;
    }>).map((r) => r.user_id);
    const valid = await validPeople(workspaceId, people, db);
    await writeMembers(teamId, valid, leads, db);
    await mirrorGroups(exec(db), { groupId: teamId });
  } catch (err) {
    console.error('[workspace-groups] sync', source, err);
  }
}
