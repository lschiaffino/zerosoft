import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isAppSection, sectionTakesId } from '@/lib/app-sections';
import { requireUser } from '@/lib/session';
import { getCandidateProfile } from '@/lib/hiring/candidates';
import { getJob } from '@/lib/hiring/core';
import { actorOf } from '@/lib/hiring/http';

/** Arriba de loading.tsx: una sección o un registro desconocido responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; zs?: string[] }> }) {
  const { locale, zs = [] } = await props.params;
  const [section, id] = zs;
  if (!isAppSection('hiring', section) || !sectionTakesId('hiring', section, id)) notFound();
  if (section && id && id !== 'new') {
    const user = await requireUser(locale);
    const actor = actorOf(user);
    if (section === 'jobs' && !(await getJob(actor, id))) notFound();
    else if (section === 'candidates' && !(await getCandidateProfile(actor, id))) notFound();
  }
  return props.children;
}
