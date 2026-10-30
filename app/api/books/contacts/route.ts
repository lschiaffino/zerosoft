import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { createContact, listContacts, type ContactInput } from '@/lib/books';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/books/contacts?q=&kind=customer|supplier */
export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    need(actor, 'contacts.read');
    const sp = req.nextUrl.searchParams;
    return { contacts: await listContacts(actor.ws, { q: sp.get('q') ?? undefined, kind: sp.get('kind') ?? undefined, includeArchived: sp.get('archived') === '1' }) };
  });
}

/** POST /api/books/contacts: crea el contacto (y su empresa en el CRM si el ajuste está activo, salvo syncCrm: false). */
export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => {
    const body = await readJson(req);
    // syncCrm: false no crea la empresa en el CRM aunque el ajuste esté activo.
    return { contact: await createContact(actor, body as ContactInput, { syncCrm: body.syncCrm === false ? false : undefined }) };
  }, 201);
}
