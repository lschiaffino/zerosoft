import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { booksActor } from '@/lib/books';
import { can } from '@/lib/books-roles';
import { createDraft, listDocuments, type DocInput } from '@/lib/books-docs';
import { booksFail } from '@/lib/books-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/books/invoices (books:read): facturas, las más nuevas primero
 * (status, q, limit). La key actúa como la persona que la creó, con su rol
 * de Books (sales y viewer leen facturas; un rol sin facturas recibe 403).
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'books:read');
  if ('res' in auth) return auth.res;
  const actor = await booksActor({ ws: auth.user.id, person: auth.personId, workspaceRole: auth.role });
  if (!can(actor.role, 'invoices.read')) return NextResponse.json({ error: { code: 'forbidden', message: 'Your Books role cannot read invoices.' } }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const res = await listDocuments(auth.user.id, { docType: 'invoice', status: sp.get('status') ?? undefined, q: sp.get('q') ?? undefined, limit: Math.min(200, Number(sp.get('limit') ?? 50) || 50) });
  return NextResponse.json({ data: res.items, total: res.total });
}

/** POST /api/v1/books/invoices (books:write): factura borrador con el mismo cuerpo que la app. */
export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'books:write');
  if ('res' in auth) return auth.res;
  const actor = await booksActor({ ws: auth.user.id, person: auth.personId, workspaceRole: auth.role });
  const body = (await req.json().catch(() => ({}))) as DocInput;
  try {
    const doc = await createDraft(actor, { ...body, docType: 'invoice' });
    return NextResponse.json({ data: doc }, { status: 201 });
  } catch (err) {
    return booksFail(err);
  }
}
