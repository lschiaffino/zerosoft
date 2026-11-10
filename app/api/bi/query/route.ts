import type { NextRequest } from 'next/server';
import { withViewer, str, values } from '@/lib/bi/http';
import { runQuery } from '@/lib/bi/run';
import { querySchema, ZS_SOURCE } from '@/lib/bi/types';

export const dynamic = 'force-dynamic';

/** Corre una consulta sin guardarla (editor). Body: { source, query, values?, fresh? } */
export async function POST(req: NextRequest) {
  return withViewer(req, 'read', async (viewer, body) => {
    const query = querySchema.parse(body.query);
    return { result: await runQuery(viewer, str(body.source) || ZS_SOURCE, query, { values: values(body.values), fresh: body.fresh === true, adhoc: true }) };
  });
}
