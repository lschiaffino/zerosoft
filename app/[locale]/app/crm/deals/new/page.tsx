import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { requireUser } from '@/lib/session';
import { listPipelinesWithStages, PRIORITIES, SOURCES } from '@/lib/crm';
import DealFullForm from '@/components/crm/DealFullForm';

export const dynamic = 'force-dynamic';

interface NewDealPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewDealPage(props: NewDealPageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  // Sin parámetros, /new abre el alta rápida (modal) sobre la lista; el
  // formulario completo queda en /new?full=1 o con contexto (companyId…).
  if (Object.keys(searchParams).length === 0) redirect(`/${locale}/app/crm/deals?new=1`);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const pipelines = (await listPipelinesWithStages(user.id)).map((p) => ({
    id: p.id,
    name: p.name,
    stages: p.stages.map((s) => ({ id: s.id, name: s.name, is_won: s.is_won, is_lost: s.is_lost })),
  }));

  const contactId = typeof searchParams.contactId === 'string' ? searchParams.contactId : undefined;

  return (
    <div className="ui-page ui-page-narrow">
      <PageHeader back={{ href: '/app/crm/deals', label: t('record.back.deals') }} title={t('deals.newTitle')} />
      {pipelines.length === 0 ? (
        <EmptyState
          title={t('record.empty.noPipelineTitle')}
          body={t('record.empty.noPipelineBody')}
          action={{ label: t('record.empty.noPipelineCta'), href: '/app/crm/settings' }}
        />
      ) : (
        <DealFullForm
          pipelines={pipelines}
          priorities={PRIORITIES.map((value) => ({ value, label: t(`enums.priority.${value}`) }))}
          sources={SOURCES.map((value) => ({ value, label: t(`enums.source.${value}`) }))}
          fixedContactId={contactId}
        />
      )}
    </div>
  );
}
