import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { createItem, listItems, type ItemInput } from '@/lib/books';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    need(actor, 'items.read');
    const sp = req.nextUrl.searchParams;
    return { items: await listItems(actor.ws, { q: sp.get('q') ?? undefined, includeArchived: sp.get('archived') === '1' }) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => ({ item: await createItem(actor, (await readJson(req)) as ItemInput) }), 201);
}
