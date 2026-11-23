/**
 * "@all" en grupos de WhatsApp (Lines e Inbox): menciona a todo el grupo, como
 * el "@all" de WhatsApp. En el texto queda "@all" (o la palabra del idioma,
 * "@todos" en español y portugués) y al servidor de WhatsApp va una marca
 * aparte: Evolution la manda como mención de cada participante
 * (mentionsEveryOne) y WAHA con mentions: ['all']. La Cloud API de Meta no
 * tiene grupos, así que ahí no se ofrece (ProviderCaps.mentionAll).
 *
 * En la lista de menciones de un mensaje va como el id "all", primero.
 * Puro (lo usan el servidor, las pantallas y los tests).
 */

/** El id de "todos" en la lista de menciones de un mensaje. */
export const MENTION_ALL = 'all';

/** Las palabras que mencionan a todos: "all" en cualquier idioma y la del idioma. */
export const MENTION_ALL_WORDS = ['all', 'todos'] as const;

/** La palabra que escribe el campo al elegir "todos" en la lista. */
export function mentionAllWord(locale: string | null | undefined): string {
  const l = String(locale ?? '').slice(0, 2).toLowerCase();
  return l === 'es' || l === 'pt' ? 'todos' : 'all';
}

const TOKEN = /(^|[^\p{L}\p{N}_.@])@(all|todos)(?![\p{L}\p{N}_@])/iu;

/** El texto tiene "@all" o "@todos" como palabra (no dentro de un email ni de otra palabra). */
export function hasMentionAllToken(text: string): boolean {
  return !!text && text.includes('@') && TOKEN.test(text);
}

/** La lista de menciones partida: si menciona a todos y los teléfonos (o lids) sueltos. */
export function splitMentionAll(mentions: ReadonlyArray<string> | null | undefined): { all: boolean; ids: string[] } {
  const list = mentions ?? [];
  return { all: list.includes(MENTION_ALL), ids: list.filter((m) => m !== MENTION_ALL) };
}

/**
 * Las menciones como las pide el proveedor: los teléfonos sueltos y, con "@all", la marca de todos (solo si el
 * proveedor la manda; si no, el texto sale igual y avisa solo a los mencionados uno por uno).
 */
export function mentionSendOpts(mentions: ReadonlyArray<string> | null | undefined, caps: { mentionAll: boolean }): { mentions?: string[]; mentionAll?: true } {
  const { all, ids } = splitMentionAll(mentions);
  return { ...(ids.length ? { mentions: ids } : {}), ...(all && caps.mentionAll ? { mentionAll: true as const } : {}) };
}

/** "all" se queda en la lista de menciones a mandar solo si el texto dice "@all" o "@todos" (y es un grupo). */
export function keepMentionAll(raw: unknown, text: string, group: boolean): boolean {
  return group && Array.isArray(raw) && raw.includes(MENTION_ALL) && hasMentionAllToken(text);
}
