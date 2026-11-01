import { handleFlagDefinitions, preflight } from '@/lib/analytics/ingest-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Definiciones de flags para evaluar en un servidor (key secreta). */
export async function GET(req: Request) {
  return handleFlagDefinitions(req);
}

export async function OPTIONS(req: Request) {
  return preflight(req);
}
