import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import AnalyticsBranch from '@/components/analytics/AnalyticsBranch';
import ProjectBar from '@/components/analytics/ProjectBar';
import { requireUser } from '@/lib/session';
import { currentProject } from '@/lib/analytics/projects';
import '@/styles/analytics.css';

/** Analytics: selector de proyecto arriba, tableros en el sidebar y los textos de sus componentes. */
export default async function AnalyticsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const { project, projects } = await currentProject(user.id).catch(() => ({ project: null, projects: [] }));
  return (
    <ClientMessages locale={locale} namespaces={['analytics']}>
      <ProjectBar projects={projects.map((p) => ({ id: p.id, name: p.name }))} currentId={project?.id ?? null} />
      {props.children}
      <AnalyticsBranch projectId={project?.id ?? null} />
    </ClientMessages>
  );
}
