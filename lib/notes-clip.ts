/**
 * Notes: recortes web. Convierte el HTML de una página en bloques: `article`
 * se queda con el contenido principal y `page` con toda la página (sin scripts
 * ni estilos). Lo manda el bookmarklet (la página tal como la ve la persona,
 * también con sesión) o lo baja el servidor con safeFetch. Las imágenes se
 * copian a la nota (hasta MAX_IMAGES); si no se pueden bajar quedan como link.
 */
import type { DocsBlock } from './docs-types';
import { safeFetch } from './safe-fetch';
import { saveUpload, UploadError } from './uploads';

export type ClipMode = 'bookmark' | 'selection' | 'article' | 'page';
export const CLIP_MODES: readonly ClipMode[] = ['bookmark', 'selection', 'article', 'page'];
export const CLIP_MAX_HTML = 2_000_000;
const MAX_BLOCKS = 800;
const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const id = () => crypto.randomUUID();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function stripTagBlocks(html: string, tags: string[]): string {
  let out = html;
  for (const t of tags) out = out.replace(new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?</${t}\\s*>`, 'gi'), ' ');
  return out;
}

/** Texto visible de un trozo de HTML. */
function textLength(html: string): number {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
}

function largestMatch(html: string, tag: string): string | null {
  let best: string | null = null;
  let bestLen = 0;
  for (const m of html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'gi'))) {
    const len = textLength(m[1]);
    if (len > bestLen) {
      best = m[1];
      bestLen = len;
    }
  }
  return best;
}

/** Contenido principal: <article> o <main> si tienen texto; si no, el cuerpo sin menú, encabezado ni pie. Puro. */
export function extractArticle(html: string): string {
  const clean = stripTagBlocks(html, ['script', 'style', 'noscript', 'svg', 'iframe', 'template', 'form']).replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of ['article', 'main']) {
    const hit = largestMatch(clean, tag);
    if (hit && textLength(hit) > 200) return stripTagBlocks(hit, ['nav', 'aside', 'footer']);
  }
  const body = clean.match(/<body\b[^>]*>([\s\S]*)<\/body\s*>/i)?.[1] ?? clean;
  return stripTagBlocks(body, ['nav', 'aside', 'footer', 'header']);
}

export function extractPage(html: string): string {
  const clean = stripTagBlocks(html, ['script', 'style', 'noscript', 'svg', 'iframe', 'template']).replace(/<!--[\s\S]*?-->/g, ' ');
  return clean.match(/<body\b[^>]*>([\s\S]*)<\/body\s*>/i)?.[1] ?? clean;
}

function absolute(raw: string | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((x) => x !== undefined);
}

/** Bloque de imagen sin bajar todavía: `content` es la URL de origen. */
export type ClipBlock = DocsBlock & { clipImage?: string };

/**
 * HTML → bloques, recorriendo las etiquetas en orden. Links relativos a
 * absolutos; todo el texto pasa por el saneador del editor. Puro.
 */
export function htmlToClipBlocks(html: string, baseUrl: string): ClipBlock[] {
  const blocks: ClipBlock[] = [];
  let buf = '';
  let kind: { type: DocsBlock['type']; level?: 1 | 2 | 3 } = { type: 'paragraph' };
  const lists: Array<'ul' | 'ol'> = [];
  let pre = false;
  let quote = 0;
  const flush = () => {
    const raw = buf;
    buf = '';
    if (pre) {
      const code = raw.replace(/<[^>]+>/g, '');
      if (code.trim()) blocks.push({ id: id(), type: 'code', content: code.replace(/^\n/, '') });
      return;
    }
    const content = raw.replace(/\s+/g, ' ').trim();
    if (!content.replace(/<[^>]+>/g, '').trim()) return;
    const type = quote > 0 && kind.type === 'paragraph' ? 'quote' : kind.type;
    blocks.push({ id: id(), type, content, ...(kind.level ? { level: kind.level } : {}), ...(lists.length > 1 ? { indent: Math.min(lists.length - 1, 6) } : {}) });
  };
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|[^<]+|</g;
  for (const m of html.matchAll(re)) {
    const token = m[0];
    const tag = m[1]?.toLowerCase();
    if (!tag) {
      buf += token === '<' ? '&lt;' : token;
      continue;
    }
    const closing = token.startsWith('</');
    if (blocks.length >= MAX_BLOCKS) break;
    if (tag === 'pre') {
      if (closing) {
        flush();
        pre = false;
      } else {
        flush();
        pre = true;
      }
      continue;
    }
    if (pre) continue;
    switch (tag) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        flush();
        kind = closing ? { type: 'paragraph' } : { type: 'heading', level: Math.min(Number(tag[1]), 3) as 1 | 2 | 3 };
        break;
      case 'ul':
      case 'ol':
        flush();
        if (closing) lists.pop();
        else lists.push(tag);
        kind = { type: 'paragraph' };
        break;
      case 'li':
        flush();
        kind = closing ? { type: 'paragraph' } : { type: lists[lists.length - 1] === 'ol' ? 'numbered_list_item' : 'bulleted_list_item' };
        break;
      case 'blockquote':
        flush();
        quote += closing ? -1 : 1;
        break;
      case 'p':
      case 'div':
      case 'section':
      case 'article':
      case 'main':
      case 'header':
      case 'footer':
      case 'nav':
      case 'aside':
      case 'figure':
      case 'figcaption':
      case 'table':
      case 'tr':
      case 'dl':
      case 'dt':
      case 'dd':
      case 'hr':
        flush();
        break;
      case 'td':
      case 'th':
        if (closing) buf += ' ';
        break;
      case 'br':
        buf += '<br>';
        break;
      case 'img': {
        const src = absolute(attr(token, 'src') ?? attr(token, 'data-src'), baseUrl);
        if (src) {
          flush();
          blocks.push({ id: id(), type: 'image', content: '', clipImage: src, caption: attr(token, 'alt')?.slice(0, 300) });
        }
        break;
      }
      case 'a': {
        if (closing) {
          buf += '</a>';
        } else {
          const href = absolute(attr(token, 'href'), baseUrl);
          buf += href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">` : '<a>';
        }
        break;
      }
      case 'strong':
      case 'b':
        buf += closing ? '</strong>' : '<strong>';
        break;
      case 'em':
      case 'i':
        buf += closing ? '</em>' : '<em>';
        break;
      case 'code':
        buf += closing ? '</code>' : '<code>';
        break;
      default:
        break;
    }
  }
  flush();
  return blocks;
}

