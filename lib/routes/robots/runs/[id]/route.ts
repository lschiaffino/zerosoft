import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getRobotRun } from '@/lib/robots';
import { notFound, robotViewer, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const run = await getRobotRun(user.id, id, robotViewer(user));
  if (!run) return notFound();
  return NextResponse.json({ run });
}
