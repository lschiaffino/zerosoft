import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { invoiceFromQuote, quotesToInvoice } from '@/lib/books-integrations';
import { userCanUseApp } from '@/lib/workspace';
import { BooksError } from '@/lib/books-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/books/documents/from-quote: presupuestos del CRM enviados o aceptados sin factura. */
export async function GET() {
  return handle(async ({ actor, user }) => {
    need(actor, 'invoices.write');
    if (!userCanUseApp(user, 'crm')) return { quotes: [], crm: false };
    return { quotes: await quotesToInvoice(actor.ws), crm: true };
  });
}

/** POST /api/books/documents/from-quote { quoteId, fxRate? }: factura borrador con las líneas del presupuesto. */
export async function POST(req: NextRequest) {
  return handle(async ({ actor, user }) => {
    if (!userCanUseApp(user, 'crm')) throw new BooksError('forbidden', 403);
    const b = await readJson(req);
    return { doc: await invoiceFromQuote(actor, String(b.quoteId ?? ''), { fxRate: b.fxRate ? String(b.fxRate) : undefined }) };
  }, 201);
}
