/**
 * Lines: grupos de líneas (Ventas, Operaciones…) y el acceso por grupo.
 *
 * - Un grupo es del workspace, tiene nombre y orden. Una línea está en un grupo
 *   o en ninguno (groups_numbers.line_group_id). Borrar un grupo no borra
 *   líneas: quedan sin grupo.
 * - Acceso: un admin le da un grupo a personas o equipos
 *   (groups_line_group_access). Quien tiene el grupo ve todas sus líneas, las
 *   de hoy y las que se sumen. La regla vive con la de cada línea, en
 *   groups-access.ts (numberAccessSql): todo lo que lee chats la aplica. Sacar
 *   a alguien del grupo, o una línea del grupo, corta en el pedido siguiente.
 * - El acceso por grupo solo cambia algo en líneas restringidas: una línea de
 *   "todo el workspace" la ven todos igual.
 * - Solo admins crean, renombran, ordenan y borran grupos, mueven líneas y dan
 *   acceso (las rutas lo exigen). Un member ve el nombre de los grupos donde
 *   tiene alguna línea a la vista, y nada más de ellos.
 * Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { GroupsError } from './groups';
import { numberAccessSql, type GroupsViewer } from './groups-access';

const nowIso = () => new Date().toISOString();
const MAX_GROUPS = 100;

export interface LineGroupDto {
  id: string;
  name: string;
  position: number;
  /** Líneas del grupo que ve quien mira. */
  numberIds: string[];
  /** A quién se le dio el grupo. Solo para admins. */
  access?: { personIds: string[]; teamIds: string[] };
}

interface GroupRow {
  id: string;
  name: string;
  position: number;
}

async function groupRows(ws: string): Promise<GroupRow[]> {
  return (await getDb().prepare('SELECT id, name, position FROM groups_line_groups WHERE user_id = ? ORDER BY position, created_at, id').all(ws)) as GroupRow[];
}

function cleanName(raw: unknown): string {
  const name = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 60);
  if (!name) throw new GroupsError('invalid_name');
  return name;
}

const dup = (rows: GroupRow[], name: string, exceptId?: string) => rows.some((r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase());

/**
 * Grupos del workspace en orden. Con un `viewer` que no ve todas las líneas,
 * solo los grupos donde ve alguna, con esas líneas y sin la lista de accesos.
 */
export async function listLineGroups(ws: string, viewer?: GroupsViewer | null): Promise<LineGroupDto[]> {
  const db = getDb();
  const rows = await groupRows(ws);
  if (rows.length === 0) return [];
  const access = numberAccessSql(viewer);
  const numbers = (await db
    .prepare(`SELECT n.id, n.line_group_id AS gid FROM groups_numbers n WHERE n.user_id = ? AND n.line_group_id IS NOT NULL${access ? ` AND ${access.sql}` : ''} ORDER BY n.created_at, n.id`)
    .all(ws, ...(access?.args ?? []))) as Array<{ id: string; gid: string }>;
  const byGroup = new Map<string, string[]>();
  for (const n of numbers) byGroup.set(n.gid, [...(byGroup.get(n.gid) ?? []), n.id]);
  if (access) {
    return rows.filter((r) => byGroup.has(r.id)).map((r) => ({ id: r.id, name: r.name, position: r.position, numberIds: byGroup.get(r.id) ?? [] }));
  }
  const grants = (await db
    .prepare('SELECT a.group_id, a.kind, a.ref_id FROM groups_line_group_access a JOIN groups_line_groups g ON g.id = a.group_id WHERE g.user_id = ?')
    .all(ws)) as Array<{ group_id: string; kind: string; ref_id: string }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    position: r.position,
    numberIds: byGroup.get(r.id) ?? [],
    access: {
      personIds: grants.filter((g) => g.group_id === r.id && g.kind === 'person').map((g) => g.ref_id),
      teamIds: grants.filter((g) => g.group_id === r.id && g.kind === 'team').map((g) => g.ref_id),
    },
  }));
}

