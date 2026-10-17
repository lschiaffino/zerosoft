/**
 * Color del workspace en el centro de ayuda público (/h/<handle>).
 *
 * El acento viene del widget de Chat (cualquier HEX que eligió el cliente),
 * así que no se puede asumir contraste. Se separa en tres usos, como las
 * líneas de la marca: el trazo/relleno tal cual, una versión para texto que
 * pase AA sobre blanco y el texto que va encima del relleno.
 */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const INK = '#111111';
const WHITE = '#ffffff';
/** Línea de Docs: el acento cuando el workspace no eligió color. */
export const DEFAULT_HELP_ACCENT = '#c2700a';

function toRgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos HEX (1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Oscurece hacia la tinta hasta llegar a 4,5:1 sobre blanco (texto AA). */
function inkFor(accent: string): string {
  if (contrastRatio(accent, WHITE) >= 4.5) return accent;
  const from = toRgb(accent);
  const to = toRgb(INK);
  for (let step = 1; step <= 20; step++) {
    const t = step / 20;
    const mixed = toHex(from.map((v, i) => v + (to[i] - v) * t) as [number, number, number]);
    if (contrastRatio(mixed, WHITE) >= 4.5) return mixed;
  }
  return INK;
}

export interface HelpAccent {
  /** Trazo y relleno (la línea del workspace). */
  line: string;
  /** Texto en el color del workspace, ≥ 4,5:1 sobre blanco. */
  ink: string;
  /** Texto encima de un relleno del color. */
  on: string;
}

export function helpAccent(accent: string | null | undefined): HelpAccent {
  const line = accent && HEX.test(accent) ? accent.toLowerCase() : DEFAULT_HELP_ACCENT;
  return {
    line,
    ink: inkFor(line),
    on: contrastRatio(line, WHITE) >= contrastRatio(line, INK) ? WHITE : INK,
  };
}

/** Variables CSS para el `style` del <main class="help">. */
export function helpAccentStyle(accent: string | null | undefined): Record<string, string> {
  const a = helpAccent(accent);
  return { '--help-accent': a.line, '--help-accent-ink': a.ink, '--help-accent-on': a.on, '--accent': a.line };
}
