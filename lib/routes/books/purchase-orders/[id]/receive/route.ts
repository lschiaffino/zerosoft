import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { receivePurchaseOrder } from '@/lib/books-purchasing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { lines: [{ lineId, quantity }] }: recepción parcial o total, suma stock. */
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    const b = await readJson(req);
    return { order: await receivePurchaseOrder(actor, (await params).id, { lines: Array.isArray(b.lines) ? (b.lines as Array<{ lineId: string; quantity: number }>) : [] }) };
  });
}
