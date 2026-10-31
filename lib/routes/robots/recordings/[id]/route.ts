import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteRobotRecording, getRobotRecording, getRobotRow } from '@/lib/robots';
import { credentialRefs, stepsNeedingReview } from '@/lib/robots-ai';
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
  // Lo que pide un login que el robot no usaba se marca: una persona lo tiene que revisar.
  const row = await getRobotRow(user.id, rec.robotId);
  const review = stepsNeedingReview(rec.steps, new Set(row ? credentialRefs(row.steps) : []));
  return NextResponse.json({ ...rec, review });
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteRobotRecording(user.id, id, realUserId(user)))) return notFound();
  return NextResponse.json({ ok: true });
}
