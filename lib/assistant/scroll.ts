/**
 * Una sola barra de scroll en el asistente: la de la charla. Las listas y las
 * tablas largas de un mensaje no scrollean adentro; muestran los primeros
 * renglones y un botón que suma más en el lugar ("Mostrar las 27", "Mostrar
 * 100 más"). Y la charla sigue lo que llega solo si la persona ya estaba al
 * final; si subió a leer, se queda donde está y aparece "Ir al final".
 */

/** Renglones que se ven de entrada en una lista o tabla larga. */
export const INITIAL_ROWS = 8;
/** De a cuántos se suman con "Mostrar N más" cuando quedan muchos. */
export const STEP_ROWS = 100;
/** Si esconder dejaría solo esta cantidad o menos, se muestra todo (un botón para 2 renglones no ayuda). */
const SLACK_ROWS = 2;
/** Qué tan cerca del final cuenta como "estaba al final" (px). */
export const NEAR_BOTTOM_PX = 80;

/** Cuántos renglones se ven de entrada de una lista de `total`. */
export function initialRows(total: number): number {
  return total <= INITIAL_ROWS + SLACK_ROWS ? total : INITIAL_ROWS;
}

export type Reveal = { kind: 'all'; total: number; to: number } | { kind: 'more'; count: number; to: number };

/**
 * El próximo paso al tocar el botón, o null si ya se ve todo. Si lo que falta
 * entra en un paso, "Mostrar las N" (todas); si no, "Mostrar 100 más".
 */
export function nextReveal(total: number, shown: number): Reveal | null {
  if (shown >= total) return null;
  const rest = total - shown;
  if (rest <= STEP_ROWS + SLACK_ROWS) return { kind: 'all', total, to: total };
  return { kind: 'more', count: STEP_ROWS, to: shown + STEP_ROWS };
}

/** Si la charla está al final (o casi): lo nuevo se sigue solo. */
export function isNearBottom(m: { scrollHeight: number; scrollTop: number; clientHeight: number }, px = NEAR_BOTTOM_PX): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight < px;
}

/**
 * Qué hacer cuando cambia el contenido de la charla:
 * - 'follow': bajar al final (estaba al final, o recién se abrió la charla);
 * - 'stay': no mover nada (subió a leer, o acaba de abrir una lista: abrirla no salta);
 * - en 'stay', `jump` dice si mostrar "Ir al final" (hay contenido abajo que no ve).
 */
export function followDecision(s: { following: boolean; holding: boolean; nearBottom: boolean }): { action: 'follow' | 'stay'; jump: boolean } {
  if (s.holding) return { action: 'stay', jump: !s.nearBottom };
  if (s.following) return { action: 'follow', jump: false };
  return { action: 'stay', jump: !s.nearBottom };
}

/**
 * Después de un scroll: ¿se sigue lo nuevo? Subir, aunque sea un poco (trackpad, dedo), deja de
 * seguir en el momento: si no, mientras llega texto cada cuadro te devolvería al final. Se vuelve a
 * seguir al bajar hasta el final.
 */
export function followAfterScroll(s: { scrolledUp: boolean; nearBottom: boolean }): boolean {
  return !s.scrolledUp && s.nearBottom;
}
