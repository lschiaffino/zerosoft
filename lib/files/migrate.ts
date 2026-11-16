/**
 * Migración de los archivos de antes (URLs públicas del Blob de la suite y
 * /uploads/… del disco local) al storage privado de lib/files/store.ts.
 * Server-only. La corre scripts/migrate-private-files.ts.
 *
 * Por cada URL vieja que aparece en la base (en cualquier columna de texto,
 * también adentro de JSON o Markdown):
 *   1. registra el archivo (stored_files con legacy_key; su workspace, app y
 *      permiso salen de la fila que lo usa),
 *   2. lo copia al storage privado (cifrado si no hay store privado) en
 *      stream, con sha256 del original, y relee la copia para verificarla,
 *   3. pasa la fila de stored_files a la copia (compare-and-set),
 *   4. reescribe las referencias en la base a /api/files/<id>/<nombre>
 *      (compare-and-set por celda).
 * Con `deleteOriginals`, y solo para los archivos ya copiados y verificados
 * sin ninguna referencia vieja en la base, vuelve a comparar la copia con el
 * original y recién ahí borra el original público.
 *
 * Idempotente y se puede cortar y retomar: lo registrado se reconoce por
 * legacy_key, lo copiado por su ref, y cada reescritura es compare-and-set.
 * Sin `apply` solo cuenta (por carpeta y bytes).
 */
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { Client, InValue } from '@libsql/client';
import { localUploadPath } from '../uploads';
import {
  fileUrl,
  fileRowForLegacyKey,
  legacyKeyFor,
  newFileId,
  openFile,
  registerLegacyFile,
  storeBytes,
  swapFileRef,
  discardBytes,
  GONE_REF,
  type FileAccess,
  type StoredFileRow,
} from './store';

/** Carpetas que se migran. Rec tiene su propio storage (otro cambio). */
/** Las tablas de los mensajes programados (Inbox y Lines): `--scheduled` en el script. */
export const SCHEDULED_TABLES = ['inbox_scheduled', 'groups_broadcasts', 'groups_recurring'];

export const MIGRATABLE_FOLDERS = ['chat', 'track', 'tasks', 'robots', 'docs', 'boards', 'crm', 'workspace', 'design', 'shop', 'social', 'people', 'inbox'] as const;
type Folder = (typeof MIGRATABLE_FOLDERS)[number];

const DEFAULT_ACCESS: Record<Folder, FileAccess> = {
  chat: 'workspace',
  track: 'workspace',
  tasks: 'workspace',
  robots: 'workspace',
  docs: 'internal',
  boards: 'internal',
  crm: 'internal',
  workspace: 'public',
  design: 'internal',
  shop: 'public',
  social: 'public',
  people: 'internal',
  inbox: 'user',
};

/** Tablas que no se tocan nunca. */
const SKIP_TABLES = new Set(['stored_files', '_migrations', 'schema_migrations', 'sqlite_sequence']);

/**
 * Cómo saber de quién es un archivo según la tabla que lo usa. `ws`: SQL del
 * workspace (sobre la fila, alias t). Sin entrada: workspace_id, user_id u
 * owner_id de la fila, en ese orden.
 */
interface TableRule {
  ws?: string;
  /** Persona dueña (access 'user'). */
  user?: string;
  app?: string;
  access?: FileAccess;
  scope?: string;
}

const RULES: Record<string, TableRule> = {
  groups_messages: { ws: 't.user_id', app: 'groups', access: 'internal' },
  groups_chats: { ws: 't.user_id', app: 'groups', access: 'workspace', scope: "'groups-chat:' || t.id" },
  // Programados y envíos masivos de Lines: los ve quien ve esa línea (lib/groups-broadcasts.ts shareScheduledMedia).
  groups_broadcasts: { ws: 't.user_id', app: 'groups', access: 'workspace', scope: "'groups-number:' || t.number_id" },
  groups_recurring: { ws: 't.user_id', app: 'groups', access: 'workspace', scope: "'groups-number:' || t.number_id" },
  chat_messages: {
    ws: '(SELECT w.user_id FROM chat_conversations c JOIN chat_widgets w ON w.id = c.widget_id WHERE c.id = t.conversation_id)',
    app: 'chat',
    access: 'workspace',
    scope: "'chat-widget:' || (SELECT c.widget_id FROM chat_conversations c WHERE c.id = t.conversation_id)",
  },
  crm_task_files: { ws: '(SELECT a.user_id FROM crm_activities a WHERE a.id = t.activity_id)', app: 'crm', access: 'workspace' },
  inbox_scheduled: { ws: 't.owner_id', user: 't.owner_id', app: 'inbox', access: 'user' },
};

