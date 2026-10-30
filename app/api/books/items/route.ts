import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { createItem, listItems, type ItemInput } from '@/lib/books';
import { BooksError } from '@/lib/books-schema';
import { userCanUseApp } from '@/lib/workspace';

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
  return handle(async ({ actor, user }) => {
    const body = (await readJson(req)) as ItemInput;
    if (body.shopVariantId && !userCanUseApp(user, 'shop')) throw new BooksError('forbidden', 403, { need: 'shop' });
    return { item: await createItem(actor, body) };
  }, 201);
}
