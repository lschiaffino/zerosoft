/**
 * Design (como Canva): el modelo de un diseño. Puro, sin React ni base: lo
 * usan el editor, el render a SVG y a canvas (exportar), el servidor (validar
 * lo que llega) y los tests.
 *
 * Un diseño es un JSON con un tamaño (px) y páginas; cada página tiene un
 * fondo y una lista de elementos en orden de dibujo (el último queda arriba).
 * Las imágenes se guardan por id de archivo (design_files), nunca como URL
 * de terceros ni base64.
 */
import { z } from 'zod';

// ---------- Tamaños ----------

export const DESIGN_PRESETS = [
  { key: 'instagram-post', w: 1080, h: 1080 },
  { key: 'instagram-story', w: 1080, h: 1920 },
  { key: 'linkedin-post', w: 1200, h: 627 },
  { key: 'a4', w: 794, h: 1123 },
  { key: 'presentation', w: 1920, h: 1080 },
  { key: 'logo', w: 500, h: 500 },
] as const;
export type DesignPresetKey = (typeof DESIGN_PRESETS)[number]['key'];

export const MIN_SIDE = 16;
export const MAX_SIDE = 8000;
export const MAX_PAGES = 50;
export const MAX_ELEMENTS = 400;
/** Tope del JSON guardado (las imágenes van aparte, por id). */
export const MAX_DOC_BYTES = 1_000_000;

export function presetSize(key: string): { w: number; h: number } | null {
  const p = DESIGN_PRESETS.find((x) => x.key === key);
  return p ? { w: p.w, h: p.h } : null;
}

export function clampSide(n: number): number {
  if (!Number.isFinite(n)) return MIN_SIDE;
  return Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(n)));
}

// ---------- Tipos ----------

export const FONT_KEYS = ['inter', 'montserrat', 'playfair', 'lora', 'oswald', 'caveat', 'bebas', 'dmserif', 'grotesk', 'plexmono', 'georgia', 'arial'] as const;
export type FontKey = (typeof FONT_KEYS)[number];

export const SHAPES = ['rect', 'ellipse', 'triangle', 'diamond', 'star', 'arrow', 'hexagon'] as const;
export type ShapeKind = (typeof SHAPES)[number];

export type Align = 'left' | 'center' | 'right';
export type Mask = 'none' | 'rounded' | 'circle';

export interface Crop {
  /** Fracciones (0–1) de la imagen original: qué parte se ve. */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BaseEl {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Grados, sentido horario, alrededor del centro. */
  rotation: number;
  /** 0–1. */
  opacity: number;
  locked?: boolean;
  hidden?: boolean;
  groupId?: string | null;
  name?: string;
}

export interface TextEl extends BaseEl {
  type: 'text';
  text: string;
  font: FontKey;
  size: number;
  weight: number;
  italic?: boolean;
  underline?: boolean;
  uppercase?: boolean;
  color: string;
  align: Align;
  lineHeight: number;
  letterSpacing: number;
}

export interface ShapeEl extends BaseEl {
  type: 'shape';
  shape: ShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** Esquinas redondeadas (solo rect). */
  radius: number;
}

export interface LineEl extends BaseEl {
  type: 'line';
  stroke: string;
  strokeWidth: number;
  dash: 'solid' | 'dashed' | 'dotted';
  arrowEnd?: boolean;
  arrowStart?: boolean;
}

export interface ImageEl extends BaseEl {
  type: 'image';
  /** id de design_files; null = marco vacío (placeholder). */
  src: string | null;
  natW: number;
  natH: number;
  crop: Crop;
  mask: Mask;
  flipX?: boolean;
  flipY?: boolean;
}

export interface IconEl extends BaseEl {
  type: 'icon';
  icon: string;
  color: string;
  strokeWidth: number;
}

export type DesignElement = TextEl | ShapeEl | LineEl | ImageEl | IconEl;
export type ElementType = DesignElement['type'];

export interface DesignPage {
  id: string;
  background: { color: string; image: string | null };
  elements: DesignElement[];
}

export interface DesignDoc {
  v: 1;
  width: number;
  height: number;
  pages: DesignPage[];
}

// ---------- Ids ----------

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function newId(prefix = ''): string {
  let out = '';
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return prefix + out;
}

// ---------- Validación ----------

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Colores: #rgb, #rrggbb, #rrggbbaa o 'transparent'. Nada de url() ni expresiones. */
const COLOR_RE = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|transparent)$/;
export const FILE_ID_RE = /^f_[A-Za-z0-9_-]{6,64}$/;

