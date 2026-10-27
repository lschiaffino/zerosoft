/**
 * Docs — import de un export de Notion (zip "Markdown & CSV").
 *
 * El zip se sube directo a Vercel Blob desde el navegador (token de subida de
 * /api/import/upload) o, sin Blob (dev / self-host), en partes de 4 MB a disco
 * (/api/import/jobs/<id>/chunk): nunca pasa entero por el body de una
 * función (Vercel corta en 4.5 MB). Después se lee por rangos
 * (lib/zip-reader.ts):
 *
 * - lectura: directorio central → una página por .md y una base por .csv,
 *   con el árbol que arma Notion con carpetas ("Padre <id>/Hija <id>.md") y
 *   un id local asignado de antemano (así los links internos se resuelven
 *   aunque la página destino se cree más tarde). Si el zip trae otros zips
 *   adentro (exports grandes en partes) se leen esas partes.
 * - escritura, de a 10 páginas, padres antes que hijas: Markdown → bloques
 *   (lib/docs-import.ts), links a otras páginas del export → links `[[ ]]`,
 *   imágenes y adjuntos a lib/uploads.ts como bloques image/file, `<aside>`
 *   → callout, CSV → bloque de base (tipos de columna detectados, nombre del
 *   CSV) y el .md de cada fila ("Base <id>/Fila <id>.md") pasa a ser el cuerpo
 *   de esa fila (por título), no una subpágina.
 * Reimportar el mismo export saltea las páginas ya importadas (id de Notion).
 */
import os from 'os';
import { createHash } from 'crypto';
import path from 'path';
import { appendFile, mkdir, stat, truncate, unlink, writeFile } from 'fs/promises';
import { del, put } from '@vercel/blob';
import { getDb } from './db';
import {
  getExternalIds,
  ImportError,
  listImportItems,
  setExternalId,
  type ImportJob,
  type StagedItem,
} from './import-jobs';
import type { FetchStepResult } from './track-import-sources';
import { fileSource, listZipEntries, readZipEntry, sliceSource, urlSource, zipEntryDataOffset, ZipError, type ZipEntry, type ZipSource } from './zip-reader';
import { markdownToBlocks, plainTextToBlocks, DOCS_IMPORT_MAX_BLOCKS } from './docs-import';
import { htmlToBlocks } from './docs-paste';
import { docxToBlocks, readDocxMedia, DOCX_IMAGE_MARKER } from './docs-docx';
import {
  confluenceTree,
  enexNoteRanges,
  enexNoteTitle,
  enmlToHtml,
  isConfluenceIndex,
  parseEnexNote,
  parseHtmlPage,
  rewriteHtmlRefs,
} from './docs-import-formats';
import { sanitizeBlocks, sanitizeDocsHtml } from './docs-sanitize';
import { stringifyBlocks, type DbProperty, type DbRow, type DbValue, type DocsBlock } from './docs-types';
import { guessStatusGroup, newDbId } from './docs-database';
import { fileKindFor } from './docs-files';
import { isAllowedUpload, MAX_UPLOAD_SIZE, saveUpload } from './uploads';
import { parseCsv } from './csv-parse';

/** Tope del zip subido. */
export const NOTION_MAX_ZIP_BYTES = 1024 * 1024 * 1024;
/** Tope de páginas por import. */
export const NOTION_MAX_PAGES = 5000;
/** Tope de un .md o .csv descomprimido. */
const TEXT_MAX_BYTES = 8 * 1024 * 1024;
/** Tope de un zip interno (parte) que hay que descomprimir para leerlo. */
const PART_MAX_BYTES = 1024 * 1024 * 1024;
const DB_MAX_ROWS = 1000;
const DB_MAX_COLUMNS = 30;
/** Partes de la subida por /chunk (bajo los 4.5 MB de body de Vercel). */
export const NOTION_CHUNK_BYTES = 4 * 1024 * 1024;

// ---------- Dónde vive el zip ----------

/** Carpeta local de las subidas por partes (sin Blob). */
export function importsDir(): string {
  return process.env.IMPORTS_DIR || path.join(os.tmpdir(), 'zerosoft-imports');
}

const FILE_REF = /^file:([A-Za-z0-9._-]{1,120})$/;
const BLOB_REF = /^blob:(https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/imports\/[A-Za-z0-9._%-]+)$/;

/** URL de Blob aceptable para un import (subida por el token de /api/import/upload). */
export function isImportBlobUrl(url: unknown): url is string {
  return typeof url === 'string' && BLOB_REF.test(`blob:${url}`);
}

export function localZipRef(jobId: string): string {
  return `file:${jobId}.zip`;
}

function refSource(ref: string): ZipSource {
  const f = FILE_REF.exec(ref);
  if (f) return fileSource(path.join(importsDir(), f[1]));
  const b = BLOB_REF.exec(ref);
  if (b) return urlSource(b[1]);
  throw new ImportError('invalid_upload');
}

