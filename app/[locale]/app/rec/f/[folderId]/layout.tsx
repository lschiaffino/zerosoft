import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { actorOf } from '@/lib/rec-http';
import { getFolder } from '@/lib/rec';
import { requireUser } from '@/lib/session';

/** Arriba de loading.tsx: una carpeta que no existe responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; folderId: string }> }) {
  const { locale, folderId } = await props.params;
  if (!(await getFolder(actorOf(await requireUser(locale)), folderId))) notFound();
  return props.children;
}
