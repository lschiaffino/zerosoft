/**
 * Migración de los archivos de antes (URLs públicas del Blob de la suite y
 * /uploads/… del disco local) al storage privado de lib/files/store.ts.
 * Server-only. La corren scripts/migrate-private-files.ts (de una vez,
 * migratePrivateFiles) y el runner de mantenimiento del cron de cada minuto
 * (lib/maintenance-jobs.ts, de a tandas con migrateStep y un cursor guardado).
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
const SKIP_TABLES = new Set(['stored_files', '_migrations', 'schema_migrations', 'sqlite_sequence', 'maintenance_jobs', 'maintenance_job_seen']);

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

/**
 * Lo ya visto en una corrida: las URLs contadas ('found') y, antes de borrar, las claves que la base todavía usa
 * ('used'). En memoria para el script; en la base (con hash) para el runner de mantenimiento (lib/maintenance-jobs.ts).
 */
export interface SeenKeys {
  /** true si la clave es nueva en ese espacio. */
  add(ns: string, key: string): Promise<boolean>;
  has(ns: string, key: string): Promise<boolean>;
}

export function memorySeenKeys(): SeenKeys {
  const sets = new Map<string, Set<string>>();
  const of = (ns: string) => {
    let s = sets.get(ns);
    if (!s) sets.set(ns, (s = new Set()));
    return s;
  };
  return {
    add: async (ns, key) => {
      const s = of(ns);
      if (s.has(key)) return false;
      s.add(key);
      return true;
    },
    has: async (ns, key) => of(ns).has(key),
  };
}

/** Dónde va un recorrido de la base: tabla, columna y último rowid hecho. */
export interface ScanCursor {
  table: string | null;
  column: string | null;
  after: number;
}

/**
 * Progreso de una corrida que se hace de a tandas (y se retoma). Solo tiene nombres de tablas y columnas, rowids,
 * ids de stored_files y cuentas: nada de URLs, nombres de archivo ni contenido.
 */
export interface MigrateProgress {
  phase: 'scan' | 'used' | 'delete' | 'done';
  /** Recorrido que cuenta (y, con apply, migra). */
  scan: ScanCursor;
  /** Recorrido que junta las claves viejas que la base todavía usa, antes de borrar. */
  used: ScanCursor;
  /** Último id de stored_files revisado para borrar. */
  fileAfter: string;
  /** Filas leídas con alguna URL vieja candidata. */
  scannedRows: number;
  byFolder: Record<string, FolderCount>;
  total: FolderCount;
  unmapped: Array<{ table: string; column: string; cells: number }>;
  skippedFolders: Record<string, number>;
  registered: number;
  copied: number;
  rewrittenCells: number;
  deleted: number;
  failed: number;
  failedByReason: Record<string, number>;
}

export function newMigrateProgress(): MigrateProgress {
  return {
    phase: 'scan',
    scan: { table: null, column: null, after: -1 },
    used: { table: null, column: null, after: -1 },
    fileAfter: '',
    scannedRows: 0,
    byFolder: {},
    total: { files: 0, bytes: 0 },
    unmapped: [],
    skippedFolders: {},
    registered: 0,
    copied: 0,
    rewrittenCells: 0,
    deleted: 0,
    failed: 0,
    failedByReason: {},
  };
}

