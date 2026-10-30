import { NextRequest } from 'next/server';
import { handle, must, need, readJson } from '@/lib/books-http';
import { deleteContact, getContact, updateContact, type ContactInput } from '@/lib/books';
import { listDocuments } from '@/lib/books-docs';
import { can } from '@/lib/books-roles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    need(actor, 'contacts.read');
    const contact = must(await getContact(actor.ws, (await params).id));
    const types = (['invoice', 'credit_note', 'bill'] as const).filter((t) => can(actor.role, t === 'bill' ? 'bills.read' : 'invoices.read'));
    const docs = await listDocuments(actor.ws, { contactId: contact.id, docType: [...types], limit: 100 });
    return { contact, documents: docs.items };
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ contact: await updateContact(actor, (await params).id, (await readJson(req)) as ContactInput & { archived?: boolean }) }));
}

/** DELETE: sin comprobantes se borra; con comprobantes se archiva. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => deleteContact(actor, (await params).id));
}
