import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { billFromPurchaseOrder } from '@/lib/books-purchasing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { received?, supplierNumber? }: factura de proveedor borrador desde la orden. */
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    const b = await readJson(req);
    return { doc: await billFromPurchaseOrder(actor, (await params).id, { received: Boolean(b.received), supplierNumber: b.supplierNumber ? String(b.supplierNumber) : undefined }) };
  }, 201);
}
