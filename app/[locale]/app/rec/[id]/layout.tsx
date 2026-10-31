import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { actorOf } from '@/lib/rec-http';
import { getVideoRow } from '@/lib/rec';

/** Arriba de loading.tsx: un registro que no existe responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const video = await getVideoRow(actorOf(await requireUser(locale)), id);
  if (!video || video.status !== 'ready') notFound();
  return props.children;
}
