import path from 'path';
import { decodeEntities } from './docs-markdown';

/**
 * Docs D5: formatos de import además del Markdown de Notion. Todo puro (sin
 * DB ni red), así se prueba con fixtures:
 *
 * - HTML: export HTML de Notion (`<article class="page">`), espacio de
 *   Confluence (index.html con el árbol y `#main-content` en cada página),
 *   Google Docs "Página web (.html, comprimido)" y cualquier .html suelto.
 *   Se toma el cuerpo, se descartan script/style/iframe (lo hace
 *   htmlToBlocks), los links a otras páginas del zip pasan a `zspage:` y las
 *   imágenes y adjuntos locales a marcadores que el importador sube.
 * - Evernote (.enex): XML que se recorre con un tokenizador acotado, sin DTD
 *   ni entidades externas (nada de XXE): solo las 5 entidades de XML y las
 *   numéricas. Cada nota es una página; sus recursos (base64) se suben.
 *
 * Nunca se baja nada por URL: una imagen externa queda como link.
 */

// ---------- HTML ----------

export type HtmlFlavor = 'notion' | 'confluence' | 'generic';

export interface HtmlPage {
  flavor: HtmlFlavor;
  title: string | null;
  body: string;
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Contenido del primer elemento con ese id o clase (balanceando los tags del mismo nombre). */
export function extractElement(html: string, match: RegExp): string | null {
  const open = match.exec(html);
  if (!open) return null;
  const tag = /^<([a-z0-9]+)/i.exec(open[0])?.[1]?.toLowerCase();
  if (!tag) return null;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = open.index + open[0].length;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].endsWith('/>')) continue;
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(open.index + open[0].length, m.index);
  }
  return html.slice(open.index + open[0].length);
}

/** Título y cuerpo de un HTML exportado (detecta Notion, Confluence o genérico). */
export function parseHtmlPage(html: string): HtmlPage {
  const src = html.replace(/^﻿/, '');
  const docTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src)?.[1];
  // Confluence: <div id="main-content" class="wiki-content">; título "Espacio : Página".
  const confluence = extractElement(src, /<div\b[^>]*\bid="main-content"[^>]*>/i);
  if (confluence !== null) {
    const raw = /<span\b[^>]*id="title-text"[^>]*>([\s\S]*?)<\/span>/i.exec(src)?.[1] ?? docTitle ?? '';
    const text = stripTags(raw);
    const title = text.includes(' : ') ? text.slice(text.indexOf(' : ') + 3).trim() : text;
    return { flavor: 'confluence', title: title || null, body: confluence };
  }
  // Notion: <article class="page …"><header><h1 class="page-title">…</h1></header><div class="page-body">.
  if (/<article\b[^>]*class="[^"]*\bpage\b/i.test(src)) {
    const raw = /<h1\b[^>]*class="[^"]*page-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(src)?.[1] ?? docTitle ?? '';
    const body = extractElement(src, /<div\b[^>]*class="[^"]*\bpage-body\b[^"]*"[^>]*>/i) ?? extractElement(src, /<article\b[^>]*>/i) ?? '';
    // Notion pone las propiedades de una fila en <table class="properties">: van en la base, no en el cuerpo.
    return { flavor: 'notion', title: stripTags(raw) || null, body };
  }
  const body = extractElement(src, /<body\b[^>]*>/i) ?? src;
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(body)?.[1];
  const title = stripTags(docTitle ?? '') || (h1 ? stripTags(h1) : '');
  return { flavor: 'generic', title: title || null, body };
}

/** ¿Es el index.html de un export de espacio de Confluence? */
export function isConfluenceIndex(html: string): boolean {
  return /id="main-content"/i.test(html) && /class="[^"]*pageSection/i.test(html) && /Confluence/i.test(html);
}

/**
 * Árbol de páginas de un index.html de Confluence (listas anidadas de links
 * a "Página_123.html"): página → página madre (null = de primer nivel).
 */
