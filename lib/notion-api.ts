/**
 * Notion por API (integración interna con su token): el cliente HTTP y la
 * conversión pura de lo que devuelve la API a bloques y bases de Docs. Sin
 * DB: el job vive en lib/docs-notion-api-import.ts.
 *
 * - Cliente: https://api.notion.com/v1 con `Notion-Version` fija, como mucho
 *   3 pedidos por segundo por token (el límite promedio de Notion) y, ante un
 *   429, espera el Retry-After (si es corto) o devuelve el job a la cola
 *   (ImportRetryError) para seguir después. El token va solo en el header.
 * - Conversión: rich text → HTML-lite del editor (negrita, cursiva, código,
 *   links, menciones de página y fecha, ecuaciones), bloques → DocsBlock[]
 *   plano con `indent` (listas, to-dos, toggles, columnas, tablas, callouts,
 *   código, citas, ecuaciones, embeds, links a páginas) y bases → bloque
 *   database con sus propiedades y filas. Los archivos quedan como
 *   marcadores que el import baja al storage propio.
 */
import { createHash } from 'crypto';
import { ImportError, ImportRetryError } from './import-jobs';
import { DOCS_MAX_INDENT, type DbOption, type DbProperty, type DbPropertyType, type DbRow, type DbValue, type DocsBlock } from './docs-types';
import { guessStatusGroup } from './docs-database';

export const NOTION_API_BASE = 'https://api.notion.com/v1';
/** Versión fija de la API: el formato de bases (database + properties) que convierte este módulo. */
export const NOTION_VERSION = '2022-06-28';

/** Capacidades que tiene que tener la integración interna. */
export const NOTION_CAPABILITIES = ['read_content', 'read_user_with_email'] as const;

// ---------- Tipos de la API (lo que se usa) ----------

export interface NAnnotations {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
  color?: string;
}

export interface NRichText {
  type: 'text' | 'mention' | 'equation';
  plain_text: string;
  href?: string | null;
  annotations?: NAnnotations;
  text?: { content: string; link?: { url: string } | null };
  mention?: {
    type: 'page' | 'database' | 'user' | 'date' | 'link_preview' | 'link_mention' | 'template_mention' | string;
    page?: { id: string };
    database?: { id: string };
    user?: { id: string; name?: string | null };
    date?: { start: string; end?: string | null };
    link_preview?: { url: string };
    link_mention?: { href: string; title?: string };
  };
  equation?: { expression: string };
}

export type NParent =
  | { type: 'workspace'; workspace: true }
  | { type: 'page_id'; page_id: string }
  | { type: 'database_id'; database_id: string }
  | { type: 'block_id'; block_id: string };

export type NIcon = { type: 'emoji'; emoji: string } | { type: 'external'; external: { url: string } } | { type: 'file'; file: { url: string } } | null;

export interface NFile {
  type: 'file' | 'external';
  name?: string;
  file?: { url: string; expiry_time?: string };
  external?: { url: string };
}

export interface NPropValue {
  id?: string;
  type: string;
  [key: string]: unknown;
}

export interface NPage {
  object: 'page';
  id: string;
  created_time: string;
  last_edited_time: string;
  archived?: boolean;
  in_trash?: boolean;
  icon?: NIcon;
  parent: NParent;
  properties: Record<string, NPropValue>;
  url?: string;
}

export interface NPropSchema {
  id: string;
  name: string;
  type: string;
  select?: { options: Array<{ id?: string; name: string; color?: string }> };
  multi_select?: { options: Array<{ id?: string; name: string; color?: string }> };
  status?: { options: Array<{ id?: string; name: string }>; groups?: Array<{ name: string; option_ids: string[] }> };
  relation?: { database_id: string };
  unique_id?: { prefix?: string | null };
}

export interface NDatabase {
  object: 'database';
  id: string;
  created_time: string;
  last_edited_time: string;
  archived?: boolean;
  in_trash?: boolean;
  is_inline?: boolean;
  title: NRichText[];
  description?: NRichText[];
  icon?: NIcon;
  parent: NParent;
  properties: Record<string, NPropSchema>;
}

export interface NBlock {
  object?: 'block';
  id: string;
  type: string;
  has_children: boolean;
  parent?: NParent;
  [key: string]: unknown;
}

