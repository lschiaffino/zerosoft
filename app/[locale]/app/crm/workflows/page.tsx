import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listWorkflows } from '@/lib/crm-workflows';
import WorkflowList from '@/components/crm/WorkflowList';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const workflows = await listWorkflows(user.id);

  return (
    <div className="app-page">
      <div className="page-header">
        <h1 className="page-title">{t('workflows.title')}</h1>
        <Link href="/app/crm/workflows/new" className="btn btn-solid">
          {t('workflows.new')}
        </Link>
      </div>
      <WorkflowList
        workflows={workflows}
        labels={{
          enabled: t('workflows.enabled'),
          disabled: t('workflows.disabled'),
          edit: t('common.edit'),
          runNow: t('workflows.runNow'),
          delete: t('workflows.deleteConfirm'),
          noWorkflows: t('workflows.noWorkflows'),
          triggerLabel: t('workflows.triggers'),
          actionsLabel: t('workflows.actions'),
        }}
      />
    </div>
  );
}
