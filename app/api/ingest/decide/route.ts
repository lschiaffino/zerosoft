import { handleDecide, preflight } from '@/lib/analytics/ingest-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Flags de Analytics para un distinct_id y la config del snippet (autocapture). */
export async function POST(req: Request) {
  return handleDecide(req);
}

export async function OPTIONS(req: Request) {
  return preflight(req);
}
