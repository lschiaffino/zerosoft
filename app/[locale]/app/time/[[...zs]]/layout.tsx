import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { isAppSection, sectionTakesId } from '@/lib/app-sections';
import { getProject } from '@/lib/time/core';
import { timeActorOf } from '@/lib/time/http';

/** Arriba de loading.tsx: una sección o un proyecto desconocido responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; zs?: string[] }> }) {
  const { locale, zs = [] } = await props.params;
  const [section, id, extra] = zs;
  if (extra || !isAppSection('time', section) || !sectionTakesId('time', section, id)) notFound();
  if (id && section === 'projects') {
    const actor = timeActorOf(await requireUser(locale));
    if (!(await getProject(actor, id))) notFound();
  }
  return props.children;
}
