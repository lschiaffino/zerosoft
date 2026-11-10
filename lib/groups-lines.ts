/**
 * Lines: dueño y visibilidad de cada línea (número), carpetas compartidas del
 * workspace y la línea que cada persona tiene elegida en la bandeja.
 *
 * - Dueño: una persona del workspace por línea. Siempre ve su línea.
 * - Visibilidad: 'all' (todo el workspace, por defecto) o 'restricted' (dueño,
 *   admins y las personas o equipos que figuren en groups_number_access). La
 *   regla vive en groups-access.ts (numberAccessSql / chatAccessSql) y se
 *   aplica en todas las rutas que leen chats.
 * - Carpetas: del workspace (todos ven las mismas), con subcarpetas hasta
 *   MAX_FOLDER_DEPTH. Los no leídos se cuentan por persona: solo chats que esa
 *   persona puede ver.
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

/** Cambia dueño, visibilidad y accesos de una línea (la ruta exige admin). */
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

/** Línea guardada de esta persona: id, o 'all' (todas). Si ya no la ve o no existe, 'all'. */
export async function getSelectedLine(viewer: GroupsViewer): Promise<string> {
  const r = (await getDb().prepare('SELECT value FROM groups_user_prefs WHERE user_id = ? AND person_id = ? AND key = ?').get(viewer.ws, viewer.me, LINE_KEY)) as
    | { value: string }
    | undefined;
  const v = r?.value ?? 'all';
  if (v === 'all') return 'all';
  return (await canSeeNumber(viewer, v)) ? v : 'all';
}

export async function setSelectedLine(viewer: GroupsViewer, line: string): Promise<string> {
  const value = line === 'all' || !line ? 'all' : line;
  if (value !== 'all' && !(await canSeeNumber(viewer, value))) throw new GroupsError('not_found', 404);
  await getDb()
    .prepare(
      `INSERT INTO groups_user_prefs (user_id, person_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, person_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(viewer.ws, viewer.me, LINE_KEY, value, nowIso());
  return value;
}

// ======================================================================
// Carpetas
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

async function folderRows(ws: string): Promise<FolderRow[]> {
  return (await getDb().prepare('SELECT id, parent_id, name, position FROM groups_folders WHERE user_id = ? ORDER BY position, id').all(ws)) as FolderRow[];
}

const asTree = (rows: FolderRow[]): TreeFolder[] => rows.map((r) => ({ id: r.id, parentId: r.parent_id, position: r.position }));

/** Ids de la carpeta y de todas sus subcarpetas (vacío si no existe). */
export async function folderScope(ws: string, folderId: string): Promise<string[]> {
  const rows = await folderRows(ws);
  if (!rows.some((r) => r.id === folderId)) return [];
  return [folderId, ...descendantIds(asTree(rows), folderId)];
}

/**
 * Carpetas del workspace con los conteos de quien mira. Una consulta para las
 * carpetas, una para los chats en carpetas y una para los sueltos (no una por
 * carpeta).
 */
export async function listFolders(ws: string, viewer?: GroupsViewer): Promise<{ folders: LineFolderDto[]; unfiled: { unread: number; chats: number } }> {
  const db = getDb();
  const rows = await folderRows(ws);
  const access = chatAccessSql(viewer, 'c');
  const accessSql = access ? ` AND ${access.sql}` : '';
  const accessArgs = access?.args ?? [];
  const base = `c.user_id = ? AND c.hidden_at IS NULL AND c.archived_at IS NULL AND c.status = 'open'${accessSql}`;
  // Un chat está en una sola carpeta: se cuenta agrupando (una fila por carpeta, del índice idx_groups_chats_folder_list)
  // en vez de traer una fila por chat. Las consultas van juntas: no esperan una a la otra.
  const [per, un] = await Promise.all([
    db
      .prepare(`SELECT c.folder_id AS fid, COUNT(*) AS n, SUM(CASE WHEN c.unread_count > 0 THEN 1 ELSE 0 END) AS u FROM groups_chats c WHERE ${base} AND c.folder_id IS NOT NULL GROUP BY c.folder_id`)
      .all(ws, ...accessArgs) as Promise<Array<{ fid: string; n: number; u: number | null }>>,
    // "Sin carpeta": con acceso por línea o etiqueta se cuenta directo; si no, el total (dos conteos que salen de sus
    // índices, sin leer las filas) menos lo que está en carpetas.
    access
      ? (db
          .prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN c.unread_count > 0 THEN 1 ELSE 0 END) AS u, 1 AS direct FROM groups_chats c WHERE ${base} AND c.folder_id IS NULL`)
          .get(ws, ...accessArgs) as Promise<{ n: number; u: number | null; direct: number }>)
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

