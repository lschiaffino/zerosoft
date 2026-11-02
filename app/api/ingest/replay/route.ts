import { preflight } from '@/lib/analytics/ingest-http';
import { handleReplayIngest } from '@/lib/analytics/replay-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Chunks de session replay del snippet. Ver lib/analytics/replay-http.ts. */
export async function POST(req: Request) {
  return handleReplayIngest(req);
}

export async function OPTIONS(req: Request) {
  return preflight(req);
}