export interface NBlockNode {
  block: NBlock;
  children: NBlockNode[];
}

export interface NUser {
  id: string;
  name: string;
  email: string;
}

export interface NList<T> {
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

// ---------- Cliente ----------

export type NotionFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Pausa mínima entre pedidos del mismo token (3 por segundo). */
const MIN_GAP_MS = 340;
const nextSlot = new Map<string, number>();

function tokenKey(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface NotionClientOptions {
  fetch?: NotionFetch;
  base?: string;
  /** Sin pausas entre pedidos (fake de tests). */
  noThrottle?: boolean;
}

export interface NotionClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  /** GET de un archivo alojado por Notion (lo baja lib/docs-notion-api-import.ts). */
  fetchFile(url: string, init?: RequestInit): Promise<Response>;
  fake: boolean;
}

/**
 * Pedido a la API: 401 → unauthorized, 403 → restricted (la integración no
 * tiene esa capacidad o la página no se compartió), 404 → not_found, 429 →
 * espera el Retry-After (hasta 10 s, dos veces) o devuelve el job a la cola.
 */
export function createNotionClient(token: string, opts: NotionClientOptions = {}): NotionClient {
  const base = (opts.base ?? NOTION_API_BASE).replace(/\/$/, '');
  const doFetch: NotionFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const key = tokenKey(token);

  async function throttle() {
    if (opts.noThrottle) return;
    const now = Date.now();
    const at = Math.max(now, nextSlot.get(key) ?? 0);
    nextSlot.set(key, at + MIN_GAP_MS);
    if (at > now) await sleep(at - now);
  }

  async function call<T>(path: string, init: RequestInit): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await throttle();
      let res: Response;
      try {
        res = await doFetch(`${base}${path}`, {
          ...init,
          headers: {
            authorization: `Bearer ${token}`,
            'notion-version': NOTION_VERSION,
            'content-type': 'application/json',
          },
          signal: AbortSignal.timeout(25_000),
          cache: 'no-store',
        });
      } catch {
        if (attempt < 2) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw new ImportError('source_unreachable');
      }
      if (res.status === 401) throw new ImportError('unauthorized');
      if (res.status === 403) throw new ImportError('restricted');
      if (res.status === 404) throw new ImportError('not_found');
      if (res.status === 429) {
        const after = Number(res.headers.get('retry-after'));
        const ms = Number.isFinite(after) && after > 0 ? after * 1000 : 2000;
        if (attempt < 2 && ms <= 10_000) {
          await sleep(opts.noThrottle ? 0 : ms);
          continue;
        }
        throw new ImportRetryError(Math.min(Math.max(ms, 5_000), 3_600_000));
      }
      if (res.status >= 500 && attempt < 2) {
        await sleep(opts.noThrottle ? 0 : 1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new ImportError(res.status === 400 ? 'invalid_request' : 'source_error');
      try {
        return (await res.json()) as T;
      } catch {
        throw new ImportError('source_error');
      }
    }
  }

  return {
    get: (path) => call(path, { method: 'GET' }),
    post: (path, body) => call(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
    fetchFile: (url, init) => doFetch(url, { ...init, signal: AbortSignal.timeout(30_000), cache: 'no-store' }),
    fake: Boolean(opts.noThrottle),
  };
}

// ---------- Ids ----------

/** Id de Notion sin guiones y en minúscula (así vienen en las URLs). */
export function normalizeNotionId(id: string): string {
  return id.replace(/-/g, '').toLowerCase();
}

/** Id estable (propiedades, opciones, bloque de la base): reimportar no cambia las referencias. */
export function stableId(...parts: string[]): string {
  return `n${createHash('sha1').update(parts.join(':')).digest('hex').slice(0, 15)}`;
}

/** Id de Notion dentro de un link (notion.so/Titulo-<32 hex>, /<32 hex>, con o sin guiones). */
export function notionIdFromUrl(href: string): string | null {
  const h = href.trim();
  if (!/^(https?:\/\/([a-z0-9-]+\.)?notion\.(so|site|com)\/|\/)/i.test(h)) return null;
  const path = h.replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0];
  const m = /([0-9a-f]{32})$/i.exec(path.replace(/-/g, '')) ?? /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(path);
  return m ? normalizeNotionId(m[1]) : null;
}

// ---------- Texto ----------

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(text: string): string {
  return esc(text).replace(/"/g, '&quot;');
}

export function plainText(rt: NRichText[] | undefined | null): string {
  return (rt ?? []).map((r) => r.plain_text ?? '').join('');
}

/** Lo que la conversión necesita del resto del import. */
export interface NotionConvertContext {
  /** Id local de una página o base importada (por id de Notion normalizado). */
  pageFor(notionId: string): { pageId: string; rowId?: string } | null;
  /** Título conocido de una página (para child_page / link_to_page sin título). */
  titleFor?(notionId: string): string | null;
  /** Nombre de una persona de Notion por id (menciones). */
  userName?(userId: string): string | null;
}

function pageAnchor(target: { pageId: string; rowId?: string }, label: string): string {
  const row = target.rowId ? ` data-row="${escAttr(target.rowId)}"` : '';
  const href = target.rowId ? `/app/docs/${target.pageId}?row=${target.rowId}` : `/app/docs/${target.pageId}`;
  return `<a href="${escAttr(href)}" data-page="${escAttr(target.pageId)}"${row}>${esc(label)}</a>`;
}

function linkHref(raw: string, ctx: NotionConvertContext): { local?: { pageId: string; rowId?: string }; url?: string } {
  const nid = notionIdFromUrl(raw);
  if (nid) {
    const local = ctx.pageFor(nid);
    if (local) return { local };
  }
  if (/^(https?:|mailto:|tel:)/i.test(raw)) return { url: raw };
  if (raw.startsWith('/') && nid) return { url: `https://www.notion.so${raw}` };
  return {};
}

/** Rich text de Notion → HTML-lite del editor (lo sanea después sanitizeBlocks). */
export function richTextToHtml(rt: NRichText[] | undefined | null, ctx: NotionConvertContext): string {
  let out = '';
  for (const r of rt ?? []) {
    let piece: string;
    if (r.type === 'mention' && r.mention) {
      const m = r.mention;
      const label = r.plain_text || '';
      if ((m.type === 'page' && m.page) || (m.type === 'database' && m.database)) {
        const id = normalizeNotionId((m.page ?? m.database)!.id);
        const local = ctx.pageFor(id);
        piece = local ? pageAnchor(local, label || ctx.titleFor?.(id) || 'Untitled') : esc(label);
      } else if (m.type === 'user' && m.user) {
        const name = m.user.name || ctx.userName?.(m.user.id) || label.replace(/^@/, '');
        piece = esc(`@${name}`);
      } else if (m.type === 'date' && m.date?.start) {
        const start = m.date.start.slice(0, 10);
        piece = /^\d{4}-\d{2}-\d{2}$/.test(start) ? `<span data-date="${start}">${esc(label || start)}</span>` : esc(label);
      } else if (m.type === 'link_preview' && m.link_preview?.url) {
        piece = `<a href="${escAttr(m.link_preview.url)}">${esc(label || m.link_preview.url)}</a>`;
      } else if (m.type === 'link_mention' && m.link_mention?.href) {
        piece = `<a href="${escAttr(m.link_mention.href)}">${esc(m.link_mention.title || label || m.link_mention.href)}</a>`;
      } else {
        piece = esc(label);
      }
      out += piece;
      continue;
    }
    if (r.type === 'equation' && r.equation) {
      const tex = r.equation.expression.slice(0, 2000);
      out += `<span data-tex="${escAttr(tex)}">${esc(tex)}</span>`;
      continue;
    }
    const content = r.text?.content ?? r.plain_text ?? '';
    piece = esc(content).replace(/\n/g, '<br>');
    const a = r.annotations ?? {};
    if (a.code) piece = `<code>${piece}</code>`;
    if (a.bold) piece = `<strong>${piece}</strong>`;
    if (a.italic) piece = `<em>${piece}</em>`;
    if (a.strikethrough) piece = `<s>${piece}</s>`;
    if (a.underline) piece = `<u>${piece}</u>`;
    const href = r.text?.link?.url ?? r.href ?? null;
    if (href) {
      const l = linkHref(href, ctx);
      if (l.local) {
        const row = l.local.rowId ? ` data-row="${escAttr(l.local.rowId)}"` : '';
        piece = `<a href="/app/docs/${escAttr(l.local.pageId)}" data-page="${escAttr(l.local.pageId)}"${row}>${piece}</a>`;
      } else if (l.url) piece = `<a href="${escAttr(l.url)}">${piece}</a>`;
    }
    out += piece;
  }
  return out;
}

// ---------- Bloques ----------

/** Archivo de un bloque que hay que bajar (o, si es externo, dejar como link). */
export interface NotionMediaRef {
  marker: string;
  kind: 'image' | 'video' | 'audio' | 'pdf' | 'file';
  url: string;
  name: string;
  /** Alojado por Notion (se baja al storage); externo, queda como link. */
  hosted: boolean;
  caption: string;
}

export interface ConvertedBlocks {
  blocks: DocsBlock[];
  media: NotionMediaRef[];
  /** Tipos que Docs no tiene (quedan afuera). */
  unsupported: string[];
}

const TEXT_TYPES: Record<string, DocsBlock['type']> = {
  paragraph: 'paragraph',
  bulleted_list_item: 'bulleted_list_item',
  numbered_list_item: 'numbered_list_item',
  to_do: 'todo',
  quote: 'quote',
  toggle: 'toggle',
  callout: 'callout',
};

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'pdf', 'file']);

