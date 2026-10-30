import { NextRequest } from 'next/server';
import { handle, must, need, readJson } from '@/lib/books-http';
import { deleteItem, getItem, stockMoves, updateItem, type ItemInput } from '@/lib/books';

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
  return handle(async ({ actor }) => ({ item: await updateItem(actor, (await params).id, (await readJson(req)) as ItemInput) }));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => deleteItem(actor, (await params).id));
}
