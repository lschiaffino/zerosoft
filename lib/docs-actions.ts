'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { routing } from '@/i18n/routing';
import {
  createDocPage,
  createDocPageFromWorkspaceTemplate,
  deleteDocWorkspaceTemplate,
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

/** Borra una plantilla del workspace: quien la guardó o un admin. */
export async function deleteDocWorkspaceTemplateAction(templateId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  const row = (await getDb()
    .prepare('SELECT created_by FROM docs_templates WHERE id = ? AND workspace_id = ?')
    .get(templateId, user.id)) as { created_by: string | null } | undefined;
  if (!row) return;
  if (row.created_by !== realUserId(user) && !isWorkspaceAdmin(user)) return;
  await deleteDocWorkspaceTemplate(user.id, templateId);
  revalidatePath('/[locale]/app/docs', 'page');
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
