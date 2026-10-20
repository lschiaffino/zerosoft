/**
 * Notes — importar ENEX (Evernote) y Markdown a bloques de Docs. Puro: no
 * toca la DB ni el storage (los adjuntos del ENEX los sube quien llama, con
 * el callback `upload`). El resultado pasa igual por sanitizeBlocks al
 * guardarse (lib/notes.ts → createNote).
 *
 * El XML se lee con lib/xml-lite.ts: sin entidades externas ni DOCTYPE
 * (nada de XXE) y con topes de tamaño, profundidad y nodos.
 */
import { createHash } from 'crypto';
import { marked, type Token, type Tokens } from 'marked';
import type { DocsBlock } from './docs-types';
import { cleanFileName, isInlineImageMime } from './docs-files';
import { sanitizeDocsHtml } from './docs-sanitize';
import {
  childElements,
  findElement,
  firstChild,
  isElement,
  parseXml,
  textContent,
  type XmlElement,
  type XmlNode,
} from './xml-lite';

/** Tope por archivo importado (mismo que un adjunto). */
export const NOTES_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const NOTES_IMPORT_MAX_FILES = 20;
/** Notas por ENEX y bloques por nota (el editor acepta hasta 2000). */
export const NOTES_IMPORT_MAX_NOTES = 500;
export const NOTES_IMPORT_MAX_BLOCKS = 2000;
/** Adjuntos por importación (cada uno con el tope de lib/uploads.ts). */
export const NOTES_IMPORT_MAX_RESOURCES = 100;

