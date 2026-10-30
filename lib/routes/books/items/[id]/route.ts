import { NextRequest } from 'next/server';
import { handle, must, need, readJson } from '@/lib/books-http';
import { deleteItem, getItem, stockMoves, updateItem, type ItemInput } from '@/lib/books';
import { BooksError } from '@/lib/books-schema';
import { userCanUseApp } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    need(actor, 'items.read');
    const item = must(await getItem(actor.ws, (await params).id));
    return { item, moves: await stockMoves(actor.ws, item.id) };
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor, user }) => {
    const body = (await readJson(req)) as ItemInput;
    const id = (await params).id;
    const current = must(await getItem(actor.ws, id));
    if ((body.shopVariantId || current.shopVariantId) && body.shopVariantId !== undefined && !userCanUseApp(user, 'shop')) throw new BooksError('forbidden', 403, { need: 'shop' });
    return { item: await updateItem(actor, id, body) };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => deleteItem(actor, (await params).id));
}
