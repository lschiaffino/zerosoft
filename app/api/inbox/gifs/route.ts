import { iJson, withOwner } from '@/lib/inbox/http';
import { listMessages } from '@/lib/inbox/core';
import { cleanClientId } from '@/lib/optimistic-send';
import { limitByIp } from '@/lib/rate-limit';
import { sendWhatsappMedia } from '@/lib/inbox/wa-media';
import { GifError } from '@/lib/wa-gifs';
import { chosenGif, gifsResponse } from '@/lib/wa-gifs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Inbox: GIFs para mandar por WhatsApp (lib/wa-gifs.ts).
 * GET ?q=&pos=&locale=: tendencias (sin q) o búsqueda: { provider, items, next }
 * (provider null: no hay clave de GIPHY ni de Tenor).
 * POST { threadId, url, width?, height?, replyTo?, clientId? }: baja el MP4 y lo
 * manda como video con gifPlayback; devuelve los mensajes del chat, como
 * mandar un archivo.
 */
export async function GET(req: Request) {
  return withOwner((owner) => gifsResponse(req, `inbox:${owner}`));
}

export async function POST(req: Request) {
  const limited = await limitByIp(req, 'inbox-send', 120, 60).catch(() => null);
  if (limited) return limited;
  return withOwner(async (owner) => {
    const raw = (await req.json().catch(() => null)) as unknown;
    const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const threadId = typeof b.threadId === 'string' ? b.threadId.slice(0, 100) : '';
    let gif: Awaited<ReturnType<typeof chosenGif>>;
    try {
      gif = await chosenGif(req, `inbox:${owner}`, b);
    } catch (err) {
      if (err instanceof GifError) return iJson({ error: err.code }, err.status);
      throw err;
    }
    const clientId = cleanClientId(b.clientId);
    await sendWhatsappMedia(owner, threadId, {
      data: gif.data,
      mimetype: 'video/mp4',
      filename: 'gif.mp4',
      size: gif.data.length,
      kind: 'video',
      gif: true,
      ...(gif.width && gif.height ? { width: gif.width, height: gif.height } : {}),
      ...(typeof b.replyTo === 'string' && b.replyTo ? { replyTo: b.replyTo.slice(0, 100) } : {}),
      ...(clientId ? { clientId } : {}),
    });
    const page = await listMessages(owner, threadId);
    return iJson({ messages: page.messages, more: page.more }, 201);
  });
}