export interface ImportedNote {
  title: string;
  blocks: DocsBlock[];
  tags: string[];
  sourceUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface EnexResource {
  hash: string;
  mime: string;
  name: string;
  data: Buffer;
}

/** Lo que devuelve la subida de un adjunto (null = no se pudo, queda el nombre). */
export interface UploadedResource {
  url: string;
  name: string;
  size: number;
  mime: string;
}

const newId = () => crypto.randomUUID();

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(text: string): string {
  return esc(text).replace(/"/g, '&quot;');
}

/** Fecha ENEX (20240131T101500Z) → ISO, o null. */
export function parseEnexDate(raw: string): string | null {
  const v = raw.trim();
  if (v.length !== 16 || v[8] !== 'T' || v[15] !== 'Z') return null;
  const n = (a: number, b: number) => Number(v.slice(a, b));
  const d = new Date(Date.UTC(n(0, 4), n(4, 6) - 1, n(6, 8), n(9, 11), n(11, 13), n(13, 15)));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function safeHttpUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v || v.length > 2000) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

// ---------- ENML → bloques ----------

const BLOCK_TAGS = new Set([
  'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'table',
  'en-media', 'section', 'article', 'header', 'footer', 'center', 'dl', 'dt', 'dd', 'address', 'figure',
]);

const INLINE_MARK: Record<string, string> = {
  b: 'strong',
  strong: 'strong',
  i: 'em',
  em: 'em',
  u: 'u',
  s: 's',
  strike: 's',
  del: 's',
  code: 'code',
  tt: 'code',
};

function hasBlockChild(el: XmlElement): boolean {
  return el.children.some((c) => isElement(c) && BLOCK_TAGS.has(c.name));
}

function isCodeBlockDiv(el: XmlElement): boolean {
  const style = (el.attrs.style ?? '').toLowerCase();
  return style.includes('-en-codeblock');
}

/** Inline ENML → HTML-lite (se vuelve a sanitizar al final). */
function inlineHtml(nodes: XmlNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (typeof n === 'string') {
      out += esc(n.replace(/[\r\n\t]+/g, ' '));
      continue;
    }
    if (n.name === 'br') {
      out += '<br>';
      continue;
    }
    if (n.name === 'en-todo' || n.name === 'en-crypt' || n.name === 'img') continue;
    const mark = INLINE_MARK[n.name];
    const inner = inlineHtml(n.children);
    if (mark) out += inner ? `<${mark}>${inner}</${mark}>` : '';
    else if (n.name === 'a') {
      const href = n.attrs.href ?? '';
      out += /^(https?:|mailto:|tel:)/i.test(href) ? `<a href="${escAttr(href)}">${inner}</a>` : inner;
    } else out += inner;
  }
  return out;
}

/** Texto plano preservando saltos (bloques de código). */
function codeText(el: XmlElement): string {
  const lines: string[] = [];
  let cur = '';
  const walk = (nodes: XmlNode[]) => {
    for (const n of nodes) {
      if (typeof n === 'string') cur += n;
      else if (n.name === 'br') {
        lines.push(cur);
        cur = '';
      } else if (n.name === 'div' || n.name === 'p') {
        if (cur) lines.push(cur);
        cur = '';
        walk(n.children);
        lines.push(cur);
        cur = '';
      } else walk(n.children);
    }
  };
  walk(el.children);
  if (cur) lines.push(cur);
  return lines.join('\n').replace(/\n+$/, '');
}

function trimBr(html: string): string {
  let out = html.trim();
  while (out.endsWith('<br>')) out = out.slice(0, -4).trimEnd();
  while (out.startsWith('<br>')) out = out.slice(4).trimStart();
  return out;
}

interface EnmlContext {
  media: (hash: string) => DocsBlock | null;
  out: DocsBlock[];
}

function pushBlock(ctx: EnmlContext, block: Omit<DocsBlock, 'id'>): void {
  if (ctx.out.length >= NOTES_IMPORT_MAX_BLOCKS) return;
  ctx.out.push({ id: newId(), ...block });
}

/**
 * Recorre un contenedor: el texto en línea se junta en un párrafo (o tarea,
 * si arranca con <en-todo>) y cada hijo de bloque corta el párrafo.
 */
function walkContainer(el: XmlElement, ctx: EnmlContext, as: 'paragraph' | 'quote' = 'paragraph'): void {
  let inline: XmlNode[] = [];
  let todo: boolean | null = null;
  const flush = () => {
    const html = trimBr(inlineHtml(inline));
    const kind = todo !== null ? 'todo' : as;
    if (html || todo !== null) {
      pushBlock(ctx, kind === 'todo' ? { type: 'todo', content: html, checked: todo === true } : { type: kind, content: html });
    }
    inline = [];
    todo = null;
  };
  for (const child of el.children) {
    if (!isElement(child) || (!BLOCK_TAGS.has(child.name) && child.name !== 'en-todo')) {
      // Un span/font con divs adentro se trata como contenedor.
      if (isElement(child) && hasBlockChild(child)) {
        flush();
        walkContainer(child, ctx, as);
      } else inline.push(child);
      continue;
    }
    if (child.name === 'en-todo') {
      if (inline.some((n) => (typeof n === 'string' ? n.trim() : true))) flush();
      todo = (child.attrs.checked ?? '').toLowerCase() === 'true';
      continue;
    }
    flush();
    walkBlock(child, ctx, as);
  }
  flush();
}

function walkList(el: XmlElement, ctx: EnmlContext, ordered: boolean): void {
  for (const li of childElements(el)) {
    if (li.name === 'ul' || li.name === 'ol') {
      walkList(li, ctx, li.name === 'ol');
      continue;
    }
    const nested = li.children.filter((c): c is XmlElement => isElement(c) && (c.name === 'ul' || c.name === 'ol'));
    const own = li.children.filter((c) => !(isElement(c) && (c.name === 'ul' || c.name === 'ol')));
    const todoEl = own.find((c): c is XmlElement => isElement(c) && c.name === 'en-todo');
    const html = trimBr(inlineHtml(own.flatMap((c) => (isElement(c) && BLOCK_TAGS.has(c.name) ? c.children : [c]))));
    if (todoEl) pushBlock(ctx, { type: 'todo', content: html, checked: (todoEl.attrs.checked ?? '').toLowerCase() === 'true' });
    else if (html) pushBlock(ctx, { type: ordered ? 'numbered_list_item' : 'bulleted_list_item', content: html });
    for (const n of nested) walkList(n, ctx, n.name === 'ol');
  }
}

function walkBlock(el: XmlElement, ctx: EnmlContext, as: 'paragraph' | 'quote'): void {
  switch (el.name) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Math.min(Number(el.name[1]), 3) as 1 | 2 | 3;
      const html = trimBr(inlineHtml(el.children));
      if (html) pushBlock(ctx, { type: 'heading', level, content: html });
      return;
    }
    case 'ul':
    case 'ol':
      walkList(el, ctx, el.name === 'ol');
      return;
    case 'li':
      walkList({ name: 'ul', attrs: {}, children: [el] }, ctx, false);
      return;
    case 'blockquote':
      walkContainer(el, ctx, 'quote');
      return;
    case 'pre': {
      const text = codeText(el);
      if (text.trim()) pushBlock(ctx, { type: 'code', content: esc(text) });
      return;
    }
    case 'hr':
      pushBlock(ctx, { type: 'divider', content: '' });
      return;
    case 'table': {
      const rows: string[][] = [];
      const collect = (node: XmlElement) => {
        for (const c of childElements(node)) {
          if (c.name === 'tr') {
            rows.push(childElements(c).filter((td) => td.name === 'td' || td.name === 'th').map((td) => textContent(td).replace(/\s+/g, ' ').trim()));
          } else if (c.name === 'thead' || c.name === 'tbody' || c.name === 'tfoot') collect(c);
        }
      };
      collect(el);
      const width = Math.max(1, ...rows.map((r) => r.length));
      const clean = rows.slice(0, 200).map((r) => Array.from({ length: Math.min(width, 20) }, (_, i) => r[i] ?? ''));
      if (clean.length) pushBlock(ctx, { type: 'table', content: '', rows: clean });
      return;
    }
    case 'en-media': {
      const block = ctx.media((el.attrs.hash ?? '').toLowerCase());
      if (block && ctx.out.length < NOTES_IMPORT_MAX_BLOCKS) ctx.out.push(block);
      return;
    }
    default:
      if (el.name === 'div' && isCodeBlockDiv(el)) {
        const text = codeText(el);
        if (text.trim()) pushBlock(ctx, { type: 'code', content: esc(text) });
        return;
      }
      walkContainer(el, ctx, as);
  }
}

