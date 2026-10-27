import { inflateRawSync } from 'zlib';
import { DOCS_MAX_INDENT, type DocsBlock, type DocsBlockType } from './docs-types';
import { DOCS_IMPORT_MAX_BLOCKS } from './docs-import';

/**
 * Word (.docx) → bloques de Docs, sin dependencias: un .docx es un zip con
 * XML adentro. Se lee el directorio central del zip, se inflan solo las
 * partes que hacen falta (documento, estilos, numeración y links) con tope de
 * tamaño (nada de zip bombs) y el XML se recorre con un tokenizador acotado
 * (sin DTD ni entidades externas). Entra: headings, párrafos, negrita,
 * itálica, subrayado, tachado, links, listas con viñeta o numeradas (con su
 * nivel), citas, tablas e imágenes (con `imageMarkers`: marcadores que el
 * importador sube). Notas al pie y comentarios no se importan.
 * Solo servidor (zlib). El HTML que sale pasa igual por sanitizeBlocks.
 */

/** Tope por parte descomprimida (el documento de un .docx de 4 MB entra holgado). */
const PART_MAX_BYTES = 20 * 1024 * 1024;

export class DocxImportError extends Error {
  constructor(public code: 'invalid_docx') {
    super(code);
  }
}

interface ZipEntry {
  method: number;
  compressedSize: number;
  offset: number;
}

function readZipEntries(buf: Buffer): Map<string, ZipEntry> {
  // End of central directory: está en los últimos 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new DocxImportError('invalid_docx');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipBytes(buf: Buffer, entries: Map<string, ZipEntry>, name: string, max = PART_MAX_BYTES): Buffer | null {
  const e = entries.get(name);
  if (!e) return null;
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) throw new DocxImportError('invalid_docx');
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const data = buf.subarray(start, start + e.compressedSize);
  try {
    if (e.method === 0) return data.length > max ? null : Buffer.from(data);
    if (e.method === 8) return inflateRawSync(data, { maxOutputLength: max });
  } catch {
    throw new DocxImportError('invalid_docx');
  }
  throw new DocxImportError('invalid_docx');
}

function readZipPart(buf: Buffer, entries: Map<string, ZipEntry>, name: string): string | null {
  return readZipBytes(buf, entries, name)?.toString('utf8') ?? null;
}

/** Marcador de una imagen del .docx (párrafo propio); el importador la sube y la cambia por un bloque image. */
export const DOCX_IMAGE_MARKER = 'zsdocximg:';

/**
 * Bytes de una imagen del .docx (`word/media/...`), con tope. null si no está
 * o pasa el tope. El path sale de un marcador de docxToBlocks.
 */
export function readDocxMedia(input: ArrayBuffer | Uint8Array, target: string, maxBytes: number): Buffer | null {
  if (!/^word\/media\/[A-Za-z0-9._-]{1,120}$/.test(target)) return null;
  const buf = Buffer.from(input instanceof Uint8Array ? input : new Uint8Array(input));
  try {
    return readZipBytes(buf, readZipEntries(buf), target, maxBytes);
  } catch {
    return null;
  }
}

/** Relaciones internas a imágenes (rId → word/media/...). */
function parseImageRels(xml: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!xml) return out;
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attrVal(m[1], 'Id');
    const target = attrVal(m[1], 'Target');
    const type = attrVal(m[1], 'Type') ?? '';
    if (!id || !target || /TargetMode="External"/.test(m[1]) || !/\/image$/.test(type)) continue;
    const clean = target.replace(/^\/?(word\/)?/, '');
    if (/^media\/[A-Za-z0-9._-]{1,120}$/.test(clean)) out.set(id, `word/${clean}`);
  }
  return out;
}

function xmlDecode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attrVal(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? xmlDecode(m[1]) : null;
}

/** `<w:b/>` prende; `<w:b w:val="0|false|none"/>` apaga. */
function flagOn(attrs: string): boolean {
  const v = attrVal(attrs, 'w:val');
  return v === null || !/^(0|false|off|none)$/i.test(v);
}

type ParaKind = { type: DocsBlockType; level?: 1 | 2 | 3 } | null;

