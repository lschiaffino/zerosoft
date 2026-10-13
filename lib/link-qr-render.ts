import QRCode from 'qrcode';

/**
 * Render del QR con marca (sin base de datos: lo usan el server y el editor
 * del navegador para la vista previa y el PNG).
 */

export const QR_DOTS = ['square', 'rounded', 'dots'] as const;
export type QrDots = (typeof QR_DOTS)[number];

export interface QrStyle {
  fg: string;
  bg: string;
  dots: QrDots;
  logo: string | null;
}

export const DEFAULT_QR_STYLE: QrStyle = { fg: '#000000', bg: '#ffffff', dots: 'square', logo: null };

/** Luminancia relativa (WCAG) de un color #rrggbb. */
export function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste suficiente para lectores: módulos más oscuros que el fondo y ratio >= 3. */
export function hasEnoughContrast(fg: string, bg: string): boolean {
  const a = luminance(fg);
  const b = luminance(bg);
  return a < b && (b + 0.05) / (a + 0.05) >= 3;
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const MARGIN = 2;

/** SVG del QR con estilo. Determinístico para el mismo texto y estilo. */
export function renderQrSvg(text: string, style: QrStyle): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: style.logo ? 'H' : 'M' });
  const n = qr.modules.size;
  const full = n + MARGIN * 2;
  const isFinder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  // Zona del logo: ~22% del lado, centrada, en módulos enteros.
  let logoBox: { start: number; size: number } | null = null;
  if (style.logo) {
    let size = Math.round(n * 0.22);
    if ((n - size) % 2 !== 0) size += 1;
    logoBox = { start: (n - size) / 2, size };
  }
  const underLogo = (r: number, c: number) =>
    !!logoBox &&
    r >= logoBox.start - 1 &&
    r < logoBox.start + logoBox.size + 1 &&
    c >= logoBox.start - 1 &&
    c < logoBox.start + logoBox.size + 1;

  const parts: string[] = [];
  let squares = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c) || isFinder(r, c) || underLogo(r, c)) continue;
      const x = c + MARGIN;
      const y = r + MARGIN;
      if (style.dots === 'dots') parts.push(`<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.42"/>`);
      else if (style.dots === 'rounded') parts.push(`<rect x="${x + 0.05}" y="${y + 0.05}" width="0.9" height="0.9" rx="0.3"/>`);
      else squares += `M${x} ${y}h1v1h-1z`;
    }
  }
  if (squares) parts.push(`<path d="${squares}"/>`);

  // Patrones de posición: siempre sólidos (lectura confiable), redondeados si el estilo lo es.
  const rx = style.dots === 'square' ? 0 : 1.6;
  const irx = style.dots === 'square' ? 0 : 0.8;
  for (const [r, c] of [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ]) {
    const x = c + MARGIN;
    const y = r + MARGIN;
    parts.push(
      `<path fill-rule="evenodd" d="${roundedRect(x, y, 7, 7, rx)}${roundedRect(x + 1, y + 1, 5, 5, Math.max(rx - 0.6, 0))}"/>`,
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="${irx}"/>`,
    );
  }

  let logo = '';
  if (logoBox && style.logo) {
    const p = logoBox.start + MARGIN;
    logo =
      `<rect x="${p - 0.5}" y="${p - 0.5}" width="${logoBox.size + 1}" height="${logoBox.size + 1}" rx="0.6" fill="${style.bg}"/>` +
      `<image href="${escapeAttr(style.logo)}" x="${p}" y="${p}" width="${logoBox.size}" height="${logoBox.size}" preserveAspectRatio="xMidYMid meet"/>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="${style.dots === 'square' ? 'crispEdges' : 'geometricPrecision'}">` +
    `<rect width="${full}" height="${full}" fill="${style.bg}"/>` +
    `<g fill="${style.fg}">${parts.join('')}</g>${logo}</svg>`
  );
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  if (r <= 0) return `M${x} ${y}h${w}v${h}h${-w}z`;
  return (
    `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}` +
    `h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`
  );
}
