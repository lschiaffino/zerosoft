/**
 * Anclar el scroll de una conversación a lo que se está leyendo. Cuando algo
 * cambia de alto arriba de la pantalla (una foto que termina de cargar, una
 * reacción o un "editado" que llega con la consulta periódica, mensajes
 * anteriores que se suman arriba), la lista no se mueve sola: se recuerda el
 * primer mensaje a la vista y a qué distancia del borde estaba, y después de
 * cada cambio se corrige el scroll para dejarlo ahí. Abajo de todo es otra
 * cosa: la conversación sigue al último mensaje.
 *
 * Puro (sin DOM): lo usa components/ui/useScrollAnchor.ts. Safari y la app de
 * escritorio en Mac (WKWebView) no tienen `overflow-anchor`, así que no
 * alcanza con el del navegador.
 */

/** A menos de esto (px) del final cuenta como "abajo de todo". */
export const BOTTOM_SLACK = 80;

export interface ItemBox {
  id: string;
  top: number;
  bottom: number;
}

export interface Anchor {
  id: string;
  /** Distancia del borde de arriba del mensaje al borde de arriba de la lista (negativa si está cortado). */
  offset: number;
}

export function atBottom(o: { scrollTop: number; scrollHeight: number; clientHeight: number }, slack = BOTTOM_SLACK): boolean {
  return o.scrollHeight - o.scrollTop - o.clientHeight < slack;
}

/** El primer mensaje que se ve (aunque sea cortado) y dónde está. `viewTop` es el borde de arriba de la lista. */
export function pickAnchor(items: readonly ItemBox[], viewTop: number): Anchor | null {
  for (const it of items) {
    if (it.bottom > viewTop + 0.5) return { id: it.id, offset: it.top - viewTop };
  }
  return null;
}

/**
 * Cuánto hay que correr el scroll para que el ancla vuelva a donde estaba.
 * `now` es dónde está ahora el borde de arriba del mensaje respecto de la
 * lista. Diferencias de menos de un px no se tocan (redondeos).
 */
export function anchorShift(anchor: Anchor, now: number): number {
  const d = now - anchor.offset;
  return Math.abs(d) < 1 ? 0 : d;
}
