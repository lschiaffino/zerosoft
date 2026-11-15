/**
 * Respuestas del asistente: Markdown → HTML seguro (corre en el navegador
 * mientras llega el texto). Mismo parser y mismas reglas que Track y los
 * playbooks del CRM (lib/track-markdown.ts):
 * - el HTML crudo nunca pasa: se escapa y se ve como texto;
 * - links solo http(s), mailto o rutas relativas (las de la app abren en la
 *   misma pestaña, las de afuera en otra y sin referrer);
 * - las imágenes quedan como link (nada se carga de terceros);
 * - las tablas van en .table-wrap (scroll de costado solo si no entran);
 * - tablas y listas largas muestran los primeros renglones y un botón
 *   "Mostrar las N" abajo (lib/assistant/scroll.ts), sin scroll vertical propio;
 * - los bloques de código llevan el lenguaje y un botón Copiar.
 * `cursor` deja el cursor de escritura adentro del último bloque (no en una
 * línea nueva), así el texto que llega no salta.
 */
import { Marked, type Tokens } from 'marked';
import { escapeHtml, safeHref, unescapeEntities } from '../track-markdown';
import { highlightCode } from '../track-highlight';
import { initialRows, nextReveal, type Reveal } from './scroll';

export const ASSISTANT_MARKDOWN_MAX = 60_000;
const CURSOR_HTML = '<span class="asst-cursor" aria-hidden="true"></span>';

let copyLabel = 'Copy';

/**
 * Tablas y listas largas: cuántos renglones se ven de cada una y el texto del botón. La clave es
 * `t<n>` (la tabla n del mensaje) o `l<n>` (la lista n).
 */
export interface CollapsedRows {
  shown: Record<string, number>;
  label: (r: Reveal) => string;
}
let collapse: CollapsedRows | null = null;
let tableIndex = 0;
let listIndex = 0;

/** Cuántos de `total` se ven y el botón para ver más ('' si ya se ve todo, o sin `collapse`). */
function collapsed(key: string, total: number): { shown: number; button: string } {
  if (!collapse) return { shown: total, button: '' };
  const shown = Math.min(total, collapse.shown[key] ?? initialRows(total));
  const next = nextReveal(total, shown);
  const button = next
    ? `<button type="button" class="btn btn-ghost btn-sm asst-show-rows" data-rows-more="${key}" data-to="${next.to}">${escapeHtml(collapse.label(next))}</button>`
    : '';
  return { shown, button };
}
const LIST_MORE_OPEN = '<div class="asst-list-more">';

const md = new Marked({
  async: false,
  gfm: true,
  breaks: true,
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text);
    },
    link(token: Tokens.Link) {
      const text = this.parser.parseInline(token.tokens);
      const href = safeHref(token.href);
      if (!href) return text;
      const raw = unescapeEntities(href);
      const internal = raw.startsWith('/') && !raw.startsWith('//');
      return internal
        ? `<a href="${escapeHtml(raw)}">${text}</a>`
        : `<a href="${escapeHtml(raw)}" target="_blank" rel="nofollow noopener noreferrer">${text}</a>`;
    },
    image(token: Tokens.Image) {
      const label = escapeHtml(unescapeEntities(token.text || token.href || ''));
      const href = safeHref(token.href);
      if (!href) return label;
      return `<a href="${escapeHtml(unescapeEntities(href))}" target="_blank" rel="nofollow noopener noreferrer">${label}</a>`;
    },
    code(token: Tokens.Code) {
      const lang = (token.lang ?? '').split(/\s+/)[0].slice(0, 20);
      return (
        `<div class="asst-code"><div class="asst-code-head"><span class="asst-code-lang">${escapeHtml(lang || 'text')}</span>` +
        `<button type="button" class="asst-code-copy" data-copy-code>${escapeHtml(copyLabel)}</button></div>` +
        `<pre><code>${highlightCode(token.text, lang || 'generic')}</code></pre></div>\n`
      );
    },
    list(token: Tokens.List) {
      const key = `l${listIndex++}`;
      const { shown, button } = collapsed(key, token.items.length);
      const body = token.items
        .slice(0, shown)
        .map((item) => this.listitem(item))
        .join('');
      const type = token.ordered ? 'ol' : 'ul';
      const start = token.ordered && token.start !== 1 ? ` start="${token.start}"` : '';
      return `<${type}${start}>\n${body}</${type}>\n${button ? `${LIST_MORE_OPEN}${button}</div>\n` : ''}`;
    },
    table(token: Tokens.Table) {
      const cell = (c: Tokens.TableCell, tag: 'th' | 'td') => {
        const align = c.align ? ` style="text-align:${c.align}"` : '';
        return `<${tag}${tag === 'th' ? ' scope="col"' : ''}${align}>${this.parser.parseInline(c.tokens)}</${tag}>`;
      };
      const head = `<tr>${token.header.map((c) => cell(c, 'th')).join('')}</tr>`;
      const { shown, button } = collapsed(`t${tableIndex++}`, token.rows.length);
      const rows = token.rows
        .slice(0, shown)
        .map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`)
        .join('');
      // El botón va en un <caption> abajo: en el código queda antes de las filas, así el cursor de escritura sigue en la última celda.
      const caption = button ? `<caption class="asst-table-more">${button}</caption>` : '';
      return `<div class="table-wrap asst-table"><table class="table table-compact">${caption}<thead>${head}</thead><tbody>${rows}</tbody></table></div>\n`;
    },
  },
});

/** Markdown de una respuesta → HTML seguro para innerHTML. */
export function renderAssistantMarkdown(markdown: string, opts: { cursor?: boolean; copy?: string; rows?: CollapsedRows } = {}): string {
  const src = markdown.slice(0, ASSISTANT_MARKDOWN_MAX);
  copyLabel = opts.copy ?? 'Copy';
  collapse = opts.rows ?? null;
  tableIndex = 0;
  listIndex = 0;
  let html: string;
  try {
    html = src.trim() ? (md.parse(src) as string).trim() : '';
  } finally {
    collapse = null;
  }
  if (!opts.cursor) return html;
  // El cursor va adentro del último bloque (antes de las etiquetas que lo cierran): al final del párrafo,
  // del ítem, de la celda o del código, nunca en una línea propia ni dentro de una etiqueta. Si el último
  // bloque es una lista recortada, va en su último ítem (no en el botón "Mostrar las N").
  const cut = html.endsWith('</div>') ? html.lastIndexOf(LIST_MORE_OPEN) : -1;
  const [body, tail] = cut > 0 && !html.slice(cut + LIST_MORE_OPEN.length).includes('<div') ? [html.slice(0, cut).trimEnd(), `\n${html.slice(cut)}`] : [html, ''];
  return body.replace(/((?:<\/[a-z0-9]+>\s*)*)$/i, `${CURSOR_HTML}$1`) + tail;
}
