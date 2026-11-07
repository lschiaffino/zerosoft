import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { realUserId, requireUser } from '@/lib/session';
import { listProjectMetas, MY_ISSUES_TABS, type MyIssuesTab } from '@/lib/track-data';
import TrackIssueList from '@/components/track/TrackIssueList';
import EmptyState from '@/components/ui/EmptyState';
import { WORKSPACE_ISSUE_GROUPS } from '@/lib/track-views';

export const dynamic = 'force-dynamic';

const DEFAULTS = { group: 'status' as const, sort: 'updated' as const };

/**
 * Mis issues (como My issues de Linear): pestañas Assigned, Created,
 * Subscribed y Activity a la izquierda; Filter y Display a la derecha, en la
 * misma fila. Agrupa por status y se puede pasar a team o project.
 */
export default async function MyTasksPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const tab: MyIssuesTab = MY_ISSUES_TABS.includes(sp.tab as MyIssuesTab) ? (sp.tab as MyIssuesTab) : 'assigned';

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });
  const me = realUserId(user);
  const projects = await listProjectMetas(user.team?.id ?? null, user.id);

  const tabs = (
    <>
      <h1 className="track-list-title">{t('myTasks.title')}</h1>
      <nav className="track-team-tabs track-list-pagetabs" aria-label={t('myTasks.tabs.label')} data-testid="track-my-tabs">
        {MY_ISSUES_TABS.map((key) => (
          <Link
            key={key}
            href={key === 'assigned' ? '/app/track/my-tasks' : `/app/track/my-tasks?tab=${key}`}
            className={`track-team-tab${key === tab ? ' is-on' : ''}`}
            aria-current={key === tab ? 'page' : undefined}
            data-testid={`track-my-tab-${key}`}
          >
            {t(`myTasks.tabs.${key}`)}
          </Link>
        ))}
      </nav>
    </>
  );

  return (
    <div className="app-page track-page ui-page">
      {projects.length === 0 ? (
        <>
          <h1 className="track-list-title">{t('myTasks.title')}</h1>
          <EmptyState
            title={t('overview.emptyTitle')}
            body={t('issues.noProjectsBody')}
            action={{ label: t('projects.newCta'), href: '/app/track/teams?newProject=1' }}
          />
        </>
      ) : (
        <TrackIssueList
          key={tab}
          scope={{ mine: tab }}
          viewKey={`mine:${tab}`}
          userId={me}
          groups={WORKSPACE_ISSUE_GROUPS}
          defaults={DEFAULTS}
          initialProjects={projects}
          // Lo creado en "Assigned" se asigna a mí (en Created queda sin asignar).
          createDefaults={tab === 'assigned' ? { assigneeId: me } : undefined}
          tabs={tabs}
          empty={{ title: t(`myTasks.emptyTab.${tab}`), body: t('myTasks.emptyBody') }}
          testId="track-my-issues"
        />
      )}
    </div>
  );
}
