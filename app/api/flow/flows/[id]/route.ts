import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteFlow, getFlow, lastOutputs, listFlowWebhooks, rememberFlowLocale, updateFlow } from '@/lib/flow';
import { requestLocale } from '@/lib/request-locale';
import { flowUpdateSchema } from '@/lib/flow-schema';
import { canEditFlows, flowError, forbidden, notFound, realUserId, runViewer, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const flow = await getFlow(user.id, id, realUserId(user));
  if (!flow) return notFound();
  const canEdit = canEditFlows(user);
  return NextResponse.json({
    flow,
    canEdit,
    // Los tokens de webhook son secretos: solo para quien puede editar.
    webhooks: canEdit ? await listFlowWebhooks(user.id, id) : [],
    lastOutputs: await lastOutputs(user.id, id, runViewer(user)),
  });
}

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = flowUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return flowError(400, 'invalid_input');
  const res = await updateFlow(user.id, id, parsed.data, realUserId(user));
  if (!res.ok) {
    if (res.error === 'not_found') return notFound();
    if (res.error === 'conflict') return flowError(409, 'conflict');
    return flowError(400, res.error, { nodeId: res.nodeId });
  }
  // Los avisos de falla por email salen en el idioma de quien edita los flows.
  await rememberFlowLocale(user.id, requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'))).catch(() => {});
  return NextResponse.json({ flow: res.flow, webhooks: await listFlowWebhooks(user.id, id) });
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  if (!(await deleteFlow(user.id, id))) return notFound();
  return NextResponse.json({ ok: true });
}
