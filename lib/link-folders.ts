/**
 * Carpetas de links con acceso por carpeta (server-only).
 *
 * Las carpetas son del workspace (user_id = owner). El owner y los admins
 * editan todo. Cada miembro tiene el acceso por defecto de la carpeta
 * (default_access) salvo que tenga una excepción propia en
 * link_folder_members: 'none' (no la ve), 'view' (ve links y analytics) o
 * 'edit'. Los links sin carpeta siguen como siempre: todo el workspace los
 * ve y los edita.
 */
import { z } from 'zod';
import { getDb, type LinkFolderAccess, type LinkFolderMemberRow, type LinkFolderRow, type LinkRow } from './db';

export const FOLDER_ACCESS = ['none', 'view', 'edit'] as const;
export const MAX_FOLDERS = 200;

/** Quién mira: su id real (no el del owner) y si es admin del workspace. */
export interface LinkViewer {
  id: string;
  admin: boolean;
}

/** Viewer a partir del usuario de la sesión (SessionUser), sin importar la sesión acá. */
export function viewerOf(user: { id: string; actingUser?: { id: string }; role?: string }): LinkViewer {
  return {
    id: user.actingUser?.id ?? user.id,
    admin: !user.role || user.role === 'owner' || user.role === 'admin',
  };
}

const RANK: Record<LinkFolderAccess, number> = { none: 0, view: 1, edit: 2 };

/** El acceso alcanza lo pedido ('view' < 'edit'). */
export function accessAtLeast(access: LinkFolderAccess, need: Exclude<LinkFolderAccess, 'none'>): boolean {
  return RANK[access] >= RANK[need];
}

/** Acceso efectivo: admins editan; si no, la excepción de la persona o el default de la carpeta. */
export function resolveAccess(
  viewer: LinkViewer,
  folder: Pick<LinkFolderRow, 'default_access'> | null,
  override: LinkFolderAccess | null | undefined,
): LinkFolderAccess {
  if (!folder || viewer.admin) return 'edit';
  return override ?? folder.default_access;
}

/**
 * Condición SQL (alias l = links) de que el viewer ve el link: sin carpeta o
 * en una carpeta con acceso distinto de 'none'. Vacía para admins.
 */
export function visibleLinksSql(viewer: LinkViewer | undefined): { sql: string; args: string[] } {
  if (!viewer || viewer.admin) return { sql: '', args: [] };
  return {
    sql: `(l.folder_id IS NULL OR EXISTS (
      SELECT 1 FROM link_folders f
      WHERE f.id = l.folder_id
        AND COALESCE((SELECT m.access FROM link_folder_members m WHERE m.folder_id = f.id AND m.user_id = ?), f.default_access) != 'none'))`,
    args: [viewer.id],
  };
}

/** Condición SQL de que el viewer puede editar el link (para acciones masivas). */
export function editableLinksSql(viewer: LinkViewer | undefined): { sql: string; args: string[] } {
  if (!viewer || viewer.admin) return { sql: '', args: [] };
  return {
    sql: `(l.folder_id IS NULL OR EXISTS (
      SELECT 1 FROM link_folders f
      WHERE f.id = l.folder_id
        AND COALESCE((SELECT m.access FROM link_folder_members m WHERE m.folder_id = f.id AND m.user_id = ?), f.default_access) = 'edit'))`,
    args: [viewer.id],
  };
}

export interface FolderWithAccess extends LinkFolderRow {
  /** Acceso de quien mira. */
  access: LinkFolderAccess;
  links: number;
}

