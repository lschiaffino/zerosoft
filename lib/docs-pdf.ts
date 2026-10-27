import { deflateSync, inflateSync } from 'zlib';
import type { DocsBlock } from './docs-types';
import { blockIndent, listNumbers } from './docs-blocks';
import { databaseTable } from './docs-database';
import { flattenContainers } from './docs-columns';
import { decodeEntities, inlineHtmlToText } from './docs-markdown';
import { jpegSize } from './pdf-lite';

/**
 * Página de Docs → PDF generado en el servidor (sin navegador ni
 * dependencias). PDF 1.4 con las fuentes estándar (Helvetica y Courier en
 * WinAnsi): texto con negrita, cursiva, código, tachado, subrayado y links
 * clicables; títulos, listas, tareas, citas, callouts, código, tablas, bases
 * (la vista activa), ecuaciones como texto, imágenes JPEG y PNG, divisores y
 * número de página. Los caracteres fuera de Latin-1/WinAnsi (emoji, otros
 * alfabetos) no entran en las fuentes estándar: los emoji se omiten y el
 * resto sale como "?". Para eso queda Imprimir del navegador.
 */

export interface PdfImageData {
  bytes: Buffer;
  mime: string;
}

export interface DocsPdfOptions {
  /** Bytes de la imagen de un bloque (o null si no se pudo leer). */
  imageFor?: (block: DocsBlock) => Promise<PdfImageData | null>;
  /** Link de un archivo (proxy con permisos); null deja solo el nombre. */
  fileHref?: (block: DocsBlock) => string | null;
  /** Texto del pie, a la izquierda del número de página. */
  footer?: string;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = 30;

// ---------- Fuentes y anchos (AFM de Helvetica y Helvetica-Bold, 1/1000 em) ----------

const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELV_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Código de WinAnsi de los caracteres 0x80-0x9F (lo demás de Latin-1 es igual). */
const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

const PICTO = /\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/u;

/** Texto → bytes WinAnsi (string latin1). Emoji fuera; lo que no entra, '?'. */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const cp = ch.codePointAt(0) ?? 63;
    if (cp === 9) out += ' ';
    else if (cp === 10 || cp === 13) out += ' ';
    else if (cp >= 32 && cp < 127) out += ch;
    else if (cp >= 160 && cp <= 255) out += ch;
    else if (WIN_ANSI_EXTRA[cp]) out += String.fromCharCode(WIN_ANSI_EXTRA[cp]);
    else if (cp === 0x2212) out += '-';
    else if (PICTO.test(ch)) continue;
    else if (cp < 32) continue;
    else out += '?';
  }
  return out;
}

/**
 * ¿Hay texto que las fuentes estándar del PDF no pueden mostrar (otros
 * alfabetos)? Los emoji no cuentan (se omiten). El export lo usa para no
 * entregar "???": esa página sale con Imprimir (o en HTML dentro del zip).
 */
export function needsUnicodeFont(title: string, blocks: DocsBlock[]): boolean {
  const texts: string[] = [title];
  for (const b of blocks) {
    texts.push(b.content ?? '', b.caption ?? '', b.name ?? '', b.link?.title ?? '');
    for (const r of b.rows ?? []) texts.push(...r);
  }
  for (const raw of texts) {
    const text = raw.replace(/<[^>]*>/g, '');
    if (!text) continue;
    for (const ch of decodeEntities(text).normalize('NFC')) {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp < 256 || WIN_ANSI_EXTRA[cp] || cp === 0x2212 || PICTO.test(ch)) continue;
      return true;
    }
  }
  return false;
}

type FontKey = 'F1' | 'F2' | 'F3' | 'F4' | 'F5';

function fontFor(style: { bold?: boolean; italic?: boolean; code?: boolean }): FontKey {
  if (style.code) return 'F5';
  if (style.bold && style.italic) return 'F4';
  if (style.bold) return 'F2';
  if (style.italic) return 'F3';
  return 'F1';
}

