import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteRobotRecording, getRobotRecording } from '@/lib/robots';
import { notFound, realUserId, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Pasos grabados hasta ahora. Solo quien abrió la grabación. */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const rec = await getRobotRecording(user.id, id, realUserId(user));
  if (!rec) return notFound();
  return NextResponse.json(rec);
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteRobotRecording(user.id, id, realUserId(user)))) return notFound();
  return NextResponse.json({ ok: true });
}
