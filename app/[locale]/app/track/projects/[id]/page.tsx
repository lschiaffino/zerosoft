import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getProject } from '@/lib/track-data';
import ProjectPageClient from '@/components/track/ProjectPageClient';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}) {
  const user = await requireUser(locale);
  const project = await getProject(id);
  if (!project || project.team_id !== (user.team?.id ?? null)) notFound();

  const t = await getTranslations({ locale, namespace: 'track' });

  return (
    <ProjectPageClient
      locale={locale}
      projectId={id}
      userId={user.id}
      labels={{
        newIssue: t('project.newIssue'),
        issues: t('project.issues'),
        cycles: t('project.cycles'),
        noIssues: t('project.noIssues'),
        noAssignee: t('issues.noAssignee'),
        loading: t('common.loading'),
        viewSwitcher: {
          list: t('views.list'),
          board: t('views.board'),
          calendar: t('views.calendar'),
          gantt: t('views.gantt'),
        },
        filters: {
          status: t('filters.status'),
          priority: t('filters.priority'),
          assignee: t('filters.assignee'),
          cycle: t('filters.cycle'),
          labels: t('filters.labels'),
          dueDate: t('filters.dueDate'),
          search: t('filters.search'),
          clear: t('filters.clear'),
          saveView: t('savedViews.save'),
        },
        savedViews: {
          title: t('savedViews.title'),
          empty: t('savedViews.empty'),
          default: t('savedViews.default'),
          rename: t('savedViews.rename'),
          delete: t('savedViews.delete'),
          saveDialogTitle: t('savedViews.saveAs'),
          saveDialogName: t('savedViews.name'),
          saveDialogPlaceholder: t('savedViews.namePlaceholder'),
          save: t('common.save'),
          cancel: t('common.cancel'),
        },
        table: {
          identifier: t('issues.identifier'),
          title: t('issues.title'),
          status: t('issues.status'),
          priority: t('issues.priority'),
          assignee: t('issues.assignee'),
          cycle: t('issues.cycle'),
          created: t('issues.created'),
          dueDate: t('issues.dueDate'),
          labels: t('issues.labels'),
          hasSubtasks: t('subtasks.hasSubtasks'),
        },
        board: {
          empty: t('project.noIssues'),
        },
        calendar: {
          prev: t('calendar.prev'),
          next: t('calendar.next'),
          today: t('calendar.today'),
          unscheduled: t('calendar.unscheduled'),
        },
        gantt: {
          prev: t('gantt.prev'),
          next: t('gantt.next'),
          today: t('gantt.today'),
          unscheduled: t('gantt.unscheduled'),
        },
        priorities: [
          { value: 'urgent', label: t('priorities.urgent') },
          { value: 'high', label: t('priorities.high') },
          { value: 'medium', label: t('priorities.medium') },
          { value: 'low', label: t('priorities.low') },
        ],
      }}
    />
  );
}
