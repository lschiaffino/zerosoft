'use client';

import { Bebas_Neue, Caveat, DM_Serif_Display, Inter, Lora, Montserrat, Oswald, Playfair_Display } from 'next/font/google';
import { DESIGN_FONTS } from '@/lib/design-fonts';
import type { DesignDoc, FontKey, TextEl } from '@/lib/design-model';

/**
 * Fuentes del editor de Design. next/font las sirve desde nuestro dominio
 * (sin pedir nada a Google desde el navegador) y solo se cargan en las
 * páginas de Design. Canvas (exportar) necesita el nombre real de la familia,
 * no una variable CSS: por eso se usa `style.fontFamily`.
 */
const inter = Inter({ subsets: ['latin'], display: 'swap', preload: false });
const montserrat = Montserrat({ subsets: ['latin'], display: 'swap', preload: false });
const playfair = Playfair_Display({ subsets: ['latin'], display: 'swap', preload: false, style: ['normal', 'italic'] });
const lora = Lora({ subsets: ['latin'], display: 'swap', preload: false, style: ['normal', 'italic'] });
const oswald = Oswald({ subsets: ['latin'], display: 'swap', preload: false });
const caveat = Caveat({ subsets: ['latin'], display: 'swap', preload: false });
const bebas = Bebas_Neue({ subsets: ['latin'], weight: '400', display: 'swap', preload: false });
const dmserif = DM_Serif_Display({ subsets: ['latin'], weight: '400', display: 'swap', preload: false, style: ['normal', 'italic'] });

const LOADED: Partial<Record<FontKey, string>> = {
  inter: inter.style.fontFamily,
  montserrat: montserrat.style.fontFamily,
  playfair: playfair.style.fontFamily,
  lora: lora.style.fontFamily,
  oswald: oswald.style.fontFamily,
  caveat: caveat.style.fontFamily,
  bebas: bebas.style.fontFamily,
  dmserif: dmserif.style.fontFamily,
};

/** Space Grotesk e IBM Plex Mono ya los carga el sitio: se leen de sus variables CSS. */
function cssVarFamily(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || null;
}

export function fontFamily(key: FontKey): string {
  const fb = DESIGN_FONTS[key]?.fallback ?? 'sans-serif';
  if (key === 'grotesk') return `${cssVarFamily('--font-space-grotesk') ?? '"Space Grotesk"'}, ${fb}`;
  if (key === 'plexmono') return `${cssVarFamily('--font-plex-mono') ?? '"IBM Plex Mono"'}, ${fb}`;
  const loaded = LOADED[key];
  return loaded ? `${loaded}, ${fb}` : fb;
}

export function fontCss(el: Pick<TextEl, 'font' | 'size' | 'weight' | 'italic'>, scale = 1): string {
  return `${el.italic ? 'italic ' : ''}${Math.round(el.weight)} ${Math.max(1, el.size * scale)}px ${fontFamily(el.font)}`;
}

/** Espera a que estén las fuentes que usa el diseño (antes de medir o exportar). */
export async function loadDocFonts(doc: DesignDoc): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const wanted = new Set<string>();
  for (const p of doc.pages) for (const el of p.elements) if (el.type === 'text') wanted.add(fontCss({ ...el, size: 32 }));
  await Promise.all([...wanted].map((f) => document.fonts.load(f).catch(() => [])));
}
