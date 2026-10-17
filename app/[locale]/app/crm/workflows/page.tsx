import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { listWorkflows } from '@/lib/crm-workflows';
import WorkflowList from '@/components/crm/WorkflowList';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm.workflows' });
  const tc = await getTranslations({ locale, namespace: 'crm.common' });
  const workflows = await listWorkflows(user.id);
  const admin = isWorkspaceAdmin(user);

  return (
    <div className="app-page ui-page">
      <PageHeader
        title={t('title')}
        description={admin ? t('subtitle') : tc('adminOnly')}
        actions={
          admin && workflows.length > 0 ? (
            <Link href="/app/crm/workflows/new" className="btn btn-primary" data-testid="workflow-new">
              {t('create')}
            </Link>
          ) : undefined
        }
      />
      {workflows.length === 0 ? (
        <EmptyState
          title={t('noWorkflows')}
          body={t('emptySub')}
          action={admin ? { label: t('createFirst'), href: '/app/crm/workflows/new' } : undefined}
        />
      ) : (
        <WorkflowList workflows={workflows} canEdit={admin} />
      )}
    </div>
  );
}
