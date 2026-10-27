import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createFlow, listFlows, sanitizeImportedGraph } from '@/lib/flow';
import { validateGraph } from '@/lib/flow-schema';
import { flowCreateSchema } from '@/lib/flow-schema';
import { canEditFlows, flowError, forbidden, realUserId, templateGraph, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Flows del workspace (cualquier miembro puede verlos). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ flows: await listFlows(user.id), canEdit: canEditFlows(user) });
}

/** Crea un flow (vacío, con grafo propio o desde una plantilla). Solo admins. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = flowCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return flowError(400, 'invalid_input');
  let graph = parsed.data.graph ?? templateGraph(parsed.data.template);
  if (parsed.data.template && !graph) return flowError(400, 'unknown_template');
  // Importado: las referencias de otro workspace (credenciales, tablas, flows…) quedan vacías.
  if (parsed.data.imported && graph !== undefined) {
    const v = validateGraph(graph);
    if (!v.ok) return flowError(400, v.error, { nodeId: v.nodeId });
    graph = await sanitizeImportedGraph(user.id, v.graph);
  }
  const res = await createFlow(user.id, realUserId(user), { ...parsed.data, graph });
  if (!res.ok) return flowError(400, res.error, { nodeId: res.nodeId });
  return NextResponse.json({ ...res.flow, lastRun: null, heldCount: 0 }, { status: 201 });
}
