import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { domainError, issueAccess } from '@/lib/track-triage-http';
import { getSession, promptSession, sessionScope, stopSession } from '@/lib/track-agents';
import { invalidBody, notFound } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ body: z.string().trim().min(1).max(4000) });

async function load(id: string) {
  const scope = await sessionScope(id);
  if (!scope) return { res: notFound() } as const;
  const a = await issueAccess(scope.issueId);
  if (!a.ok) return { res: a.res } as const;
  if (scope.workspaceId !== a.user.id) return { res: notFound() } as const;
  return { a } as const;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const id = (await props.params).id;
  const l = await load(id);
  if ('res' in l) return l.res;
  return NextResponse.json(await getSession(id));
}

/** La persona le escribe al agente (responde su pregunta o le pide más). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const id = (await props.params).id;
  const l = await load(id);
  if ('res' in l) return l.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    return NextResponse.json(await promptSession(id, parsed.data.body, l.a.actorId));
  } catch (err) {
    return domainError(err);
  }
}

/** Corta la sesión. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const id = (await props.params).id;
  const l = await load(id);
  if ('res' in l) return l.res;
  return NextResponse.json(await stopSession(id));
}
