import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { deleteSequence, getSequence, listEnrollments, sequenceStepStats, updateSequence } from '@/lib/crm-sequences';
import { canManageOwned } from '@/lib/crm-email';
import { sequenceUpdateSchema } from '@/lib/crm-email-schema';
import { forbidden, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const seq = await getSequence(user.id, id);
  if (!seq) return notFound();
  return NextResponse.json({
    ...seq,
    stats: await sequenceStepStats(user.id, id),
    enrollments: await listEnrollments(user.id, { sequenceId: id }),
  });
}

export async function PATCH(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const seq = await getSequence(user.id, id);
  if (!seq) return notFound();
  if (!canManageOwned({ isAdmin: isWorkspaceAdmin(user), personId: realUserId(user) }, seq.sequence.created_by)) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = sequenceUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await updateSequence(user.id, id, parsed.data));
}

export async function DELETE(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const seq = await getSequence(user.id, id);
  if (!seq) return notFound();
  if (!canManageOwned({ isAdmin: isWorkspaceAdmin(user), personId: realUserId(user) }, seq.sequence.created_by)) return forbidden();
  await deleteSequence(user.id, id);
  return new NextResponse(null, { status: 204 });
}
