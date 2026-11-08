'use client';

/**
 * Lienzo oscuro con stickies claros. Excalidraw oscurece el lienzo con un
 * filtro CSS sobre todo el canvas (y los stickies quedan marrones). Acá ese
 * filtro se saca del canvas de la escena (styles/board.css) y los colores se
 * transforman al dibujar (lib/board-dark.ts): mismo resultado para todo lo
 * demás, y los stickies conservan su color y su letra oscura.
 *
 * Se engancha a los setters de color del contexto 2D mientras haya un lienzo
 * de Board en oscuro. Lo que tiene que salir con sus colores reales (exportar
 * imagen o PDF, el minimapa) corre con el parche en pausa.
 */
import { darkColor } from '@/lib/board-dark';

/** Filtro que Excalidraw les pone a las imágenes en oscuro para compensar el del CSS. */
const IMAGE_INVERT_FILTER = 'invert(100%) hue-rotate(180deg) saturate(1.25)';

let installed = false;
let active = false;
let paused = 0;
/** El diálogo de exportar imagen de Excalidraw está abierto (dibuja con colores reales). */
let exporting = false;

const on = () => active && !exporting && paused === 0;

/** Pausa mientras está abierto el diálogo de exportar imagen de Excalidraw. */
export function setExportingImage(next: boolean) {
  exporting = next;
}

/** Prende o apaga el modo (lo llama el lienzo según su tema, antes de dibujar). */
export function setDarkCanvas(next: boolean) {
  if (next) install();
  active = next;
}

/** Corre `fn` con los colores reales (export de imagen o PDF, minimapa). */
export function withRealColors<T>(fn: () => T): T {
  paused += 1;
  try {
    return fn();
  } finally {
    paused -= 1;
  }
}

/** Igual que withRealColors, para algo asíncrono (el export espera letras e imágenes). */
export async function withRealColorsAsync<T>(fn: () => Promise<T>): Promise<T> {
  paused += 1;
  try {
    return await fn();
  } finally {
    paused -= 1;
  }
}

function install() {
  if (installed || typeof window === 'undefined' || typeof CanvasRenderingContext2D === 'undefined') return;
  installed = true;
  const proto = CanvasRenderingContext2D.prototype;
  for (const prop of ['fillStyle', 'strokeStyle'] as const) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc?.set || !desc.get) continue;
    const { get, set } = desc;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        return get.call(this);
      },
      set(v: unknown) {
        set.call(this, on() && typeof v === 'string' ? darkColor(v) : v);
      },
    });
  }
  const filter = Object.getOwnPropertyDescriptor(proto, 'filter');
  if (filter?.set && filter.get) {
    const { get, set } = filter;
    Object.defineProperty(proto, 'filter', {
      configurable: true,
      enumerable: filter.enumerable,
      get() {
        return get.call(this);
      },
      // Sin el filtro CSS del canvas, las imágenes ya no necesitan la compensación.
      set(v: unknown) {
        set.call(this, on() && v === IMAGE_INVERT_FILTER ? 'none' : v);
      },
    });
  }
}
