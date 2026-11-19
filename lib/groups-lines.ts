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
 * - Carpetas: de cada persona (groups_folders.owner_id), con subcarpetas hasta
 *   MAX_FOLDER_DEPTH. Nadie ve las de otra persona, tampoco un admin. En qué
 *   carpeta está un chat también es de cada persona (groups_chat_folders): el
 *   mismo chat puede estar en una carpeta mía y en otra, o en ninguna, de un
 *   compañero. Los conteos y el filtro usan solo chats que la persona puede ver.
 * Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { GroupsError, getNumberRow } from './groups';
import { chatAccessSql, canSeeNumber, type GroupsViewer } from './groups-access';
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
// Carpetas (de cada persona)
// ======================================================================

export interface LineFolderDto extends TreeFolder {
  name: string;
  /** Chats sin leer que ve quien mira, con los de las subcarpetas. */
  unread: number;
  /** Chats abiertos que ve quien mira (solo los de esta carpeta). */
  chats: number;
}

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  position: number;
}

/**
 * Las carpetas de la persona (nunca las de otra). Una subcarpeta cuya carpeta
 * de arriba no es suya (quedó así al pasar de carpetas del workspace a
 * carpetas personales) se muestra en el primer nivel.
 */
async function folderRows(ws: string, me: string): Promise<FolderRow[]> {
  const rows = (await getDb()
    .prepare('SELECT id, parent_id, name, position FROM groups_folders WHERE user_id = ? AND owner_id = ? ORDER BY position, id')
    .all(ws, me)) as FolderRow[];
  const own = new Set(rows.map((r) => r.id));
  return rows.map((r) => (r.parent_id && !own.has(r.parent_id) ? { ...r, parent_id: null } : r));
}

const asTree = (rows: FolderRow[]): TreeFolder[] => rows.map((r) => ({ id: r.id, parentId: r.parent_id, position: r.position }));

/** Ids de la carpeta y de todas sus subcarpetas (vacío si no existe o es de otra persona). */
export async function folderScope(ws: string, me: string, folderId: string): Promise<string[]> {
  const rows = await folderRows(ws, me);
  if (!rows.some((r) => r.id === folderId)) return [];
  return [folderId, ...descendantIds(asTree(rows), folderId)];
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

/**
 * Las carpetas de la persona con sus conteos: solo chats que tiene en sus
 * carpetas y que además puede ver (la regla de acceso por línea y etiqueta).
 * Una consulta para las carpetas, una para los chats en carpetas y una para
 * los sueltos (no una por carpeta).
 */
export async function listFolders(ws: string, me: string, viewer?: GroupsViewer): Promise<{ folders: LineFolderDto[]; unfiled: { unread: number; chats: number } }> {
  const db = getDb();
  const rows = await folderRows(ws, me);
  const access = chatAccessSql(viewer, 'c');
  const accessSql = access ? ` AND ${access.sql}` : '';
  const accessArgs = access?.args ?? [];
  const base = `c.user_id = ? AND c.hidden_at IS NULL AND c.archived_at IS NULL AND c.status = 'open'${accessSql}`;
  // Un chat está en una sola carpeta de la persona: se cuenta agrupando (una fila por carpeta) en vez de traer una
  // fila por chat. Las consultas van juntas: no esperan una a la otra.
  const [per, un] = await Promise.all([
    db
      .prepare(
        `SELECT cf.folder_id AS fid, COUNT(*) AS n, SUM(CASE WHEN c.unread_count > 0 THEN 1 ELSE 0 END) AS u
         FROM groups_chat_folders cf JOIN groups_chats c ON c.id = cf.chat_id
         WHERE cf.user_id = ? AND cf.person_id = ? AND ${base} GROUP BY cf.folder_id`,
      )
      .all(ws, me, ws, ...accessArgs) as Promise<Array<{ fid: string; n: number; u: number | null }>>,
    // "Sin carpeta": con acceso por línea o etiqueta se cuenta directo; si no, el total (dos conteos que salen de sus
    // índices, sin leer las filas) menos lo que la persona tiene en carpetas.
    access
      ? (db
          .prepare(
            `SELECT COUNT(*) AS n, SUM(CASE WHEN c.unread_count > 0 THEN 1 ELSE 0 END) AS u, 1 AS direct FROM groups_chats c
             WHERE ${base} AND NOT EXISTS (SELECT 1 FROM groups_chat_folders cf WHERE cf.chat_id = c.id AND cf.person_id = ?)`,
          )
          .get(ws, ...accessArgs, me) as Promise<{ n: number; u: number | null; direct: number }>)
      : (db
          .prepare(
            `SELECT (SELECT COUNT(*) FROM groups_chats c WHERE ${base}) AS n,
                    (SELECT COUNT(*) FROM groups_chats c WHERE ${base} AND c.unread_count > 0) AS u, 0 AS direct`,
          )
          .get(ws, ws) as Promise<{ n: number; u: number | null; direct: number }>),
  ]);
  const counts = new Map(per.map((r) => [r.fid, Number(r.n)]));
  const own = new Map(per.map((r) => [r.fid, Number(r.u ?? 0)]));
  if (!un.direct) {
    un.n = Math.max(0, Number(un.n) - per.reduce((sum, r) => sum + Number(r.n), 0));
    un.u = Math.max(0, Number(un.u ?? 0) - per.reduce((sum, r) => sum + Number(r.u ?? 0), 0));
  }
  // Los no leídos suben a los padres: cada carpeta suma los de sus subcarpetas.
  const tree = asTree(rows);
  const rolled = new Map(rows.map((r) => [r.id, [r.id, ...descendantIds(tree, r.id)].reduce((sum, id) => sum + (own.get(id) ?? 0), 0)]));
  return {
    folders: rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      position: r.position,
      name: r.name,
      unread: rolled.get(r.id) ?? 0,
      chats: counts.get(r.id) ?? 0,
    })),
    unfiled: { unread: Number(un.u ?? 0), chats: Number(un.n) },
  };
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

