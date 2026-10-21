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

export async function createDocPageAction(locale: string, parentId?: string | null) {
  const ownerId = await sessionOwnerId();
  const page = await createDocPage(ownerId, { parent_id: parentId ?? null });
  redirect(`/${safeLocale(locale)}/app/docs/${page.id}`);
}

export async function createDocPageFromTemplateAction(locale: string, templateKey: string) {
  const ownerId = await sessionOwnerId();
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
  const ownerId = await sessionOwnerId();
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

export async function moveDocPageAction(pageId: string, parentId: string | null) {
  const ownerId = await sessionOwnerId();
  await moveDocPage(ownerId, pageId, parentId);
}

export async function reorderDocPageAction(
  pageId: string,
  targetId: string,
  placement: DocDropPlacement,
) {
  if (placement !== 'before' && placement !== 'after') return;
  const ownerId = await sessionOwnerId();
  await reorderDocPage(ownerId, pageId, targetId, placement);
}

export async function moveDocPageStepAction(pageId: string, dir: -1 | 1) {
  if (dir !== -1 && dir !== 1) return;
  const ownerId = await sessionOwnerId();
  await moveDocPageStep(ownerId, pageId, dir);
}
