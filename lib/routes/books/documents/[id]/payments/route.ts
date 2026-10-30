import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { recordPayment, type PaymentInput } from '@/lib/books-docs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => { const res = await recordPayment(actor, (await params).id, (await readJson(req)) as unknown as PaymentInput); return { doc: res.doc, paymentId: res.paymentId }; });
}
