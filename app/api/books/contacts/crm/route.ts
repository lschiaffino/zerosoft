import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { crmCompaniesToImport, importCrmCompany } from '@/lib/books-integrations';
import { userCanUseApp } from '@/lib/workspace';
import { BooksError } from '@/lib/books-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/books/contacts/crm?q=: empresas del CRM que todavía no son contactos de Books. */
export async function GET(req: NextRequest) {
  return handle(async ({ actor, user }) => {
    need(actor, 'contacts.write');
    if (!userCanUseApp(user, 'crm')) return { companies: [], crm: false };
    return { companies: await crmCompaniesToImport(actor.ws, req.nextUrl.searchParams.get('q') ?? ''), crm: true };
  });
}

/** POST /api/books/contacts/crm { companyId, kind }: trae la empresa del CRM como cliente o proveedor. */
export async function POST(req: NextRequest) {
  return handle(async ({ actor, user }) => {
    if (!userCanUseApp(user, 'crm')) throw new BooksError('forbidden', 403);
    const b = await readJson(req);
    return { contact: await importCrmCompany(actor, String(b.companyId ?? ''), b.kind === 'supplier' ? 'supplier' : 'customer') };
  }, 201);
}
