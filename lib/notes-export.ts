/**
 * Notes — exportar a ENEX (el formato de Evernote) y a HTML.
 *
 * ENEX: una nota o muchas (una libreta, una selección o todas) en un solo
 * archivo que Evernote, Apple Notes, Bear, Joplin u Obsidian importan. Los
 * adjuntos van adentro como <resource> en base64 con su <en-media> en el
 * lugar del bloque, mientras entren en el tope; si no, queda un link.
 * Lo que arma este módulo lo vuelve a leer lib/notes-import.ts (test de ida
 * y vuelta en tests/unit/notes-parity.test.ts).
 */
import { createHash } from 'crypto';
import type { DocsBlock } from './docs-types';
import { isFileBlockType } from './docs-files';
import { databaseTable } from './docs-database';
import type { NoteDetail } from './notes-types';

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(text: string): string {
  return esc(text).replace(/"/g, '&quot;');
}

const KEEP_INLINE = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'code', 'br', 'a', 'sub', 'sup']);

/**
 * HTML-lite de un bloque → XHTML válido para ENML: solo marcas simples y
 * links (con href http/https/mailto), sin atributos de más.
 */
export function inlineToEnml(html: string): string {
  if (!html) return '';
  let out = html.replace(/<(\/?)([a-zA-Z0-9-]+)([^>]*)>/g, (_m, close: string, rawName: string, attrs: string) => {
    const name = rawName.toLowerCase();
    if (!KEEP_INLINE.has(name)) return '';
    if (name === 'br') return close ? '' : '<br/>';
    if (name === 'a') {
      if (close) return '</a>';
      const href = /href\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? '';
      const clean = href.replace(/&amp;/g, '&');
      return /^(https?:|mailto:)/i.test(clean) ? `<a href="${escAttr(clean)}">` : '<a>';
    }
    return close ? `</${name}>` : `<${name}>`;
  });
  // Entidades HTML que XML no conoce sin DTD.
  out = out.replace(/&nbsp;/g, '&#160;').replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
  return out;
}

export interface EnexResourceOut {
  hash: string;
  mime: string;
  name: string;
  data: string;
}

/** Bloques → cuerpo ENML (sin el <en-note>). `media` resuelve un archivo a su recurso (o null = link). */
export function blocksToEnml(blocks: DocsBlock[], media: (b: DocsBlock) => EnexResourceOut | null, fileLink: (b: DocsBlock) => string | null): string {
  const parts: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (list) parts.push(`</${list}>`);
    list = null;
  };
  for (const b of blocks) {
    const text = inlineToEnml(b.content ?? '');
    const wantList = b.type === 'bulleted_list_item' ? 'ul' : b.type === 'numbered_list_item' ? 'ol' : null;
    if (wantList !== list) {
      closeList();
      if (wantList) {
        parts.push(`<${wantList}>`);
        list = wantList;
      }
    }
    if (wantList) {
      parts.push(`<li>${text || '<br/>'}</li>`);
      continue;
    }
    switch (b.type) {
      case 'heading': {
        const lvl = b.level ?? 2;
        parts.push(`<h${lvl}>${text}</h${lvl}>`);
        break;
      }
      case 'todo':
        parts.push(`<div><en-todo checked="${b.checked ? 'true' : 'false'}"/>${text}</div>`);
        break;
      case 'quote':
      case 'callout':
        parts.push(`<blockquote><div>${text || '<br/>'}</div></blockquote>`);
        break;
      case 'code':
        parts.push(`<pre>${esc(b.content ?? '')}</pre>`);
        break;
      case 'divider':
        parts.push('<hr/>');
        break;
      case 'table': {
        const rows = (b.rows ?? []).map((r) => `<tr>${r.map((c) => `<td>${inlineToEnml(c)}</td>`).join('')}</tr>`).join('');
        parts.push(`<table>${rows}</table>`);
        break;
      }
      case 'database': {
        const t = databaseTable(b);
        const head = `<tr>${t.header.map((h) => `<td><b>${esc(h)}</b></td>`).join('')}</tr>`;
        const rows = t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
        parts.push(`<table>${head}${rows}</table>`);
        break;
      }
      default:
        if (isFileBlockType(b.type)) {
          const res = media(b);
          if (res) {
            parts.push(`<div><en-media type="${escAttr(res.mime)}" hash="${res.hash}"/></div>`);
          } else {
            const href = fileLink(b);
            const label = esc(b.name || 'file');
            parts.push(href ? `<div><a href="${escAttr(href)}">${label}</a></div>` : `<div>${label}</div>`);
          }
        } else {
          parts.push(`<div>${text || '<br/>'}</div>`);
        }
    }
  }
  closeList();
  return parts.join('');
}

