import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listProjects } from '@/lib/track-data';
import PageHeader from '@/components/ui/PageHeader';
import ProjectList from './ProjectList';
import QuickProjectButton from './QuickProjectButton';

/** Proyectos de Track: la lista de proyectos con "Nuevo proyecto". */
export default async function ProjectsPage({ locale }: { locale: string }) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });
  const { rows: projects } = await listProjects(user.team?.id ?? null, user.id, { pageSize: 100 });

  return (
    <div className="app-page track-page ui-page">
      <PageHeader
        title={t('projects.title')}
        description={t('projects.subtitle')}
        actions={projects.length > 0 ? <QuickProjectButton listenParam /> : null}
      />
      <ProjectList
        projects={projects}
        labels={{
          caption: t('projects.title'),
          project: t('projects.column.project'),
          description: t('projects.form.description'),
          openIssues: t('projects.column.open'),
          emptyTitle: t('overview.emptyTitle'),
          emptyBody: t('overview.emptySub'),
          emptySecondary: t('overview.emptySecondary'),
          private: t('access.privateBadge'),
        }}
      />
    </div>
  );
}
