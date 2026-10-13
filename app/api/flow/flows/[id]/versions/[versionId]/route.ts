import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getFlowVersion, listFlowWebhooks, restoreFlowVersion } from '@/lib/flow';
import { canEditFlows, flowError, forbidden, notFound, realUserId, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; versionId: string }> };

/** Grafo de una versión (vista previa). */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id, versionId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const version = await getFlowVersion(user.id, id, versionId);
  if (!version) return notFound();
  return NextResponse.json({ version });
}

/** Restaura la versión: el grafo actual pasa a ser el de esa versión (y queda una versión nueva). */
export async function POST(_req: NextRequest, props: Ctx) {
  const { id, versionId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const res = await restoreFlowVersion(user.id, id, versionId, realUserId(user));
  if (!res.ok) {
    if (res.error === 'not_found') return notFound();
    return flowError(res.error === 'conflict' ? 409 : 400, res.error, { nodeId: res.nodeId });
  }
  return NextResponse.json({ flow: res.flow, webhooks: await listFlowWebhooks(user.id, id) });
}
