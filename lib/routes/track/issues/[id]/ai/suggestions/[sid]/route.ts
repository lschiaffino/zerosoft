import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { domainError, issueAccess } from '@/lib/track-triage-http';
import { decideSuggestion } from '@/lib/track-ai';
import { invalidBody } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ decision: z.enum(['accept', 'dismiss']) });

/** Acepta (aplica al issue) o descarta una sugerencia. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = await props.params;
  const a = await issueAccess(id);
  if (!a.ok) return a.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    return NextResponse.json({ suggestions: await decideSuggestion(a.issue.id, sid, parsed.data.decision, a.actorId) });
  } catch (err) {
    return domainError(err);
  }
}
