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
import { findMentionHits, mentionSuggestions, type MentionHit, type Mentionable } from './crm-mentions';
import { MENTION_ALL, MENTION_ALL_WORDS } from './wa-mention-all';

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
export function waMentionables(participants: ReadonlyArray<WaParticipant>, picked?: ReadonlyMap<string, string>, all?: string | null): Mentionable[] {
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
  // "@all" (y la palabra del idioma, "@todos"): menciona a todo el grupo. Solo donde el proveedor lo manda
  // (quien llama pasa la palabra; sin ella no se ofrece). Va al final: con alguien que se llama igual ("Todos"),
  // gana esa persona (findMentionHits desempata por orden) y "todos" pasa a escribirse "@all".
  if (all) {
    // La palabra que escribe: la del idioma, o la otra ("all" / "todos") si alguien se llama así; si las dos están
    // tomadas por personas, no se ofrece (mencionaría a una persona en vez de al grupo).
    const taken = new Set(out.map((p) => (p.name ?? '').toLowerCase()));
    const word = [all, ...MENTION_ALL_WORDS].find((w) => !taken.has(w.toLowerCase()));
    if (word) out.push({ id: MENTION_ALL, name: word, email: taken.has(MENTION_ALL) ? word : MENTION_ALL });
  }
  return out;
}

/**
 * La lista del "@". Con el campo recién abierto ("@"), Todos primero, como WhatsApp. Escribiendo, Todos aparece
 * solo si su palabra empieza así ("@to", "@al") y después de las personas cuyo nombre también empieza así: una
 * letra suelta nunca deja a todo el grupo elegido por defecto. Todos no ocupa lugar del tope: en un grupo grande
 * sigue estando.
 */
export function waMentionSuggestions(query: string, pool: Mentionable[], limit = 50): Mentionable[] {
  const all = pool.find((p) => p.id === MENTION_ALL);
  if (!all) return mentionSuggestions(query, pool, limit);
  const people = mentionSuggestions(
    query,
    pool.filter((p) => p !== all),
    Math.max(1, limit - 1),
  );
  const q = query.trim().toLowerCase();
  // Sin texto, o con la palabra entera ("@all", "@todos"): Todos primero.
  if (!q || q === (all.name ?? '').toLowerCase() || q === all.email.toLowerCase()) return [all, ...people];
  if (![all.name ?? '', all.email].some((w) => w.toLowerCase().startsWith(q))) return people;
  // mentionSuggestions ordena por puntaje: primero los que empiezan así (nombre, una palabra del nombre o teléfono).
  const strong = people.filter((p) => {
    const name = (p.name ?? '').toLowerCase();
    return name.startsWith(q) || p.email.toLowerCase().startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q));
  }).length;
  return [...people.slice(0, strong), all, ...people.slice(strong)];
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
    // "@all" queda como se escribió ("@all" o "@todos"): WhatsApp avisa a todos por la marca, no por el texto.
    body += h.id === MENTION_ALL ? text.slice(pos, h.end) : `${text.slice(pos, h.start)}@${h.id}`;
    pos = h.end;
    if (!mentions.includes(h.id)) mentions.push(h.id);
  }
  body += text.slice(pos);
  // "all" primero, así el tope de 50 nunca lo deja afuera.
  const ordered = mentions.includes(MENTION_ALL) ? [MENTION_ALL, ...mentions.filter((m) => m !== MENTION_ALL)] : mentions;
  return { body, mentions: ordered.slice(0, 50) };
}

/**
 * Una mención de un mensaje programado: a quién (teléfono) y cómo se ve en el
 * texto ("Ana Paz"). El programado se guarda con "@Ana Paz" (así se lee y se
 * edita en zerosoft) y al salir pasa a "@<teléfono>" con la lista, igual que
 * uno mandado en el momento.
 */
export interface WaMentionPick {
  phone: string;
  label: string;
}

/** Las menciones del texto como pares teléfono + etiqueta (para guardarlas con un programado). */
export function waMentionPicks(text: string, people: Mentionable[]): WaMentionPick[] {
  const out: WaMentionPick[] = [];
  for (const h of findMentionHits(text, people)) {
    const label = text.slice(h.start + 1, h.end);
    if (!out.some((p) => p.phone === h.id && p.label.toLowerCase() === label.toLowerCase())) out.push({ phone: h.id, label });
    if (out.length >= 50) break;
  }
  return out;
}

/** Pares guardados, validados (lo que venga de la API o de la base). */
export function cleanWaMentionPicks(raw: unknown): WaMentionPick[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = raw ? JSON.parse(raw) : [];
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: WaMentionPick[] = [];
  for (const it of list) {
    const o = (it ?? {}) as { phone?: unknown; label?: unknown };
    const phone = typeof o.phone === 'string' ? o.phone : '';
    const label = typeof o.label === 'string' ? o.label.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    if (!PHONE.test(phone) && !(phone === MENTION_ALL && label)) continue;
    if (!out.some((p) => p.phone === phone && p.label === label)) out.push({ phone, label });
    if (out.length >= 50) break;
  }
  return out;
}

/**
 * Lo que sale de un programado: el texto con "@<teléfono>" por cada mención
 * guardada que siga en el texto y la lista de teléfonos (lo mismo que arma
 * serializeWaMentions al mandar en el momento).
 */
export function applyWaMentionPicks(text: string, picks: unknown): { body: string; mentions: string[] } {
  const list = cleanWaMentionPicks(picks);
  if (!list.length) return { body: text, mentions: [] };
  // "todos" reconoce también "@all" (el id va como segundo texto): sirve con la palabra de cualquier idioma.
  const all = list.some((p) => p.phone === MENTION_ALL) ? 'todos' : null;
  return serializeWaMentions(
    text,
    waMentionables(
      list.filter((p) => p.phone !== MENTION_ALL).map((p) => ({ phone: p.phone, name: p.label })),
      undefined,
      all,
    ),
  );
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
