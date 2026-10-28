import QRCode from 'qrcode';

/**
 * Render del QR con marca (sin base de datos: lo usan el server y el editor
 * del navegador para la vista previa y el PNG).
 */

export const QR_DOTS = ['square', 'rounded', 'dots'] as const;
export type QrDots = (typeof QR_DOTS)[number];

/** Marco alrededor del QR: ninguno, un borde, o borde con un texto abajo ("Escaneame"). */
export const QR_FRAMES = ['none', 'border', 'label'] as const;
export type QrFrame = (typeof QR_FRAMES)[number];

export const QR_LABEL_MAX = 24;

export interface QrStyle {
  fg: string;
  bg: string;
  dots: QrDots;
  logo: string | null;
  frame?: QrFrame;
  /** Texto del marco 'label' (máx. 24 caracteres). */
  label?: string | null;
}

export const DEFAULT_QR_STYLE: QrStyle = { fg: '#000000', bg: '#ffffff', dots: 'square', logo: null, frame: 'none', label: null };

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

function escapeText(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Ancho y alto del viewBox (en módulos) de un SVG de renderQrSvg: para rasterizar sin deformar. */
export function qrSvgSize(svg: string): { width: number; height: number } {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1, height: 1 };
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

  const code = `<g fill="${style.fg}">${parts.join('')}</g>${logo}`;
  const frame = style.frame ?? 'none';
  const rendering = style.dots === 'square' ? 'crispEdges' : 'geometricPrecision';
  if (frame === 'none') {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="${rendering}">` +
      `<rect width="${full}" height="${full}" fill="${style.bg}"/>${code}</svg>`
    );
  }
  // Marco: borde de 1 módulo a 1 módulo del código; con texto, una banda abajo en el color de los módulos.
  const pad = 2;
  const band = frame === 'label' ? 6 : 0;
  const w = full + pad * 2;
  const h = full + pad * 2 + band;
  const label = escapeText((style.label?.trim() || 'Scan me').slice(0, QR_LABEL_MAX));
  const fontSize = Math.min(3.2, (full * 1.6) / Math.max(label.length, 6));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="${rendering}">` +
    `<rect width="${w}" height="${h}" rx="2" fill="${style.bg}"/>` +
    `<rect x="0.6" y="0.6" width="${w - 1.2}" height="${h - 1.2}" rx="1.6" fill="none" stroke="${style.fg}" stroke-width="1.2"/>` +
    (band
      ? `<path d="M0.6 ${full + pad * 2}H${w - 0.6}V${h - 2.2}a1.6 1.6 0 0 1 -1.6 1.6H2.2a1.6 1.6 0 0 1 -1.6 -1.6Z" fill="${style.fg}"/>` +
        `<text x="${w / 2}" y="${full + pad * 2 + band / 2}" fill="${style.bg}" font-family="system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-weight="700" font-size="${fontSize.toFixed(2)}" text-anchor="middle" dominant-baseline="central">${label}</text>`
      : '') +
    `<g transform="translate(${pad} ${pad})">${code}</g></svg>`
  );
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  if (r <= 0) return `M${x} ${y}h${w}v${h}h${-w}z`;
  return (
    `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}` +
    `h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`
  );
}
