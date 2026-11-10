import type { NextRequest } from 'next/server';
import { withViewer, str, values } from '@/lib/bi/http';
import { compileQuery } from '@/lib/bi/run';
import { querySchema, ZS_SOURCE } from '@/lib/bi/types';

export const dynamic = 'force-dynamic';

/** SQL que genera una consulta del constructor (para verlo o pasarlo al editor SQL). */
export async function POST(req: NextRequest) {
  return withViewer(req, 'read', async (viewer, body) => {
    const query = querySchema.parse(body.query);
    return compileQuery(viewer, str(body.source) || ZS_SOURCE, query, values(body.values));
  });
}