/** Agrega una parte de la subida local; `offset` tiene que ser lo ya recibido (un reintento lo recorta). */
export async function appendLocalChunk(jobId: string, offset: number, chunk: Buffer): Promise<number> {
  const dir = importsDir();
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${jobId}.zip`);
  const current = await stat(file).then((s) => s.size).catch(() => 0);
  if (offset > current) throw new ImportError('chunk_out_of_order');
  if (offset < current) await truncate(file, offset);
  if (offset + chunk.length > NOTION_MAX_ZIP_BYTES) throw new ImportError('file_too_large');
  if (offset === 0) await writeFile(file, chunk);
  else await appendFile(file, chunk);
  return offset + chunk.length;
}

export async function localUploadedBytes(jobId: string): Promise<number> {
  return stat(path.join(importsDir(), `${jobId}.zip`)).then((s) => s.size).catch(() => 0);
}

interface PartRef {
  ref: string;
  base?: number;
  length?: number;
}

function partSource(p: PartRef): ZipSource {
  const src = refSource(p.ref);
  return p.base !== undefined && p.length !== undefined ? sliceSource(src, p.base, p.length) : src;
}

async function deleteRef(ref: string): Promise<void> {
  const f = FILE_REF.exec(ref);
  if (f) {
    await unlink(path.join(importsDir(), f[1])).catch(() => undefined);
    return;
  }
  const b = BLOB_REF.exec(ref);
  if (b && process.env.BLOB_READ_WRITE_TOKEN) await del(b[1]).catch(() => undefined);
}

/** Borra el zip subido y las partes que se extrajeron (al terminar, fallar o cancelar). */
export async function cleanupNotionPayload(job: ImportJob): Promise<void> {
  const refs = new Set<string>();
  if (job.payload) refs.add(job.payload);
  const [first] = await listImportItems<{ parts?: PartRef[] }>(job.id, 0, 1);
  if (first?.kind === 'parts') for (const p of first.data.parts ?? []) refs.add(p.ref);
  for (const ref of refs) await deleteRef(ref);
}

// ---------- Nombres de Notion ----------

const NOTION_ID = /\s?([0-9a-f]{32})$/i;

/** "Notas 1a2b…(32 hex).md" → { title: 'Notas', notionId }. */
export function notionName(file: string): { title: string; notionId: string | null } {
  const base = path.posix.basename(file).replace(/(_all)?\.(md|csv|html?|docx|txt|enex)$/i, '');
  const m = NOTION_ID.exec(base);
  return { title: (m ? base.slice(0, m.index) : base).trim() || 'Untitled', notionId: m ? m[1].toLowerCase() : null };
}

/** Clave de la carpeta que "es" de una página: el path sin extensión (y sin _all). */
function ownerKey(file: string): string {
  return file.replace(/(_all)?\.(md|csv|html?|docx|txt)$/i, '');
}

/** Archivos que pasan a ser una página (además del .csv de una base). */
const PAGE_FILE = /\.(md|html?|docx|txt)$/i;

export type ImportFormat = 'md' | 'csv' | 'html' | 'docx' | 'txt' | 'folder' | 'enex' | 'enex-note';

export function importFormat(file: string): ImportFormat | null {
  const ext = file.toLowerCase().split('.').pop() ?? '';
  if (ext === 'md') return 'md';
  if (ext === 'csv') return 'csv';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'docx') return 'docx';
  if (ext === 'txt') return 'txt';
  if (ext === 'enex') return 'enex';
  return null;
}

function isJunk(name: string): boolean {
  return name.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/.test(name) || /(^|\/)\._/.test(name);
}

export interface NotionPageItem {
  path: string;
  part: number;
  kind: 'page' | 'database';
  title: string;
  notionId: string | null;
  localId: string;
  parentPath: string | null;
  depth: number;
  existing: boolean;
  /** Página de una fila de base: path del CSV. Su contenido va al cuerpo de la fila. */
  rowOf?: string | null;
  /** Formato del archivo (sin el campo: Markdown o CSV de Notion, imports viejos). */
  format?: ImportFormat;
  /** Nota de Evernote: bytes de su <note> dentro del .enex. */
  range?: { start: number; end: number };
}

/**
 * Arma los items (páginas y bases) a partir de los paths del zip. Puro salvo
 * los ids (se pasan los ya importados para reusarlos).
 */
export function planNotionPages(
  files: Array<{ path: string; part: number }>,
  imported: Map<string, string>,
  newId: () => string = () => crypto.randomUUID(),
  opts: { confluence?: Map<string, string | null>; confluenceIndex?: string | null } = {},
): NotionPageItem[] {
  const md = files.filter((f) => PAGE_FILE.test(f.path));
  const csv = files.filter((f) => /\.csv$/i.test(f.path));
  // De "Base <id>.csv" y "Base <id>_all.csv" queda una (la _all trae todas las filas).
  const dbByKey = new Map<string, { path: string; part: number }>();
  for (const f of csv) {
    const key = ownerKey(f.path);
    const prev = dbByKey.get(key);
    if (!prev || /_all\.csv$/i.test(f.path)) dbByKey.set(key, f);
  }
  const all = [
    ...md.map((f) => ({ ...f, kind: 'page' as const })),
    ...[...dbByKey.values()].map((f) => ({ ...f, kind: 'database' as const })),
  ];
  const byOwner = new Map<string, string>();
  for (const f of all) {
    const key = ownerKey(f.path);
    // Si hay "Pagina.md" y "Pagina.html" (raro), la carpeta es de la primera.
    if (!byOwner.has(key)) byOwner.set(key, f.path);
  }

  const items: NotionPageItem[] = all.map((f) => {
    const { title, notionId } = notionName(f.path);
    const key = notionId ?? f.path;
    let dir = path.posix.dirname(f.path);
    let parentPath: string | null = null;
    while (dir && dir !== '.') {
      const owner = byOwner.get(dir);
      if (owner && owner !== f.path) {
        parentPath = owner;
        break;
      }
      dir = path.posix.dirname(dir);
    }
    const mapped = imported.get(key);
    return {
      path: f.path,
      part: f.part,
      kind: f.kind,
      title,
      notionId,
      localId: mapped ?? newId(),
      parentPath,
      depth: 0,
      existing: Boolean(mapped),
      format: importFormat(f.path) ?? 'md',
    };
  });

  // Confluence: el árbol del index.html manda; lo que no figura cuelga del espacio.
  if (opts.confluence) {
    const known = new Set(items.map((i) => i.path));
    for (const i of items) {
      if (i.path === opts.confluenceIndex) {
        i.parentPath = null;
        continue;
      }
      const parent = opts.confluence.get(i.path);
      i.parentPath = parent && known.has(parent) ? parent : opts.confluenceIndex && known.has(opts.confluenceIndex) ? opts.confluenceIndex : null;
    }
  }

  // Carpetas sin página (Google Takeout, un zip de archivos sueltos): una página por carpeta.
  const orphanDirs = new Set<string>();
  if (!opts.confluence) {
    for (const i of items) {
      if (i.parentPath) continue;
      let dir = path.posix.dirname(i.path);
      while (dir && dir !== '.') {
        orphanDirs.add(dir);
        dir = path.posix.dirname(dir);
      }
    }
    // Carpetas envoltorio de arriba (una sola subcarpeta y ningún archivo): no suman nada.
    const directFiles = (dir: string) => items.some((i) => !i.parentPath && path.posix.dirname(i.path) === dir);
    const subdirs = (dir: string) => [...orphanDirs].filter((d) => path.posix.dirname(d) === dir);
    let top = '.';
    for (;;) {
      const kids = subdirs(top);
      if (kids.length !== 1 || directFiles(top)) break;
      orphanDirs.delete(kids[0]);
      top = kids[0];
    }
  }
  for (const dir of [...orphanDirs].sort()) {
    const folderPath = `${dir}/`;
    const key = `folder:${dir}`;
    const mapped = imported.get(key);
    const parentDir = path.posix.dirname(dir);
    items.push({
      path: folderPath,
      part: 0,
      kind: 'page',
      title: path.posix.basename(dir).slice(0, 200) || 'Folder',
      notionId: null,
      localId: mapped ?? newId(),
      parentPath: orphanDirs.has(parentDir) ? `${parentDir}/` : null,
      depth: 0,
      existing: Boolean(mapped),
      format: 'folder',
    });
  }
  for (const i of items) {
    if (i.parentPath || i.format === 'folder') continue;
    const dir = path.posix.dirname(i.path);
    if (orphanDirs.has(dir)) i.parentPath = `${dir}/`;
  }

  // Un archivo cuya carpeta es la de un CSV es una fila de esa base.
  const kindByPath = new Map(items.map((i) => [i.path, i.kind]));
  for (const i of items) {
    if (i.kind === 'page' && i.parentPath && kindByPath.get(i.parentPath) === 'database') i.rowOf = i.parentPath;
  }
  return sortTree(items).slice(0, NOTION_MAX_PAGES);
}

/** Profundidad en el árbol (madres antes que hijas al escribir) y orden por path. */
export function sortTree(items: NotionPageItem[]): NotionPageItem[] {
  const byPath = new Map(items.map((i) => [i.path, i]));
  const depthOf = (i: NotionPageItem): number => {
    let d = 1;
    const seen = new Set([i.path]);
    let cur = i.parentPath ? byPath.get(i.parentPath) : undefined;
    while (cur && !seen.has(cur.path) && d < 200) {
      seen.add(cur.path);
      d++;
      cur = cur.parentPath ? byPath.get(cur.parentPath) : undefined;
    }
    return d;
  };
  for (const i of items) i.depth = depthOf(i);
  return items.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
}

// ---------- Lectura ----------

/** Zips internos (exports en partes): stored → se leen en el lugar; deflate → se extraen a otro archivo. */
async function resolveParts(job: ImportJob, outer: ZipSource, entries: ZipEntry[]): Promise<PartRef[]> {
  const meaningful = entries.filter((e) => !isJunk(e.name));
  const zips = meaningful.filter((e) => /\.zip$/i.test(e.name));
  if (zips.length === 0 || zips.length !== meaningful.length) return [{ ref: job.payload! }];
  const parts: PartRef[] = [];
  for (const [i, e] of zips.entries()) {
    if (e.method === 0) {
      parts.push({ ref: job.payload!, base: await zipEntryDataOffset(outer, e), length: e.compressedSize });
      continue;
    }
    const buf = await readZipEntry(outer, e, PART_MAX_BYTES);
    if (process.env.BLOB_READ_WRITE_TOKEN && BLOB_REF.test(job.payload!)) {
      const blob = await put(`imports/${job.id}-part${i + 1}.zip`, buf, { access: 'public', addRandomSuffix: true, contentType: 'application/zip' });
      parts.push({ ref: `blob:${blob.url}` });
    } else {
      const name = `${job.id}-part${i + 1}.zip`;
      await mkdir(importsDir(), { recursive: true });
      await writeFile(path.join(importsDir(), name), buf);
      parts.push({ ref: `file:${name}` });
    }
  }
  return parts;
}

/** Tope de un .enex (se lee entero una vez para ubicar sus notas). */
const ENEX_MAX_BYTES = 200 * 1024 * 1024;
/** Tope de un .docx o .html que se convierte. */
const DOC_MAX_BYTES = 50 * 1024 * 1024;

/** Un .enex del zip: un cuaderno (página) y una página por nota. */
async function enexItems(
  src: ZipSource,
  entry: ZipEntry,
  part: number,
  imported: Map<string, string>,
  parentPath: string | null,
): Promise<NotionPageItem[]> {
  const buf = await readZipEntry(src, entry, ENEX_MAX_BYTES);
  const ranges = enexNoteRanges(buf, NOTION_MAX_PAGES);
  const notebookKey = `enex:${entry.name}`;
  const nb = imported.get(notebookKey);
  const notebook: NotionPageItem = {
    path: entry.name,
    part,
    kind: 'page',
    title: notionName(entry.name).title,
    notionId: null,
    localId: nb ?? crypto.randomUUID(),
    parentPath,
    depth: 0,
    existing: Boolean(nb),
    format: 'enex',
  };
  const notes = ranges.map((r, i): NotionPageItem => {
    const key = `${entry.name}#${i}`;
    const mapped = imported.get(key);
    return {
      path: key,
      part,
      kind: 'page',
      title: enexNoteTitle(buf.toString('utf8', r.start, Math.min(r.end, r.start + 64 * 1024))),
      notionId: null,
      localId: mapped ?? crypto.randomUUID(),
      parentPath: entry.name,
      depth: 0,
      existing: Boolean(mapped),
      format: 'enex-note',
      range: r,
    };
  });
  return [notebook, ...notes];
}

