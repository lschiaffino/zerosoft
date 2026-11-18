/**
 * Nota mejorada que llega del servidor (un refresco de la reunión, cada 2 o 15 s) contra lo que hay en el
 * editor. Solo reemplaza el documento cuando es otra nota de verdad (regenerada, o editada en otro lado) y acá
 * no hay nada pendiente de guardar.
 *
 * - `incoming`: firma de la nota que llegó.
 * - `local`: firma de lo que se ve en el editor.
 * - `mine`: firmas que este editor mandó a guardar. Un refresco puede traer una de ellas mientras ya se siguió
 *   escribiendo: es un eco de lo propio, más viejo que lo que hay en pantalla.
 * - `pending`: hay cambios escritos que todavía no se mandaron.
 */
export function incomingReplacesNote(incoming: string, local: string, mine: ReadonlySet<string>, pending: boolean): boolean {
  if (incoming === local) return false;
  if (pending) return false;
  return !mine.has(incoming);
}

/** Recuerda una firma mandada a guardar (con tope: solo importan las últimas). */
export function rememberSent(mine: Set<string>, sig: string, max = 20): void {
  mine.delete(sig);
  mine.add(sig);
  while (mine.size > max) mine.delete(mine.values().next().value as string);
}
