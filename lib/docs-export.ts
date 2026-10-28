/**
 * Docs D5: export de una página, de una página con sus subpáginas o del
 * workspace entero, en Markdown, HTML o PDF (como "Export" de Notion).
 *
 * Permisos (D3): cada página sale tal como la ve quien exporta.
 * - Solo páginas que puede abrir (getDocAccess, sin contar "publicada" ni el
 *   link público) y nada de teamspaces que no ve.
 * - Bloques sincronizados con su contenido solo si puede abrir la página de
 *   origen (lib/docs-visible.ts); sugerencias sin aceptar y comentarios fuera.
 * - Links `[[` a otras páginas del export: relativos dentro del zip; a una
 *   que no exporta, al link de la app con el título que puede ver.
 * - Archivos e imágenes van dentro del zip (hasta un tope); el resto queda
 *   como link al proxy, que pide sesión con acceso.
 */
import path from 'path';
import { readFile } from 'fs/promises';
import { getDb, type DocsPageRow } from './db';
import { getDocAccess, readableLinkTitles, slugifyTitle, type DocsActor } from './docs';
import { hiddenTeamspaceIds } from './docs-access';
import { visibleBlocks } from './docs-visible';
import { cleanForReaders } from './docs-marks';
import { pageLinkHref, resolveBlocksPageLinks } from './docs-page-links';
import { blocksToMarkdown } from './docs-markdown';
import { blocksToHtmlDocument, escapeHtml } from './docs-html-export';
import { blocksToPdf, needsUnicodeFont, type PdfImageData } from './docs-pdf';
import { docsFileHref, isDocsUploadUrl, isFileBlockType } from './docs-files';
import { sanitizeDocsHtml } from './docs-sanitize';
import { localUploadPath } from './uploads';
import { buildZip, type ZipInput } from './zip-writer';
import type { DocsBlock } from './docs-types';

export type ExportFormat = 'md' | 'html' | 'pdf';
export const EXPORT_FORMATS: ExportFormat[] = ['md', 'html', 'pdf'];

export function isExportFormat(v: unknown): v is ExportFormat {
  return typeof v === 'string' && (EXPORT_FORMATS as string[]).includes(v);
}

/** Tope de páginas por export. */
export const EXPORT_MAX_PAGES = 2000;
/** Tope de bytes de archivos adjuntos que entran en el zip (el resto, como link). */
export const EXPORT_MAX_FILE_BYTES = 200 * 1024 * 1024;
const EXPORT_FILE_MAX = 50 * 1024 * 1024;

const MIME: Record<ExportFormat, string> = {
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  pdf: 'application/pdf',
};

