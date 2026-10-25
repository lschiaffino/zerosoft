import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { domainError, issueAccess } from '@/lib/track-triage-http';
import { delegateIssue, listIssueSessions, openSession, stopSession } from '@/lib/track-agents';
import { invalidBody } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  kind: z.enum(['zerosoft', 'external']),
  agentId: z.string().trim().min(1).max(64),
  instructions: z.string().max(4000).optional(),
});

/** Delega el issue a un agente (abre una sesión de trabajo visible en el issue). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await issueAccess((await props.params).id);
  if (!a.ok) return a.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    const session = await delegateIssue(a.issue, a.user.id, { kind: parsed.data.kind, id: parsed.data.agentId }, a.actorId, parsed.data.instructions ?? '');
    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    return domainError(err);
  }
}

/** Quita al agente: corta la sesión abierta. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await issueAccess((await props.params).id);
  if (!a.ok) return a.res;
  // Quitar al delegate: corta su sesión (la abierta o la última que terminó).
  const sessions = await listIssueSessions(a.issue.id);
  const target = openSession(sessions) ?? sessions.find((s) => s.state !== 'stopped');
  if (target) await stopSession(target.id);
  return NextResponse.json({ ok: true });
}
