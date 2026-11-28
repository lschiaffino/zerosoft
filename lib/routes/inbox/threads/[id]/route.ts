import { after } from 'next/server';
import {
  getAccount,
  getThread,
  getThreadRow,
  listMessages,
  listPinnedMessages,
  listScheduled,
  renameThread,
  saveDraft,
  saveNotes,
  type ThreadAction,
} from '@/lib/inbox/core';
import { iJson, parseBody, withOwner, withOwnerWs } from '@/lib/inbox/http';
import { internalVersion, isInternalHandle, loadInternalSet, type InternalSet } from '@/lib/internal-contacts';
import { markInternalThread } from '@/lib/inbox/core';
import { threadPatchSchema } from '@/lib/inbox/schemas';
import { threadAction } from '@/lib/inbox/send';
import { markChatReadOnWhatsapp } from '@/lib/inbox/wa-actions';
import { noteThreadPicture, refreshStaleInfo, waDetails } from '@/lib/inbox/wa-meta';
import { waProviderFor } from '@/lib/inbox/whatsapp';
import { refreshPrivacyIfStale } from '@/lib/wa-privacy';
import { cardPhones, dmPerson, refreshDmPictureSoon, refreshPicturesSoon } from '@/lib/wa-contact-pictures';
import { inboxScope } from '@/lib/inbox/wa-names';
import { threadRev, versionTag, versioned } from '@/lib/inbox/revisions';
import { purgeThreads, removeThreads } from '@/lib/inbox/removed';
import { InboxError } from '@/lib/inbox/types';
import { SAME_CHAT_ACTIONS, inboxChatLines, withInboxSameChatIds } from '@/lib/inbox/same-chat';
import { getDb } from '@/lib/db';
import { mergedUnread } from '@/lib/same-chat';