/** <en-note> → bloques. `media(hash)` da el bloque de un adjunto (o null). */
export function enmlToBlocks(enNote: XmlElement, media: (hash: string) => DocsBlock | null = () => null): DocsBlock[] {
  const ctx: EnmlContext = { media, out: [] };
  walkContainer(enNote, ctx);
  return ctx.out.map((b) => ({ ...b, content: sanitizeDocsHtml(b.content) }));
}

// ---------- ENEX ----------

export interface ParsedEnexNote {
  title: string;
  enNote: XmlElement | null;
  tags: string[];
  sourceUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  resources: EnexResource[];
}

export class NotesImportError extends Error {
  constructor(public code: 'invalid_enex' | 'too_large' | 'too_many_notes') {
    super(code);
  }
}

function decodeBase64(raw: string): Buffer {
  // Sin regex sobre datos grandes: se descartan blancos a mano.
  let clean = '';
  for (const c of raw) if (c !== '\n' && c !== '\r' && c !== ' ' && c !== '\t') clean += c;
  return Buffer.from(clean, 'base64');
}

/** ENEX → notas con su ENML ya parseado y los adjuntos decodificados. */
export function parseEnex(xml: string): ParsedEnexNote[] {
  if (xml.length > NOTES_IMPORT_MAX_BYTES * 1.5) throw new NotesImportError('too_large');
  let doc: XmlElement;
  try {
    doc = parseXml(xml, { maxDepth: 64, maxNodes: 200_000 });
  } catch {
    throw new NotesImportError('invalid_enex');
  }
  const root = firstChild(doc, 'en-export');
  if (!root) throw new NotesImportError('invalid_enex');
  const notes = childElements(root, 'note');
  if (notes.length > NOTES_IMPORT_MAX_NOTES) throw new NotesImportError('too_many_notes');
  let resourceCount = 0;
  return notes.map((note) => {
    const contentRaw = textContent(firstChild(note, 'content'));
    let enNote: XmlElement | null = null;
    if (contentRaw.trim()) {
      try {
        enNote = findElement(parseXml(contentRaw, { maxDepth: 128, maxNodes: 100_000 }), 'en-note') ?? null;
      } catch {
        enNote = null;
      }
    }
    const attrs = firstChild(note, 'note-attributes');
    const resources: EnexResource[] = [];
    for (const r of childElements(note, 'resource')) {
      if (resourceCount >= NOTES_IMPORT_MAX_RESOURCES) break;
      const dataEl = firstChild(r, 'data');
      if (!dataEl) continue;
      const data = decodeBase64(textContent(dataEl));
      if (data.length === 0 || data.length > NOTES_IMPORT_MAX_BYTES) continue;
      resourceCount++;
      const mime = textContent(firstChild(r, 'mime')).trim().toLowerCase() || 'application/octet-stream';
      const ra = firstChild(r, 'resource-attributes');
      const name = cleanFileName(textContent(ra ? firstChild(ra, 'file-name') : undefined)) || 'attachment';
      resources.push({ hash: createHash('md5').update(data).digest('hex'), mime, name, data });
    }
    return {
      title: textContent(firstChild(note, 'title')).trim().slice(0, 300),
      enNote,
      tags: childElements(note, 'tag').map((t) => textContent(t).trim()).filter(Boolean),
      sourceUrl: safeHttpUrl(textContent(attrs ? firstChild(attrs, 'source-url') : undefined)),
      createdAt: parseEnexDate(textContent(firstChild(note, 'created'))),
      updatedAt: parseEnexDate(textContent(firstChild(note, 'updated'))),
      resources,
    };
  });
}

