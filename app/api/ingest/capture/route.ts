import { handleCapture, preflight } from '@/lib/analytics/ingest-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El mismo manejador que /api/ingest/e: la ruta que usan los SDKs de PostHog. */
export async function POST(req: Request) {
  return handleCapture(req);
}

export async function OPTIONS(req: Request) {
  return preflight(req);
}
