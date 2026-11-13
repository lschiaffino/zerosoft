/**
 * Inbox: de dónde salen los stickers de la colección de la persona
 * (lib/wa-stickers.ts): los de sus chats de WhatsApp, bajados del servidor de
 * WhatsApp como cualquier archivo recibido; y mandar uno. Server-only.
 */
import { getDb } from '../db';
import { getAccount, getMessageRow, getThreadRow, type AccountRow } from './core';
import { fetchWhatsappMedia } from './whatsapp';
import { sendWhatsappMedia } from './wa-media';
import { addSticker, markUsed, stickerBytes, StickerError, type StickerDto, type StickerOwner, type StickerSource } from '../wa-stickers';

export const inboxStickerOwner = (owner: string): StickerOwner => ({ userId: owner, app: 'inbox', scope: '' });

function metaOf(raw: string | null | undefined): { sha?: string; lottie?: boolean } {
  try {
    const m = JSON.parse(raw || '{}') as { sha?: string; lottie?: boolean };
    return { sha: typeof m.sha === 'string' ? m.sha : undefined, lottie: m.lottie === true };
  } catch {
    return {};
  }
}

/** Los stickers de sus chats (media_type 'sticker', índice parcial de 399_wa_stickers) después del rowid `after`. */
export function inboxStickerSource(owner: string): StickerSource {
  const accounts = new Map<string, Promise<AccountRow | null>>();
  const account = (id: string) => {
    if (!accounts.has(id)) accounts.set(id, getAccount(owner, id).catch(() => null));
    return accounts.get(id)!;
  };
  return {
    async next(after, limit) {
      const rows = (await getDb()
        .prepare(
          `SELECT m.rowid AS rid, m.media_ref, m.meta, t.account_id FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id
            WHERE m.owner_id = ? AND m.media_type = 'sticker' AND m.rowid > ? AND m.revoked_at IS NULL
            ORDER BY m.rowid LIMIT ?`,
        )
        .all(owner, after, limit)) as Array<{ rid: number; media_ref: string; meta: string; account_id: string }>;
      return rows.map((r) => {
        const meta = metaOf(r.meta);
        return {
          rowid: Number(r.rid),
          sha: meta.sha,
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

/** "Agregar a favoritos" desde un sticker de un chat. */
export async function favoriteInboxMessage(owner: string, messageId: string): Promise<StickerDto> {
  const msg = await getMessageRow(owner, messageId);
  if (msg.media_type !== 'sticker' || !msg.media_ref) throw new StickerError('invalid_sticker', 400);
  const thread = await getThreadRow(owner, msg.thread_id);
  const acc = await getAccount(owner, thread.account_id);
  const file = await fetchWhatsappMedia(acc, msg.media_ref);
  return (await addSticker(inboxStickerOwner(owner), file.data, { favorite: true, source: 'favorite' })).sticker;
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
