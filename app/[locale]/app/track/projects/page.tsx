import ProjectsPage from '@/components/track/ProjectsPage';

export const dynamic = 'force-dynamic';

/** Lista de proyectos de Track (sidebar › Proyectos). */
export default async function TrackProjectsIndex(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return <ProjectsPage locale={locale} title="projects" />;
}
