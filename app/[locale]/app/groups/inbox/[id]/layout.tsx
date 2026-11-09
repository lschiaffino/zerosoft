import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getChatRow } from '@/lib/groups';
import { canSeeChat, groupsViewer } from '@/lib/groups-access';
import { requireUser } from '@/lib/session';

/** Arriba de loading.tsx: un chat que no existe (o que no se ve) responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const chat = await getChatRow(user.id, id);
  if (!chat) notFound();
  if (!(await canSeeChat(await groupsViewer(user.id, user.actingUser?.id ?? user.id, user.role), chat.id))) notFound();
  return props.children;
}
