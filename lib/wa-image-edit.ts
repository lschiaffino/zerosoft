/**
 * Editar una foto antes de mandarla, como en WhatsApp (components/groups/wa/ImageEditor.tsx):
 * recortar y rotar, dibujar, texto y emojis o stickers encima. Todo se guarda en coordenadas de la
 * foto original (sin recortar ni rotar), así recortar o rotar después no mueve lo dibujado. Al mandar
 * se dibuja todo en un canvas (renderEdits) y sale como una foto nueva. Sin DOM: se prueba con un
 * contexto falso.
 */

export type Rotation = 0 | 90 | 180 | 270;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Un trazo del lápiz: puntos x,y seguidos (px de la original) y el ancho en px de la original. */
export interface Stroke {
  color: string;
  width: number;
  points: number[];
}

/** Texto, emoji o sticker encima de la foto: centro y tamaño en px de la original. */
export interface Overlay {
  id: string;
  kind: 'text' | 'emoji' | 'image';
  x: number;
  y: number;
  /** Texto y emoji: alto de la letra. Imagen: ancho. */
  size: number;
  text?: string;
  color?: string;
  /** Imagen (sticker): su URL y su proporción alto/ancho. */
  src?: string;
  ratio?: number;
}

export interface Edits {
  rotate: Rotation;
  /** Recorte en coordenadas de la original; null = la foto entera. */
  crop: Rect | null;
  strokes: Stroke[];
  overlays: Overlay[];
}

export const NO_EDITS: Edits = { rotate: 0, crop: null, strokes: [], overlays: [] };

export function hasEdits(e: Edits | null | undefined): boolean {
  return !!e && (e.rotate !== 0 || !!e.crop || e.strokes.length > 0 || e.overlays.some((o) => o.kind !== 'text' || !!o.text?.trim()));
}

/** El recorte efectivo (la foto entera si no hay), dentro de la foto. */
export function cropOf(e: Edits, natural: { w: number; h: number }): Rect {
  const c = e.crop;
  if (!c) return { x: 0, y: 0, w: natural.w, h: natural.h };
  const x = clamp(c.x, 0, natural.w - 1);
  const y = clamp(c.y, 0, natural.h - 1);
  return { x, y, w: clamp(c.w, 1, natural.w - x), h: clamp(c.h, 1, natural.h - y) };
}

/** Tamaño de lo que sale (el recorte, de costado si se rotó 90 o 270). */
export function viewSize(e: Edits, natural: { w: number; h: number }): { w: number; h: number } {
  const c = cropOf(e, natural);
  return e.rotate % 180 === 0 ? { w: c.w, h: c.h } : { w: c.h, h: c.w };
}

/** Punto de la original → punto de lo que se ve (recortado y rotado, en px de la original). */
export function toView(p: { x: number; y: number }, e: Edits, natural: { w: number; h: number }): { x: number; y: number } {
  const c = cropOf(e, natural);
  const px = p.x - c.x;
  const py = p.y - c.y;
  switch (e.rotate) {
    case 90:
      return { x: c.h - py, y: px };
    case 180:
      return { x: c.w - px, y: c.h - py };
    case 270:
      return { x: py, y: c.w - px };
    default:
      return { x: px, y: py };
  }
}

/** Punto de lo que se ve → punto de la original (lo inverso de toView). */
export function fromView(v: { x: number; y: number }, e: Edits, natural: { w: number; h: number }): { x: number; y: number } {
  const c = cropOf(e, natural);
  let px: number;
  let py: number;
  switch (e.rotate) {
    case 90:
      px = v.y;
      py = c.h - v.x;
      break;
    case 180:
      px = c.w - v.x;
      py = c.h - v.y;
      break;
    case 270:
      px = c.w - v.y;
      py = v.x;
      break;
    default:
      px = v.x;
      py = v.y;
  }
  return { x: px + c.x, y: py + c.y };
}