const BLOB_URL = /https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/[A-Za-z0-9._/%-]+/gi;
const LOCAL_URL = /\/uploads\/[a-z]+\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}/g;

export interface MigrateOptions {
  apply?: boolean;
  deleteOriginals?: boolean;
  /** Filas por consulta. */
  batch?: number;
  /** Solo estas carpetas (por defecto, todas las migrables). */
  folders?: string[];
  /** Solo estas tablas (por defecto, todas). */
  tables?: string[];
  /** Tope de archivos a copiar en esta corrida (para ir de a tandas). */
  limit?: number;
  log?: (line: string) => void;
  /** Para tests: cómo leer un original (por defecto fetch o disco). */
  readOriginal?: (url: string) => Promise<AsyncIterable<Uint8Array> | null>;
  /** Para tests: tamaño del original (por defecto HEAD o stat). */
  sizeOf?: (url: string) => Promise<number | null>;
  /** Para tests: borrar el original. */
  deleteOriginal?: (url: string) => Promise<void>;
}

export interface FolderCount {
  files: number;
  bytes: number;
}

export interface MigrateReport {
  /** URLs viejas distintas encontradas, por carpeta (app). */
  byFolder: Record<string, FolderCount>;
  total: FolderCount;
  /** Celdas con URLs viejas en tablas de las que no se sabe el workspace (no se migran). */
  unmapped: Array<{ table: string; column: string; cells: number }>;
  /** Carpetas encontradas que no se migran acá (Rec, imports). */
  skippedFolders: Record<string, number>;
  registered: number;
  copied: number;
  rewrittenCells: number;
  deleted: number;
  failed: Array<{ key: string; reason: string }>;
}

function emptyReport(): MigrateReport {
  return { byFolder: {}, total: { files: 0, bytes: 0 }, unmapped: [], skippedFolders: {}, registered: 0, copied: 0, rewrittenCells: 0, deleted: 0, failed: [] };
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function tables(db: Client): Promise<Array<{ name: string; cols: string[]; textCols: string[] }>> {
  const rs = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'");
  const out: Array<{ name: string; cols: string[]; textCols: string[] }> = [];
  for (const r of rs.rows) {
    const name = String(r.name);
    if (SKIP_TABLES.has(name)) continue;
    const info = await db.execute(`PRAGMA table_info(${q(name)})`);
    const cols = info.rows.map((c) => String(c.name));
    const textCols = info.rows.filter((c) => /TEXT|CHAR|CLOB|^$/i.test(String(c.type ?? ''))).map((c) => String(c.name));
    // Sin rowid (WITHOUT ROWID) no se puede reescribir por celda.
    const hasRowid = await db.execute(`SELECT rowid FROM ${q(name)} LIMIT 0`).then(() => true, () => false);
    if (hasRowid && textCols.length) out.push({ name, cols, textCols });
  }
  return out;
}

function folderOf(url: string): string | null {
  const key = legacyKeyFor(url);
  if (!key) return null;
  const parts = key.split('/');
  return parts[0] === 'uploads' ? parts[1] ?? null : parts[0] ?? null;
}

/** URLs viejas de un texto (sin las cifradas "blobe:" de lib/private-files.ts). */
export function legacyUrlsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(BLOB_URL)) {
    const before = text.slice(Math.max(0, m.index! - 6), m.index);
    if (before.endsWith('blobe:')) continue;
    out.add(m[0]);
  }
  for (const m of text.matchAll(LOCAL_URL)) {
    // "/uploads/…" adentro de otra URL (https://otro/uploads/…) no es nuestro.
    const prev = text[m.index! - 1];
    if (prev && /[A-Za-z0-9.:_-]/.test(prev)) continue;
    if (localUploadPath(m[0])) out.add(m[0]);
  }
  return [...out];
}

