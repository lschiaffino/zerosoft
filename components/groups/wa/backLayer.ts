'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * "Atrás" del teléfono, como WhatsApp: el botón o el gesto de volver cierra primero lo último que se abrió
 * (el menú del mensaje, la selección, el panel del contacto, el chat abierto) y recién después sale de la
 * pantalla. Cada capa abierta tiene una entrada en el historial (`history.state.zsLayer` = cuántas capas hay
 * hasta ella); volver a una entrada más baja cierra las capas que quedaron arriba, la de más arriba primero.
 * Cerrar una capa con la interfaz (la X, Esc, elegir una opción) saca su entrada, así "atrás" no queda gastado.
 *
 * El historial se pone al día en un solo paso por tanda (un microtask): cerrar el menú y abrir la selección con
 * el mismo toque reusa la entrada en lugar de volver y avanzar. Next (app router) escucha el mismo popstate: las
 * entradas de acá copian su estado (`__NA` y el árbol) y no cambian la URL, así que para Next es la misma página.
 */

interface Layer {
  close: () => void;
}

const stack: Layer[] = [];
let listening = false;
let scheduled = false;
/** Hay un history.go() nuestro en camino: su popstate no cierra nada. */
let travelling = false;

function depthNow(): number {
  const s = window.history.state as { zsLayer?: unknown } | null;
  return typeof s?.zsLayer === 'number' ? s.zsLayer : 0;
}

/** Deja el historial con una entrada por capa abierta. */
function reconcile() {
  scheduled = false;
  if (travelling) return; // Al llegar el popstate se vuelve a mirar.
  const want = stack.length;
  const have = depthNow();
  if (have > want) {
    travelling = true;
    window.history.go(want - have);
    return;
  }
  for (let d = have + 1; d <= want; d++) window.history.pushState({ ...(window.history.state ?? {}), zsLayer: d }, '');
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(reconcile);
}

function onPop() {
  if (travelling) {
    travelling = false;
    reconcile();
    return;
  }
  // "Atrás" (o "adelante") del navegador: se cierran las capas que quedaron arriba de esta entrada.
  const depth = depthNow();
  while (stack.length > depth) stack.pop()!.close();
  if (depth > stack.length) schedule();
}

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('popstate', onPop);
}

/** Solo para los tests: el módulo escucha el popstate de esta ventana (otra, en cada test). */
export function resetBackLayers() {
  if (listening) window.removeEventListener('popstate', onPop);
  listening = false;
  stack.length = 0;
  scheduled = false;
  travelling = false;
}

/** Cuántas capas hay abiertas ahora. */
export function openLayers(): number {
  return stack.length;
}

/**
 * Mientras `open` (y `enabled`), la capa ocupa una entrada del historial y "atrás" llama a `close`, que debe poder
 * llamarse aunque ya esté cerrada.
 */
export function useBackLayer(open: boolean, close: () => void, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open || !enabled) return;
    return openLayer(() => closeRef.current());
  }, [open, enabled]);
}

/** Abre una capa (sin React): devuelve cómo sacarla al cerrarse con la interfaz. */
export function openLayer(close: () => void): () => void {
  listen();
  const layer: Layer = { close };
  stack.push(layer);
  schedule();
  return () => {
    const i = stack.indexOf(layer);
    if (i < 0) return; // Ya la cerró "atrás".
    stack.splice(i, 1);
    schedule();
  };
}

/** Si la consulta de medios vale ahora (false en el servidor y hasta montar). */
export function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return on;
}

/** Pantalla táctil (teléfono, tablet): ahí "atrás" cierra menús y hojas. */
export const TOUCH_QUERY = '(hover: none), (pointer: coarse)';