/** Carpetas que el viewer ve (con su acceso y cuántos links tienen). */
export async function listFolders(ownerId: string, viewer?: LinkViewer): Promise<FolderWithAccess[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT f.*, (SELECT m.access FROM link_folder_members m WHERE m.folder_id = f.id AND m.user_id = ?) AS override,
              (SELECT COUNT(*) FROM links l WHERE l.folder_id = f.id) AS links
       FROM link_folders f WHERE f.user_id = ? ORDER BY f.name COLLATE NOCASE, f.created_at`,
    )
    .all(viewer?.id ?? '', ownerId)) as Array<LinkFolderRow & { override: LinkFolderAccess | null; links: number }>;
  const v = viewer ?? { id: '', admin: true };
  return rows
    .map(({ override, ...f }) => ({ ...f, links: Number(f.links), access: resolveAccess(v, f, override) }))
    .filter((f) => f.access !== 'none');
}

export async function getFolder(ownerId: string, id: string): Promise<LinkFolderRow | undefined> {
  return (await getDb().prepare('SELECT * FROM link_folders WHERE id = ? AND user_id = ?').get(id, ownerId)) as
    | LinkFolderRow
    | undefined;
}

/** Acceso del viewer a una carpeta del workspace ('none' si no existe). */
export async function folderAccess(ownerId: string, folderId: string, viewer: LinkViewer): Promise<LinkFolderAccess> {
  const folder = await getFolder(ownerId, folderId);
  if (!folder) return 'none';
  if (viewer.admin) return 'edit';
  const row = (await getDb()
    .prepare('SELECT access FROM link_folder_members WHERE folder_id = ? AND user_id = ?')
    .get(folderId, viewer.id)) as { access: LinkFolderAccess } | undefined;
  return resolveAccess(viewer, folder, row?.access);
}

/** Acceso del viewer a un link (los links sin carpeta: edición para todos). */
export async function linkAccess(
  link: Pick<LinkRow, 'user_id'> & { folder_id?: string | null },
  viewer: LinkViewer | undefined,
): Promise<LinkFolderAccess> {
  if (!viewer || viewer.admin || !link.folder_id) return 'edit';
  return folderAccess(link.user_id, link.folder_id, viewer);
}

export const folderSchema = z.object({
  name: z.string().trim().min(1).max(60),
  defaultAccess: z.enum(FOLDER_ACCESS).optional(),
});

export const folderPatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  defaultAccess: z.enum(FOLDER_ACCESS).optional(),
  /** Excepciones por persona; null borra la de esa persona (vuelve al default). */
  members: z
    .array(z.object({ userId: z.string().min(1).max(64), access: z.enum(FOLDER_ACCESS).nullable() }))
    .max(200)
    .optional(),
});

export async function createFolder(
  ownerId: string,
  input: z.infer<typeof folderSchema>,
): Promise<{ ok: true; folder: LinkFolderRow } | { ok: false; code: 'too_many' | 'name_taken' }> {
  const db = getDb();
  const count = (await db.prepare('SELECT COUNT(*) AS c FROM link_folders WHERE user_id = ?').get(ownerId)) as { c: number };
  if (Number(count.c) >= MAX_FOLDERS) return { ok: false, code: 'too_many' };
  if (await nameTaken(ownerId, input.name)) return { ok: false, code: 'name_taken' };
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO link_folders (id, user_id, name, default_access) VALUES (?, ?, ?, ?)')
    .run(id, ownerId, input.name, input.defaultAccess ?? 'edit');
  return { ok: true, folder: (await getFolder(ownerId, id))! };
}

async function nameTaken(ownerId: string, name: string, exceptId = ''): Promise<boolean> {
  return !!(await getDb()
    .prepare('SELECT 1 AS x FROM link_folders WHERE user_id = ? AND lower(name) = lower(?) AND id != ?')
    .get(ownerId, name, exceptId));
}

/** Las personas del workspace: el owner y los miembros de sus teams. */
export async function workspacePeople(ownerId: string): Promise<Array<{ id: string; name: string | null; email: string }>> {
  return (await getDb()
    .prepare(
      `SELECT u.id, u.name, u.email FROM users u
       WHERE u.id = ? OR u.id IN (SELECT m.user_id FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.role != 'guest')
       ORDER BY COALESCE(u.name, u.email) LIMIT 500`,
    )
    .all(ownerId, ownerId)) as Array<{ id: string; name: string | null; email: string }>;
}

export async function updateFolder(
  ownerId: string,
  id: string,
  input: z.infer<typeof folderPatchSchema>,
): Promise<{ ok: true } | { ok: false; code: 'not_found' | 'name_taken' | 'invalid_member' }> {
  const db = getDb();
  if (!(await getFolder(ownerId, id))) return { ok: false, code: 'not_found' };
  if (input.name !== undefined) {
    if (await nameTaken(ownerId, input.name, id)) return { ok: false, code: 'name_taken' };
    await db.prepare('UPDATE link_folders SET name = ? WHERE id = ?').run(input.name, id);
  }
  if (input.defaultAccess !== undefined) {
    await db.prepare('UPDATE link_folders SET default_access = ? WHERE id = ?').run(input.defaultAccess, id);
  }
  if (input.members) {
    // Solo personas del workspace: no se puede dar acceso a alguien de afuera.
    const people = new Set((await workspacePeople(ownerId)).map((p) => p.id));
    if (input.members.some((m) => !people.has(m.userId))) return { ok: false, code: 'invalid_member' };
    for (const m of input.members) {
      if (m.access === null) {
        await db.prepare('DELETE FROM link_folder_members WHERE folder_id = ? AND user_id = ?').run(id, m.userId);
      } else {
        await db
          .prepare(
            `INSERT INTO link_folder_members (folder_id, user_id, access) VALUES (?, ?, ?)
             ON CONFLICT(folder_id, user_id) DO UPDATE SET access = excluded.access`,
          )
          .run(id, m.userId, m.access);
      }
    }
  }
  return { ok: true };
}

/** Borra la carpeta; sus links quedan sin carpeta (no se borran). */
export async function deleteFolder(ownerId: string, id: string): Promise<boolean> {
  const db = getDb();
  if (!(await getFolder(ownerId, id))) return false;
  await db.prepare('UPDATE links SET folder_id = NULL WHERE folder_id = ? AND user_id = ?').run(id, ownerId);
  await db.prepare('DELETE FROM link_folders WHERE id = ?').run(id);
  return true;
}

export async function listFolderMembers(folderId: string): Promise<LinkFolderMemberRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM link_folder_members WHERE folder_id = ?')
    .all(folderId)) as LinkFolderMemberRow[];
}