/** styleId → tipo de bloque, por el nombre canónico del estilo (los ids vienen traducidos). */
function parseStyles(xml: string | null): Map<string, ParaKind> {
  const out = new Map<string, ParaKind>();
  if (!xml) return out;
  for (const m of xml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = attrVal(m[1], 'w:styleId');
    if (!id) continue;
    const name = (/<w:name w:val="([^"]*)"/.exec(m[2])?.[1] ?? '').toLowerCase();
    const outline = /<w:outlineLvl w:val="(\d)"/.exec(m[2])?.[1];
    const heading = /^heading (\d)/.exec(name)?.[1] ?? (outline !== undefined ? String(Number(outline) + 1) : null);
    if (name === 'title') out.set(id, { type: 'heading', level: 1 });
    else if (name === 'subtitle') out.set(id, { type: 'heading', level: 2 });
    else if (heading) out.set(id, { type: 'heading', level: Math.min(3, Math.max(1, Number(heading))) as 1 | 2 | 3 });
    else if (name === 'quote' || name === 'intense quote') out.set(id, { type: 'quote' });
    else if (/^list bullet/.test(name)) out.set(id, { type: 'bulleted_list_item' });
    else if (/^list number/.test(name)) out.set(id, { type: 'numbered_list_item' });
  }
  return out;
}

/** numId → (nivel → numerada o con viñeta). */
function parseNumbering(xml: string | null): (numId: string, ilvl: number) => 'bulleted_list_item' | 'numbered_list_item' {
  const abstract = new Map<string, Map<number, string>>();
  const nums = new Map<string, string>();
  if (xml) {
    for (const m of xml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="([^"]*)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
      const levels = new Map<number, string>();
      for (const l of m[2].matchAll(/<w:lvl\b[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) {
        levels.set(Number(l[1]), /<w:numFmt w:val="([^"]*)"/.exec(l[2])?.[1] ?? 'bullet');
      }
      abstract.set(m[1], levels);
    }
    for (const m of xml.matchAll(/<w:num\b[^>]*w:numId="([^"]*)"[^>]*>([\s\S]*?)<\/w:num>/g)) {
      const a = /<w:abstractNumId w:val="([^"]*)"/.exec(m[2])?.[1];
      if (a) nums.set(m[1], a);
    }
  }
  return (numId, ilvl) => {
    const fmt = abstract.get(nums.get(numId) ?? '')?.get(ilvl) ?? 'bullet';
    return fmt === 'bullet' || fmt === 'none' ? 'bulleted_list_item' : 'numbered_list_item';
  };
}

function parseRels(xml: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!xml) return out;
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attrVal(m[1], 'Id');
    const target = attrVal(m[1], 'Target');
    if (id && target && /TargetMode="External"/.test(m[1]) && /^(https?:|mailto:)/i.test(target)) out.set(id, target);
  }
  return out;
}