function fileUrl(f: NFile | undefined): { url: string; hosted: boolean } | null {
  if (!f) return null;
  if (f.type === 'file' && f.file?.url) return { url: f.file.url, hosted: true };
  if (f.type === 'external' && f.external?.url) return { url: f.external.url, hosted: false };
  return null;
}

/** Nombre de un archivo a partir de su URL (sin la query firmada). */
export function fileNameFromUrl(url: string, fallback: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    return (last || fallback).slice(0, 200);
  } catch {
    return fallback;
  }
}

let markerSeq = 0;

/**
 * Árbol de bloques de Notion → lista plana de Docs (los hijos van debajo con
 * un indent más). `child_page`/`child_database` y `link_to_page` quedan como
 * un link a la página importada.
 */
export function convertBlocks(nodes: NBlockNode[], ctx: NotionConvertContext, indent = 0): ConvertedBlocks {
  const out: ConvertedBlocks = { blocks: [], media: [], unsupported: [] };
  const lvl = Math.min(indent, DOCS_MAX_INDENT);
  const push = (b: Omit<DocsBlock, 'id'> & { id?: string }) => {
    out.blocks.push({ id: crypto.randomUUID(), ...b, ...(lvl > 0 ? { indent: lvl } : {}) } as DocsBlock);
  };
  const nest = (children: NBlockNode[], extra = 1) => {
    if (!children.length) return;
    const sub = convertBlocks(children, ctx, indent + extra);
    out.blocks.push(...sub.blocks);
    out.media.push(...sub.media);
    out.unsupported.push(...sub.unsupported);
  };
  const linkTo = (notionId: string, fallbackTitle: string) => {
    const id = normalizeNotionId(notionId);
    const local = ctx.pageFor(id);
    const title = fallbackTitle || ctx.titleFor?.(id) || 'Untitled';
    push({ type: 'paragraph', content: local ? pageAnchor(local, title) : esc(title) });
  };

  for (const node of nodes) {
    const b = node.block;
    const data = (b[b.type] ?? {}) as Record<string, unknown>;
    const rt = data.rich_text as NRichText[] | undefined;
    const textType = TEXT_TYPES[b.type];
    if (textType) {
      const block: Omit<DocsBlock, 'id'> = { type: textType, content: richTextToHtml(rt, ctx) };
      if (b.type === 'to_do') block.checked = Boolean(data.checked);
      if (b.type === 'callout') {
        const icon = data.icon as NIcon | undefined;
        if (icon?.type === 'emoji') block.icon = icon.emoji;
      }
      push(block);
      nest(node.children);
      continue;
    }
    switch (b.type) {
      case 'heading_1':
      case 'heading_2':
      case 'heading_3': {
        const level = Number(b.type.slice(-1)) as 1 | 2 | 3;
        const toggle = Boolean(data.is_toggleable);
        push({ type: 'heading', level, content: richTextToHtml(rt, ctx), ...(toggle ? { toggle: true } : {}) });
        nest(node.children);
        break;
      }
      case 'code':
        push({ type: 'code', content: esc(plainText(rt)), ...(typeof data.language === 'string' ? { language: String(data.language).slice(0, 40) } : {}) });
        break;
      case 'divider':
        push({ type: 'divider', content: '' });
        break;
      case 'equation':
        push({ type: 'equation', content: String(data.expression ?? '') });
        break;
      case 'table_of_contents':
        push({ type: 'toc', content: '' });
        break;
      case 'breadcrumb':
        push({ type: 'breadcrumb', content: '' });
        break;
      case 'table': {
        const rows = node.children
          .filter((c) => c.block.type === 'table_row')
          .slice(0, 200)
          .map((c) => (((c.block.table_row as { cells?: NRichText[][] } | undefined)?.cells ?? []) as NRichText[][]).slice(0, 20).map((cell) => richTextToHtml(cell, ctx)));
        push({ type: 'table', content: '', rows: rows.length ? rows : [['']] });
        break;
      }
      case 'column_list': {
        push({ type: 'columns', content: '' });
        for (const col of node.children.filter((c) => c.block.type === 'column')) {
          out.blocks.push({ id: crypto.randomUUID(), type: 'column', content: '', indent: Math.min(indent + 1, DOCS_MAX_INDENT) });
          nest(col.children, 2);
        }
        break;
      }
      case 'column':
        nest(node.children);
        break;
      case 'synced_block':
        // El contenido del original ya vino como hijos (se pide al bloque de origen).
        nest(node.children, 0);
        break;
      case 'child_page':
        linkTo(b.id, String(data.title ?? ''));
        break;
      case 'child_database':
        linkTo(b.id, String(data.title ?? ''));
        break;
      case 'link_to_page': {
        const target = (data.page_id ?? data.database_id) as string | undefined;
        if (target) linkTo(target, '');
        break;
      }
      case 'bookmark':
      case 'link_preview':
      case 'embed': {
        const url = String(data.url ?? '');
        if (!/^https?:\/\//i.test(url)) break;
        const caption = richTextToHtml(data.caption as NRichText[] | undefined, ctx);
        push({ type: b.type === 'embed' ? 'embed' : 'bookmark', content: '', link: { url }, ...(caption ? { caption } : {}) });
        break;
      }
      default: {
        if (MEDIA_TYPES.has(b.type)) {
          const f = fileUrl(data as unknown as NFile);
          if (!f) break;
          const caption = richTextToHtml(data.caption as NRichText[] | undefined, ctx);
          const kind = b.type as NotionMediaRef['kind'];
          const name = String((data as { name?: string }).name ?? '') || fileNameFromUrl(f.url, `${kind}`);
          const marker = `zsnotion${(markerSeq = (markerSeq + 1) % 1e9)}x${b.id.replace(/-/g, '').slice(0, 8)}`;
          out.media.push({ marker, kind, url: f.url, name, hosted: f.hosted, caption });
          push({ type: 'paragraph', content: marker });
          break;
        }
        out.unsupported.push(b.type);
      }
    }
  }
  return out;
}

/**
 * Bloque de un archivo externo (no alojado por Notion): un video de YouTube
 * o similar queda como embed y el resto como bookmark. Nunca se baja.
 */
export function externalMediaBlock(ref: NotionMediaRef): DocsBlock {
  const embed = ref.kind === 'video' || ref.kind === 'audio';
  return {
    id: crypto.randomUUID(),
    type: embed ? 'embed' : 'bookmark',
    content: '',
    link: { url: ref.url },
    ...(ref.caption ? { caption: ref.caption } : {}),
  };
}

// ---------- Páginas y bases ----------

/** Título de una página (su propiedad title) o de una base. */
export function pageTitle(p: NPage | NDatabase): string {
  if (p.object === 'database') return plainText(p.title).trim();
  const prop = Object.values(p.properties ?? {}).find((v) => v.type === 'title');
  return plainText((prop?.title as NRichText[] | undefined) ?? []).trim();
}

export function iconEmoji(icon: NIcon | undefined): string | null {
  return icon && icon.type === 'emoji' ? icon.emoji : null;
}

/** Fila de una base ya preparada para convertir: valores crudos y sus ids locales. */
export interface NotionRowInput {
  notionId: string;
  rowId: string;
  created: string;
  edited: string;
  properties: Record<string, NPropValue>;
}

/** Archivo de una propiedad files para bajar. */
export interface NotionPropFile {
  rowId: string;
  propId: string;
  url: string;
  name: string;
  hosted: boolean;
}

export interface DatabaseConvertContext extends NotionConvertContext {
  /** Persona del workspace por email (para propiedades people). */
  personFor(email: string): string | null;
  /** Personas de Notion por id (con email si la integración lo puede leer). */
  user(userId: string): { name: string; email: string } | null;
  /** Base importada destino de una relación. */
  databaseFor(notionDbId: string): { pageId: string; blockId: string } | null;
  /** Fila importada (para relaciones). */
  rowFor(notionPageId: string): string | null;
}

export interface ConvertedDatabase {
  block: DocsBlock;
  files: NotionPropFile[];
}

const STATUS_GROUP: Record<string, 'todo' | 'in_progress' | 'done'> = {
  'to-do': 'todo',
  'to do': 'todo',
  todo: 'todo',
  'not started': 'todo',
  'in progress': 'in_progress',
  complete: 'done',
  completed: 'done',
  done: 'done',
};

function ymd(v: unknown): string | null {
  const s = typeof v === 'string' ? v.slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Tipo de resultado de una fórmula o un rollup visto en las filas. */
function resultType(rows: NotionRowInput[], key: string, kind: 'formula' | 'rollup'): 'number' | 'checkbox' | 'date' | 'text' {
  for (const r of rows) {
    const v = r.properties[key]?.[kind] as { type?: string } | undefined;
    if (!v?.type) continue;
    if (v.type === 'number') return 'number';
    if (v.type === 'boolean') return 'checkbox';
    if (v.type === 'date') return 'date';
    return 'text';
  }
  return 'text';
}

function scalarOf(v: { type?: string; [k: string]: unknown } | undefined, ctx: DatabaseConvertContext): DbValue {
  if (!v?.type) return null;
  const x = v[v.type];
  if (v.type === 'number') return typeof x === 'number' ? x : null;
  if (v.type === 'boolean') return typeof x === 'boolean' ? x : null;
  if (v.type === 'date') return ymd((x as { start?: string } | null)?.start);
  if (v.type === 'string') return typeof x === 'string' ? x : null;
  if (v.type === 'array' && Array.isArray(x)) {
    return (x as Array<{ type?: string; [k: string]: unknown }>).map((item) => plainProp(item, ctx)).filter(Boolean).join(', ') || null;
  }
  return null;
}

/** Valor de una propiedad como texto plano (para tipos que Docs guarda como texto). */
function plainProp(v: { type?: string; [k: string]: unknown } | undefined, ctx: DatabaseConvertContext): string {
  if (!v?.type) return '';
  const x = v[v.type] as unknown;
  switch (v.type) {
    case 'title':
    case 'rich_text':
      return plainText(x as NRichText[]);
    case 'number':
      return typeof x === 'number' ? String(x) : '';
    case 'select':
    case 'status':
      return (x as { name?: string } | null)?.name ?? '';
    case 'multi_select':
      return ((x as Array<{ name: string }>) ?? []).map((o) => o.name).join(', ');
    case 'date': {
      const d = x as { start?: string; end?: string | null } | null;
      return d?.start ? (d.end ? `${d.start} → ${d.end}` : d.start) : '';
    }
    case 'people':
      return ((x as Array<{ id: string; name?: string }>) ?? []).map((p) => p.name || ctx.user(p.id)?.name || '').filter(Boolean).join(', ');
    case 'created_by':
    case 'last_edited_by': {
      const p = x as { id: string; name?: string } | null;
      return p ? p.name || ctx.user(p.id)?.name || '' : '';
    }
    case 'checkbox':
      return x ? 'Yes' : 'No';
    case 'url':
    case 'email':
    case 'phone_number':
    case 'created_time':
    case 'last_edited_time':
      return typeof x === 'string' ? x : '';
    case 'unique_id': {
      const u = x as { prefix?: string | null; number?: number | null } | null;
      return u?.number !== undefined && u?.number !== null ? `${u.prefix ? `${u.prefix}-` : ''}${u.number}` : '';
    }
    case 'files':
      return ((x as NFile[]) ?? []).map((f) => f.name || fileNameFromUrl(fileUrl(f)?.url ?? '', 'file')).join(', ');
    case 'relation':
      return ((x as Array<{ id: string }>) ?? []).map((r) => ctx.titleFor?.(normalizeNotionId(r.id)) ?? '').filter(Boolean).join(', ');
    case 'formula':
    case 'rollup': {
      const s = scalarOf(x as { type?: string }, ctx);
      return s === null || s === undefined ? '' : String(s);
    }
    default:
      return '';
  }
}

function optionsOf(dbId: string, propId: string, names: string[]): DbOption[] {
  const seen = new Set<string>();
  const out: DbOption[] = [];
  for (const n of names) {
    const name = n.trim().slice(0, 200);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ id: stableId(dbId, propId, 'opt', name), name });
    if (out.length >= 100) break;
  }
  return out;
}

