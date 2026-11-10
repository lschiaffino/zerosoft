/**
 * Sincronización con Notion: la conversión de vuelta (Docs → Notion) y las
 * huellas que dicen qué cambió de cada lado. Puro (sin DB ni red): lo usan
 * el motor (lib/notion-sync.ts) y los tests.
 *
 * - HTML-lite del editor → rich text de Notion (negrita, cursiva, subrayado,
 *   tachado, código, color, links, links a páginas como menciones, fechas y
 *   ecuaciones en línea). Trozos de hasta 2000 caracteres, como pide la API.
 * - Bloque de Docs → bloque de Notion (texto, listas, to-dos, toggles,
 *   títulos con toggle, callouts, código con lenguaje, citas, divisores,
 *   ecuaciones, índice, breadcrumb, tablas, columnas, bookmarks, embeds y
 *   archivos ya subidos). Lo que Notion no tiene queda afuera (null).
 * - Valores de una base de Docs → propiedades de una página de Notion
 *   (fórmulas, rollups, fechas de creación y similares son de solo lectura).
 * - Huellas: hash de lo que importa de un bloque o un valor. La de Notion se
 *   saca de lo convertido y la de Docs de lo guardado; cada lado se compara
 *   con su propia huella de la última sincronización.
 */
import { createHash } from 'crypto';
import type { DbProperty, DbValue, DocsBlock } from './docs-types';
import { blockIndent } from './docs-blocks';

// ---------- Rich text ----------

export interface NotionTextReq {
  type: 'text';
  text: { content: string; link?: { url: string } | null };
  annotations?: Partial<Record<'bold' | 'italic' | 'strikethrough' | 'underline' | 'code', boolean>> & { color?: string };
}

export interface NotionMentionReq {
  type: 'mention';
  mention: { type: 'page'; page: { id: string } } | { type: 'date'; date: { start: string; end?: string | null } };
  annotations?: NotionTextReq['annotations'];
}

export interface NotionEquationReq {
  type: 'equation';
  equation: { expression: string };
}

export type NotionRichTextReq = NotionTextReq | NotionMentionReq | NotionEquationReq;

export interface ReverseContext {
  /** Id de Notion de una página de Docs (o de una fila de una base), si está sincronizada. */
  notionIdFor(localPageId: string, rowId?: string | null): string | null;
}

const MAX_TEXT = 2000;
const MAX_ITEMS = 100;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs) ?? new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(attrs);
  return m ? decodeEntities(m[1]) : null;
}

/** Color de Docs ("red", "red_bg") → color de Notion ("red", "red_background"). */
export function docsColorToNotion(color: string | null | undefined): string {
  if (!color) return 'default';
  return color.endsWith('_bg') ? `${color.slice(0, -3)}_background` : color;
}

interface Frame {
  tag: string;
  kind: 'mark' | 'link' | 'color' | 'skip' | 'plain';
  mark?: 'bold' | 'italic' | 'strikethrough' | 'underline' | 'code';
  link?: string | null;
  color?: string;
}

/**
 * HTML-lite (ya saneado) → rich text de Notion. Los links a otra página de
 * Docs pasan a mención si esa página está en Notion; si no, queda el texto.
 */
