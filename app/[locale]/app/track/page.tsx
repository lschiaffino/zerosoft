import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listProjects } from '@/lib/track-data';
import ProjectList from '@/components/track/ProjectList';

export const dynamic = 'force-dynamic';

export default async function TrackOverviewPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
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
        <Link href={`/${locale}/app/track/projects/new`} className="btn btn-solid">
          {t('overview.emptyCta')}
        </Link>
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