export interface StepContext {
  seen: SeenKeys;
  /** Hasta cuándo (ms) se empieza trabajo nuevo. Sin esto, el paso corre hasta el final. Siempre avanza al menos una fila. */
  deadline?: number;
  /** Cada falla, con su clave (el script la junta; el runner solo cuenta los motivos). */
  onFail?: (key: string, reason: string) => void;
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

interface TableInfo {
  name: string;
  cols: string[];
  textCols: string[];
}

async function tableNames(db: Client): Promise<string[]> {
  const rs = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'");
  return rs.rows
    .map((r) => String(r.name))
    .filter((n) => !SKIP_TABLES.has(n))
    .sort();
}

async function tableInfo(db: Client, name: string): Promise<TableInfo | null> {
  const info = await db.execute(`PRAGMA table_info(${q(name)})`);
  const cols = info.rows.map((c) => String(c.name));
  const textCols = info.rows.filter((c) => /TEXT|CHAR|CLOB|^$/i.test(String(c.type ?? ''))).map((c) => String(c.name));
  if (!textCols.length) return null;
  // Sin rowid (WITHOUT ROWID) no se puede reescribir por celda.
  const hasRowid = await db.execute(`SELECT rowid FROM ${q(name)} LIMIT 0`).then(() => true, () => false);
  return hasRowid ? { name, cols, textCols } : null;
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

function ownerSql(t: TableInfo): { ws: string; user: string | null } | null {
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

interface ScanRow {
  rid: number;
  v: string;
  ws: string;
  person: string | null;
  scope: string | null;
}

const past = (deadline: number | undefined) => deadline !== undefined && Date.now() >= deadline;

/**
 * Recorre las celdas de texto que pueden tener URLs viejas, desde el cursor (tablas por nombre, columnas en orden,
 * filas por rowid). Devuelve true al terminar, o false si se pasó el deadline: el cursor queda después de lo último
 * hecho, así la próxima llamada sigue de ahí. Siempre hace algo antes de mirar el deadline.
 */
async function scanCells(
  db: Client,
  cur: ScanCursor,
  o: { tables?: string[]; batch: number; deadline?: number; owners: boolean },
  each: {
    batch?: (t: TableInfo, rows: ScanRow[], owned: boolean) => Promise<void>;
    row: (t: TableInfo, col: string, r: ScanRow, owned: boolean) => Promise<void>;
  },
): Promise<boolean> {
  const names = (await tableNames(db)).filter((n) => !o.tables?.length || o.tables.includes(n));
  let i = cur.table === null ? 0 : names.findIndex((n) => n >= cur.table!);
  if (i < 0) return true;
  for (; i < names.length; i++) {
    const name = names[i];
    if (cur.table !== name) Object.assign(cur, { table: name, column: null, after: -1 });
    const t = await tableInfo(db, name);
    if (t) {
      const owner = o.owners ? ownerSql(t) : null;
      const rule = RULES[t.name];
      let c = cur.column ? t.textCols.indexOf(cur.column) : 0;
      if (c < 0) c = 0;
      for (; c < t.textCols.length; c++) {
        const col = t.textCols[c];
        if (cur.column !== col) Object.assign(cur, { column: col, after: -1 });
        for (;;) {
          const sel = owner
            ? `SELECT t.rowid AS rid, t.${q(col)} AS v, ${owner.ws} AS ws, ${owner.user ?? 'NULL'} AS person${rule?.scope ? `, ${rule.scope} AS scope` : ''}`
            : `SELECT t.rowid AS rid, t.${q(col)} AS v`;
          const rs = await db.execute({
            sql: `${sel} FROM ${q(t.name)} t WHERE t.rowid > ? AND (t.${q(col)} LIKE '%.public.blob.vercel-storage.com/%' OR t.${q(col)} LIKE '%/uploads/%') ORDER BY t.rowid LIMIT ?`,
            args: [cur.after, o.batch],
          });
          if (!rs.rows.length) break;
          const rows: ScanRow[] = rs.rows.map((r) => ({
            rid: Number(r.rid),
            v: String(r.v ?? ''),
            ws: owner && r.ws != null ? String(r.ws) : '',
            person: r.person == null ? null : String(r.person),
            scope: r.scope == null ? null : String(r.scope),
          }));
          await each.batch?.(t, rows, owner !== null);
          for (const r of rows) {
            await each.row(t, col, r, owner !== null);
            cur.after = r.rid;
            if (past(o.deadline)) return false;
          }
          if (rows.length < o.batch) break;
        }
        if (c + 1 < t.textCols.length) {
          Object.assign(cur, { column: t.textCols[c + 1], after: -1 });
          if (past(o.deadline)) return false;
        }
      }
    }
    if (i + 1 >= names.length) break;
    Object.assign(cur, { table: names[i + 1], column: null, after: -1 });
    if (past(o.deadline)) return false;
  }
  return true;
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

interface Cell {
  table: string;
  column: string;
  rowid: number;
}

/** Reescribe una celda (compare-and-set, hasta 3 intentos). */
async function rewriteCell(db: Client, c: Cell, oldUrl: string, newUrl: string): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rs = await db.execute({ sql: `SELECT ${q(c.column)} AS v FROM ${q(c.table)} WHERE rowid = ?`, args: [c.rowid] });
    const v = rs.rows[0]?.v;
    if (typeof v !== 'string' || !v.includes(oldUrl)) return 0;
    const next = v.split(oldUrl).join(newUrl);
    const up = await db.execute({ sql: `UPDATE ${q(c.table)} SET ${q(c.column)} = ? WHERE rowid = ? AND ${q(c.column)} = ?`, args: [next, c.rowid, v] as InValue[] });
    if (up.rowsAffected > 0) return 1;
  }
  return 0;
}

function fail(p: MigrateProgress, ctx: StepContext, key: string, reason: string): void {
  p.failed++;
  p.failedByReason[reason] = (p.failedByReason[reason] ?? 0) + 1;
  ctx.onFail?.(key, reason);
}

interface Target {
  url: string;
  key: string;
  folder: Folder;
  ws: string;
  user: string | null;
  app: string | null;
  access: FileAccess;
  scope: string | null;
}

/** La URL de una fila, si se migra acá y se sabe de quién es (si no, con `count` la anota como salteada o sin dueño). */
function targetOf(p: MigrateProgress, wanted: Set<string>, t: TableInfo, col: string, r: ScanRow, owned: boolean, url: string, count: boolean): Target | null {
  const folder = folderOf(url);
  if (!folder) return null;
  if (!(MIGRATABLE_FOLDERS as readonly string[]).includes(folder) || !wanted.has(folder)) {
    if (count) p.skippedFolders[folder] = (p.skippedFolders[folder] ?? 0) + 1;
    return null;
  }
  const ws = owned ? r.ws : '';
  if (!ws) {
    if (count) {
      const u = p.unmapped.find((x) => x.table === t.name && x.column === col);
      if (u) u.cells++;
      else p.unmapped.push({ table: t.name, column: col, cells: 1 });
    }
    return null;
  }
  const f = folder as Folder;
  const rule = RULES[t.name];
  const access = rule?.access ?? DEFAULT_ACCESS[f];
  return {
    url,
    key: legacyKeyFor(url)!,
    folder: f,
    ws,
    user: access === 'user' ? r.person ?? ws : r.person,
    app: rule?.app ?? null,
    access,
    scope: rule?.scope ? r.scope : null,
  };
}

/** Registra, copia, verifica y pasa a la copia un archivo viejo, y reescribe la celda que lo usa. */
async function migrateCell(
  db: Client,
  opts: MigrateOptions,
  p: MigrateProgress,
  ctx: StepContext,
  e: Target,
  cell: Cell,
  size: number | undefined,
  run: { copied: number },
): Promise<void> {
  const sizeOf = opts.sizeOf ?? defaultSize;
  const readOriginal = opts.readOriginal ?? defaultRead;
  try {
    let row = await fileRowForLegacyKey(e.key);
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
        size: size ?? (await sizeOf(e.url).catch(() => null)) ?? 0,
      });
      if (!row) throw new Error('register_failed');
      p.registered++;
    }
    if (row.ref.startsWith('legacy:')) {
      if (opts.limit !== undefined && run.copied >= opts.limit) return;
      const src = await readOriginal(e.url);
      if (!src) throw new Error('original_unreadable');
      const h = createHash('sha256');
      let n = 0;
      const counted = (async function* () {
        for await (const piece of hashing(src, h)) {
          n += piece.byteLength;
          yield piece;
        }
      })();
      const stored = await storeBytes(newFileId(), counted, { folder: e.folder, mime: row.mime });
      const sha = h.digest('hex');
      // Verificación: la copia se relee entera y tiene que dar lo mismo.
      const probe: StoredFileRow = { ...row, ref: stored.ref, header: stored.header, size: stored.size };
      const back = await copyHash(probe);
      if (!back || back.sha !== sha || back.size !== n || stored.size !== n) {
        await discardBytes(stored.ref);
        throw new Error('verify_failed');
      }
      if (!(await swapFileRef(row.id, row.ref, stored))) {
        // Otra corrida la copió primero.
        await discardBytes(stored.ref);
      } else {
        p.copied++;
        run.copied++;
      }
      row = (await fileRowForLegacyKey(e.key))!;
    }
    p.rewrittenCells += await rewriteCell(db, cell, e.url, fileUrl(row));
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'error';
    fail(p, ctx, e.key, reason);
    opts.log?.(`falló ${e.folder}: ${reason}`);
  }
}

