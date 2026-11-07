import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { isAppSection, sectionTakesId } from '@/lib/app-sections';
import { getDocument } from '@/lib/send/core';
import { getSpace } from '@/lib/send/spaces';
import { sendActorOf } from '@/lib/send/http';
import { SendError } from '@/lib/send/types';

async function exists(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    return Boolean(await fn());
  } catch (err) {
    if (err instanceof SendError) return false;
    throw err;
  }
}

/** Arriba de loading.tsx: una sección o un registro desconocido responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; zs?: string[] }> }) {
  const { locale, zs = [] } = await props.params;
  const [section, id] = zs;
  if (!isAppSection('send', section) || !sectionTakesId('send', section, id) || zs.length > 2) notFound();
  if (id) {
    const actor = sendActorOf(await requireUser(locale));
    if (section === 'documents' && !(await exists(() => getDocument(actor, id)))) notFound();
    if (section === 'spaces' && !(await exists(() => getSpace(actor, id)))) notFound();
  }
  return props.children;
}
