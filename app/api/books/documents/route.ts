import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { createDraft, docArea, listDocuments, type DocInput } from '@/lib/books-docs';
import { DOC_TYPES, type DocType } from '@/lib/books-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/books/documents?type=invoice|credit_note|bill&status=&q=&contact= */
export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    const sp = req.nextUrl.searchParams;
    const types = (sp.get('type') ?? 'invoice').split(',').filter((t): t is DocType => (DOC_TYPES as readonly string[]).includes(t));
    for (const t of types) need(actor, `${docArea(t)}.read`);
    return listDocuments(actor.ws, {
      docType: types,
      status: sp.get('status') ?? undefined,
      q: sp.get('q') ?? undefined,
      contactId: sp.get('contact') ?? undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      limit: Number(sp.get('limit') ?? 200) || 200,
    });
  });
}

/** POST /api/books/documents: borrador de factura, nota de crédito o factura de proveedor. */
export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => ({ doc: await createDraft(actor, (await readJson(req)) as DocInput) }), 201);
}