export async function createLineGroup(ws: string, actor: string, input: { name?: unknown }): Promise<LineGroupDto> {
  const name = cleanName(input.name);
  const rows = await groupRows(ws);
  if (rows.length >= MAX_GROUPS) throw new GroupsError('too_many_line_groups');
  if (dup(rows, name)) throw new GroupsError('duplicate_line_group', 409);
  const id = randomUUID();
  const position = rows.reduce((max, r) => Math.max(max, r.position + 1), 0);
  const now = nowIso();
  await getDb()
    .prepare('INSERT INTO groups_line_groups (id, user_id, name, position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, ws, name, position, actor, now, now);
  return { id, name, position, numberIds: [], access: { personIds: [], teamIds: [] } };
}

async function validPeople(ws: string, ids: string[]): Promise<string[]> {
  const { isWorkspacePerson } = await import('./crm-refs');
  const valid: string[] = [];
  for (const p of [...new Set(ids)].slice(0, 200)) if (await isWorkspacePerson(ws, p)) valid.push(p);
  return valid;
}

async function validIds(ws: string, table: 'groups_teams' | 'groups_numbers' | 'groups_line_groups', ids: string[], max: number): Promise<string[]> {
  const list = [...new Set(ids)].slice(0, max);
  if (list.length === 0) return [];
  const rows = (await getDb()
    .prepare(`SELECT id FROM ${table} WHERE user_id = ? AND id IN (${list.map(() => '?').join(',')})`)
    .all(ws, ...list)) as Array<{ id: string }>;
  const ok = new Set(rows.map((r) => r.id));
  return list.filter((id) => ok.has(id));
}

export interface LineGroupPatch {
  name?: unknown;
  /** Las líneas del grupo pasan a ser exactamente estas (las que salen quedan sin grupo). */
  numberIds?: string[];
  personIds?: string[];
  teamIds?: string[];
}

/** Renombra, cambia las líneas del grupo o a quién se le da. Ids de otro workspace se ignoran. */
export async function updateLineGroup(ws: string, id: string, input: LineGroupPatch): Promise<void> {
  const rows = await groupRows(ws);
  const row = rows.find((r) => r.id === id);
  if (!row) throw new GroupsError('not_found', 404);
  const db = getDb();
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (dup(rows, name, id)) throw new GroupsError('duplicate_line_group', 409);
    await db.prepare('UPDATE groups_line_groups SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(name, nowIso(), id, ws);
  }
  if (input.numberIds !== undefined) {
    const keep = await validIds(ws, 'groups_numbers', input.numberIds, 200);
    await db
      .prepare(`UPDATE groups_numbers SET line_group_id = NULL WHERE user_id = ? AND line_group_id = ?${keep.length ? ` AND id NOT IN (${keep.map(() => '?').join(',')})` : ''}`)
      .run(ws, id, ...keep);
    if (keep.length) {
      await db.prepare(`UPDATE groups_numbers SET line_group_id = ? WHERE user_id = ? AND id IN (${keep.map(() => '?').join(',')})`).run(id, ws, ...keep);
    }
  }
  if (input.personIds !== undefined) {
    const valid = await validPeople(ws, input.personIds);
    await db.prepare("DELETE FROM groups_line_group_access WHERE group_id = ? AND kind = 'person'").run(id);
    for (const p of valid) await db.prepare("INSERT OR IGNORE INTO groups_line_group_access (group_id, kind, ref_id) VALUES (?, 'person', ?)").run(id, p);
  }
  if (input.teamIds !== undefined) {
    const valid = await validIds(ws, 'groups_teams', input.teamIds, 100);
    await db.prepare("DELETE FROM groups_line_group_access WHERE group_id = ? AND kind = 'team'").run(id);
    for (const t of valid) await db.prepare("INSERT OR IGNORE INTO groups_line_group_access (group_id, kind, ref_id) VALUES (?, 'team', ?)").run(id, t);
  }
}

/** El orden pasa a ser el de `ids` (los grupos que falten quedan al final, en su orden). */
export async function reorderLineGroups(ws: string, ids: string[]): Promise<void> {
  const rows = await groupRows(ws);
  const known = new Set(rows.map((r) => r.id));
  const first = [...new Set(ids)].filter((id) => known.has(id));
  const order = [...first, ...rows.map((r) => r.id).filter((id) => !first.includes(id))];
  const db = getDb();
  for (const [position, id] of order.entries()) {
    await db.prepare('UPDATE groups_line_groups SET position = ? WHERE id = ? AND user_id = ?').run(position, id, ws);
  }
}

/** Borra el grupo y sus accesos. Las líneas no se borran: quedan sin grupo (y quien las veía por el grupo deja de verlas). */
export async function deleteLineGroup(ws: string, id: string): Promise<boolean> {
  const db = getDb();
  const row = await db.prepare('SELECT id FROM groups_line_groups WHERE id = ? AND user_id = ?').get(id, ws);
  if (!row) return false;
  await db.prepare('UPDATE groups_numbers SET line_group_id = NULL WHERE user_id = ? AND line_group_id = ?').run(ws, id);
  await db.prepare('DELETE FROM groups_line_group_access WHERE group_id = ?').run(id);
  await db.prepare('DELETE FROM groups_line_groups WHERE id = ? AND user_id = ?').run(id, ws);
  return true;
}

/** Pone una línea en un grupo (null = sin grupo). */
export async function setNumberLineGroup(ws: string, numberId: string, groupId: string | null): Promise<void> {
  const db = getDb();
  if (groupId && !(await db.prepare('SELECT id FROM groups_line_groups WHERE id = ? AND user_id = ?').get(groupId, ws))) throw new GroupsError('invalid_line_group');
  const r = await db.prepare('UPDATE groups_numbers SET line_group_id = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(groupId || null, nowIso(), numberId, ws);
  if (r.changes === 0) throw new GroupsError('not_found', 404);
}

// ======================================================================
// Acceso de una persona (la vista "qué ve Ana")
// ======================================================================

export interface PersonLineAccess {
  /** Grupos que se le dieron a la persona. */
  groupIds: string[];
  /** Líneas que se le dieron una por una. */
  numberIds: string[];
  /** Solo lectura: líneas que ve por otra vía (es la dueña, o la ve por un equipo). */
  ownedNumberIds: string[];
  teamNumberIds: string[];
  teamGroupIds: string[];
}

export async function getPersonLineAccess(ws: string, personId: string): Promise<PersonLineAccess> {
  const db = getDb();
  const [groups, numbers, owned, teamNumbers, teamGroups] = await Promise.all([
    db
      .prepare("SELECT a.group_id AS id FROM groups_line_group_access a JOIN groups_line_groups g ON g.id = a.group_id WHERE g.user_id = ? AND a.kind = 'person' AND a.ref_id = ?")
      .all(ws, personId) as Promise<Array<{ id: string }>>,
    db
      .prepare("SELECT a.number_id AS id FROM groups_number_access a JOIN groups_numbers n ON n.id = a.number_id WHERE n.user_id = ? AND a.kind = 'person' AND a.ref_id = ?")
      .all(ws, personId) as Promise<Array<{ id: string }>>,
    db.prepare('SELECT id FROM groups_numbers WHERE user_id = ? AND owner_id = ?').all(ws, personId) as Promise<Array<{ id: string }>>,
    db
      .prepare(
        `SELECT DISTINCT a.number_id AS id FROM groups_number_access a JOIN groups_numbers n ON n.id = a.number_id
         WHERE n.user_id = ? AND a.kind = 'team' AND a.ref_id IN (SELECT tm.team_id FROM groups_team_members tm WHERE tm.person_id = ?)`,
      )
      .all(ws, personId) as Promise<Array<{ id: string }>>,
    db
      .prepare(
        `SELECT DISTINCT a.group_id AS id FROM groups_line_group_access a JOIN groups_line_groups g ON g.id = a.group_id
         WHERE g.user_id = ? AND a.kind = 'team' AND a.ref_id IN (SELECT tm.team_id FROM groups_team_members tm WHERE tm.person_id = ?)`,
      )
      .all(ws, personId) as Promise<Array<{ id: string }>>,
  ]);
  const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
  return { groupIds: ids(groups), numberIds: ids(numbers), ownedNumberIds: ids(owned), teamNumberIds: ids(teamNumbers), teamGroupIds: ids(teamGroups) };
}

/**
 * Deja a la persona con exactamente estos grupos y estas líneas dados a su
 * nombre. No toca lo que ve por un equipo ni por ser dueña, ni la visibilidad
 * de las líneas.
 */
export async function setPersonLineAccess(ws: string, personId: string, input: { groupIds?: string[]; numberIds?: string[] }): Promise<void> {
  const { isWorkspacePerson } = await import('./crm-refs');
  if (!(await isWorkspacePerson(ws, personId))) throw new GroupsError('invalid_person');
  const db = getDb();
  if (input.groupIds !== undefined) {
    const valid = await validIds(ws, 'groups_line_groups', input.groupIds, MAX_GROUPS);
    await db
      .prepare("DELETE FROM groups_line_group_access WHERE kind = 'person' AND ref_id = ? AND group_id IN (SELECT id FROM groups_line_groups WHERE user_id = ?)")
      .run(personId, ws);
    for (const g of valid) await db.prepare("INSERT OR IGNORE INTO groups_line_group_access (group_id, kind, ref_id) VALUES (?, 'person', ?)").run(g, personId);
  }
  if (input.numberIds !== undefined) {
    const valid = await validIds(ws, 'groups_numbers', input.numberIds, 200);
    await db
      .prepare("DELETE FROM groups_number_access WHERE kind = 'person' AND ref_id = ? AND number_id IN (SELECT id FROM groups_numbers WHERE user_id = ?)")
      .run(personId, ws);
    for (const n of valid) await db.prepare("INSERT OR IGNORE INTO groups_number_access (number_id, kind, ref_id) VALUES (?, 'person', ?)").run(n, personId);
  }
}

/** ¿Quien mira ve alguna línea de este grupo? (para el filtro por grupo de la bandeja). */
export async function canSeeLineGroup(viewer: GroupsViewer | null | undefined, groupId: string): Promise<boolean> {
  if (!viewer) return false;
  const access = numberAccessSql(viewer);
  const row = await getDb()
    .prepare(`SELECT 1 AS x FROM groups_numbers n WHERE n.user_id = ? AND n.line_group_id = ?${access ? ` AND ${access.sql}` : ''} LIMIT 1`)
    .get(viewer.ws, groupId, ...(access?.args ?? []));
  return Boolean(row);
}