export function confluenceTree(indexHtml: string, dir: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const stack: Array<string | null> = [];
  let current: string | null = null;
  const re = /<(\/?)(ul|li|a)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  const liPage: Array<string | null> = [];
  while ((m = re.exec(indexHtml))) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'ul') {
      if (closing) stack.pop();
      else stack.push(current);
    } else if (tag === 'li') {
      if (closing) {
        liPage.pop();
        current = liPage[liPage.length - 1] ?? null;
      } else liPage.push(null);
    } else if (tag === 'a' && !closing) {
      const href = /href="([^"#?]+\.html?)"/i.exec(m[3])?.[1];
      if (!href || /^(https?:|\/)/i.test(href) || liPage.length === 0 || liPage[liPage.length - 1] !== null) continue;
      const target = path.posix.normalize(path.posix.join(dir, safeDecode(href)));
      if (target === path.posix.join(dir, 'index.html')) continue;
      liPage[liPage.length - 1] = target;
      current = target;
      // La madre: la página del <li> de afuera (el ul abierto guardó el current de entonces).
      const parent = stack[stack.length - 1] ?? null;
      if (!out.has(target)) out.set(target, parent && parent !== target ? parent : null);
    }
  }
  return out;
}

function safeDecode(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

export interface HtmlAttachment {
  marker: string;
  zipPath: string;
  label: string;
  image: boolean;
}

export interface HtmlRefContext {
  /** Path del .html dentro del zip. */
  path: string;
  /** Path de una página del zip → id local. */
  pageFor: (zipPath: string) => string | null;
  /** Id de Notion (32 hex) → id local (links notion.so). */
  pageByNotionId?: (id: string) => string | null;
  hasFile: (zipPath: string) => boolean;
}

function marker(n: number): string {
  return `zsattach${n}x${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Reescribe links e imágenes de un cuerpo HTML: páginas del zip → `zspage:`,
 * imágenes locales → un párrafo con un marcador (después bloque image),
 * links a adjuntos locales → marcador si están solos, si no su texto. Una
 * imagen externa queda como link (no se descarga).
 */
export function rewriteHtmlRefs(body: string, ctx: HtmlRefContext): { html: string; attachments: HtmlAttachment[] } {
  const dir = path.posix.dirname(ctx.path);
  const attachments: HtmlAttachment[] = [];
  const resolve = (raw: string): string | null => {
    const href = safeDecode(decodeEntities(raw));
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return null;
    const clean = href.split(/[?#]/)[0];
    if (!clean) return null;
    const target = path.posix.normalize(path.posix.join(dir, clean));
    return target.startsWith('../') || target.startsWith('/') ? null : target;
  };
  let html = body.replace(/<img\b([^>]*)>/gi, (_whole, attrs: string) => {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const raw = src?.[1] ?? src?.[2] ?? '';
    const alt = decodeEntities(/\balt\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? '');
    const target = raw ? resolve(raw) : null;
    if (target && ctx.hasFile(target)) {
      const m = marker(attachments.length);
      attachments.push({ marker: m, zipPath: target, label: alt || path.posix.basename(target), image: true });
      return `<p>${m}</p>`;
    }
    if (/^https?:\/\//i.test(raw)) return `<a href="${raw.replace(/"/g, '&quot;')}">${alt || raw}</a>`;
    return alt ? alt.replace(/[<>&]/g, '') : '';
  });
  html = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (whole, attrs: string, inner: string) => {
    const hrefRaw = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const raw = hrefRaw?.[1] ?? hrefRaw?.[2] ?? '';
    if (!raw) return inner;
    if (/^https?:\/\//i.test(raw)) {
      const nid = /notion\.(?:so|site)\/[^?#"]*?([0-9a-f]{32})(?:[?#]|$)/i.exec(raw)?.[1]?.toLowerCase();
      const local = nid ? ctx.pageByNotionId?.(nid) : null;
      return local ? `<a href="zspage:${local}">${inner}</a>` : whole;
    }
    if (/^(mailto|tel):/i.test(raw)) return whole;
    const target = resolve(raw);
    if (!target) return inner;
    const page = ctx.pageFor(target);
    if (page) return `<a href="zspage:${page}">${inner}</a>`;
    if (ctx.hasFile(target)) {
      const label = stripTags(inner) || path.posix.basename(target);
      const m = marker(attachments.length);
      attachments.push({ marker: m, zipPath: target, label, image: false });
      return `<p>${m}</p>`;
    }
    return inner;
  });
  return { html, attachments };
}

// ---------- Evernote (.enex) ----------

export interface EnexResource {
  hash: string | null;
  mime: string;
  name: string;
  /** Base64 sin espacios. */
  data: string;
}

export interface EnexNote {
  title: string;
  created: string | null;
  updated: string | null;
  tags: string[];
  /** ENML (el XHTML de la nota, sin el <?xml>/DOCTYPE). */
  content: string;
  resources: EnexResource[];
}

