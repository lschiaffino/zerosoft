import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { notFound, unauthorized } from '@/lib/crm-http';
import { getRun, stepRun } from '@/lib/crm-ai-agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Avanza la corrida unos segundos (la página la llama mientras corre) y devuelve el estado. */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  await stepRun(user.id, id, 8_000);
  const run = await getRun(user.id, id, await sessionScope(user));
  return run ? NextResponse.json(run) : notFound();
}
