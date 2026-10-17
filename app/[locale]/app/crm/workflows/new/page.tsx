import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { loadWorkflowEditorData } from '@/lib/crm-workflow-editor-data';
import WorkflowEditor from '@/components/crm/WorkflowEditor';
import PageHeader from '@/components/ui/PageHeader';

export const dynamic = 'force-dynamic';

/** Workflow nuevo: asistente Disparador → Acciones → Revisar, con plantillas. */
export default async function NewWorkflowPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  if (!isWorkspaceAdmin(user)) redirect(`/${locale}/app/crm/workflows`);
  const t = await getTranslations({ locale, namespace: 'crm.workflows' });
  const data = await loadWorkflowEditorData(user);

  return (
    <div className="app-page ui-page ui-page-narrow">
      <PageHeader title={t('new')} description={t('wizard.desc')} back={{ href: '/app/crm/workflows', label: t('title') }} />
      <WorkflowEditor workflow={null} runs={[]} {...data} />
    </div>
  );
}
