import { NextResponse } from 'next/server';
import { getAccount, getMessageRow, getThreadRow } from '@/lib/inbox/core';
import { withOwner } from '@/lib/inbox/http';
import { InboxError } from '@/lib/inbox/types';
import { inboxMedia } from '@/lib/inbox/media-store';
import { rangedResponse } from '@/lib/byte-range';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const INLINE = /^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|mp4|aac|webm|wav)|video\/(mp4|webm))$/;

/** Archivo de un mensaje de WhatsApp (foto, audio, video, documento): la copia guardada o, la primera vez, bajado del servidor. */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const thumbOnly = new URL(req.url).searchParams.get('thumb') === '1';
  return withOwner(async (owner) => {
    const msg = await getMessageRow(owner, id);
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
    // La copia guardada si está; si no, se baja del servidor de WhatsApp y se guarda (lib/inbox/media-store.ts).
    const file = await inboxMedia(account, owner, msg);
    const mime = (file.mimetype || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const inline = INLINE.test(mime);
    const name = (file.filename || msg.media_name || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120);
    // Con Range (206): el audio y el video se pueden adelantar, y Safari los reproduce. Los rangos salen de la copia
    // guardada (no se vuelve a pedir el archivo al servidor de WhatsApp).
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