/**
 * Un paso de la migración (o del conteo, sin `apply`): sigue desde donde quedó `p` hasta terminar o hasta
 * `ctx.deadline`, y deja en `p` el cursor y las cuentas. Idempotente: lo registrado se reconoce por legacy_key, lo
 * copiado por su ref, y cada reescritura es compare-and-set. Sin `apply` no escribe nada (solo en `ctx.seen`).
 */
export async function migrateStep(db: Client, opts: MigrateOptions, p: MigrateProgress, ctx: StepContext): Promise<MigrateProgress> {
  const batch = Math.max(50, Math.min(5000, opts.batch ?? 500));
  const sizeOf = opts.sizeOf ?? defaultSize;
  const wanted = new Set<string>(opts.folders?.length ? opts.folders : MIGRATABLE_FOLDERS);
  const run = { copied: 0 };
  if (p.phase === 'scan') {
    const sizes = new Map<string, number>();
    const done = await scanCells(db, p.scan, { tables: opts.tables, batch, deadline: ctx.deadline, owners: true }, {
      // Tamaños (HEAD / stat) de las URLs nuevas de la tanda, de a 8 en paralelo.
      batch: async (t, rows, owned) => {
        sizes.clear();
        const fresh: string[] = [];
        for (const r of rows) {
          for (const url of legacyUrlsIn(r.v)) {
            if (fresh.includes(url) || !targetOf(p, wanted, t, '', r, owned, url, false)) continue;
            if (!(await ctx.seen.has('found', url))) fresh.push(url);
          }
        }
        for (let i = 0; i < fresh.length; i += 8) {
          if (i > 0 && past(ctx.deadline)) break;
          await Promise.all(fresh.slice(i, i + 8).map(async (u) => sizes.set(u, (await sizeOf(u).catch(() => null)) ?? 0)));
        }
      },
      row: async (t, col, r, owned) => {
        p.scannedRows++;
        for (const url of legacyUrlsIn(r.v)) {
          const e = targetOf(p, wanted, t, col, r, owned, url, true);
          if (!e) continue;
          let size = sizes.get(url);
          if (await ctx.seen.add('found', url)) {
            if (size === undefined) size = (await sizeOf(url).catch(() => null)) ?? 0;
            const c = (p.byFolder[e.folder] ??= { files: 0, bytes: 0 });
            c.files++;
            c.bytes += size;
            p.total.files++;
            p.total.bytes += size;
          }
          if (opts.apply) await migrateCell(db, opts, p, ctx, e, { table: t.name, column: col, rowid: r.rid }, size, run);
        }
      },
    });
    if (!done) return p;
    opts.log?.(`URLs viejas encontradas: ${p.total.files}`);
    p.phase = opts.apply && opts.deleteOriginals ? 'used' : 'done';
    if (p.phase === 'done' || past(ctx.deadline)) return p;
  }
  if (p.phase === 'used') {
    // Toda URL vieja que siga en la base, en cualquier tabla (aunque esta corrida migre solo algunas) y también en
    // tablas sin dueño conocido. Se compara por clave (el pathname), no por la URL entera.
    const done = await scanCells(db, p.used, { batch, deadline: ctx.deadline, owners: false }, {
      row: async (_t, _col, r) => {
        for (const u of legacyUrlsIn(r.v)) {
          const k = legacyKeyFor(u);
          if (k) await ctx.seen.add('used', k);
        }
      },
    });
    if (!done) return p;
    p.phase = 'delete';
    if (past(ctx.deadline)) return p;
  }
  if (p.phase === 'delete') {
    if (!(await deleteSlice(db, opts, p, ctx))) return p;
    p.phase = 'done';
  }
  return p;
}

