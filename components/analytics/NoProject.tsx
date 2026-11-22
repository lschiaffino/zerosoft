import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';

/** Estado vacío de toda página de Analytics cuando el workspace no tiene proyectos. */
export default async function NoProject({ title, canManage }: { title: string; canManage: boolean }) {
  const t = await getTranslations('analytics.noProject');
  return (
    <div className="app-page ui-page an-page">
      <PageHeader title={title} />
      <EmptyState
        product="pulse"
        title={t('title')}
        body={canManage ? t('body') : t('bodyMember')}
        action={
          canManage ? (
            // Anclaje del tour de Pulse (lib/tours/pulse.ts): crear el primer proyecto.
            <Link href="/app/pulse/projects?new=1" className="btn btn-primary" data-tour="pulse-new-project">
              {t('create')}
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}