/** Un solo paso: lista el zip (y sus partes) y arma el árbol. */
export async function notionFetchStep(job: ImportJob): Promise<FetchStepResult> {
  if (!job.payload) throw new ImportError('invalid_upload');
  try {
    const outer = refSource(job.payload);
    const outerEntries = await listZipEntries(outer);
    const parts = await resolveParts(job, outer, outerEntries);
    const files: Array<{ path: string; part: number; size: number }> = [];
    const enex: Array<{ entry: ZipEntry; part: number; src: ZipSource }> = [];
    const indexes: Array<{ entry: ZipEntry; part: number; src: ZipSource }> = [];
    let attachments = 0;
    let bytes = 0;
    for (const [part, p] of parts.entries()) {
      const src = p.ref === job.payload && p.base === undefined ? outer : partSource(p);
      const entries = src === outer ? outerEntries : await listZipEntries(src);
      for (const e of entries) {
        if (isJunk(e.name) || e.name.endsWith('/')) continue;
        // Zip-slip: nada se escribe a disco con estos nombres, pero un path absoluto o con ".." se descarta igual.
        if (e.name.startsWith('/') || e.name.split('/').includes('..') || e.name.includes('\\')) continue;
        bytes += e.size;
        const format = importFormat(e.name);
        if (format === 'enex') enex.push({ entry: e, part, src });
        else if (format) {
          files.push({ path: e.name, part, size: e.size });
          if (/(^|\/)index\.html$/i.test(e.name) && e.size <= TEXT_MAX_BYTES) indexes.push({ entry: e, part, src });
        } else attachments += 1;
      }
    }
    if (files.length === 0 && enex.length === 0) throw new ImportError('notion_empty');
    const provider = importProvider(job);
    // Confluence: el index.html del espacio trae el árbol de páginas.
    let confluence: Map<string, string | null> | undefined;
    let confluenceIndex: string | null = null;
    for (const ix of indexes) {
      const html = (await readZipEntry(ix.src, ix.entry, TEXT_MAX_BYTES)).toString('utf8');
      if (!isConfluenceIndex(html)) continue;
      confluence = confluenceTree(html, path.posix.dirname(ix.entry.name));
      confluenceIndex = ix.entry.name;
      break;
    }
    const keys = [
      ...files.map((f) => notionName(f.path).notionId ?? f.path),
      ...files.map((f) => `folder:${path.posix.dirname(f.path)}`),
    ];
    const imported = await getExternalIds(job.workspace_id, provider, 'page', keys);
    const pages = planNotionPages(files, imported, undefined, { confluence, confluenceIndex });
    /** Archivos que no se pudieron leer (un .enex enorme): se avisan y el resto sigue. */
    const skippedFiles: string[] = [];
    for (const x of enex) {
      if (pages.length >= NOTION_MAX_PAGES) break;
      const ids = await getExternalIds(job.workspace_id, provider, 'page', [`enex:${x.entry.name}`]);
      // Los ids de las notas se piden juntos (pueden ser miles).
      let noteItems: NotionPageItem[];
      try {
        noteItems = await enexItems(x.src, x.entry, x.part, ids, null);
      } catch (err) {
        if (!(err instanceof ZipError)) throw err;
        skippedFiles.push(path.posix.basename(x.entry.name).slice(0, 200));
        continue;
      }
      const noteIds = await getExternalIds(job.workspace_id, provider, 'page', noteItems.slice(1).map((n) => n.path));
      for (const n of noteItems.slice(1)) {
        const mapped = noteIds.get(n.path);
        if (mapped) {
          n.localId = mapped;
          n.existing = true;
        }
      }
      const dir = path.posix.dirname(x.entry.name);
      const folder = pages.find((pg) => pg.format === 'folder' && pg.path === `${dir}/`);
      noteItems[0].parentPath = folder ? folder.path : null;
      pages.push(...noteItems.slice(0, NOTION_MAX_PAGES - pages.length));
    }
    if (pages.length === 0) throw new ImportError(skippedFiles.length ? 'file_too_large' : 'notion_empty');
    const ordered = sortTree(pages);
    // Tope de páginas por import: lo que sobra no entra y se avisa en la vista previa.
    const capped = files.length + enex.length > NOTION_MAX_PAGES || pages.length >= NOTION_MAX_PAGES;
    return {
      items: [
        { kind: 'parts', data: { parts, attachments, bytes, skippedFiles, capped } },
        ...ordered.map((p) => ({ kind: p.kind, data: p })),
      ],
      cursor: {},
      done: true,
    };
  } catch (err) {
    if (err instanceof ZipError) throw new ImportError(err.code === 'zip_entry_too_large' ? 'file_too_large' : 'invalid_zip');
    throw err;
  }
}

