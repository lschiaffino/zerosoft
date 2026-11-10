/**
 * Inbox: importaciones largas que siguen solas y se retoman.
 *
 * - whatsapp: todo el historial que guardó el servidor de WhatsApp
 *   (Evolution): recorre todos los chats (findChats) y, de cada uno, todas las
 *   páginas de mensajes (findMessages), de la más nueva a la más vieja.
 *   Espera a que WhatsApp termine de mandar el historial al vincular. Pide de
 *   a una página por vez, con una pausa entre pedidos, y corta a tiempo.
 * - file: una exportación de inbox-zero en NDJSON subida a Blob. Lee el
 *   archivo por rangos de bytes (nunca entero) y procesa línea por línea.
 *
 * Cada paso reclama la importación con compare-and-set (claimed_until): dos
 * corridas (el cron y la pantalla abierta) nunca la procesan a la vez. Todo es
 * idempotente: reimportar no duplica mensajes. Server-only.
 */
import { getDb } from '../db';
import { ProviderError, type GroupsProvider } from '../groups-provider';
import { deleteUploads } from '../uploads';
import { listAccounts, newId, nowIso, upsertThread, type AccountRow } from './core';
import { importPart, parseImport, type ImportResult } from './import';
import { InboxError } from './types';
import { ingestWhatsappEvents, waProviderFor } from './whatsapp';
import { phoneDigits } from '../groups-provider';

export type ImportKind = 'whatsapp' | 'file';
export type ImportStatus = 'running' | 'waiting' | 'paused' | 'done' | 'failed' | 'cancelled';

/** Tope del archivo de inbox-zero subido a Blob. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;
/** Mensajes por página de findMessages. */
export const MESSAGE_PAGE = 100;
const CHAT_PAGE = 100;
/** Pausa entre pedidos al servidor de WhatsApp (no saturarlo). */
const REQUEST_GAP_MS = 250;
/** Pedidos por paso como máximo (el resto, en el próximo). */
const MAX_REQUESTS = 40;
/** Páginas por chat como máximo (100 × 1000 = 100.000 mensajes). */
const MAX_PAGES_PER_CHAT = 1000;
/** Fallos seguidos del servidor antes de dar la importación por fallida. */
const MAX_FAILURES = 8;
/** Bytes que se leen del archivo por pedido. */
const FILE_CHUNK = 2 * 1024 * 1024;
const MAX_LINE = 16 * 1024 * 1024;

export interface ImportProgress {
  chats?: number;
  chatsDone?: number;
  messages?: number;
  pages?: number;
  bytes?: number;
  total?: number;
  failures?: number;
  folders?: number;
  scheduled?: number;
  drafts?: number;
  snoozes?: number;
  notes?: number;
  archived?: number;
}

export interface ImportJobDto {
  id: string;
  kind: ImportKind;
  status: ImportStatus;
  sourceName: string;
  progress: ImportProgress;
  error: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

interface JobRow {
  id: string;
  owner_id: string;
  account_id: string | null;
  kind: ImportKind;
  status: ImportStatus;
  source_url: string;
  source_name: string;
  source_size: number;
  cursor: string;
  progress: string;
  error: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface WaCursor {
  phase: 'chats' | 'messages' | 'done';
  chatPage: number;
  queue: string[];
  jid?: string;
  page: number;
}

function parse<T>(raw: string, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function dto(r: JobRow): ImportJobDto {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    sourceName: r.source_name,
    progress: parse<ImportProgress>(r.progress, {}),
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    finishedAt: r.finished_at,
  };
}

async function getJob(owner: string, id: string): Promise<JobRow> {
  const r = (await getDb().prepare('SELECT * FROM inbox_imports WHERE id = ? AND owner_id = ?').get(id, owner)) as JobRow | undefined;
  if (!r) throw new InboxError('not_found', 404);
  return r;
}

export async function listImports(owner: string): Promise<ImportJobDto[]> {
  const rows = (await getDb().prepare('SELECT * FROM inbox_imports WHERE owner_id = ? ORDER BY created_at DESC LIMIT 10').all(owner)) as unknown as JobRow[];
  return rows.map(dto);
}

const ACTIVE = "('running','waiting','paused')";

/** Empieza (o retoma, si ya hay una) la importación de todo el historial de WhatsApp. */
export async function startWhatsappImport(owner: string, now = new Date()): Promise<ImportJobDto> {
  const account = (await listAccounts(owner)).find((a) => a.kind === 'whatsapp');
  if (!account || account.status !== 'connected') throw new InboxError('not_connected', 409);
  const db = getDb();
  const open = (await db.prepare(`SELECT * FROM inbox_imports WHERE owner_id = ? AND kind = 'whatsapp' AND status IN ${ACTIVE} ORDER BY created_at DESC LIMIT 1`).get(owner)) as JobRow | undefined;
  if (open) {
    if (open.status === 'paused') await db.prepare("UPDATE inbox_imports SET status = 'running', updated_at = ? WHERE id = ?").run(nowIso(now), open.id);
    return dto(await getJob(owner, open.id));
  }
  const id = newId('ibi');
  const nowS = nowIso(now);
  const cursor: WaCursor = { phase: 'chats', chatPage: 0, queue: [], page: 1 };
  await db
    .prepare("INSERT INTO inbox_imports (id, owner_id, account_id, kind, status, source_name, cursor, progress, created_at, updated_at) VALUES (?, ?, ?, 'whatsapp', 'running', 'WhatsApp', ?, ?, ?, ?)")
    .run(id, owner, account.id, JSON.stringify(cursor), JSON.stringify({ chats: 0, chatsDone: 0, messages: 0, pages: 0 }), nowS, nowS);
  return dto(await getJob(owner, id));
}

/** ¿La URL es una exportación subida para Inbox? (Blob, bajo inbox-import/, .json o .ndjson). */
export function isInboxImportUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /\.public\.blob\.vercel-storage\.com$/.test(u.hostname) && /^\/inbox-import\/[A-Za-z0-9._%-]{1,200}\.ndjson$/.test(u.pathname);
  } catch {
    return false;
  }
}

