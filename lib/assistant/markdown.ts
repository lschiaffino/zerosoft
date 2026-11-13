/**
 * Respuestas del asistente: Markdown → HTML seguro (corre en el navegador
 * mientras llega el texto). Mismo parser y mismas reglas que Track y los
 * playbooks del CRM (lib/track-markdown.ts):
 * - el HTML crudo nunca pasa: se escapa y se ve como texto;
 * - links solo http(s), mailto o rutas relativas (las de la app abren en la
 *   misma pestaña, las de afuera en otra y sin referrer);
 * - las imágenes quedan como link (nada se carga de terceros);
 * - las tablas van en .table-wrap (scroll propio, sin estirar la charla);
 * - los bloques de código llevan el lenguaje y un botón Copiar.
 * `cursor` deja el cursor de escritura adentro del último bloque (no en una
 * línea nueva), así el texto que llega no salta.
 */
import { Marked, type Tokens } from 'marked';
import { escapeHtml, safeHref, unescapeEntities } from '../track-markdown';
import { highlightCode } from '../track-highlight';

export const ASSISTANT_MARKDOWN_MAX = 60_000;
const CURSOR_HTML = '<span class="asst-cursor" aria-hidden="true"></span>';

let copyLabel = 'Copy';

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
    table(token: Tokens.Table) {
      const cell = (c: Tokens.TableCell, tag: 'th' | 'td') => {
        const align = c.align ? ` style="text-align:${c.align}"` : '';
        return `<${tag}${tag === 'th' ? ' scope="col"' : ''}${align}>${this.parser.parseInline(c.tokens)}</${tag}>`;
      };
      const head = `<tr>${token.header.map((c) => cell(c, 'th')).join('')}</tr>`;
      const rows = token.rows.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('');
      return `<div class="table-wrap asst-table"><table class="table table-compact"><thead>${head}</thead><tbody>${rows}</tbody></table></div>\n`;
    },
  },
});

/** Markdown de una respuesta → HTML seguro para innerHTML. */
export function renderAssistantMarkdown(markdown: string, opts: { cursor?: boolean; copy?: string } = {}): string {
  const src = markdown.slice(0, ASSISTANT_MARKDOWN_MAX);
  copyLabel = opts.copy ?? 'Copy';
  const html = src.trim() ? (md.parse(src) as string).trim() : '';
  if (!opts.cursor) return html;
  // El cursor va adentro del último bloque (antes de las etiquetas que lo cierran): al final del párrafo,
  // del ítem, de la celda o del código, nunca en una línea propia ni dentro de una etiqueta.
  return html.replace(/((?:<\/[a-z0-9]+>\s*)*)$/i, `${CURSOR_HTML}$1`);
}