export function docxToBlocks(
  input: ArrayBuffer | Uint8Array,
  newId: () => string = () => crypto.randomUUID(),
  opts: { imageMarkers?: boolean } = {},
): DocsBlock[] {
  const buf = Buffer.from(input instanceof Uint8Array ? input : new Uint8Array(input));
  if (buf.length < 22) throw new DocxImportError('invalid_docx');
  const entries = readZipEntries(buf);
  const doc = readZipPart(buf, entries, 'word/document.xml');
  if (!doc) throw new DocxImportError('invalid_docx');
  const styles = parseStyles(readZipPart(buf, entries, 'word/styles.xml'));
  const listType = parseNumbering(readZipPart(buf, entries, 'word/numbering.xml'));
  const relsXml = readZipPart(buf, entries, 'word/_rels/document.xml.rels');
  const rels = parseRels(relsXml);
  const imageRels = opts.imageMarkers ? parseImageRels(relsXml) : new Map<string, string>();
  /** Imágenes del párrafo en curso: van como bloques propios después del texto. */
  let paraImages: string[] = [];

  const out: DocsBlock[] = [];
  const push = (b: Omit<DocsBlock, 'id'>) => {
    if (out.length < DOCS_IMPORT_MAX_BLOCKS) out.push({ id: newId(), ...b });
  };

  // Estado del recorrido.
  let pDepth = 0;
  let para: { style: string | null; numId: string | null; ilvl: number; html: string; text: string } | null = null;
  let inPPr = false;
  let run: { b: boolean; i: boolean; u: boolean; s: boolean; text: string } | null = null;
  let inRPr = false;
  let inT = false;
  let link: string | null = null;
  let linkOpen = false;
  let tableDepth = 0;
  let rows: string[][] = [];
  let row: string[] | null = null;
  let cell: string[] | null = null;

  const flushRun = () => {
    if (!run || !para) return;
    if (run.text) {
      let html = escHtml(run.text);
      if (run.b) html = `<strong>${html}</strong>`;
      if (run.i) html = `<em>${html}</em>`;
      if (run.u) html = `<u>${html}</u>`;
      if (run.s) html = `<s>${html}</s>`;
      para.html += html;
      para.text += run.text;
    }
    run = null;
  };

  const closePara = () => {
    if (!para) return;
    const p = para;
    para = null;
    if (linkOpen) {
      p.html += '</a>';
      linkOpen = false;
    }
    if (tableDepth > 0) {
      if (cell && p.text.trim()) cell.push(p.text.trim());
      return;
    }
    const images = paraImages;
    paraImages = [];
    const html = p.html.replace(/\n/g, '<br>').trim();
    const pushImages = () => {
      for (const target of images) push({ type: 'paragraph', content: `${DOCX_IMAGE_MARKER}${target}` });
    };
    if (!p.text.trim()) {
      pushImages();
      return;
    }
    const kind = p.style ? styles.get(p.style) ?? null : null;
    const indent = Math.min(p.ilvl, DOCS_MAX_INDENT);
    if (p.numId && p.numId !== '0') {
      push({ type: listType(p.numId, p.ilvl), content: html, ...(indent ? { indent } : {}) });
    } else if (kind) {
      push({ type: kind.type, content: html, ...(kind.level ? { level: kind.level } : {}) });
    } else {
      push({ type: 'paragraph', content: html });
    }
    pushImages();
  };

  const re = /<(\/?)([\w:]+)((?:[^>"]|"[^"]*")*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) {
    const [, slash, tag, attrs = '', selfClose, text] = m;
    if (text !== undefined) {
      if (inT && run) run.text += xmlDecode(text);
      continue;
    }
    const closing = slash === '/';
    const empty = selfClose === '/';
    switch (tag) {
      case 'w:tbl':
        if (closing) {
          tableDepth--;
          if (tableDepth === 0) {
            const clean = rows.filter((r) => r.length).slice(0, 200).map((r) => r.slice(0, 20));
            if (clean.length) push({ type: 'table', content: '', rows: clean });
            rows = [];
          }
        } else if (!empty) tableDepth++;
        break;
      case 'w:tr':
        if (tableDepth !== 1) break;
        if (closing) {
          if (row) rows.push(row);
          row = null;
        } else if (!empty) row = [];
        break;
      case 'w:tc':
        if (tableDepth !== 1) break;
        if (closing) {
          if (row && cell) row.push(cell.join(' '));
          cell = null;
        } else if (!empty) cell = [];
        break;
      case 'w:p':
        if (closing) {
          pDepth--;
          if (pDepth === 0) {
            flushRun();
            closePara();
          }
        } else if (empty) {
          // Párrafo vacío: nada que importar.
        } else {
          pDepth++;
          if (pDepth === 1) para = { style: null, numId: null, ilvl: 0, html: '', text: '' };
        }
        break;
      case 'w:pPr':
        inPPr = !closing && !empty;
        break;
      case 'w:pStyle':
        if (inPPr && para && pDepth === 1) para.style = attrVal(attrs, 'w:val');
        break;
      case 'w:ilvl':
        if (inPPr && para) para.ilvl = Number(attrVal(attrs, 'w:val') ?? 0) || 0;
        break;
      case 'w:numId':
        if (inPPr && para) para.numId = attrVal(attrs, 'w:val');
        break;
      case 'w:r':
        if (closing) flushRun();
        else if (!empty && para) run = { b: false, i: false, u: false, s: false, text: '' };
        break;
      case 'w:rPr':
        inRPr = !closing && !empty;
        break;
      case 'w:b':
        if (inRPr && run) run.b = flagOn(attrs);
        break;
      case 'w:i':
        if (inRPr && run) run.i = flagOn(attrs);
        break;
      case 'w:u':
        if (inRPr && run) run.u = flagOn(attrs);
        break;
      case 'w:strike':
      case 'w:dstrike':
        if (inRPr && run) run.s = flagOn(attrs);
        break;
      case 'w:t':
        inT = !closing && !empty;
        break;
      case 'w:tab':
        if (run && !inPPr) run.text += '\t';
        break;
      case 'w:br':
      case 'w:cr':
        if (run && attrVal(attrs, 'w:type') !== 'page') run.text += '\n';
        break;
      case 'a:blip': {
        const target = imageRels.get(attrVal(attrs, 'r:embed') ?? '');
        if (target && para && tableDepth === 0 && paraImages.length < 20) paraImages.push(target);
        break;
      }
      case 'w:hyperlink':
        if (!para) break;
        if (closing) {
          flushRun();
          if (linkOpen) para.html += '</a>';
          linkOpen = false;
          link = null;
        } else if (!empty) {
          link = rels.get(attrVal(attrs, 'r:id') ?? '') ?? null;
          if (link) {
            flushRun();
            para.html += `<a href="${escHtml(link).replace(/"/g, '&quot;')}">`;
            linkOpen = true;
          }
        }
        break;
      default:
        break;
    }
  }
  return out;
}
