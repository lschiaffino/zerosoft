import { NextRequest } from 'next/server';
import { handle, must, need, readJson } from '@/lib/books-http';
import { deleteRecurring, getRecurring, updateRecurring, type RecurringInput } from '@/lib/books-recurring';
import { listDocuments } from '@/lib/books-docs';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    need(actor, 'invoices.read');
    const recurring = must(await getRecurring(actor.ws, (await params).id));
    const ids = (await getDb().prepare('SELECT id FROM books_documents WHERE workspace_id = ? AND recurring_id = ?').all(actor.ws, recurring.id)) as Array<{ id: string }>;
    const all = ids.length ? (await listDocuments(actor.ws, { docType: 'invoice', contactId: recurring.contactId, limit: 500 })).items : [];
    return { recurring, documents: all.filter((d) => ids.some((x) => x.id === d.id)) };
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ recurring: await updateRecurring(actor, (await params).id, (await readJson(req)) as RecurringInput) }));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    await deleteRecurring(actor, (await params).id);
    return { ok: true };
  });
}
