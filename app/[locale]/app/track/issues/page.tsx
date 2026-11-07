import { getTranslations } from 'next-intl/server';
import { realUserId, requireUser } from '@/lib/session';
import { listProjectMetas } from '@/lib/track-data';
import TrackIssueList from '@/components/track/TrackIssueList';
import EmptyState from '@/components/ui/EmptyState';
import { WORKSPACE_ISSUE_GROUPS } from '@/lib/track-views';

export const dynamic = 'force-dynamic';

const DEFAULTS = { group: 'status' as const, sort: 'updated' as const };

/**
 * Issues de todo el workspace, con la lista compartida (filtros, display,
 * lista o tablero). Filtros y display quedan guardados por persona.
 */
export default async function IssuesPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });
  const projects = await listProjectMetas(user.team?.id ?? null, user.id);

  return (
    <div className="app-page track-page ui-page">
      {projects.length === 0 ? (
        <>
          <h1 className="track-list-title">{t('issues.pageTitle')}</h1>
          <EmptyState
            title={t('overview.emptyTitle')}
            body={t('issues.noProjectsBody')}
            action={{ label: t('projects.newCta'), href: '/app/track/teams?newProject=1' }}
          />
        </>
      ) : (
        <TrackIssueList
          scope={{}}
          viewKey="workspace-issues"
          userId={realUserId(user)}
          groups={WORKSPACE_ISSUE_GROUPS}
          defaults={DEFAULTS}
          initialProjects={projects}
          tabs={<h1 className="track-list-title">{t('issues.pageTitle')}</h1>}
          empty={{ title: t('issues.empty') }}
        />
      )}
    </div>
  );
}
