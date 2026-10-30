import { NextRequest } from 'next/server';
import { handle, must, need, readJson } from '@/lib/books-http';
import { deleteDraft, docArea, getDocument, updateDraft, type DocInput } from '@/lib/books-docs';
import { listAudit } from '@/lib/books';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    const doc = must(await getDocument(actor.ws, (await params).id));
    need(actor, `${docArea(doc.docType)}.read`);
    return { doc, audit: await listAudit(actor.ws, { entityId: doc.id, limit: 50 }) };
  });
}

/** PATCH: borrador completo; emitido, solo referencia y notas. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ doc: await updateDraft(actor, (await params).id, (await readJson(req)) as DocInput) }));
}

/** DELETE: solo borradores (lo emitido se anula o se corrige con nota de crédito). */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    await deleteDraft(actor, (await params).id);
    return { ok: true };
  });
}