/**
 * Base de Notion + sus filas → bloque database de Docs. Las propiedades y
 * opciones tienen ids estables (reimportar no rompe vistas ni relaciones).
 * Fórmulas y rollups entran con el valor calculado; people pasa a persona
 * cuando todas las personas existen en el workspace (si no, texto).
 */
export function convertDatabase(db: NDatabase, rows: NotionRowInput[], ctx: DatabaseConvertContext): ConvertedDatabase {
  const dbKey = normalizeNotionId(db.id);
  const blockId = stableId(dbKey, 'block');
  const files: NotionPropFile[] = [];
  const entries = Object.entries(db.properties ?? {}).slice(0, 60);
  // La propiedad title primero (Notion la puede tener en cualquier lugar).
  entries.sort(([, a], [, b]) => Number(b.type === 'title') - Number(a.type === 'title'));
  const properties: DbProperty[] = [];
  const now = new Date().toISOString();
  const outRows: DbRow[] = rows.slice(0, 5000).map((r) => ({
    id: r.rowId,
    values: {},
    created_at: r.created || now,
    updated_at: r.edited || now,
  }));

  for (const [name, schema] of entries) {
    if (schema.type === 'button') continue;
    const id = stableId(dbKey, schema.id || name);
    const prop: DbProperty = { id, name: name.slice(0, 200), type: 'text' };
    let value: (v: NPropValue | undefined, row: NotionRowInput, out: DbRow) => DbValue = (v) => plainProp(v, ctx) || null;

    switch (schema.type) {
      case 'title':
        prop.type = 'title';
        break;
      case 'rich_text':
        prop.type = 'text';
        break;
      case 'number':
        prop.type = 'number';
        value = (v) => (typeof v?.number === 'number' ? v.number : null);
        break;
      case 'checkbox':
        prop.type = 'checkbox';
        value = (v) => (typeof v?.checkbox === 'boolean' ? v.checkbox : null);
        break;
      case 'url':
      case 'email':
        prop.type = schema.type;
        break;
      case 'phone_number':
        prop.type = 'phone';
        break;
      case 'date':
        prop.type = 'date';
        value = (v) => ymd((v?.date as { start?: string } | null)?.start);
        break;
      case 'created_time':
      case 'last_edited_time':
        prop.type = schema.type;
        value = () => null;
        break;
      case 'select':
      case 'status': {
        prop.type = schema.type === 'status' ? 'status' : 'select';
        const declared = (schema[schema.type]?.options ?? []).map((o) => o.name);
        const seen = rows.map((r) => (r.properties[name]?.[schema.type] as { name?: string } | null)?.name ?? '').filter(Boolean);
        prop.options = optionsOf(dbKey, schema.id || name, [...declared, ...seen]);
        if (schema.type === 'status') {
          const groupOf = new Map<string, 'todo' | 'in_progress' | 'done'>();
          for (const g of schema.status?.groups ?? []) {
            const grp = STATUS_GROUP[g.name.trim().toLowerCase()];
            if (!grp) continue;
            for (const optId of g.option_ids) {
              const opt = schema.status?.options.find((o) => o.id === optId);
              if (opt) groupOf.set(opt.name, grp);
            }
          }
          prop.options = prop.options.map((o) => ({ ...o, group: groupOf.get(o.name) ?? guessStatusGroup(o.name) }));
        }
        const byName = new Map(prop.options.map((o) => [o.name, o.id]));
        value = (v) => byName.get(((v?.[schema.type] as { name?: string } | null)?.name ?? '').trim()) ?? null;
        break;
      }
      case 'multi_select': {
        prop.type = 'multi_select';
        const declared = (schema.multi_select?.options ?? []).map((o) => o.name);
        const seen = rows.flatMap((r) => ((r.properties[name]?.multi_select as Array<{ name: string }>) ?? []).map((o) => o.name));
        prop.options = optionsOf(dbKey, schema.id || name, [...declared, ...seen]);
        const byName = new Map(prop.options.map((o) => [o.name, o.id]));
        value = (v) => {
          const ids = ((v?.multi_select as Array<{ name: string }>) ?? []).map((o) => byName.get(o.name.trim())).filter((x): x is string => Boolean(x));
          return ids.length ? ids : null;
        };
        break;
      }
      case 'people': {
        const all = rows.flatMap((r) => (r.properties[name]?.people as Array<{ id: string; person?: { email?: string } }>) ?? []);
        const emailOf = (p: { id: string; person?: { email?: string } }) => (p.person?.email || ctx.user(p.id)?.email || '').toLowerCase();
        const mapped = all.length > 0 && all.every((p) => ctx.personFor(emailOf(p)));
        if (mapped) {
          prop.type = 'person';
          value = (v) => {
            const ids = ((v?.people as Array<{ id: string; person?: { email?: string } }>) ?? []).map((p) => ctx.personFor(emailOf(p))).filter((x): x is string => Boolean(x));
            return ids.length ? [...new Set(ids)] : null;
          };
        }
        break;
      }
      case 'files':
        prop.type = 'files';
        value = (v, row) => {
          for (const f of ((v?.files as NFile[]) ?? []).slice(0, 20)) {
            const u = fileUrl(f);
            if (u) files.push({ rowId: row.rowId, propId: id, url: u.url, name: (f.name || fileNameFromUrl(u.url, 'file')).slice(0, 200), hosted: u.hosted });
          }
          return null;
        };
        break;
      case 'relation': {
        const target = schema.relation?.database_id ? ctx.databaseFor(normalizeNotionId(schema.relation.database_id)) : null;
        if (target) {
          prop.type = 'relation';
          prop.relation = { page_id: target.pageId, block_id: target.blockId };
          value = (v) => {
            const ids = ((v?.relation as Array<{ id: string }>) ?? []).map((r) => ctx.rowFor(normalizeNotionId(r.id))).filter((x): x is string => Boolean(x));
            return ids.length ? ids : null;
          };
        }
        break;
      }
      case 'formula':
      case 'rollup': {
        const kind = resultType(rows, name, schema.type);
        prop.type = kind === 'checkbox' ? 'checkbox' : kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text';
        value = (v) => {
          const s = scalarOf(v?.[schema.type] as { type?: string } | undefined, ctx);
          if (s === null) return null;
          if (prop.type === 'text') return String(s);
          return s;
        };
        break;
      }
      default:
        prop.type = 'text';
    }
    properties.push(prop);
    rows.slice(0, outRows.length).forEach((r, i) => {
      const v = value(r.properties[name], r, outRows[i]);
      if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) {
        outRows[i].values[id] = typeof v === 'string' ? v.slice(0, 2000) : v;
      }
    });
  }
  if (!properties.some((p) => p.type === 'title')) properties.unshift({ id: stableId(dbKey, 'title'), name: 'Name', type: 'title' as DbPropertyType });
  const view = { id: stableId(dbKey, 'view'), name: '', type: 'table' as const };
  const title = plainText(db.title).trim().slice(0, 200);
  return {
    block: {
      id: blockId,
      type: 'database',
      content: '',
      db: { properties, rows: outRows, views: [view], active_view: view.id, ...(title ? { title } : {}) },
    },
    files,
  };
}

/** Bloque de la base de una página importada (id estable). */
export function databaseBlockId(notionDbId: string): string {
  return stableId(normalizeNotionId(notionDbId), 'block');
}