/** Ancho de un texto (ya en WinAnsi) en puntos. */
export function textWidth(winAnsi: string, font: FontKey, size: number): number {
  if (font === 'F5') return winAnsi.length * 0.6 * size;
  const table = font === 'F2' || font === 'F4' ? HELV_BOLD : HELV;
  let w = 0;
  for (let i = 0; i < winAnsi.length; i++) {
    const c = winAnsi.charCodeAt(i);
    if (c >= 32 && c <= 126) w += table[c - 32];
    else {
      // Acentuadas: el ancho de la letra base; símbolos: uno medio.
      const base = String.fromCharCode(c).normalize('NFD').charCodeAt(0);
      w += base >= 32 && base <= 126 ? table[base - 32] : 556;
    }
  }
  return (w / 1000) * size;
}

function pdfStr(winAnsi: string): string {
  return `(${winAnsi.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

// ---------- Texto en línea ----------

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  underline?: boolean;
  href?: string;
}

/** HTML-lite en línea → tramos con estilo (ecuaciones en línea como su LaTeX). */
export function htmlToRuns(html: string): Run[] {
  const runs: Run[] = [];
  const stack: Array<{ tag: string; href?: string }> = [];
  const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  let texDepth = 0;
  while ((m = re.exec(html ?? ''))) {
    if (m[4] !== undefined) {
      if (texDepth > 0) continue;
      const style: Run = { text: decodeEntities(m[4]) };
      for (const s of stack) {
        if (s.tag === 'strong' || s.tag === 'b') style.bold = true;
        else if (s.tag === 'em' || s.tag === 'i') style.italic = true;
        else if (s.tag === 'code') style.code = true;
        else if (s.tag === 's' || s.tag === 'del' || s.tag === 'strike') style.strike = true;
        else if (s.tag === 'u') style.underline = true;
        else if (s.tag === 'a' && s.href) style.href = s.href;
      }
      runs.push(style);
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'br') {
      runs.push({ text: '\n' });
      continue;
    }
    if (tag === 'span') {
      const tex = /data-tex="([^"]*)"/i.exec(m[3])?.[1];
      if (!closing && tex !== undefined) {
        runs.push({ text: decodeEntities(tex), code: true });
        texDepth++;
        stack.push({ tag: 'tex' });
        continue;
      }
      if (closing) {
        const top = stack.pop();
        if (top?.tag === 'tex') texDepth = Math.max(0, texDepth - 1);
        continue;
      }
      stack.push({ tag: 'span' });
      continue;
    }
    if (closing) {
      const idx = stack.map((s) => s.tag).lastIndexOf(tag);
      if (idx >= 0) stack.splice(idx, 1);
    } else {
      const href = tag === 'a' ? /href="([^"]*)"/i.exec(m[3])?.[1] : undefined;
      stack.push({ tag, href: href ? decodeEntities(href) : undefined });
    }
  }
  return runs;
}

interface Piece {
  text: string;
  font: FontKey;
  size: number;
  width: number;
  run: Run;
  space: boolean;
}

interface Line {
  pieces: Piece[];
  width: number;
}

/** Corta los tramos en líneas que entran en `maxWidth`. */
export function layoutRuns(runs: Run[], size: number, maxWidth: number, base: { bold?: boolean; italic?: boolean; code?: boolean } = {}): Line[] {
  const lines: Line[] = [{ pieces: [], width: 0 }];
  const cur = () => lines[lines.length - 1];
  for (const run of runs) {
    const style = { bold: base.bold || run.bold, italic: base.italic || run.italic, code: base.code || run.code };
    const font = fontFor(style);
    const parts = run.text.split(/(\n|\s+)/);
    for (const raw of parts) {
      if (raw === '') continue;
      if (raw === '\n') {
        lines.push({ pieces: [], width: 0 });
        continue;
      }
      const space = /^\s+$/.test(raw);
      const text = toWinAnsi(space ? ' ' : raw);
      if (!text) continue;
      let width = textWidth(text, font, size);
      if (space) {
        if (cur().pieces.length === 0) continue;
        cur().pieces.push({ text, font, size, width, run, space: true });
        cur().width += width;
        continue;
      }
      if (cur().width + width > maxWidth && cur().pieces.length > 0) {
        // Sin el espacio del final.
        const last = cur().pieces[cur().pieces.length - 1];
        if (last?.space) {
          cur().pieces.pop();
          cur().width -= last.width;
        }
        lines.push({ pieces: [], width: 0 });
      }
      // Una palabra más larga que la línea: se parte por caracteres.
      let rest = text;
      while (width > maxWidth && rest.length > 1) {
        let n = rest.length;
        while (n > 1 && textWidth(rest.slice(0, n), font, size) > maxWidth - cur().width) n--;
        const head = rest.slice(0, n);
        const hw = textWidth(head, font, size);
        cur().pieces.push({ text: head, font, size, width: hw, run, space: false });
        cur().width += hw;
        lines.push({ pieces: [], width: 0 });
        rest = rest.slice(n);
        width = textWidth(rest, font, size);
      }
      cur().pieces.push({ text: rest, font, size, width, run, space: false });
      cur().width += width;
    }
  }
  return lines.filter((l, i) => l.pieces.length > 0 || i < lines.length - 1 || lines.length === 1);
}

// ---------- Imágenes ----------

interface PdfImageObj {
  width: number;
  height: number;
  /** Diccionario + stream del XObject (sin el número de objeto). */
  dict: string;
  data: Buffer;
  smask?: { dict: string; data: Buffer };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Deshace los filtros de PNG (8 bits por canal, sin entrelazado). */
function unfilterPng(raw: Buffer, width: number, height: number, bpp: number): Buffer {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[p++] ?? 0;
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0;
      let r = v;
      if (filter === 1) r = v + a;
      else if (filter === 2) r = v + b;
      else if (filter === 3) r = v + ((a + b) >> 1);
      else if (filter === 4) r = v + paeth(a, b, c);
      out[row + x] = r & 0xff;
    }
  }
  return out;
}

/** JPEG o PNG → XObject de imagen. null si el formato no se puede embeber. */
export function pdfImage(bytes: Buffer, mime: string): PdfImageObj | null {
  if (/jpe?g/i.test(mime) || (bytes[0] === 0xff && bytes[1] === 0xd8)) {
    const size = jpegSize(bytes);
    if (!size) return null;
    // Componentes: SOF trae 1 (gris), 3 (RGB) o 4 (CMYK).
    const comps = jpegComponents(bytes);
    const cs = comps === 1 ? '/DeviceGray' : comps === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    const decode = comps === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
    return {
      width: size.width,
      height: size.height,
      dict: `/Type /XObject /Subtype /Image /Width ${size.width} /Height ${size.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode${decode}`,
      data: bytes,
    };
  }
  if (bytes.length < 33 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let color = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  const idat: Buffer[] = [];
  while (off + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(off);
    const type = bytes.toString('latin1', off + 4, off + 8);
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      color = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!width || !height || depth !== 8 || interlace !== 0 || width * height > 25_000_000) return null;
  const compressed = Buffer.concat(idat);
  if (color === 2 || color === 0 || color === 3) {
    const colors = color === 2 ? 3 : 1;
    let cs = color === 2 ? '/DeviceRGB' : '/DeviceGray';
    if (color === 3) {
      if (!palette) return null;
      cs = `[/Indexed /DeviceRGB ${palette.length / 3 - 1} <${palette.toString('hex')}>]`;
    }
    return {
      width,
      height,
      dict: `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${colors} /BitsPerComponent 8 /Columns ${width} >>`,
      data: compressed,
    };
  }
  if (color === 6 || color === 4) {
    const bpp = color === 6 ? 4 : 2;
    let raw: Buffer;
    try {
      raw = unfilterPng(inflateSync(compressed, { maxOutputLength: (width * bpp + 1) * height + 16 }), width, height, bpp);
    } catch {
      return null;
    }
    const channels = bpp - 1;
    const rgb = Buffer.alloc(width * height * channels);
    const alpha = Buffer.alloc(width * height);
    for (let i = 0, j = 0, k = 0; i < raw.length; i += bpp) {
      for (let c = 0; c < channels; c++) rgb[j++] = raw[i + c];
      alpha[k++] = raw[i + channels];
    }
    return {
      width,
      height,
      dict: `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${channels === 3 ? '/DeviceRGB' : '/DeviceGray'} /BitsPerComponent 8 /Filter /FlateDecode`,
      data: deflateSync(rgb),
      smask: {
        dict: `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
        data: deflateSync(alpha),
      },
    };
  }
  return null;
}

