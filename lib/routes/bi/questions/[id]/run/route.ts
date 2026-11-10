import type { NextRequest } from 'next/server';
import { withViewer, str, values } from '@/lib/bi/http';
import { runSavedQuestion } from '@/lib/bi/service';
import { getDashboard } from '@/lib/bi/store';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Corre una pregunta guardada. Body: { values?, fresh?, dashboardId?, cardId? } (con tablero, sus filtros). */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'read', async (viewer, body) => {
    const dashId = str(body.dashboardId);
    const dashboard = dashId ? ((await getDashboard(viewer, dashId)) ?? undefined) : undefined;
    const { result } = await runSavedQuestion(viewer, id, { values: values(body.values), fresh: body.fresh === true, dashboard, cardId: str(body.cardId) });
    return { result };
  });
}