export function htmlToRichText(html: string, ctx: ReverseContext): NotionRichTextReq[] {
  const out: NotionRichTextReq[] = [];
  const stack: Frame[] = [];
  const re = /<(\/?)([a-z][a-z0-9]*)\b([^>]*)>|([^<]+)/gi;
  let m: RegExpExecArray | null;

  const current = () => {
    const ann: NotionTextReq['annotations'] = {};
    let link: string | null = null;
    let color: string | undefined;
    for (const f of stack) {
      if (f.kind === 'mark' && f.mark) ann[f.mark] = true;
      if (f.kind === 'link') link = f.link ?? null;
      if (f.kind === 'color') color = f.color;
    }
    if (color) ann.color = docsColorToNotion(color);
    return { ann, link };
  };
  const skipping = () => stack.some((f) => f.kind === 'skip');

  const pushText = (text: string) => {
    if (!text) return;
    const { ann, link } = current();
    const last = out[out.length - 1];
    if (last && last.type === 'text' && (last.text.link?.url ?? null) === link && JSON.stringify(last.annotations ?? {}) === JSON.stringify(ann)) {
      last.text.content += text;
      return;
    }
    out.push({ type: 'text', text: { content: text, ...(link ? { link: { url: link } } : {}) }, ...(Object.keys(ann).length ? { annotations: ann } : {}) });
  };

  while ((m = re.exec(html))) {
    const [, close, rawTag, attrs, text] = m;
    if (text !== undefined) {
      if (!skipping()) pushText(decodeEntities(text));
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (tag === 'br') {
      if (!skipping()) pushText('\n');
      continue;
    }
    if (close) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.splice(i);
          break;
        }
      }
      continue;
    }
    if (attrs.trim().endsWith('/')) continue;
    if (skipping()) {
      stack.push({ tag, kind: 'plain' });
      continue;
    }
    const marks: Record<string, Frame['mark']> = { strong: 'bold', b: 'bold', em: 'italic', i: 'italic', u: 'underline', s: 'strikethrough', del: 'strikethrough', strike: 'strikethrough', code: 'code' };
    if (marks[tag]) {
      stack.push({ tag, kind: 'mark', mark: marks[tag] });
      continue;
    }
    if (tag === 'a') {
      const page = attr(attrs, 'data-page');
      if (page) {
        const target = ctx.notionIdFor(page, attr(attrs, 'data-row'));
        if (target) {
          const { ann } = current();
          out.push({ type: 'mention', mention: { type: 'page', page: { id: target } }, ...(Object.keys(ann).length ? { annotations: ann } : {}) });
          stack.push({ tag, kind: 'skip' });
          continue;
        }
        stack.push({ tag, kind: 'plain' });
        continue;
      }
      const href = attr(attrs, 'href') ?? '';
      stack.push({ tag, kind: 'link', link: /^(https?:|mailto:)/i.test(href) ? href.slice(0, 2000) : null });
      continue;
    }
    if (tag === 'span') {
      const tex = attr(attrs, 'data-tex');
      if (tex) {
        out.push({ type: 'equation', equation: { expression: tex.slice(0, 1000) } });
        stack.push({ tag, kind: 'skip' });
        continue;
      }
      const date = attr(attrs, 'data-date');
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        out.push({ type: 'mention', mention: { type: 'date', date: { start: date } } });
        stack.push({ tag, kind: 'skip' });
        continue;
      }
      const color = attr(attrs, 'data-color');
      if (color) {
        stack.push({ tag, kind: 'color', color });
        continue;
      }
    }
    stack.push({ tag, kind: 'plain' });
  }

  // Notion: hasta 2000 caracteres por trozo y 100 trozos por bloque.
  const split: NotionRichTextReq[] = [];
  for (const r of out) {
    if (r.type !== 'text' || r.text.content.length <= MAX_TEXT) {
      split.push(r);
      continue;
    }
    for (let i = 0; i < r.text.content.length; i += MAX_TEXT) {
      split.push({ ...r, text: { ...r.text, content: r.text.content.slice(i, i + MAX_TEXT) } });
    }
  }
  return split.slice(0, MAX_ITEMS);
}

/** Texto plano (código, ecuación): entidades decodificadas, sin tags. */
export function plainFromHtml(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''));
}

function plainRichText(text: string): NotionTextReq[] {
  const out: NotionTextReq[] = [];
  for (let i = 0; i < text.length && out.length < MAX_ITEMS; i += MAX_TEXT) out.push({ type: 'text', text: { content: text.slice(i, i + MAX_TEXT) } });
  return out;
}

// ---------- Bloques ----------

/** Lenguajes que acepta Notion en un bloque de código (los demás van como "plain text"). */
const NOTION_LANGUAGES = new Set([
  'abap', 'arduino', 'bash', 'basic', 'c', 'clojure', 'coffeescript', 'c++', 'c#', 'css', 'dart', 'diff', 'docker', 'elixir', 'elm', 'erlang',
  'flow', 'fortran', 'f#', 'gherkin', 'glsl', 'go', 'graphql', 'groovy', 'haskell', 'html', 'java', 'javascript', 'json', 'julia', 'kotlin',
  'latex', 'less', 'lisp', 'livescript', 'lua', 'makefile', 'markdown', 'markup', 'matlab', 'mermaid', 'nix', 'objective-c', 'ocaml',
  'pascal', 'perl', 'php', 'plain text', 'powershell', 'prolog', 'protobuf', 'python', 'r', 'reason', 'ruby', 'rust', 'sass', 'scala',
  'scheme', 'scss', 'shell', 'sql', 'swift', 'typescript', 'vb.net', 'verilog', 'vhdl', 'visual basic', 'webassembly', 'xml', 'yaml',
  'java/c/c++/c#',
]);
const LANGUAGE_ALIASES: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'shell', zsh: 'shell', yml: 'yaml', cpp: 'c++', csharp: 'c#', md: 'markdown', text: 'plain text', plaintext: 'plain text', dockerfile: 'docker', tsx: 'typescript', jsx: 'javascript' };

