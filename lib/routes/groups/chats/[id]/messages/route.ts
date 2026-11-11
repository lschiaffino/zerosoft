import { NextResponse } from 'next/server';
import { GroupsError, getChatRow, getNumberRow, listMessages, presenceWithName, sendGate, sendMessage } from '@/lib/groups';
import { chatGuard, groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str } from '@/lib/groups-http';
import { canSeeChat, chatAccessSql, maskMessage } from '@/lib/groups-access';
import { limitWrites } from '@/lib/write-limit';
import { cleanClientId } from '@/lib/optimistic-send';
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
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  // Lo que no depende entre sí va junto (en Turso cada consulta es una ida y vuelta): el tope de escrituras de la
  // persona, quién mira y el chat; después, si puede verlo, la línea. Nada sale ni se manda sin pasar el acceso.
  const [limited, viewer, chat] = await Promise.all([limitWrites('groups', s.me), sessionViewer(s), getChatRow(s.ws, id)]);
  if (limited) return limited;
  if (!chat) return groupsError(404, 'not_found');
  // Sin restricciones (dueño y admins) el chat del workspace ya es visible: no hace falta otra consulta, y el tope
  // de envíos de la línea se cuenta junto con leer la línea. Con restricciones, primero el acceso.
  const open = chatAccessSql(viewer) === null;
  const b = await readJson(req);
  const note = b.note === true;
  let visible: boolean;
  let number: Awaited<ReturnType<typeof getNumberRow>>;
  let gated = false;
  try {
    if (open && !note) {
      [number] = await Promise.all([getNumberRow(s.ws, chat.number_id), sendGate(chat.number_id)]);
      visible = true;
      gated = true;
    } else if (open) {
      number = await getNumberRow(s.ws, chat.number_id);
      visible = true;
    } else {
      [visible, number] = await Promise.all([canSeeChat(viewer, id), getNumberRow(s.ws, chat.number_id)]);
    }
  } catch (err) {
    return handleGroupsError(err);
  }
  if (!visible) return groupsError(404, 'not_found');
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
    const msg = await sendMessage(
      s.ws,
      s.me,
      id,
      {
        poll,
        body: str(b.body) ?? '',
        replyToId: str(b.replyToId, 100) || null,
        note,
        media,
        clientId: cleanClientId(b.clientId),
        ...(Array.isArray(b.contacts) ? { contacts: b.contacts as Array<{ name: string; phone: string }> } : {}),
      },
      { chat, number, gated },
    );
    return NextResponse.json(maskMessage(viewer, msg), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
