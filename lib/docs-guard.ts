/**
 * Docs: chequeos de permisos compartidos por rutas, páginas y server actions
 * (tanda D3: roles de miembros, teamspaces, bloqueo y ajustes de seguridad).
 */
import type { SessionUser } from './session';
import type { DocsPageRow } from './db';
import { DOC_INTERNAL_READ, getDocAccess, getDocPageRow, parseBlocks, readableLinkTitles, type DocsActor } from './docs';
import { getDb } from './db';
import {
  aiKnowledgeFilterSql,
  canWriteAccess,
  getDocsSettings,
  getTeamspace,
  hiddenTeamspaceIds,
  roleRank,
  teamspaceRoleOf,
  type DocsSettings,
} from './docs-access';
import { hydrateSyncedBlocks, markUneditableSynced, unreadableSyncedIds, type SyncedReader } from './docs-synced';
import { pageLinkHref, resolveBlocksPageLinks } from './docs-page-links';
import type { DocsAccess, DocsBlock } from './docs-types';

/** Persona real (no el dueño del workspace en el que actúa). */
function me(user: Pick<SessionUser, 'id' | 'actingUser'>): string {
  return user.actingUser?.id ?? user.id;
}

/** Teamspaces cuyas páginas no se listan para esta persona. */
export async function docsHidden(user: SessionUser): Promise<string[]> {
  return hiddenTeamspaceIds(user.id, me(user));
}

/** Admin del workspace activo (o su dueño): mismo criterio que isWorkspaceAdmin. */
export function docsAdmin(user: SessionUser): boolean {
  return !user.actingUser || user.role === 'owner' || user.role === 'admin';
}

/**
 * ¿Puede crear una página? Subpágina: edición en el padre. De primer nivel:
 * admins; en un teamspace, sus miembros (o cualquiera si es abierto) con un
 * rol de edición; en el workspace, si el rol de los miembros es editar o más.
 */
export async function canCreateDocPage(
  user: SessionUser,
  input: { parent_id?: string | null; teamspace_id?: string | null },
): Promise<boolean> {
  if (input.parent_id) {
    const parent = await getDocPageRow(input.parent_id);
    if (!parent || parent.user_id !== user.id) return false;
    return canWriteAccess(await getDocAccess(parent, user));
  }
  if (input.teamspace_id) {
    const ts = await getTeamspace(input.teamspace_id);
    if (!ts || ts.workspace_id !== user.id || ts.deleted_at) return false;
    const mine = await teamspaceRoleOf(ts.id, me(user));
    if (mine === 'owner') return true;
    if (!mine && ts.access !== 'open') return false;
    if (docsAdmin(user)) return true;
    return roleRank(ts.member_role) >= roleRank('edit');
  }
  if (docsAdmin(user)) return true;
  const settings = await getDocsSettings(user.id);
  return roleRank(settings.member_role) >= roleRank('edit');
}

/** Árbol, papelera, publicar y compartir del workspace: acceso total ('owner'). */
export async function isDocOwnerAccess(user: SessionUser, pageId: string): Promise<DocsPageRow | null> {
  const row = await getDocPageRow(pageId);
  if (!row || row.user_id !== user.id) return null;
  return (await getDocAccess(row, user)) === 'owner' ? row : null;
}

/** Dueño real del workspace (no un miembro, ni un admin, ni un invitado). */
function isWorkspaceOwner(actor: DocsActor, workspaceId: string): boolean {
  return actor.id === workspaceId && (!actor.actingUser || actor.actingUser.id === workspaceId || actor.role === 'owner');
}

/**
 * ¿Puede leer un bloque sincronizado? Si puede abrir su página de origen. Sin
 * origen (se borró y no quedó otra página del mismo teamspace que lo use)
 * falla cerrado: solo el dueño del workspace.
 */
export async function canReadSynced(user: SessionUser, syncedId: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(syncedId)) return false;
  const src = (await getDb().prepare('SELECT source_page_id FROM docs_synced_blocks WHERE id = ? AND workspace_id = ?').get(syncedId, user.id)) as
    | { source_page_id: string | null }
    | undefined;
  if (!src) return false;
  return syncedReader(user, { id: '', user_id: user.id })(src.source_page_id);
}

/**
 * Quién puede ver el contenido de un bloque sincronizado dentro de `host`:
 * quien puede abrir su página de origen (como Notion). La propia página no
 * limita. Un origen que ya no existe falla cerrado (solo el dueño del workspace).
 */
export function syncedReader(actor: DocsActor, host: Pick<DocsPageRow, 'id' | 'user_id'>): SyncedReader {
  const cache = new Map<string, boolean>();
  return async (src) => {
    if (src && src === host.id) return true;
    if (!src) return isWorkspaceOwner(actor, host.user_id);
    const hit = cache.get(src);
    if (hit !== undefined) return hit;
    const row = await getDocPageRow(src);
    const ok = row
      ? row.user_id === host.user_id && (await getDocAccess(row, actor, DOC_INTERNAL_READ)) !== null
      : isWorkspaceOwner(actor, host.user_id);
    cache.set(src, ok);
    return ok;
  };
}

