import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { saveEInvoice } from '@/lib/books-einvoice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH /api/books/settings/einvoice: proveedor de factura electrónica, ambiente y credenciales (admins). */
export async function PATCH(req: NextRequest) {
  return handle(async ({ actor }) => ({ einvoice: await saveEInvoice(actor, (await readJson(req)) as Parameters<typeof saveEInvoice>[1]) }));
}
