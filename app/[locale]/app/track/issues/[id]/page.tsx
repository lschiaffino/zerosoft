import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import {
  getAccessibleIssue,
  listCycles,
  listIssueActivities,
  listIssueAttachments,
  listIssueChildren,
  listIssueRelations,
  listProjectMembers,
  listStatuses,
  getIssueParentChain,
} from '@/lib/track-data';
import { isSubscribedToIssue } from '@/lib/track-subscriptions';
import { listMilestones } from '@/lib/track-milestones';
import { getIssueReminder } from '@/lib/track-notify';
import { listIssueReactions } from '@/lib/track-ux';
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
  // El issue tiene que ser de un proyecto del workspace activo: sin esto
  // cualquiera con el UUID vería el issue, sus adjuntos y los miembros.
  const found = await getAccessibleIssue(id, user.team?.id ?? null, user.id);
  if (!found) notFound();
  const { issue, project } = found;

  const projectId = issue.project_id;
  const [statuses, cycles, members, children, parentChain, attachments, relations, activities, subscribed, milestones, reminder, reactions] = await Promise.all([
    listStatuses(projectId),
    listCycles(projectId),
    listProjectMembers(projectId, user.id),
    listIssueChildren(id),
    getIssueParentChain(id),
    listIssueAttachments(id),
    listIssueRelations(id),
    listIssueActivities(id),
    isSubscribedToIssue(id, realUserId(user)),
    listMilestones(projectId),
    getIssueReminder(id, realUserId(user)),
    listIssueReactions(id),
  ]);

  const t = await getTranslations({ locale, namespace: 'track' });

  return (
    <IssueDetailClient
      locale={locale}
      userId={realUserId(user)}
      initialIssue={issue}
      initialProjectName={project.name}
      initialStatuses={statuses}
      initialCycles={cycles}
      initialMilestones={milestones.map((m) => ({ id: m.id, name: m.name }))}
      initialReminder={reminder}
      initialMembers={members}
      initialChildren={children}
      initialParentChain={parentChain}
      initialAttachments={attachments}
      initialActivities={activities}
      initialRelations={relations}
      initialReactions={reactions}
      initialSubscribed={subscribed}
      ui={buildTrackUiLabels(t)}
      canDelete={isWorkspaceAdmin(user)}
      labels={{
        back: t('issues.breadcrumb'),
        description: t('issues.description'),
        untitled: t('issues.untitled'),
        createdOn: t.raw('issues.createdOn') as string,
        edit: {
          title: t('issues.editTitle'),
          descriptionPlaceholder: t('issues.descriptionPlaceholder'),
          more: t('issues.moreActions'),
          copyBranch: t('github.copyBranch'),
          copied: t('github.copied'),
          addSubtask: t('issues.addSubtask'),
          addAttachment: t('issues.addAttachment'),
          addRelation: t('issues.addRelation'),
          editDescription: t('issues.editDescription'),
        },
        subscription: {
          subscribe: t('subscription.subscribe'),
          unsubscribe: t('subscription.unsubscribe'),
          subscribed: t('subscription.subscribed'),
          notSubscribed: t('subscription.notSubscribed'),
          error: t('subscription.error'),
        },
        properties: {
          status: t('issues.status'),
          priority: t('issues.priority'),
          assignee: t('issues.assignee'),
          cycle: t('issues.cycle'),
          estimate: t('issues.estimate'),
          dueDate: t('issues.dueDate'),
          labels: t('issues.labels'),
          noAssignee: t('issues.noAssignee'),
          none: t('issues.none'),
          title: t('issues.detail.properties'),
          estimatePlaceholder: t('issues.estimatePlaceholder'),
          estimateUnit: t('issues.estimateUnit'),
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
          tooLarge: t('attachments.tooLarge'),
          typeNotAllowed: t('attachments.typeNotAllowed'),
          uploadError: t('attachments.uploadError'),
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
          submitComment: t('activity.submitComment'),
          empty: t('issues.detail.noComments'),
          editComment: t('activity.editComment'),
          deleteComment: t('activity.deleteComment'),
          deleteCommentConfirm: t('activity.deleteCommentConfirm'),
          saveComment: t('common.save'),
          cancelEdit: t('common.cancel'),
          edited: t('activity.edited'),
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
          add: t('relations.add'),
          remove: t('common.remove'),
          empty: t('relations.empty') ?? 'No relations yet.',
          selectIssue: t('relations.selectIssue') ?? 'Issue ID or identifier',
          selectType: t('relations.selectType') ?? 'Type',
          notFound: t('relations.notFound'),
          duplicate: t('relations.duplicate'),
          self: t('relations.self'),
          error: t('relations.error'),
          cancel: t('common.cancel'),
        },
        actions: {
          close: t('actions.close'),
          reopen: t('actions.reopen'),
        },
      }}
    />
  );
}
