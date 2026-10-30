import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { createPurchaseOrder, listPurchaseOrders, type PoInput } from '@/lib/books-purchasing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    need(actor, 'purchasing.read');
    const sp = req.nextUrl.searchParams;
    return { orders: await listPurchaseOrders(actor.ws, { status: sp.get('status') ?? undefined, q: sp.get('q') ?? undefined }) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => ({ order: await createPurchaseOrder(actor, (await readJson(req)) as PoInput) }), 201);
}