/** Importación de un archivo NDJSON de inbox-zero ya subido a Blob. */
export async function startFileImport(owner: string, input: { url: string; name: string; size: number }, now = new Date()): Promise<ImportJobDto> {
  if (!isInboxImportUrl(input.url)) throw new InboxError('invalid_input', 400);
  if (!(input.size > 0) || input.size > MAX_IMPORT_BYTES) throw new InboxError('too_large', 413);
  const db = getDb();
  const dup = (await db.prepare(`SELECT id FROM inbox_imports WHERE owner_id = ? AND source_url = ? AND status IN ${ACTIVE}`).get(owner, input.url)) as { id: string } | undefined;
  if (dup) return dto(await getJob(owner, dup.id));
  const id = newId('ibi');
  const nowS = nowIso(now);
  await db
    .prepare("INSERT INTO inbox_imports (id, owner_id, kind, status, source_url, source_name, source_size, cursor, progress, created_at, updated_at) VALUES (?, ?, 'file', 'running', ?, ?, ?, ?, ?, ?, ?)")
    .run(id, owner, input.url, input.name.slice(0, 200), Math.floor(input.size), JSON.stringify({ offset: 0 }), JSON.stringify({ bytes: 0, total: Math.floor(input.size), messages: 0 }), nowS, nowS);
  return dto(await getJob(owner, id));
}

/** Pausar, seguir o cancelar. Cancelar un archivo lo borra de Blob. */
export async function setImportState(owner: string, id: string, action: 'pause' | 'resume' | 'cancel', now = new Date()): Promise<ImportJobDto> {
  const job = await getJob(owner, id);
  const db = getDb();
  const nowS = nowIso(now);
  if (action === 'pause') await db.prepare("UPDATE inbox_imports SET status = 'paused', updated_at = ? WHERE id = ? AND status IN ('running','waiting')").run(nowS, id);
  else if (action === 'resume')
    await db
      .prepare("UPDATE inbox_imports SET status = 'running', error = '', progress = json_set(progress, '$.failures', 0), updated_at = ? WHERE id = ? AND status IN ('paused','failed')")
      .run(nowS, id);
  else {
    const r = await db.prepare(`UPDATE inbox_imports SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ? AND status IN ${ACTIVE.replace(')', ",'failed')")}`).run(nowS, nowS, id);
    if (r.changes && job.kind === 'file' && job.source_url) await deleteUploads([job.source_url]);
  }
  return dto(await getJob(owner, id));
}

/** Reclama la importación para un paso (compare-and-set). */
async function claim(id: string, now: Date): Promise<JobRow | null> {
  const nowS = nowIso(now);
  const r = await getDb()
    .prepare("UPDATE inbox_imports SET claimed_until = ? WHERE id = ? AND status IN ('running','waiting') AND (claimed_until IS NULL OR claimed_until < ?)")
    .run(new Date(now.getTime() + 2 * 60_000).toISOString(), id, nowS);
  if (r.changes === 0) return null;
  return ((await getDb().prepare('SELECT * FROM inbox_imports WHERE id = ?').get(id)) as JobRow | undefined) ?? null;
}