/** Crea una carpeta de la persona `me`. La carpeta de arriba tiene que ser suya. */
export async function createFolder(ws: string, me: string, input: { name?: unknown; parentId?: string | null }): Promise<{ id: string; name: string; parentId: string | null }> {
  const name = cleanFolderName(input.name);
  const rows = await folderRows(ws, me);
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
    .prepare('INSERT INTO groups_folders (id, user_id, owner_id, parent_id, name, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ws, me, parentId, name, position, me, nowIso());
  return { id, name, parentId };
}

/** Renombra o mueve una carpeta de la persona. La de otra persona es 404, como una que no existe. */
export async function updateFolder(ws: string, me: string, id: string, input: { name?: unknown; parentId?: string | null; beforeId?: string | null }): Promise<void> {
  const rows = await folderRows(ws, me);
  const row = rows.find((r) => r.id === id);
  if (!row) throw new GroupsError('not_found', 404);
  const db = getDb();
  const moving = input.parentId !== undefined || input.beforeId !== undefined;
  let parentId = row.parent_id ?? null;
  if (moving) {
    parentId = input.parentId !== undefined ? input.parentId || null : parentId;
    const check = canMoveFolder(asTree(rows), id, parentId);
    if (check !== 'ok') throw new GroupsError(check, 400);
  }
  const name = input.name !== undefined ? cleanFolderName(input.name) : row.name;
  if ((input.name !== undefined || moving) && dupName(rows, parentId, name, id)) throw new GroupsError('duplicate_folder', 409);
  if (input.name !== undefined) await db.prepare('UPDATE groups_folders SET name = ? WHERE id = ? AND user_id = ? AND owner_id = ?').run(name, id, ws, me);
  if (moving) {
    await db.prepare('UPDATE groups_folders SET parent_id = ? WHERE id = ? AND user_id = ? AND owner_id = ?').run(parentId, id, ws, me);
    for (const [sid, pos] of siblingOrder(asTree(rows), id, parentId, input.beforeId ?? null)) {
      await db.prepare('UPDATE groups_folders SET position = ? WHERE id = ? AND user_id = ? AND owner_id = ?').run(pos, sid, ws, me);
    }
  }
}

/**
 * Borra una carpeta de la persona y sus subcarpetas; los chats quedan sin
 * carpeta para ella (no se borran, y lo que otras personas tienen en sus
 * carpetas no cambia). false si no existe o es de otra persona.
 */
export async function deleteFolder(ws: string, me: string, id: string): Promise<boolean> {
  const ids = await folderScope(ws, me, id);
  if (ids.length === 0) return false;
  const db = getDb();
  const marks = ids.map(() => '?').join(',');
  await db.prepare(`DELETE FROM groups_chat_folders WHERE user_id = ? AND folder_id IN (${marks})`).run(ws, ...ids);
  // La columna de antes (groups_chats.folder_id) ya no se lee: se limpia para que no apunte a una carpeta que no existe.
  await db.prepare(`UPDATE groups_chats SET folder_id = NULL WHERE user_id = ? AND folder_id IN (${marks})`).run(ws, ...ids);
  await db.prepare(`DELETE FROM groups_folders WHERE user_id = ? AND owner_id = ? AND id IN (${marks})`).run(ws, me, ...ids);
  return true;
}

/**
 * Pone chats en una carpeta de la persona (null = sacarlos de la suya). Solo
 * los que la persona ve; los demás cuentan como fallidos y no se tocan. Una
 * carpeta de otra persona es 404, como una que no existe. No cambia en qué
 * carpeta tienen esos chats las demás personas.
 */
export async function moveChatsToFolder(ws: string, viewer: GroupsViewer, chatIds: string[], folderId: string | null): Promise<{ updated: number; failed: number }> {
  const ids = [...new Set(chatIds)].slice(0, 200);
  if (ids.length === 0) return { updated: 0, failed: 0 };
  const db = getDb();
  const me = viewer.me;
  if (folderId && !(await db.prepare('SELECT 1 AS x FROM groups_folders WHERE id = ? AND user_id = ? AND owner_id = ?').get(folderId, ws, me))) throw new GroupsError('not_found', 404);
  const access = chatAccessSql(viewer, 'c');
  const marks = ids.map(() => '?').join(',');
  const visible = (await db
    .prepare(`SELECT c.id FROM groups_chats c WHERE c.user_id = ? AND c.id IN (${marks})${access ? ` AND ${access.sql}` : ''}`)
    .all(ws, ...ids, ...(access?.args ?? []))) as Array<{ id: string }>;
  if (visible.length) {
    const vm = visible.map(() => '?').join(',');
    const vids = visible.map((v) => v.id);
    if (folderId) {
      await db
        .prepare(
          `INSERT INTO groups_chat_folders (user_id, person_id, chat_id, folder_id, created_at)
           SELECT c.user_id, ?, c.id, ?, ? FROM groups_chats c WHERE c.user_id = ? AND c.id IN (${vm})
           ON CONFLICT(person_id, chat_id) DO UPDATE SET folder_id = excluded.folder_id, created_at = excluded.created_at`,
        )
        .run(me, folderId, nowIso(), ws, ...vids);
    } else {
      await db.prepare(`DELETE FROM groups_chat_folders WHERE user_id = ? AND person_id = ? AND chat_id IN (${vm})`).run(ws, me, ...vids);
    }
  }
  return { updated: visible.length, failed: ids.length - visible.length };
}
