import { NextRequest } from 'next/server';
import { handle, must, need, readJson } from '@/lib/books-http';
import { deleteQuote, getQuote, updateQuote, type QuoteInput } from '@/lib/books-quotes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    need(actor, 'invoices.read');
    return { quote: must(await getQuote(actor.ws, (await params).id)) };
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ quote: await updateQuote(actor, (await params).id, (await readJson(req)) as QuoteInput & { status?: 'draft' }) }));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    await deleteQuote(actor, (await params).id);
    return { ok: true };
  });
}
