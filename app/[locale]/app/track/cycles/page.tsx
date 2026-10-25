import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import { CyclesIndex } from '@/components/track/planning/Cycles';

export const dynamic = 'force-dynamic';

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'trackPlanning' });
  return (
    <div className="app-page track-page ui-page tp-page">
      <PageHeader title={t('cycles.title')} description={t('cycles.subtitle')} />
      <Suspense fallback={null}>
        <CyclesIndex />
      </Suspense>
    </div>
  );
}
