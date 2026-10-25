import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import Insights from '@/components/track/planning/Insights';

export const dynamic = 'force-dynamic';

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'trackPlanning' });
  return (
    <div className="app-page track-page ui-page tp-page">
      <PageHeader title={t('insights.title')} description={t('insights.subtitle')} />
      <Suspense fallback={null}>
        <Insights />
      </Suspense>
    </div>
  );
}
