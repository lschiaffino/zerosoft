import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import { deleteRun, getRun, runUpdateSchema, sessionRunViewer, updateRun } from '@/lib/crm-ai-agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const run = await getRun(user.id, id, await sessionRunViewer(user));
  return run ? NextResponse.json(run) : notFound();
}

/** Renombrar o cancelar la corrida. */
export async function PATCH(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = runUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  // Una corrida que la persona no ve no se toca (ni se confirma que existe).
  if (!(await getRun(user.id, id, await sessionRunViewer(user)))) return notFound();
  const run = await updateRun(user.id, id, parsed.data);
  return run ? NextResponse.json(run) : notFound();
}

export async function DELETE(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await getRun(user.id, id, await sessionRunViewer(user)))) return notFound();
  return (await deleteRun(user.id, id)) ? NextResponse.json({ ok: true }) : notFound();
}
