import { NextResponse } from 'next/server';
import { GroupsError, getChatRow, listMessages, presenceWithName, sendMessage } from '@/lib/groups';
import { chatGuard, groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';
import { maskMessage } from '@/lib/groups-access';
import { normalizePoll } from '@/lib/groups-polls';
import { mediaFromBody } from '@/lib/groups-media-input';
import { conditionalJson } from '@/lib/etag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Mensajes del chat (los últimos ?limit=). ?after=<iso> trae solo los nuevos. ?before= trae los anteriores, al subir
 * en el hilo: acepta "<createdAt>~<seq>" del mensaje más viejo que ya se tiene (así no se saltea ni repite ninguno
 * cuando varios tienen la misma hora) o una fecha sola. Con If-None-Match y sin cambios responde 304.
 */
export async function GET(req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const guard = await chatGuard(s, id);
  if (guard instanceof NextResponse) return guard;
  const chat = await getChatRow(s.ws, id);
  if (!chat) return groupsError(404, 'not_found');
  const p = new URL(req.url).searchParams;
  const after = p.get('after') || undefined;
  // ?before=<createdAt>: los anteriores (el hilo carga más al subir).
  const before = p.get('before') || undefined;
  const limit = Number(p.get('limit')) || undefined;
  const [messages, presence] = await Promise.all([
    listMessages(s.ws, id, { after, before, limit }),
    // Escribiendo, grabando o en línea (llega por webhook; dura unos segundos).
    presenceWithName(chat).catch(() => null),
  ]);
  return conditionalJson(req, { messages: messages.map((m) => maskMessage(guard.viewer, m)), presence });
}

/** Manda texto, media (ver mediaFromBody), una encuesta ({ poll: { question, options, multi } }), contactos ({ contacts: [{ name, phone }] }) o una nota interna ({ note: true }). */
export async function POST(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const guard = await chatGuard(s, (await ctx.params).id);
  if (guard instanceof NextResponse) return guard;
  const b = await readJson(req);
  // { url, mimetype, filename, size?, kind?: 'voice' | 'sticker' | 'document' | ..., width?, height?, duration? }
  try {
    const media = mediaFromBody(b.media, req);
    let poll = null;
    if (b.poll != null) {
      try {
        poll = normalizePoll(b.poll);
      } catch (err) {
        throw new GroupsError((err as Error).message);
      }
    }
    const msg = await sendMessage(s.ws, s.me, (await ctx.params).id, {
      poll,
      body: str(b.body) ?? '',
      replyToId: str(b.replyToId, 100) || null,
      note: b.note === true,
      media,
      ...(Array.isArray(b.contacts) ? { contacts: b.contacts as Array<{ name: string; phone: string }> } : {}),
      // { linkPreview: false }: el texto sale sin la vista previa del link.
      ...(b.linkPreview === false ? { linkPreview: false } : {}),
    });
    return NextResponse.json(maskMessage(guard.viewer, msg), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
