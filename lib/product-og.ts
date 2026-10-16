/**
 * Generador puro y determinístico de las imágenes OG (1200×630) de producto,
 * changelog y herramientas, en el lenguaje de la marca: la banda negra de
 * señalética con el wordmark, el nombre en Archivo angosta y la línea del
 * producto (16 px a escala) con sus estaciones.
 * El wordmark y las estaciones son trazados (lib/brand.ts), no texto.
 */

import { PRODUCT_KEYS } from './products';
import { BRAND_INK, BRAND_WHITE, stationSvg, wordmarkSvgGroup } from './brand';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * `label` reemplaza la línea "NN / total" (p. ej. el changelog, que no es un producto).
 * `color` es el color de la línea (por defecto, tinta).
 */
export function generateProductOGSVG(
  _product: string,
  name: string,
  num: string,
  label?: string,
  color = BRAND_INK,
): string {
  const width = 1200;
  const height = 630;
  const band = 120;
  const fontFamily = "Archivo, 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";
  const monoFamily = "'JetBrains Mono', ui-monospace, monospace";

  const total = String(PRODUCT_KEYS.length).padStart(2, '0');
  const line = label ?? (num ? `${num} / ${total}` : '');
  const tag = line
    ? `<text x="${width - 64}" y="${band / 2 + 8}" text-anchor="end" fill="#b8b8b8" font-family="${monoFamily}" font-size="24" font-weight="500">${escapeXml(line)}</text>`
    : '';
  const productName = `<text x="60" y="372" fill="${BRAND_INK}" font-family="${fontFamily}" font-size="168" font-weight="800" style="font-stretch:75%" letter-spacing="-2">${escapeXml(name)}</text>`;
  const track = `<line x1="80" y1="500" x2="${width - 80}" y2="500" stroke="${color}" stroke-width="40" stroke-linecap="round"/>`;
  const stations = [140, 440, 740, 1060].map((x) => stationSvg(x, 500, 34, BRAND_INK, BRAND_WHITE)).join('');
  const domain = `<text x="${width - 64}" y="${height - 28}" text-anchor="end" fill="#5c5c5c" font-family="${monoFamily}" font-size="20" font-weight="500">zerosoft.ai</text>`;

  return (
    `<svg role="img" aria-label="${escapeXml(`zerosoft ${name}`)}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${width}" height="${height}" fill="${BRAND_WHITE}"/>` +
    `<rect width="${width}" height="${band}" fill="${BRAND_INK}"/>` +
    wordmarkSvgGroup(64, 38, 44, 'white') +
    tag +
    productName +
    track +
    stations +
    domain +
    `</svg>`
  );
}
