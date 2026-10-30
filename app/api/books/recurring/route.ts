import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { createRecurring, listRecurring, type RecurringInput } from '@/lib/books-recurring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    need(actor, 'invoices.read');
    return { recurring: await listRecurring(actor.ws, { q: req.nextUrl.searchParams.get('q') ?? undefined }) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => ({ recurring: await createRecurring(actor, (await readJson(req)) as RecurringInput) }), 201);
}
