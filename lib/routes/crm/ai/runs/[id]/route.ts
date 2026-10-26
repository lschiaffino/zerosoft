import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import { deleteRun, getRun, runUpdateSchema, updateRun } from '@/lib/crm-ai-agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const run = await getRun(user.id, id, await sessionScope(user));
  return run ? NextResponse.json(run) : notFound();
}

/** Renombrar o cancelar la corrida. */
export async function PATCH(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = runUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const run = await updateRun(user.id, id, parsed.data);
  return run ? NextResponse.json(run) : notFound();
}

export async function DELETE(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return (await deleteRun(user.id, id)) ? NextResponse.json({ ok: true }) : notFound();
}