async function save(job: JobRow, patch: { status?: ImportStatus; cursor?: unknown; progress?: ImportProgress; error?: string }, now: Date) {
  const done = patch.status === 'done' || patch.status === 'failed';
  await getDb()
    .prepare(
      // No pisa una pausa o cancelación que llegó mientras corría el paso.
      `UPDATE inbox_imports SET status = CASE WHEN status IN ('paused','cancelled') THEN status ELSE ? END, cursor = ?, progress = ?, error = ?, claimed_until = NULL, updated_at = ?,
         finished_at = CASE WHEN ? = 1 AND status NOT IN ('paused','cancelled') THEN ? ELSE finished_at END WHERE id = ?`,
    )
    .run(
      patch.status ?? job.status,
      patch.cursor === undefined ? job.cursor : JSON.stringify(patch.cursor),
      JSON.stringify(patch.progress ?? parse<ImportProgress>(job.progress, {})),
      patch.error ?? '',
      nowIso(now),
      done ? 1 : 0,
      nowIso(now),
      job.id,
    );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ¿WhatsApp sigue mandando el historial de la vinculación? (la importación espera). */
function historyStillArriving(account: AccountRow, now: Date): boolean {
  const c = parse<{ phase?: string; after?: number }>(account.sync_cursor, {});
  return !!c.phase && c.phase !== 'done' && !!c.after && c.after > now.getTime();
}

async function stepWhatsapp(job: JobRow, deadline: number, now: Date): Promise<void> {
  const account = (await listAccounts(job.owner_id)).find((a) => a.id === job.account_id);
  if (!account || account.status !== 'connected') {
    await save(job, { status: 'waiting', error: 'not_connected' }, now);
    return;
  }
  if (historyStillArriving(account, now)) {
    await save(job, { status: 'waiting', error: 'history_syncing' }, now);
    return;
  }
  let provider: GroupsProvider;
  try {
    provider = waProviderFor(account);
  } catch {
    await save(job, { status: 'waiting', error: 'not_connected' }, now);
    return;
  }
  const history = provider.history;
  if (!history) {
    await save(job, { status: 'failed', error: 'history_unavailable' }, now);
    return;
  }
  const cursor = parse<WaCursor>(job.cursor, { phase: 'chats', chatPage: 0, queue: [], page: 1 });
  const progress = parse<ImportProgress>(job.progress, {});
  let requests = 0;
  let error = '';
  try {
    while (cursor.phase !== 'done' && requests < MAX_REQUESTS && Date.now() + 3_000 < deadline) {
      if (requests > 0) await sleep(REQUEST_GAP_MS);
      requests++;
      if (cursor.phase === 'chats') {
        const rows = await history.chats(cursor.chatPage, CHAT_PAGE);
        const seen = new Set(cursor.queue);
        for (const c of rows) {
          await upsertThread(account, { externalId: c.chatId, kind: c.isGroup ? 'group' : 'dm', title: c.name || undefined, handle: c.isGroup ? '' : phoneDigits(c.chatId) });
          if (!seen.has(c.remoteJid)) {
            cursor.queue.push(c.remoteJid);
            seen.add(c.remoteJid);
          }
        }
        progress.chats = cursor.queue.length + (progress.chatsDone ?? 0);
        if (rows.length < CHAT_PAGE) cursor.phase = 'messages';
        else cursor.chatPage++;
        continue;
      }
      const jid = cursor.jid ?? cursor.queue.shift();
      if (!jid) {
        cursor.phase = 'done';
        break;
      }
      cursor.jid = jid;
      let more = false;
      if (history.messagePage) {
        const r = await history.messagePage(jid, MESSAGE_PAGE, cursor.page);
        progress.messages = (progress.messages ?? 0) + (await ingestWhatsappEvents(account, r.events, { history: true })).messages;
        more = r.more && cursor.page < MAX_PAGES_PER_CHAT;
      } else {
        const events = await history.messages(jid, 500);
        progress.messages = (progress.messages ?? 0) + (await ingestWhatsappEvents(account, events, { history: true })).messages;
      }
      progress.pages = (progress.pages ?? 0) + 1;
      if (more) cursor.page++;
      else {
        cursor.jid = undefined;
        cursor.page = 1;
        progress.chatsDone = (progress.chatsDone ?? 0) + 1;
      }
    }
    progress.failures = 0;
  } catch (err) {
    // El servidor falló (caído, límite): se sigue en el próximo paso desde el mismo punto.
    progress.failures = (progress.failures ?? 0) + 1;
    error = err instanceof ProviderError && err.code === 'not_connected' ? 'not_connected' : 'whatsapp_unreachable';
  }
  const failed = (progress.failures ?? 0) >= MAX_FAILURES;
  await save(job, { status: cursor.phase === 'done' ? 'done' : failed ? 'failed' : 'running', cursor, progress, error }, now);
}

/** Lee `size` bytes desde `offset` (Range; si el servidor lo ignora, salta lo leído). */
async function readRange(url: string, offset: number, size: number): Promise<Buffer> {
  const res = await fetch(url, { headers: { range: `bytes=${offset}-${offset + size - 1}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok || !res.body) throw new InboxError('media_unavailable', 410);
  const skip = res.status === 206 ? 0 : offset;
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let skipped = 0;
  let got = 0;
  while (got < size) {
    const { done, value } = await reader.read();
    if (done) break;
    let buf = Buffer.from(value);
    if (skipped < skip) {
      const drop = Math.min(buf.length, skip - skipped);
      skipped += drop;
      buf = buf.subarray(drop);
    }
    if (buf.length) {
      chunks.push(buf);
      got += buf.length;
    }
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).subarray(0, size);
}

function addCounts(p: ImportProgress, r: ImportResult) {
  for (const k of ['folders', 'scheduled', 'drafts', 'snoozes', 'notes', 'archived', 'messages'] as const) p[k] = (p[k] ?? 0) + r[k];
  p.chats = (p.chats ?? 0) + r.chats;
}

async function stepFile(job: JobRow, deadline: number, now: Date): Promise<void> {
  const cursor = parse<{ offset: number }>(job.cursor, { offset: 0 });
  const progress = parse<ImportProgress>(job.progress, {});
  const size = Number(job.source_size);
  let chunk = FILE_CHUNK;
  try {
    while (cursor.offset < size && Date.now() + 5_000 < deadline) {
      const buf = await readRange(job.source_url, cursor.offset, Math.min(chunk, size - cursor.offset));
      if (!buf.length) break;
      const atEnd = cursor.offset + buf.length >= size;
      const cut = atEnd ? buf.length : buf.lastIndexOf(0x0a) + 1;
      if (cut <= 0) {
        // Una línea más larga que el pedazo: se pide más grande, hasta el tope.
        if (chunk >= MAX_LINE) throw new InboxError('invalid_file', 400);
        chunk = Math.min(MAX_LINE, chunk * 4);
        continue;
      }
      const lines = buf.subarray(0, cut).toString('utf8').split('\n');
      for (const line of lines) {
        const raw = line.trim();
        if (!raw) continue;
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          throw new InboxError('invalid_file', 400);
        }
        addCounts(progress, await importPart(job.owner_id, parseImport(json), now));
      }
      cursor.offset += cut;
      progress.bytes = cursor.offset;
      progress.total = size;
    }
  } catch (err) {
    const code = err instanceof InboxError ? err.code : 'import_failed';
    const fatal = code === 'invalid_file';
    progress.failures = (progress.failures ?? 0) + 1;
    await save(job, { status: fatal || (progress.failures ?? 0) >= MAX_FAILURES ? 'failed' : 'running', cursor, progress, error: code }, now);
    return;
  }
  const done = cursor.offset >= size;
  progress.failures = 0;
  await save(job, { status: done ? 'done' : 'running', cursor, progress }, now);
  if (done) await deleteUploads([job.source_url]);
}

/** Un paso de una importación (si nadie la tiene tomada). Devuelve cómo quedó. */
export async function runImportStep(id: string, deadline: number, now = new Date()): Promise<boolean> {
  const job = await claim(id, now);
  if (!job) return false;
  try {
    if (job.kind === 'whatsapp') await stepWhatsapp(job, deadline, now);
    else await stepFile(job, deadline, now);
  } catch {
    await save(job, { error: 'import_failed' }, now);
  }
  return true;
}

/** Paso pedido desde la pantalla (solo de una importación propia). */
export async function stepOwnImport(owner: string, id: string, budgetMs = 20_000): Promise<ImportJobDto> {
  await getJob(owner, id);
  await runImportStep(id, Date.now() + budgetMs);
  return dto(await getJob(owner, id));
}

/** Cron: las importaciones que siguen (cada una reclamada por fila). */
export async function runInboxImports(now = new Date(), deadline = Date.now() + 25_000): Promise<number> {
  const rows = (await getDb()
    .prepare("SELECT id FROM inbox_imports WHERE status IN ('running','waiting') AND (claimed_until IS NULL OR claimed_until < ?) ORDER BY updated_at LIMIT 5")
    .all(nowIso(now))) as Array<{ id: string }>;
  let n = 0;
  for (const r of rows) {
    if (Date.now() + 5_000 > deadline) break;
    if (await runImportStep(r.id, deadline, now)) n++;
  }
  return n;
}