/** Proveedor de los ids externos (reimportar el mismo archivo no duplica). */
function importProvider(job: ImportJob): string {
  return job.source === 'notion' ? 'notion' : `docs-${job.source}`;
}

export async function notionPreview(_job: ImportJob, items: StagedItem[]): Promise<Record<string, unknown>> {
  const meta = (items.find((i) => i.kind === 'parts')?.data ?? {}) as {
    parts?: PartRef[];
    attachments?: number;
    bytes?: number;
    skippedFiles?: string[];
    capped?: boolean;
  };
  const pages = items.filter((i) => i.kind === 'page' || i.kind === 'database').map((i) => i.data as unknown as NotionPageItem);
  // Muestra del árbol: profundidad relativa a la página de más arriba.
  const rows = pages.filter((p) => p.rowOf);
  const own = pages.filter((p) => !p.rowOf);
  const minDepth = own.reduce((m, p) => Math.min(m, p.depth), Infinity);
  return {
    pages: own.filter((p) => p.kind === 'page').length,
    databases: own.filter((p) => p.kind === 'database').length,
    rows: rows.length,
    attachments: meta.attachments ?? 0,
    bytes: meta.bytes ?? 0,
    parts: meta.parts?.length ?? 1,
    alreadyImported: own.filter((p) => p.existing).length,
    skippedFiles: meta.skippedFiles ?? [],
    capped: meta.capped === true,
    maxPages: NOTION_MAX_PAGES,
    tree: orderTree(own)
      .slice(0, 40)
      .map((p) => ({ title: p.title, kind: p.kind, depth: p.depth - minDepth })),
  };
}

/** Orden de árbol (cada página seguida de sus hijas) para mostrar. */
function orderTree(pages: NotionPageItem[]): NotionPageItem[] {
  const children = new Map<string | null, NotionPageItem[]>();
  for (const p of pages) {
    const k = p.parentPath && pages.some((x) => x.path === p.parentPath) ? p.parentPath : null;
    children.set(k, [...(children.get(k) ?? []), p]);
  }
  const out: NotionPageItem[] = [];
  const walk = (k: string | null) => {
    for (const p of (children.get(k) ?? []).sort((a, b) => a.title.localeCompare(b.title))) {
      out.push(p);
      if (out.length > 200) return;
      walk(p.path);
    }
  };
  walk(null);
  return out;
}

// ---------- Conversión (pura) ----------

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

export function mimeFor(name: string): string {
  return MIME_BY_EXT[name.toLowerCase().split('.').pop() ?? ''] ?? 'application/octet-stream';
}

const EMOJI_TITLE = /^(\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*)\s+(.+)$/u;

/** Ícono al inicio del título ("🚀 Roadmap"), si lo hay. */
export function splitIcon(title: string): { icon: string | null; title: string } {
  const m = EMOJI_TITLE.exec(title.trim());
  return m ? { icon: m[1], title: m[2].trim() } : { icon: null, title: title.trim() };
}

