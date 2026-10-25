'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { routing } from '@/i18n/routing';
import {
  createDocPage,
  createDocPageFromWorkspaceTemplate,
  deleteDocWorkspaceTemplate,
  renameDocWorkspaceTemplate,
  moveDocPage,
  moveDocPageStep,
  reorderDocPage,
  type DocDropPlacement,
} from './docs';
import { getDocTemplate } from './docs-templates';
import { getDb } from './db';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from './session';
import { canCreateDocPage, isDocOwnerAccess } from './docs-guard';
import { setSubtreeTeamspace } from './docs-access';
import { logDocsAudit } from './docs-audit';
import { collectDescendants } from './docs';

/**
 * Las server actions son endpoints públicos: cualquiera puede invocarlas con
 * los argumentos que quiera (los de un `.bind` viajan en claro desde el
 * cliente). Por eso el dueño SIEMPRE sale de la sesión, nunca de un argumento.
 */
async function sessionOwnerId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  return user.id;
}

function safeLocale(locale: string): string {
  return (routing.locales as readonly string[]).includes(locale) ? locale : routing.defaultLocale;
}

/**
 * Crear una página: subpágina con edición en el padre; de primer nivel según
 * el rol de los miembros (o del teamspace). Sin permiso vuelve a Docs.
 */
export async function createDocPageAction(
  locale: string,
  parentId?: string | null | FormData,
  teamspaceId?: string | null | FormData,
) {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  // Usada también como action de un <form>: el FormData llega en lugar de los ids.
  let pid = typeof parentId === 'string' && parentId ? parentId : null;
  // Un padre de otro workspace no cuenta: la página queda de primer nivel en el propio.
  if (pid) {
    const parent = (await getDb().prepare('SELECT user_id FROM docs_pages WHERE id = ?').get(pid)) as { user_id: string } | undefined;
    if (!parent || parent.user_id !== user.id) pid = null;
  }
  const tid = typeof teamspaceId === 'string' && teamspaceId ? teamspaceId : null;
  const input = { parent_id: pid, teamspace_id: pid ? null : tid };
  if (!(await canCreateDocPage(user, input))) redirect(`/${safeLocale(locale)}/app/docs?denied=1`);
  const page = await createDocPage(user.id, input);
  await logDocsAudit({ workspaceId: user.id, actor: user.actingUser ?? user, action: 'page.created', page: { id: page.id, title: page.title } });
  redirect(`/${safeLocale(locale)}/app/docs/${page.id}`);
}

/** Crear de primer nivel en el workspace (plantillas): mismo permiso que una página nueva. */
async function rootCreator(locale: string): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  if (!(await canCreateDocPage(user, {}))) redirect(`/${safeLocale(locale)}/app/docs?denied=1`);
  return user.id;
}

export async function createDocPageFromTemplateAction(locale: string, templateKey: string) {
  const ownerId = await rootCreator(locale);
  const tpl = getDocTemplate(locale, templateKey);
  const page = await createDocPage(
    ownerId,
    tpl
      ? { title: tpl.title, icon: tpl.icon, content: tpl.makeBlocks() }
      : { title: '' },
  );
  redirect(`/${safeLocale(locale)}/app/docs/${page.id}`);
}

/** Página nueva desde una plantilla guardada por el workspace. */
export async function createDocPageFromWorkspaceTemplateAction(locale: string, templateId: string) {
  const ownerId = await rootCreator(locale);
  const page = await createDocPageFromWorkspaceTemplate(ownerId, templateId);
  // Plantilla borrada mientras tanto: de vuelta al inicio de Docs.
  redirect(page ? `/${safeLocale(locale)}/app/docs/${page.id}` : `/${safeLocale(locale)}/app/docs`);
}

/**
 * Quien puede tocar una plantilla del workspace: quien la guardó o un admin.
 * Devuelve el workspace (dueño) o null si no existe o no hay permiso.
 */
async function editableTemplateOwner(templateId: string): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  const row = (await getDb()
    .prepare('SELECT created_by FROM docs_templates WHERE id = ? AND workspace_id = ?')
    .get(templateId, user.id)) as { created_by: string | null } | undefined;
  if (!row) return null;
  if (row.created_by !== realUserId(user) && !isWorkspaceAdmin(user)) return null;
  return user.id;
}

/** Borra una plantilla del workspace: quien la guardó o un admin. */
export async function deleteDocWorkspaceTemplateAction(templateId: string): Promise<boolean> {
  const owner = await editableTemplateOwner(templateId);
  if (!owner) return false;
  const ok = await deleteDocWorkspaceTemplate(owner, templateId);
  revalidatePath('/[locale]/app/docs', 'page');
  return ok;
}

/** Renombra una plantilla del workspace: quien la guardó o un admin. */
export async function renameDocWorkspaceTemplateAction(templateId: string, title: string): Promise<boolean> {
  if (typeof title !== 'string') return false;
  const owner = await editableTemplateOwner(templateId);
  if (!owner) return false;
  const ok = await renameDocWorkspaceTemplate(owner, templateId, title);
  revalidatePath('/[locale]/app/docs', 'page');
  return ok;
}

/**
 * Mover en el árbol: acceso total a la página y, si cambia de lugar, también
 * al destino (no se mete una página adentro de otra que no se puede editar).
 */
async function treeOwner(pageId: string, targetId?: string | null): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  if (!(await isDocOwnerAccess(user, pageId))) return null;
  if (targetId && !(await isDocOwnerAccess(user, targetId))) return null;
  return user.id;
}

export async function moveDocPageAction(pageId: string, parentId: string | null) {
  const ownerId = await treeOwner(pageId, parentId);
  if (!ownerId) return;
  await moveDocPage(ownerId, pageId, parentId);
}

export async function reorderDocPageAction(
  pageId: string,
  targetId: string,
  placement: DocDropPlacement,
) {
  if (placement !== 'before' && placement !== 'after') return;
  const ownerId = await treeOwner(pageId, targetId);
  if (!ownerId) return;
  await reorderDocPage(ownerId, pageId, targetId, placement);
}

export async function moveDocPageStepAction(pageId: string, dir: -1 | 1) {
  if (dir !== -1 && dir !== 1) return;
  const ownerId = await treeOwner(pageId);
  if (!ownerId) return;
  await moveDocPageStep(ownerId, pageId, dir);
}

/** Mover una página (con su subárbol) a un teamspace o a "Workspace" (null), como "Move to" de Notion. */
export async function moveDocPageToTeamspaceAction(pageId: string, teamspaceId: string | null): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  const row = await isDocOwnerAccess(user, pageId);
  if (!row) return false;
  if (teamspaceId && !(await canCreateDocPage(user, { teamspace_id: teamspaceId }))) return false;
  if (!teamspaceId && !(await canCreateDocPage(user, {}))) return false;
  // Pasa a ser de primer nivel del teamspace destino.
  if (row.parent_id) await getDb().prepare('UPDATE docs_pages SET parent_id = NULL, position = NULL WHERE id = ? AND user_id = ?').run(pageId, user.id);
  await setSubtreeTeamspace(user.id, await collectDescendants(user.id, pageId), teamspaceId);
  await logDocsAudit({ workspaceId: user.id, actor: user.actingUser ?? user, action: 'page.moved', page: { id: row.id, title: row.title }, detail: `teamspace:${teamspaceId ?? 'workspace'}` });
  revalidatePath('/[locale]/app/docs', 'layout');
  return true;
}
