import { redirect } from '@/i18n/navigation';

// La lista de proyectos vive en el overview de Track.
export default async function TrackProjectsIndex(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  redirect({ href: '/app/track', locale });
}
