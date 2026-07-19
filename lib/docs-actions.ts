'use server';

import { redirect } from 'next/navigation';
import { createDocPage, moveDocPage } from './docs';

export async function createDocPageAction(ownerId: string, locale: string, parentId?: string | null) {
  const page = await createDocPage(ownerId, { parent_id: parentId ?? null });
  redirect(`/${locale}/app/docs/${page.id}`);
}

export async function moveDocPageAction(ownerId: string, pageId: string, parentId: string | null) {
  await moveDocPage(ownerId, pageId, parentId);
}