function jpegComponents(buf: Buffer): number {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return buf[i + 9];
    }
    i += 2 + len;
  }
  return 3;
}

// ---------- Armado ----------

interface PageOut {
  ops: string[];
  links: Array<{ x: number; y: number; w: number; h: number; href: string }>;
  images: Set<number>;
}

class Writer {
  pages: PageOut[] = [];
  y = PAGE_H - MARGIN;
  images: PdfImageObj[] = [];

  constructor() {
    this.newPage();
  }

  get page(): PageOut {
    return this.pages[this.pages.length - 1];
  }

  newPage() {
    this.pages.push({ ops: [], links: [], images: new Set() });
    this.y = PAGE_H - MARGIN;
  }

  /** Asegura `h` puntos libres; si no, página nueva. */
  ensure(h: number) {
    if (this.y - h < MARGIN && this.y < PAGE_H - MARGIN - 1) this.newPage();
  }

  rect(x: number, y: number, w: number, h: number, gray: number, stroke = false) {
    this.page.ops.push(stroke ? `q ${gray.toFixed(2)} G 0.6 w ${f(x)} ${f(y)} ${f(w)} ${f(h)} re S Q` : `q ${gray.toFixed(2)} g ${f(x)} ${f(y)} ${f(w)} ${f(h)} re f Q`);
  }

