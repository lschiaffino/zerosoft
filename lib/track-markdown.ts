/**
 * Track — Markdown de descripciones y comentarios → HTML seguro.
 *
 * Usa `marked`, el mismo parser del blog, el changelog y los comentarios del
 * Board. Allá el resultado pasa por sanitize-html en el servidor; acá el
 * render corre también en el navegador (vista previa del editor), así que la
 * seguridad se arma en el propio renderer para no cargar sanitize-html en el
 * bundle del cliente:
 * - el HTML crudo nunca pasa: se escapa y se muestra como texto;
 * - links solo http(s), mailto o rutas relativas; el resto queda como texto;
 * - imágenes se muestran como link (nada de cargar recursos de terceros);
 * - todo texto y atributo sale escapado.
 * Además, las @menciones se marcan con .track-mention como en el timeline.
 */
import { Marked, type Tokens } from 'marked';

/** Mismo largo máximo que el schema de comentarios / descripción. */
export const TRACK_MARKDOWN_MAX = 5000;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Deshace las entidades que marked ya aplicó, para re-escapar una sola vez. */
function unescapeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * href permitido o null. Se ignoran espacios y caracteres de control que los
 * navegadores descartan (`java\tscript:`), y se compara el esquema en minúsculas.
 */
export function safeHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const href = unescapeEntities(raw).trim();
  if (!href) return null;
  // eslint-disable-next-line no-control-regex
  const compact = href.replace(/[\u0000- \u007f]/g, '').toLowerCase();
  if (compact.startsWith('//')) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(compact);
  if (scheme) return ['http', 'https', 'mailto'].includes(scheme[1]) ? href : null;
  // Sin esquema: ruta relativa, ancla o query.
  return href;
}

// Mismas menciones que el timeline: @email@dominio.com y @Nombre Apellido.
const MENTION_RE = /^@(?:[\w.-]+@[\w.-]+\.\w{2,}|[A-Z][a-zA-Z]*(?:[ \t]+[A-Z][a-zA-Z]*){0,2})/;

const md = new Marked({
  async: false,
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: 'mention',
      level: 'inline',
      start(src: string) {
        const i = src.indexOf('@');
        return i < 0 ? undefined : i;
      },
      tokenizer(src: string) {
        const m = MENTION_RE.exec(src);
        return m ? { type: 'mention', raw: m[0], text: m[0] } : undefined;
      },
      renderer(token) {
        return `<span class="track-mention">${escapeHtml(String(token.text))}</span>`;
      },
    },
  ],
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text);
    },
    link(token: Tokens.Link) {
      const text = this.parser.parseInline(token.tokens);
      const href = safeHref(token.href);
      if (!href) return text;
      const title = token.title ? ` title="${escapeHtml(unescapeEntities(token.title))}"` : '';
      return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="nofollow noopener noreferrer">${text}</a>`;
    },
    image(token: Tokens.Image) {
      const label = escapeHtml(unescapeEntities(token.text || token.href || ''));
      const href = safeHref(token.href);
      if (!href) return label;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="nofollow noopener noreferrer">${label}</a>`;
    },
  },
});

/** Markdown de un comentario o descripción → HTML seguro para innerHTML. */
export function renderTrackMarkdown(markdown: string): string {
  if (!markdown.trim()) return '';
  return (md.parse(markdown.slice(0, TRACK_MARKDOWN_MAX)) as string).trim();
}

// ---------- Acciones de la barra del editor ----------

export type MarkdownAction = 'bold' | 'italic' | 'code' | 'list' | 'link';

export interface MarkdownEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Aplica una acción de la barra sobre el texto y la selección. Puro, para
 * poder testearlo: el editor solo pasa el textarea y vuelve a fijar el cursor.
 */
export function applyMarkdownAction(
  value: string,
  start: number,
  end: number,
  action: MarkdownAction,
  placeholder = '',
): MarkdownEdit {
  const selected = value.slice(start, end);
  const wrap = (before: string, after: string): MarkdownEdit => {
    const inner = selected || placeholder;
    const next = value.slice(0, start) + before + inner + after + value.slice(end);
    return { value: next, selectionStart: start + before.length, selectionEnd: start + before.length + inner.length };
  };
  switch (action) {
    case 'bold':
      return wrap('**', '**');
    case 'italic':
      return wrap('_', '_');
    case 'code':
      return selected.includes('\n') ? wrap('```\n', '\n```') : wrap('`', '`');
    case 'link': {
      const text = selected || placeholder;
      const before = `[${text}](`;
      const next = value.slice(0, start) + before + 'https://' + ')' + value.slice(end);
      const urlStart = start + before.length;
      return { value: next, selectionStart: urlStart, selectionEnd: urlStart + 'https://'.length };
    }
    case 'list': {
      // Cada línea tocada por la selección pasa a ser un ítem (o deja de serlo si ya lo eran todas).
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const nl = value.indexOf('\n', end);
      const lineEnd = nl < 0 ? value.length : nl;
      const lines = value.slice(lineStart, lineEnd).split('\n');
      const allItems = lines.every((l) => /^\s*[-*] /.test(l));
      const changed = lines.map((l) => (allItems ? l.replace(/^(\s*)[-*] /, '$1') : `- ${l}`)).join('\n');
      const next = value.slice(0, lineStart) + changed + value.slice(lineEnd);
      return { value: next, selectionStart: lineStart, selectionEnd: lineStart + changed.length };
    }
  }
}