/** Bloque image/file para un adjunto ya subido. */
export function resourceBlock(up: UploadedResource): DocsBlock {
  return {
    id: newId(),
    type: isInlineImageMime(up.mime) ? 'image' : 'file',
    content: '',
    url: up.url,
    name: up.name,
    size: up.size,
    mime: up.mime,
  };
}

/**
 * Notas de un ENEX con sus adjuntos subidos: cada <en-media> se reemplaza por
 * su bloque y los adjuntos que no aparecen en el texto van al final.
 */
export async function enexToNotes(
  xml: string,
  upload: (res: EnexResource) => Promise<UploadedResource | null>,
): Promise<ImportedNote[]> {
  const parsed = parseEnex(xml);
  const out: ImportedNote[] = [];
  for (const n of parsed) {
    const byHash = new Map<string, UploadedResource | null>();
    for (const r of n.resources) {
      if (!byHash.has(r.hash)) byHash.set(r.hash, await upload(r));
    }
    const used = new Set<string>();
    const media = (hash: string): DocsBlock | null => {
      const up = byHash.get(hash);
      if (!up) return null;
      used.add(hash);
      return resourceBlock(up);
    };
    const blocks = n.enNote ? enmlToBlocks(n.enNote, media) : [];
    for (const [hash, up] of byHash) {
      if (up && !used.has(hash) && blocks.length < NOTES_IMPORT_MAX_BLOCKS) blocks.push(resourceBlock(up));
    }
    out.push({
      title: n.title,
      blocks,
      tags: n.tags,
      sourceUrl: n.sourceUrl,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    });
  }
  return out;
}

// ---------- Markdown ----------

/** Inline Markdown → HTML-lite (las imágenes quedan como link: no se descargan). */
function mdInline(text: string): string {
  const html = marked.parseInline(text, { async: false, gfm: true }) as string;
  const withLinks = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\bsrc="([^"]*)"/i.exec(tag)?.[1] ?? '';
    const alt = /\balt="([^"]*)"/i.exec(tag)?.[1] ?? '';
    return src ? `<a href="${src}">${alt || src}</a>` : alt;
  });
  return sanitizeDocsHtml(withLinks.replace(/\n/g, '<br>')).trim();
}

function itemText(item: Tokens.ListItem): string {
  const first = item.tokens.find((t) => t.type === 'text' || t.type === 'paragraph') as Tokens.Text | Tokens.Paragraph | undefined;
  return first ? first.text : '';
}

