import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { getWorkflow, listWorkflowRuns } from '@/lib/crm-workflows';
import { loadWorkflowEditorData } from '@/lib/crm-workflow-editor-data';
import WorkflowEditor from '@/components/crm/WorkflowEditor';
import PageHeader from '@/components/ui/PageHeader';

export const dynamic = 'force-dynamic';

export default async function WorkflowDetailPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm.workflows' });
  const workflow = await getWorkflow(user.id, id);
  if (!workflow) notFound();

  const [runs, data] = await Promise.all([listWorkflowRuns(user.id, id, 20), loadWorkflowEditorData(user)]);
  const admin = isWorkspaceAdmin(user);

  return (
    <div className="app-page ui-page ui-page-narrow">
      <PageHeader
        title={workflow.name}
        description={admin ? undefined : t('readOnly')}
        back={{ href: '/app/crm/workflows', label: t('title') }}
      />
      <WorkflowEditor workflow={workflow} runs={runs} canEdit={admin} {...data} />
    </div>
  );
}
