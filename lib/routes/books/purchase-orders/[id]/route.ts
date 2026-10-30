import { NextRequest } from 'next/server';
import { handle, must, need, readJson } from '@/lib/books-http';
import { deletePurchaseOrder, getPurchaseOrder, updatePurchaseOrder, type PoInput } from '@/lib/books-purchasing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    need(actor, 'purchasing.read');
    return { order: must(await getPurchaseOrder(actor.ws, (await params).id)) };
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ order: await updatePurchaseOrder(actor, (await params).id, (await readJson(req)) as PoInput & { status?: 'sent' | 'cancelled' }) }));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    await deletePurchaseOrder(actor, (await params).id);
    return { ok: true };
  });
}
