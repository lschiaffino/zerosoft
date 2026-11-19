/**
 * Lo que comparten las rutas de stickers de Lines (app/api/groups/stickers) e
 * Inbox (app/api/inbox/stickers): listar los de una línea, servir la imagen,
 * importar, favoritos, quitar y crear desde una imagen. Cada ruta pone su
 * sesión, qué líneas ve la persona (`owner.canSeeLine`) y lo propio (mandar).
 * Server-only.
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
/** Una tanda de "traer de los chats": corta, para que la grilla se vaya llenando de a poco. */
const IMPORT_BATCH = 24;
const IMPORT_MS = 6_000;

/**
 * La colección de la línea pedida. Una línea que la persona no ve responde
 * igual que una que no existe (404): no se puede saber cuáles hay.
 */
async function lineOwner(owner: StickerOwner, raw: unknown): Promise<StickerOwner> {
  const line = typeof raw === 'string' ? raw.trim().slice(0, 100) : '';
  if (!line || !owner.canSeeLine || !(await owner.canSeeLine(line))) throw new StickerError('not_found', 404);
  return { ...owner, line };
}

/**
 * GET ?line=<id>: los stickers de esa línea, tal como están en la base. No trae
 * nada de los chats ni sale a la red (eso lo pide el panel aparte, con la
 * acción 'import', después de dibujar): por eso acá no hay de dónde traerlos.
 * Con ?img=<id>, la imagen (si la persona ve la línea del sticker).
 */
export async function stickerResponse(req: Request, owner: StickerOwner): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const img = searchParams.get('img');
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
  const o = await lineOwner(owner, searchParams.get('line'));
  const [stickers, state] = await Promise.all([listStickers(o), syncState(o)]);
  return NextResponse.json({ stickers, imported: state.imported }, { headers: NO_STORE });
}

export interface StickerActions {
  /** "Agregar a favoritos" desde un mensaje: va a la línea del chat de ese mensaje. */
  favoriteMessage: (messageId: string) => Promise<StickerDto>;
  /** Acciones propias de la app ('use' en Lines, 'send' en Inbox). null: no es suya. */
  extra?: (action: string, body: Record<string, unknown>) => Promise<NextResponse | null>;
  readJson: (req: Request) => Promise<Record<string, unknown>>;
}

/** POST: crear (multipart con `file` y `line`) o una acción JSON. `source`: los stickers de los chats de una línea. */
export async function stickerRequest(req: Request, owner: StickerOwner, source: (line: string) => StickerSource, a: StickerActions): Promise<NextResponse> {
  const type = req.headers.get('content-type') ?? '';
  if (type.startsWith('multipart/form-data')) {
    if (Number(req.headers.get('content-length') ?? 0) > CREATE_MAX + 64 * 1024) throw new StickerError('sticker_too_large', 413);
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof Blob) || file.size === 0) throw new StickerError('invalid_sticker', 400);
    if (file.size > CREATE_MAX) throw new StickerError('sticker_too_large', 413);
    const o = await lineOwner(owner, form?.get('line'));
    const webp = await imageToSticker(Buffer.from(await file.arrayBuffer()), file.type);
    const { sticker } = await addSticker(o, webp, { source: 'created' });
    return NextResponse.json({ sticker }, { status: 201, headers: NO_STORE });
  }
  const b = await a.readJson(req);
  const action = typeof b.action === 'string' ? b.action : '';
  const id = typeof b.id === 'string' ? b.id.slice(0, 100) : '';
  switch (action) {
    case 'import': {
      // Una tanda por pedido: la pantalla sigue pidiendo mientras `more`.
      const o = await lineOwner(owner, b.line);
      const r = await syncStickers(o, source(o.line!), { limit: IMPORT_BATCH, deadline: Date.now() + IMPORT_MS });
      return NextResponse.json({ ...r, stickers: await listStickers(o) }, { headers: NO_STORE });
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