/** Lectores del centro de ayuda (sin sesión): solo si el origen existe y también está publicado. */
export function publicSyncedReader(host: Pick<DocsPageRow, 'id' | 'user_id'>): SyncedReader {
  const cache = new Map<string, boolean>();
  return async (src) => {
    if (src && src === host.id) return true;
    if (!src) return false;
    const hit = cache.get(src);
    if (hit !== undefined) return hit;
    const row = await getDocPageRow(src);
    const ok = !!row && row.user_id === host.user_id && row.published === 1 && row.archived === 0;
    cache.set(src, ok);
    return ok;
  };
}

/**
 * Bots y agentes (conocimiento de IA): un sincronizado cuenta solo si su
 * origen existe y también es conocimiento (la IA lo puede leer o está
 * publicado, o es una de las páginas elegidas a mano en `pageIds`) y su
 * teamspace lo permite.
 */
export function knowledgeSyncedReader(host: Pick<DocsPageRow, 'id' | 'user_id'>, pageIds: Iterable<string> = []): SyncedReader {
  const picked = new Set(pageIds);
  const cache = new Map<string, boolean>();
  return async (src) => {
    if (src && src === host.id) return true;
    if (!src) return false;
    const hit = cache.get(src);
    if (hit !== undefined) return hit;
    const row = (await getDb()
      .prepare(`SELECT id FROM docs_pages WHERE id = ? AND user_id = ? AND archived = 0 AND (is_public = 1 OR published = 1 OR id IN (${[...picked].map(() => '?').join(',') || "''"}))${aiKnowledgeFilterSql()}`)
      .get(src, host.user_id, ...picked)) as { id: string } | undefined;
    const ok = !!row;
    cache.set(src, ok);
    return ok;
  };
}

/** Sincronizados que `actor` no puede ver entre lo guardado y lo que llega (su contenido no se toca al guardar). */
export async function lockedSyncedIds(actor: DocsActor, row: DocsPageRow, incoming: DocsBlock[]): Promise<Set<string>> {
  return (await syncedLocks(actor, row, incoming)).locked;
}

/**
 * Sincronizados que `actor` no puede cambiar al guardar `row`: los que no
 * puede editar en su página de origen (`locked`, entre ellos los que ni
 * puede ver, `denied`). Su contenido no se toca; lo que llegue adentro se descarta.
 */
export async function syncedLocks(actor: DocsActor, row: DocsPageRow, incoming: DocsBlock[]): Promise<{ locked: Set<string>; denied: Set<string> }> {
  const all = [...parseBlocks(row.content), ...incoming];
  const denied = await unreadableSyncedIds(row.user_id, all, syncedReader(actor, row));
  const locked = new Set([...denied, ...(await unreadableSyncedIds(row.user_id, all, syncedEditor(actor, row)))]);
  return { locked, denied };
}

/**
 * Quién puede cambiar el contenido de un sincronizado desde `host`: quien
 * puede editar su página de origen. Ver el origen no alcanza. Sin origen,
 * solo el dueño del workspace.
 */
export function syncedEditor(actor: DocsActor, host: Pick<DocsPageRow, 'id' | 'user_id'>): SyncedReader {
  const cache = new Map<string, boolean>();
  return async (src) => {
    // La propia página: quien guarda ya la puede editar.
    if (src && src === host.id) return true;
    if (!src) return isWorkspaceOwner(actor, host.user_id);
    const hit = cache.get(src);
    if (hit !== undefined) return hit;
    const row = await getDocPageRow(src);
    const access = row && row.user_id === host.user_id ? await getDocAccess(row, actor, { includePublished: false, includePublicLink: false }) : null;
    const ok = row ? !!access && canWriteAccess(access) && row.locked !== 1 : isWorkspaceOwner(actor, host.user_id);
    cache.set(src, ok);
    return ok;
  };
}

/** Ajuste de seguridad (exportar, publicar, invitados): si está apagado, solo admins. */
export async function docsAllowed(
  user: SessionUser,
  workspaceId: string,
  key: keyof Pick<DocsSettings, 'allow_export' | 'allow_publish' | 'allow_guests'>,
): Promise<boolean> {
  const settings = await getDocsSettings(workspaceId);
  if (settings[key]) return true;
  // Un admin de ese workspace (no un invitado de otro).
  return user.id === workspaceId && docsAdmin(user);
}

/**
 * Bloques tal como los ve el editor: sincronizados con su contenido actual y
 * los links `[[` con el título vigente de las páginas que el actor puede
 * abrir. Lo usan la carga, el polling en vivo y la respuesta de guardar, así
 * la base de la fusión es la misma en todos lados.
 */
export async function editorBlocks(row: DocsPageRow, actor: DocsActor, blocks?: DocsBlock[]): Promise<DocsBlock[]> {
  const hydrated = await markUneditableSynced(row.user_id, await hydrateSyncedBlocks(row.user_id, blocks ?? parseBlocks(row.content), syncedReader(actor, row)), syncedEditor(actor, row));
  const titles = await readableLinkTitles(actor, row, hydrated);
  return resolveBlocksPageLinks(hydrated, (id) => ({ href: pageLinkHref(id), title: titles.get(id) ?? null }));
}

export type { DocsAccess };
