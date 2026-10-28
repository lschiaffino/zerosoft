import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getRobot, getUsage, listRobotRuns } from '@/lib/robots';
import { canEditRobots, robotViewer } from '@/lib/robots-http';
import RobotEditor from '@/components/robots/RobotEditor';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Robots' };

export default async function RobotEditorPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const robot = await getRobot(user.id, id);
  if (!robot) notFound();
  const [runs, usage] = await Promise.all([listRobotRuns(user.id, id, 50, robotViewer(user)), getUsage(user.id)]);
  return <RobotEditor key={robot.id} robot={robot} runs={runs} usage={usage} canEdit={canEditRobots(user)} />;
}
