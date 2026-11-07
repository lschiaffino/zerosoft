import { NextRequest, NextResponse } from 'next/server';
import { handle, need } from '@/lib/books-http';
import { contactStatement, statementCsv } from '@/lib/books-statements';
import { isValidDate, todayIso } from '@/lib/books-money';
import { BooksError } from '@/lib/books-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    const sp = req.nextUrl.searchParams;
    const side = sp.get('side') === 'supplier' ? 'supplier' : 'customer';
    need(actor, side === 'supplier' ? 'bills.read' : 'invoices.read');
    const to = sp.get('to') ?? todayIso();
    const from = sp.get('from') ?? `${to.slice(0, 4)}-01-01`;
    if (!isValidDate(from) || !isValidDate(to)) throw new BooksError('invalid_date');
    const st = await contactStatement(actor.ws, (await params).id, from, to, side);
    if (sp.get('format') === 'csv') {
      return new NextResponse(statementCsv(st), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="statement-${from}-${to}.csv"`, 'cache-control': 'private, no-store' } });
    }
    return { statement: st };
  });
}
