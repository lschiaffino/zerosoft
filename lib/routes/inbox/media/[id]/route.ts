import { NextResponse } from 'next/server';
import { getAccount, getMessageRow, getThreadRow } from '@/lib/inbox/core';
import { withOwner } from '@/lib/inbox/http';
import { InboxError } from '@/lib/inbox/types';
import { fetchWhatsappMedia } from '@/lib/inbox/whatsapp';
import { getDb } from '@/lib/db';
import { isPdf, validDocThumb, validPages } from '@/lib/wa-doc-thumb';
import { linkHqBytes, type StoredLink } from '@/lib/wa-link-thumb';
import { rangedResponse } from '@/lib/byte-range';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const INLINE = /^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|mp4|aac|webm|wav)|video\/(mp4|webm))$/;

/** Archivo de un mensaje de WhatsApp (foto, audio, video, documento), bajado del servidor al pedirlo. */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const thumbOnly = new URL(req.url).searchParams.get('thumb') === '1';
  return withOwner(async (owner) => {
    const msg = await getMessageRow(owner, id);
    // ?link=1: la imagen grande de la vista previa del link (la bajó el servidor al llegar el mensaje).
    if (new URL(req.url).searchParams.get('link') === '1') {
      let link: StoredLink | undefined;
      try {
        link = msg.meta ? ((JSON.parse(msg.meta) as { link?: StoredLink }).link ?? undefined) : undefined;
      } catch {
        link = undefined;
      }
      const img = linkHqBytes(link);
      if (!img) throw new InboxError('not_found', 404);
      return new NextResponse(new Uint8Array(img.bytes), {
        headers: { 'content-type': img.type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" },
      });
    }
    // ?thumb=1: la miniatura que mandó WhatsApp (sin bajar el archivo), para la lista y lo compartido.
    if (thumbOnly) {
      let thumb = '';
      try {
        thumb = msg.meta ? String((JSON.parse(msg.meta) as { thumb?: string }).thumb ?? '') : '';
      } catch {
        thumb = '';
      }
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(thumb);
      if (!m) throw new InboxError('not_found', 404);
      return new NextResponse(new Uint8Array(Buffer.from(m[1], 'base64')), {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' },
      });
    }
    const thread = await getThreadRow(owner, msg.thread_id);
    if (thread.channel !== 'whatsapp' || !msg.media_ref) throw new InboxError('not_found', 404);
    const account = await getAccount(owner, thread.account_id);
    const file = await fetchWhatsappMedia(account, msg.media_ref);
    const mime = (file.mimetype || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const inline = INLINE.test(mime);
    const name = (file.filename || msg.media_name || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120);
    // Con Range (206): el audio y el video se pueden adelantar, y Safari los reproduce. Cada pedido de rango vuelve a
    // traer el archivo del servidor de WhatsApp (Inbox no lo guarda todavía); la caché privada de una hora del
    // navegador cubre lo ya pedido.
    const res = rangedResponse(req, file.data, {
      'content-type': inline ? mime : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=3600',
    });
    return new NextResponse(res.body, { status: res.status, headers: res.headers });
  });
}

/**
 * Guarda la vista previa de la primera página de un PDF (la dibujó el
 * navegador de quien lo vio primero): un JPEG chico validado por sus bytes,
 * solo en un PDF que todavía no tiene. Después llega con el mensaje.
 */
export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { thumb?: unknown; pages?: unknown } | null;
  return withOwner(async (owner) => {
    const msg = await getMessageRow(owner, id);
    let meta: Record<string, unknown> = {};
    try {
      meta = msg.meta ? (JSON.parse(msg.meta) as Record<string, unknown>) : {};
    } catch {
      meta = {};
    }
    const thumb = validDocThumb(body?.thumb);
    if (!thumb || msg.media_type !== 'document' || !isPdf(String(meta.mime ?? ''), msg.media_name)) throw new InboxError('invalid_input', 400);
    if (!meta.thumb) {
      const pages = validPages(body?.pages);
      await getDb()
        .prepare('UPDATE inbox_messages SET meta = ? WHERE id = ? AND owner_id = ?')
        .run(JSON.stringify({ ...meta, thumb, ...(pages && !meta.pages ? { pages } : {}) }), msg.id, owner);
    }
    return NextResponse.json({ ok: true });
  });
}
