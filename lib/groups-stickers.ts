/**
 * Lines: de dónde salen los stickers de la colección de una persona (lib/wa-stickers.ts).
 * Una colección por línea (el número, groups_numbers.id), armada solo con los
 * chats de esa línea que la persona puede ver (visibilidad por línea, grupos de
 * líneas y, si está activo, acceso por etiqueta). Server-only.
 */
import { getDb } from './db';
import { chatAccessSql, canSeeChat, canSeeNumber, type GroupsViewer } from './groups-access';
import { getMessageRow } from './groups';
import { addSticker, readStoredUpload, StickerError, type StickerDto, type StickerOwner, type StickerSource } from './wa-stickers';

/** La colección de quien mira (en la línea `line`, si se pasa). Solo entrega stickers de líneas que ve. */
export const linesStickerOwner = (viewer: GroupsViewer, line?: string): StickerOwner => ({
  userId: viewer.me,
  app: 'lines',
  scope: viewer.ws,
  ...(line ? { line } : {}),
  canSeeLine: (id) => canSeeNumber(viewer, id),
});

export function stickerMeta(raw: string | null | undefined): { sticker: boolean; sha?: string } {
  try {
    const media = (JSON.parse(raw || '{}') as { media?: { kind?: string; sha?: string; lottie?: boolean } }).media;
    return { sticker: media?.kind === 'sticker' && !media.lottie, sha: typeof media?.sha === 'string' ? media.sha : undefined };
  } catch {
    return { sticker: false };
  }
}

/**
 * Los stickers (WebP) de los chats de una línea, recibidos y mandados, después
 * del rowid `after`. El índice parcial de 399_wa_stickers (media_type =
 * 'image/webp') hace que no se recorran los demás mensajes.
 */
export function linesStickerSource(viewer: GroupsViewer, line: string): StickerSource {
  return {
    async next(after, limit) {
      const access = chatAccessSql(viewer, 'c');
      const rows = (await getDb()
        .prepare(
          `SELECT m.rowid AS rid, m.media_url, m.meta FROM groups_messages m JOIN groups_chats c ON c.id = m.chat_id
            WHERE m.user_id = ? AND m.media_type = 'image/webp' AND m.rowid > ? AND m.deleted_at IS NULL AND c.number_id = ?${access ? ` AND ${access.sql}` : ''}
            ORDER BY m.rowid LIMIT ?`,
        )
        .all(viewer.ws, after, line, ...(access?.args ?? []), limit)) as Array<{ rid: number; media_url: string; meta: string }>;
      return rows.map((r) => {
        const meta = stickerMeta(r.meta);
        const stored = Boolean(r.media_url) && !r.media_url.startsWith('evo:');
        return {
          rowid: Number(r.rid),
          sha: meta.sha,
          fetch: async () => (meta.sticker && stored ? readStoredUpload(r.media_url, { workspaceId: viewer.ws }) : null),
        };
      });
    },
  };
}

/** "Agregar a favoritos" desde un sticker de un chat que la persona ve: queda en la línea de ese chat. */
export async function favoriteLinesMessage(viewer: GroupsViewer, messageId: string): Promise<StickerDto> {
  const msg = await getMessageRow(viewer.ws, messageId);
  if (!msg || !(await canSeeChat(viewer, msg.chat_id))) throw new StickerError('not_found', 404);
  if (!stickerMeta(msg.meta).sticker || !msg.media_url || msg.media_url.startsWith('evo:')) throw new StickerError('invalid_sticker', 400);
  const chat = (await getDb().prepare('SELECT number_id FROM groups_chats WHERE id = ? AND user_id = ?').get(msg.chat_id, viewer.ws)) as { number_id: string } | undefined;
  if (!chat?.number_id) throw new StickerError('not_found', 404);
  const data = await readStoredUpload(msg.media_url, { workspaceId: viewer.ws });
  if (!data) throw new StickerError('not_found', 404);
  return (await addSticker(linesStickerOwner(viewer, chat.number_id), data, { favorite: true, source: 'favorite' })).sticker;
}