export async function createFolder(ws: string, actor: string, input: { name?: unknown; parentId?: string | null }): Promise<{ id: string; name: string; parentId: string | null }> {
  const name = cleanFolderName(input.name);
  const rows = await folderRows(ws);
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
    .prepare('INSERT INTO groups_folders (id, user_id, parent_id, name, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, ws, parentId, name, position, actor, nowIso());
  return { id, name, parentId };
}

export async function updateFolder(ws: string, id: string, input: { name?: unknown; parentId?: string | null; beforeId?: string | null }): Promise<void> {
  const rows = await folderRows(ws);
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
  if (input.name !== undefined) await db.prepare('UPDATE groups_folders SET name = ? WHERE id = ? AND user_id = ?').run(name, id, ws);
  if (moving) {
    await db.prepare('UPDATE groups_folders SET parent_id = ? WHERE id = ? AND user_id = ?').run(parentId, id, ws);
    for (const [sid, pos] of siblingOrder(asTree(rows), id, parentId, input.beforeId ?? null)) {
      await db.prepare('UPDATE groups_folders SET position = ? WHERE id = ? AND user_id = ?').run(pos, sid, ws);
    }
  }
}

/** Borra la carpeta y sus subcarpetas; los chats quedan sin carpeta (no se borran). */
export async function deleteFolder(ws: string, id: string): Promise<boolean> {
  const ids = await folderScope(ws, id);
  if (ids.length === 0) return false;
  const db = getDb();
  const marks = ids.map(() => '?').join(',');
  await db.prepare(`UPDATE groups_chats SET folder_id = NULL WHERE user_id = ? AND folder_id IN (${marks})`).run(ws, ...ids);
  await db.prepare(`DELETE FROM groups_folders WHERE user_id = ? AND id IN (${marks})`).run(ws, ...ids);
  return true;
}

/**
 * Mueve chats a una carpeta (null = sacarlos). Solo los que la persona ve;
 * los demás cuentan como fallidos y no se tocan.
 */
export async function moveChatsToFolder(ws: string, viewer: GroupsViewer, chatIds: string[], folderId: string | null): Promise<{ updated: number; failed: number }> {
  const ids = [...new Set(chatIds)].slice(0, 200);
  if (ids.length === 0) return { updated: 0, failed: 0 };
  const db = getDb();
  if (folderId && !(await db.prepare('SELECT 1 AS x FROM groups_folders WHERE id = ? AND user_id = ?').get(folderId, ws))) throw new GroupsError('not_found', 404);
  const access = chatAccessSql(viewer, 'c');
  const marks = ids.map(() => '?').join(',');
  const visible = (await db
    .prepare(`SELECT c.id FROM groups_chats c WHERE c.user_id = ? AND c.id IN (${marks})${access ? ` AND ${access.sql}` : ''}`)
    .all(ws, ...ids, ...(access?.args ?? []))) as Array<{ id: string }>;
  if (visible.length) {
    const vm = visible.map(() => '?').join(',');
    await db
      .prepare(`UPDATE groups_chats SET folder_id = ?, updated_at = ? WHERE user_id = ? AND id IN (${vm})`)
      .run(folderId, nowIso(), ws, ...visible.map((v) => v.id));
  }
  return { updated: visible.length, failed: ids.length - visible.length };
}
