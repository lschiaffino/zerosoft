import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { cancelRobotBatch, getRobotBatch, getRobotRow, getRobotWorkspaceConfig } from '@/lib/robots';
import { canRunRobot, forbidden, notFound, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cancela lo que sigue en cola del lote. Quien puede correr el robot. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const batch = await getRobotBatch(user.id, id, undefined, { limit: 1 });
  if (!batch) return notFound();
  const row = await getRobotRow(user.id, batch.robotId);
  if (!row || !canRunRobot(user, row, await getRobotWorkspaceConfig(user.id))) return forbidden();
  return NextResponse.json({ canceled: (await cancelRobotBatch(user.id, id)) ?? 0 });
}
