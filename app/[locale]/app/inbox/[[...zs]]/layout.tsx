import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { realUserId, requireUser } from '@/lib/session';
import { isAppSection, sectionTakesId } from '@/lib/app-sections';
import { listFolders } from '@/lib/inbox/core';
import { isInboxView } from '@/lib/inbox/types';

/** Arriba de loading.tsx: una vista, carpeta o sección desconocida responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; zs?: string[] }> }) {
  const { locale, zs = [] } = await props.params;
  const [section, id] = zs;
  if (!isAppSection('inbox', section) || !sectionTakesId('inbox', section, id) || zs.length > 2) notFound();
  if ((section === 'v' || section === 'f') && !id) notFound();
  if (section === 'v' && !isInboxView(id)) notFound();
  if (section === 'f') {
    const owner = realUserId(await requireUser(locale));
    if (!(await listFolders(owner)).some((f) => f.id === id)) notFound();
  }
  return props.children;
}