function safeDecode(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

export interface ConvertContext {
  /** Path del .md dentro del zip (para resolver links relativos). */
  path: string;
  /** Path (del zip) → id local de página. */
  pageByPath: Map<string, string>;
  /** Id de Notion (32 hex) → id local, para links notion.so. */
  pageByNotionId: Map<string, string>;
  /** ¿Existe este archivo en el zip? */
  hasFile: (zipPath: string) => boolean;
}

export interface Attachment {
  marker: string;
  zipPath: string;
  label: string;
  image: boolean;
}

const MD_LINK = /(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function pageForPath(ctx: ConvertContext, target: string): string | null {
  return ctx.pageByPath.get(target) ?? ctx.pageByPath.get(target.replace(/\.csv$/i, '_all.csv')) ?? null;
}

/**
 * Markdown de Notion → Markdown listo para markdownToBlocks: links internos a
 * `zspage:<id>`, adjuntos solos en su línea a un marcador (después se suben y
 * pasan a bloque image/file), `<aside>` a callout. Devuelve los adjuntos.
 */
export function rewriteNotionMarkdown(md: string, ctx: ConvertContext): { md: string; attachments: Attachment[] } {
  const dir = path.posix.dirname(ctx.path);
  const attachments: Attachment[] = [];
  const asides = md.replace(/<aside>\s*([\s\S]*?)\s*<\/aside>/g, (_m, inner: string) =>
    `> [!NOTE]\n${inner
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n')}`,
  );
  const lines = asides.split('\n').map((line) => {
    const trimmed = line.trim();
    return line.replace(MD_LINK, (whole, bang: string, text: string, rawHref: string) => {
      const href = safeDecode(rawHref);
      if (/^https?:\/\//i.test(href)) {
        const nid = /notion\.(?:so|site)\/[^?#]*?([0-9a-f]{32})(?:[?#]|$)/i.exec(href)?.[1]?.toLowerCase();
        const local = nid ? ctx.pageByNotionId.get(nid) : null;
        if (local) return `[${text || 'Page'}](zspage:${local})`;
        return whole;
      }
      if (/^(mailto|tel):/i.test(href)) return whole;
      const target = path.posix.normalize(path.posix.join(dir, href.split('#')[0]));
      const local = pageForPath(ctx, target);
      if (local) return `[${text || notionName(target).title}](zspage:${local})`;
      if (ctx.hasFile(target)) {
        const label = text || path.posix.basename(target);
        // Solo en su línea pasa a bloque; dentro de un párrafo queda el nombre.
        if (trimmed === whole) {
          const marker = `zsattach${attachments.length}x${Math.random().toString(36).slice(2, 8)}`;
          attachments.push({ marker, zipPath: target, label, image: bang === '!' });
          return marker;
        }
        return label;
      }
      return text || path.posix.basename(target);
    });
  });
  return { md: lines.join('\n'), attachments };
}

/** HTML-lite con `zspage:` → links `[[ ]]` canónicos, saneado. */
export function sanitizeNotionHtml(html: string): string {
  return sanitizeDocsHtml(html.replace(/<a href="zspage:([A-Za-z0-9_-]{1,64})">/g, '<a href="/app/docs/$1" data-page="$1">'));
}

/** Título del .md: el primer "# …" (Notion lo pone siempre) o el del archivo. */
export function splitTitle(md: string, fallback: string): { title: string; body: string } {
  const src = md.replace(/^﻿/, '');
  const m = /^#\s+(.+?)\s*(?:\n|$)/.exec(src);
  return m ? { title: m[1].trim(), body: src.slice(m[0].length) } : { title: fallback, body: src };
}

function looksDate(v: string): string | null {
  if (!/\d{4}/.test(v) || v.includes('→')) return null;
  const clean = v.replace(/\s*\(GMT[^)]*\)\s*$/, '');
  const t = Date.parse(clean);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Columna que Notion llama Status (o Estado / Situação): va como propiedad status. */
const STATUS_NAME = /^(status|estado|state|situa[cç][aã]o|etapa)$/i;

const YES_NO = new Set(['yes', 'no', 'true', 'false', '__yes__', '__no__']);

/**
 * CSV de una base de Notion → bloque database con el modelo de
 * lib/docs-database.ts: la primera columna es el título y cada otra toma el
 * tipo que encaja con todos sus valores (número, fecha, checkbox, URL, email,
 * multi-select con comas, status si se llama así, select si se repiten pocos
 * valores; si no, texto).
 */
export function csvToDatabaseBlock(text: string, newId: () => string = newDbId, title?: string): DocsBlock {
  const [header = [], ...data] = parseCsv(text);
  const width = Math.min(Math.max(header.length, 1), DB_MAX_COLUMNS);
  const cells = data.slice(0, DB_MAX_ROWS).map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? '').trim().slice(0, 2000)));
  const now = new Date().toISOString();
  const rows: DbRow[] = cells.map(() => ({ id: newId(), values: {}, created_at: now, updated_at: now }));
  const properties: DbProperty[] = [];
  for (let i = 0; i < width; i++) {
    const name = (header[i] ?? '').trim().slice(0, 200) || `Column ${i + 1}`;
    const values = cells.map((r) => r[i]).filter(Boolean);
    const prop: DbProperty = { id: newId(), name, type: i === 0 ? 'title' : 'text' };
    const set = (fn: (v: string) => DbValue) =>
      cells.forEach((r, k) => {
        const v = r[i] ? fn(r[i]) : null;
        if (v !== null && !(Array.isArray(v) && v.length === 0)) rows[k].values[prop.id] = v;
      });
    if (i > 0 && values.length > 0) {
      const distinct = [...new Set(values)];
      const parts = [...new Set(values.flatMap((v) => v.split(',').map((x) => x.trim()).filter(Boolean)))];
      const options = (names: string[]) => names.slice(0, 100).map((n) => ({ id: newId(), name: n }));
      if (values.every((v) => /^-?\d+(?:\.\d+)?$/.test(v))) {
        prop.type = 'number';
        set((v) => Number(v));
      } else if (values.every((v) => YES_NO.has(v.toLowerCase()))) {
        prop.type = 'checkbox';
        set((v) => ['yes', 'true', '__yes__'].includes(v.toLowerCase()));
      } else if (values.every(looksDate)) {
        prop.type = 'date';
        set((v) => looksDate(v));
      } else if (values.every((v) => /^https?:\/\/\S+$/i.test(v))) {
        prop.type = 'url';
        set((v) => v);
      } else if (values.every((v) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(v))) {
        prop.type = 'email';
        set((v) => v);
      } else if (
        (STATUS_NAME.test(name) && distinct.length <= 30 && distinct.every((v) => v.length <= 60 && !v.includes(','))) ||
        (cells.length >= 2 && distinct.length <= 12 && distinct.length < cells.length && distinct.every((v) => v.length <= 40 && !v.includes(',')))
      ) {
        // Status se reconoce por el nombre aunque cada fila tenga un valor distinto.
        const isStatus = STATUS_NAME.test(name);
        prop.type = isStatus ? 'status' : 'select';
        prop.options = options(distinct).map((o) => (isStatus ? { ...o, group: guessStatusGroup(o.name) } : o));
        const byName = new Map(prop.options.map((o) => [o.name, o.id]));
        set((v) => byName.get(v) ?? null);
      } else if (values.some((v) => v.includes(',')) && parts.length <= 30 && parts.every((v) => v.length <= 40)) {
        prop.type = 'multi_select';
        prop.options = options(parts);
        const byName = new Map(prop.options.map((o) => [o.name, o.id]));
        set((v) => v.split(',').map((x) => byName.get(x.trim())).filter((x): x is string => Boolean(x)));
      }
    }
    if (prop.type === 'title' || prop.type === 'text') set((v) => v);
    properties.push(prop);
  }
  const view = { id: newId(), name: '', type: 'table' as const };
  const dbTitle = title?.trim().slice(0, 200);
  return {
    id: newId(),
    type: 'database',
    content: '',
    db: { properties, rows, views: [view], active_view: view.id, ...(dbTitle ? { title: dbTitle } : {}) },
  };
}

