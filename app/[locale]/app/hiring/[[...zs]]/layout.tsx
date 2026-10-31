import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isAppSection, sectionTakesId } from '@/lib/app-sections';
import { requireUser } from '@/lib/session';
import { getCandidateProfile } from '@/lib/hiring/candidates';
import { canCreateJobs, getJob, getSettings } from '@/lib/hiring/core';
import { userCanUseApp } from '@/lib/workspace';
import { actorOf } from '@/lib/hiring/http';

/** Arriba de loading.tsx: una sección o un registro desconocido responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; zs?: string[] }> }) {
  const { locale, zs = [] } = await props.params;
  const [section, id, sub] = zs;
  if (zs.length > 3 || !isAppSection('hiring', section) || !sectionTakesId('hiring', section, id)) notFound();
  if (id === 'new' && section !== 'jobs') notFound();
  if (sub && (section !== 'jobs' || sub !== 'edit' || id === 'new')) notFound();
  const user = await requireUser(locale);
  if (user.role === 'guest' || !userCanUseApp(user, 'hiring')) notFound();
  if (section && id) {
    const actor = actorOf(user);
    if (id === 'new') {
      // La guarda solo lee: los ajustes iniciales los crea la página.
      const settings = await getSettings(actor.ws);
      if (settings && !canCreateJobs(actor, settings)) notFound();
    } else if (section === 'jobs') {
      const job = await getJob(actor, id);
      // Editar es de quien administra el puesto; el pipeline lo abre cualquiera que lo ve.
      if (!job || (sub === 'edit' && !job.canManage)) notFound();
    } else if (section === 'candidates' && !(await getCandidateProfile(actor, id))) notFound();
  }
  return props.children;
}
