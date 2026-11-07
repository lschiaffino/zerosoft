/** Marca que va en lugar de {date} al pedir el mensaje traducido. */
export const DATE_SLOT = '\u0001date\u0001';

/** Lo que va antes y después de la fecha en una frase traducida, en cualquier orden de palabras. */
export function splitAroundDate(text: string): [string, string] {
  const at = text.indexOf(DATE_SLOT);
  return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at + DATE_SLOT.length)];
}
