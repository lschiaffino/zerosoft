import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listPipelinesWithStages, PRIORITIES, SOURCES } from '@/lib/crm';
import DealFullForm from '@/components/crm/DealFullForm';

export const dynamic = 'force-dynamic';

interface NewDealPageProps {
  params: { locale: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function NewDealPage({ params: { locale }, searchParams }: NewDealPageProps) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const pipelines = (await listPipelinesWithStages(user.id)).map((p) => ({
    id: p.id,
    name: p.name,
    stages: p.stages.map((s) => ({ id: s.id, name: s.name, is_won: s.is_won, is_lost: s.is_lost })),
  }));

  const contactId = typeof searchParams.contactId === 'string' ? searchParams.contactId : undefined;

  return (
    <div className="app-page narrow">
      <Link href="/app/crm/deals" className="mono back-link">
        {t('deals.detail.back')}
      </Link>
      <h1 className="app-title">{t('deals.newTitle')}</h1>
      {pipelines.length === 0 ? (
        <p className="muted">{t('deals.emptyStage')}</p>
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
