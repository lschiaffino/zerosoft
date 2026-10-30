'use client';

import { displayText, textHeight, wrapText, type DesignPage, type TextEl } from '@/lib/design-model';
import { fontCss } from './fonts';

/**
 * Medición de texto con canvas (la misma que usa el export): el SVG del
 * editor y el PNG cortan las líneas igual.
 */
let ctx: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  return ctx;
}

export interface TextLayout {
  lines: Array<{ text: string; width: number }>;
  height: number;
}

const cache = new Map<string, TextLayout>();

export function layoutText(el: TextEl): TextLayout {
  const key = [el.text, el.font, el.size, el.weight, el.italic ? 1 : 0, el.uppercase ? 1 : 0, el.w, el.lineHeight, el.letterSpacing].join('|');
  const hit = cache.get(key);
  if (hit) return hit;
  const c = measureCtx();
  const text = displayText(el);
  let out: TextLayout;
  if (!c) {
    // Sin DOM (no debería pasar en el editor): una línea por párrafo, ancho estimado.
    const lines = text.split('\n').map((t) => ({ text: t, width: t.length * el.size * 0.55 }));
    out = { lines, height: textHeight(el, lines.length) };
  } else {
    c.font = fontCss(el);
    const measure = (s: string) => c.measureText(s).width;
    const ls = el.letterSpacing;
    const lines = wrapText(text, Math.max(1, el.w), measure, ls).map((t) => ({ text: t, width: measure(t) + Math.max(0, t.length - 1) * ls }));
    out = { lines, height: textHeight(el, lines.length) };
  }
  if (cache.size > 2000) cache.clear();
  cache.set(key, out);
  return out;
}

/** Limpia la caché (al terminar de cargar las fuentes cambian las medidas). */
export function resetTextLayout(): void {
  cache.clear();
}

/** Ajusta el alto de los textos a su contenido. Devuelve la misma página si no cambió nada. */
export function fitTextHeights(page: DesignPage): DesignPage {
  let changed = false;
  const elements = page.elements.map((el) => {
    if (el.type !== 'text') return el;
    const h = Math.max(1, Math.round(layoutText(el).height * 100) / 100);
    if (Math.abs(h - el.h) < 0.5) return el;
    changed = true;
    return { ...el, h };
  });
  return changed ? { ...page, elements } : page;
}
