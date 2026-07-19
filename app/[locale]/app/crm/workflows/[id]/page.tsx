import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getWorkflow, listWorkflowRuns } from '@/lib/crm-workflows';
import { listLists } from '@/lib/crm';
import WorkflowEditor from '@/components/crm/WorkflowEditor';

export const dynamic = 'force-dynamic';

export default async function WorkflowDetailPage({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const workflow = await getWorkflow(user.id, id);
  if (!workflow) notFound();

  const runs = await listWorkflowRuns(user.id, id, 20);
  const lists = await listLists(user.id);

  return (
    <div className="app-page">
      <Link href="/app/crm/workflows" className="mono back-link">
        {t('common.back')}
      </Link>
      <h1 className="page-title">{workflow.name}</h1>
      <WorkflowEditor
        workflow={workflow}
        lists={lists}
        runs={runs}
        labels={{
          name: t('workflows.name'),
          enabled: t('workflows.enabled'),
          disabled: t('workflows.disabled'),
          triggers: t('workflows.triggers'),
          actions: t('workflows.actions'),
          addTrigger: t('workflows.addTrigger'),
          addAction: t('workflows.addAction'),
          save: t('common.save'),
          saving: t('common.saving'),
          runNow: t('workflows.runNow'),
          delete: t('common.delete'),
          deleteConfirm: t('workflows.deleteConfirm'),
          runs: t('workflows.runs'),
          noRuns: t('workflows.noRuns'),
          runStatus: {
            pending: t('workflows.runStatus.pending'),
            running: t('workflows.runStatus.running'),
            done: t('workflows.runStatus.done'),
            failed: t('workflows.runStatus.failed'),
          },
          triggerTypes: {
            contact_created: t('workflows.triggerTypes.contact_created'),
            contact_updated: t('workflows.triggerTypes.contact_updated'),
            deal_created: t('workflows.triggerTypes.deal_created'),
            deal_stage_changed: t('workflows.triggerTypes.deal_stage_changed'),
            deal_won: t('workflows.triggerTypes.deal_won'),
            deal_lost: t('workflows.triggerTypes.deal_lost'),
            task_due: t('workflows.triggerTypes.task_due'),
            email_received: t('workflows.triggerTypes.email_received'),
            manual: t('workflows.triggerTypes.manual'),
          },
          actionTypes: {
            send_email: t('workflows.actionTypes.send_email'),
            create_task: t('workflows.actionTypes.create_task'),
            create_activity: t('workflows.actionTypes.create_activity'),
            update_field: t('workflows.actionTypes.update_field'),
            add_to_list: t('workflows.actionTypes.add_to_list'),
            webhook: t('workflows.actionTypes.webhook'),
            notify_user: t('workflows.actionTypes.notify_user'),
          },
          fromStageId: t('workflows.fromStageId'),
          toStageId: t('workflows.toStageId'),
          to: t('common.to'),
          subject: t('common.subject'),
          body: t('common.body'),
          dueInDays: t('workflows.dueInDays'),
          ownerId: t('workflows.ownerId'),
          entity: t('workflows.entity'),
          field: t('workflows.field'),
          value: t('workflows.value'),
          listId: t('workflows.listId'),
          url: t('workflows.url'),
          method: t('workflows.method'),
          headers: t('workflows.headers'),
          message: t('workflows.message'),
        }}
      />
    </div>
  );
}