export function isColor(v: unknown): v is string {
  return typeof v === 'string' && COLOR_RE.test(v);
}

const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const color = z.string().regex(COLOR_RE);
const base = {
  id: z.string().regex(ID_RE),
  x: num(-100_000, 100_000),
  y: num(-100_000, 100_000),
  w: num(1, 100_000),
  h: num(1, 100_000),
  rotation: num(-3600, 3600),
  opacity: num(0, 1),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  groupId: z.string().regex(ID_RE).nullable().optional(),
  name: z.string().max(80).optional(),
};

const textSchema = z.object({
  ...base,
  type: z.literal('text'),
  text: z.string().max(5000),
  font: z.enum(FONT_KEYS),
  size: num(4, 2000),
  weight: num(100, 900),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  uppercase: z.boolean().optional(),
  color,
  align: z.enum(['left', 'center', 'right']),
  lineHeight: num(0.5, 4),
  letterSpacing: num(-50, 200),
});
const shapeSchema = z.object({
  ...base,
  type: z.literal('shape'),
  shape: z.enum(SHAPES),
  fill: color,
  stroke: color,
  strokeWidth: num(0, 200),
  radius: num(0, 10_000),
});
const lineSchema = z.object({
  ...base,
  type: z.literal('line'),
  stroke: color,
  strokeWidth: num(1, 200),
  dash: z.enum(['solid', 'dashed', 'dotted']),
  arrowEnd: z.boolean().optional(),
  arrowStart: z.boolean().optional(),
});
const imageSchema = z.object({
  ...base,
  type: z.literal('image'),
  src: z.string().regex(FILE_ID_RE).nullable(),
  natW: num(1, 100_000),
  natH: num(1, 100_000),
  crop: z.object({ x: num(0, 1), y: num(0, 1), w: num(0.01, 1), h: num(0.01, 1) }),
  mask: z.enum(['none', 'rounded', 'circle']),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
});
const iconSchema = z.object({
  ...base,
  type: z.literal('icon'),
  icon: z.string().regex(/^[a-z0-9-]{1,40}$/),
  color,
  strokeWidth: num(0.5, 8),
});

const elementSchema = z.discriminatedUnion('type', [textSchema, shapeSchema, lineSchema, imageSchema, iconSchema]);

const pageSchema = z.object({
  id: z.string().regex(ID_RE),
  background: z.object({ color, image: z.string().regex(FILE_ID_RE).nullable() }),
  elements: z.array(elementSchema).max(MAX_ELEMENTS),
});

export const designDocSchema = z.object({
  v: z.literal(1),
  width: z.number().int().min(MIN_SIDE).max(MAX_SIDE),
  height: z.number().int().min(MIN_SIDE).max(MAX_SIDE),
  pages: z.array(pageSchema).min(1).max(MAX_PAGES),
});

/** Valida un diseño que llega de afuera. null si no es válido (o es demasiado grande). */
export function parseDoc(raw: unknown): DesignDoc | null {
  const parsed = designDocSchema.safeParse(raw);
  if (!parsed.success) return null;
  const doc = parsed.data as DesignDoc;
  if (docBytes(doc) > MAX_DOC_BYTES) return null;
  // Los ids de página y de elemento no se repiten dentro del diseño.
  const seen = new Set<string>();
  for (const p of doc.pages) {
    if (seen.has(p.id)) return null;
    seen.add(p.id);
    for (const el of p.elements) {
      if (seen.has(el.id)) return null;
      seen.add(el.id);
    }
  }
  return doc;
}

