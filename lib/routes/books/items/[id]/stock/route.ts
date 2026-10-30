import { NextRequest } from 'next/server';
import { handle, must, readJson } from '@/lib/books-http';
import { assertCan, getItem, moveStock } from '@/lib/books';
import { BooksError } from '@/lib/books-schema';
import { userCanUseApp } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/books/items/<id>/stock { quantity }: ajuste manual (positivo o negativo). */
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor, user }) => {
    assertCan(actor, 'items.write');
    const id = (await params).id;
    // Un ítem vinculado a Shop mueve el stock de Shop: hace falta tener Shop.
    const current = must(await getItem(actor.ws, id));
    if (current.shopVariantId && !userCanUseApp(user, 'shop')) throw new BooksError('forbidden', 403, { need: 'shop' });
    const q = Number((await readJson(req)).quantity);
    if (!Number.isFinite(q) || q === 0 || Math.abs(q) > 1e9) throw new BooksError('invalid_quantity');
    await moveStock(actor, id, q, 'adjustment', null);
    return { item: must(await getItem(actor.ws, id)) };
  });
}
