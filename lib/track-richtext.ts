/**
 * Track — editor visual de descripciones y comentarios (como el de Linear).
 *
 * El contenido se sigue guardando como markdown (el mismo que leen la API, el
 * MCP, los emails y MarkdownView). Este módulo hace las dos mitades puras:
 *
 * - `renderEditorHtml`: markdown → HTML editable. Mismo parser y mismas reglas
 *   de seguridad que `renderTrackMarkdown` (hrefs filtrados, HTML crudo
 *   escapado), pero con nodos pensados para editar: tareas como
 *   `li[data-task]`, código sin resaltar, referencias y menciones como chips
 *   (`data-md` guarda el texto original).
 * - `nodesToMarkdown`: el DOM del editor (o cualquier HTML pegado) → markdown.
 *   Trabaja sobre una interfaz mínima de nodo para poder probarlo sin DOM.
 */
import { Marked, type Tokens } from 'marked';
import {
  escapeHtml,
  ISSUE_REF_RE,
  ISSUE_REF_START,
  ISSUE_URL_RE,
  isOwnUpload,
  MENTION_RE,
  safeHref,
  TRACK_MARKDOWN_MAX,
  unescapeEntities,
} from './track-markdown';

// ---------- markdown → HTML editable ----------

const editorMd = new Marked({
  async: false,
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: 'issueRef',
      level: 'inline',
      start(src: string) {
        const m = ISSUE_REF_START.exec(src);
        return m ? m.index + m[1].length : undefined;
      },
      tokenizer(src: string) {
        const m = ISSUE_REF_RE.exec(src);
        return m ? { type: 'issueRef', raw: m[0], text: m[1] } : undefined;
      },
      renderer(token) {
        const id = escapeHtml(String(token.text));
        return `<span class="track-chip track-chip-issue" contenteditable="false" data-md="${id}" data-issue-ref="${id}">${id}</span>`;
      },
    },
    {
      name: 'mention',
      level: 'inline',
      start(src: string) {
        const i = src.indexOf('@');
        return i < 0 ? undefined : i;
      },
      tokenizer(src: string) {
        if (ISSUE_REF_RE.test(src)) return undefined;
        const m = MENTION_RE.exec(src);
        return m ? { type: 'mention', raw: m[0], text: m[0] } : undefined;
      },
      renderer(token) {
        const text = escapeHtml(String(token.text));
        return `<span class="track-chip track-chip-mention" contenteditable="false" data-md="${text}" data-mention="${text}">${text}</span>`;
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
      const issue = ISSUE_URL_RE.exec(unescapeEntities(href));
      const cls = issue ? ` class="track-issue-link" data-issue-ref="${escapeHtml(issue[1])}"` : '';
      return `<a href="${escapeHtml(href)}"${cls}>${text}</a>`;
    },
    image(token: Tokens.Image) {
      const label = escapeHtml(unescapeEntities(token.text || ''));
      const href = safeHref(token.href);
      if (!href) return label;
      // Solo los adjuntos propios se ven como imagen (igual que la lectura);
      // las de terceros quedan como link que vuelve a guardarse como imagen.
      if (isOwnUpload(unescapeEntities(href))) return `<img src="${escapeHtml(href)}" alt="${label}">`;
      return `<a href="${escapeHtml(href)}" data-md-image="1">${label || escapeHtml(href)}</a>`;
    },
    code(token: Tokens.Code) {
      const lang = (token.lang || '').split(/\s+/)[0];
      return `<pre${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(token.text)}\n</code></pre>\n`;
    },
    listitem(item: Tokens.ListItem) {
      const body = this.parser.parse(item.tokens, Boolean(item.loose));
      if (!item.task) return `<li>${body}</li>\n`;
      return `<li data-task="1" data-checked="${item.checked ? 'true' : 'false'}">${body}</li>\n`;
    },
    checkbox() {
      return '';
    },
  },
});

/** Markdown guardado → HTML para el editor (vacío: un párrafo vacío). */
export function renderEditorHtml(markdown: string): string {
  if (!markdown.trim()) return '<p><br></p>';
  // Sin saltos entre etiquetas: el editor usa white-space: pre-wrap y los
  // mostraría como líneas vacías (el código va escapado, no tiene `>` crudos).
  const html = (editorMd.parse(markdown.slice(0, TRACK_MARKDOWN_MAX)) as string).trim().replace(/>\s*\n\s*</g, '><');
  return html || '<p><br></p>';
}

// ---------- DOM → markdown ----------

