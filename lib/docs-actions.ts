'use server';

import { redirect } from 'next/navigation';
import { createDocPage, deleteDocPage, moveDocPage, updateDocPage } from './docs';
import { getDocTemplate } from './docs-templates';

export async function createDocPageAction(ownerId: string, locale: string, parentId?: string | null) {
  const page = await createDocPage(ownerId, { parent_id: parentId ?? null });
  redirect(`/${locale}/app/docs/${page.id}`);
}

export async function createDocPageFromTemplateAction(
  ownerId: string,
  locale: string,
  templateKey: string,
) {
  const tpl = getDocTemplate(locale, templateKey);
  const page = await createDocPage(
    ownerId,
    tpl
      ? { title: tpl.title, icon: tpl.icon, content: tpl.makeBlocks() }
      : { title: '' },
  );
  redirect(`/${locale}/app/docs/${page.id}`);
}

export async function moveDocPageAction(ownerId: string, pageId: string, parentId: string | null) {
  await moveDocPage(ownerId, pageId, parentId);
}

export async function restoreDocPageAction(ownerId: string, pageId: string) {
  await updateDocPage(ownerId, pageId, { archived: false });
}

export async function deleteDocPageForeverAction(ownerId: string, pageId: string) {
  await deleteDocPage(ownerId, pageId);
}
