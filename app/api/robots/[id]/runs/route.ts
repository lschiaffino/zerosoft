import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getRobotRow, listRobotRuns } from '@/lib/robots';
import { notFound, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await getRobotRow(user.id, id))) return notFound();
  return NextResponse.json({ runs: await listRobotRuns(user.id, id) });
}
