'use client';

import { iconPath } from '@/lib/design-icons';
import { dashArray, imagePlacement, linePaths, lineX, shapePath, type DesignDoc, type DesignElement, type DesignPage } from '@/lib/design-model';
import { buildImagePdf } from '@/lib/pdf-images';
import { exportFileName, type ExportFormat } from '@/lib/design-export';
import { fontCss, loadDocFonts } from './fonts';
import { layoutText } from './textLayout';
import { baselineY, fileHref } from './PageSvg';

/**
 * Exportar en el navegador: cada página se dibuja en un canvas con las mismas
 * reglas que el SVG del editor (formas por Path2D, texto con la misma
 * medición y línea base). Las imágenes se piden a nuestro origen, así el
 * canvas no queda "sucio" y se puede leer.
 */

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    imageCache.set(src, p);
  }
  return p;
}

function maskPath2D(el: Extract<DesignElement, { type: 'image' }>): Path2D {
  if (el.mask === 'circle') return new Path2D(shapePath('ellipse', el.w, el.h));
  if (el.mask === 'rounded') return new Path2D(shapePath('rect', el.w, el.h, Math.min(el.w, el.h) * 0.12));
  return new Path2D(shapePath('rect', el.w, el.h));
}

function drawText(ctx: CanvasRenderingContext2D, el: Extract<DesignElement, { type: 'text' }>) {
  const layout = layoutText(el);
  ctx.font = fontCss(el);
  ctx.fillStyle = el.color;
  ctx.textBaseline = 'alphabetic';
  layout.lines.forEach((line, i) => {
    const x0 = lineX(el.align, el.w, line.width);
    const y = baselineY(i, el.size, el.lineHeight);
    if (el.letterSpacing) {
      let x = x0;
      for (const ch of line.text) {
        ctx.fillText(ch, x, y);
        x += ctx.measureText(ch).width + el.letterSpacing;
      }
    } else ctx.fillText(line.text, x0, y);
    if (el.underline && line.text.trim()) {
      ctx.fillRect(x0, y + el.size * 0.1, line.width, Math.max(1, el.size / 16));
    }
  });
}

async function drawElement(ctx: CanvasRenderingContext2D, el: DesignElement, token: string | null) {
  ctx.save();
  ctx.translate(el.x, el.y);
  if (el.rotation) {
    ctx.translate(el.w / 2, el.h / 2);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.translate(-el.w / 2, -el.h / 2);
  }
  ctx.globalAlpha = el.opacity;
  switch (el.type) {
    case 'text':
      drawText(ctx, el);
      break;
    case 'shape': {
      const path = new Path2D(shapePath(el.shape, el.w, el.h, el.radius));
      if (el.fill !== 'transparent') {
        ctx.fillStyle = el.fill;
        ctx.fill(path);
      }
      if (el.strokeWidth > 0 && el.stroke !== 'transparent') {
        ctx.strokeStyle = el.stroke;
        ctx.lineWidth = el.strokeWidth;
        ctx.lineJoin = 'round';
        ctx.stroke(path);
      }
      break;
    }
    case 'line': {
      const { line, heads } = linePaths(el);
      ctx.strokeStyle = el.stroke;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash(dashArray(el.dash, el.strokeWidth));
      ctx.stroke(new Path2D(line));
      ctx.setLineDash([]);
      for (const h of heads) ctx.stroke(new Path2D(h));
      break;
    }
    case 'icon': {
      const d = iconPath(el.icon);
      if (d) {
        ctx.scale(el.w / 24, el.h / 24);
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(new Path2D(d));
      }
      break;
    }
    case 'image': {
      // Un marco vacío no se exporta (como en Canva).
      if (!el.src) break;
      const img = await loadImage(fileHref(el.src, token));
      if (!img) break;
      ctx.clip(maskPath2D(el));
      if (el.flipX || el.flipY) {
        ctx.translate(el.flipX ? el.w : 0, el.flipY ? el.h : 0);
        ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
      }
      const p = imagePlacement(el);
      ctx.drawImage(img, p.x, p.y, p.w, p.h);
      break;
    }
  }
  ctx.restore();
}