  line(x1: number, y1: number, x2: number, y2: number, gray = 0.8, width = 0.6) {
    this.page.ops.push(`q ${gray.toFixed(2)} G ${width} w ${f(x1)} ${f(y1)} m ${f(x2)} ${f(y2)} l S Q`);
  }

  /** Dibuja líneas ya armadas desde x; devuelve el alto usado. */
  drawLines(lines: Line[], x: number, size: number, opts: { lead?: number; gray?: number; maxWidth?: number } = {}) {
    const lead = opts.lead ?? size * 1.45;
    for (const l of lines) {
      this.ensure(lead);
      this.y -= lead;
      let cx = x;
      for (const p of l.pieces) {
        const linkGray = p.run.href ? null : opts.gray ?? 0;
        if (p.run.code && !p.space) this.rect(cx - 1, this.y - size * 0.22, p.width + 2, size * 1.12, 0.94);
        const color = p.run.href ? '0.12 0.37 0.75 rg' : `${(linkGray ?? 0).toFixed(2)} g`;
        this.page.ops.push(`BT /${p.font} ${p.size} Tf ${color} ${f(cx)} ${f(this.y)} Td ${pdfStr(p.text)} Tj ET`);
        if (p.run.underline || p.run.href) this.line(cx, this.y - 1.5, cx + p.width, this.y - 1.5, p.run.href ? 0.55 : 0.2, 0.5);
        if (p.run.strike) this.line(cx, this.y + size * 0.3, cx + p.width, this.y + size * 0.3, 0.2, 0.6);
        if (p.run.href && /^(https?:|mailto:)/i.test(p.run.href)) this.page.links.push({ x: cx, y: this.y - 2, w: p.width, h: size + 2, href: p.run.href });
        cx += p.width;
      }
    }
  }
}

function f(n: number): string {
  return n.toFixed(2);
}

const BODY = 10.5;

