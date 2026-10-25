/**
 * Docs: chequeos de permisos compartidos por rutas, páginas y server actions
 * (tanda D3: roles de miembros, teamspaces, bloqueo y ajustes de seguridad).
 */
import type { SessionUser } from './session';
import type { DocsPageRow } from './db';
import { getDocAccess, getDocPageRow, parseBlocks, readableLinkTitles, type DocsActor } from './docs';
import {
  canWriteAccess,
  getDocsSettings,
  getTeamspace,
  hiddenTeamspaceIds,
  roleRank,
  teamspaceRoleOf,
  type DocsSettings,
} from './docs-access';
import { hydrateSyncedBlocks } from './docs-synced';
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
    if (!ts || ts.workspace_id !== user.id) return false;
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
  const hydrated = await hydrateSyncedBlocks(row.user_id, blocks ?? parseBlocks(row.content));
  const titles = await readableLinkTitles(actor, row, hydrated);
  return resolveBlocksPageLinks(hydrated, (id) => ({ href: pageLinkHref(id), title: titles.get(id) ?? null }));
}

export type { DocsAccess };
