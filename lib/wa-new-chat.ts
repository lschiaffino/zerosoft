/**
 * "Chat nuevo" de WhatsApp (Lines e Inbox): la libreta como en WhatsApp Web.
 * Funciones puras, sin base ni red: las usan las dos APIs y el panel.
 *
 * - Orden alfabético que ignora tildes y mayúsculas ("Álvaro" va con la A), y
 *   los nombres que no empiezan con una letra (un teléfono, un emoji) al
 *   final, bajo "#".
 * - Búsqueda por nombre sin tildes y por teléfono escrito de cualquier forma
 *   ("+54 9 11 5555-0000", "011 5555 0000", "1155550000").
 * - Páginas con cursor: el cursor es la última fila mostrada (nombre y clave),
 *   así un contacto que entra entre una página y otra no repite ni saltea filas.
 */

/** Una fila del panel: un chat que ya existe, un contacto de la libreta, o la persona misma. */
export interface NewChatEntry {
  /** Clave estable de la fila ("chat:<id>", "contact:<id>", "self"). */
  key: string;
  /** Chat 1:1 que ya existe: se abre directo. */
  chatId?: string;
  /** Contacto de la libreta sin chat: se abre con su id (Lines) o su teléfono (Inbox). */
  contactId?: string;
  name: string;
  /** Teléfono para mostrar ("+54 9 11 …", o enmascarado para quien no los ve). */
  phoneLabel: string;
  /** Dígitos del teléfono; vacío para quien tiene los teléfonos ocultos. */
  phone: string;
  pictureUrl: string;
  /** "Info" (estado) del contacto, si se conoce. */
  about: string;
}

export interface NewChatDirectory {
  /** "Mandate un mensaje" (solo en Inbox, que es la cuenta de la persona). */
  self: NewChatEntry | null;
  /** Los chats con más mensajes en los últimos 30 días (sin búsqueda, primera página). */
  frequent: NewChatEntry[];
  /** Contactos y chats en orden alfabético: una página. */
  contacts: NewChatEntry[];
  /** Cursor de la página siguiente, o null si no hay más. */
  next: string | null;
  /** Cuántos contactos hay en total (con la búsqueda aplicada). */
  total: number;
}

export const NEW_CHAT_PAGE = 100;
export const NEW_CHAT_PAGE_MAX = 200;
export const NEW_CHAT_FREQUENT = 5;
/** Días de mensajes que cuentan para "con frecuencia". */
export const NEW_CHAT_FREQUENT_DAYS = 30;
/** Chats recientes entre los que se cuentan los mensajes. */
export const NEW_CHAT_FREQUENT_SCAN = 40;
/** Tope de filas que se leen para armar la libreta (una cuenta grande tiene unos pocos miles). */
export const NEW_CHAT_MAX_ROWS = 20000;

/** Sin tildes ni mayúsculas: "Ángela Núñez" → "angela nunez". */
export function foldText(raw: string): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

