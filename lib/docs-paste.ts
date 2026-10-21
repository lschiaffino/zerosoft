import { DOCS_MAX_INDENT, type DocsBlock, type DocsBlockType } from './docs-types';
import { decodeEntities } from './docs-markdown';
import { DOCS_IMPORT_MAX_BLOCKS } from './docs-import';

/**
 * HTML pegado (Google Docs, Word, Notion, la web) → bloques de Docs. Un
 * tokenizador acotado, sin DOM (así se prueba en Node): reconoce los
 * elementos de bloque (párrafos, headings, listas anidadas, tareas, citas,
 * código, tablas, separadores) y deja el HTML en línea para que lo sanee
 * quien llama (en el editor, lib/docs-richtext.ts → subset HTML-lite). Lo que
 * no se reconoce se desenvuelve y queda el texto; script/style y similares se
 * descartan con su contenido.
 */

export interface HtmlToBlocksOptions {
  sanitize: (html: string) => string;
  newId?: () => string;
}

/** Su contenido se descarta entero. */
const SKIP = new Set(['script', 'style', 'head', 'title', 'template', 'noscript', 'svg', 'math', 'iframe', 'object', 'button', 'select', 'textarea']);
/** Cortan el bloque en curso (abren y cierran párrafos). */
const BREAKS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'address', 'dt', 'dd', 'dl', 'details', 'summary', 'center']);
const INLINE_MARKS: Record<string, string> = {
  strong: 'strong',
  b: 'strong',
  em: 'em',
  i: 'em',
  u: 'u',
  ins: 'u',
  s: 's',
  strike: 's',
  del: 's',
  code: 'code',
  kbd: 'code',
};

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null;
}

/** Marcas que un `style` en línea aplica (Google Docs usa spans con estilos). */
function styleMarks(style: string): string[] {
  const s = style.toLowerCase();
  const out: string[] = [];
  if (/font-weight\s*:\s*(bold|[6-9]00)/.test(s)) out.push('strong');
  if (/font-style\s*:\s*italic/.test(s)) out.push('em');
  if (/text-decoration[^;]*underline/.test(s)) out.push('u');
  if (/text-decoration[^;]*line-through/.test(s)) out.push('s');
  return out;
}

interface Current {
  type: DocsBlockType;
  level?: 1 | 2 | 3;
  checked?: boolean;
  indent: number;
  html: string;
}

