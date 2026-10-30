import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { createDraft, docArea, listDocuments, type DocInput } from '@/lib/books-docs';
import { BooksError, DOC_TYPES, type DocType } from '@/lib/books-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/books/documents?type=invoice|credit_note|bill&status=&q=&contact= */
export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    const sp = req.nextUrl.searchParams;
    // Sin type: facturas. Con type: cada valor tiene que ser un tipo válido (vacío o desconocido → 400), y el rol tiene que verlo.
    const raw = sp.get('type');
    const parts = raw === null ? ['invoice'] : raw.split(',');
    if (!parts.length || parts.some((t) => !(DOC_TYPES as readonly string[]).includes(t))) throw new BooksError('invalid_doc_type', 400);
    const types = [...new Set(parts)] as DocType[];
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
