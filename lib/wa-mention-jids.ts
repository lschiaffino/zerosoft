/**
 * Menciones de WhatsApp al salir hacia el servidor (Lines e Inbox, mandadas
 * en el momento o programadas): el texto y la lista de mencionados tienen que
 * nombrar a cada persona con el mismo id, o el teléfono muestra "@<dígitos>"
 * sin resaltar en vez de "@Nombre".
 *
 * - Grupo por teléfono (addressingMode 'pn'): "@<teléfono>" en el texto y
 *   "<teléfono>@s.whatsapp.net" en la lista. El JID va completo: Evolution
 *   arma el JID de un número suelto con createJid, que a los celulares de
 *   Argentina y México les saca el 9 / el 1 (5491155550000 → 541155550000) y
 *   la lista ya no coincide con el texto.
 * - Grupo por lid (addressingMode 'lid'): WhatsApp nombra a cada participante
 *   por su lid, así que va "@<lid>" en el texto y "<lid>@lid" en la lista.
 *
 * zerosoft guarda y muestra el mensaje con "@<teléfono>" (el nombre sale de la
 * libreta); esto solo cambia lo que viaja al servidor de WhatsApp. Puro.
 */

export type MentionAddressing = 'pn' | 'lid';

/** Un participante del grupo: su teléfono y, si se conoce, su lid (dígitos). */
export interface MentionMember {
  phone: string;
  lid?: string;
}

export interface MentionGroup {
  addressing: MentionAddressing;
  members: MentionMember[];
}

const DIGITS = /^\d{5,20}$/;
const LID = /^(\d{5,20})@lid$/i;

/**
 * Cómo direcciona WhatsApp un grupo, según los ids de sus participantes (lo
 * que Baileys llama addressingMode): si la mayoría son "<dígitos>@lid", por
 * lid; si no, por teléfono.
 */
export function groupAddressing(participantIds: ReadonlyArray<unknown>): MentionAddressing {
  let lid = 0;
  let pn = 0;
  for (const id of participantIds) {
    if (typeof id !== 'string' || !id) continue;
    if (/@lid$/i.test(id)) lid++;
    else if (/@(s\.whatsapp\.net|c\.us)$/i.test(id)) pn++;
  }
  return lid > pn ? 'lid' : 'pn';
}

function swapToken(text: string, from: string, to: string): string {
  if (from === to) return text;
  return text.replace(new RegExp(`(^|[^\\w@])@${from}(?!\\d)`, 'g'), `$1@${to}`);
}

/**
 * El texto y los JIDs mencionados tal como salen al servidor de WhatsApp.
 * `mentions`: teléfonos (dígitos) o "<dígitos>@lid", como se guardan. `group`:
 * cómo direcciona el grupo y sus participantes (null si no se sabe: se
 * menciona por teléfono, con el JID completo).
 */
export function waMentionPayload(text: string, mentions: ReadonlyArray<string>, group?: MentionGroup | null): { text: string; mentioned: string[] } {
  const byPhone = new Map<string, MentionMember>();
  const byLid = new Map<string, MentionMember>();
  for (const m of group?.members ?? []) {
    if (DIGITS.test(m.phone)) byPhone.set(m.phone, m);
    if (m.lid && DIGITS.test(m.lid)) byLid.set(m.lid, m);
  }
  const lidGroup = group?.addressing === 'lid';
  let out = text;
  const mentioned: string[] = [];
  for (const raw of mentions) {
    if (typeof raw !== 'string') continue;
    const asLid = LID.exec(raw.trim());
    let phone = '';
    let lid = '';
    if (asLid) {
      lid = asLid[1];
      phone = byLid.get(lid)?.phone ?? '';
    } else if (DIGITS.test(raw)) {
      phone = raw;
      lid = byPhone.get(phone)?.lid ?? '';
    } else continue;
    const useLid = !!lid && (lidGroup || !phone);
    const target = useLid ? lid : phone;
    out = swapToken(out, asLid ? lid : phone, target);
    const jid = useLid ? `${lid}@lid` : `${phone}@s.whatsapp.net`;
    if (!mentioned.includes(jid)) mentioned.push(jid);
    if (mentioned.length >= 50) break;
  }
  return { text: out, mentioned };
}
