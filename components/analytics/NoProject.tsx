import { getTranslations } from 'next-intl/server';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';

/** Estado vacío de toda página de Analytics cuando el workspace no tiene proyectos. */
export default async function NoProject({ title, canManage }: { title: string; canManage: boolean }) {
  const t = await getTranslations('analytics.noProject');
  return (
    <div className="app-page ui-page an-page">
      <PageHeader title={title} />
      <EmptyState
        product="analytics"
        title={t('title')}
        body={canManage ? t('body') : t('bodyMember')}
        action={canManage ? { label: t('create'), href: '/app/analytics/projects?new=1' } : undefined}
      />
    </div>
  );
}
