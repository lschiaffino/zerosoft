import { NextResponse } from 'next/server';
import { getAccount, getMessageRow, getThreadRow } from '@/lib/inbox/core';
import { withOwner } from '@/lib/inbox/http';
import { InboxError } from '@/lib/inbox/types';
import { fetchWhatsappMedia } from '@/lib/inbox/whatsapp';

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
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        'content-type': inline ? mime : 'application/octet-stream',
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cache-control': 'private, max-age=3600',
      },
    });
  });
}