/** Copia las imágenes al almacenamiento de la app. La que falla queda como link. */
export async function resolveClipImages(blocks: ClipBlock[]): Promise<DocsBlock[]> {
  const out: DocsBlock[] = [];
  let copied = 0;
  for (const b of blocks) {
    const { clipImage, ...block } = b;
    if (!clipImage) {
      out.push(block);
      continue;
    }
    let saved: DocsBlock | null = null;
    if (copied < MAX_IMAGES) {
      try {
        const res = await safeFetch(clipImage, {}, 8000, { maxRedirects: 3 });
        const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
        const buf = res.ok && mime.startsWith('image/') ? Buffer.from(await res.arrayBuffer()) : null;
        if (buf && buf.length > 0 && buf.length <= MAX_IMAGE_BYTES) {
          const name = decodeURIComponent(new URL(clipImage).pathname.split('/').pop() || 'image').slice(0, 120) || 'image';
          const url = await saveUpload('docs', name, mime, buf);
          saved = { ...block, url, name, size: buf.length, mime };
          copied++;
        }
      } catch (err) {
        // Sin imagen no se cae el recorte: queda el link. UploadError es formato no permitido.
        void (err instanceof UploadError);
      }
    }
    if (saved) out.push(saved);
    else out.push({ id: block.id, type: 'paragraph', content: `<a href="${esc(clipImage)}" target="_blank" rel="noopener noreferrer">${esc(block.caption || clipImage)}</a>` });
  }
  return out;
}

export class ClipFetchError extends Error {}

/** Baja la página (para recortes sin HTML del bookmarklet). */
export async function fetchClipHtml(url: string): Promise<string> {
  const res = await safeFetch(url, { headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Mozilla/5.0 (compatible; zerosoft-notes-clipper)' } }, 10_000, { maxRedirects: 3 }).catch(() => null);
  if (!res?.ok) throw new ClipFetchError('fetch_failed');
  const type = res.headers.get('content-type') ?? '';
  if (type && !/html|xml/i.test(type)) throw new ClipFetchError('not_html');
  return (await res.text()).slice(0, CLIP_MAX_HTML);
}

/** Bloques finales de un recorte de artículo o página. */
export async function clipContentBlocks(html: string, mode: 'article' | 'page', url: string): Promise<DocsBlock[]> {
  const body = mode === 'article' ? extractArticle(html) : extractPage(html);
  return resolveClipImages(htmlToClipBlocks(body, url));
}
