import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { getProject, getProjectBySlug, canAccessTrackProject } from '@/lib/track-data';
import ProjectPageClient from '@/components/track/ProjectPageClient';
import { buildTrackUiLabels } from '@/components/track/ui-labels';

export const dynamic = 'force-dynamic';

/** Página de un team (proyecto de Track) por su clave (/app/track/team/WEB) o su id. */
export default async function TeamPage(
  props: {
    params: Promise<{ locale: string; key: string }>;
  }
) {
  const { locale, key } = await props.params;
  const param = decodeURIComponent(key);

  const user = await requireUser(locale);
  const project = (await getProject(param)) ?? (await getProjectBySlug(param.toLowerCase()));
  if (!project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) notFound();

  const t = await getTranslations({ locale, namespace: 'track' });

  return (
    <ProjectPageClient
      locale={locale}
      projectId={project.id}
      userId={user.id}
      isAdmin={isWorkspaceAdmin(user)}
      labels={{
        newIssue: t('project.newIssue'),
        issues: t('project.issues'),
        cycles: t('project.cycles'),
        noIssues: t('project.noIssues'),
        noAssignee: t('issues.noAssignee'),
        loading: t('common.loading'),
        loadMore: t('project.loadMore'),
        // Raw ICU template; the client substitutes {shown}/{total} at render time.
        showing: t.raw('project.showing') as string,
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
          updateError: t('gantt.updateError'),
        },
        priorities: [
          { value: 'urgent', label: t('priorities.urgent') },
          { value: 'high', label: t('priorities.high') },
          { value: 'medium', label: t('priorities.medium') },
          { value: 'low', label: t('priorities.low') },
        ],
        ui: buildTrackUiLabels(t),
        settings: t('project.settings'),
        workflowStatuses: t('statusSettings.title'),
      }}
    />
  );
}
