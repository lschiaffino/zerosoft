import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import AppTour from '@/components/tour/AppTour';
import AnalyticsBranch from '@/components/analytics/AnalyticsBranch';
import ProjectBar from '@/components/analytics/ProjectBar';
import { requireUser } from '@/lib/session';
import { currentProject } from '@/lib/analytics/projects';
import '@/styles/analytics.css';
import '@/styles/analytics-replay.css';
import '@/styles/analytics-more.css';

/** Analytics: selector de proyecto arriba, tableros en el sidebar y los textos de sus componentes. */
export default async function AnalyticsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const { project, projects } = await currentProject(user.id).catch(() => ({ project: null, projects: [] }));
  return (
    <ClientMessages locale={locale} namespaces={['analytics', 'analyticsReplay', 'analyticsMore']}>
      <ProjectBar projects={projects.map((p) => ({ id: p.id, name: p.name }))} currentId={project?.id ?? null} />
      {props.children}
      <AnalyticsBranch projectId={project?.id ?? null} />
      {/* Tour guiado de Pulse (lib/tours/pulse.ts): la primera vez, y desde el menú de la cuenta. */}
      <Suspense fallback={null}>
        <AppTour tour="pulse" />
      </Suspense>
    </ClientMessages>
  );
}
