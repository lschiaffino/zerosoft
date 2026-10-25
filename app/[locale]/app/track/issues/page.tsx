import { getTranslations } from 'next-intl/server';
import { realUserId, requireUser } from '@/lib/session';
import { listAllIssues, listProjectMetas } from '@/lib/track-data';
import CrossProjectIssues from '@/components/track/CrossProjectIssues';
import { buildTrackUiLabels } from '@/components/track/ui-labels';
import { parseIssueGroup, parseIssueSort } from '@/lib/track-views';

export const dynamic = 'force-dynamic';

const ISSUES_PAGE_SIZE = 50;

export default async function IssuesPage(
  props: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const params = await props.params;
  const search = await props.searchParams;
  // ?sort= y ?group= (los deja CrossProjectIssues al cambiar la vista).
  const sort = parseIssueSort(search.sort);
  const group = parseIssueGroup(search.group);

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });
  const teamId = user.team?.id ?? null;
  const [{ rows: issues, total }, projects] = await Promise.all([
    listAllIssues(teamId, user.id, { pageSize: ISSUES_PAGE_SIZE, sort }),
    listProjectMetas(teamId, user.id),
  ]);

  return (
    <div className="app-page track-page ui-page">
      <CrossProjectIssues
        userId={realUserId(user)}
        initialIssues={issues}
        projects={projects}
        locale={locale}
        title={t('issues.pageTitle')}
        newIssueLabel={t('project.newIssue')}
        ui={buildTrackUiLabels(t)}
        display={{ sort, group }}
        empty={{
          noProjectsTitle: t('overview.emptyTitle'),
          noProjectsBody: t('issues.noProjectsBody'),
          noProjectsCta: t('projects.newCta'),
        }}
        pagination={{
          total,
          pageSize: ISSUES_PAGE_SIZE,
          labels: {
            loading: t('common.loading'),
            loadMore: t('project.loadMore'),
            showing: t.raw('project.showing') as string,
          },
        }}
        labels={{
          identifier: t('issues.identifier'),
          title: t('issues.title'),
          status: t('issues.status'),
          priority: t('issues.priority'),
          assignee: t('issues.assignee'),
          cycle: t('issues.cycle'),
          created: t('issues.created'),
          dueDate: t('issues.dueDate'),
          labels: t('issues.labels'),
          noAssignee: t('issues.noAssignee'),
          empty: t('issues.empty'),
          hasSubtasks: t('subtasks.hasSubtasks'),
          project: t('quick.project'),
        }}
      />
    </div>
  );
}
