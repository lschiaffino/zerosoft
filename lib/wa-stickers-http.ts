/**
 * Lo que comparten las rutas de stickers de Lines (app/api/groups/stickers) e
 * Inbox (app/api/inbox/stickers): listar, servir la imagen, importar, favoritos,
 * quitar y crear desde una imagen. Cada ruta pone su sesión y lo propio
 * (mandar). Server-only.
 */
import { NextResponse } from 'next/server';
import {
  addSticker,
  imageToSticker,
  listStickers,
  removeSticker,
  setFavorite,
  stickerBytes,
  StickerError,
  syncState,
  syncStickers,
  type StickerDto,
  type StickerOwner,
  type StickerSource,
} from './wa-stickers';

const NO_STORE = { 'cache-control': 'private, no-store' };
/** Lo que entra para crear un sticker (una foto o un GIF). */
const CREATE_MAX = 5 * 1024 * 1024;

/** GET: la lista (con lo nuevo de los chats si ya importó) o, con ?img=<id>, la imagen. */
export async function stickerResponse(req: Request, owner: StickerOwner, source: () => StickerSource): Promise<NextResponse> {
  const img = new URL(req.url).searchParams.get('img');
  if (img) {
    const { data } = await stickerBytes(owner, img.slice(0, 100));
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'content-type': 'image/webp',
        // El archivo de un id no cambia nunca.
        'cache-control': 'private, max-age=604800, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  }
  const state = await syncState(owner);
  // Ya importó: lo que llegó desde la última vez entra solo (una tanda corta, para no demorar el panel).
  if (state.imported) await syncStickers(owner, source(), { limit: 20, deadline: Date.now() + 5_000 }).catch(() => null);
  return NextResponse.json({ stickers: await listStickers(owner), imported: state.imported }, { headers: NO_STORE });
}

export interface StickerActions {
  favoriteMessage: (messageId: string) => Promise<StickerDto>;
  /** Acciones propias de la app ('use' en Lines, 'send' en Inbox). null: no es suya. */
  extra?: (action: string, body: Record<string, unknown>) => Promise<NextResponse | null>;
  readJson: (req: Request) => Promise<Record<string, unknown>>;
}

/** POST: crear (multipart con `file`) o una acción JSON. */
export async function stickerRequest(req: Request, owner: StickerOwner, source: () => StickerSource, a: StickerActions): Promise<NextResponse> {
  const type = req.headers.get('content-type') ?? '';
  if (type.startsWith('multipart/form-data')) {
    if (Number(req.headers.get('content-length') ?? 0) > CREATE_MAX + 64 * 1024) throw new StickerError('sticker_too_large', 413);
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof Blob) || file.size === 0) throw new StickerError('invalid_sticker', 400);
    if (file.size > CREATE_MAX) throw new StickerError('sticker_too_large', 413);
    const webp = await imageToSticker(Buffer.from(await file.arrayBuffer()), file.type);
    const { sticker } = await addSticker(owner, webp, { source: 'created' });
    return NextResponse.json({ sticker }, { status: 201, headers: NO_STORE });
  }
  const b = await a.readJson(req);
  const action = typeof b.action === 'string' ? b.action : '';
  const id = typeof b.id === 'string' ? b.id.slice(0, 100) : '';
  switch (action) {
    case 'import': {
      // Una tanda por pedido: la pantalla sigue pidiendo mientras `more`.
      const r = await syncStickers(owner, source(), { limit: 60, deadline: Date.now() + 20_000 });
      return NextResponse.json({ ...r, stickers: await listStickers(owner) }, { headers: NO_STORE });
    }
    case 'favorite':
      return NextResponse.json({ sticker: await setFavorite(owner, id, b.favorite !== false) }, { headers: NO_STORE });
    case 'favoriteMessage': {
      const messageId = typeof b.messageId === 'string' ? b.messageId.slice(0, 100) : '';
      if (!messageId) throw new StickerError('not_found', 404);
      return NextResponse.json({ sticker: await a.favoriteMessage(messageId) }, { headers: NO_STORE });
    }
    case 'remove':
      await removeSticker(owner, id);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    default: {
      const res = a.extra ? await a.extra(action, b) : null;
      if (res) return res;
      throw new StickerError('invalid_sticker', 400);
    }
  }
}
