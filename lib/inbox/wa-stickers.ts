/**
 * Inbox: de dónde salen los stickers de la colección de la persona
 * (lib/wa-stickers.ts): una colección por cuenta de WhatsApp (la línea,
 * inbox_accounts.id), con los stickers de los chats de esa cuenta, bajados del
 * servidor de WhatsApp como cualquier archivo recibido; y mandar uno. Server-only.
 */
import { getDb } from '../db';
import { getAccount, getMessageRow, getThreadRow, type AccountRow } from './core';
import { fetchWhatsappMedia } from './whatsapp';
import { inboxMedia } from './media-store';
import { sendWhatsappMedia } from './wa-media';
import { addSticker, isoAt, markUsed, stickerBytes, StickerError, type StickerDto, type StickerOwner, type StickerSource } from '../wa-stickers';

/** La colección de la persona (en la cuenta `line`, si se pasa). Solo entrega stickers de sus propias cuentas de WhatsApp. */
export const inboxStickerOwner = (owner: string, line?: string): StickerOwner => ({
  userId: owner,
  app: 'inbox',
  scope: '',
  ...(line ? { line } : {}),
  canSeeLine: async (id) => Boolean(await getDb().prepare("SELECT 1 AS x FROM inbox_accounts WHERE id = ? AND owner_id = ? AND kind = 'whatsapp'").get(id, owner)),
});

function metaOf(raw: string | null | undefined): { sha?: string; lottie?: boolean } {
  try {
    const m = JSON.parse(raw || '{}') as { sha?: string; lottie?: boolean };
    return { sha: typeof m.sha === 'string' ? m.sha : undefined, lottie: m.lottie === true };
  } catch {
    return {};
  }
}

/**
 * Los stickers de los chats de una cuenta (media_type 'sticker', índice parcial de 399_wa_stickers) después del rowid
 * `after`. Los propios (from_me: mandados desde zerosoft o desde el teléfono) llevan `sentAt`: van a los recientes.
 */
export function inboxStickerSource(owner: string, line: string): StickerSource {
  const accounts = new Map<string, Promise<AccountRow | null>>();
  const account = (id: string) => {
    if (!accounts.has(id)) accounts.set(id, getAccount(owner, id).catch(() => null));
    return accounts.get(id)!;
  };
  return {
    async next(after, limit) {
      const rows = (await getDb()
        .prepare(
          `SELECT m.rowid AS rid, m.media_ref, m.meta, m.from_me, m.sent_at, t.account_id FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id
            WHERE m.owner_id = ? AND m.media_type = 'sticker' AND m.rowid > ? AND m.revoked_at IS NULL AND t.account_id = ? AND t.owner_id = ?
            ORDER BY m.rowid LIMIT ?`,
        )
        .all(owner, after, line, owner, limit)) as Array<{ rid: number; media_ref: string; meta: string; from_me: number; sent_at: string; account_id: string }>;
      return rows.map((r) => {
        const meta = metaOf(r.meta);
        return {
          rowid: Number(r.rid),
          sha: meta.sha,
          ...(Number(r.from_me) === 1 && !meta.lottie ? { sentAt: isoAt(r.sent_at) } : {}),
          fetch: async () => {
            if (!r.media_ref || meta.lottie) return null;
            const acc = await account(r.account_id);
            if (!acc || acc.status !== 'connected') return null;
            return (await fetchWhatsappMedia(acc, r.media_ref)).data;
          },
        };
      });
    },
  };
}

/** "Agregar a favoritos" desde un sticker de un chat: queda en la cuenta de ese chat. */
export async function favoriteInboxMessage(owner: string, messageId: string): Promise<StickerDto> {
  const msg = await getMessageRow(owner, messageId);
  if (msg.media_type !== 'sticker' || !msg.media_ref) throw new StickerError('invalid_sticker', 400);
  const thread = await getThreadRow(owner, msg.thread_id);
  const acc = await getAccount(owner, thread.account_id);
  const file = await inboxMedia(acc, owner, msg);
  return (await addSticker(inboxStickerOwner(owner, acc.id), file.data, { favorite: true, source: 'favorite' })).sticker;
}

/** Manda un sticker de la colección al chat (los bytes van al servidor de WhatsApp) y lo pasa a los recientes. */
export async function sendInboxSticker(owner: string, threadId: string, stickerId: string, opts: { replyTo?: string; clientId?: string } = {}): Promise<void> {
  const o = inboxStickerOwner(owner);
  const { data } = await stickerBytes(o, stickerId);
  await sendWhatsappMedia(owner, threadId, {
    data,
    mimetype: 'image/webp',
    filename: 'sticker.webp',
    size: data.length,
    kind: 'sticker',
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    ...(opts.clientId ? { clientId: opts.clientId } : {}),
  });
  await markUsed(o, stickerId);
}