/**
 * Borra los originales públicos ya migrados: la fila apunta a la copia, en la base no queda ninguna referencia a la
 * URL vieja, y la copia y el original vuelven a dar el mismo sha256. De a tandas por id de stored_files.
 */
async function deleteSlice(db: Client, opts: MigrateOptions, p: MigrateProgress, ctx: StepContext): Promise<boolean> {
  for (;;) {
    const rs = await db.execute({
      sql: "SELECT * FROM stored_files WHERE legacy_key IS NOT NULL AND ref NOT LIKE 'legacy:%' AND id > ? ORDER BY id LIMIT 200",
      args: [p.fileAfter],
    });
    if (!rs.rows.length) return true;
    for (const r of rs.rows) {
      const row = r as unknown as StoredFileRow;
      await deleteOne(db, opts, p, ctx, row);
      p.fileAfter = String(row.id);
      if (past(ctx.deadline)) return false;
    }
    if (rs.rows.length < 200) return true;
  }
}

async function deleteOne(db: Client, opts: MigrateOptions, p: MigrateProgress, ctx: StepContext, row: StoredFileRow): Promise<void> {
  const readOriginal = opts.readOriginal ?? defaultRead;
  const deleteOriginal = opts.deleteOriginal ?? defaultDelete;
  const key = String(row.legacy_key);
  if (await ctx.seen.has('used', key)) return;
  const original = key.startsWith('uploads/') ? `/${key}` : originalUrlFor(key);
  if (!original) return;
  if (opts.folders?.length && !opts.folders.includes(String(row.folder))) return;
  try {
    if (row.ref === GONE_REF) {
      // La copia ya se borró con lo que la usaba: el original se va también, y después la marca.
      await deleteOriginal(original);
      await db.execute({ sql: 'DELETE FROM stored_files WHERE id = ? AND ref = ?', args: [row.id, GONE_REF] });
      p.deleted++;
      return;
    }
    const src = await readOriginal(original);
    if (!src) return; // Ya no está.
    const a = await hashOf(src);
    const b = await copyHash(row);
    if (!b || a.sha !== b.sha || a.size !== b.size) {
      fail(p, ctx, key, 'verify_before_delete_failed');
      return;
    }
    await deleteOriginal(original);
    p.deleted++;
  } catch (err) {
    fail(p, ctx, key, err instanceof Error ? err.message : 'delete_failed');
  }
}

