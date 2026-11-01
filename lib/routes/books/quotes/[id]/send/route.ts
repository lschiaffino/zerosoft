import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { revokeQuoteLink, sendQuote } from '@/lib/books-quotes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    const b = await readJson(req);
    return { quote: await sendQuote(actor, (await params).id, { email: b.email === true, locale: b.locale ? String(b.locale) : undefined }) };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ quote: await revokeQuoteLink(actor, (await params).id) }));
}
