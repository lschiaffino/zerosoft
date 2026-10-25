import { getTranslations } from 'next-intl/server';
import { realUserId, requireUser } from '@/lib/session';
import { listMyIssuesTab, listProjectMetas, MY_ISSUES_TABS, type MyIssuesTab } from '@/lib/track-data';
import CrossProjectIssues from '@/components/track/CrossProjectIssues';
import { buildTrackUiLabels } from '@/components/track/ui-labels';

export const dynamic = 'force-dynamic';

export default async function MyTasksPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const tab: MyIssuesTab = MY_ISSUES_TABS.includes(sp.tab as MyIssuesTab) ? (sp.tab as MyIssuesTab) : 'assigned';

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });
  const teamId = user.team?.id ?? null;
  const me = realUserId(user);
  const [issues, projects] = await Promise.all([
    listMyIssuesTab(teamId, user.id, me, tab),
    listProjectMetas(teamId, user.id),
  ]);

  return (
    <div className="app-page track-page ui-page">
      <CrossProjectIssues
        userId={me}
        initialIssues={issues}
        projects={projects}
        locale={locale}
        title={t('myTasks.title')}
        subtitle={t('myTasks.subtitle')}
        newIssueLabel={t('quick.newTask')}
        ui={buildTrackUiLabels(t)}
        empty={{
          noProjectsTitle: t('overview.emptyTitle'),
          noProjectsBody: t('issues.noProjectsBody'),
          noProjectsCta: t('projects.newCta'),
        }}
        tabs={{
          label: t('myTasks.tabs.label'),
          active: tab,
          items: MY_ISSUES_TABS.map((key) => ({
            key,
            label: t(`myTasks.tabs.${key}`),
            href: key === 'assigned' ? '/app/track/my-tasks' : `/app/track/my-tasks?tab=${key}`,
          })),
        }}
        mine={{
          userId: me,
          // Lo nuevo se asigna a mí solo en "Assigned" (en Created queda sin asignar).
          assignNew: tab === 'assigned',
          empty: t(`myTasks.emptyTab.${tab}`),
          emptyBody: t('myTasks.emptyBody'),
          groups: {
            overdue: t('myTasks.overdue'),
            today: t('myTasks.today'),
            upcoming: t('myTasks.upcoming'),
            none: t('myTasks.noDate'),
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
          empty: t('myTasks.empty'),
          hasSubtasks: t('subtasks.hasSubtasks'),
          project: t('quick.project'),
        }}
      />
    </div>
  );
}