/** Fecha ISO → formato ENEX (20240131T101500Z). */
export function enexDate(iso: string): string {
  const d = new Date(iso);
  const ok = Number.isFinite(d.getTime()) ? d : new Date();
  return ok.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function cdata(text: string): string {
  return `<![CDATA[${text.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

export const ENEX_HEAD = (now = new Date().toISOString()) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">\n<en-export export-date="${enexDate(now)}" application="zerosoft Notes" version="1.0">\n`;
export const ENEX_TAIL = '</en-export>\n';

/** Recurso ENEX de un archivo: md5 (el hash de <en-media>) y base64. */
export function enexResource(bytes: Uint8Array, mime: string, name: string): EnexResourceOut {
  return {
    hash: createHash('md5').update(bytes).digest('hex'),
    mime: mime || 'application/octet-stream',
    name,
    data: Buffer.from(bytes).toString('base64'),
  };
}

/**
 * Una nota como <note> de ENEX. `files` trae los adjuntos que entraron (por
 * id de bloque); los demás quedan como link. Una nota bloqueada sale con su
 * título y un aviso: el texto cifrado no se exporta.
 */
export function noteToEnex(
  note: NoteDetail,
  opts: { files?: Map<string, EnexResourceOut>; fileLink?: (b: DocsBlock) => string | null; lockedText?: string } = {},
): string {
  const files = opts.files ?? new Map<string, EnexResourceOut>();
  const used: EnexResourceOut[] = [];
  const body = note.locked
    ? `<div>${esc(opts.lockedText ?? 'This note is locked. Unlock it in zerosoft Notes to export its text.')}</div>`
    : blocksToEnml(
        note.content,
        (b) => {
          const r = files.get(b.id) ?? null;
          if (r && !used.includes(r)) used.push(r);
          return r;
        },
        opts.fileLink ?? (() => null),
      );
  const enml = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>${body}</en-note>`;
  const tags = note.tags.map((t) => `<tag>${esc(t)}</tag>`).join('');
  const attrs = note.source_url ? `<note-attributes><source-url>${esc(note.source_url)}</source-url></note-attributes>` : '';
  const resources = used
    .map(
      (r) =>
        `<resource><data encoding="base64">${r.data}</data><mime>${esc(r.mime)}</mime><resource-attributes><file-name>${esc(r.name)}</file-name></resource-attributes></resource>`,
    )
    .join('');
  return `<note><title>${esc(note.title || 'Untitled')}</title><content>${cdata(enml)}</content><created>${enexDate(note.created_at)}</created><updated>${enexDate(note.updated_at)}</updated>${tags}${attrs}${resources}</note>\n`;
}

/** Nota → página HTML independiente (exportar como HTML). Los archivos van como links. */
export function noteToHtml(note: NoteDetail, opts: { fileLink?: (b: DocsBlock) => string | null; lang?: string } = {}): string {
  const body = blocksToEnml(note.content, () => null, opts.fileLink ?? (() => null))
    .replace(/<en-todo checked="true"\/>/g, '<input type="checkbox" checked disabled> ')
    .replace(/<en-todo checked="false"\/>/g, '<input type="checkbox" disabled> ');
  const title = esc(note.title || 'Untitled');
  const tags = note.tags.length ? `<p class="tags">${note.tags.map((t) => `#${esc(t)}`).join(' ')}</p>` : '';
  return `<!doctype html>
<html lang="${escAttr(opts.lang ?? 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#1a1a1a;background:#fff}
h1{font-size:28px;line-height:1.25}
blockquote{border-left:3px solid #ccc;margin:0;padding-left:12px;color:#555}
pre{background:#f4f4f4;padding:12px;overflow:auto}
table{border-collapse:collapse}td{border:1px solid #ddd;padding:4px 8px}
.tags{color:#666}
</style>
</head>
<body>
<h1>${title}</h1>
${tags}
${body}
</body>
</html>
`;
}
