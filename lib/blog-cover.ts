/**
 * Portada de cada post: un tramo del plano de la red sobre la banda negra.
 * Determinística por slug (la usan BlogCover y /api/og/blog): una línea de la
 * suite con su color, trazada a 0° y 45° con puntas redondeadas, y dos o tres
 * estaciones. La mitad de las portadas suma una segunda línea que la cruza en
 * una combinación (dos anillos unidos por una barra), como en DESIGN.md.
 */
import { BRAND_INK, BRAND_WHITE, STATION_RING } from './brand';
import { PRODUCT_CONFIG, PRODUCT_KEYS } from './products';

function hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) + h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** Número en [0, 1) a partir de la semilla (determinístico). */
function rnd(seed: number, offset: number): number {
  const x = Math.sin(seed * 0.0001 + offset * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const escapeXml = (str: string) =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function station(x: number, y: number, r: number): string {
  const w = r * STATION_RING;
  return `<circle cx="${x}" cy="${y}" r="${r - w / 2}" fill="${BRAND_WHITE}" stroke="${BRAND_INK}" stroke-width="${w}"/>`;
}

export function generateBlogCoverSVG(slug: string, title: string, variant: 'card' | 'hero' = 'card'): string {
  const width = variant === 'hero' ? 1200 : 600;
  const height = variant === 'hero' ? 400 : 300;
  const seed = hash(slug);
  const unit = variant === 'hero' ? 2 : 1.25;
  const stroke = 16 * unit;
  const r = 18 * unit;

  const keys = PRODUCT_KEYS;
  const main = keys[seed % keys.length];
  const color = PRODUCT_CONFIG[main].color;

  // Recorrido: horizontal, un tramo a 45° y otra horizontal hasta salir del cuadro.
  const y0 = Math.round(height * (0.32 + rnd(seed, 1) * 0.36));
  const x1 = Math.round(width * (0.22 + rnd(seed, 2) * 0.2));
  const rise = Math.round(height * (0.18 + rnd(seed, 3) * 0.14)) * (y0 > height / 2 ? -1 : 1);
  const x2 = x1 + Math.abs(rise);
  const y1 = y0 + rise;
  const d = `M${-stroke} ${y0}H${x1}L${x2} ${y1}H${width + stroke}`;

  const stops = [
    { x: Math.round(x1 * 0.45), y: y0 },
    { x: Math.round(x2 + (width - x2) * 0.62), y: y1 },
  ];

  let cross = '';
  const crossing = rnd(seed, 4) > 0.5;
  if (crossing) {
    const other = keys[(seed + 1 + Math.floor(rnd(seed, 5) * (keys.length - 1))) % keys.length];
    const cx = Math.round(x2 + (width - x2) * 0.28);
    const gap = r * 1.6;
    cross =
      `<path d="M${cx} ${-stroke}V${height + stroke}" stroke="${PRODUCT_CONFIG[other].color}" stroke-width="${stroke}" stroke-linecap="round" fill="none"/>` +
      `<rect x="${cx - gap / 2}" y="${y1 - (r * STATION_RING) / 2}" width="${gap}" height="${r * STATION_RING}" fill="${BRAND_INK}"/>` +
      station(cx - gap / 2, y1, r) +
      station(cx + gap / 2, y1, r);
  } else {
    stops.push({ x: Math.round(x2 + (width - x2) * 0.24), y: y1 });
  }

  return (
    `<svg role="img" aria-label="${escapeXml(title)}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${width}" height="${height}" fill="${BRAND_INK}"/>` +
    `<path d="${d}" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
    cross +
    stops.map((s) => station(s.x, s.y, r)).join('') +
    `</svg>`
  );
}