/** Nombre de archivo seguro (sin barras ni caracteres raros), con un sufijo del id para que no choquen. */
export function exportName(title: string, id: string): string {
  const clean =
    (title || 'Untitled')
      .normalize('NFC')
      .replace(/[\\/:*?"<>|#%{}^~[\]`\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Untitled';
  return `${clean} ${id.replace(/-/g, '').slice(0, 8)}`;
}

/** Path relativo de `to` visto desde el archivo `from` (los dos dentro del zip). */
export function relativePath(from: string, to: string): string {
  const rel = path.posix.relative(path.posix.dirname(from), to);
  return rel
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

interface ExportPage {
  row: DocsPageRow;
  parentId: string | null;
}

/** Páginas que el actor puede exportar: el subárbol de `rootId` o, sin raíz, todo su workspace. */
export async function collectExportPages(actor: DocsActor, rootId: string | null, includeSubpages: boolean): Promise<ExportPage[]> {
  const db = getDb();
  const person = actor.actingUser?.id ?? actor.id;
  const readable = async (row: DocsPageRow) =>
    row.archived === 0 && (await getDocAccess(row, actor, { includePublished: false, includePublicLink: false })) !== null;
  if (rootId) {
    const root = (await db.prepare('SELECT * FROM docs_pages WHERE id = ?').get(rootId)) as DocsPageRow | undefined;
    if (!root) return [];
    const out: ExportPage[] = [{ row: root, parentId: null }];
    if (!includeSubpages) return out;
    const hidden = new Set(root.user_id === actor.id ? await hiddenTeamspaceIds(actor.id, person) : []);
    const queue = [root.id];
    const seen = new Set(queue);
    while (queue.length && out.length < EXPORT_MAX_PAGES) {
      const parent = queue.shift()!;
      const kids = (await db
        .prepare('SELECT * FROM docs_pages WHERE parent_id = ? AND user_id = ? AND archived = 0 ORDER BY (position IS NULL) ASC, position ASC, created_at ASC')
        .all(parent, root.user_id)) as DocsPageRow[];
      for (const k of kids) {
        if (seen.has(k.id) || out.length >= EXPORT_MAX_PAGES) continue;
        seen.add(k.id);
        if (k.teamspace_id && hidden.has(k.teamspace_id)) continue;
        if (!(await readable(k))) continue;
        out.push({ row: k, parentId: parent });
        queue.push(k.id);
      }
    }
    return out;
  }
  // Workspace entero: sus páginas (nunca las de otro workspace), sin teamspaces ocultos.
  const hidden = new Set(await hiddenTeamspaceIds(actor.id, person));
  const rows = (await db
    .prepare('SELECT * FROM docs_pages WHERE user_id = ? AND archived = 0 ORDER BY (position IS NULL) ASC, position ASC, created_at ASC')
    .all(actor.id)) as DocsPageRow[];
  const out: ExportPage[] = [];
  const ids = new Set<string>();
  for (const r of rows) {
    if (out.length >= EXPORT_MAX_PAGES) break;
    if (r.teamspace_id && hidden.has(r.teamspace_id)) continue;
    if (!(await readable(r))) continue;
    out.push({ row: r, parentId: r.parent_id });
    ids.add(r.id);
  }
  // Padre que no se exporta (oculto o sin acceso): la página queda en la raíz.
  for (const p of out) if (p.parentId && !ids.has(p.parentId)) p.parentId = null;
  return out;
}

/** Bloques de la página como los ve el actor, sin sugerencias ni comentarios. */
async function readerBlocks(actor: DocsActor, row: DocsPageRow): Promise<DocsBlock[]> {
  return cleanForReaders(await visibleBlocks(row, row.content, { actor }));
}

async function readUpload(url: string): Promise<Buffer | null> {
  if (!isDocsUploadUrl(url)) return null;
  if (url.startsWith('/uploads/')) {
    const file = localUploadPath(url, 'docs');
    return file ? readFile(file).catch(() => null) : null;
  }
  // Solo Vercel Blob de Docs (isDocsUploadUrl): nada de URLs arbitrarias.
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res?.ok) return null;
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > EXPORT_FILE_MAX) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > EXPORT_FILE_MAX ? null : buf;
}

/** Todos los bloques con archivo, también los del cuerpo de las filas de las bases. */
function fileBlocks(blocks: DocsBlock[]): DocsBlock[] {
  const out: DocsBlock[] = [];
  for (const b of blocks) {
    if (isFileBlockType(b.type) && b.url) out.push(b);
    if (b.type === 'database') for (const r of b.db?.rows ?? []) if (r.body?.length) out.push(...fileBlocks(r.body));
  }
  return out;
}

export interface ExportResult {
  body: Buffer;
  filename: string;
  contentType: string;
  pages: number;
  /** Páginas que en PDF iban a salir con "?" (otros alfabetos): van en HTML dentro del zip. */
  htmlFallback?: number;
}

/** PDF de una página con texto que las fuentes estándar no muestran: mejor Imprimir del navegador. */
export class PdfUnicodeError extends Error {
  constructor() {
    super('pdf_unicode');
  }
}

interface RenderCtx {
  actor: DocsActor;
  origin: string;
  format: ExportFormat;
  locale: string;
  footer: string;
}

/** Una sola página (sin zip): links y archivos apuntan a la app (piden sesión). */
export async function exportSinglePage(row: DocsPageRow, ctx: RenderCtx): Promise<ExportResult> {
  const raw = await readerBlocks(ctx.actor, row);
  const titles = await readableLinkTitles(ctx.actor, row, raw);
  // Solo las páginas que quien exporta puede abrir quedan como link; el resto, texto sin id ni href.
  const blocks = resolveBlocksPageLinks(raw, (id) => (titles.has(id) ? { href: `${ctx.origin}${pageLinkHref(id)}`, title: titles.get(id) ?? null, keepId: false } : null));
  const fileHref = (b: DocsBlock) => `${ctx.origin}${docsFileHref(row.id, b.id)}`;
  const base = slugifyTitle(row.title) || 'page';
  let body: Buffer;
  if (ctx.format === 'md') body = Buffer.from(blocksToMarkdown(blocks, row.title, { fileHref: (id) => `${ctx.origin}${docsFileHref(row.id, id)}` }), 'utf8');
  else if (ctx.format === 'html') {
    body = Buffer.from(blocksToHtmlDocument(blocks, row.title, { sanitize: sanitizeDocsHtml, fileHref, icon: row.icon, lang: ctx.locale, footer: ctx.footer }), 'utf8');
  } else {
    if (needsUnicodeFont(row.title, blocks)) throw new PdfUnicodeError();
    body = await blocksToPdf(blocks, row.title, {
      fileHref,
      footer: ctx.footer,
      imageFor: async (b) => imageData(b),
    });
  }
  return { body, filename: `${base}.${ctx.format}`, contentType: MIME[ctx.format], pages: 1 };
}

async function imageData(b: DocsBlock): Promise<PdfImageData | null> {
  if (!b.url) return null;
  if (!/^image\/(png|jpe?g)$/i.test(b.mime ?? '') && !/\.(png|jpe?g)$/i.test(b.name ?? '')) return null;
  const bytes = await readUpload(b.url);
  return bytes ? { bytes, mime: b.mime ?? (/\.png$/i.test(b.name ?? '') ? 'image/png' : 'image/jpeg') } : null;
}

/**
 * Varias páginas en un zip con su árbol: "Título abcd1234.md" y sus hijas en
 * la carpeta "Título abcd1234/". En HTML suma un index.html con el árbol.
 */
export async function exportTree(pages: ExportPage[], ctx: RenderCtx, zipName: string): Promise<ExportResult> {
  const byId = new Map(pages.map((p) => [p.row.id, p]));
  const pathOf = new Map<string, string>();
  const dirOf = (id: string): string => {
    const p = byId.get(id);
    if (!p) return '';
    const parent = p.parentId && byId.has(p.parentId) ? dirOf(p.parentId) : '';
    return `${parent}${exportName(p.row.title, p.row.id)}/`;
  };
  for (const p of pages) {
    const parentDir = p.parentId && byId.has(p.parentId) ? dirOf(p.parentId) : '';
    pathOf.set(p.row.id, `${parentDir}${exportName(p.row.title, p.row.id)}.${ctx.format}`);
  }
  const files: ZipInput[] = [];
  const usedNames = new Set<string>();
  let fileBytes = 0;
  let htmlFallback = 0;
  for (const p of pages) {
    const file = pathOf.get(p.row.id)!;
    const raw = await readerBlocks(ctx.actor, p.row);
    const titles = await readableLinkTitles(ctx.actor, p.row, raw);
    const blocks = resolveBlocksPageLinks(raw, (id) => {
      const inZip = pathOf.get(id);
      if (inZip) return { href: relativePath(file, inZip), title: titles.get(id) ?? byId.get(id)?.row.title ?? null, keepId: false };
      // Fuera del zip: link solo si la puede abrir; si no, texto ("Página privada"), sin id ni href.
      return titles.has(id) ? { href: `${ctx.origin}${pageLinkHref(id)}`, title: titles.get(id) ?? null, keepId: false } : null;
    });
    // Adjuntos: a la carpeta de la página (como Notion), si entran en el tope.
    const local = new Map<string, string>();
    const images = new Map<string, Buffer>();
    for (const b of fileBlocks(blocks)) {
      if (fileBytes >= EXPORT_MAX_FILE_BYTES) break;
      const bytes = await readUpload(b.url!);
      if (!bytes || fileBytes + bytes.length > EXPORT_MAX_FILE_BYTES) continue;
      fileBytes += bytes.length;
      const dir = file.replace(/\.[a-z]+$/, '/');
      let name = `${dir}${(b.name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120)}`;
      for (let i = 2; usedNames.has(name); i++) name = `${dir}${i}-${(b.name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120)}`;
      usedNames.add(name);
      files.push({ name, data: bytes });
      local.set(b.id, relativePath(file, name));
      if (b.type === 'image') images.set(b.id, bytes);
    }
    const hrefFor = (b: DocsBlock) => local.get(b.id) ?? `${ctx.origin}${docsFileHref(p.row.id, b.id)}`;
    let data: Buffer;
    if (ctx.format === 'md') {
      data = Buffer.from(blocksToMarkdown(blocks, p.row.title, { fileHref: (id) => local.get(id) ?? `${ctx.origin}${docsFileHref(p.row.id, id)}` }), 'utf8');
    } else if (ctx.format === 'html') {
      const kids = pages.filter((k) => k.parentId === p.row.id);
      const extra = kids.length
        ? `<nav class="subpages"><ul>${kids
            .map((k) => `<li><a href="${escapeHtml(relativePath(file, pathOf.get(k.row.id)!))}">${escapeHtml(k.row.title || 'Untitled')}</a></li>`)
            .join('')}</ul></nav>`
        : '';
      data = Buffer.from(
        blocksToHtmlDocument(blocks, p.row.title, { sanitize: sanitizeDocsHtml, fileHref: hrefFor, icon: p.row.icon, lang: ctx.locale, footer: ctx.footer, extra }),
        'utf8',
      );
    } else if (needsUnicodeFont(p.row.title, blocks)) {
      // Otros alfabetos: en PDF saldrían "???"; esta página va en HTML (se imprime desde el navegador).
      htmlFallback++;
      const htmlName = file.replace(/\.pdf$/, '.html');
      files.push({
        name: htmlName,
        deflate: true,
        // Misma carpeta que el .pdf: los links relativos a los adjuntos son los mismos.
        data: blocksToHtmlDocument(blocks, p.row.title, { sanitize: sanitizeDocsHtml, fileHref: hrefFor, icon: p.row.icon, lang: ctx.locale, footer: ctx.footer }),
      });
      continue;
    } else {
      data = await blocksToPdf(blocks, p.row.title, {
        fileHref: hrefFor,
        footer: ctx.footer,
        imageFor: async (b) => {
          const bytes = images.get(b.id);
          if (bytes) return { bytes, mime: b.mime ?? 'image/png' };
          return imageData(b);
        },
      });
    }
    files.push({ name: file, data, deflate: ctx.format !== 'pdf' });
  }
  if (ctx.format === 'html') {
    const roots = pages.filter((p) => !p.parentId || !byId.has(p.parentId));
    const tree = (list: ExportPage[]): string =>
      `<ul>${list
        .map((p) => {
          const kids = pages.filter((k) => k.parentId === p.row.id);
          return `<li><a href="${escapeHtml(relativePath('index.html', pathOf.get(p.row.id)!))}">${escapeHtml(p.row.title || 'Untitled')}</a>${kids.length ? tree(kids) : ''}</li>`;
        })
        .join('')}</ul>`;
    files.push({
      name: 'index.html',
      deflate: true,
      data: blocksToHtmlDocument([], zipName, { sanitize: sanitizeDocsHtml, lang: ctx.locale, footer: ctx.footer, extra: `<nav>${tree(roots)}</nav>` }),
    });
  }
  return {
    body: buildZip(files),
    filename: `${slugifyTitle(zipName) || 'export'}-${ctx.format}.zip`,
    contentType: 'application/zip',
    pages: pages.length,
    htmlFallback,
  };
}