export async function blocksToPdf(input: DocsBlock[], title: string, opts: DocsPdfOptions = {}): Promise<Buffer> {
  const blocks = flattenContainers(input);
  const numbers = listNumbers(blocks);
  const w = new Writer();

  // Título.
  const t = title.trim() || 'Untitled';
  const titleLines = layoutRuns([{ text: t }], 22, CONTENT_W, { bold: true });
  w.drawLines(titleLines, MARGIN, 22, { lead: 28 });
  w.y -= 14;

  for (const [i, b] of blocks.entries()) {
    const d = blockIndent(b);
    const x = MARGIN + d * 18;
    const width = CONTENT_W - d * 18;
    switch (b.type) {
      case 'heading': {
        const size = b.level === 3 ? 12 : b.level === 2 ? 13.5 : 16;
        const lines = layoutRuns(htmlToRuns(b.content), size, width, { bold: true });
        w.ensure(size * 3);
        w.y -= size * 0.7;
        w.drawLines(lines, x, size, { lead: size * 1.35 });
        w.y -= 3;
        break;
      }
      case 'bulleted_list_item':
      case 'numbered_list_item':
      case 'todo':
      case 'toggle': {
        const lines = layoutRuns(htmlToRuns(b.content), BODY, width - 16);
        w.ensure(BODY * 1.6);
        const markerY = w.y - BODY * 1.45;
        if (b.type === 'todo') {
          w.rect(x + 1, markerY - 1, 8, 8, 0.35, true);
          if (b.checked) w.page.ops.push(`q 0.15 G 1 w ${f(x + 2.5)} ${f(markerY + 3)} m ${f(x + 4.5)} ${f(markerY + 0.8)} l ${f(x + 8)} ${f(markerY + 6)} l S Q`);
        } else {
          const marker = b.type === 'numbered_list_item' ? `${numbers[i] || 1}.` : b.type === 'toggle' ? '>' : '\x95';
          w.page.ops.push(`BT /F1 ${BODY} Tf 0 g ${f(x)} ${f(markerY)} Td ${pdfStr(marker)} Tj ET`);
        }
        w.drawLines(lines, x + 16, BODY, { gray: b.type === 'todo' && b.checked ? 0.45 : 0 });
        w.y -= 2;
        break;
      }
      case 'quote':
      case 'callout': {
        const lines = layoutRuns(htmlToRuns(b.content), BODY, width - 24);
        const h = lines.length * BODY * 1.45 + (b.type === 'callout' ? 12 : 4);
        w.ensure(Math.min(h, PAGE_H - MARGIN * 2));
        const top = w.y;
        if (b.type === 'callout') {
          w.rect(x, top - h - 2, width, h, 0.95);
          w.y -= 6;
          w.drawLines(lines, x + 12, BODY);
          w.y -= 8;
        } else {
          w.y -= 2;
          w.drawLines(lines, x + 12, BODY);
          w.line(x + 2, top - 2, x + 2, Math.max(w.y - 2, MARGIN), 0.15, 2);
          w.y -= 4;
        }
        break;
      }
      case 'code':
      case 'equation': {
        const size = 9;
        const text = inlineHtmlToText(b.content);
        const lines = text.split('\n').flatMap((l) => layoutRuns([{ text: l || ' ', code: true }], size, width - 16, { code: true }));
        const lead = size * 1.4;
        w.y -= 4;
        let k = 0;
        while (k < lines.length) {
          w.ensure(lead + 8);
          const room = Math.max(1, Math.floor((w.y - MARGIN - 8) / lead));
          const chunk = lines.slice(k, k + room);
          const h = chunk.length * lead + 10;
          w.rect(x, w.y - h, width, h, 0.95);
          w.y -= 4;
          for (const l of chunk) {
            w.y -= lead;
            let cx = x + 8;
            for (const p of l.pieces) {
              w.page.ops.push(`BT /F5 ${size} Tf 0.1 g ${f(cx)} ${f(w.y)} Td ${pdfStr(p.text)} Tj ET`);
              cx += p.width;
            }
          }
          w.y -= 6;
          k += chunk.length;
          if (k < lines.length) w.newPage();
        }
        w.y -= 4;
        break;
      }
      case 'divider':
        w.ensure(14);
        w.y -= 8;
        w.line(x, w.y, x + width, w.y, 0.8);
        w.y -= 6;
        break;
      case 'image': {
        const data = opts.imageFor ? await opts.imageFor(b).catch(() => null) : null;
        const img = data ? pdfImage(data.bytes, data.mime) : null;
        if (img) {
          const pct = Math.min(100, Math.max(10, Number(b.width) || 100)) / 100;
          let dw = Math.min(width * pct, (img.width * 72) / 96);
          let dh = (dw * img.height) / img.width;
          const maxH = PAGE_H - MARGIN * 2 - 20;
          if (dh > maxH) {
            dh = maxH;
            dw = (dh * img.width) / img.height;
          }
          w.ensure(dh + 8);
          w.y -= dh + 6;
          const idx = w.images.push(img) - 1;
          const ix = b.align === 'right' ? x + width - dw : b.align === 'left' ? x : x + (width - dw) / 2;
          w.page.images.add(idx);
          w.page.ops.push(`q ${f(dw)} 0 0 ${f(dh)} ${f(ix)} ${f(w.y)} cm /Im${idx} Do Q`);
        } else {
          w.drawLines(layoutRuns([{ text: b.name || 'image', italic: true }], BODY, width), x, BODY, { gray: 0.4 });
        }
        if (b.caption) w.drawLines(layoutRuns(htmlToRuns(b.caption), 9, width), x, 9, { gray: 0.4 });
        w.y -= 4;
        break;
      }
      case 'file':
      case 'video':
      case 'audio':
      case 'pdf': {
        const href = opts.fileHref?.(b) ?? undefined;
        w.drawLines(layoutRuns([{ text: `[${b.name || 'file'}]`, href }], BODY, width), x, BODY);
        if (b.caption) w.drawLines(layoutRuns(htmlToRuns(b.caption), 9, width), x, 9, { gray: 0.4 });
        break;
      }
      case 'bookmark':
      case 'embed': {
        const url = b.link?.url;
        if (!url) break;
        const runs: Run[] = [{ text: b.link?.title || url, href: url, bold: Boolean(b.link?.title) }];
        if (b.link?.title) runs.push({ text: '\n' }, { text: url, href: url });
        w.drawLines(layoutRuns(runs, BODY, width), x, BODY);
        w.y -= 2;
        break;
      }
      case 'button':
        if (b.button?.action === 'link' && b.button.url) w.drawLines(layoutRuns([{ text: b.button.label || b.button.url, href: b.button.url }], BODY, width), x, BODY);
        break;
      case 'table':
      case 'database': {
        let header: string[];
        let rows: string[][];
        if (b.type === 'table') {
          const all = (b.rows ?? []).map((r) => r.map((c) => inlineHtmlToText(c ?? '')));
          header = all[0] ?? [];
          rows = all.slice(1);
        } else {
          const tbl = databaseTable(b);
          header = tbl.header;
          rows = tbl.rows;
          if (b.db?.title) {
            w.y -= 4;
            w.drawLines(layoutRuns([{ text: b.db.title, bold: true }], 11, width), x, 11);
          }
        }
        drawTable(w, header, rows, x, width);
        break;
      }
      case 'toc':
      case 'breadcrumb':
      case 'board':
        break;
      default: {
        const runs = htmlToRuns(b.content);
        if (!runs.some((r) => r.text.trim())) {
          w.y -= BODY * 0.9;
          break;
        }
        w.drawLines(layoutRuns(runs, BODY, width), x, BODY);
        w.y -= 3;
      }
    }
  }

  // Pie: número de página.
  const total = w.pages.length;
  w.pages.forEach((p, i) => {
    const label = toWinAnsi(`${i + 1} / ${total}`);
    const lw = textWidth(label, 'F1', 8);
    p.ops.push(`BT /F1 8 Tf 0.55 g ${f(PAGE_W - MARGIN - lw)} ${FOOTER_Y} Td ${pdfStr(label)} Tj ET`);
    if (opts.footer) p.ops.push(`BT /F1 8 Tf 0.55 g ${MARGIN} ${FOOTER_Y} Td ${pdfStr(toWinAnsi(opts.footer.slice(0, 90)))} Tj ET`);
  });
  return serialize(w, t);
}

