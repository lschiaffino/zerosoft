import { after } from 'next/server';
import { deleteThread, getAccount, getThread, getThreadRow, listMessages, listScheduled, renameThread, saveDraft, saveNotes, type ThreadAction } from '@/lib/inbox/core';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { threadPatchSchema } from '@/lib/inbox/schemas';
import { threadAction } from '@/lib/inbox/send';
import { markChatReadOnWhatsapp } from '@/lib/inbox/wa-actions';
import { refreshStaleInfo, waDetails } from '@/lib/inbox/wa-meta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** El chat con sus últimos mensajes, los envíos programados y (WhatsApp) la info del contacto o del grupo. ?around=<mensaje> trae desde un poco antes de ese mensaje (ir desde la búsqueda). */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    let row = await getThreadRow(owner, id);
    // Primera vez que se abre un chat de WhatsApp sin datos: nombre, foto e integrantes antes de mostrarlo.
    if (row.channel === 'whatsapp' && !row.info_at) {
      const account = await getAccount(owner, row.account_id);
      await refreshStaleInfo(account, { ids: [row.id], limit: 1, deadline: Date.now() + 4000 }).catch(() => 0);
      row = await getThreadRow(owner, id);
    }
    const thread = await getThread(owner, id);
    const around = new URL(req.url).searchParams.get('around')?.slice(0, 60) || undefined;
    const [page, scheduled] = await Promise.all([listMessages(owner, id, { around }), listScheduled(owner, id)]);
    const wa = row.channel === 'whatsapp' ? await waDetails(owner, row, await getAccount(owner, row.account_id)) : null;
    return iJson({ thread, messages: page.messages, more: page.more, scheduled, notes: row.notes, wa });
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
      // Abrir el chat: tildes azules en WhatsApp (como WhatsApp Web), después de responder.
      if ((body as ThreadAction).action === 'seen') {
        try {
          after(() => markChatReadOnWhatsapp(owner, id).catch(() => null));
        } catch {
          /* fuera de un pedido (tests) */
        }
      }
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
