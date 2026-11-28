import type { NextRequest } from 'next/server';
import { exportResult, isExportFormat } from '@/lib/bi/export';
import { fileResponse, withViewer, str, values } from '@/lib/bi/http';
import { BI_EXPORT_MAX_ROWS, runQuery } from '@/lib/bi/run';
import { querySchema, ZS_SOURCE } from '@/lib/bi/types';

export const dynamic = 'force-dynamic';

/**
 * Corre una consulta sin guardarla (editor). Body: { source, query, values?, fresh? }.
 * Con { format: 'csv' | 'xlsx' | 'json', name? } la vuelve a correr hasta BI_EXPORT_MAX_ROWS filas y devuelve el archivo.
 */
export async function POST(req: NextRequest) {
  return withViewer(req, 'read', async (viewer, body) => {
    const query = querySchema.parse(body.query);
    if (isExportFormat(body.format)) {
      const result = await runQuery(viewer, str(body.source) || ZS_SOURCE, query, { values: values(body.values), adhoc: true, maxRows: BI_EXPORT_MAX_ROWS });
      return fileResponse(exportResult(result, body.format, str(body.name)?.slice(0, 200)));
    }
    return { result: await runQuery(viewer, str(body.source) || ZS_SOURCE, query, { values: values(body.values), fresh: body.fresh === true, adhoc: true }) };
  });
}