function drawTable(w: Writer, header: string[], rows: string[][], x: number, width: number) {
  const cols = Math.max(header.length, ...rows.map((r) => r.length), 1);
  const colW = width / cols;
  const size = 8.5;
  const lead = size * 1.35;
  const drawRow = (cells: string[], bold: boolean) => {
    const laid = Array.from({ length: cols }, (_, c) => layoutRuns([{ text: cells[c] ?? '' }], size, colW - 8, { bold }).slice(0, 12));
    const h = Math.max(1, ...laid.map((l) => l.length)) * lead + 6;
    w.ensure(h);
    const top = w.y;
    if (bold) w.rect(x, top - h, width, h, 0.95);
    laid.forEach((lines, c) => {
      let y = top - 3;
      for (const l of lines) {
        y -= lead;
        let cx = x + c * colW + 4;
        for (const p of l.pieces) {
          w.page.ops.push(`BT /${p.font} ${size} Tf 0 g ${f(cx)} ${f(y + 2)} Td ${pdfStr(p.text)} Tj ET`);
          cx += p.width;
        }
      }
    });
    for (let c = 0; c <= cols; c++) w.line(x + c * colW, top, x + c * colW, top - h, 0.82, 0.5);
    w.line(x, top, x + width, top, 0.82, 0.5);
    w.line(x, top - h, x + width, top - h, 0.82, 0.5);
    w.y = top - h;
  };
  w.y -= 4;
  if (header.length) drawRow(header, true);
  for (const r of rows.slice(0, 2000)) drawRow(r, false);
  w.y -= 6;
}

