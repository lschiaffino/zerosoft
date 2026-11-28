import type { NextRequest } from 'next/server';
import { withViewer, str } from '@/lib/bi/http';
import { listQuestionRevisions, revertQuestion } from '@/lib/bi/store';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Historial de versiones de una pregunta (la más nueva primero). */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'read', async (viewer) => ({ revisions: await listQuestionRevisions(viewer, id) }));
}

/** Volver a una versión. Body: { revisionId }. Queda como una versión nueva. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'write', async (viewer, body) => ({ question: await revertQuestion(viewer, id, str(body.revisionId) ?? '') }));
}
