import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { setFlowPin } from '@/lib/flow';
import { flowPinSchema } from '@/lib/flow-schema';
import { canEditFlows, flowError, forbidden, notFound, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fija la salida de prueba de un nodo (output: null la suelta). */
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = flowPinSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return flowError(400, 'invalid_input');
  const res = await setFlowPin(user.id, id, parsed.data.nodeId, parsed.data.output, user.actingUser?.id ?? user.id);
  if (!res.ok) return res.error === 'not_found' ? notFound() : flowError(res.error === 'not_flow_owner' ? 403 : 400, res.error);
  return NextResponse.json({ pins: res.pins });
}