/** Corre la migración entera de una vez (o la cuenta, sin `apply`). La usa scripts/migrate-private-files.ts. */
export async function migratePrivateFiles(db: Client, opts: MigrateOptions = {}): Promise<MigrateReport> {
  const p = newMigrateProgress();
  const failed: MigrateReport['failed'] = [];
  const ctx: StepContext = { seen: memorySeenKeys(), onFail: (key, reason) => failed.push({ key, reason }) };
  while (p.phase !== 'done') await migrateStep(db, opts, p, ctx);
  const { byFolder, total, unmapped, skippedFolders, registered, copied, rewrittenCells, deleted } = p;
  return { byFolder, total, unmapped, skippedFolders, registered, copied, rewrittenCells, deleted, failed };
}

/** La URL completa del original: el host del store sale de BLOB_READ_WRITE_TOKEN o de SHOP_BLOB_HOST. */
function originalUrlFor(key: string): string | null {
  const explicit = process.env.FILES_LEGACY_BLOB_HOST?.trim().toLowerCase() || process.env.SHOP_BLOB_HOST?.trim().toLowerCase();
  const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(process.env.BLOB_READ_WRITE_TOKEN ?? '');
  const host = explicit || (m ? `${m[1].toLowerCase()}.public.blob.vercel-storage.com` : null);
  return host ? `https://${host}/${key}` : null;
}
