import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import PlansList from '@/components/track/planning/PlansList';
import NewPlanButton from '@/components/track/planning/NewPlanButton';

export const dynamic = 'force-dynamic';

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'trackPlanning' });
  return (
    <div className="app-page track-page ui-page tp-page">
      <PageHeader title={t('plans.title')} description={t('plans.subtitle')} actions={<NewPlanButton />} />
      <Suspense fallback={null}>
        <PlansList />
      </Suspense>
    </div>
  );
}
