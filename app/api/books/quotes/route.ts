import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { createQuote, listQuotes, type QuoteInput } from '@/lib/books-quotes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    need(actor, 'invoices.read');
    return { quotes: await listQuotes(actor.ws, { q: req.nextUrl.searchParams.get('q') ?? undefined, status: req.nextUrl.searchParams.get('status') ?? undefined }) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => ({ quote: await createQuote(actor, (await readJson(req)) as QuoteInput) }), 201);
}