/** Lo mínimo de un nodo del DOM que usa el serializador. */
export interface RtNode {
  nodeType: number;
  nodeName: string;
  childNodes: ArrayLike<RtNode>;
  textContent: string | null;
  getAttribute?: (name: string) => string | null;
}

const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'PRE', 'BLOCKQUOTE', 'HR', 'TABLE', 'FIGURE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'SVG', 'IFRAME', 'OBJECT']);

function kids(n: RtNode): RtNode[] {
  return Array.from(n.childNodes ?? []);
}
function name(n: RtNode): string {
  return n.nodeName.toUpperCase();
}
function attr(n: RtNode, key: string): string | null {
  return n.getAttribute ? n.getAttribute(key) : null;
}
function isBlock(n: RtNode): boolean {
  return n.nodeType === 1 && BLOCKS.has(name(n));
}
function cleanText(s: string): string {
  return s.replace(/​/g, '').replace(/ /g, ' ');
}

/** Escapa lo que markdown leería como formato dentro de un texto. */
export function escapeInline(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/`/g, '\\`')
    .replace(/~~/g, '\\~\\~')
    .replace(/\[(?=[^\]]*\])/g, '\\[')
    .replace(/(^|[^A-Za-z0-9])_|_(?=$|[^A-Za-z0-9])/g, (m, pre: string | undefined) => (pre !== undefined ? `${pre}\\_` : '\\_'));
}

/** Escapa marcadores de bloque al principio de una línea de párrafo. */
function escapeLineStart(line: string): string {
  const ordered = /^(\d+)([.)])(\s)/.exec(line);
  if (ordered) return `${ordered[1]}\\${ordered[2]}${ordered[3]}${line.slice(ordered[0].length)}`;
  if (/^(#{1,6}(\s|$)|>|[-+](\s|$)|```|~~~|-{3,}\s*$|={3,}\s*$)/.test(line)) return `\\${line}`;
  return line;
}

function wrapMark(mark: string, inner: string): string {
  if (!inner.trim()) return inner;
  const lead = /^\s*/.exec(inner)![0];
  const trail = /\s*$/.exec(inner)![0];
  const core = inner.slice(lead.length, inner.length - trail.length);
  return `${lead}${mark}${core}${mark}${trail}`;
}

function codeSpan(text: string): string {
  const t = cleanText(text).replace(/\n/g, ' ');
  if (!t) return '';
  const ticks = (t.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
  const fence = '`'.repeat(ticks + 1);
  const pad = t.startsWith('`') || t.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${t}${pad}${fence}`;
}

function encodeHref(href: string): string {
  return href.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function inlineMd(nodes: RtNode[]): string {
  let out = '';
  for (const n of nodes) out += inlineNode(n);
  return out;
}

function inlineNode(n: RtNode): string {
  if (n.nodeType === 3) return escapeInline(cleanText(n.textContent ?? ''));
  if (n.nodeType !== 1) return '';
  const tag = name(n);
  if (SKIP.has(tag)) return '';
  const md = attr(n, 'data-md');
  if (md !== null) return md;
  switch (tag) {
    case 'BR':
      return '\n';
    case 'STRONG':
    case 'B':
      return wrapMark('**', inlineMd(kids(n)));
    case 'EM':
    case 'I':
      return wrapMark('*', inlineMd(kids(n)));
    case 'S':
    case 'DEL':
    case 'STRIKE':
      return wrapMark('~~', inlineMd(kids(n)));
    case 'CODE':
    case 'KBD':
    case 'SAMP':
      return codeSpan(n.textContent ?? '');
    case 'IMG': {
      const src = safeHref(attr(n, 'src'));
      if (!src || src.startsWith('data:')) return '';
      const alt = cleanText(attr(n, 'alt') ?? '').replace(/[[\]]/g, '');
      return `![${alt}](${encodeHref(src)})`;
    }
    case 'A': {
      const href = safeHref(attr(n, 'href'));
      const text = inlineMd(kids(n));
      if (!href) return text;
      if (attr(n, 'data-md-image')) return `![${cleanText(n.textContent ?? '').replace(/[[\]]/g, '')}](${encodeHref(href)})`;
      const plain = cleanText(n.textContent ?? '').trim();
      if (!plain) return '';
      if (plain === href && /^https?:\/\//.test(href)) return href;
      return `[${text.trim()}](${encodeHref(href)})`;
    }
    default:
      if (isBlock(n)) return `\n${blocks(n).join('\n\n')}\n`;
      return inlineMd(kids(n));
  }
}

/** Texto de un párrafo: saltos de línea propios, sin espacios iniciales ni marcadores sueltos. */
function paragraph(nodes: RtNode[]): string {
  const text = inlineMd(nodes)
    .split('\n')
    .map((l) => escapeLineStart(l.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '').replace(/(\S) {2,}(?=\S)/g, '$1 ')))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
  return text.trim() ? text : '';
}

function blocks(parent: RtNode): string[] {
  const out: string[] = [];
  let inline: RtNode[] = [];
  const flush = () => {
    if (!inline.length) return;
    const t = paragraph(inline);
    if (t) out.push(t);
    inline = [];
  };
  for (const n of kids(parent)) {
    if (n.nodeType === 1 && SKIP.has(name(n))) continue;
    if (isBlock(n)) {
      flush();
      const b = block(n);
      if (b) out.push(b);
    } else {
      inline.push(n);
    }
  }
  flush();
  return out;
}

function hasBlockChild(n: RtNode): boolean {
  return kids(n).some(isBlock);
}

function block(n: RtNode): string {
  const tag = name(n);
  switch (tag) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const text = inlineMd(kids(n)).replace(/\n+/g, ' ').trim();
      return text ? `${'#'.repeat(Number(tag[1]))} ${text}` : '';
    }
    case 'UL':
    case 'OL':
      return list(n);
    case 'LI':
      // Un li suelto (pegado sin lista): como ítem de viñeta.
      return listItem(n, '- ');
    case 'PRE': {
      const lang = (attr(n, 'data-lang') ?? '').replace(/[^\w+#.-]/g, '');
      const text = cleanText(preText(n)).replace(/\n$/, '');
      if (!text.trim() && !lang) return '';
      const ticks = (text.match(/`{3,}/g) ?? []).reduce((m, s) => Math.max(m, s.length + 1), 3);
      const fence = '`'.repeat(ticks);
      return `${fence}${lang}\n${text}\n${fence}`;
    }
    case 'BLOCKQUOTE': {
      const inner = blocks(n).join('\n\n');
      if (!inner.trim()) return '';
      return inner
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n');
    }
    case 'HR':
      return '---';
    case 'TABLE':
      return table(n);
    default:
      // P, DIV, FIGURE…: párrafo, o sus bloques si los tiene adentro.
      return hasBlockChild(n) ? blocks(n).join('\n\n') : paragraph(kids(n));
  }
}

