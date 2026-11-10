import type { NextRequest } from 'next/server';
import { withViewer, str } from '@/lib/bi/http';
import { addCard } from '@/lib/bi/store';
import { BiStoreError } from '@/lib/bi/store';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Suma una pregunta al tablero. Body: { questionId } */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(
    req,
    'write',
    async (viewer, body) => {
      const questionId = str(body.questionId);
      if (!questionId) throw new BiStoreError('question_required');
      return { dashboard: await addCard(viewer, id, questionId) };
    },
    201,
  );
}
