import { BooksError } from '@/lib/books-schema';
import { handle, need } from '@/lib/books-http';
import { batchDocuments, deleteBatch, getBatch } from '@/lib/books-batch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async ({ actor }) => {
    const id = (await params).id;
    const batch = await getBatch(actor.ws, id);
    if (!batch) throw new BooksError('not_found', 404);
    need(actor, batch.docType === 'bill' ? 'bills.read' : 'invoices.read');
    return { batch, documents: await batchDocuments(actor.ws, id) };
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async ({ actor }) => {
    await deleteBatch(actor, (await params).id);
    return { ok: true };
  });
}
