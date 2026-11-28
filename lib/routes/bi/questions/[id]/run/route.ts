import type { NextRequest } from 'next/server';
import { exportResult, isExportFormat } from '@/lib/bi/export';
import { fileResponse, withViewer, str, values } from '@/lib/bi/http';
import { BI_EXPORT_MAX_ROWS } from '@/lib/bi/run';
import { runSavedQuestion } from '@/lib/bi/service';
import { getDashboard } from '@/lib/bi/store';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/**
 * Corre una pregunta guardada. Body: { values?, fresh?, dashboardId?, cardId? } (con tablero, sus filtros).
 * Con { format: 'csv' | 'xlsx' | 'json' } devuelve el archivo, hasta BI_EXPORT_MAX_ROWS filas.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withViewer(req, 'read', async (viewer, body) => {
    const dashId = str(body.dashboardId);
    const dashboard = dashId ? ((await getDashboard(viewer, dashId)) ?? undefined) : undefined;
    const format = isExportFormat(body.format) ? body.format : null;
    const opts = { values: values(body.values), fresh: body.fresh === true, dashboard, cardId: str(body.cardId), maxRows: format ? BI_EXPORT_MAX_ROWS : undefined };
    const { question, result } = await runSavedQuestion(viewer, id, opts);
    if (format) return fileResponse(exportResult(result, format, question.name));
    return { result };
  });
}
