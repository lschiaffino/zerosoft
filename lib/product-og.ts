/**
 * Generador puro y determinístico de las imágenes OG (1200×630) de producto,
 * changelog y herramientas. Mismo lenguaje que el hero del sitio: un cero
 * grande hecho de ceros chicos, teñido con el color del producto, sobre tinta.
 * Los ceros son trazados (lib/zero-mark.ts), no texto: no dependen de fuentes.
 */

import { PRODUCT_KEYS } from './products';
import { ZERO_H, ZERO_W, zeroPathAt } from './zero-mark';

function hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) + h + str.charCodeAt(i);
  }
  return Math.abs(h);
}

function fract(n: number): number {
  return n - Math.floor(n);
}

function rnd(seed: number, offset = 0): number {
  return fract(Math.sin(seed + offset * 12.9898) * 43758.5453);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Los ceros chicos que dibujan un cero grande: una grilla recortada por un
 * anillo ovalado (las mismas proporciones que el glifo de la marca).
 */
function zeroOfZeros(seed: number, cx: number, cy: number, height: number, color: string): string {
  const ry = height / 2;
  const rx = ry * (ZERO_W / ZERO_H) * 0.94;
  const thickness = 0.3;
  const gap = 17;
  const glyph = 11;
  const out: string[] = [];
  let i = 0;
  for (let y = cy - ry; y <= cy + ry; y += gap) {
    for (let x = cx - rx; x <= cx + rx; x += gap) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      const inner = (1 - thickness) ** 2;
      if (d <= 1 && d >= inner) {
        const opacity = lerp(0.45, 1, rnd(seed, i));
        out.push(zeroPathAt(x - (glyph * ZERO_W) / ZERO_H / 2, y - glyph / 2, glyph, color, opacity));
      } else if (d < inner && rnd(seed, i + 500) < 0.05) {
        // Algunos ceros sueltos adentro: el campo "respira", como en el hero.
        out.push(zeroPathAt(x - (glyph * ZERO_W) / ZERO_H / 2, y - glyph / 2, glyph, color, 0.18));
      }
      i++;
    }
  }
  return `<g>${out.join('')}</g>`;
}

/**
 * `label` reemplaza la línea "NN / total" (p. ej. el changelog, que no es un producto).
 * `color` tiñe los ceros (por defecto, blanco).
 */
export function generateProductOGSVG(
  product: string,
  name: string,
  num: string,
  label?: string,
  color = '#f4f4f4',
): string {
  const seed = hash(`product:${product}`);
  const width = 1200;
  const height = 630;
  const fontFamily = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";
  const monoFamily = "'IBM Plex Mono', ui-monospace, monospace";

  const field = zeroOfZeros(seed, width * 0.74, height / 2, height * 0.84, color);

  const mark = zeroPathAt(64, 60, 40, '#ffffff');
  const total = String(PRODUCT_KEYS.length).padStart(2, '0');
  const line = label ?? (num ? `${num} / ${total}` : '');
  const productNum = line
    ? `<text x="64" y="${height - 196}" fill="#ffffff" opacity="0.55" font-family="${monoFamily}" font-size="24" font-weight="500">${escapeXml(line)}</text>`
    : '';
  const productName = `<text x="64" y="${height - 104}" fill="#ffffff" font-family="${fontFamily}" font-size="104" font-weight="500" letter-spacing="-3">${escapeXml(name)}</text>`;
  const domain = `<text x="${width - 64}" y="${height - 60}" text-anchor="end" fill="#ffffff" opacity="0.55" font-family="${monoFamily}" font-size="24" font-weight="500">zerosoft.ai</text>`;

  return (
    `<svg role="img" aria-label="${escapeXml(`zerosoft.ai ${name}`)}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${width}" height="${height}" fill="#0a0a0a"/>` +
    field +
    mark +
    productNum +
    productName +
    domain +
    `</svg>`
  );
}