export function htmlToBlocks(html: string, opts: HtmlToBlocksOptions): DocsBlock[] {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const out: DocsBlock[] = [];
  const lists: Array<'ul' | 'ol'> = [];
  let quoteDepth = 0;
  let skipTag: string | null = null;
  let skipDepth = 0;
  let pre: { html: string; language?: string } | null = null;
  let table: { rows: string[][]; row: string[] | null; cell: string | null } | null = null;
  /** Cierre de cada tag en línea abierto (span con estilos → varias marcas). */
  const inlineStack: Array<{ tag: string; open: string; close: string }> = [];
  let cur: Current | null = null;

  const listIndent = () => Math.min(Math.max(0, lists.length - 1), DOCS_MAX_INDENT);
  const textType = (): DocsBlockType => (quoteDepth > 0 ? 'quote' : 'paragraph');
  // Párrafo suelto adentro de un ítem de lista: es hijo del ítem.
  const paraIndent = () => (lists.length ? Math.min(lists.length, DOCS_MAX_INDENT) : 0);

  const push = (b: Omit<DocsBlock, 'id'>) => {
    if (out.length < DOCS_IMPORT_MAX_BLOCKS) out.push({ id: newId(), ...b });
  };

  const flush = () => {
    if (!cur) return;
    // Cierra las marcas que quedaron abiertas en este bloque.
    const tail = inlineStack.map((m) => m.close).reverse().join('');
    const content = opts.sanitize(cur.html + tail).replace(/^\s+|\s+$/g, '');
    const isItem = cur.type === 'bulleted_list_item' || cur.type === 'numbered_list_item' || cur.type === 'todo';
    if (content || isItem) {
      const b: Omit<DocsBlock, 'id'> = { type: cur.type, content };
      if (cur.level) b.level = cur.level;
      if (cur.type === 'todo') b.checked = Boolean(cur.checked);
      if (cur.indent > 0) b.indent = cur.indent;
      push(b);
    }
    cur = null;
    // Las marcas abiertas siguen en el bloque que viene (se reabren).
  };

  const start = (c: Omit<Current, 'html'>) => {
    flush();
    cur = { ...c, html: inlineStack.map((x) => x.open).join('') };
  };

  const appendInline = (frag: string) => {
    if (!cur) cur = { type: textType(), indent: paraIndent(), html: inlineStack.map((x) => x.open).join('') };
    cur.html += frag;
  };

  /** Agrega al bloque en curso, si hay (no abre uno nuevo). */
  const appendRaw = (frag: string) => {
    if (cur) cur.html += frag;
  };

  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [token, slash, rawTag, attrs = '', text] = m;
    if (token.startsWith('<!')) continue;
    const tag = rawTag?.toLowerCase().replace(/^\w+:/, '') ?? '';
    const closing = slash === '/';

    if (skipTag) {
      if (tag === skipTag) skipDepth += closing ? -1 : 1;
      if (skipDepth === 0) skipTag = null;
      continue;
    }

    if (text !== undefined || token === '<') {
      const raw = text ?? '&lt;';
      if (pre) pre.html += raw;
      else if (table) {
        if (table.cell !== null) table.cell += raw;
      } else if (raw.trim() || cur) appendInline(raw.replace(/\s+/g, ' '));
      continue;
    }

    if (SKIP.has(tag)) {
      if (!closing && !/\/\s*$/.test(attrs)) {
        skipTag = tag;
        skipDepth = 1;
      }
      continue;
    }

    // Código: el contenido es texto (los tags de resaltado se descartan).
    if (pre) {
      if (tag === 'pre' && closing) {
        flush();
        const code = pre.html.replace(/<br\s*\/?>/gi, '\n').replace(/\n$/, '');
        push({ type: 'code', content: code, ...(pre.language ? { language: pre.language } : {}) });
        pre = null;
      } else if (tag === 'br') pre.html += '\n';
      else if (tag === 'code' && !closing) {
        const lang = /language-([\w+#-]+)/.exec(attr(attrs, 'class') ?? '')?.[1];
        if (lang && !pre.language) pre.language = lang.slice(0, 40);
      }
      continue;
    }

    // Tablas: celdas como texto plano.
    if (table) {
      if (tag === 'table' && closing) {
        if (table.row?.length) table.rows.push(table.row);
        const rows = table.rows.filter((r) => r.length).slice(0, 200).map((r) => r.slice(0, 20));
        if (rows.length) push({ type: 'table', content: '', rows });
        table = null;
      } else if (tag === 'tr') {
        if (table.row?.length) table.rows.push(table.row);
        table.row = closing ? null : [];
      } else if (tag === 'td' || tag === 'th') {
        if (!closing) table.cell = '';
        else if (table.cell !== null) {
          (table.row ??= []).push(decodeEntities(table.cell.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim());
          table.cell = null;
        }
      } else if ((tag === 'br' || tag === 'p') && table.cell !== null) table.cell += ' ';
      continue;
    }

    switch (tag) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        if (closing) flush();
        else start({ type: 'heading', level: tag === 'h1' ? 1 : tag === 'h2' ? 2 : 3, indent: paraIndent() });
        continue;
      case 'ul':
      case 'ol':
        flush();
        if (closing) lists.pop();
        else lists.push(tag);
        continue;
      case 'li':
        if (closing) flush();
        else start({ type: lists[lists.length - 1] === 'ol' ? 'numbered_list_item' : 'bulleted_list_item', indent: listIndent() });
        continue;
      case 'blockquote':
        flush();
        quoteDepth = Math.max(0, quoteDepth + (closing ? -1 : 1));
        continue;
      case 'pre':
        if (!closing) {
          flush();
          pre = { html: '' };
        }
        continue;
      case 'table':
        if (!closing) {
          flush();
          table = { rows: [], row: null, cell: null };
        }
        continue;
      case 'hr':
        flush();
        push({ type: 'divider', content: '' });
        continue;
      case 'br':
        appendRaw('<br>');
        continue;
      case 'input': {
        // Tareas (GitHub, Notion): <li><input type="checkbox" checked> …
        if (cur && (attr(attrs, 'type') ?? '').toLowerCase() === 'checkbox') {
          const c = cur as Current;
          if (c.type === 'bulleted_list_item' || c.type === 'numbered_list_item') {
            c.type = 'todo';
            c.checked = /\bchecked\b/i.test(attrs);
          }
        }
        continue;
      }
      case 'a':
        if (closing) {
          const i = inlineStack.map((x) => x.tag).lastIndexOf('a');
          if (i !== -1) {
            inlineStack.splice(i, 1);
            appendInline('</a>');
          }
        } else {
          const href = attr(attrs, 'href');
          if (href) {
            const open = `<a href="${href.replace(/"/g, '&quot;')}">`;
            appendInline(open);
            inlineStack.push({ tag: 'a', open, close: '</a>' });
          }
        }
        continue;
      default:
        break;
    }

    if (BREAKS.has(tag)) {
      // El primer párrafo dentro de un ítem de lista es el texto del ítem.
      const c = cur as Current | null;
      const inEmptyItem = c && !c.html.replace(/<[^>]*>/g, '').trim() && c.type !== 'paragraph' && c.type !== 'quote';
      if (!inEmptyItem) flush();
      continue;
    }

    // Marcas en línea (y spans con estilos). Google Docs envuelve todo en un
    // <b style="font-weight:normal">: ese no marca nada.
    const style = attr(attrs, 'style') ?? '';
    if (closing) {
      const i = inlineStack.map((x) => x.tag).lastIndexOf(tag);
      if (i !== -1) {
        const [mark] = inlineStack.splice(i, 1);
        if (mark.close) appendRaw(mark.close);
      }
      continue;
    }
    if (/\/\s*$/.test(attrs)) continue;
    let marks: string[] = [];
    const base = INLINE_MARKS[tag];
    if (base && !(base === 'strong' && /font-weight\s*:\s*(normal|[1-4]00)/i.test(style))) marks.push(base);
    marks = [...marks, ...styleMarks(style).filter((x) => !marks.includes(x))];
    const open = marks.map((x) => `<${x}>`).join('');
    // Primero el texto abierto (appendInline repite las marcas ya abiertas al
    // crear el bloque) y después se apila: las abiertas se reabren en el bloque siguiente.
    if (open) appendInline(open);
    inlineStack.push({ tag, open, close: marks.map((x) => `</${x}>`).reverse().join('') });
  }
  flush();
  return out;
}

/**
 * ¿El HTML pegado tiene estructura de bloques (más de un párrafo, listas,
 * headings, tablas…)? Si no, el pegado sigue siendo en línea dentro del bloque.
 */
export function shouldSplitPaste(blocks: DocsBlock[]): boolean {
  if (blocks.length > 1) return true;
  return blocks.length === 1 && blocks[0].type !== 'paragraph';
}
