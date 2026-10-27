import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { CalendarError } from '@/lib/calendar';
import { createPoll, listPolls } from '@/lib/calendar-polls';
import { pollCreateSchema } from '@/lib/calendar-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';
import { logCalActivity } from '@/lib/calendar-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Encuestas de horario del workspace. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ polls: await listPolls(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = pollCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    const poll = await createPoll(user.id, realUserId(user), parsed.data);
    await logCalActivity(user.id, realUserId(user), 'poll.created', { type: 'poll', id: poll.id, summary: poll.title });
    return NextResponse.json(poll, { status: 201 });
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
