import { NextRequest, NextResponse } from 'next/server';
import { handle, need } from '@/lib/books-http';
import { BooksError } from '@/lib/books-schema';
import { contactsCsv, documentsCsv, itemsCsv } from '@/lib/books-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** CSV de contactos, ítems, facturas o facturas de proveedor, según el rol. */
export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    const kind = req.nextUrl.searchParams.get('kind');
    let csv: string;
    if (kind === 'contacts') (need(actor, 'contacts.read'), (csv = await contactsCsv(actor.ws)));
    else if (kind === 'items') (need(actor, 'items.read'), (csv = await itemsCsv(actor.ws)));
    else if (kind === 'invoices') (need(actor, 'invoices.read'), (csv = await documentsCsv(actor.ws, 'invoice')));
    else if (kind === 'credit-notes') (need(actor, 'invoices.read'), (csv = await documentsCsv(actor.ws, 'credit_note')));
    else if (kind === 'bills') (need(actor, 'bills.read'), (csv = await documentsCsv(actor.ws, 'bill')));
    else throw new BooksError('invalid_kind');
    return new NextResponse(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${kind}.csv"`, 'cache-control': 'private, no-store' } });
  });
}