export function notionLanguage(lang: string | undefined): string {
  const l = (lang ?? '').trim().toLowerCase();
  const name = LANGUAGE_ALIASES[l] ?? l;
  return NOTION_LANGUAGES.has(name) ? name : 'plain text';
}

/** Tipos de Docs que tienen equivalente en Notion (lo demás no se manda). */
const PUSHABLE = new Set<DocsBlock['type']>([
  'paragraph', 'heading', 'bulleted_list_item', 'numbered_list_item', 'todo', 'quote', 'toggle', 'callout', 'code', 'divider', 'equation',
  'toc', 'breadcrumb', 'table', 'columns', 'column', 'bookmark', 'embed', 'image', 'video', 'audio', 'pdf', 'file',
]);

export function isPushable(b: DocsBlock): boolean {
  if (b.suggestion) return false;
  if ((b.type === 'bookmark' || b.type === 'embed') && !/^https?:\/\//i.test(b.link?.url ?? '')) return false;
  if (MEDIA.has(b.type) && !b.url) return false;
  return PUSHABLE.has(b.type);
}

export const MEDIA = new Set<DocsBlock['type']>(['image', 'video', 'audio', 'pdf', 'file']);

/** Bloques de Notion que pueden tener hijos (los de Docs con hijos debajo de otro tipo los cuelgan del abuelo). */
const NOTION_CONTAINERS = new Set<DocsBlock['type']>(['paragraph', 'bulleted_list_item', 'numbered_list_item', 'todo', 'quote', 'toggle', 'callout', 'columns', 'column']);

export function canHaveChildren(b: DocsBlock): boolean {
  return NOTION_CONTAINERS.has(b.type) || (b.type === 'heading' && b.toggle === true);
}

/** Archivo ya subido a Notion (file_upload) o link externo para un bloque de archivo. */
export type NotionFileRef = { type: 'file_upload'; file_upload: { id: string } } | { type: 'external'; external: { url: string } };

export interface BlockReverseContext extends ReverseContext {
  fileFor?(b: DocsBlock): NotionFileRef | null;
}

export type NotionBlockReq = { object: 'block'; type: string } & Record<string, unknown>;

/** Contenido (sin hijos) de un bloque de Docs en Notion; null si Notion no lo tiene. */
export function docsBlockToNotion(b: DocsBlock, ctx: BlockReverseContext): NotionBlockReq | null {
  if (!isPushable(b)) return null;
  const rt = () => htmlToRichText(b.content ?? '', ctx);
  const color = docsColorToNotion(b.color);
  const make = (type: string, data: Record<string, unknown>): NotionBlockReq => ({ object: 'block', type, [type]: data });
  switch (b.type) {
    case 'paragraph':
    case 'bulleted_list_item':
    case 'numbered_list_item':
    case 'quote':
    case 'toggle':
      return make(b.type, { rich_text: rt(), color });
    case 'todo':
      return make('to_do', { rich_text: rt(), checked: Boolean(b.checked), color });
    case 'heading':
      return make(`heading_${b.level ?? 1}`, { rich_text: rt(), is_toggleable: b.toggle === true, color });
    case 'callout':
      return make('callout', { rich_text: rt(), icon: { type: 'emoji', emoji: b.icon || '💡' }, color });
    case 'code':
      return make('code', { rich_text: plainRichText(plainFromHtml(b.content ?? '')), language: notionLanguage(b.language) });
    case 'divider':
      return make('divider', {});
    case 'equation':
      return make('equation', { expression: plainFromHtml(b.content ?? '').slice(0, 1000) });
    case 'toc':
      return make('table_of_contents', { color: 'default' });
    case 'breadcrumb':
      return make('breadcrumb', {});
    case 'bookmark':
    case 'embed':
      return make(b.type, { url: b.link!.url, caption: b.caption ? htmlToRichText(b.caption, ctx) : [] });
    case 'table': {
      const rows = (b.rows?.length ? b.rows : [['']]).slice(0, 100);
      const width = Math.max(1, Math.min(20, Math.max(...rows.map((r) => r.length))));
      return make('table', {
        table_width: width,
        has_column_header: b.header_row === true,
        has_row_header: false,
        children: rows.map((r) => tableRow(r, width, ctx)),
      });
    }
    case 'columns':
      return make('column_list', {});
    case 'column':
      return make('column', {});
    default: {
      if (!MEDIA.has(b.type)) return null;
      const ref = ctx.fileFor?.(b) ?? null;
      if (!ref) return null;
      const type = b.type === 'pdf' ? 'pdf' : b.type;
      return make(type, { ...ref, caption: b.caption ? htmlToRichText(b.caption, ctx) : [], ...(type === 'file' && b.name ? { name: b.name.slice(0, 200) } : {}) });
    }
  }
}

export function tableRow(cells: string[], width: number, ctx: ReverseContext): NotionBlockReq {
  const padded = Array.from({ length: width }, (_, i) => cells[i] ?? '');
  return { object: 'block', type: 'table_row', table_row: { cells: padded.map((c) => htmlToRichText(c, ctx)) } };
}

/** Lo que se manda en un PATCH de un bloque (el mismo tipo; sin hijos). */
export function updatePayload(req: NotionBlockReq): Record<string, unknown> {
  const data = { ...(req[req.type] as Record<string, unknown>) };
  delete data.children;
  if (req.type === 'table') return { table: { has_column_header: data.has_column_header, has_row_header: data.has_row_header } };
  return { [req.type]: data };
}

// ---------- Huellas ----------

export function hashOf(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16);
}

