import { iJson, withOwner } from '@/lib/inbox/http';
import { listMessages } from '@/lib/inbox/core';
import { limitByIp } from '@/lib/rate-limit';
import { parseMediaKind } from '@/lib/groups-media';
import { INLINE_MEDIA_MAX, sendWhatsappMedia } from '@/lib/inbox/wa-media';
import { InboxError } from '@/lib/inbox/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Manda un archivo al chat de WhatsApp. Multipart (`file`, `caption`,
 * `kind`, `duration`, `replyTo`) hasta 4 MB; más grande, JSON con la `url` de
 * Blob que subió el navegador ({ url, mimetype, filename, size, caption,
 * kind, duration, replyTo }). Devuelve los mensajes del chat.
 */
export async function POST(req: Request, ctx: Ctx) {
  const limited = await limitByIp(req, 'inbox-send', 120, 60).catch(() => null);
  if (limited) return limited;
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    const type = req.headers.get('content-type') ?? '';
    if (type.startsWith('multipart/form-data')) {
      if (Number(req.headers.get('content-length') ?? 0) > INLINE_MEDIA_MAX + 64 * 1024) throw new InboxError('file_too_large', 413);
      const form = await req.formData().catch(() => null);
      const file = form?.get('file');
      if (!form || !(file instanceof Blob) || file.size === 0) throw new InboxError('invalid_input', 400);
      if (file.size > INLINE_MEDIA_MAX) throw new InboxError('file_too_large', 413);
      await sendWhatsappMedia(owner, id, {
        data: Buffer.from(await file.arrayBuffer()),
        mimetype: file.type,
        filename: file instanceof File ? file.name : 'file',
        size: file.size,
        caption: String(form.get('caption') ?? ''),
        kind: parseMediaKind(form.get('kind')),
        duration: Number(form.get('duration') ?? 0) || undefined,
        replyTo: String(form.get('replyTo') ?? '') || undefined,
      });
    } else {
      const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!b || typeof b.url !== 'string') throw new InboxError('invalid_input', 400);
      await sendWhatsappMedia(owner, id, {
        url: b.url,
        mimetype: String(b.mimetype ?? ''),
        filename: String(b.filename ?? ''),
        size: Number(b.size) || 0,
        caption: typeof b.caption === 'string' ? b.caption : '',
        kind: parseMediaKind(b.kind),
        duration: Number(b.duration) || undefined,
        replyTo: typeof b.replyTo === 'string' && b.replyTo ? b.replyTo : undefined,
      });
    }
    const page = await listMessages(owner, id);
    return iJson({ messages: page.messages, more: page.more }, 201);
  });
}