export function docBytes(doc: DesignDoc): number {
  return new TextEncoder().encode(JSON.stringify(doc)).length;
}

// ---------- Creación ----------

export function blankPage(color = '#ffffff'): DesignPage {
  return { id: newId('p'), background: { color, image: null }, elements: [] };
}

export function blankDoc(width: number, height: number): DesignDoc {
  return { v: 1, width: clampSide(width), height: clampSide(height), pages: [blankPage()] };
}

/** Ids nuevos para una página copiada (duplicar página o diseño, plantillas). Los grupos se mantienen juntos. */
export function cloneWithNewIds<T extends DesignPage | DesignElement[]>(input: T): T {
  const groups = new Map<string, string>();
  const regroup = (g: string | null | undefined) => {
    if (!g) return g ?? null;
    if (!groups.has(g)) groups.set(g, newId('g'));
    return groups.get(g)!;
  };
  const els = (list: DesignElement[]) => list.map((el) => ({ ...el, id: newId('e'), groupId: regroup(el.groupId) }) as DesignElement);
  if (Array.isArray(input)) return els(input) as T;
  const page = input as DesignPage;
  return { ...page, id: newId('p'), elements: els(page.elements) } as T;
}

export function cloneDoc(doc: DesignDoc): DesignDoc {
  return { ...doc, pages: doc.pages.map((p) => cloneWithNewIds(p)) };
}

/** Texto de un diseño para buscar (nombre aparte). */
export function docSearchText(doc: DesignDoc): string {
  const parts: string[] = [];
  for (const p of doc.pages) for (const el of p.elements) if (el.type === 'text' && el.text.trim()) parts.push(el.text.trim());
  return parts.join(' ').replace(/\s+/g, ' ').slice(0, 4000);
}

/** Archivos que usa el diseño (imágenes y fondos). */
export function docFileIds(doc: DesignDoc): string[] {
  const out = new Set<string>();
  for (const p of doc.pages) {
    if (p.background.image) out.add(p.background.image);
    for (const el of p.elements) if (el.type === 'image' && el.src) out.add(el.src);
  }
  return [...out];
}

// ---------- Geometría ----------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Point = { x: number; y: number };

const rad = (deg: number) => (deg * Math.PI) / 180;