/** Clave estable de un archivo (la URL sin la firma ni la query). */
export function mediaKey(url: string | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url, 'https://local.invalid');
    return `${u.host}${u.pathname}`;
  } catch {
    return url.split('?')[0];
  }
}

/** Texto normalizado: los mismos caracteres dan la misma huella aunque cambie el orden de atributos. */
function normHtml(html: string | undefined): string {
  return (html ?? '').replace(/\s+(target|rel)="[^"]*"/g, '').replace(/&nbsp;/g, ' ');
}

/**
 * Huella de un bloque: solo lo que viaja entre Docs y Notion (tipo, texto,
 * nivel, checks, lenguaje, filas, toggles, ícono, color, link, archivo,
 * indent). El ancho, la alineación o el plegado son de Docs y no cuentan.
 */
export function blockHash(b: DocsBlock): string {
  return hashOf([
    b.type,
    normHtml(b.content),
    b.level ?? null,
    b.checked ?? null,
    b.type === 'code' ? (b.language ?? '') : null,
    b.rows ?? null,
    b.header_row ?? null,
    b.toggle ?? null,
    b.icon ?? null,
    b.color ?? null,
    b.link?.url ?? null,
    MEDIA.has(b.type) ? mediaKey(b.url) : null,
    normHtml(b.caption),
    blockIndent(b),
  ]);
}

/** Huella de todo el contenido (para saber rápido si una página cambió). */
export function contentHash(blocks: DocsBlock[]): string {
  return hashOf(blocks.map((b) => [b.id, blockHash(b)]));
}

// ---------- Estructura ----------

/**
 * Padre de cada bloque en la lista plana: el anterior con menos indent (-1 =
 * la página). `effective`: el ancestro más cercano que en Notion puede tener
 * hijos (un párrafo debajo de un bloque de código cuelga del abuelo).
 */
export function parentIndexes(blocks: DocsBlock[], effective = false): number[] {
  const out: number[] = [];
  const stack: number[] = [];
  blocks.forEach((b, i) => {
    const d = blockIndent(b);
    while (stack.length && blockIndent(blocks[stack[stack.length - 1]]) >= d) stack.pop();
    let p = stack.length ? stack[stack.length - 1] : -1;
    if (effective) {
      let k = stack.length - 1;
      while (k >= 0 && !canHaveChildren(blocks[stack[k]])) k--;
      p = k >= 0 ? stack[k] : -1;
    }
    out.push(p);
    stack.push(i);
  });
  return out;
}

