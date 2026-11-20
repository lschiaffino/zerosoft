/**
 * Lines: dueño y visibilidad de cada línea (número), carpetas de cada persona
 * y la línea que cada persona tiene elegida en la bandeja.
 *
 * - Dueño: una persona del workspace por línea. Siempre ve su línea.
 * - Visibilidad: 'all' (todo el workspace, por defecto) o 'restricted' (dueño,
 *   admins y las personas o equipos que figuren en groups_number_access). La
 *   regla vive en groups-access.ts (numberAccessSql / chatAccessSql) y se
 *   aplica en todas las rutas que leen chats.
 * - Grupos de líneas y acceso por grupo: lib/groups-line-groups.ts.
 * - Carpetas personales: de cada persona (groups_folders.owner_id), con
 *   subcarpetas hasta MAX_FOLDER_DEPTH. Nadie ve las de otra persona, tampoco
 *   un admin. En qué carpeta está un chat también es de cada persona
 *   (groups_chat_folders): el mismo chat puede estar en una carpeta mía y en
 *   otra, o en ninguna, de un compañero.
 * - Carpetas del equipo (groups_folders.scope = 'team'): las ve todo el
 *   workspace y las administran los admins. Un chat está en una sola carpeta
 *   del equipo, la misma para todos (groups_chat_team_folders), y además puede
 *   estar en una personal de cada uno.
 * - Los conteos y el filtro usan solo chats que la persona puede ver.
 * Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { GroupsError, getNumberRow } from './groups';
import { chatAccessSql, canSeeNumber, type GroupsViewer } from './groups-access';
import { folderOwnerBackfill } from './schema/lines-folder-owner';
import { MAX_FOLDER_DEPTH, canMoveFolder, depthOf, descendantIds, siblingOrder, type TreeFolder } from './inbox/folder-tree';

const nowIso = () => new Date().toISOString();

// ======================================================================
// Dueño y visibilidad
// ======================================================================

export interface LineAccessInput {
  /** Persona dueña; null la quita. */
  ownerId?: string | null;
  visibility?: 'all' | 'restricted';
  personIds?: string[];
  teamIds?: string[];
}