/** Las 5 entidades de XML y las numéricas. Nada de entidades del DTD. */
export function xmlText(text: string): string {
  return text
    .replace(/&#x([0-9a-f]{1,6});/gi, (_m, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_m, d: string) => safeCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function safeCodePoint(n: number): string {
  return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

function unCdata(text: string): string {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(text);
  return m ? m[1] : xmlText(text);
}

function tagText(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return m ? unCdata(m[1]) : null;
}

/** "20240131T120000Z" → ISO. */
export function enexDate(v: string | null): string | null {
  const m = v ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v.trim()) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Rango en bytes de cada <note>…</note> del archivo (sin decodificarlo entero). */
export function enexNoteRanges(buf: Buffer, max = 5000): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const open = Buffer.from('<note>');
  const close = Buffer.from('</note>');
  let p = 0;
  while (out.length < max) {
    const s = buf.indexOf(open, p);
    if (s < 0) break;
    const e = buf.indexOf(close, s);
    if (e < 0) break;
    out.push({ start: s, end: e + close.length });
    p = e + close.length;
  }
  return out;
}

/** Título de una nota (para el árbol de la vista previa) sin parsear los recursos. */
export function enexNoteTitle(noteXml: string): string {
  return (tagText(noteXml, 'title') ?? '').trim().slice(0, 500) || 'Untitled';
}

export function parseEnexNote(noteXml: string): EnexNote {
  const content = (tagText(noteXml, 'content') ?? '')
    .replace(/<\?xml[^>]*\?>/i, '')
    .replace(/<!DOCTYPE[^>]*>/i, '');
  const tags = [...noteXml.matchAll(/<tag>([\s\S]*?)<\/tag>/gi)].map((m) => unCdata(m[1]).trim()).filter(Boolean).slice(0, 50);
  const resources: EnexResource[] = [];
  for (const m of noteXml.matchAll(/<resource>([\s\S]*?)<\/resource>/gi)) {
    if (resources.length >= 200) break;
    const r = m[1];
    const data = (/<data\b[^>]*>([\s\S]*?)<\/data>/i.exec(r)?.[1] ?? '').replace(/\s+/g, '');
    const mime = (tagText(r, 'mime') ?? 'application/octet-stream').trim().toLowerCase();
    const name = (tagText(r, 'file-name') ?? '').trim();
    // Evernote referencia el recurso por el md5 de los bytes (<en-media hash>); algunos exports traen <recognition> con él.
    resources.push({ hash: null, mime, name, data });
  }
  return {
    title: enexNoteTitle(noteXml),
    created: enexDate(tagText(noteXml, 'created')),
    updated: enexDate(tagText(noteXml, 'updated')),
    tags,
    content,
    resources,
  };
}

/**
 * ENML → HTML para htmlToBlocks: <en-note> como div, <en-todo> como tarea,
 * <en-media hash> como marcador del recurso (`media(hash)` lo da), <en-crypt>
 * fuera (texto cifrado).
 */
export function enmlToHtml(enml: string, media: (hash: string, type: string) => string | null): string {
  let html = enml
    .replace(/<en-crypt\b[\s\S]*?<\/en-crypt>/gi, '')
    .replace(/<en-note\b[^>]*>/gi, '<div>')
    .replace(/<\/en-note>/gi, '</div>');
  html = html.replace(/<en-media\b([^>]*?)\/?>(?:\s*<\/en-media>)?/gi, (_m, attrs: string) => {
    const hash = /\bhash="([0-9a-f]{32})"/i.exec(attrs)?.[1]?.toLowerCase();
    const type = /\btype="([^"]*)"/i.exec(attrs)?.[1] ?? '';
    const marker = hash ? media(hash, type) : null;
    return marker ? `<p>${marker}</p>` : '';
  });
  // Tareas: "<div><en-todo checked="true"/>Texto</div>" → <ul><li><input checked>Texto</li></ul>.
  html = html.replace(/<(div|p|li)\b[^>]*>\s*<en-todo\b([^>]*?)\/?>(?:<\/en-todo>)?([\s\S]*?)<\/\1>/gi, (_m, _tag: string, attrs: string, inner: string) => {
    const checked = /checked="true"/i.test(attrs);
    return `<ul><li><input type="checkbox"${checked ? ' checked' : ''}>${inner}</li></ul>`;
  });
  return html.replace(/<en-todo\b[^>]*\/?>/gi, '');
}
