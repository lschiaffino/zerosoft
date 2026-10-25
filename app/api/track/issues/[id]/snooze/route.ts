import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { issueAccess } from '@/lib/track-triage-http';
import { snoozeTriageIssue } from '@/lib/track-triage';
import { invalidBody, trackError } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ until: z.string().datetime().nullable() });

/** Snooze de un issue en triage (H): se oculta de la cola para todos hasta `until`. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await issueAccess((await props.params).id);
  if (!a.ok) return a.res;
  if (a.issue.triage !== 1) return trackError(409, 'not_in_triage');
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const until = parsed.data.until;
  if (until && (Date.parse(until) <= Date.now() || Date.parse(until) > Date.now() + 365 * 86_400_000)) return trackError(400, 'invalid_date');
  await snoozeTriageIssue(a.issue.id, until, a.actorId);
  return NextResponse.json({ ok: true, until });
}
