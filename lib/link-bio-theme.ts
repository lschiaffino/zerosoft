/** Temas de la página link-in-bio (puro: lo usan el servidor, el editor y la página pública). */

export const BIO_THEMES = ['auto', 'light', 'dark'] as const;
export type BioTheme = (typeof BIO_THEMES)[number];

export const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;

export function parseBioTheme(v: string | null | undefined): BioTheme {
  return (BIO_THEMES as readonly string[]).includes(v ?? '') ? (v as BioTheme) : 'auto';
}

export function parseAccent(v: string | null | undefined): string | null {
  return v && ACCENT_RE.test(v) ? v.toLowerCase() : null;
}

/** Texto legible sobre el color de acento (negro o blanco, por luminancia WCAG). */
export function accentInk(hex: string): string {
  if (!ACCENT_RE.test(hex)) return '#ffffff';
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contraste contra blanco (1.05/(L+0.05)) vs contra negro ((L+0.05)/0.05).
  return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.05 ? '#ffffff' : '#111111';
}
