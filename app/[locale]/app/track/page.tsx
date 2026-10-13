import { getTranslations } from 'next-intl/server';
import QuickProjectButton from '@/components/track/QuickProjectButton';
import { requireUser } from '@/lib/session';
import { listProjects } from '@/lib/track-data';
import ProjectList from '@/components/track/ProjectList';

export const dynamic = 'force-dynamic';

export default async function TrackOverviewPage(
  props: {
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });
  const { rows: projects } = await listProjects(user.team?.id ?? null, user.id, { pageSize: 100 });

  return (
    <div className="app-page track-page">
      <div className="track-page-header">
        <div>
          <h1>{t('overview.title')}</h1>
          <p>{t('overview.subtitle')}</p>
        </div>
        <QuickProjectButton listenParam />
      </div>

      <ProjectList
        projects={projects}
        locale={locale}
        empty={{
          title: t('overview.emptyTitle'),
          sub: t('overview.emptySub'),
          cta: t('overview.emptyCta'),
        }}
        openIssuesLabel={t('projects.openIssues')}
      />
    </div>
  );
}
