import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getRobot, getRobotRow, getRobotWorkspaceConfig, getUsage, listRobotBatches, listRobotRuns } from '@/lib/robots';
import { canEditRobot, canRunRobot, realUserId, robotViewer } from '@/lib/robots-http';
import RobotEditor from '@/components/robots/RobotEditor';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Robots' };

export default async function RobotEditorPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const robot = await getRobot(user.id, id);
  if (!robot) notFound();
  const [row, config, runs, usage, batches] = await Promise.all([
    getRobotRow(user.id, id),
    getRobotWorkspaceConfig(user.id),
    listRobotRuns(user.id, id, 50, robotViewer(user)),
    getUsage(user.id),
    listRobotBatches(user.id, id),
  ]);
  if (!row) notFound();
  return (
    <RobotEditor
      key={robot.id}
      robot={robot}
      runs={runs}
      usage={usage}
      batches={batches}
      canEdit={canEditRobot({ role: user.role, personId: realUserId(user) }, row, config)}
      canRun={canRunRobot(user, row, config)}
    />
  );
}
