import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { createTransfer } from '@/lib/books-bankrules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => {
    const b = await readJson(req);
    return createTransfer(actor, { fromId: String(b.fromId ?? ''), toId: String(b.toId ?? ''), amount: b.amount as number | string, date: b.date ? String(b.date) : undefined, reference: b.reference ? String(b.reference) : undefined });
  }, 201);
}
