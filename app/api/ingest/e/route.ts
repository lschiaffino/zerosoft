import { handleCapture, preflight } from '@/lib/analytics/ingest-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Eventos de Analytics (snippet, SDKs y servidores): uno o un lote. Ver lib/analytics/ingest-http.ts. */
export async function POST(req: Request) {
  return handleCapture(req);
}

export async function OPTIONS(req: Request) {
  return preflight(req);
}