/** Subsecuencia común más larga (ids que no cambiaron de orden). */
export function lcs(a: string[], b: string[]): Set<string> {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return new Set();
  // Listas largas: comparación directa por posición (evita n*m enorme).
  if (n * m > 4_000_000) return new Set(a.filter((x, i) => b[i] === x));
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const out = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.add(a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

// ---------- Bases ----------

export interface PropReverseContext extends ReverseContext {
  /** Id de persona de Notion para una persona del workspace (por email). */
  notionUserFor(personId: string): string | null;
  /** Id de Notion de una fila (relaciones). */
  notionRowFor(rowId: string): string | null;
}

/** Propiedades que solo calcula Notion (o Docs): no se mandan. */
export const READ_ONLY_PROPS = new Set(['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id', 'button', 'files', 'place']);

/** Valor de una celda de Docs → valor de propiedad de Notion; undefined si no se manda. */
export function dbValueToNotion(prop: DbProperty, v: DbValue, ctx: PropReverseContext): Record<string, unknown> | undefined {
  if (READ_ONLY_PROPS.has(prop.type)) return undefined;
  const text = typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
  const optName = (id: unknown) => prop.options?.find((o) => o.id === id)?.name ?? null;
  switch (prop.type) {
    case 'title':
      return { title: htmlToRichText(text, ctx) };
    case 'text':
      return { rich_text: htmlToRichText(text, ctx) };
    case 'number':
      return { number: typeof v === 'number' && Number.isFinite(v) ? v : null };
    case 'checkbox':
      return { checkbox: v === true };
    case 'url':
      return { url: text || null };
    case 'email':
      return { email: text || null };
    case 'phone':
      return { phone_number: text || null };
    case 'date': {
      const r = parseDateValue(v);
      return { date: r ? { start: r.start, ...(r.end ? { end: r.end } : {}) } : null };
    }
    case 'select': {
      const name = optName(v);
      return { select: name ? { name: name.replace(/,/g, ' ').slice(0, 100) } : null };
    }
    case 'status': {
      const name = optName(v);
      return name ? { status: { name } } : undefined;
    }
    case 'multi_select':
      return { multi_select: (Array.isArray(v) ? v : []).map(optName).filter((n): n is string => Boolean(n)).map((name) => ({ name: name.replace(/,/g, ' ').slice(0, 100) })) };
    case 'person':
      return { people: (Array.isArray(v) ? v : []).map((id) => ctx.notionUserFor(id)).filter((id): id is string => Boolean(id)).map((id) => ({ id })) };
    case 'relation':
      if (prop.relation?.mirror_of) return undefined;
      return { relation: (Array.isArray(v) ? v : []).map((id) => ctx.notionRowFor(id)).filter((id): id is string => Boolean(id)).map((id) => ({ id })) };
    default:
      return undefined;
  }
}

/** Esquema de una propiedad nueva de Docs para crearla en Notion; null si no se puede. */
export function dbSchemaToNotion(prop: DbProperty): Record<string, unknown> | null {
  const opts = () => ({ options: (prop.options ?? []).slice(0, 100).map((o) => ({ name: o.name.replace(/,/g, ' ').slice(0, 100) })) });
  switch (prop.type) {
    case 'title':
      return { title: {} };
    case 'text':
      return { rich_text: {} };
    case 'number':
      return { number: {} };
    case 'checkbox':
      return { checkbox: {} };
    case 'url':
      return { url: {} };
    case 'email':
      return { email: {} };
    case 'phone':
      return { phone_number: {} };
    case 'date':
      return { date: {} };
    case 'select':
      return { select: opts() };
    case 'multi_select':
      return { multi_select: opts() };
    case 'person':
      return { people: {} };
    default:
      return null;
  }
}

/** Valor de fecha de Docs: un día ("2026-11-03") o un rango ("2026-11-03/2026-11-05"). */
export function parseDateValue(v: DbValue): { start: string; end?: string } | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:\/(\d{4}-\d{2}-\d{2}))?$/.exec(v);
  if (!m) return null;
  return m[2] && m[2] !== m[1] ? { start: m[1], end: m[2] } : { start: m[1] };
}
