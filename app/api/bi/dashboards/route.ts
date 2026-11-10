import type { NextRequest } from 'next/server';
import { withViewer } from '@/lib/bi/http';
import { createDashboard } from '@/lib/bi/store';

export const dynamic = 'force-dynamic';

/** Crea un tablero. */
export async function POST(req: NextRequest) {
  return withViewer(req, 'write', async (viewer, body) => ({ dashboard: await createDashboard(viewer, body) }), 201);
}