export function rotatePoint(p: Point, c: Point, deg: number): Point {
  if (!deg) return p;
  const a = rad(deg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export function corners(el: Box & { rotation?: number }): Point[] {
  const c = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  return [
    { x: el.x, y: el.y },
    { x: el.x + el.w, y: el.y },
    { x: el.x + el.w, y: el.y + el.h },
    { x: el.x, y: el.y + el.h },
  ].map((p) => rotatePoint(p, c, el.rotation ?? 0));
}

/** Caja alineada a los ejes que contiene al elemento rotado. */
export function bounds(el: Box & { rotation?: number }): Box {
  const pts = corners(el);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function unionBounds(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const bt = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: bt - y };
}

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Manijas: -1 = lado izquierdo/arriba, 1 = derecho/abajo, 0 = medio. */
export type Handle = { sx: -1 | 0 | 1; sy: -1 | 0 | 1 };

/**
 * Redimensiona un elemento (rotado o no) arrastrando una manija `dx, dy`
 * (en coordenadas de la página): el lado opuesto queda fijo. `keepAspect`
 * mantiene la proporción (esquinas de imágenes, Shift).
 */
export function resizeBox(
  el: Box & { rotation: number },
  handle: Handle,
  dx: number,
  dy: number,
  opts: { keepAspect?: boolean; min?: number } = {},
): Box {
  const min = opts.min ?? 4;
  const local = rotatePoint({ x: dx, y: dy }, { x: 0, y: 0 }, -el.rotation);
  let w = el.w + handle.sx * local.x;
  let h = el.h + handle.sy * local.y;
  if (opts.keepAspect && handle.sx !== 0 && handle.sy !== 0) {
    const ratio = el.w / el.h;
    // Manda el eje que más se movió (en proporción).
    if (Math.abs(w / el.w) > Math.abs(h / el.h)) h = w / ratio;
    else w = h * ratio;
    if (w < min) {
      w = min;
      h = min / ratio;
    }
    if (h < min) {
      h = min;
      w = min * ratio;
    }
  }
  w = Math.max(min, w);
  h = Math.max(min, h);
  // El centro se corre la mitad del cambio, hacia el lado de la manija (en local).
  const shift = rotatePoint({ x: (handle.sx * (w - el.w)) / 2, y: (handle.sy * (h - el.h)) / 2 }, { x: 0, y: 0 }, el.rotation);
  const cx = el.x + el.w / 2 + shift.x;
  const cy = el.y + el.h / 2 + shift.y;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Manija de un lado en una imagen: en vez de deformarla, muestra más o menos
 * de la foto (cambia el recorte) hasta el borde de la imagen original.
 */
export function resizeImageSide(el: ImageEl, handle: Handle, dx: number, dy: number): Pick<ImageEl, 'x' | 'y' | 'w' | 'h' | 'crop'> {
  const kx = el.w / (el.crop.w * el.natW);
  const ky = el.h / (el.crop.h * el.natH);
  const box = resizeBox(el, handle, dx, dy, { min: 8 });
  const crop = { ...el.crop };
  if (handle.sx !== 0) {
    let cw = box.w / (kx * el.natW);
    if (handle.sx < 0) {
      const right = el.crop.x + el.crop.w;
      cw = Math.min(cw, right);
      crop.x = right - cw;
    } else cw = Math.min(cw, 1 - el.crop.x);
    crop.w = Math.max(0.01, cw);
  }
  if (handle.sy !== 0) {
    let ch = box.h / (ky * el.natH);
    if (handle.sy < 0) {
      const bottom = el.crop.y + el.crop.h;
      ch = Math.min(ch, bottom);
      crop.y = bottom - ch;
    } else ch = Math.min(ch, 1 - el.crop.y);
    crop.h = Math.max(0.01, ch);
  }
  const w = crop.w * kx * el.natW;
  const h = crop.h * ky * el.natH;
  const world = rotatePoint({ x: (w - el.w) * handle.sx, y: (h - el.h) * handle.sy }, { x: 0, y: 0 }, el.rotation);
  const b = resizeBox(el, handle, world.x, world.y, { min: 1 });
  return { ...b, crop };
}

/** Ángulo (grados, 0 arriba) del puntero respecto del centro, con imán cada 15° si `snap`. */
export function rotationFromPointer(center: Point, p: Point, snap = false): number {
  let deg = (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI + 90;
  if (snap) deg = Math.round(deg / 15) * 15;
  deg = ((deg % 360) + 360) % 360;
  return Math.round(deg * 10) / 10;
}

// ---------- Guías de alineación (snapping) ----------

export interface SnapResult {
  dx: number;
  dy: number;
  /** Líneas a dibujar (coordenadas de la página). */
  guides: Array<{ axis: 'x' | 'y'; pos: number }>;
}

/**
 * Imán al mover: los bordes y el centro de `box` se pegan a los de la
 * página y de los otros elementos si quedan a menos de `threshold`.
 */
export function snapMove(box: Box, targets: Box[], page: { w: number; h: number }, threshold: number): SnapResult {
  const xs = [0, page.w / 2, page.w];
  const ys = [0, page.h / 2, page.h];
  for (const t of targets) {
    xs.push(t.x, t.x + t.w / 2, t.x + t.w);
    ys.push(t.y, t.y + t.h / 2, t.y + t.h);
  }
  const best = (mine: number[], theirs: number[]) => {
    let delta = 0;
    let dist = threshold + 1;
    let pos: number | null = null;
    for (const m of mine)
      for (const t of theirs) {
        const d = Math.abs(t - m);
        if (d < dist) {
          dist = d;
          delta = t - m;
          pos = t;
        }
      }
    return dist <= threshold ? { delta, pos } : { delta: 0, pos: null };
  };
  const bx = best([box.x, box.x + box.w / 2, box.x + box.w], xs);
  const by = best([box.y, box.y + box.h / 2, box.y + box.h], ys);
  const guides: SnapResult['guides'] = [];
  if (bx.pos !== null) guides.push({ axis: 'x', pos: bx.pos });
  if (by.pos !== null) guides.push({ axis: 'y', pos: by.pos });
  return { dx: bx.delta, dy: by.delta, guides };
}

// ---------- Alinear y distribuir ----------

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/**
 * Cuánto mover cada caja para alinearlas. Con una sola, contra la página;
 * con varias, contra la caja que las contiene a todas.
 */
export function alignDeltas(boxes: Box[], mode: AlignMode, page: { w: number; h: number }): Point[] {
  const ref = boxes.length === 1 ? { x: 0, y: 0, w: page.w, h: page.h } : unionBounds(boxes)!;
  return boxes.map((b) => {
    switch (mode) {
      case 'left':
        return { x: ref.x - b.x, y: 0 };
      case 'hcenter':
        return { x: ref.x + ref.w / 2 - (b.x + b.w / 2), y: 0 };
      case 'right':
        return { x: ref.x + ref.w - (b.x + b.w), y: 0 };
      case 'top':
        return { x: 0, y: ref.y - b.y };
      case 'vcenter':
        return { x: 0, y: ref.y + ref.h / 2 - (b.y + b.h / 2) };
      case 'bottom':
        return { x: 0, y: ref.y + ref.h - (b.y + b.h) };
    }
  });
}

/** Espacio igual entre cajas (3 o más) en un eje; las de los extremos no se mueven. */
export function distributeDeltas(boxes: Box[], axis: 'x' | 'y'): Point[] {
  const out: Point[] = boxes.map(() => ({ x: 0, y: 0 }));
  if (boxes.length < 3) return out;
  const pos = (b: Box) => (axis === 'x' ? b.x : b.y);
  const size = (b: Box) => (axis === 'x' ? b.w : b.h);
  const order = boxes.map((b, i) => ({ b, i })).sort((a, b) => pos(a.b) - pos(b.b));
  const first = order[0].b;
  const last = order[order.length - 1].b;
  const total = pos(last) + size(last) - pos(first);
  const used = order.reduce((s, o) => s + size(o.b), 0);
  const gap = (total - used) / (order.length - 1);
  let cursor = pos(first);
  for (const o of order) {
    const d = cursor - pos(o.b);
    out[o.i] = axis === 'x' ? { x: d, y: 0 } : { x: 0, y: d };
    cursor += size(o.b) + gap;
  }
  return out;
}

// ---------- Orden (capas) ----------

export type ZMove = 'forward' | 'backward' | 'front' | 'back';

/** Reordena los elementos `ids` (manteniendo su orden relativo). */
export function reorder(elements: DesignElement[], ids: Set<string>, move: ZMove): DesignElement[] {
  const list = [...elements];
  if (move === 'front') return [...list.filter((e) => !ids.has(e.id)), ...list.filter((e) => ids.has(e.id))];
  if (move === 'back') return [...list.filter((e) => ids.has(e.id)), ...list.filter((e) => !ids.has(e.id))];
  if (move === 'forward') {
    for (let i = list.length - 2; i >= 0; i--) {
      if (ids.has(list[i].id) && !ids.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
    }
  } else {
    for (let i = 1; i < list.length; i++) {
      if (ids.has(list[i].id) && !ids.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
    }
  }
  return list;
}

/** Al seleccionar un elemento de un grupo, se selecciona el grupo entero. */
export function expandGroups(elements: DesignElement[], ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  const groups = new Set(elements.filter((e) => out.has(e.id) && e.groupId).map((e) => e.groupId));
  for (const e of elements) if (e.groupId && groups.has(e.groupId)) out.add(e.id);
  return out;
}

// ---------- Texto ----------

export type Measure = (text: string) => number;

export function displayText(el: Pick<TextEl, 'text' | 'uppercase'>): string {
  return el.uppercase ? el.text.toUpperCase() : el.text;
}

/**
 * Corta el texto en líneas que entran en `width` (palabra por palabra; una
 * palabra más larga que el ancho se corta por letras). `measure` mide en px
 * con la fuente ya puesta (canvas measureText). Respeta los saltos de línea.
 */
export function wrapText(text: string, width: number, measure: Measure, letterSpacing = 0): string[] {
  const m = (s: string) => measure(s) + Math.max(0, s.length - 1) * letterSpacing;
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/).filter((w) => w.length > 0);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (!line || m(candidate.trimEnd()) <= width) {
        if (!line && m(word) > width && word.trim()) {
          // Palabra sola más ancha que la caja: por letras.
          let chunk = '';
          for (const ch of word) {
            if (chunk && m(chunk + ch) > width) {
              lines.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = candidate;
      } else {
        lines.push(line.trimEnd());
        line = word.trim() ? word : '';
        if (m(line) > width && line.trim()) {
          let chunk = '';
          for (const ch of line) {
            if (chunk && m(chunk + ch) > width) {
              lines.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        }
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function textHeight(el: Pick<TextEl, 'size' | 'lineHeight'>, lineCount: number): number {
  return Math.max(1, lineCount) * el.size * el.lineHeight;
}

/** x de una línea según la alineación (dentro de la caja de ancho `w`). */
export function lineX(align: Align, w: number, lineWidth: number): number {
  if (align === 'center') return (w - lineWidth) / 2;
  if (align === 'right') return w - lineWidth;
  return 0;
}

// ---------- Formas ----------

const f = (n: number) => Math.round(n * 100) / 100;

function polygon(points: Point[]): string {
  return `M${points.map((p) => `${f(p.x)} ${f(p.y)}`).join(' L')} Z`;
}

/** Trazo SVG de una forma en su caja (0,0)–(w,h). Lo usan el SVG y canvas (Path2D). */
export function shapePath(shape: ShapeKind, w: number, h: number, radius = 0): string {
  switch (shape) {
    case 'rect': {
      const r = Math.max(0, Math.min(radius, w / 2, h / 2));
      if (!r) return `M0 0 H${f(w)} V${f(h)} H0 Z`;
      return `M${f(r)} 0 H${f(w - r)} A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)} V${f(h - r)} A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)} H${f(r)} A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)} V${f(r)} A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0 Z`;
    }
    case 'ellipse': {
      const rx = w / 2;
      const ry = h / 2;
      return `M0 ${f(ry)} A${f(rx)} ${f(ry)} 0 1 0 ${f(w)} ${f(ry)} A${f(rx)} ${f(ry)} 0 1 0 0 ${f(ry)} Z`;
    }
    case 'triangle':
      return polygon([{ x: w / 2, y: 0 }, { x: w, y: h }, { x: 0, y: h }]);
    case 'diamond':
      return polygon([{ x: w / 2, y: 0 }, { x: w, y: h / 2 }, { x: w / 2, y: h }, { x: 0, y: h / 2 }]);
    case 'hexagon':
      return polygon([
        { x: w * 0.25, y: 0 },
        { x: w * 0.75, y: 0 },
        { x: w, y: h / 2 },
        { x: w * 0.75, y: h },
        { x: w * 0.25, y: h },
        { x: 0, y: h / 2 },
      ]);
    case 'star': {
      const pts: Point[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 0.5 : 0.2;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push({ x: w / 2 + Math.cos(a) * w * r, y: h / 2 + Math.sin(a) * h * r + h * 0.025 });
      }
      return polygon(pts);
    }
    case 'arrow':
      return polygon([
        { x: 0, y: h * 0.3 },
        { x: w * 0.62, y: h * 0.3 },
        { x: w * 0.62, y: 0 },
        { x: w, y: h / 2 },
        { x: w * 0.62, y: h },
        { x: w * 0.62, y: h * 0.7 },
        { x: 0, y: h * 0.7 },
      ]);
  }
}

/** Trazos de una línea: el segmento y, si van, las puntas de flecha. */
export function linePaths(el: Pick<LineEl, 'w' | 'h' | 'strokeWidth' | 'arrowEnd' | 'arrowStart'>): { line: string; heads: string[] } {
  const y = el.h / 2;
  const head = Math.max(8, el.strokeWidth * 3);
  const heads: string[] = [];
  if (el.arrowEnd) heads.push(`M${f(el.w - head)} ${f(y - head / 1.6)} L${f(el.w)} ${f(y)} L${f(el.w - head)} ${f(y + head / 1.6)}`);
  if (el.arrowStart) heads.push(`M${f(head)} ${f(y - head / 1.6)} L0 ${f(y)} L${f(head)} ${f(y + head / 1.6)}`);
  return { line: `M0 ${f(y)} L${f(el.w)} ${f(y)}`, heads };
}

export function dashArray(dash: LineEl['dash'], width: number): number[] {
  if (dash === 'dashed') return [width * 3, width * 2];
  if (dash === 'dotted') return [width * 0.01, width * 2];
  return [];
}

/** Recorte de la imagen dentro de la caja: posición y tamaño de la imagen entera (coordenadas locales). */
export function imagePlacement(el: Pick<ImageEl, 'w' | 'h' | 'crop'>): Box {
  const w = el.w / el.crop.w;
  const h = el.h / el.crop.h;
  return { x: -el.crop.x * w, y: -el.crop.y * h, w, h };
}

/** Crop "cover": la imagen llena la caja sin deformarse, centrada. */
export function coverCrop(natW: number, natH: number, boxW: number, boxH: number): Crop {
  const imgRatio = natW / natH;
  const boxRatio = boxW / boxH;
  if (imgRatio > boxRatio) {
    const w = boxRatio / imgRatio;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = imgRatio / boxRatio;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

/** Acerca o aleja el recorte alrededor de su centro (zoom ≥ 1 = más cerca). */
export function zoomCrop(crop: Crop, zoom: number): Crop {
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  const w = Math.min(1, Math.max(0.05, crop.w / zoom));
  const h = Math.min(1, Math.max(0.05, crop.h / zoom));
  // Si un lado topa en 1, el otro se ajusta para no deformar.
  const k = Math.min(1 / w, 1 / h, 1);
  const ww = w * k;
  const hh = h * k;
  return clampCrop({ x: cx - ww / 2, y: cy - hh / 2, w: ww, h: hh });
}

export function clampCrop(c: Crop): Crop {
  const w = Math.min(1, Math.max(0.01, c.w));
  const h = Math.min(1, Math.max(0.01, c.h));
  return { x: Math.min(1 - w, Math.max(0, c.x)), y: Math.min(1 - h, Math.max(0, c.y)), w, h };
}

// ---------- Cambiar el tamaño del diseño ----------

/** Copia el diseño a otro tamaño: escala el contenido para que entre y lo centra. */
export function resizeDoc(doc: DesignDoc, width: number, height: number): DesignDoc {
  const W = clampSide(width);
  const H = clampSide(height);
  const k = Math.min(W / doc.width, H / doc.height);
  const ox = (W - doc.width * k) / 2;
  const oy = (H - doc.height * k) / 2;
  return {
    v: 1,
    width: W,
    height: H,
    pages: doc.pages.map((p) =>
      cloneWithNewIds({
        ...p,
        elements: p.elements.map((el) => scaleElement(el, k, ox, oy)),
      }),
    ),
  };
}

export function scaleElement(el: DesignElement, k: number, ox = 0, oy = 0): DesignElement {
  const next = { ...el, x: ox + el.x * k, y: oy + el.y * k, w: Math.max(1, el.w * k), h: Math.max(1, el.h * k) };
  if (next.type === 'text') {
    next.size = Math.max(4, Math.round(next.size * k * 10) / 10);
    next.letterSpacing = next.letterSpacing * k;
  }
  if (next.type === 'shape') {
    next.strokeWidth = next.strokeWidth * k;
    next.radius = next.radius * k;
  }
  if (next.type === 'line') next.strokeWidth = Math.max(1, next.strokeWidth * k);
  return next;
}
