import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { deletePoll, getPoll, updatePoll } from '@/lib/calendar-polls';
import { pollUpdateSchema } from '@/lib/calendar-schema';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import { logCalActivity } from '@/lib/calendar-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const poll = await getPoll(user.id, id);
  return poll ? NextResponse.json(poll) : notFound();
}

/** Renombrar, cambiar descripción o ubicación, cerrar o reabrir. */
export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const current = await getPoll(user.id, id);
  if (!current) return notFound();
  // La cambia quien la creó o un admin.
  if (current.created_by !== realUserId(user) && !isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  const parsed = pollUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const poll = await updatePoll(user.id, id, parsed.data);
  if (!poll) return notFound();
  await logCalActivity(user.id, realUserId(user), 'poll.updated', { type: 'poll', id, summary: poll.title });
  return NextResponse.json(poll);
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const poll = await getPoll(user.id, id);
  if (!poll) return notFound();
  // La borra quien la creó o un admin (como los tipos de evento, que borra un admin).
  if (poll.created_by !== realUserId(user) && !isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  if (!(await deletePoll(user.id, id))) return notFound();
  await logCalActivity(user.id, realUserId(user), 'poll.deleted', { type: 'poll', id, summary: poll.title });
  return new NextResponse(null, { status: 204 });
}
