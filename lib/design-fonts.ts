import type { FontKey } from './design-model';

/**
 * Fuentes de Design: nombre visible y familia de respaldo. Las web fonts se
 * cargan del lado del cliente con next/font (components/design/fonts.ts),
 * servidas por nuestro dominio; Georgia y Arial son del sistema.
 */
export const DESIGN_FONTS: Record<FontKey, { label: string; fallback: string }> = {
  inter: { label: 'Inter', fallback: 'Arial, Helvetica, sans-serif' },
  montserrat: { label: 'Montserrat', fallback: 'Arial, Helvetica, sans-serif' },
  playfair: { label: 'Playfair Display', fallback: 'Georgia, serif' },
  lora: { label: 'Lora', fallback: 'Georgia, serif' },
  oswald: { label: 'Oswald', fallback: '"Arial Narrow", Arial, sans-serif' },
  caveat: { label: 'Caveat', fallback: '"Comic Sans MS", cursive' },
  bebas: { label: 'Bebas Neue', fallback: 'Impact, "Arial Narrow", sans-serif' },
  dmserif: { label: 'DM Serif Display', fallback: 'Georgia, serif' },
  grotesk: { label: 'Space Grotesk', fallback: 'Arial, Helvetica, sans-serif' },
  plexmono: { label: 'IBM Plex Mono', fallback: 'Menlo, Consolas, monospace' },
  georgia: { label: 'Georgia', fallback: 'Georgia, "Times New Roman", serif' },
  arial: { label: 'Arial', fallback: 'Arial, Helvetica, sans-serif' },
};

export const FONT_WEIGHTS = [300, 400, 500, 600, 700, 800, 900] as const;