function mdTokens(tokens: Token[], out: DocsBlock[], as: 'paragraph' | 'quote' = 'paragraph'): void {
  const push = (b: Omit<DocsBlock, 'id'>) => {
    if (out.length < NOTES_IMPORT_MAX_BLOCKS) out.push({ id: newId(), ...b });
  };
  for (const tok of tokens) {
    switch (tok.type) {
      case 'heading': {
        const t = tok as Tokens.Heading;
        // Inverso del export (lib/docs-markdown.ts): ## → H1, ### → H2, #### → H3.
        const level = (t.depth <= 2 ? 1 : t.depth === 3 ? 2 : 3) as 1 | 2 | 3;
        push({ type: 'heading', level, content: mdInline(t.text) });
        break;
      }
      case 'paragraph':
      case 'text': {
        const t = tok as Tokens.Paragraph;
        const html = mdInline(t.text);
        if (html) push({ type: as, content: html });
        break;
      }
      case 'list': {
        const t = tok as Tokens.List;
        for (const item of t.items) {
          const html = mdInline(itemText(item));
          if (item.task) push({ type: 'todo', content: html, checked: Boolean(item.checked) });
          else push({ type: t.ordered ? 'numbered_list_item' : 'bulleted_list_item', content: html });
          const nested = item.tokens.filter((x) => x.type === 'list');
          if (nested.length) mdTokens(nested, out, as);
        }
        break;
      }
      case 'blockquote':
        mdTokens((tok as Tokens.Blockquote).tokens, out, 'quote');
        break;
      case 'code': {
        const t = tok as Tokens.Code;
        push({ type: 'code', content: esc(t.text), ...(t.lang ? { language: t.lang.slice(0, 40) } : {}) });
        break;
      }
      case 'hr':
        push({ type: 'divider', content: '' });
        break;
      case 'table': {
        const t = tok as Tokens.Table;
        const rows = [t.header.map((c) => c.text), ...t.rows.map((r) => r.map((c) => c.text))].slice(0, 200);
        push({ type: 'table', content: '', rows: rows.map((r) => r.slice(0, 20)) });
        break;
      }
      case 'html': {
        const text = sanitizeDocsHtml((tok as Tokens.HTML).text).replace(/<[^>]*>/g, '').trim();
        if (text) push({ type: as, content: esc(text) });
        break;
      }
      default:
        break;
    }
  }
}

/** Saca un front matter YAML del principio (--- … ---) y devuelve su `title`, si hay. */
function stripFrontMatter(md: string): { body: string; title: string | null } {
  if (!md.startsWith('---\n') && !md.startsWith('---\r\n')) return { body: md, title: null };
  const end = md.indexOf('\n---', 4);
  if (end === -1) return { body: md, title: null };
  const head = md.slice(4, end);
  const title = head
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.toLowerCase().startsWith('title:'));
  const after = md.indexOf('\n', end + 4);
  return {
    body: after === -1 ? '' : md.slice(after + 1),
    title: title ? title.slice(6).trim().replace(/^["']|["']$/g, '') || null : null,
  };
}

/**
 * Markdown → nota. El título sale del front matter, de un `# Título` al
 * principio o, si no hay, del nombre del archivo.
 */
export function markdownToNote(md: string, filename = ''): ImportedNote {
  const { body, title: fmTitle } = stripFrontMatter(md.replace(/^﻿/, ''));
  const tokens = marked.lexer(body, { gfm: true });
  let title = fmTitle ?? '';
  const firstReal = tokens.findIndex((t) => t.type !== 'space');
  const first = tokens[firstReal] as Tokens.Heading | undefined;
  if (!title && first?.type === 'heading' && first.depth === 1) {
    title = first.text.replace(/[*_`~]/g, '').trim();
    tokens.splice(firstReal, 1);
  }
  if (!title) title = filename.replace(/\.(md|markdown|txt)$/i, '').trim();
  const blocks: DocsBlock[] = [];
  mdTokens(tokens, blocks);
  return { title: title.slice(0, 300), blocks, tags: [], sourceUrl: null, createdAt: null, updatedAt: null };
}

export type ImportKind = 'enex' | 'markdown';

/** Tipo de archivo por extensión (lo demás no se importa). */
export function importKind(filename: string): ImportKind | null {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'enex') return 'enex';
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') return 'markdown';
  return null;
}