/**
 * Notion repite las propiedades de la fila al principio del .md ("Status:
 * Done"), debajo del título. Ya vienen en el CSV: se sacan del cuerpo.
 */
export function stripRowProperties(body: string, columns: string[]): string {
  const names = new Set(columns.map((c) => c.trim().toLowerCase()).filter(Boolean));
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  const start = i;
  while (i < lines.length) {
    const m = /^([^:\n]{1,200}):(?:\s|$)/.exec(lines[i]);
    if (!m || !names.has(m[1].trim().toLowerCase())) break;
    i++;
  }
  if (i === start) return body;
  while (i < lines.length && lines[i].trim() === '') i++;
  return lines.slice(i).join('\n');
}

function rowKey(v: unknown): string {
  return typeof v === 'string' ? splitIcon(v).title.trim().toLowerCase() : '';
}

/**
 * Pone el cuerpo de cada fila (de su .md) en la fila de la base con el mismo
 * título; si no hay ninguna, suma la fila. Cada fila se usa una sola vez
 * (títulos repetidos van en orden). Devuelve cuántas filas quedaron con cuerpo.
 */
export function attachRowBodies(
  block: DocsBlock,
  bodies: Array<{ title: string; blocks: DocsBlock[] }>,
  newId: () => string = newDbId,
): number {
  const db = block.db;
  const titleProp = db?.properties.find((p) => p.type === 'title');
  if (!db || !titleProp) return 0;
  const used = new Set<string>();
  let attached = 0;
  for (const b of bodies) {
    const key = rowKey(b.title);
    let row = db.rows.find((r) => !used.has(r.id) && rowKey(r.values[titleProp.id]) === key);
    if (!row) {
      if (db.rows.length >= DB_MAX_ROWS) continue;
      const now = new Date().toISOString();
      row = { id: newId(), values: { [titleProp.id]: b.title.slice(0, 2000) }, created_at: now, updated_at: now };
      db.rows.push(row);
    }
    used.add(row.id);
    const content = b.blocks.filter((x) => !(x.type === 'paragraph' && !x.content));
    if (content.length) {
      row.body = content.slice(0, DOCS_IMPORT_MAX_BLOCKS);
      attached++;
    }
  }
  return attached;
}

// ---------- Escritura ----------

export interface NotionImportReport {
  [key: string]: unknown;
  pages: number;
  databases: number;
  /** Filas de base que trajeron su página (cuerpo de la fila). */
  rows?: number;
  files: number;
  filesSkipped: number;
  skipped: number;
  roots: Array<{ id: string; title: string }>;
  /** Páginas con un archivo de texto más grande que el tope: quedaron vacías. */
  tooLarge?: number;
}

export function emptyNotionReport(): NotionImportReport {
  return { pages: 0, databases: 0, rows: 0, files: 0, filesSkipped: 0, skipped: 0, roots: [], tooLarge: 0 };
}

interface PartIndex {
  sources: ZipSource[];
  entries: Map<string, { part: number; entry: ZipEntry }>;
}

async function indexParts(parts: PartRef[]): Promise<PartIndex> {
  const sources = parts.map(partSource);
  const entries = new Map<string, { part: number; entry: ZipEntry }>();
  for (const [part, src] of sources.entries()) {
    for (const entry of await listZipEntries(src)) entries.set(entry.name, { part, entry });
  }
  return { sources, entries };
}

async function readText(idx: PartIndex, zipPath: string): Promise<string> {
  const hit = idx.entries.get(zipPath);
  if (!hit) return '';
  return (await readZipEntry(idx.sources[hit.part], hit.entry, TEXT_MAX_BYTES)).toString('utf8');
}

async function uploadBytes(name: string, mime: string, buf: Buffer | null, image: boolean, label: string, report: NotionImportReport): Promise<DocsBlock> {
  const fallback: DocsBlock = { id: crypto.randomUUID(), type: 'paragraph', content: label.replace(/[<&>]/g, '') };
  const safeName = (name || 'file').slice(0, 200);
  if (!buf || buf.length > MAX_UPLOAD_SIZE || !isAllowedUpload(safeName, mime)) {
    report.filesSkipped += 1;
    return fallback;
  }
  try {
    const url = await saveUpload('docs', safeName, mime, buf);
    report.files += 1;
    return { id: crypto.randomUUID(), type: image ? fileKindFor(mime) : 'file', content: '', url, name: safeName, size: buf.length, mime };
  } catch {
    report.filesSkipped += 1;
    return fallback;
  }
}

async function uploadAttachment(idx: PartIndex, a: Attachment, report: NotionImportReport): Promise<DocsBlock> {
  const hit = idx.entries.get(a.zipPath);
  const name = path.posix.basename(a.zipPath).slice(0, 200);
  const mime = mimeFor(name);
  if (!hit || hit.entry.size > MAX_UPLOAD_SIZE) return uploadBytes(name, mime, null, a.image, a.label, report);
  const buf = await readZipEntry(idx.sources[hit.part], hit.entry, MAX_UPLOAD_SIZE).catch(() => null);
  return uploadBytes(name, mime, buf, a.image, a.label, report);
}

/** Cambia cada párrafo que es solo un marcador por el bloque que devuelve `make`. */
async function replaceMarkers(blocks: DocsBlock[], make: (marker: string) => (() => Promise<DocsBlock>) | null): Promise<DocsBlock[]> {
  const out: DocsBlock[] = [];
  for (const b of blocks) {
    const fn = b.type === 'paragraph' ? make(b.content.trim()) : null;
    out.push(fn ? { ...(await fn()), ...(b.indent ? { indent: b.indent } : {}) } : b);
  }
  return out;
}

/** Callout que empieza con un emoji: el emoji pasa a ser el ícono del recuadro. */
function calloutIcons(blocks: DocsBlock[]): DocsBlock[] {
  return blocks.map((b) => {
    if (b.type !== 'callout') return b;
    const m = /^(\p{Extended_Pictographic}️?)\s*/u.exec(b.content);
    return m ? { ...b, icon: m[1], content: b.content.slice(m[0].length) } : b;
  });
}

