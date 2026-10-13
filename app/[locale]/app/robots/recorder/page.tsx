import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import RecorderPage from '@/components/robots/RecorderPage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Robots · Recorder' };

export default async function RobotsRecorderPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return <RecorderPage />;
}