/** Cambia dueño, visibilidad y accesos de una línea (la ruta exige poder administrarla; el dueño, admin). */
export async function setLineAccess(ws: string, numberId: string, input: LineAccessInput): Promise<void> {
  const row = await getNumberRow(ws, numberId);
  if (!row) throw new GroupsError('not_found', 404);
  const db = getDb();
  const { isWorkspacePerson } = await import('./crm-refs');
  if (input.ownerId !== undefined) {
    if (input.ownerId && !(await isWorkspacePerson(ws, input.ownerId))) throw new GroupsError('invalid_owner');
    await db.prepare('UPDATE groups_numbers SET owner_id = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(input.ownerId || null, nowIso(), numberId, ws);
  }
  if (input.visibility !== undefined) {
    if (input.visibility !== 'all' && input.visibility !== 'restricted') throw new GroupsError('invalid_visibility');
    await db.prepare('UPDATE groups_numbers SET visibility = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(input.visibility, nowIso(), numberId, ws);
  }
  if (input.personIds !== undefined) {
    const valid: string[] = [];
    for (const p of [...new Set(input.personIds)].slice(0, 200)) if (await isWorkspacePerson(ws, p)) valid.push(p);
    await db.prepare("DELETE FROM groups_number_access WHERE number_id = ? AND kind = 'person'").run(numberId);
    for (const p of valid) await db.prepare("INSERT OR IGNORE INTO groups_number_access (number_id, kind, ref_id) VALUES (?, 'person', ?)").run(numberId, p);
  }
  if (input.teamIds !== undefined) {
    const ids = [...new Set(input.teamIds)].slice(0, 100);
    const valid = ids.length
      ? ((await db.prepare(`SELECT id FROM groups_teams WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`).all(ws, ...ids)) as Array<{ id: string }>).map(
          (r) => r.id,
        )
      : [];
    await db.prepare("DELETE FROM groups_number_access WHERE number_id = ? AND kind = 'team'").run(numberId);
    for (const t of valid) await db.prepare("INSERT OR IGNORE INTO groups_number_access (number_id, kind, ref_id) VALUES (?, 'team', ?)").run(numberId, t);
  }
}

// ======================================================================
// Línea elegida por persona
// ======================================================================

const LINE_KEY = 'line';

/** Prefijo de un grupo de líneas en la elección de la bandeja: 'g:<id del grupo>'. */
export const LINE_GROUP_PREFIX = 'g:';

/** ¿Puede elegir esto? Una línea que ve, o un grupo donde ve alguna línea. */
async function canSelectLine(viewer: GroupsViewer, value: string): Promise<boolean> {
  if (value.startsWith(LINE_GROUP_PREFIX)) {
    const { canSeeLineGroup } = await import('./groups-line-groups');
    return canSeeLineGroup(viewer, value.slice(LINE_GROUP_PREFIX.length));
  }
  return canSeeNumber(viewer, value);
}

/**
 * Lo que esta persona tiene elegido: el id de una línea, 'g:<id>' (un grupo de líneas entero) o 'all' (todas).
 * Si ya no lo ve o no existe, 'all'.
 */
export async function getSelectedLine(viewer: GroupsViewer): Promise<string> {
  const r = (await getDb().prepare('SELECT value FROM groups_user_prefs WHERE user_id = ? AND person_id = ? AND key = ?').get(viewer.ws, viewer.me, LINE_KEY)) as
    | { value: string }
    | undefined;
  const v = r?.value ?? 'all';
  if (v === 'all') return 'all';
  return (await canSelectLine(viewer, v)) ? v : 'all';
}

export async function setSelectedLine(viewer: GroupsViewer, line: string): Promise<string> {
  const value = line === 'all' || !line ? 'all' : line;
  if (value !== 'all' && !(await canSelectLine(viewer, value))) throw new GroupsError('not_found', 404);
  await getDb()
    .prepare(
      `INSERT INTO groups_user_prefs (user_id, person_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, person_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(viewer.ws, viewer.me, LINE_KEY, value, nowIso());
  return value;
}


// ======================================================================
// Carpetas: las del equipo y las de cada persona
// ======================================================================

/**
 * 'team': del workspace (groups_folders.scope = 'team'). Las ve todo el que
 * entra a Lines; crearlas, renombrarlas, moverlas y borrarlas es de admins.
 * En qué carpeta del equipo está un chat es uno por chat y para todos
 * (groups_chat_team_folders), y lo cambia cualquiera que puede editar el chat.
 * 'personal': de una persona (owner_id), como antes; nadie más las ve.
 */
export type FolderKind = 'team' | 'personal';

export interface LineFolderDto extends TreeFolder {
  name: string;
  /** Chats sin leer que ve quien mira, con los de las subcarpetas. */
  unread: number;
  /** Chats abiertos que ve quien mira (solo los de esta carpeta). */
  chats: number;
}

/** Las carpetas que ve una persona: las suyas (`folders`), las del equipo (`team`) y los chats sueltos. */
export interface LineFoldersData {
  folders: LineFolderDto[];
  team: LineFolderDto[];
  /** Chats que no están en ninguna carpeta de la persona ni en ninguna del equipo. */
  unfiled: { unread: number; chats: number };
}

/** Quién toca las carpetas del equipo: crearlas, renombrarlas, moverlas y borrarlas es de admins (roleAtLeast admin). */
export interface FolderActor {
  admin?: boolean;
}

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  position: number;
}

/**
 * Carpetas sin dueño: las que creó una instancia de la versión anterior que
 * seguía viva después de la migración (no conoce owner_id y guarda la carpeta
 * del chat en la columna de antes). Se reparan acá, antes de leer, con la misma
 * regla que la migración: pasan a quien las creó, con los chats que tenían.
 * Sin carpetas sin dueño es una sola consulta por su índice. Las del equipo
 * llevan owner_id = '' (no NULL): no entran acá.
 */
export async function adoptOwnerlessFolders(ws: string): Promise<void> {
  const db = getDb();
  if (!(await db.prepare('SELECT 1 AS x FROM groups_folders WHERE user_id = ? AND owner_id IS NULL LIMIT 1').get(ws))) return;
  for (const sql of folderOwnerBackfill(true)) await db.prepare(sql).run(ws);
}

/** Avisa en vivo solo a las otras pantallas de esta persona (nunca a otra) que cambió en qué carpeta tiene estos chats. */
async function notifyOwnScreens(ws: string, me: string, chatIds: string[]): Promise<void> {
  await notifyLive(ws, me, chatIds);
}

/** Avisa en vivo a todos los que ven estos chats (cambió su carpeta del equipo). */
async function notifyTeam(ws: string, chatIds: string[]): Promise<void> {
  await notifyLive(ws, '', chatIds);
}

async function notifyLive(ws: string, person: string, chatIds: string[]): Promise<void> {
  if (!chatIds.length) return;
  try {
    await getDb()
      .prepare(
        `INSERT INTO wa_live_events (app, scope_id, chat_id, number_id, person_id)
         SELECT 'lines', c.user_id, c.id, c.number_id, ? FROM groups_chats c WHERE c.user_id = ? AND c.id IN (${chatIds.map(() => '?').join(',')})`,
      )
      .run(person, ws, ...chatIds);
  } catch {
    // El aviso es una cortesía: si falla, la carpeta ya quedó guardada y la pantalla la trae en su próxima consulta.
  }
}

/** Una subcarpeta cuya carpeta de arriba no está en la lista (quedó así al pasar a carpetas personales) va al primer nivel. */
function rootOrphans(rows: FolderRow[]): FolderRow[] {
  const ids = new Set(rows.map((r) => r.id));
  return rows.map((r) => (r.parent_id && !ids.has(r.parent_id) ? { ...r, parent_id: null } : r));
}

/** Las carpetas de la persona (nunca las de otra ni las del equipo). */
async function folderRows(ws: string, me: string): Promise<FolderRow[]> {
  await adoptOwnerlessFolders(ws);
  return rootOrphans(
    (await getDb().prepare("SELECT id, parent_id, name, position FROM groups_folders WHERE user_id = ? AND owner_id = ? AND scope = 'personal' ORDER BY position, id").all(ws, me)) as FolderRow[],
  );
}

/** Las carpetas del equipo del workspace. */
async function teamFolderRows(ws: string): Promise<FolderRow[]> {
  return rootOrphans(
    (await getDb().prepare("SELECT id, parent_id, name, position FROM groups_folders WHERE user_id = ? AND scope = 'team' ORDER BY position, id").all(ws)) as FolderRow[],
  );
}

const rowsOf = (ws: string, me: string, kind: FolderKind) => (kind === 'team' ? teamFolderRows(ws) : folderRows(ws, me));

/** Condición SQL (y su argumento) que deja solo las carpetas de ese tipo: las del equipo, o las de `me`. */
const kindSql = (kind: FolderKind, me: string): { sql: string; args: string[] } => (kind === 'team' ? { sql: "scope = 'team'", args: [] } : { sql: "scope = 'personal' AND owner_id = ?", args: [me] });

const asTree = (rows: FolderRow[]): TreeFolder[] => rows.map((r) => ({ id: r.id, parentId: r.parent_id, position: r.position }));

/**
 * De qué tipo es la carpeta `id` para `me`: una del equipo o una suya. null si
 * no existe, es de otro workspace o es personal de otra persona (para quien
 * pregunta es lo mismo que una que no existe).
 */
export async function folderKindOf(ws: string, me: string, id: string): Promise<FolderKind | null> {
  if (!id) return null;
  const read = async () =>
    (await getDb().prepare('SELECT scope, owner_id FROM groups_folders WHERE id = ? AND user_id = ?').get(id, ws)) as { scope: string | null; owner_id: string | null } | undefined;
  let row = await read();
  if (!row) return null;
  if (row.scope === 'team') return 'team';
  if (row.owner_id === null) {
    await adoptOwnerlessFolders(ws);
    row = await read();
  }
  return row?.owner_id === me && row.scope !== 'team' ? 'personal' : null;
}

/** La carpeta y sus subcarpetas, con su tipo (null si quien pregunta no la ve). */
export async function resolveFolderScope(ws: string, me: string, folderId: string): Promise<{ kind: FolderKind; ids: string[] } | null> {
  const kind = await folderKindOf(ws, me, folderId);
  if (!kind) return null;
  const rows = await rowsOf(ws, me, kind);
  if (!rows.some((r) => r.id === folderId)) return null;
  return { kind, ids: [folderId, ...descendantIds(asTree(rows), folderId)] };
}

/** Ids de la carpeta y de todas sus subcarpetas, sea suya o del equipo (vacío si no existe o es de otra persona). */
export async function folderScope(ws: string, me: string, folderId: string): Promise<string[]> {
  return (await resolveFolderScope(ws, me, folderId))?.ids ?? [];
}

/** En qué carpeta tiene la persona cada uno de estos chats (los que no figuran no están en ninguna). */
export async function chatFoldersFor(ws: string, me: string, chatIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const db = getDb();
  for (let i = 0; i < chatIds.length; i += 400) {
    const chunk = chatIds.slice(i, i + 400);
    const rows = (await db
      .prepare(`SELECT chat_id, folder_id FROM groups_chat_folders WHERE user_id = ? AND person_id = ? AND chat_id IN (${chunk.map(() => '?').join(',')})`)
      .all(ws, me, ...chunk)) as Array<{ chat_id: string; folder_id: string }>;
    for (const r of rows) out.set(r.chat_id, r.folder_id);
  }
  return out;
}

/** En qué carpeta del equipo está cada uno de estos chats (la misma para todos; los que no figuran no están en ninguna). */
export async function teamFoldersFor(ws: string, chatIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const db = getDb();
  for (let i = 0; i < chatIds.length; i += 400) {
    const chunk = chatIds.slice(i, i + 400);
    const rows = (await db
      .prepare(`SELECT chat_id, folder_id FROM groups_chat_team_folders WHERE user_id = ? AND chat_id IN (${chunk.map(() => '?').join(',')})`)
      .all(ws, ...chunk)) as Array<{ chat_id: string; folder_id: string }>;
    for (const r of rows) out.set(r.chat_id, r.folder_id);
  }
  return out;
}

/** Arma la lista con los conteos (los no leídos suben a los padres: cada carpeta suma los de sus subcarpetas). */
function withCounts(rows: FolderRow[], per: Array<{ fid: string; n: number; u: number | null }>): LineFolderDto[] {
  const counts = new Map(per.map((r) => [r.fid, Number(r.n)]));
  const own = new Map(per.map((r) => [r.fid, Number(r.u ?? 0)]));
  const tree = asTree(rows);
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    position: r.position,
    name: r.name,
    unread: [r.id, ...descendantIds(tree, r.id)].reduce((sum, id) => sum + (own.get(id) ?? 0), 0),
    chats: counts.get(r.id) ?? 0,
  }));
}

/**
 * Las carpetas que ve la persona, con sus conteos: las suyas (`folders`) y
 * las del equipo (`team`). Cuenta solo chats que además puede ver (la regla de
 * acceso por línea y etiqueta): una carpeta del equipo nunca muestra chats de
 * una línea que la persona no ve, ni los cuenta. Una consulta por cada lista
 * de carpetas, una por los chats de cada tipo y una para los sueltos (no una
 * por carpeta), todas juntas.
 */
export async function listFolders(ws: string, me: string, viewer?: GroupsViewer): Promise<LineFoldersData> {
  const db = getDb();
  const [rows, teamRows] = await Promise.all([folderRows(ws, me), teamFolderRows(ws)]);
  const access = chatAccessSql(viewer, 'c');
  const accessSql = access ? ` AND ${access.sql}` : '';
  const accessArgs = access?.args ?? [];
  const base = `c.user_id = ? AND c.hidden_at IS NULL AND c.archived_at IS NULL AND c.status = 'open'${accessSql}`;
  type Per = Array<{ fid: string; n: number; u: number | null }>;
  type Count = { n: number; u: number | null };
  const filed = `c.id IN (SELECT zcf.chat_id FROM groups_chat_folders zcf WHERE zcf.user_id = ? AND zcf.person_id = ?
                  UNION SELECT ztf.chat_id FROM groups_chat_team_folders ztf WHERE ztf.user_id = ?)`;
  // Un chat está en una sola carpeta de la persona y en una sola del equipo: se cuenta agrupando (una fila por
  // carpeta) en vez de traer una fila por chat.
  const [per, perTeam, total, inFolders] = await Promise.all([
    db
      .prepare(
        `SELECT cf.folder_id AS fid, COUNT(*) AS n, SUM(CASE WHEN c.unread_count > 0 THEN 1 ELSE 0 END) AS u
         FROM groups_chat_folders cf JOIN groups_chats c ON c.id = cf.chat_id
         WHERE cf.user_id = ? AND cf.person_id = ? AND ${base} GROUP BY cf.folder_id`,
      )
      .all(ws, me, ws, ...accessArgs) as Promise<Per>,
    teamRows.length
      ? (db
          .prepare(
            `SELECT tf.folder_id AS fid, COUNT(*) AS n, SUM(CASE WHEN c.unread_count > 0 THEN 1 ELSE 0 END) AS u
             FROM groups_chat_team_folders tf JOIN groups_chats c ON c.id = tf.chat_id
             WHERE tf.user_id = ? AND ${base} GROUP BY tf.folder_id`,
          )
          .all(ws, ws, ...accessArgs) as Promise<Per>)
      : Promise.resolve([] as Per),
    // "Sin carpeta" = todos menos los que están en alguna carpeta (suya o del equipo). Sin acceso por línea ni
    // etiqueta, el total sale de dos conteos por sus índices, sin leer las filas; con acceso, se cuenta directo.
    access
      ? (db
          .prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN c.unread_count > 0 THEN 1 ELSE 0 END) AS u FROM groups_chats c WHERE ${base} AND NOT (${filed})`)
          .get(ws, ...accessArgs, ws, me, ws) as Promise<Count>)
      : (db
          .prepare(
            `SELECT (SELECT COUNT(*) FROM groups_chats c WHERE ${base}) AS n,
                    (SELECT COUNT(*) FROM groups_chats c WHERE ${base} AND c.unread_count > 0) AS u`,
          )
          .get(ws, ws) as Promise<Count>),
    // Los que están en alguna carpeta: se leen por la clave de cada chat (son pocos al lado de la bandeja).
    access
      ? Promise.resolve(null)
      : (db
          .prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN c.unread_count > 0 THEN 1 ELSE 0 END) AS u FROM groups_chats c WHERE ${filed} AND ${base}`)
          .get(ws, me, ws, ws) as Promise<Count>),
  ]);
  const unfiled = inFolders
    ? { chats: Math.max(0, Number(total.n) - Number(inFolders.n)), unread: Math.max(0, Number(total.u ?? 0) - Number(inFolders.u ?? 0)) }
    : { chats: Number(total.n), unread: Number(total.u ?? 0) };
  return { folders: withCounts(rows, per), team: withCounts(teamRows, perTeam), unfiled };
}

function cleanFolderName(raw: unknown): string {
  const name = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 60);
  if (!name) throw new GroupsError('invalid_name');
  return name;
}

function dupName(rows: FolderRow[], parentId: string | null, name: string, exceptId?: string): boolean {
  const key = name.toLowerCase();
  return rows.some((r) => r.id !== exceptId && (r.parent_id ?? null) === parentId && r.name.toLowerCase() === key);
}

/** Las del equipo las administran los admins: el resto recibe 403 (la carpeta la ve, así que no es 404). */
function assertTeamAdmin(kind: FolderKind, actor: FolderActor): void {
  if (kind === 'team' && !actor.admin) throw new GroupsError('forbidden', 403);
}

/**
 * Crea una carpeta: de la persona `me` o, con `team`, del equipo (solo admins).
 * La carpeta de arriba tiene que ser del mismo tipo (una suya, o una del equipo).
 */
export async function createFolder(
  ws: string,
  me: string,
  input: { name?: unknown; parentId?: string | null; team?: boolean },
  actor: FolderActor = {},
): Promise<{ id: string; name: string; parentId: string | null; kind: FolderKind }> {
  const kind: FolderKind = input.team ? 'team' : 'personal';
  assertTeamAdmin(kind, actor);
  const name = cleanFolderName(input.name);
  const rows = await rowsOf(ws, me, kind);
  if (rows.length >= 300) throw new GroupsError('too_many_folders');
  const parentId = input.parentId || null;
  if (parentId) {
    if (!rows.some((r) => r.id === parentId)) throw new GroupsError('invalid_parent');
    if (depthOf(asTree(rows), parentId) + 1 > MAX_FOLDER_DEPTH) throw new GroupsError('too_deep');
  }
  if (dupName(rows, parentId, name)) throw new GroupsError('duplicate_folder', 409);
  const id = randomUUID();
  const position = rows.filter((r) => (r.parent_id ?? null) === parentId).length;
  await getDb()
    .prepare('INSERT INTO groups_folders (id, user_id, owner_id, scope, parent_id, name, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ws, kind === 'team' ? '' : me, kind, parentId, name, position, me, nowIso());
  return { id, name, parentId, kind };
}

/**
 * Renombra o mueve una carpeta. Una suya: siempre. Una del equipo: solo un
 * admin (si no, 403), y solo dentro de las del equipo. La de otra persona es
 * 404, como una que no existe.
 */
export async function updateFolder(
  ws: string,
  me: string,
  id: string,
  input: { name?: unknown; parentId?: string | null; beforeId?: string | null },
  actor: FolderActor = {},
): Promise<void> {
  const kind = await folderKindOf(ws, me, id);
  if (!kind) throw new GroupsError('not_found', 404);
  assertTeamAdmin(kind, actor);
  const rows = await rowsOf(ws, me, kind);
  const row = rows.find((r) => r.id === id);
  if (!row) throw new GroupsError('not_found', 404);
  const db = getDb();
  const only = kindSql(kind, me);
  const moving = input.parentId !== undefined || input.beforeId !== undefined;
  let parentId = row.parent_id ?? null;
  if (moving) {
    parentId = input.parentId !== undefined ? input.parentId || null : parentId;
    const check = canMoveFolder(asTree(rows), id, parentId);
    if (check !== 'ok') throw new GroupsError(check, 400);
    // Ordenar antes de una carpeta de la otra sección (o de otra persona) no vale: se rechaza, no se ignora.
    if (input.beforeId && !rows.some((r) => r.id === input.beforeId)) throw new GroupsError('invalid_parent', 400);
  }
  const name = input.name !== undefined ? cleanFolderName(input.name) : row.name;
  if ((input.name !== undefined || moving) && dupName(rows, parentId, name, id)) throw new GroupsError('duplicate_folder', 409);
  if (input.name !== undefined) await db.prepare(`UPDATE groups_folders SET name = ? WHERE id = ? AND user_id = ? AND ${only.sql}`).run(name, id, ws, ...only.args);
  if (moving) {
    await db.prepare(`UPDATE groups_folders SET parent_id = ? WHERE id = ? AND user_id = ? AND ${only.sql}`).run(parentId, id, ws, ...only.args);
    for (const [sid, pos] of siblingOrder(asTree(rows), id, parentId, input.beforeId ?? null)) {
      await db.prepare(`UPDATE groups_folders SET position = ? WHERE id = ? AND user_id = ? AND ${only.sql}`).run(pos, sid, ws, ...only.args);
    }
  }
}

/**
 * Borra una carpeta y sus subcarpetas; los chats quedan sin esa carpeta (no
 * se borran). Una suya: lo que otras personas tienen en sus carpetas no
 * cambia. Una del equipo (solo admins, si no 403): los chats salen de esa
 * carpeta para todos, y lo que cada persona tiene en sus carpetas no cambia.
 * false si no existe o es de otra persona.
 */
export async function deleteFolder(ws: string, me: string, id: string, actor: FolderActor = {}): Promise<boolean> {
  const scope = await resolveFolderScope(ws, me, id);
  if (!scope) return false;
  assertTeamAdmin(scope.kind, actor);
  const { kind, ids } = scope;
  const db = getDb();
  const marks = ids.map(() => '?').join(',');
  const only = kindSql(kind, me);
  // La columna de antes (groups_chats.folder_id) no se toca: ni se lee ni se escribe.
  if (kind === 'team') {
    const inside = (await db.prepare(`SELECT chat_id FROM groups_chat_team_folders WHERE user_id = ? AND folder_id IN (${marks}) LIMIT 500`).all(ws, ...ids)) as Array<{
      chat_id: string;
    }>;
    await db.prepare(`DELETE FROM groups_chat_team_folders WHERE user_id = ? AND folder_id IN (${marks})`).run(ws, ...ids);
    await db.prepare(`DELETE FROM groups_folders WHERE user_id = ? AND ${only.sql} AND id IN (${marks})`).run(ws, ...only.args, ...ids);
    await notifyTeam(ws, inside.map((r) => r.chat_id));
    return true;
  }
  const inside = (await db.prepare(`SELECT chat_id FROM groups_chat_folders WHERE user_id = ? AND person_id = ? AND folder_id IN (${marks}) LIMIT 500`).all(ws, me, ...ids)) as Array<{
    chat_id: string;
  }>;
  await db.prepare(`DELETE FROM groups_chat_folders WHERE user_id = ? AND folder_id IN (${marks})`).run(ws, ...ids);
  await db.prepare(`DELETE FROM groups_folders WHERE user_id = ? AND ${only.sql} AND id IN (${marks})`).run(ws, ...only.args, ...ids);
  await notifyOwnScreens(ws, me, inside.map((r) => r.chat_id));
  return true;
}

/**
 * Pone chats en una carpeta (null = sacarlos). Solo los que la persona ve
 * (la misma regla que editar el chat); los demás cuentan como fallidos y no se
 * tocan.
 *
 * - Carpeta suya: cambia solo para ella; las demás personas no se enteran.
 * - Carpeta del equipo: cambia para todos (una carpeta del equipo por chat) y
 *   avisa en vivo a todos los que ven el chat. Lo puede hacer cualquiera que
 *   puede editar el chat; administrar la carpeta es de admins.
 * - Una carpeta de otra persona es 404, como una que no existe.
 * - Con null, `kind` dice de dónde se sacan: 'personal' (por defecto, de la
 *   suya), 'team' (de la del equipo) o 'all' (de las dos: "Sin carpeta").
 * Estar en una carpeta del equipo no saca al chat de la carpeta personal, ni al revés.
 */
export async function moveChatsToFolder(
  ws: string,
  viewer: GroupsViewer,
  chatIds: string[],
  folderId: string | null,
  opts: { kind?: FolderKind | 'all' } = {},
): Promise<{ updated: number; failed: number }> {
  const ids = [...new Set(chatIds)].slice(0, 200);
  if (ids.length === 0) return { updated: 0, failed: 0 };
  const db = getDb();
  const me = viewer.me;
  let kind: FolderKind | 'all' = opts.kind ?? 'personal';
  if (folderId) {
    const found = await folderKindOf(ws, me, folderId);
    if (!found) throw new GroupsError('not_found', 404);
    kind = found;
  }
  const access = chatAccessSql(viewer, 'c');
  const marks = ids.map(() => '?').join(',');
  const visible = (await db
    .prepare(`SELECT c.id FROM groups_chats c WHERE c.user_id = ? AND c.id IN (${marks})${access ? ` AND ${access.sql}` : ''}`)
    .all(ws, ...ids, ...(access?.args ?? []))) as Array<{ id: string }>;
  if (visible.length) {
    const vm = visible.map(() => '?').join(',');
    const vids = visible.map((v) => v.id);
    if (folderId && kind === 'team') {
      await db
        .prepare(
          `INSERT INTO groups_chat_team_folders (user_id, chat_id, folder_id, created_by, created_at)
           SELECT c.user_id, c.id, ?, ?, ? FROM groups_chats c WHERE c.user_id = ? AND c.id IN (${vm})
           ON CONFLICT(chat_id) DO UPDATE SET folder_id = excluded.folder_id, created_by = excluded.created_by, created_at = excluded.created_at`,
        )
        .run(folderId, me, nowIso(), ws, ...vids);
    } else if (folderId) {
      await db
        .prepare(
          `INSERT INTO groups_chat_folders (user_id, person_id, chat_id, folder_id, created_at)
           SELECT c.user_id, ?, c.id, ?, ? FROM groups_chats c WHERE c.user_id = ? AND c.id IN (${vm})
           ON CONFLICT(person_id, chat_id) DO UPDATE SET folder_id = excluded.folder_id, created_at = excluded.created_at`,
        )
        .run(me, folderId, nowIso(), ws, ...vids);
    } else {
      if (kind !== 'team') await db.prepare(`DELETE FROM groups_chat_folders WHERE user_id = ? AND person_id = ? AND chat_id IN (${vm})`).run(ws, me, ...vids);
      if (kind !== 'personal') await db.prepare(`DELETE FROM groups_chat_team_folders WHERE user_id = ? AND chat_id IN (${vm})`).run(ws, ...vids);
    }
    if (kind === 'personal') await notifyOwnScreens(ws, me, vids);
    else await notifyTeam(ws, vids);
  }
  return { updated: visible.length, failed: ids.length - visible.length };
}