function ownerSql(t: { name: string; cols: string[] }): { ws: string; user: string | null } | null {
  const rule = RULES[t.name];
  if (rule?.ws) return { ws: rule.ws, user: rule.user ?? null };
  for (const c of ['workspace_id', 'user_id', 'owner_id']) if (t.cols.includes(c)) return { ws: `t.${q(c)}`, user: null };
  return null;
}

async function defaultSize(url: string): Promise<number | null> {
  if (url.startsWith('/uploads/')) {
    const file = localUploadPath(url);
    const st = file ? await stat(file).catch(() => null) : null;
    return st?.isFile() ? st.size : null;
  }
  const res = await fetch(url, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
  const n = Number(res?.headers.get('content-length'));
  return res?.ok && Number.isFinite(n) ? n : null;
}

async function defaultRead(url: string): Promise<AsyncIterable<Uint8Array> | null> {
  if (url.startsWith('/uploads/')) {
    const file = localUploadPath(url);
    return file ? createReadStream(file) : null;
  }
  const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok || !res.body) return null;
  return res.body as unknown as AsyncIterable<Uint8Array>;
}

async function defaultDelete(url: string): Promise<void> {
  const { deleteUploads } = await import('../uploads');
  await deleteUploads([url]);
}

async function* hashing(src: AsyncIterable<Uint8Array>, h: ReturnType<typeof createHash>): AsyncGenerator<Uint8Array> {
  for await (const piece of src) {
    h.update(piece);
    yield piece;
  }
}

async function hashOf(src: AsyncIterable<Uint8Array>): Promise<{ sha: string; size: number }> {
  const h = createHash('sha256');
  let size = 0;
  for await (const piece of src) {
    h.update(piece);
    size += piece.byteLength;
  }
  return { sha: h.digest('hex'), size };
}

async function copyHash(row: StoredFileRow): Promise<{ sha: string; size: number } | null> {
  const opened = await openFile(row, null).catch(() => null);
  if (!opened) return null;
  return hashOf(opened.stream as unknown as AsyncIterable<Uint8Array>).catch(() => null);
}

interface Found {
  url: string;
  folder: string;
  ws: string;
  user: string | null;
  app: string | null;
  access: FileAccess;
  scope: string | null;
  cells: Array<{ table: string; column: string; rowid: number }>;
}

/** Recorre la base y junta las URLs viejas con su dueño. */
async function discover(db: Client, opts: MigrateOptions, report: MigrateReport, seen?: Set<string>): Promise<Map<string, Found>> {
  const batch = Math.max(50, Math.min(5000, opts.batch ?? 500));
  const wanted = new Set(opts.folders?.length ? opts.folders : MIGRATABLE_FOLDERS);
  const found = new Map<string, Found>();
  for (const t of await tables(db)) {
    if (opts.tables?.length && !opts.tables.includes(t.name)) continue;
    const owner = ownerSql(t);
    const rule = RULES[t.name];
    for (const col of t.textCols) {
      let after = -1;
      let unmapped = 0;
      for (;;) {
        const sel = owner
          ? `SELECT t.rowid AS rid, t.${q(col)} AS v, ${owner.ws} AS ws, ${owner.user ?? 'NULL'} AS person${rule?.scope ? `, ${rule.scope} AS scope` : ''}`
          : `SELECT t.rowid AS rid, t.${q(col)} AS v`;
        const rs = await db.execute({
          sql: `${sel} FROM ${q(t.name)} t WHERE t.rowid > ? AND (t.${q(col)} LIKE '%.public.blob.vercel-storage.com/%' OR t.${q(col)} LIKE '%/uploads/%') ORDER BY t.rowid LIMIT ?`,
          args: [after, batch],
        });
        if (!rs.rows.length) break;
        for (const r of rs.rows) {
          after = Number(r.rid);
          const urls = legacyUrlsIn(String(r.v ?? ''));
          for (const url of urls) {
            seen?.add(url);
            const folder = folderOf(url);
            if (!folder) continue;
            if (!(MIGRATABLE_FOLDERS as readonly string[]).includes(folder) || !wanted.has(folder as Folder)) {
              report.skippedFolders[folder] = (report.skippedFolders[folder] ?? 0) + 1;
              continue;
            }
            const ws = owner ? (r.ws == null ? '' : String(r.ws)) : '';
            if (!ws) {
              unmapped++;
              continue;
            }
            const f = folder as Folder;
            let entry = found.get(url);
            if (!entry) {
              const access = rule?.access ?? DEFAULT_ACCESS[f];
              entry = {
                url,
                folder,
                ws,
                user: access === 'user' ? String(r.person ?? ws) : r.person == null ? null : String(r.person),
                app: rule?.app ?? null,
                access,
                scope: rule?.scope && r.scope != null ? String(r.scope) : null,
                cells: [],
              };
              found.set(url, entry);
            }
            entry.cells.push({ table: t.name, column: col, rowid: Number(r.rid) });
          }
        }
        if (rs.rows.length < batch) break;
      }
      if (unmapped) report.unmapped.push({ table: t.name, column: col, cells: unmapped });
    }
  }
  return found;
}

