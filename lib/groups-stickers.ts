/**
 * Lines: de dónde salen los stickers de la colección de una persona (lib/wa-stickers.ts).
 * Solo de los chats que esa persona puede ver (visibilidad por línea y, si está
 * activo, acceso por etiqueta). Server-only.
 */
import { getDb } from './db';
import { chatAccessSql, canSeeChat, type GroupsViewer } from './groups-access';
import { getMessageRow } from './groups';
import { addSticker, readStoredUpload, StickerError, type StickerDto, type StickerOwner, type StickerSource } from './wa-stickers';

export const linesStickerOwner = (viewer: Pick<GroupsViewer, 'ws' | 'me'>): StickerOwner => ({ userId: viewer.me, app: 'lines', scope: viewer.ws });

export function stickerMeta(raw: string | null | undefined): { sticker: boolean; sha?: string } {
  try {
    const media = (JSON.parse(raw || '{}') as { media?: { kind?: string; sha?: string; lottie?: boolean } }).media;
    return { sticker: media?.kind === 'sticker' && !media.lottie, sha: typeof media?.sha === 'string' ? media.sha : undefined };
  } catch {
    return { sticker: false };
  }
}

/**
 * Los stickers (WebP) de sus chats, recibidos y mandados, después del rowid
 * `after`. El índice parcial de 399_wa_stickers (media_type = 'image/webp')
 * hace que no se recorran los demás mensajes.
 */
export function linesStickerSource(viewer: GroupsViewer): StickerSource {
  return {
    async next(after, limit) {
      const access = chatAccessSql(viewer, 'c');
      const rows = (await getDb()
        .prepare(
          `SELECT m.rowid AS rid, m.media_url, m.meta FROM groups_messages m JOIN groups_chats c ON c.id = m.chat_id
            WHERE m.user_id = ? AND m.media_type = 'image/webp' AND m.rowid > ? AND m.deleted_at IS NULL${access ? ` AND ${access.sql}` : ''}
            ORDER BY m.rowid LIMIT ?`,
        )
        .all(viewer.ws, after, ...(access?.args ?? []), limit)) as Array<{ rid: number; media_url: string; meta: string }>;
      return rows.map((r) => {
        const meta = stickerMeta(r.meta);
        const stored = Boolean(r.media_url) && !r.media_url.startsWith('evo:');
        return {
          rowid: Number(r.rid),
          sha: meta.sha,
          fetch: async () => (meta.sticker && stored ? readStoredUpload(r.media_url) : null),
        };
      });
    },
  };
}

/** "Agregar a favoritos" desde un sticker de un chat que la persona ve. */
export async function favoriteLinesMessage(viewer: GroupsViewer, messageId: string): Promise<StickerDto> {
  const msg = await getMessageRow(viewer.ws, messageId);
  if (!msg || !(await canSeeChat(viewer, msg.chat_id))) throw new StickerError('not_found', 404);
  if (!stickerMeta(msg.meta).sticker || !msg.media_url || msg.media_url.startsWith('evo:')) throw new StickerError('invalid_sticker', 400);
  const data = await readStoredUpload(msg.media_url);
  if (!data) throw new StickerError('not_found', 404);
  return (await addSticker(linesStickerOwner(viewer), data, { favorite: true, source: 'favorite' })).sticker;
}
