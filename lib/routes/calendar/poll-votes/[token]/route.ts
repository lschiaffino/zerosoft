import { NextRequest, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { CalendarError } from '@/lib/calendar';
import { getPollByToken, votePoll, type PollDetail } from '@/lib/calendar-polls';
import { pollVoteSchema } from '@/lib/calendar-schema';
import { crmError, invalidBody, notFound } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

/** Lo que ve un participante: horarios y quién votó qué (solo nombres, nunca emails). */
function publicView(poll: PollDetail) {
  return {
    title: poll.title,
    description: poll.description,
    durationMin: poll.duration_min,
    location: poll.location,
    status: poll.status,
    options: poll.options,
    votes: poll.votes.map((v) => ({ id: v.id, name: v.name, optionIds: v.optionIds })),
  };
}

export async function GET(req: NextRequest, props: Ctx) {
  const limited = await limitByIp(req, 'poll', 60, 60);
  if (limited) return limited;
  const poll = await getPollByToken((await props.params).token);
  return poll ? NextResponse.json(publicView(poll)) : notFound();
}

/** Voto de un participante (sin cuenta). Con el mismo email, reemplaza su voto. */
export async function POST(req: NextRequest, props: Ctx) {
  const limited = await limitByIp(req, 'poll-vote', 20, 600);
  if (limited) return limited;
  const parsed = pollVoteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    const poll = await votePoll((await props.params).token, parsed.data);
    return NextResponse.json(publicView(poll));
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
