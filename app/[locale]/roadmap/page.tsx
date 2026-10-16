import { permanentRedirect } from 'next/navigation';

/** El roadmap vive en el board público (feedback.zerosoft.ai/roadmap). */
export default async function RoadmapRedirect(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  permanentRedirect(`/${locale}/feedback-board/roadmap`);
}
