import { NextResponse } from 'next/server';
import { GroupsError, cleanContacts, getChatRow, getNumberRow, listMessages, messageByClientId, presenceWithName, sendGate, sendMessage, toMessageDto } from '@/lib/groups';
import { chatGuard, groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str } from '@/lib/groups-http';
import { canSeeChat, chatAccessSql, maskMessage } from '@/lib/groups-access';
import { limitWrites } from '@/lib/write-limit';
import { cleanClientId } from '@/lib/optimistic-send';
import { normalizePoll } from '@/lib/groups-polls';
import { mediaFromBody } from '@/lib/groups-media-input';
import { onceInFlight } from '@/lib/send-once';
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
  const b = await readJson(req);
  const clientId = cleanClientId(b.clientId);
  // Si es un reintento del mismo envío (mismo clientId), el mensaje ya guardado viene en la misma vuelta.
  const [limited, viewer, chat, existing] = await Promise.all([
    limitWrites('groups', s.me),
    sessionViewer(s),
    getChatRow(s.ws, id),
    clientId ? messageByClientId(id, clientId) : Promise.resolve(null),
  ]);
  if (limited) return limited;
  if (!chat) return groupsError(404, 'not_found');
  // Sin restricciones (dueño y admins) el chat del workspace ya es visible: no hace falta otra consulta, y el tope
  // de envíos de la línea se cuenta junto con leer la línea. Con restricciones, primero el acceso.
  const open = chatAccessSql(viewer) === null;
  const note = b.note === true;
  // Lo que se pide mandar se valida antes de contar el envío contra el tope de la línea: un pedido mal armado
  // (vacío, archivo que no se acepta, encuesta inválida) no le gasta envíos a nadie.
  // { url, mimetype, filename, size?, kind?: 'voice' | 'sticker' | 'document' | ..., width?, height?, duration? }
  let media: ReturnType<typeof mediaFromBody>;
  let poll: ReturnType<typeof normalizePoll> | null = null;
  const contacts = Array.isArray(b.contacts) ? (b.contacts as Array<{ name: string; phone: string }>) : null;
  try {
    media = mediaFromBody(b.media, req);
    if (b.poll != null) {
      try {
        poll = normalizePoll(b.poll);
      } catch (err) {
        throw new GroupsError((err as Error).message);
      }
    }
    if (contacts && cleanContacts(contacts).length === 0) throw new GroupsError('invalid_contact_card');
    if (!poll && !contacts && !media && !(str(b.body) ?? '').trim()) throw new GroupsError('empty_message');
    if ((poll || contacts) && note) throw new GroupsError('invalid_poll');
  } catch (err) {
    return handleGroupsError(err);
  }
  // Ya mandado (reintento): no cuenta otra vez contra el tope de la línea.
  if (existing && existing.chat_id === id && existing.user_id === s.ws) {
    if (!open && !(await canSeeChat(viewer, id).catch(() => false))) return groupsError(404, 'not_found');
    return NextResponse.json(maskMessage(viewer, toMessageDto(existing)), { status: 201 });
  }
  // Todo lo que sigue (acceso, tope de envíos, WhatsApp) corre una sola vez por clientId a la vez en esta instancia:
  // un segundo pedido igual mientras el primero está saliendo espera a ese y devuelve el mismo mensaje.
  return onceInFlight(
    clientId ? `lines:${id}:${clientId}` : null,
    async () => {
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
      try {
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
            clientId,
            ...(contacts ? { contacts } : {}),
            // { linkPreview: false }: el texto sale sin la vista previa del link (la persona la sacó al escribir).
            ...(b.linkPreview === false ? { linkPreview: false } : {}),
          },
          { chat, number, gated, existing: null },
        );
        return NextResponse.json(maskMessage(viewer, msg), { status: 201 });
      } catch (err) {
        return handleGroupsError(err);
      }
    },
    async () => {
      const saved = clientId ? await messageByClientId(id, clientId) : null;
      if (!saved) return groupsError(502, 'send_failed');
      if (!open && !(await canSeeChat(viewer, id).catch(() => false))) return groupsError(404, 'not_found');
      return NextResponse.json(maskMessage(viewer, toMessageDto(saved)), { status: 201 });
    },
  );
}
