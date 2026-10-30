/**
 * Design: elementos nuevos (texto, formas, líneas, marcos, grillas, íconos e
 * imágenes) con tamaños proporcionales a la página. Puro.
 */
import { coverCrop, newId, type DesignElement, type FontKey, type ImageEl, type Mask, type ShapeKind, type TextEl } from './design-model';

export interface PageSize {
  width: number;
  height: number;
}

const base = () => ({ id: newId('e'), rotation: 0, opacity: 1 });
const unit = (p: PageSize) => Math.min(p.width, p.height);

export type TextKind = 'heading' | 'subheading' | 'body';

export function makeText(p: PageSize, kind: TextKind, opts: { font?: FontKey | null; text: string; color?: string; at?: { x: number; y: number } }): TextEl {
  const u = unit(p);
  const size = Math.round(kind === 'heading' ? u * 0.09 : kind === 'subheading' ? u * 0.05 : u * 0.032);
  const w = Math.round(p.width * (kind === 'body' ? 0.6 : 0.7));
  const h = size * 1.2;
  const x = opts.at ? opts.at.x - w / 2 : (p.width - w) / 2;
  const y = opts.at ? opts.at.y - h / 2 : (p.height - h) / 2;
  return {
    ...base(),
    type: 'text',
    x,
    y,
    w,
    h,
    text: opts.text,
    font: opts.font ?? (kind === 'body' ? 'inter' : 'montserrat'),
    size: Math.max(8, size),
    weight: kind === 'heading' ? 800 : kind === 'subheading' ? 600 : 400,
    color: opts.color ?? '#111111',
    align: 'center',
    lineHeight: kind === 'body' ? 1.4 : 1.2,
    letterSpacing: 0,
  };
}

export function makeShape(p: PageSize, shape: ShapeKind, fill = '#00a5c8'): DesignElement {
  const s = Math.round(unit(p) * 0.3);
  const w = shape === 'arrow' ? Math.round(s * 1.4) : s;
  const h = shape === 'arrow' ? Math.round(s * 0.7) : s;
  return { ...base(), type: 'shape', shape, x: (p.width - w) / 2, y: (p.height - h) / 2, w, h, fill, stroke: '#111111', strokeWidth: 0, radius: 0 };
}

export function makeLine(p: PageSize, variant: 'solid' | 'dashed' | 'arrow'): DesignElement {
  const w = Math.round(p.width * 0.4);
  const sw = Math.max(2, Math.round(unit(p) / 200));
  return {
    ...base(),
    type: 'line',
    x: (p.width - w) / 2,
    y: p.height / 2 - sw / 2,
    w,
    h: sw,
    stroke: '#111111',
    strokeWidth: sw,
    dash: variant === 'dashed' ? 'dashed' : 'solid',
    arrowEnd: variant === 'arrow',
  };
}

export function makeIcon(p: PageSize, icon: string, color = '#111111'): DesignElement {
  const s = Math.round(unit(p) * 0.16);
  return { ...base(), type: 'icon', icon, x: (p.width - s) / 2, y: (p.height - s) / 2, w: s, h: s, color, strokeWidth: 1.8 };
}

export function makeFrame(p: PageSize, mask: Mask, box?: { x: number; y: number; w: number; h: number }): ImageEl {
  const s = Math.round(unit(p) * 0.4);
  const b = box ?? { x: (p.width - s) / 2, y: (p.height - s) / 2, w: s, h: s };
  return { ...base(), type: 'image', ...b, src: null, natW: b.w, natH: b.h, crop: { x: 0, y: 0, w: 1, h: 1 }, mask };
}

export type GridLayout = '2-cols' | '2-rows' | '3-cols' | '2x2' | '1+2' | '3x2';

/** Grilla de marcos que llena la página con un margen y espacio entre celdas (van agrupados). */
export function makeGrid(p: PageSize, layout: GridLayout): ImageEl[] {
  const m = Math.round(unit(p) * 0.04);
  const gap = Math.round(unit(p) * 0.02);
  const W = p.width - m * 2;
  const H = p.height - m * 2;
  const cells: Array<{ x: number; y: number; w: number; h: number }> = [];
  const grid = (cols: number, rows: number) => {
    const cw = (W - gap * (cols - 1)) / cols;
    const ch = (H - gap * (rows - 1)) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: m + c * (cw + gap), y: m + r * (ch + gap), w: cw, h: ch });
  };
  switch (layout) {
    case '2-cols':
      grid(2, 1);
      break;
    case '2-rows':
      grid(1, 2);
      break;
    case '3-cols':
      grid(3, 1);
      break;
    case '2x2':
      grid(2, 2);
      break;
    case '3x2':
      grid(3, 2);
      break;
    case '1+2': {
      const left = (W - gap) * 0.6;
      const rw = W - gap - left;
      const rh = (H - gap) / 2;
      cells.push({ x: m, y: m, w: left, h: H }, { x: m + left + gap, y: m, w: rw, h: rh }, { x: m + left + gap, y: m + rh + gap, w: rw, h: rh });
      break;
    }
  }
  const g = newId('g');
  return cells.map((c) => ({ ...makeFrame(p, 'none', c), groupId: g }));
}

/** Imagen nueva: entra en la página (como mucho el 60 %), centrada o en `at`. */
export function makeImage(p: PageSize, file: { id: string; width: number; height: number }, at?: { x: number; y: number }): ImageEl {
  const k = Math.min(1, (p.width * 0.6) / file.width, (p.height * 0.6) / file.height);
  const w = Math.max(8, Math.round(file.width * k));
  const h = Math.max(8, Math.round(file.height * k));
  const x = at ? at.x - w / 2 : (p.width - w) / 2;
  const y = at ? at.y - h / 2 : (p.height - h) / 2;
  return { ...base(), type: 'image', x, y, w, h, src: file.id, natW: file.width, natH: file.height, crop: { x: 0, y: 0, w: 1, h: 1 }, mask: 'none' };
}

/** Llena un marco (o cambia la imagen) sin deformar: recorte "cover" centrado. */
export function fillFrame(el: ImageEl, file: { id: string; width: number; height: number }): ImageEl {
  return { ...el, src: file.id, natW: file.width, natH: file.height, crop: coverCrop(file.width, file.height, el.w, el.h) };
}