function serialize(w: Writer, title: string): Buffer {
  const objects: Array<Buffer> = [];
  const add = (body: string | Buffer): number => {
    objects.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body);
    return objects.length;
  };
  const stream = (dict: string, data: Buffer) =>
    Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);

  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES'); // 2: se completa al final
  const fonts = {
    F1: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    F2: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
    F3: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>'),
    F4: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>'),
    F5: add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'),
  };
  const imageIds = w.images.map((img) => {
    const smaskId = img.smask ? add(stream(img.smask.dict, img.smask.data)) : null;
    return add(stream(`${img.dict}${smaskId ? ` /SMask ${smaskId} 0 R` : ''}`, img.data));
  });
  const fontRes = `/Font << ${Object.entries(fonts)
    .map(([k, id]) => `/${k} ${id} 0 R`)
    .join(' ')} >>`;
  const pageIds: number[] = [];
  for (const p of w.pages) {
    const content = Buffer.from(p.ops.join('\n'), 'latin1');
    const contentId = add(stream('/Filter /FlateDecode', deflateSync(content)));
    const annots = p.links.map((l) =>
      add(
        `<< /Type /Annot /Subtype /Link /Rect [${f(l.x)} ${f(l.y)} ${f(l.x + l.w)} ${f(l.y + l.h)}] /Border [0 0 0] /A << /S /URI /URI ${pdfStr(toWinAnsi(l.href).slice(0, 2000))} >> >>`,
      ),
    );
    const xobj = [...p.images].map((i) => `/Im${i} ${imageIds[i]} 0 R`).join(' ');
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << ${fontRes}${xobj ? ` /XObject << ${xobj} >>` : ''} >> /Contents ${contentId} 0 R${
          annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(' ')}]` : ''
        } >>`,
      ),
    );
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`, 'latin1');
  const info = add(`<< /Title ${pdfStr(toWinAnsi(title).slice(0, 300))} /Producer (zerosoft Docs) >>`);

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = chunks[0].length;
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(offset);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), obj, Buffer.from('\nendobj\n', 'latin1')]);
    chunks.push(chunk);
    offset += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}
