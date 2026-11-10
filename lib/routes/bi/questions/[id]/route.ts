import type { NextRequest } from 'next/server';
import { withViewer } from '@/lib/bi/http';
import { BiStoreError, deleteQuestion, getQuestion, updateQuestion } from '@/lib/bi/store';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'read', async (viewer) => {
    const question = await getQuestion(viewer, id);
    if (!question) throw new BiStoreError('not_found', 404);
    return { question };
  });
}

/** Renombra, mueve o cambia la consulta o el gráfico. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'write', async (viewer, body) => ({ question: await updateQuestion(viewer, id, body) }));
}

/** Borra la pregunta (y sus tarjetas en tableros). */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'write', async (viewer) => {
    await deleteQuestion(viewer, id);
    return { ok: true };
  });
}
