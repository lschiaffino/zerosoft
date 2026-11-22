import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { getWorkflowForViewer, listWorkflowRunViews, workflowWebhookSecret } from '@/lib/crm-workflows';
import { sessionFieldViewer } from '@/lib/crm-field-perms';
import { redactActionsForMember } from '@/lib/crm-workflow-rules';
import { sessionScope } from '@/lib/crm-visibility';
import { loadWorkflowEditorData } from '@/lib/crm-workflow-editor-data';
import WorkflowEditor from '@/components/crm/WorkflowEditor';
import PageHeader from '@/components/ui/PageHeader';

export const dynamic = 'force-dynamic';

export default async function WorkflowDetailPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm.workflows' });
  // Un workflow que nombra un campo que la persona tiene oculto no existe para ella.
  const found = await getWorkflowForViewer(sessionFieldViewer(user), id);
  if (!found) notFound();
  const admin = isWorkspaceAdmin(user);
  // Un miembro ve la config sin cabeceras ni URLs completas de webhooks, y el
  // historial solo con los registros que puede ver (nunca la salida de las acciones).
  const workflow = admin ? found : { ...found, actions: redactActionsForMember(found.actions) };
  const hasWebhook = found.actions.some((a) => a.type === 'webhook');

  const [runs, data, webhookSecret] = await Promise.all([
    listWorkflowRunViews(user.id, id, await sessionScope(user), 20),
    loadWorkflowEditorData(user),
    admin && hasWebhook ? workflowWebhookSecret(user.id, id) : Promise.resolve(null),
  ]);

  return (
    <div className="app-page ui-page ui-page-narrow">
      <PageHeader
        title={workflow.name}
        description={admin ? undefined : t('readOnly')}
        back={{ href: '/app/crm/workflows', label: t('title') }}
      />
      <WorkflowEditor workflow={workflow} runs={runs} canEdit={admin} webhookSecret={webhookSecret} {...data} />
    </div>
  );
}
