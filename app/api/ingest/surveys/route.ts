import { handleSurveys, preflight } from '@/lib/analytics/ingest-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Encuestas al aire para un distinct_id (snippet y encuestas por API). Ver lib/analytics/ingest-http.ts. */
export async function POST(req: Request) {
  return handleSurveys(req);
}

export async function OPTIONS(req: Request) {
  return preflight(req);
}
