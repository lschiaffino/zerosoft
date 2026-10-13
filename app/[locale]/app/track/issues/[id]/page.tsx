import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import {
  getIssue,
  getProject,
  listCycles,
  listIssueActivities,
  listIssueAttachments,
  listIssueChildren,
  listIssueRelations,
  listProjectMembers,
  listStatuses,
  getIssueParentChain,
} from '@/lib/track-data';
import IssueDetailClient from '@/components/track/IssueDetailClient';
import { buildTrackUiLabels } from '@/components/track/ui-labels';

export const dynamic = 'force-dynamic';

export default async function IssueDetailPage(
  props: {
    params: Promise<{ locale: string; id: string }>;
  }
) {
  const params = await props.params;

  const {
    locale,
    id
  } = params;

  const user = await requireUser(locale);
  const issue = await getIssue(id);
  if (!issue) notFound();

  const projectId = issue.project_id;
  const [project, statuses, cycles, members, children, parentChain, attachments, relations, activities] = await Promise.all([
    getProject(projectId),
    listStatuses(projectId),
    listCycles(projectId),
    listProjectMembers(projectId, user.id),
    listIssueChildren(id),
    getIssueParentChain(id),
    listIssueAttachments(id),
    listIssueRelations(id),
    listIssueActivities(id),
  ]);

  const t = await getTranslations({ locale, namespace: 'track' });

  return (
    <IssueDetailClient
      locale={locale}
      userId={user.id}
      initialIssue={issue}
      initialProjectName={project?.name ?? projectId}
      initialStatuses={statuses}
      initialCycles={cycles}
      initialMembers={members}
      initialChildren={children}
      initialParentChain={parentChain}
      initialAttachments={attachments}
      initialActivities={activities}
      initialRelations={relations}
      ui={buildTrackUiLabels(t)}
      labels={{
        back: t('issues.back'),
        description: t('issues.form.description'),
        properties: {
          status: t('issues.status'),
          priority: t('issues.priority'),
          assignee: t('issues.assignee'),
          cycle: t('issues.cycle'),
          estimate: t('issues.estimate'),
          dueDate: t('issues.dueDate'),
          labels: t('issues.labels'),
          noAssignee: t('issues.noAssignee'),
          none: '—',
        },
        priorities: [
          { value: 'urgent', label: t('priorities.urgent') },
          { value: 'high', label: t('priorities.high') },
          { value: 'medium', label: t('priorities.medium') },
          { value: 'low', label: t('priorities.low') },
        ],
        subtasks: {
          title: t('subtasks.title'),
          add: t('subtasks.add'),
          empty: t('subtasks.empty'),
          hasSubtasks: t('subtasks.hasSubtasks'),
        },
        attachments: {
          title: t('attachments.title'),
          upload: t('attachments.upload'),
          drop: t('attachments.drop'),
          empty: t('attachments.empty'),
          delete: t('attachments.delete'),
          size: t('attachments.size'),
        },
        activity: {
          title: t('activity.title'),
          created: t.raw('activity.created') as string,
          statusChange: t.raw('activity.statusChange') as string,
          assigneeChange: t.raw('activity.assigneeChange') as string,
          priorityChange: t.raw('activity.priorityChange') as string,
          cycleChange: t.raw('activity.cycleChange') as string,
          dueDateChange: t.raw('activity.dueDateChange') as string,
          estimateChange: t.raw('activity.estimateChange') as string,
          titleChange: t.raw('activity.titleChange') as string,
          descriptionChange: t.raw('activity.descriptionChange') as string,
          relationAdded: t.raw('activity.relationAdded') as string,
          relationRemoved: t.raw('activity.relationRemoved') as string,
          attachmentAdded: t.raw('activity.attachmentAdded') as string,
          subtaskAdded: t.raw('activity.subtaskAdded') as string,
          closed: t.raw('activity.closed') as string,
          reopened: t.raw('activity.reopened') as string,
          commented: t.raw('activity.commented') as string,
          from: t.raw('activity.from') as string,
          to: t.raw('activity.to') as string,
          unassigned: t.raw('activity.unassigned') as string,
          addComment: t('issues.detail.addComment'),
          submitComment: t('common.create'),
          empty: t('issues.detail.noComments'),
        },
        relations: {
          title: t('relations.title'),
          outgoing: t('relations.outgoing'),
          incoming: t('relations.incoming'),
          blocks: t('relations.blocks'),
          blockedBy: t('relations.blockedBy'),
          related: t('relations.related'),
          duplicates: t('relations.duplicates'),
          duplicatedBy: t('relations.duplicatedBy'),
          add: t('common.create'),
          remove: t('common.remove'),
          empty: t('relations.empty') ?? 'No relations yet.',
          selectIssue: t('relations.selectIssue') ?? 'Issue ID or identifier',
          selectType: t('relations.selectType') ?? 'Type',
        },
        actions: {
          close: t('actions.close'),
          reopen: t('actions.reopen'),
        },
      }}
    />
  );
}
