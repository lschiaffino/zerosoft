import ProjectsPage from '@/components/track/ProjectsPage';

export const dynamic = 'force-dynamic';

export default async function TrackOverviewPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return <ProjectsPage locale={locale} title="overview" />;
}
