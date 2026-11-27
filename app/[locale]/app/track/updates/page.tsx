import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import UpdatesFeed from '@/components/track/planning/UpdatesFeed';

export const dynamic = 'force-dynamic';

/** Track › Updates (Pulse de Linear): los updates de projects e initiatives en un feed. */
export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'trackPlanning' });
  return (
    <div className="app-page track-page ui-page tp-page">
      <PageHeader title={t('pulse.title')} description={t('pulse.subtitle')} />
      <Suspense fallback={null}>
        <UpdatesFeed />
      </Suspense>
    </div>
  );
}
