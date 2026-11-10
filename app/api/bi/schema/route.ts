import type { NextRequest } from 'next/server';
import { withViewer } from '@/lib/bi/http';
import { sourceSchema } from '@/lib/bi/run';
import { ZS_SOURCE } from '@/lib/bi/types';

export const dynamic = 'force-dynamic';

/** Tablas y columnas de una fuente que la persona puede consultar. ?source=zerosoft|<base> */
export async function GET(req: NextRequest) {
  return withViewer(req, 'read', async (viewer) => ({ tables: await sourceSchema(viewer, new URL(req.url).searchParams.get('source') || ZS_SOURCE) }));
}
