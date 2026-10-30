import { handleDeletePerson, preflight } from '@/lib/analytics/ingest-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Borra la persona de un distinct_id con sus eventos (key secreta del proyecto). */
export async function POST(req: Request) {
  return handleDeletePerson(req);
}

export async function OPTIONS(req: Request) {
  return preflight(req);
}