/** Un rectángulo de lo que se ve → el mismo en la original (rotar de a 90° deja los rectángulos derechos). */
export function rectFromView(r: Rect, e: Edits, natural: { w: number; h: number }): Rect {
  const a = fromView({ x: r.x, y: r.y }, e, natural);
  const b = fromView({ x: r.x + r.w, y: r.y + r.h }, e, natural);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Rotar 90° a la izquierda (como el botón de WhatsApp). */
export function rotateLeft(r: Rotation): Rotation {
  return ((r + 270) % 360) as Rotation;
}

/** Lo mínimo que un contexto 2D tiene que tener para renderEdits (el del canvas, o uno falso en las pruebas). */
export interface Ctx2D {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(a: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillText(t: string, x: number, y: number): void;
  strokeText(t: string, x: number, y: number): void;
  drawImage(img: unknown, ...args: number[]): void;
  lineWidth: number;
  strokeStyle: unknown;
  fillStyle: unknown;
  lineCap: string;
  lineJoin: string;
  font: string;
  textAlign: string;
  textBaseline: string;
}

export const TEXT_FONT = '600 {size}px system-ui, sans-serif';
export const EMOJI_FONT = '{size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/**
 * Dibuja la foto con sus cambios. `scale`: px del canvas por px de la original (1 para mandar en
 * tamaño real, menos para la vista en pantalla o una versión más liviana). `images`: los stickers ya
 * cargados, por URL. `skipOverlay`: el que se está escribiendo (lo muestra el campo de texto).
 */
export function renderEdits(
  ctx: Ctx2D,
  photo: unknown,
  natural: { w: number; h: number },
  e: Edits,
  scale: number,
  opts: { images?: Map<string, unknown>; skipOverlay?: string } = {},
): void {
  const c = cropOf(e, natural);
  ctx.save();
  ctx.scale(scale, scale);
  // De la original a lo que se ve: rotar alrededor del recorte.
  if (e.rotate === 90) {
    ctx.translate(c.h, 0);
    ctx.rotate(Math.PI / 2);
  } else if (e.rotate === 180) {
    ctx.translate(c.w, c.h);
    ctx.rotate(Math.PI);
  } else if (e.rotate === 270) {
    ctx.translate(0, c.w);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.translate(-c.x, -c.y);
  ctx.beginPath();
  ctx.rect(c.x, c.y, c.w, c.h);
  ctx.clip();
  ctx.drawImage(photo, 0, 0, natural.w, natural.h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of e.strokes) {
    if (s.points.length < 2) continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.beginPath();
    ctx.moveTo(s.points[0], s.points[1]);
    // Un toque sin mover: un punto.
    if (s.points.length === 2) ctx.lineTo(s.points[0] + 0.01, s.points[1]);
    for (let i = 2; i < s.points.length; i += 2) ctx.lineTo(s.points[i], s.points[i + 1]);
    ctx.stroke();
  }
  for (const o of e.overlays) {
    if (o.id === opts.skipOverlay) continue;
    ctx.save();
    // Lo de encima queda derecho para quien mira, aunque la foto esté rotada.
    ctx.translate(o.x, o.y);
    if (e.rotate) ctx.rotate((-e.rotate * Math.PI) / 180);
    if (o.kind === 'image') {
      const img = o.src ? opts.images?.get(o.src) : undefined;
      const h = o.size * (o.ratio || 1);
      if (img) ctx.drawImage(img, -o.size / 2, -h / 2, o.size, h);
    } else if (o.text) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (o.kind === 'emoji') {
        ctx.font = EMOJI_FONT.replace('{size}', String(Math.round(o.size)));
        ctx.fillStyle = '#000';
        ctx.fillText(o.text, 0, 0);
      } else {
        ctx.font = TEXT_FONT.replace('{size}', String(Math.round(o.size)));
        // Borde oscuro o claro para que se lea sobre cualquier foto (como WhatsApp).
        ctx.lineWidth = Math.max(2, o.size / 8);
        ctx.strokeStyle = isLight(o.color ?? '#fff') ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)';
        const lines = o.text.split('\n');
        lines.forEach((line, i) => {
          const y = (i - (lines.length - 1) / 2) * o.size * 1.2;
          ctx.strokeText(line, 0, y);
        });
        ctx.fillStyle = o.color ?? '#fff';
        lines.forEach((line, i) => ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * o.size * 1.2));
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

/** ¿Color claro? (para elegir el borde del texto). Acepta #rgb y #rrggbb. */
export function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return true;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

/** Calidad estándar de WhatsApp: el lado largo hasta 1600 px. HD: hasta 4096 px. */
export const SD_MAX_SIDE = 1600;
export const HD_MAX_SIDE = 4096;
/** Más liviana que esto (y dentro del tamaño), la foto sale como está aunque no sea HD. */
export const SD_MAX_BYTES = 1024 * 1024;

/** Escala para mandar: 1 o menos, para que el lado largo no pase el tope. */
export function sendScale(view: { w: number; h: number }, hd: boolean): number {
  const max = hd ? HD_MAX_SIDE : SD_MAX_SIDE;
  const side = Math.max(view.w, view.h);
  return side > max ? max / side : 1;
}

/**
 * ¿Hay que volver a dibujar la foto para mandarla? Con cambios, siempre; sin cambios, solo si no es
 * HD y es grande (en lados o en peso). Los GIF salen como están (perderían la animación).
 */
export function needsRender(file: { type: string; size: number }, natural: { w: number; h: number } | null, edits: Edits | null | undefined, hd: boolean): boolean {
  if (!/^image\/(jpeg|png|webp|heic|heif|bmp)$/i.test(file.type)) return false;
  if (hasEdits(edits)) return true;
  if (hd) return false;
  if (!natural) return file.size > SD_MAX_BYTES;
  return Math.max(natural.w, natural.h) > SD_MAX_SIDE || file.size > SD_MAX_BYTES;
}

/** El nombre de la foto que sale: el mismo, con la extensión del formato nuevo. */
export function outputName(name: string, type: string): string {
  const ext = type === 'image/png' ? 'png' : 'jpg';
  const base = (name || 'photo').replace(/\.[a-z0-9]{1,5}$/i, '') || 'photo';
  return `${base}.${ext}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
