/**
 * Menciones mientras se escribe (Lines e Inbox): en el campo se ve "@Ana"
 * (resaltado en verde, como en WhatsApp Web) y al mandar sale "@5491155550000"
 * con la lista de teléfonos mencionados, que es lo que WhatsApp necesita para
 * avisarle a la persona y mostrar su nombre.
 *
 * Puro (lo usan las pantallas y los tests). Reconoce las menciones con las
 * mismas reglas que las notas (lib/crm-mentions.ts): "@" + el nombre o el
 * teléfono de un participante, sin importar mayúsculas, el más largo primero.
 */
import { findMentionHits, type MentionHit, type Mentionable } from './crm-mentions';

/** Un participante del grupo que se puede mencionar. */
export interface WaParticipant {
  phone: string;
  name: string;
}

const PHONE = /^\d{6,16}$/;

/** Lo que el campo escribe por una persona: su nombre (un solo renglón) o, sin nombre, su teléfono. */
export function waMentionLabel(p: WaParticipant): string {
  return (p.name || '').replace(/\s+/g, ' ').trim() || p.phone;
}

/**
 * Participantes como "mencionables": id = teléfono, nombre = lo que se escribe
 * y el teléfono como segundo texto (así "@5491155…" escrito a mano también
 * menciona). `picked` (etiqueta → teléfono, lo elegido en la lista) va
 * primero: con dos personas del mismo nombre gana la que se eligió.
 */
export function waMentionables(participants: ReadonlyArray<WaParticipant>, picked?: ReadonlyMap<string, string>): Mentionable[] {
  const out: Mentionable[] = [];
  const seen = new Set<string>();
  const add = (phone: string, label: string) => {
    if (!PHONE.test(phone)) return;
    const key = `${phone}\n${label.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: phone, name: label || null, email: phone });
  };
  for (const [label, phone] of picked ?? []) add(phone, label);
  for (const p of participants) add(p.phone, waMentionLabel(p));
  return out;
}

/** Tramos de las menciones del texto (para pintarlas en el campo). */
export function waMentionHits(text: string, people: Mentionable[]): MentionHit[] {
  return findMentionHits(text, people);
}

/**
 * El texto para WhatsApp: cada "@Nombre" pasa a "@<teléfono>" y vuelve la
 * lista de teléfonos mencionados, sin repetir.
 */
export function serializeWaMentions(text: string, people: Mentionable[]): { body: string; mentions: string[] } {
  const hits = findMentionHits(text, people);
  if (!hits.length) return { body: text, mentions: [] };
  let body = '';
  let pos = 0;
  const mentions: string[] = [];
  for (const h of hits) {
    body += `${text.slice(pos, h.start)}@${h.id}`;
    pos = h.end;
    if (!mentions.includes(h.id)) mentions.push(h.id);
  }
  body += text.slice(pos);
  return { body, mentions: mentions.slice(0, 50) };
}

/**
 * Borrar contra una mención la saca entera, como en WhatsApp: Backspace con el
 * cursor al final o dentro de "@Nombre", o Supr con el cursor al principio o
 * dentro. Con texto seleccionado que toca una mención, se borra la selección
 * más la mención completa. null si la tecla no toca ninguna mención.
 */
export function deleteMentionToken(
  text: string,
  selStart: number,
  selEnd: number,
  key: 'Backspace' | 'Delete',
  hits: ReadonlyArray<Pick<MentionHit, 'start' | 'end'>>,
): { text: string; caret: number } | null {
  if (!hits.length) return null;
  let from = selStart;
  let to = selEnd;
  let touched = false;
  for (const h of hits) {
    const hit =
      selStart === selEnd
        ? key === 'Backspace'
          ? selStart > h.start && selStart <= h.end
          : selStart >= h.start && selStart < h.end
        : selStart < h.end && selEnd > h.start;
    if (!hit) continue;
    touched = true;
    from = Math.min(from, h.start);
    to = Math.max(to, h.end);
  }
  if (!touched) return null;
  return { text: text.slice(0, from) + text.slice(to), caret: from };
}

/**
 * La consulta del "@" en curso no abre la lista si ya es una mención completa
 * y el cursor siguió de largo (después de elegir a alguien, el espacio que se
 * agrega no vuelve a abrirla).
 */
export function mentionAlreadyDone(start: number, caret: number, hits: ReadonlyArray<Pick<MentionHit, 'start' | 'end'>>): boolean {
  return hits.some((h) => h.start === start && h.end < caret);
}
