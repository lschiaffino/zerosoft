import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { getRobotWorkspaceConfig, getUsage, listRobots } from '@/lib/robots';
import { isRobotBuilder } from '@/lib/robots-http';
import RobotsHome from '@/components/robots/RobotsHome';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Robots' };

export default async function RobotsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const [robots, usage, config] = await Promise.all([listRobots(user.id), getUsage(user.id), getRobotWorkspaceConfig(user.id)]);
  return <RobotsHome robots={robots} usage={usage} canEdit={isRobotBuilder(user.role, config)} />;
}