function nameOf(url: string): string {
  const last = (legacyKeyFor(url) ?? url).split('/').pop() ?? 'file';
  return last.replace(/^[0-9a-f-]{36}-/, '').replace(/-[A-Za-z0-9]{20,40}(\.[A-Za-z0-9]+)$/, '$1') || 'file';
}

function mimeOf(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', heic: 'image/heic',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg',
    wav: 'audio/wav', weba: 'audio/webm', aac: 'audio/aac', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
  };
  return map[ext] ?? 'application/octet-stream';
}

async function rewriteCells(db: Client, entry: Found, newUrl: string): Promise<number> {
  let n = 0;
  for (const c of entry.cells) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const rs = await db.execute({ sql: `SELECT ${q(c.column)} AS v FROM ${q(c.table)} WHERE rowid = ?`, args: [c.rowid] });
      const v = rs.rows[0]?.v;
      if (typeof v !== 'string' || !v.includes(entry.url)) break;
      const next = v.split(entry.url).join(newUrl);
      const up = await db.execute({ sql: `UPDATE ${q(c.table)} SET ${q(c.column)} = ? WHERE rowid = ? AND ${q(c.column)} = ?`, args: [next, c.rowid, v] as InValue[] });
      if (up.rowsAffected > 0) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** Corre la migración (o la cuenta, sin `apply`). */
export async function migratePrivateFiles(db: Client, opts: MigrateOptions = {}): Promise<MigrateReport> {
  const log = opts.log ?? (() => undefined);
  const sizeOf = opts.sizeOf ?? defaultSize;
  const readOriginal = opts.readOriginal ?? defaultRead;
  const report = emptyReport();
  const found = await discover(db, opts, report);
  log(`URLs viejas encontradas: ${found.size}`);

  // Conteo por carpeta, con bytes (HEAD / stat), de a 8 en paralelo.
  const entries = [...found.values()];
  const sizes = new Map<string, number>();
  for (let i = 0; i < entries.length; i += 8) {
    await Promise.all(
      entries.slice(i, i + 8).map(async (e) => {
        const n = (await sizeOf(e.url).catch(() => null)) ?? 0;
        sizes.set(e.url, n);
        const c = (report.byFolder[e.folder] ??= { files: 0, bytes: 0 });
        c.files++;
        c.bytes += n;
        report.total.files++;
        report.total.bytes += n;
      }),
    );
  }
  if (!opts.apply) return report;

  let copiedThisRun = 0;
  for (const e of entries) {
    const key = legacyKeyFor(e.url)!;
    try {
      let row = await fileRowForLegacyKey(key);
      if (row?.ref === GONE_REF) {
        // Su copia se borró (la fila que la usaba ya no está), pero esta celda todavía usa el original: se registra de nuevo.
        await db.execute({ sql: 'DELETE FROM stored_files WHERE id = ? AND ref = ?', args: [row.id, GONE_REF] });
        row = null;
      }
      if (!row) {
        const name = nameOf(e.url);
        row = await registerLegacyFile(e.url, {
          workspaceId: e.ws,
          userId: e.user,
          app: e.app,
          folder: e.folder,
          access: e.access,
          scope: e.scope,
          name,
          mime: mimeOf(name),
          size: sizes.get(e.url) ?? 0,
        });
        if (!row) throw new Error('register_failed');
        report.registered++;
      }
      if (row.ref.startsWith('legacy:')) {
        if (opts.limit !== undefined && copiedThisRun >= opts.limit) continue;
        const src = await readOriginal(e.url);
        if (!src) throw new Error('original_unreadable');
        const h = createHash('sha256');
        let size = 0;
        const counted = (async function* () {
          for await (const piece of hashing(src, h)) {
            size += piece.byteLength;
            yield piece;
          }
        })();
        const stored = await storeBytes(newFileId(), counted, { folder: e.folder, mime: row.mime });
        const sha = h.digest('hex');
        // Verificación: la copia se relee entera y tiene que dar lo mismo.
        const probe: StoredFileRow = { ...row, ref: stored.ref, header: stored.header, size: stored.size };
        const back = await copyHash(probe);
        if (!back || back.sha !== sha || back.size !== size || stored.size !== size) {
          await discardBytes(stored.ref);
          throw new Error('verify_failed');
        }
        if (!(await swapFileRef(row.id, row.ref, stored))) {
          // Otra corrida la copió primero.
          await discardBytes(stored.ref);
        } else {
          report.copied++;
          copiedThisRun++;
        }
        row = (await fileRowForLegacyKey(key))!;
      }
      report.rewrittenCells += await rewriteCells(db, e, fileUrl(row));
    } catch (err) {
      report.failed.push({ key, reason: err instanceof Error ? err.message : 'error' });
      log(`falló ${e.folder}: ${err instanceof Error ? err.message : 'error'}`);
    }
  }

  if (opts.deleteOriginals) await deletePass(db, opts, report);
  return report;
}

/**
 * Borra los originales públicos ya migrados: la fila apunta a la copia, en
 * la base no queda ninguna referencia a la URL vieja, y la copia y el
 * original vuelven a dar el mismo sha256.
 */
async function deletePass(db: Client, opts: MigrateOptions, report: MigrateReport): Promise<void> {
  const readOriginal = opts.readOriginal ?? defaultRead;
  const deleteOriginal = opts.deleteOriginal ?? defaultDelete;
  // Toda URL vieja que siga en la base, en cualquier tabla (aunque esta corrida migre solo algunas) y
  // también en tablas sin dueño conocido. Se compara por clave (el pathname), no por la URL entera.
  const still = new Set<string>();
  await discover(db, { ...opts, folders: undefined, tables: undefined }, emptyReport(), still);
  const used = new Set<string>();
  for (const u of still) {
    const k = legacyKeyFor(u);
    if (k) used.add(k);
  }
  const rs = await db.execute("SELECT * FROM stored_files WHERE legacy_key IS NOT NULL AND ref NOT LIKE 'legacy:%'");
  for (const r of rs.rows) {
    const row = r as unknown as StoredFileRow;
    const key = String(row.legacy_key);
    if (used.has(key)) continue;
    const url = key.startsWith('uploads/') ? `/${key}` : null;
    const original = url ?? (await originalUrlFor(db, key));
    if (!original) continue;
    if (opts.folders?.length && !opts.folders.includes(String(row.folder))) continue;
    try {
      if (row.ref === GONE_REF) {
        // La copia ya se borró con lo que la usaba: el original se va también, y después la marca.
        await deleteOriginal(original);
        await db.execute({ sql: 'DELETE FROM stored_files WHERE id = ? AND ref = ?', args: [row.id, GONE_REF] });
        report.deleted++;
        continue;
      }
      const src = await readOriginal(original);
      if (!src) continue; // Ya no está.
      const a = await hashOf(src);
      const b = await copyHash(row);
      if (!b || a.sha !== b.sha || a.size !== b.size) {
        report.failed.push({ key, reason: 'verify_before_delete_failed' });
        continue;
      }
      await deleteOriginal(original);
      report.deleted++;
    } catch (err) {
      report.failed.push({ key, reason: err instanceof Error ? err.message : 'delete_failed' });
    }
  }
}

/** La URL completa del original: el host del store sale de BLOB_READ_WRITE_TOKEN o de SHOP_BLOB_HOST. */
async function originalUrlFor(_db: Client, key: string): Promise<string | null> {
  const explicit = process.env.FILES_LEGACY_BLOB_HOST?.trim().toLowerCase() || process.env.SHOP_BLOB_HOST?.trim().toLowerCase();
  const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(process.env.BLOB_READ_WRITE_TOKEN ?? '');
  const host = explicit || (m ? `${m[1].toLowerCase()}.public.blob.vercel-storage.com` : null);
  return host ? `https://${host}/${key}` : null;
}
