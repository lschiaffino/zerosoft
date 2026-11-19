/**
 * Orden de la búsqueda en las listas de chats (Inbox y Lines), como en
 * WhatsApp: primero los chats cuyo nombre coincide, después los que solo
 * coinciden por el texto de algún mensaje.
 *
 * El rango es un carácter que se antepone a la clave de orden por actividad,
 * así el cursor (clave, id) de la lista sirve igual con búsqueda:
 *   '2' cada palabra buscada empieza una palabra del nombre (en cualquier orden);
 *   '1' el nombre tiene todas las palabras en otra parte, o coincide el teléfono o la dirección;
 *   '0' coincide solo por mensajes (o por la vista previa).
 */
export interface SearchRank {
  sql: string;
  args: string[];
}

export const MESSAGE_ONLY_RANK = '0';

function esc(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Tope de palabras que se buscan en el nombre (cada una suma condiciones a la consulta). */
const MAX_WORDS = 6;

/**
 * Las palabras de lo buscado, sin puntuación: "Pol eze lauta" y "pol, eze" encuentran el grupo "Pol, Eze, Lauta" y
 * también "Eze, Pol, Lauta". En WhatsApp el nombre coincide si tiene todas las palabras, en cualquier orden.
 */
export function searchWords(text: string): string[] {
  const words = text
    .split(/[\s,.;:!?¿¡"'()[\]{}<>|/\\+&·•~–—-]+/u)
    .map((w) => w.trim())
    .filter(Boolean);
  return [...new Set(words.map((w) => w.toLowerCase()))].slice(0, MAX_WORDS);
}

/** Un teléfono escrito con +, espacios, guiones o paréntesis → sus dígitos (vacío si lo buscado no es un teléfono). */
export function searchDigits(text: string): string {
  const t = text.trim();
  if (!/^[\d\s+().-]+$/.test(t)) return '';
  const digits = t.replace(/\D/g, '');
  return digits.length >= 3 ? digits : '';
}

interface Parts {
  /** Todas las palabras empiezan una palabra del nombre. */
  starts: SearchRank;
  /** Todas las palabras están en el nombre, o coincide el teléfono o la dirección. */
  hit: SearchRank;
}

function parts(nameCol: string, handleCol: string, text: string): Parts {
  const raw = text.trim();
  const words = searchWords(raw);
  const list = words.length ? words : [raw.toLowerCase()];
  const like = (col: string) => `${col} LIKE ? ESCAPE '\\'`;
  const starts: SearchRank = {
    sql: `(${list.map(() => `(${like(nameCol)} OR ${like(nameCol)})`).join(' AND ')})`,
    args: list.flatMap((w) => [`${esc(w)}%`, `% ${esc(w)}%`]),
  };
  const digits = searchDigits(raw);
  const handle = [`%${esc(raw)}%`, ...(digits && digits !== raw ? [`%${digits}%`] : [])];
  const hit: SearchRank = {
    sql: `((${list.map(() => like(nameCol)).join(' AND ')}) OR ${handle.map(() => like(handleCol)).join(' OR ')})`,
    args: [...list.map((w) => `%${esc(w)}%`), ...handle],
  };
  return { starts, hit };
}

/** Condición SQL: el chat coincide por nombre (todas las palabras, en cualquier orden), teléfono o dirección. */
export function chatNameHit(nameCol: string, handleCol: string, text: string): SearchRank {
  return parts(nameCol, handleCol, text).hit;
}

/** Expresión SQL del rango ('2', '1' o '0') para las columnas de nombre y teléfono o dirección del chat. */
export function chatNameRank(nameCol: string, handleCol: string, text: string): SearchRank {
  const { starts, hit } = parts(nameCol, handleCol, text);
  return {
    sql: `(CASE WHEN ${starts.sql} THEN '2' WHEN ${hit.sql} THEN '1' ELSE '0' END)`,
    args: [...starts.args, ...hit.args],
  };
}

/** Lo mismo que chatNameHit, sobre un nombre y un teléfono ya leídos (para marcar la fila en pantalla). */
export function matchesChatName(name: string, handle: string, text: string): boolean {
  const raw = text.trim().toLowerCase();
  if (!raw) return false;
  const words = searchWords(raw);
  const n = name.toLowerCase();
  if ((words.length ? words : [raw]).every((w) => n.includes(w))) return true;
  const h = handle.toLowerCase();
  const digits = searchDigits(raw);
  return h.includes(raw) || (digits !== '' && h.includes(digits));
}

/** La fila coincide por nombre, teléfono o dirección (su clave de orden de búsqueda no empieza con '0'). */
export function isNameHit(sortKey: string | null | undefined): boolean {
  return Boolean(sortKey) && String(sortKey)[0] !== MESSAGE_ONLY_RANK;
}
