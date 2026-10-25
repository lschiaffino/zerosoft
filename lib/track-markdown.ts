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
import { highlightCode, resolveLang } from './track-highlight';

/** Mismo largo máximo que el schema de comentarios / descripción. */
export const TRACK_MARKDOWN_MAX = 5000;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Deshace las entidades que marked ya aplicó, para re-escapar una sola vez. */
export function unescapeEntities(value: string): string {
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
export const MENTION_RE = /^@(?:[\w.-]+@[\w.-]+\.\w{2,}|[A-Z][a-zA-Z]*(?:[ \t]+[A-Z][a-zA-Z]*){0,2})/;

/** Identificador de issue (ZER-12): proyecto en mayúsculas, guion y número. */
export const ISSUE_REF_RE = /^@?([A-Z][A-Z0-9]{1,15}(?:-[A-Z0-9]{1,16}){0,3}-\d{1,6})(?![\w-])/;
export const ISSUE_REF_START = /(^|[^\w@/-])@?[A-Z][A-Z0-9]{1,15}(?:-[A-Z0-9]{1,16}){0,3}-\d/;

/** Link a un issue de Track (/app/track/issues/<id>, con o sin locale y dominio). */
export const ISSUE_URL_RE = /\/(?:[a-z]{2}\/)?app\/track\/issues\/([A-Za-z0-9-]{8,80})(?:[?#].*)?$/;

/** Archivos subidos a zerosoft (adjuntos): estos sí se muestran como imagen. */
export function isOwnUpload(href: string): boolean {
  return href.startsWith('/uploads/') || /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(href);
}

// Contador de checkboxes del render en curso (para tildarlos desde la lectura).
let taskIndex = 0;
let interactiveTasks = false;

const md = new Marked({
  async: false,
  gfm: true,
  breaks: true,
  extensions: [
    {
      // ZER-12 (o @ZER-12) → referencia a issue; el cliente le pone estado y link.
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
        return `<span class="track-issue-ref" data-issue-ref="${id}">${id}</span>`;
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
        // @ZER-12 es una referencia a issue, no una persona.
        if (ISSUE_REF_RE.test(src)) return undefined;
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
      // Link pegado a un issue de Track: se abre en la app y muestra su estado.
      const issue = ISSUE_URL_RE.exec(unescapeEntities(href));
      if (issue) {
        return `<a href="${escapeHtml(href)}"${title} class="track-issue-link" data-issue-ref="${escapeHtml(issue[1])}">${text}</a>`;
      }
      return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="nofollow noopener noreferrer">${text}</a>`;
    },
    image(token: Tokens.Image) {
      const label = escapeHtml(unescapeEntities(token.text || token.href || ''));
      const href = safeHref(token.href);
      if (!href) return label;
      // Imágenes pegadas (adjuntos propios) se ven; las de terceros quedan como link.
      if (isOwnUpload(unescapeEntities(href))) {
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="track-md-image"><img src="${escapeHtml(href)}" alt="${label}" loading="lazy"></a>`;
      }
      return `<a href="${escapeHtml(href)}" target="_blank" rel="nofollow noopener noreferrer">${label}</a>`;
    },
    code(token: Tokens.Code) {
      const lang = resolveLang(token.lang);
      const cls = lang ? ` class="language-${lang}"` : '';
      const label = token.lang ? `<span class="track-code-lang">${escapeHtml(token.lang.split(/\s+/)[0])}</span>` : '';
      // Sin lenguaje se resalta igual con las palabras clave más comunes (JS, Python).
      return `<pre class="track-code">${label}<code${cls}>${highlightCode(token.text, token.lang || 'generic')}</code></pre>\n`;
    },
    checkbox({ checked }: Tokens.Checkbox) {
      const n = taskIndex++;
      return `<input type="checkbox" class="track-task" data-task="${n}"${checked ? ' checked' : ''}${interactiveTasks ? '' : ' disabled'}> `;
    },
  },
});

/**
 * Markdown de un comentario o descripción → HTML seguro para innerHTML.
 * `interactive`: los checkboxes de las listas de tareas se pueden tildar.
 */
export function renderTrackMarkdown(markdown: string, opts: { interactive?: boolean } = {}): string {
  if (!markdown.trim()) return '';
  taskIndex = 0;
  interactiveTasks = Boolean(opts.interactive);
  try {
    return (md.parse(markdown.slice(0, TRACK_MARKDOWN_MAX)) as string).trim();
  } finally {
    interactiveTasks = false;
  }
}

/** Identificadores de issue citados (ZER-12) e ids de links a issues, sin repetir. */
export function extractIssueRefs(markdown: string): string[] {
  const out = new Set<string>();
  const html = renderTrackMarkdown(markdown);
  for (const m of html.matchAll(/data-issue-ref="([^"]+)"/g)) out.add(m[1]);
  return Array.from(out);
}

// ---------- Listas de tareas ----------

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/**
 * Tilda o destilda la tarea número `index` (en orden de aparición, fuera de
 * los bloques de código). Devuelve el texto nuevo o el mismo si no existe.
 */
export function toggleTaskInSource(source: string, index: number): string {
  const lines = source.split('\n');
  let fence = false;
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const m = TASK_LINE.exec(lines[i]);
    if (!m) continue;
    if (n === index) {
      const next = m[2] === ' ' ? 'x' : ' ';
      lines[i] = lines[i].replace(TASK_LINE, `$1${next}$3`);
      return lines.join('\n');
    }
    n++;
  }
  return source;
}

// ---------- Atajos de escritura (como el editor de Linear) ----------

export interface EditResult {
  value: string;
  cursor: number;
}

const LIST_ITEM = /^(\s*)([-*+]|(\d+)[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/;

/**
 * Enter dentro de un ítem de lista: sigue la lista (numerada suma uno, una
 * tarea nueva arranca sin tildar). En un ítem vacío corta la lista. Fuera de
 * una lista, null (Enter normal).
 */
export function continueList(value: string, cursor: number): EditResult | null {
  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
  const nl = value.indexOf('\n', cursor);
  const lineEnd = nl < 0 ? value.length : nl;
  const line = value.slice(lineStart, lineEnd);
  const m = LIST_ITEM.exec(line);
  if (!m) return null;
  // Dentro de un bloque de código no hay listas.
  const before = value.slice(0, lineStart);
  if ((before.match(/^\s*```/gm) ?? []).length % 2 === 1) return null;
  const [, indent, bullet, num, space, task, text] = m;
  if (!text.trim() && cursor >= lineEnd) {
    // Ítem vacío: se borra el marcador y se sale de la lista.
    const next = value.slice(0, lineStart) + value.slice(lineEnd);
    return { value: next, cursor: lineStart };
  }
  const marker = num ? `${Number(num) + 1}${bullet.slice(-1)}` : bullet;
  const insert = `\n${indent}${marker}${space}${task ? '[ ] ' : ''}`;
  return { value: value.slice(0, cursor) + insert + value.slice(cursor), cursor: cursor + insert.length };
}

/** Tab / Shift+Tab en un ítem de lista: lo anida o lo desanida (2 espacios). */
export function indentListItem(value: string, cursor: number, outdent: boolean): EditResult | null {
  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
  const nl = value.indexOf('\n', cursor);
  const line = value.slice(lineStart, nl < 0 ? value.length : nl);
  if (!LIST_ITEM.test(line)) return null;
  if (outdent) {
    const remove = line.startsWith('  ') ? 2 : line.startsWith(' ') ? 1 : 0;
    if (!remove) return { value, cursor };
    return { value: value.slice(0, lineStart) + line.slice(remove) + value.slice(lineStart + line.length), cursor: Math.max(lineStart, cursor - remove) };
  }
  return { value: value.slice(0, lineStart) + '  ' + value.slice(lineStart), cursor: cursor + 2 };
}

/** `[] ` o `[ ] ` al principio de la línea se convierte en tarea (`- [ ] `). */
export function autoTask(value: string, cursor: number): EditResult | null {
  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
  const head = value.slice(lineStart, cursor);
  const m = /^(\s*)\[ ?\] $/.exec(head);
  if (!m) return null;
  const insert = `${m[1]}- [ ] `;
  return { value: value.slice(0, lineStart) + insert + value.slice(cursor), cursor: lineStart + insert.length };
}

export type SlashCommand = 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'todo' | 'code' | 'quote' | 'divider' | 'table';

/** Inserta el bloque de un comando "/" en lugar de `/query` (de `start` a `cursor`). */
export function applySlashCommand(value: string, start: number, cursor: number, cmd: SlashCommand): EditResult {
  const before = value.slice(0, start);
  const after = value.slice(cursor);
  const atLineStart = start === 0 || before.endsWith('\n');
  const lead = atLineStart ? '' : '\n';
  const blocks: Record<SlashCommand, [string, string]> = {
    h1: ['# ', ''],
    h2: ['## ', ''],
    h3: ['### ', ''],
    bullet: ['- ', ''],
    numbered: ['1. ', ''],
    todo: ['- [ ] ', ''],
    code: ['```\n', '\n```'],
    quote: ['> ', ''],
    divider: ['---\n', ''],
    table: ['| Column | Column |\n| --- | --- |\n| ', ' |  |'],
  };
  const [open, close] = blocks[cmd];
  const insert = lead + open;
  return { value: before + insert + close + after, cursor: before.length + insert.length };
}

// ---------- Acciones de la barra del editor ----------

export type MarkdownAction = 'bold' | 'italic' | 'code' | 'list' | 'link' | 'todo' | 'strike';

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
    case 'strike':
      return wrap('~~', '~~');
    case 'todo': {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const nl = value.indexOf('\n', end);
      const lineEnd = nl < 0 ? value.length : nl;
      const lines = value.slice(lineStart, lineEnd).split('\n');
      const changed = lines.map((l) => (/^\s*[-*] \[[ xX]\] /.test(l) ? l.replace(/^(\s*)[-*] \[[ xX]\] /, '$1') : `- [ ] ${l.replace(/^(\s*)[-*] /, '$1')}`)).join('\n');
      const next = value.slice(0, lineStart) + changed + value.slice(lineEnd);
      return { value: next, selectionStart: lineStart + changed.length, selectionEnd: lineStart + changed.length };
    }
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

// ---------- Autocompletado del editor ----------

export interface EditorTrigger {
  kind: 'slash' | 'mention' | 'issue';
  /** Posición del carácter que disparó ("/", "@" o "#"). */
  start: number;
  query: string;
}

/**
 * "/" abre los comandos, "@" personas e issues y "#" issues, si el carácter
 * está al principio de una palabra y el cursor sigue en esa palabra.
 */
export function detectTrigger(value: string, cursor: number): EditorTrigger | null {
  let i = cursor - 1;
  while (i >= 0 && !/\s/.test(value[i])) i--;
  const start = i + 1;
  const token = value.slice(start, cursor);
  if (token.length === 0 || token.length > 40) return null;
  // Dentro de un bloque de código no hay autocompletado.
  if ((value.slice(0, start).match(/^\s*```/gm) ?? []).length % 2 === 1) return null;
  const head = token[0];
  const query = token.slice(1);
  if (head === '/' && /^[a-z0-9]*$/i.test(query)) return { kind: 'slash', start, query };
  if (head === '@' && /^[\w.@+-]*$/.test(query)) return { kind: 'mention', start, query };
  if (head === '#' && /^[A-Za-z][\w-]*$/.test(query)) return { kind: 'issue', start, query };
  return null;
}

/** Reemplaza el disparador (de `start` al cursor) por `text` y un espacio. */
export function insertCompletion(value: string, start: number, cursor: number, text: string): EditResult {
  const insert = `${text} `;
  return { value: value.slice(0, start) + insert + value.slice(cursor), cursor: start + insert.length };
}
