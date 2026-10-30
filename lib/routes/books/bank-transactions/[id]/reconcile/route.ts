import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { reconcile } from '@/lib/books-bank';
import { BooksError } from '@/lib/books-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { kind: invoice|bill|payment|account|ignore, docId?, paymentId?, accountId?, description? } */
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    const b = await readJson(req);
    const id = (await params).id;
    const kind = String(b.kind ?? '');
    if (kind === 'invoice' || kind === 'bill') return { transaction: await reconcile(actor, id, { kind, docId: String(b.docId ?? '') }) };
    if (kind === 'payment') return { transaction: await reconcile(actor, id, { kind, paymentId: String(b.paymentId ?? '') }) };
    if (kind === 'account') return { transaction: await reconcile(actor, id, { kind, accountId: String(b.accountId ?? ''), description: b.description ? String(b.description) : undefined }) };
    if (kind === 'ignore') return { transaction: await reconcile(actor, id, { kind }) };
    throw new BooksError('invalid_kind');
  });
}