/** Letra del encabezado: la primera letra sin tilde, en mayúscula, o "#" si el nombre no empieza con una letra. */
export function newChatLetter(name: string): string {
  const first = foldText(name).charAt(0);
  return /^\p{L}$/u.test(first) ? first.toUpperCase() : '#';
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** Orden de la libreta: primero los nombres con letra, después "#"; dentro, alfabético; empate, por clave. */
export function compareNewChat(a: Pick<NewChatEntry, 'name' | 'key'>, b: Pick<NewChatEntry, 'name' | 'key'>): number {
  const la = newChatLetter(a.name) === '#' ? 1 : 0;
  const lb = newChatLetter(b.name) === '#' ? 1 : 0;
  if (la !== lb) return la - lb;
  const byName = collator.compare(foldText(a.name), foldText(b.name));
  if (byName !== 0) return byName;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export interface NewChatQuery {
  /** Texto sin tildes. */
  text: string;
  /** Dígitos, si lo escrito parece un teléfono (3 o más). */
  digits: string;
}

export function parseNewChatQuery(raw: string): NewChatQuery {
  const s = String(raw ?? '').trim().slice(0, 80);
  const phoneish = /^\+?[\d\s().-]+$/.test(s);
  const digits = phoneish ? s.replace(/\D/g, '') : '';
  return { text: foldText(s), digits: digits.length >= 3 ? digits : '' };
}

/** Formas de esos dígitos que pueden estar dentro del teléfono guardado (sin el 0 de larga distancia, con el 9 de Argentina). */
function phoneNeedles(digits: string): string[] {
  const out = new Set<string>([digits]);
  const noZero = digits.replace(/^0+/, '');
  if (noZero.length >= 3) out.add(noZero);
  // "+54 11 …" (sin el 9 de los celulares): WhatsApp lo guarda como 549…
  if (/^54[1-8]/.test(digits)) out.add(`549${digits.slice(2)}`);
  return [...out];
}

/**
 * ¿La fila coincide con lo escrito? Por nombre (sin tildes, en cualquier parte)
 * y, si se permite, por teléfono. Con los teléfonos ocultos no se busca por
 * teléfono: daría un modo de adivinarlos.
 */
export function matchesNewChat(entry: Pick<NewChatEntry, 'name' | 'phone' | 'about'>, q: NewChatQuery, opts: { phone: boolean; rawPhone?: string }): boolean {
  if (!q.text && !q.digits) return true;
  if (q.text && foldText(entry.name).includes(q.text)) return true;
  if (opts.phone && q.digits) {
    const phone = opts.rawPhone ?? entry.phone;
    if (phone && phoneNeedles(q.digits).some((n) => phone.includes(n))) return true;
  }
  return false;
}

function encodeCursor(e: Pick<NewChatEntry, 'name' | 'key'>): string {
  return JSON.stringify([e.name, e.key]);
}

function decodeCursor(raw: string | null | undefined): { name: string; key: string } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(String(raw).slice(0, 2000)) as unknown;
    if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string') return { name: v[0], key: v[1] };
  } catch {
    /* un cursor roto es la primera página */
  }
  return null;
}

/** Una página de filas ya ordenadas, desde después del cursor. */
export function pageNewChat<T extends Pick<NewChatEntry, 'name' | 'key'>>(sorted: T[], cursor: string | null | undefined, limit = NEW_CHAT_PAGE): { rows: T[]; next: string | null } {
  const size = Math.max(1, Math.min(NEW_CHAT_PAGE_MAX, Math.floor(limit) || NEW_CHAT_PAGE));
  const after = decodeCursor(cursor);
  let start = 0;
  if (after) {
    // Búsqueda binaria: la primera fila que va después del cursor.
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compareNewChat(sorted[mid], after) <= 0) lo = mid + 1;
      else hi = mid;
    }
    start = lo;
  }
  const rows = sorted.slice(start, start + size);
  const next = start + size < sorted.length && rows.length ? encodeCursor(rows[rows.length - 1]) : null;
  return { rows, next };
}

/**
 * Junta chats y contactos de la libreta en una sola lista (una fila por
 * teléfono: el chat gana y toma la info y el nombre de la libreta si no
 * tiene uno), la filtra y la ordena.
 */
export function mergeNewChat(chats: NewChatEntry[], book: NewChatEntry[], phoneOf: (e: NewChatEntry) => string): NewChatEntry[] {
  const byPhone = new Map<string, NewChatEntry>();
  const out: NewChatEntry[] = [];
  for (const c of chats) {
    const p = phoneOf(c);
    if (p) {
      if (byPhone.has(p)) continue;
      byPhone.set(p, c);
    }
    out.push(c);
  }
  for (const b of book) {
    const p = phoneOf(b);
    const chat = p ? byPhone.get(p) : undefined;
    if (chat) {
      if (!chat.about && b.about) chat.about = b.about;
      // Un chat que solo tiene el número toma el nombre de la libreta.
      if (chat.name === chat.phoneLabel && b.name && b.name !== b.phoneLabel) chat.name = b.name;
      if (!chat.pictureUrl && b.pictureUrl) chat.pictureUrl = b.pictureUrl;
      continue;
    }
    if (p) byPhone.set(p, b);
    out.push(b);
  }
  return out;
}