export interface RenderOptions {
  scale?: number;
  transparent?: boolean;
  token?: string | null;
  /** Ancho final en px (miniaturas); manda sobre `scale`. */
  width?: number;
}

export async function renderPage(doc: DesignDoc, page: DesignPage, opts: RenderOptions = {}): Promise<HTMLCanvasElement> {
  await loadDocFonts(doc);
  const scale = opts.width ? opts.width / doc.width : (opts.scale ?? 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(doc.width * scale));
  canvas.height = Math.max(1, Math.round(doc.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.scale(scale, scale);
  if (!opts.transparent) {
    ctx.fillStyle = page.background.color === 'transparent' ? '#ffffff' : page.background.color;
    ctx.fillRect(0, 0, doc.width, doc.height);
    if (page.background.image) {
      const img = await loadImage(fileHref(page.background.image, opts.token ?? null));
      if (img) {
        // "cover": llena la página sin deformar.
        const k = Math.max(doc.width / img.naturalWidth, doc.height / img.naturalHeight);
        const w = img.naturalWidth * k;
        const h = img.naturalHeight * k;
        ctx.drawImage(img, (doc.width - w) / 2, (doc.height - h) / 2, w, h);
      }
    }
  }
  for (const el of page.elements) if (!el.hidden) await drawElement(ctx, el, opts.token ?? null);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('export_failed'))), type, quality));
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface ExportRequest {
  format: ExportFormat;
  /** Índices de página (0…). */
  pages: number[];
  scale: number;
  transparent: boolean;
}

/** Arma y descarga los archivos. Devuelve los nombres (para los tests y el aviso). */
export async function exportDesign(doc: DesignDoc, name: string, req: ExportRequest, token: string | null = null): Promise<string[]> {
  const pages = req.pages.filter((i) => i >= 0 && i < doc.pages.length);
  if (!pages.length) return [];
  if (req.format === 'pdf') {
    const out = [];
    for (const i of pages) {
      const c = await renderPage(doc, doc.pages[i], { scale: req.scale, token });
      const blob = await toBlob(c, 'image/jpeg', 0.92);
      out.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height });
    }
    const pdf = buildImagePdf(out, name);
    const file = exportFileName(name, 'pdf');
    download(new Blob([pdf as BlobPart], { type: 'application/pdf' }), file);
    return [file];
  }
  const names: string[] = [];
  for (const i of pages) {
    const transparent = req.format === 'png' && req.transparent;
    const c = await renderPage(doc, doc.pages[i], { scale: req.scale, transparent, token });
    const blob = await toBlob(c, req.format === 'jpg' ? 'image/jpeg' : 'image/png', req.format === 'jpg' ? 0.92 : undefined);
    const file = exportFileName(name, req.format, pages.length > 1 ? i + 1 : null);
    download(blob, file);
    names.push(file);
  }
  return names;
}

/** Miniatura de la primera página (JPEG chico en data URL) para la lista. */
export async function thumbnail(doc: DesignDoc): Promise<string | null> {
  try {
    const w = Math.min(480, doc.width);
    const c = await renderPage(doc, doc.pages[0], { width: w });
    const url = c.toDataURL('image/jpeg', 0.72);
    return url.length < 290_000 ? url : c.toDataURL('image/jpeg', 0.5);
  } catch {
    return null;
  }
}

/** Página como PNG en data URL (para mandarla a una pizarra). */
export async function pageDataUrl(doc: DesignDoc, index: number, maxWidth = 1600): Promise<{ dataUrl: string; width: number; height: number }> {
  const scale = Math.min(1, maxWidth / doc.width);
  const c = await renderPage(doc, doc.pages[index], { scale });
  let dataUrl = c.toDataURL('image/png');
  // Board acepta hasta 4 MB por imagen: si el PNG pasa, va en JPEG.
  if (dataUrl.length > 5_000_000) dataUrl = c.toDataURL('image/jpeg', 0.85);
  return { dataUrl, width: c.width, height: c.height };
}
