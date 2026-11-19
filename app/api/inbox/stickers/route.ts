import { NextResponse } from 'next/server';
import { iJson, withOwner } from '@/lib/inbox/http';
import { listMessages } from '@/lib/inbox/core';
import { cleanClientId } from '@/lib/optimistic-send';
import { limitByIp } from '@/lib/rate-limit';
import { favoriteInboxMessage, inboxStickerOwner, inboxStickerSource, sendInboxSticker } from '@/lib/inbox/wa-stickers';
import { stickerRequest, stickerResponse } from '@/lib/wa-stickers-http';
import { StickerError } from '@/lib/wa-stickers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Inbox: los stickers de la persona, por cuenta de WhatsApp (lib/wa-stickers.ts).
 * GET ?line=<cuenta>: { stickers, imported } de esa cuenta, directo de la base
 * (no baja nada de WhatsApp); ?img=<id> devuelve la imagen. Una cuenta que no
 * es suya responde 404, igual que una que no existe.
 * POST JSON: { action: 'import', line } (de los chats de esa cuenta, por
 * tandas: `more`), { action: 'favorite', id, favorite }, { action:
 * 'favoriteMessage', messageId } (queda en la cuenta del chat del mensaje),
 * { action: 'remove', id }, { action: 'send', id, threadId, replyTo?,
 * clientId? } (devuelve los mensajes del chat, como mandar un archivo).
 * Multipart con `file` y `line`: crea un sticker desde una imagen en esa cuenta.
 */
export async function GET(req: Request) {
  return withOwner(async (owner) => {
    try {
      return await stickerResponse(req, inboxStickerOwner(owner));
    } catch (err) {
      return fail(err);
    }
  });
}

export async function POST(req: Request) {
  const limited = await limitByIp(req, 'inbox-send', 120, 60).catch(() => null);
  if (limited) return limited;
  return withOwner(async (owner) => {
    try {
      return await stickerRequest(req, inboxStickerOwner(owner), (line) => inboxStickerSource(owner, line), {
        favoriteMessage: (messageId) => favoriteInboxMessage(owner, messageId),
        extra: async (action, b) => {
          if (action !== 'send') return null;
          const threadId = typeof b.threadId === 'string' ? b.threadId.slice(0, 100) : '';
          await sendInboxSticker(owner, threadId, typeof b.id === 'string' ? b.id.slice(0, 100) : '', {
            replyTo: typeof b.replyTo === 'string' && b.replyTo ? b.replyTo.slice(0, 100) : undefined,
            clientId: cleanClientId(b.clientId),
          });
          const page = await listMessages(owner, threadId);
          return iJson({ messages: page.messages, more: page.more }, 201);
        },
        readJson: async (r) => {
          const body = (await r.json().catch(() => null)) as unknown;
          return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
        },
      });
    } catch (err) {
      return fail(err);
    }
  });
}

function fail(err: unknown): NextResponse {
  if (err instanceof StickerError) return iJson({ error: err.code }, err.status);
  // El resto (InboxError) lo traduce withOwner.
  throw err;
}
