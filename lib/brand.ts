/**
 * La marca de zerosoft como datos: las once líneas (una por app), la estación
 * (el cero) y los SVG exportables. Sin React: lo usan los componentes de
 * components/brand, las imágenes OG, el ícono de la app y el script que arma
 * el kit (scripts/brand/build-kit.ts).
 *
 * Colores:
 * - `line`: el color de la línea, para trazos de 16 px, estaciones y rellenos.
 *   Es el mismo valor que PRODUCT_CONFIG[key].color y --c-<key>.
 * - `ink`: la misma tinta oscurecida en OKLCH hasta ≥ 4,75:1 sobre blanco.
 *   Es la única versión que se usa para texto.
 * - `on`: el texto que va encima de un relleno del color de la línea.
 */
import { PRODUCT_CONFIG, PRODUCT_KEYS, type ProductKey } from './products';
import { WORDMARK } from './brand-mark';

export { WORDMARK };

export const BRAND_INK = '#111111';
export const BRAND_WHITE = '#ffffff';

export interface BrandLine {
  key: ProductKey;
  name: string;
  line: string;
  lineOklch: string;
  ink: string;
  inkOklch: string;
  on: string;
}

/** Medidos con scripts de contraste WCAG 2.2 (ver DESIGN.md). */
const LINE_SPECS: Record<ProductKey, Omit<BrandLine, 'key' | 'name' | 'line'>> = {
  crm: { lineOklch: 'oklch(57.8% 0.247 287.9)', ink: '#7b4dff', inkOklch: 'oklch(57.8% 0.247 287.9)', on: '#ffffff' },
  chat: { lineOklch: 'oklch(62.2% 0.206 1.1)', ink: '#cf3172', inkOklch: 'oklch(57.6% 0.199 1.1)', on: '#111111' },
  agents: { lineOklch: 'oklch(65.4% 0.232 28.7)', ink: '#dd2720', inkOklch: 'oklch(57.9% 0.216 28.6)', on: '#111111' },
  flow: { lineOklch: 'oklch(58.8% 0.139 242.0)', ink: '#0078b7', inkOklch: 'oklch(54.9% 0.132 242.5)', on: '#111111' },
  robots: { lineOklch: 'oklch(55.1% 0.023 264.4)', ink: '#6b7280', inkOklch: 'oklch(55.1% 0.023 264.4)', on: '#ffffff' },
  track: { lineOklch: 'oklch(67.0% 0.193 41.4)', ink: '#c84800', inkOklch: 'oklch(57.1% 0.175 41.2)', on: '#111111' },
  link: { lineOklch: 'oklch(58.1% 0.229 263.9)', ink: '#2c66f8', inkOklch: 'oklch(56.5% 0.227 264.0)', on: '#ffffff' },
  docs: { lineOklch: 'oklch(62.3% 0.141 61.8)', ink: '#ab6000', inkOklch: 'oklch(56.3% 0.131 61.1)', on: '#111111' },
  notes: { lineOklch: 'oklch(79.3% 0.162 88.4)', ink: '#916c00', inkOklch: 'oklch(55.4% 0.113 84.8)', on: '#111111' },
  cal: { lineOklch: 'oklch(62.2% 0.133 162.3)', ink: '#008358', inkOklch: 'oklch(53.9% 0.119 161.6)', on: '#111111' },
  board: { lineOklch: 'oklch(70.3% 0.124 184.6)', ink: '#008176', inkOklch: 'oklch(54.2% 0.096 184.5)', on: '#111111' },
};

export const BRAND_LINES: BrandLine[] = PRODUCT_KEYS.map((key) => ({
  key,
  name: PRODUCT_CONFIG[key].name,
  line: PRODUCT_CONFIG[key].color,
  ...LINE_SPECS[key],
}));

export function brandLine(key: ProductKey): BrandLine {
  return BRAND_LINES.find((l) => l.key === key) as BrandLine;
}

/**
 * La estación: un círculo blanco con un anillo negro grueso. El anillo mide
 * 0,44 del radio exterior, igual que la "o" del wordmark.
 */
export const STATION_RING = 0.44;

/** Una estación como SVG (strings), centrada en cx,cy con radio exterior r. */
export function stationSvg(cx: number, cy: number, r: number, ring: string, fill: string): string {
  const w = r * STATION_RING;
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r - w / 2)}" fill="${fill}" stroke="${ring}" stroke-width="${n(w)}"/>`;
}

function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

export type MarkTone = 'ink' | 'white' | 'current';

/**
 * Colores del wordmark: tinta sobre fondos claros, blanco sobre fondos
 * oscuros. `current` hereda el color del texto y deja la estación hueca
 * (para el chrome, que cambia de color según el tema).
 */
export function markColors(tone: MarkTone): { fg: string; hole: string } {
  if (tone === 'current') return { fg: 'currentColor', hole: 'none' };
  return tone === 'ink' ? { fg: BRAND_INK, hole: BRAND_WHITE } : { fg: BRAND_WHITE, hole: BRAND_INK };
}

/** Las piezas del wordmark posicionadas (para componer SVGs a mano). */
export function wordmarkSvgGroup(x: number, y: number, height: number, tone: MarkTone): string {
  const s = height / WORDMARK.height;
  const { fg, hole } = markColors(tone);
  const st = WORDMARK.station;
  return (
    `<g transform="translate(${n(x)} ${n(y)}) scale(${s.toFixed(5)})">` +
    `<path d="${WORDMARK.letters}" fill="${fg}"/>` +
    stationSvg(st.cx, st.cy, st.r, fg, hole) +
    `</g>`
  );
}

/** Área de resguardo del logo: una estación (el diámetro de la "o") por lado. */
export const CLEAR_SPACE = WORDMARK.station.r * 2;

/** SVG del wordmark con su área de resguardo (archivo del kit). */
export function wordmarkSvg(tone: MarkTone, withBackground = false): string {
  const pad = CLEAR_SPACE;
  const w = WORDMARK.width + pad * 2;
  const h = WORDMARK.height + pad * 2;
  const bg = withBackground ? `<rect width="${n(w)}" height="${n(h)}" fill="${markColors(tone).hole}"/>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w)} ${n(h)}" width="${n(w * 2)}" height="${n(h * 2)}">` +
    `<title>zerosoft</title>${bg}` +
    wordmarkSvgGroup(pad, pad, WORDMARK.height, tone) +
    `</svg>`
  );
}

/** El símbolo: la estación sola, con medio radio de aire alrededor. */
export function symbolSvg(ring = BRAND_INK, fill = BRAND_WHITE, title = 'zerosoft'): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">` +
    `<title>${title}</title>` +
    stationSvg(64, 64, 48, ring, fill) +
    `</svg>`
  );
}

/** El ícono de la app: la estación blanca sobre la banda negra, esquinas rectas. */
export function appIconSvg(size = 32): string {
  const r = size * 0.34;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" fill="${BRAND_INK}"/>` +
    stationSvg(size / 2, size / 2, r, BRAND_WHITE, BRAND_INK) +
    `</svg>`
  );
}

/** Marca de producto: la estación con el anillo en el color de su línea. */
export function productSymbolSvg(key: ProductKey): string {
  const l = brandLine(key);
  return symbolSvg(l.line, BRAND_WHITE, `zerosoft ${l.name}`);
}
