import { deleteThread, getThread, getThreadRow, listMessages, listScheduled, renameThread, saveDraft, saveNotes, type ThreadAction } from '@/lib/inbox/core';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { threadPatchSchema } from '@/lib/inbox/schemas';
import { threadAction } from '@/lib/inbox/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** El chat con sus últimos mensajes y los envíos programados. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    const thread = await getThread(owner, id);
    const [page, scheduled, row] = await Promise.all([listMessages(owner, id), listScheduled(owner, id), getThreadRow(owner, id)]);
    return iJson({ thread, messages: page.messages, more: page.more, scheduled, notes: row.notes });
  });
}

/** Acción (Hecho, posponer, fijar…), borrador, notas o nombre. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    const body = await parseBody(req, threadPatchSchema);
    if ('draft' in body) await saveDraft(owner, id, body.draft);
    else if ('notes' in body) await saveNotes(owner, id, body.notes);
    else if ('title' in body) await renameThread(owner, id, body.title);
    else {
      await getThread(owner, id);
      await threadAction(owner, [id], body as ThreadAction);
    }
    return iJson({ thread: await getThread(owner, id) });
  });
}

/** Saca el chat de Inbox (no lo borra de WhatsApp ni de Gmail). */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    await deleteThread(owner, id);
    return iJson({ ok: true });
  });
}