async function readBytes(idx: PartIndex, zipPath: string, max: number): Promise<Buffer | null> {
  const hit = idx.entries.get(zipPath);
  if (!hit || hit.entry.size > max) return null;
  return readZipEntry(idx.sources[hit.part], hit.entry, max).catch(() => null);
}

/** Bytes de una nota de un .enex: por rango si el .enex va sin comprimir; si no, se infla entero. */
async function readEnexNote(idx: PartIndex, cache: Map<string, Buffer>, enexPath: string, range: { start: number; end: number }): Promise<string> {
  const hit = idx.entries.get(enexPath);
  if (!hit) return '';
  const len = Math.min(range.end - range.start, ENEX_MAX_BYTES);
  if (hit.entry.method === 0) {
    const base = await zipEntryDataOffset(idx.sources[hit.part], hit.entry);
    return (await idx.sources[hit.part].read(base + range.start, len)).toString('utf8');
  }
  let buf = cache.get(enexPath);
  if (!buf) {
    buf = await readZipEntry(idx.sources[hit.part], hit.entry, ENEX_MAX_BYTES);
    cache.clear();
    cache.set(enexPath, buf);
  }
  return buf.toString('utf8', range.start, range.start + len);
}

export async function notionWriteStep(job: ImportJob, items: StagedItem[], report: NotionImportReport): Promise<void> {
  const pages = items.filter((i) => i.kind === 'page' || i.kind === 'database').map((i) => i.data as unknown as NotionPageItem);
  if (pages.length === 0) return;
  const all = (await listImportItems(job.id)).filter((i) => i.kind !== 'parts').map((i) => i.data as unknown as NotionPageItem);
  const [partsItem] = await listImportItems<{ parts: PartRef[] }>(job.id, 0, 1);
  let idx: PartIndex;
  try {
    idx = await indexParts(partsItem?.data.parts ?? [{ ref: job.payload ?? '' }]);
  } catch (err) {
    if (err instanceof ZipError) throw new ImportError('invalid_zip');
    throw err;
  }
  const provider = importProvider(job);
  const byPath = new Map(all.map((p) => [p.path, p]));
  // Un link a una fila lleva a la página de su base.
  const localFor = (p: NotionPageItem) => (p.rowOf ? (byPath.get(p.rowOf)?.localId ?? p.localId) : p.localId);
  const pageByPath = new Map(all.map((p) => [p.path, localFor(p)]));
  const pageByNotionId = new Map(all.filter((p) => p.notionId).map((p) => [p.notionId!, localFor(p)]));
  const ctxBase = {
    pageByPath,
    pageByNotionId,
    hasFile: (p: string) => idx.entries.has(p),
  };
  const db = getDb();
  // Teamspace de destino (lo validó quien creó el job); las subpáginas toman el de su madre.
  const destTeamspace = typeof job.options.teamspace_id === 'string' ? job.options.teamspace_id : null;
  // El acceso al teamspace se revalida al escribir (pudo salir de él o borrarse desde que armó el import).
  if (destTeamspace && !(await canWriteTeamspace(job.workspace_id, job.user_id, destTeamspace))) throw new ImportError('forbidden');
  const enexCache = new Map<string, Buffer>();

  /** .md de Notion → bloques, con links internos, callouts y adjuntos subidos. */
  const convertMd = async (zipPath: string, body: string): Promise<DocsBlock[]> => {
    const { md, attachments } = rewriteNotionMarkdown(body, { ...ctxBase, path: zipPath });
    const blocks = calloutIcons(markdownToBlocks(md, { sanitize: sanitizeNotionHtml }));
    if (!attachments.length) return blocks;
    const byMarker = new Map(attachments.map((a) => [a.marker, a]));
    return replaceMarkers(blocks, (m) => {
      const a = byMarker.get(m);
      return a ? () => uploadAttachment(idx, a, report) : null;
    });
  };

  /** HTML (Notion, Confluence, Google Docs o suelto) → título y bloques. */
  const convertHtml = async (zipPath: string, text: string, fallback: string): Promise<{ title: string; blocks: DocsBlock[] }> => {
    const page = parseHtmlPage(text);
    const { html, attachments } = rewriteHtmlRefs(page.body, {
      path: zipPath,
      pageFor: (p) => pageByPath.get(p) ?? pageByPath.get(p.replace(/\.csv$/i, '_all.csv')) ?? null,
      pageByNotionId: (id) => pageByNotionId.get(id) ?? null,
      hasFile: ctxBase.hasFile,
    });
    let blocks = calloutIcons(htmlToBlocks(html, { sanitize: sanitizeNotionHtml }));
    // El <h1> del título repetido como primer bloque.
    const t = page.title ?? fallback;
    if (blocks[0]?.type === 'heading' && blocks[0].content.replace(/<[^>]*>/g, '').trim() === t.trim()) blocks = blocks.slice(1);
    if (attachments.length) {
      const byMarker = new Map(attachments.map((a) => [a.marker, a]));
      blocks = await replaceMarkers(blocks, (m) => {
        const a = byMarker.get(m);
        return a ? () => uploadAttachment(idx, a, report) : null;
      });
    }
    return { title: t, blocks };
  };

  for (const page of pages) {
    // Las filas se escriben con su base (cuerpo de la fila), no como páginas.
    if (page.rowOf) continue;
    if (page.existing && (await db.prepare('SELECT 1 AS one FROM docs_pages WHERE id = ?').get(page.localId))) {
      report.skipped += 1;
      continue;
    }
    const direct = page.parentPath ? byPath.get(page.parentPath) : undefined;
    // Subpágina de una fila: queda debajo de la página de la base.
    const parent = direct?.rowOf ? byPath.get(direct.rowOf) : direct;
    const parentRow = parent
      ? ((await db.prepare('SELECT teamspace_id FROM docs_pages WHERE id = ? AND user_id = ?').get(parent.localId, job.workspace_id)) as
          | { teamspace_id: string | null }
          | undefined)
      : undefined;
    const parentId = parentRow && parent ? parent.localId : null;
    const teamspaceId = parentRow ? (parentRow.teamspace_id ?? null) : destTeamspace;

    let title = page.title;
    let blocks: DocsBlock[] = [];
    let created: string | null = null;
    let updated: string | null = null;
    const format = page.kind === 'database' ? 'csv' : (page.format ?? 'md');
    // Un .md/.html/.csv más grande que el tope: la página entra vacía y se avisa.
    const textHit = format === 'md' || format === 'html' || format === 'txt' || format === 'csv' ? idx.entries.get(page.path) : undefined;
    const tooLarge = Boolean(textHit && textHit.entry.size > TEXT_MAX_BYTES);
    if (tooLarge) report.tooLarge = (report.tooLarge ?? 0) + 1;
    if (tooLarge) {
      blocks = [];
    } else if (format === 'csv') {
      const text = await readText(idx, page.path).catch(() => '');
      const block = csvToDatabaseBlock(text, newDbId, splitIcon(page.title).title);
      const columns = block.db?.properties.map((p) => p.name) ?? [];
      const bodies: Array<{ title: string; blocks: DocsBlock[] }> = [];
      for (const row of all.filter((p) => p.rowOf === page.path)) {
        const rowText = await readText(idx, row.path).catch(() => '');
        if (row.format === 'html') {
          // Notion HTML: las propiedades de la fila (ya en el CSV) van en <table class="properties">.
          const conv = await convertHtml(row.path, rowText.replace(/<table\b[^>]*class="properties"[\s\S]*?<\/table>/i, ''), row.title);
          bodies.push({ title: conv.title, blocks: conv.blocks });
        } else {
          const split = splitTitle(rowText, row.title);
          bodies.push({ title: split.title, blocks: await convertMd(row.path, stripRowProperties(split.body, columns)) });
        }
      }
      report.rows = (report.rows ?? 0) + attachRowBodies(block, bodies);
      blocks = [block];
    } else if (format === 'md') {
      const split = splitTitle(await readText(idx, page.path).catch(() => ''), page.title);
      title = split.title;
      blocks = await convertMd(page.path, split.body);
    } else if (format === 'html') {
      const conv = await convertHtml(page.path, await readText(idx, page.path).catch(() => ''), page.title);
      title = conv.title;
      blocks = conv.blocks;
    } else if (format === 'txt') {
      blocks = plainTextToBlocks(await readText(idx, page.path).catch(() => ''));
    } else if (format === 'docx') {
      const buf = await readBytes(idx, page.path, DOC_MAX_BYTES);
      if (buf) {
        try {
          const raw = docxToBlocks(buf, undefined, { imageMarkers: true });
          blocks = await replaceMarkers(raw, (m) => {
            if (!m.startsWith(DOCX_IMAGE_MARKER)) return null;
            const target = m.slice(DOCX_IMAGE_MARKER.length);
            const name = path.posix.basename(target);
            return () => uploadBytes(name, mimeFor(name), readDocxMedia(buf, target, MAX_UPLOAD_SIZE), true, name, report);
          });
        } catch {
          report.filesSkipped += 1;
        }
      } else report.filesSkipped += 1;
    } else if (format === 'enex-note' && page.range) {
      const enexPath = page.path.slice(0, page.path.lastIndexOf('#'));
      const note = parseEnexNote(await readEnexNote(idx, enexCache, enexPath, page.range).catch(() => ''));
      title = note.title;
      created = note.created;
      updated = note.updated;
      // Recursos por md5 de sus bytes (así los nombra <en-media hash>).
      const byHash = new Map<string, { buf: Buffer; mime: string; name: string }>();
      for (const r of note.resources) {
        if (r.data.length > (MAX_UPLOAD_SIZE * 4) / 3 + 16) {
          report.filesSkipped += 1;
          continue;
        }
        const buf = Buffer.from(r.data, 'base64');
        byHash.set(createHash('md5').update(buf).digest('hex'), { buf, mime: r.mime, name: r.name });
      }
      const markers = new Map<string, string>();
      const html = enmlToHtml(note.content, (hash) => {
        if (!byHash.has(hash)) return null;
        const m = `zsenex${markers.size}x${hash.slice(0, 8)}`;
        markers.set(m, hash);
        return m;
      });
      blocks = await replaceMarkers(htmlToBlocks(html, { sanitize: sanitizeNotionHtml }), (m) => {
        const hash = markers.get(m);
        const res = hash ? byHash.get(hash) : undefined;
        if (!res || !hash) return null;
        const ext = res.mime.split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'bin';
        const name = res.name || `${hash.slice(0, 8)}.${ext}`;
        return () => uploadBytes(name, res.mime, res.buf, /^image\//.test(res.mime), name, report);
      });
      if (note.tags.length) blocks.push({ id: crypto.randomUUID(), type: 'paragraph', content: `<em>${note.tags.map((x) => x.replace(/[<&>]/g, '')).join(', ')}</em>` });
    }
    // 'folder' y 'enex' (cuaderno): página vacía que agrupa a sus hijas.
    const { icon, title: cleanTitle } = splitIcon(title);
    const content = blocks.length ? blocks.slice(0, DOCS_IMPORT_MAX_BLOCKS) : [{ id: crypto.randomUUID(), type: 'paragraph' as const, content: '' }];
    const now = new Date().toISOString();
    await db
      .prepare('INSERT INTO docs_pages (id, user_id, parent_id, title, icon, content, teamspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(page.localId, job.workspace_id, parentId, cleanTitle.slice(0, 500), icon, stringifyBlocks(sanitizeBlocks(content)), teamspaceId, created ?? now, updated ?? now);
    const key = page.format === 'folder' ? `folder:${page.path.replace(/\/$/, '')}` : page.format === 'enex' ? `enex:${page.path}` : (page.notionId ?? page.path);
    await setExternalId(job.workspace_id, provider, 'page', key, page.localId);
    if (page.kind === 'database') report.databases += 1;
    else report.pages += 1;
    if (!parentId && report.roots.length < 10) report.roots.push({ id: page.localId, title: cleanTitle.slice(0, 200) });
  }
}

/** ¿Puede `userId` seguir creando páginas en ese teamspace del workspace? (lo mismo que canCreateDocPage, sin sesión). */
async function canWriteTeamspace(workspaceId: string, userId: string, teamspaceId: string): Promise<boolean> {
  const { getTeamspace, teamspaceRoleOf, roleRank } = await import('./docs-access');
  const ts = await getTeamspace(teamspaceId);
  if (!ts || ts.workspace_id !== workspaceId || ts.deleted_at) return false;
  const role = await teamspaceRoleOf(ts.id, userId);
  if (role === 'owner') return true;
  if (!role && ts.access !== 'open') return false;
  // Dueño del workspace o admin: como en canCreateDocPage.
  if (userId === workspaceId) return true;
  const { isWorkspacePerson } = await import('./crm-refs');
  if (!(await isWorkspacePerson(workspaceId, userId))) return false;
  const { workspaceRole } = await import('./api-auth');
  const wr = await workspaceRole(workspaceId, userId);
  if (wr === 'owner' || wr === 'admin') return true;
  return roleRank(ts.member_role) >= roleRank('edit');
}
