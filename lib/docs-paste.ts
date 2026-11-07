import { DOCS_COLOR_NAMES, DOCS_MAX_INDENT, type DocsBlock, type DocsBlockColor, type DocsBlockType } from './docs-types';
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
  toggle?: boolean;
  icon?: string;
  color?: DocsBlockColor;
  indent: number;
  html: string;
}

export function htmlToBlocks(html: string, opts: HtmlToBlocksOptions): DocsBlock[] {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const out: DocsBlock[] = [];
  // 'todo': lista de tareas de Notion (<ul class="to-do-list">, casilla como <div class="checkbox checkbox-on">).
  const lists: Array<'ul' | 'ol' | 'todo'> = [];
  /** <li> abiertos: un <details> adentro de un ítem ya anida por la lista. */
  let liDepth = 0;
  /** Cada <details> abierto: si suma un nivel por su cuenta (no está adentro de un <li>). */
  const details: boolean[] = [];
  /** Nivel del toggle que abre el próximo <summary>. */
  let toggleIndent = 0;
  /** Callout de Notion (<figure class="callout">): el texto del <span class="icon"> es su ícono. */
  let calloutDepth = 0;
  let iconSpan = 0;
  let quoteDepth = 0;
  let skipTag: string | null = null;
  let skipDepth = 0;
  let pre: { html: string; language?: string } | null = null;
  let table: { rows: string[][]; row: string[] | null; cell: string | null } | null = null;
  /** Cierre de cada tag en línea abierto (span con estilos → varias marcas). */
  const inlineStack: Array<{ tag: string; open: string; close: string }> = [];
  let cur: Current | null = null;

  const detailsIndent = () => details.filter(Boolean).length;
  const listIndent = () => Math.min(Math.max(0, lists.length - 1) + detailsIndent(), DOCS_MAX_INDENT);
  const textType = (): DocsBlockType => (quoteDepth > 0 ? 'quote' : 'paragraph');
  // Párrafo suelto adentro de un ítem de lista (o de un toggle): es hijo del ítem.
  const paraIndent = () => Math.min(lists.length + detailsIndent(), DOCS_MAX_INDENT);

  const push = (b: Omit<DocsBlock, 'id'>) => {
    if (out.length < DOCS_IMPORT_MAX_BLOCKS) out.push({ id: newId(), ...b });
  };

  const flush = () => {
    if (!cur) return;
    // Cierra las marcas que quedaron abiertas en este bloque.
    const tail = inlineStack.map((m) => m.close).reverse().join('');
    const content = opts.sanitize(cur.html + tail).replace(/^\s+|\s+$/g, '');
    const isItem = cur.type === 'bulleted_list_item' || cur.type === 'numbered_list_item' || cur.type === 'todo' || cur.type === 'toggle' || cur.type === 'callout';
    if (content || isItem) {
      const b: Omit<DocsBlock, 'id'> = { type: cur.type, content };
      if (cur.level) b.level = cur.level;
      if (cur.toggle) b.toggle = true;
      if (cur.icon) b.icon = cur.icon;
      if (cur.color) b.color = cur.color;
      if (cur.type === 'todo') b.checked = Boolean(cur.checked);
      if (cur.indent > 0) b.indent = cur.indent;
      push(b);
    }
    cur = null;
    // Las marcas abiertas siguen en el bloque que viene (se reabren).
  };

  /** Color de bloque de Notion (class="block-color-red" o "block-color-red_background") para el próximo bloque. */
  let pendingColor: DocsBlockColor | undefined;
  const takeColor = () => {
    const c = pendingColor;
    pendingColor = undefined;
    return c ? { color: c } : {};
  };

  const start = (c: Omit<Current, 'html'>) => {
    flush();
    cur = { ...c, ...takeColor(), html: inlineStack.map((x) => x.open).join('') };
  };

  const appendInline = (frag: string) => {
    if (!cur) cur = { type: textType(), indent: paraIndent(), ...takeColor(), html: inlineStack.map((x) => x.open).join('') };
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
      if (iconSpan > 0 && cur && (cur as Current).type === 'callout') {
        const icon = decodeEntities(raw).trim();
        if (icon && !(cur as Current).icon) (cur as Current).icon = icon.slice(0, 16);
        continue;
      }
      if (pre) pre.html += raw;
      else if (table) {
        if (table.cell !== null) table.cell += raw;
      } else if (raw.trim() || cur) appendInline(raw.replace(/\s+/g, ' '));
      continue;
    }

    if (!closing) {
      const color = /\bblock-color-([a-z]+?)(_background)?\b/.exec(attr(attrs, 'class') ?? '');
      if (color && (DOCS_COLOR_NAMES as readonly string[]).includes(color[1]) && color[1] !== 'default') {
        const value = `${color[1]}${color[2] ? '_bg' : ''}` as DocsBlockColor;
        if (cur && !(cur as Current).html.replace(/<[^>]*>/g, '').trim() && !(cur as Current).color) (cur as Current).color = value;
        else pendingColor = value;
      }
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
      case 'h6': {
        const level = tag === 'h1' ? 1 : tag === 'h2' ? 2 : 3;
        const c = cur as Current | null;
        if (closing) flush();
        // Título adentro del <summary> de un toggle: toggle heading.
        else if (c && c.type === 'toggle' && !c.html.replace(/<[^>]*>/g, '').trim()) {
          c.type = 'heading';
          c.level = level;
          c.toggle = true;
        } else start({ type: 'heading', level, indent: paraIndent() });
        continue;
      }
      case 'ul':
      case 'ol':
        flush();
        if (closing) lists.pop();
        else lists.push(tag === 'ul' && /\bto-do-list\b/.test(attr(attrs, 'class') ?? '') ? 'todo' : tag);
        continue;
      case 'li': {
        if (closing) {
          liDepth = Math.max(0, liDepth - 1);
          flush();
          continue;
        }
        liDepth++;
        const kind = lists[lists.length - 1];
        start({ type: kind === 'ol' ? 'numbered_list_item' : kind === 'todo' ? 'todo' : 'bulleted_list_item', indent: listIndent(), ...(kind === 'todo' ? { checked: false } : {}) });
        continue;
      }
      case 'details':
        if (closing) {
          flush();
          details.pop();
        } else {
          const c = cur as Current | null;
          const inItem = Boolean(c && c.type !== 'paragraph' && c.type !== 'quote' && !c.html.replace(/<[^>]*>/g, '').trim());
          toggleIndent = inItem && c ? c.indent : paraIndent();
          if (!inItem) flush();
          details.push(liDepth === 0 || !inItem);
        }
        continue;
      case 'summary':
        if (closing) flush();
        else {
          const c = cur as Current | null;
          // <ul class="toggle"><li><details><summary>: el ítem vacío pasa a ser el toggle.
          if (c && (c.type === 'bulleted_list_item' || c.type === 'numbered_list_item') && !c.html.replace(/<[^>]*>/g, '').trim()) c.type = 'toggle';
          else start({ type: 'toggle', indent: Math.min(toggleIndent, DOCS_MAX_INDENT) });
        }
        continue;
      case 'figure':
        if (/\bcallout\b/.test(attr(attrs, 'class') ?? '') && !closing) {
          start({ type: 'callout', indent: paraIndent() });
          calloutDepth++;
          continue;
        }
        if (closing && calloutDepth > 0) {
          calloutDepth--;
          flush();
          continue;
        }
        break;
      case 'aside':
        // Callout del Markdown de Notion (<aside>💡 texto</aside>).
        if (!closing) {
          start({ type: 'callout', indent: paraIndent() });
          calloutDepth++;
        } else if (calloutDepth > 0) {
          calloutDepth--;
          flush();
        }
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
      case 'span':
      case 'div':
        if (!closing && iconSpan > 0) {
          iconSpan++;
          continue;
        }
        if (closing && iconSpan > 0) {
          iconSpan--;
          continue;
        }
        if (!closing && cur && (cur as Current).type === 'todo' && /\bcheckbox\b/.test(attr(attrs, 'class') ?? '')) {
          (cur as Current).checked = /\bcheckbox-on\b/.test(attr(attrs, 'class') ?? '');
          continue;
        }
        if (!closing && tag === 'span' && calloutDepth > 0 && /\bicon\b/.test(attr(attrs, 'class') ?? '')) {
          iconSpan = 1;
          continue;
        }
        break;
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
