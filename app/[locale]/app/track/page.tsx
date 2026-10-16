import TrackOverview from '@/components/track/TrackOverview';

export const dynamic = 'force-dynamic';

/** Resumen de Track: ciclo en curso, vencidas y triage por proyecto. */
export default async function TrackOverviewPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return <TrackOverview locale={locale} />;
}