/** Las versiones de las filas del mismo chat en otras cuentas, para la etiqueta del 304. */
async function sameChatRev(owner: string, ids: string[]): Promise<string> {
  const rows = (await getDb()
    .prepare(`SELECT id, rev FROM inbox_threads WHERE owner_id = ? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
    .all(owner, ...ids)) as Array<{ id: string; rev: number }>;
  return rows.map((r) => `,${r.id}=${Number(r.rev ?? 0)}`).join('');
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * El chat con sus últimos mensajes, los envíos programados y (WhatsApp) la info del contacto o del grupo.
 * ?around=<mensaje> trae desde un poco antes de ese mensaje (ir desde la búsqueda). `cursor` sirve para
 * pedir los anteriores (GET …/messages?before=). Con If-None-Match y sin cambios responde 304.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwnerWs(async (owner, { ws }) => {
    const around = new URL(req.url).searchParams.get('around')?.slice(0, 60) || undefined;
    // Sin cambios desde la última vez (una fila): 304 sin armar el chat.
    const rev = await threadRev(owner, id);
    if (rev === null) await getThreadRow(owner, id);
    // El mismo chat en otras cuentas: un mensaje en cualquiera cambia la conversación (y su versión).
    const same = await withInboxSameChatIds(owner, [id]);
    const extraRev = same.length > 1 ? await sameChatRev(owner, same.slice(1)) : '';
    // Quién es interno es del workspace (lib/internal-contacts.ts): su versión va primero; lo interno se lee solo si
    // hay que armar el chat.
    const iv = await internalVersion(ws);
    return versioned(req, versionTag('t', rev ?? 0, `${iv},${id},${around ?? ''}${extraRev}`), async () => buildDetail(owner, id, around, await loadInternalSet(ws)));
  });
}

async function buildDetail(owner: string, id: string, around: string | undefined, internal: InternalSet) {
  let row = await getThreadRow(owner, id);
  // Primera vez que se abre un chat de WhatsApp sin datos: nombre, foto e integrantes antes de mostrarlo.
  if (row.channel === 'whatsapp' && !row.info_at) {
    const account = await getAccount(owner, row.account_id);
    await refreshStaleInfo(account, {
      ids: [row.id],
      limit: 1,
      deadline: Date.now() + 4000,
    }).catch(() => 0);
    row = await getThreadRow(owner, id);
  }
  const lines = await inboxChatLines(owner, id);
  const one = markInternalThread(await getThread(owner, id), internal);
  const thread = lines.length ? { ...one, lines, unread: mergedUnread(one.kind, lines) } : one;
  const [page, scheduled] = await Promise.all([listMessages(owner, id, { around }), listScheduled(owner, id)]);
  const account = row.channel === 'whatsapp' ? await getAccount(owner, row.account_id) : null;
  const wa = account ? await waDetails(owner, row, account) : null;
  // Los participantes internos (del equipo o de la empresa): "Interno" en la lista y al lado de lo que escriben.
  if (wa) for (const p of wa.participants) if (!p.me && isInternalHandle(internal, p.phone)) p.internal = true;
  // Las confirmaciones de lectura de la cuenta: si el dato tiene más de un día, se relee después de responder.
  if (account?.status === 'connected') await refreshPrivacyIfStale('inbox', account, () => waProviderFor(account));
  // Las personas de las tarjetas de contacto (vCard) en la pantalla: sus fotos, como en WhatsApp.
  const cards = cardPhones(page.messages.map((m) => m.meta?.contacts));
  // Grupo: las fotos de perfil de quienes escriben (los de la pantalla primero) y del resto, después de responder.
  if (account?.status === 'connected' && wa && row.kind === 'group') {
    const senders = page.messages
      .filter((m) => !m.fromMe)
      .map((m) => m.senderHandle)
      .reverse();
    const phones = [...cards, ...senders, ...wa.participants.filter((p) => !p.me).map((p) => p.phone)];
    await refreshPicturesSoon(inboxScope(account), () => waProviderFor(account), phones);
  }
  // 1:1: la foto de la persona (copia nuestra) si todavía no hay o venció, después de responder. Antes solo
  // llegaba con el historial o con los datos del chat, y si ahí no venía (o el pedido falló) quedaban las iniciales.
  // De paso, las de las tarjetas de contacto que están en la pantalla.
  if (account?.status === 'connected' && row.kind === 'dm') {
    await refreshDmPictureSoon(inboxScope(account), () => waProviderFor(account), dmPerson(row.handle, row.external_id), {
      chatPicture: row.avatar_url,
      onChange: () => noteThreadPicture(row),
      alsoPhones: cards,
    });
  }
  return {
    thread,
    messages: page.messages,
    more: page.more,
    cursor: page.cursor,
    scheduled,
    notes: row.notes,
    wa,
    // Los fijados (como en WhatsApp): la franja de arriba del chat, aunque sean más viejos que la página.
    ...(row.channel === 'whatsapp' ? { pinned: await listPinnedMessages(owner, id) } : {}),
  };
}

/** Acción (Hecho, posponer, fijar…), borrador, notas o nombre. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwnerWs(async (owner, { ws }) => {
    const body = await parseBody(req, threadPatchSchema);
    if ('draft' in body) await saveDraft(owner, id, body.draft);
    else if ('notes' in body) await saveNotes(owner, id, body.notes);
    else if ('title' in body) await renameThread(owner, id, body.title);
    else {
      await getThread(owner, id);
      // El mismo chat en otras cuentas: leer, Hecho, archivar, posponer y silenciar valen para todas (la bandeja lo
      // muestra una vez); fijar, no leído, recordatorios y carpetas, solo en este.
      const action = (body as ThreadAction).action;
      const ids = (SAME_CHAT_ACTIONS as readonly string[]).includes(action) ? await withInboxSameChatIds(owner, [id]) : [id];
      await threadAction(owner, ids, body as ThreadAction);
      // Abrir el chat: tildes azules en WhatsApp (como WhatsApp Web), después de responder.
      if ((body as ThreadAction).action === 'seen') {
        try {
          after(() => Promise.all(ids.map((x) => markChatReadOnWhatsapp(owner, x).catch(() => null))));
        } catch {
          /* fuera de un pedido (tests) */
        }
      }
    }
    return iJson({ thread: markInternalThread(await getThread(owner, id), await loadInternalSet(ws)) });
  });
}

/**
 * Saca el chat de Inbox (no lo borra de WhatsApp ni de Gmail): queda en "Sacados de Inbox" para recuperarlo
 * (lib/inbox/removed.ts). Con ?purge=1, un chat ya sacado se borra del todo.
 */
export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    const purge = new URL(req.url).searchParams.get('purge') === '1';
    // Sacar de Inbox saca el chat de todas las cuentas donde está (si no, volvería por la otra).
    const done = purge ? await purgeThreads(owner, [id]) : await removeThreads(owner, await withInboxSameChatIds(owner, [id]));
    if (!done.length) throw new InboxError('not_found', 404);
    return iJson({ ok: true });
  });
}
