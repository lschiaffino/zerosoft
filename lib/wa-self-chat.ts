/**
 * Inbox y Lines: el chat con uno mismo ("Mensaje para mí") y lo que no es de él.
 *
 * Dos caminos dejaban mensajes de otro en el chat con uno mismo:
 *
 * 1. Meta AI y sus personajes ("@bot"). Baileys (el WhatsApp Web de Evolution)
 *    arma el id del chat con el destinatario cuando el mensaje es propio, salvo
 *    que el destinatario sea un "@bot": ahí usa el remitente, que es la cuenta
 *    (src/Utils/decode-wa-message.ts, `recipient && !isJidMetaAI(recipient)`).
 *    Esos mensajes vienen marcados (`bot`, isBotTraffic en
 *    lib/groups-provider-bridge.ts) y van al chat de Meta AI.
 * 2. Un remitente con lid cuyo "alternativo" es el teléfono propio. Baileys
 *    pone en remoteJidAlt el teléfono del remitente o, si no viene,
 *    peer_recipient_pn (el del destinatario, o sea el propio), y Evolution
 *    reemplaza el remoteJid "@lid" por ese remoteJidAlt antes del webhook. El
 *    mensaje de la otra persona llega con el id propio y sin su lid.
 *
 * Lo del chat con uno mismo es siempre propio (fromMe): un mensaje recibido con
 * el id propio es de otra persona. Va al chat de su lid si llegó (la libreta
 * después lo pasa al de su teléfono), al de Meta AI si trae la marca, y si no
 * hay nada más, a un chat aparte por el nombre de perfil de quien lo mandó
 * (`<letras>@unknown`): nunca al chat con uno mismo. Lo propio sin marca (lo
 * que uno se manda) queda donde está.
 *
 * Corre antes de que la libreta aprenda de la tanda: así no aprende que el
 * teléfono propio se llama como quien mandó el mensaje. Puro: sin base ni red.
 */
import { createHash } from 'crypto';
import { META_AI_JID, phoneDigits, type InboundEvent } from './groups-provider';

/** Nombre del chat de Meta AI cuando no llega otro (es un nombre propio: no se traduce). */
export const META_AI_NAME = 'Meta AI';

type MessageEvent = Extract<InboundEvent, { type: 'message' }>;

/** ¿El chat 1:1 es el de la cuenta propia? `ownPhone`: el teléfono de la línea o cuenta (dígitos). */
export function isOwnChat(chatId: string, ownPhone: string): boolean {
  const own = phoneDigits(ownPhone);
  return own.length >= 8 && phoneDigits(chatId) === own;
}

/**
 * Chat de quien mandó un mensaje sin ningún id propio que lo identifique (solo su nombre de perfil). Solo letras: no
 * se lee como un teléfono. El mismo nombre da siempre el mismo chat.
 */
export function unknownSenderJid(name: string): string {
  const hex = createHash('sha256').update(name.trim().toLowerCase() || '-').digest('hex').slice(0, 16);
  return `${hex.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)))}@unknown`;
}

/** Adónde va un mensaje que llegó con el id propio y no es del chat con uno mismo ('' = es de ese chat). */
export function selfChatTarget(e: MessageEvent, ownPhone: string): string {
  if (e.isGroup || !isOwnChat(e.chatId, ownPhone)) return '';
  if (e.bot) return META_AI_JID;
  if (e.fromMe) return '';
  const lid = e.chatLid || e.senderLid;
  if (lid) return `${lid}@lid`;
  return unknownSenderJid(e.senderName);
}

/** Lo que llegó con el id propio y no es del chat con uno mismo → a su chat. El resto, igual. */
export function routeSelfChat<E extends { type: string }>(events: E[], ownPhone: string): E[] {
  if (phoneDigits(ownPhone).length < 8) return events;
  let changed = false;
  const out = events.map((e) => {
    if (e.type !== 'message') return e;
    const m = e as unknown as MessageEvent;
    const target = selfChatTarget(m, ownPhone);
    if (!target) return e;
    changed = true;
    // El teléfono que traía era el propio, no el de quien mandó: no va (la libreta no lo aprende). La media se sigue
    // bajando con el id con el que llegó (fetchRef): así la guarda Evolution.
    const next: MessageEvent = { ...m, chatId: target, senderPhone: m.fromMe ? m.senderPhone : '' };
    if (target === META_AI_JID) {
      // El lid que traía era el de la cuenta.
      delete next.chatLid;
      delete next.senderLid;
      next.chatName = m.chatName || META_AI_NAME;
      if (!m.fromMe) next.senderName = m.senderName || META_AI_NAME;
    } else if (target.endsWith('@lid')) {
      const lid = target.replace(/@lid$/, '');
      next.chatLid = lid;
      next.senderLid = lid;
    }
    return next as unknown as E;
  });
  return changed ? out : events;
}
