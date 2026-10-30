import { NextRequest } from 'next/server';
import { handle, need } from '@/lib/books-http';
import { listAudit } from '@/lib/books';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/books/audit?entity=: registro de cambios (quién hizo qué y cuándo). */
export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    need(actor, 'accounting.read');
    return { entries: await listAudit(actor.ws, { entityId: req.nextUrl.searchParams.get('entity') ?? undefined, limit: 300 }) };
  });
}
