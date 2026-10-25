import { Suspense } from 'react';
import { requireUser } from '@/lib/session';
import { DashboardPage } from '@/components/track/planning/Dashboards';

export const dynamic = 'force-dynamic';

export default async function Page(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  await requireUser(locale);
  return (
    <div className="app-page track-page ui-page tp-page">
      <Suspense fallback={null}>
        <DashboardPage dashboardId={id} />
      </Suspense>
    </div>
  );
}