/** Texto de un bloque de código: los <br> y <div> que mete el navegador cuentan como saltos. */
function preText(n: RtNode): string {
  let out = '';
  const walk = (x: RtNode) => {
    for (const c of kids(x)) {
      if (c.nodeType === 3) out += c.textContent ?? '';
      else if (c.nodeType === 1) {
        const tag = name(c);
        if (tag === 'BR') out += '\n';
        else if (tag === 'DIV' || tag === 'P') {
          if (out && !out.endsWith('\n')) out += '\n';
          walk(c);
        } else walk(c);
      }
    }
  };
  walk(n);
  return out;
}

function indent(text: string, pad: string): string {
  return text
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n');
}

function listItem(li: RtNode, marker: string): string {
  const task = attr(li, 'data-task') !== null;
  const checked = attr(li, 'data-checked') === 'true';
  const box = task ? (checked ? '[x] ' : '[ ] ') : '';
  const pad = ' '.repeat(marker.length);
  const head: RtNode[] = [];
  const rest: string[] = [];
  let seenBlock = false;
  for (const c of kids(li)) {
    if (c.nodeType === 1 && SKIP.has(name(c))) continue;
    const tag = c.nodeType === 1 ? name(c) : '';
    if (!seenBlock && (tag === 'P' || tag === 'DIV') && !hasBlockChild(c) && head.length === 0) {
      // Ítem "suelto" de marked (<li><p>texto</p></li>): el primer párrafo es la línea del ítem.
      head.push(...kids(c));
      seenBlock = true;
      continue;
    }
    if (isBlock(c)) {
      seenBlock = true;
      const b = block(c);
      if (b) rest.push(b);
      continue;
    }
    if (seenBlock) {
      const t = paragraph([c]);
      if (t) rest.push(t);
    } else head.push(c);
  }
  const text = inlineMd(head)
    .split('\n')
    .map((l) => l.replace(/^[ \t]+/, '').replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
  const nested = rest.map((b) => indent(b, pad));
  if (!text.trim() && !nested.length) return '';
  const first = `${marker}${box}${text.replace(/\n/g, `\n${pad}`)}`.trimEnd();
  return [first, ...nested].join('\n');
}

function list(n: RtNode): string {
  const ordered = name(n) === 'OL';
  const start = Number(attr(n, 'start') ?? '1') || 1;
  const items = kids(n).filter((c) => c.nodeType === 1 && name(c) === 'LI');
  const lines: string[] = [];
  items.forEach((li, i) => {
    const marker = ordered ? `${start + i}. ` : '- ';
    lines.push(listItem(li, marker));
  });
  // Listas anidadas pegadas como hijas directas de la lista (HTML de Chrome al indentar).
  return lines.filter((l) => l.trim()).join('\n');
}

function table(n: RtNode): string {
  const rows: RtNode[] = [];
  const walk = (x: RtNode) => {
    for (const c of kids(x)) {
      if (c.nodeType !== 1) continue;
      const t = name(c);
      if (t === 'TR') rows.push(c);
      else if (t === 'THEAD' || t === 'TBODY' || t === 'TFOOT') walk(c);
    }
  };
  walk(n);
  if (!rows.length) return '';
  const cells = rows.map((r) =>
    kids(r)
      .filter((c) => c.nodeType === 1 && (name(c) === 'TD' || name(c) === 'TH'))
      .map((c) => inlineMd(kids(c)).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim()),
  );
  const width = Math.max(...cells.map((r) => r.length), 1);
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  return [line(cells[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...cells.slice(1).map(line)].join('\n');
}

/** DOM del editor (o HTML pegado) → markdown. */
export function nodesToMarkdown(root: RtNode): string {
  // Listas hermanas sueltas (Chrome a veces parte una lista en dos al indentar)
  // quedan como bloques seguidos: se juntan con un salto simple.
  const parts = blocks(root);
  const out: string[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    const isList = (s: string) => /^(\s*)([-*+]|\d+\.)\s/.test(s);
    if (prev !== undefined && isList(prev) && isList(p)) out[out.length - 1] = `${prev}\n${p}`;
    else out.push(p);
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- reglas de escritura (markdown shortcuts) ----------

export type BlockRule =
  | { kind: 'heading'; level: 1 | 2 | 3 }
  | { kind: 'bullet' }
  | { kind: 'numbered' }
  | { kind: 'todo'; checked: boolean }
  | { kind: 'quote' }
  | { kind: 'code'; lang: string };

/**
 * Texto al principio de un bloque recién completado con espacio (o con la
 * tercera comilla) → bloque a crear. Como en Linear: `# `, `- `, `1. `,
 * `[] `, `> `, ``` ``` ```.
 */
export function blockRuleFor(prefix: string): BlockRule | null {
  if (/^#\s$/.test(prefix)) return { kind: 'heading', level: 1 };
  if (/^##\s$/.test(prefix)) return { kind: 'heading', level: 2 };
  if (/^###\s$/.test(prefix)) return { kind: 'heading', level: 3 };
  if (/^[-*+]\s$/.test(prefix)) return { kind: 'bullet' };
  if (/^1[.)]\s$/.test(prefix)) return { kind: 'numbered' };
  if (/^\[\s?\]\s$/.test(prefix)) return { kind: 'todo', checked: false };
  if (/^\[x\]\s$/i.test(prefix)) return { kind: 'todo', checked: true };
  if (/^>\s$/.test(prefix)) return { kind: 'quote' };
  const code = /^```([\w+#.-]*)$/.exec(prefix);
  if (code) return { kind: 'code', lang: code[1] };
  return null;
}

export type InlineRule = { tag: 'strong' | 'em' | 's' | 'code'; start: number; text: string };

/**
 * Formato en línea al cerrar el marcador, como en Linear: **negrita**,
 * *itálica* o _itálica_, ~~tachado~~ y `código`. `before` es el texto del
 * nodo hasta el cursor; devuelve dónde empieza el marcador y el contenido.
 */
export function inlineRuleFor(before: string): InlineRule | null {
  let m = /\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/.exec(before);
  if (m) return { tag: 'strong', start: m.index, text: m[1] };
  m = /~~([^~\s](?:[^~]*[^~\s])?)~~$/.exec(before);
  if (m) return { tag: 's', start: m.index, text: m[1] };
  m = /`([^`]+)`$/.exec(before);
  if (m) return { tag: 'code', start: m.index, text: m[1] };
  m = /(^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/.exec(before);
  if (m) return { tag: 'em', start: m.index + m[1].length, text: m[2] };
  m = /(^|[^_\w])_([^_\s](?:[^_]*[^_\s])?)_$/.exec(before);
  if (m) return { tag: 'em', start: m.index + m[1].length, text: m[2] };
  return null;
}

/** ¿Lo pegado parece markdown con estructura (para convertirlo en bloques)? */
export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|.*\|)|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`/.test(text);
}
