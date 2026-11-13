import { NextResponse } from 'next/server';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str } from '@/lib/groups-http';
import { favoriteLinesMessage, linesStickerOwner, linesStickerSource } from '@/lib/groups-stickers';
import { stickerRequest, stickerResponse } from '@/lib/wa-stickers-http';
import { lineShareUrl, markUsed, StickerError } from '@/lib/wa-stickers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Lines: los stickers de quien mira (lib/wa-stickers.ts).
 * GET: { stickers, imported } (si ya importó, trae antes los que llegaron);
 * ?img=<id> devuelve la imagen.
 * POST JSON: { action: 'import' } (de sus chats, por tandas: `more`),
 * { action: 'favorite', id, favorite }, { action: 'favoriteMessage', messageId },
 * { action: 'remove', id }, { action: 'use', id } (la media para mandarlo por
 * la ruta de mensajes del chat; pasa a recientes). Multipart con `file`: crea
 * un sticker desde una imagen.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  try {
    const viewer = await sessionViewer(s);
    return await stickerResponse(req, linesStickerOwner(viewer), () => linesStickerSource(viewer));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  try {
    const viewer = await sessionViewer(s);
    const owner = linesStickerOwner(viewer);
    return await stickerRequest(req, owner, () => linesStickerSource(viewer), {
      favoriteMessage: (messageId) => favoriteLinesMessage(viewer, messageId),
      extra: async (action, b) => {
        if (action !== 'use') return null;
        const id = str(b.id, 100) ?? '';
        const file = await lineShareUrl(owner, id);
        await markUsed(owner, id);
        return NextResponse.json({ media: { url: file.url, mimetype: 'image/webp', filename: 'sticker.webp', size: file.size, kind: 'sticker', ...(file.width && file.height ? { width: file.width, height: file.height } : {}) } });
      },
      readJson,
    });
  } catch (err) {
    return fail(err);
  }
}

function fail(err: unknown): NextResponse {
  if (err instanceof StickerError) return groupsError(err.status, err.code);
  return handleGroupsError(err);
}
