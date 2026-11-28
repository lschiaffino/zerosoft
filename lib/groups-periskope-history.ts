/**
 * Lines: traer el HISTORIAL de mensajes de Periskope con su API pública
 * (GET /chats/{chat_id}/messages, paginado con offset, del más nuevo al más
 * viejo, hasta el primer mensaje de cada chat). Server-only.
 *
 * Qué trae, por chat de Periskope que ya está (o se puede crear) en Lines:
 * - mensajes de texto y de archivo, con quién los mandó (teléfono; en grupos,
 *   el participante), la fecha original, reenviados, editados y borrados;
 * - respuestas citadas (se enlazan al terminar el chat, porque la API devuelve
 *   primero lo más nuevo);
 * - archivos: se bajan y se guardan en nuestro storage privado
 *   (access 'internal': se ven solo por /api/groups/media/<mensaje>, con el
 *   acceso al chat). Nunca se guarda ni se muestra una URL de Periskope;
 * - reacciones (GET /reactions?chat_id=) y notas privadas del chat.
 *
 * Idempotente y sin duplicar lo que ya llegó por WhatsApp: el id del mensaje
 * de WhatsApp (`unique_id`, o el último tramo de `message_id`) es el
 * provider_message_id, con índice único por línea. Un mensaje que ya está se
 * cuenta como repetido y no se vuelve a bajar su archivo.
 *
 * Retomable: una fila por workspace (groups_periskope_history) y una por chat
 * con su offset. El cron de cada minuto la retoma (también la pantalla, que
 * empuja tandas mientras está abierta). La clave de la API queda cifrada
 * (lib/secret-box.ts) solo mientras corre: al terminar o cancelar se borra.
 * Todo va por el workspace de quien lo pide. Lo importado no dispara avisos,
 * no cambia no leídos, ni espera de respuesta, ni reglas, ni SLA.
 *
 * Límites de la API de Periskope: pedimos de a pocos (secuencial, con tope por
 * tanda) muy por debajo de sus 100 pedidos por segundo; un 429 espera un
 * minuto sin gastar intentos.
 */
import { getDb } from './db';
import { GroupsError, applyReaction, insertMessage, listPeople, previewOf, upsertChat, type MessageRow } from './groups';
import { phoneDigits } from './groups-provider';
import { periskopeFetcher, type PeriskopeFetch } from './groups-periskope-api';
import { recordAudit } from './groups-audit';
import { seal, open } from './secret-box';

export const HISTORY_PAGE = 200;
const CHATS_PAGE = 500;
const CLAIM_MS = 3 * 60_000;
const MAX_ATTEMPTS = 8;
const MEDIA_CONCURRENCY = 6;
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

export type HistoryStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface HistoryRow {
  ws: string;
  status: HistoryStatus;
  phase: 'chats' | 'messages' | 'done';
  key_sealed: string;
  include_media: number;
  end_time: string;
  chat_cursor: number;
  chats_total: number;
  chats_done: number;
  chats_skipped: number;
  messages: number;
  duplicates: number;
  media_saved: number;
  media_failed: number;
  reactions: number;
  notes: number;
  error: string;
  attempts: number;
  claimed_until: string | null;
  started_at: string;
  finished_at: string | null;
  updated_at: string;
}

/** Lo que la pantalla muestra (nunca la clave). */
export interface HistoryStatusDto {
  status: HistoryStatus;
  phase: HistoryRow['phase'];
  includeMedia: boolean;
  chatsTotal: number;
  chatsDone: number;
  chatsSkipped: number;
  messages: number;
  duplicates: number;
  mediaSaved: number;
  mediaFailed: number;
  reactions: number;
  notes: number;
  error: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface PskMessage {
  message_id: string;
  unique_id?: string | null;
  chat_id?: string | null;
  org_phone?: string | null;
  body?: string | null;
  message_type?: string | null;
  from_me?: boolean | null;
  sender_phone?: string | null;
  author?: string | null;
  ack?: string | number | null;
  timestamp?: string | null;
  media?: { path?: string | null; mimetype?: string | null; filename?: string | null; size?: number | null } | null;
  quoted_message_id?: string | null;
  performed_by?: string | null;
  is_deleted?: boolean | null;
  is_forwarded?: boolean | null;
  prev_body?: string | null;
  updated_at?: string | null;
  poll_info?: { pollName?: string; pollOptions?: unknown[]; options?: unknown[] } | null;
  location?: unknown;
}

/** Baja un archivo de Periskope: bytes y tipo. Se inyecta en los tests. */
export type PeriskopeMediaFetch = (url: string, max: number) => Promise<{ data: Buffer; mimetype: string; filename?: string } | null>;

export interface HistoryClients {
  get: PeriskopeFetch;
  media: PeriskopeMediaFetch;
}

const nowIso = () => new Date().toISOString();

export function toHistoryDto(r: HistoryRow): HistoryStatusDto {
  return {
    status: r.status,
    phase: r.phase,
    includeMedia: r.include_media === 1,
    chatsTotal: r.chats_total,
    chatsDone: r.chats_done,
    chatsSkipped: r.chats_skipped,
    messages: r.messages,
    duplicates: r.duplicates,
    mediaSaved: r.media_saved,
    mediaFailed: r.media_failed,
    reactions: r.reactions,
    notes: r.notes,
    error: r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export async function getHistoryStatus(ws: string): Promise<HistoryStatusDto | null> {
  const r = (await getDb().prepare('SELECT * FROM groups_periskope_history WHERE ws = ?').get(ws)) as HistoryRow | undefined;
  return r ? toHistoryDto(r) : null;
}

// ---------- Cliente real de archivos ----------

const MEDIA_HOST = /(^|\.)periskope\.app$|^storage\.googleapis\.com$|\.storage\.googleapis\.com$/i;

/**
 * Baja un archivo de Periskope. Solo https a hosts de Periskope o de su storage
 * (sigue como mucho 3 redirecciones, validando cada una); la clave viaja solo
 * a periskope.app. Si el archivo pide un token (Media Privacy) y la clave no
 * alcanza, devuelve null y el mensaje queda sin archivo (con tipo y nombre).
 */
export function periskopeMediaFetcher(key: string, fetchImpl: typeof fetch = fetch): PeriskopeMediaFetch {
  return async (rawUrl, max) => {
    let url = rawUrl;
    for (let hop = 0; hop < 4; hop++) {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        return null;
      }
      if (u.protocol !== 'https:' || !MEDIA_HOST.test(u.hostname)) return null;
      const res = await fetchImpl(u.toString(), {
        headers: /(^|\.)periskope\.app$/i.test(u.hostname) ? { authorization: `Bearer ${key}` } : {},
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      }).catch(() => null);
      if (!res) return null;
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!next) return null;
        url = new URL(next, u).toString();
        continue;
      }
      if (res.status === 429) {
        await res.body?.cancel().catch(() => undefined);
        throw new GroupsError('periskope_rate_limited', 429);
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      if (Number(res.headers.get('content-length') ?? 0) > max) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length === 0 || data.length > max) return null;
      return { data, mimetype: (res.headers.get('content-type') ?? '').split(';')[0].trim() };
    }
    return null;
  };
}

/** Los clientes de una clave: el real, o el simulado con GROUPS_PERISKOPE_FAKE=1. */
export async function historyClients(ws: string, key: string): Promise<HistoryClients> {
  if (process.env.GROUPS_PERISKOPE_FAKE === '1') {
    const fake = await import('./groups-periskope-fake');
    return { get: fake.fakePeriskope(ws, key), media: fake.fakePeriskopeMedia(key) };
  }
  return { get: periskopeFetcher(key), media: periskopeMediaFetcher(key) };
}

// ---------- Estado ----------

async function save(ws: string, startedAt: string, patch: Partial<Omit<HistoryRow, 'ws' | 'started_at' | 'updated_at'>>): Promise<boolean> {
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  const r = await getDb()
    .prepare(`UPDATE groups_periskope_history SET ${keys.map((k) => `${k} = ?`).join(', ')}${keys.length ? ', ' : ''}updated_at = ? WHERE ws = ? AND started_at = ?`)
    .run(...keys.map((k) => patch[k] as string | number | null), nowIso(), ws, startedAt);
  return r.changes > 0;
}

/**
 * Pone el historial en cola. Con una corrida en curso devuelve su estado sin
 * tocarla. `key` ya validada por quien llama. Vuelve a empezar de cero si la
 * anterior terminó, falló o se canceló (lo que ya está no se duplica).
 */
export async function queueHistory(ws: string, key: string, opts: { includeMedia?: boolean } = {}): Promise<HistoryStatusDto> {
  const db = getDb();
  const existing = (await db.prepare('SELECT * FROM groups_periskope_history WHERE ws = ?').get(ws)) as HistoryRow | undefined;
  if (existing && (existing.status === 'queued' || existing.status === 'running')) return toHistoryDto(existing);
  const now = nowIso();
  await db.prepare('DELETE FROM groups_periskope_history_chats WHERE ws = ?').run(ws);
  await db
    .prepare(
      `INSERT INTO groups_periskope_history (ws, status, phase, key_sealed, include_media, end_time, started_at, updated_at)
       VALUES (?, 'queued', 'chats', ?, ?, ?, ?, ?)
       ON CONFLICT(ws) DO UPDATE SET status = 'queued', phase = 'chats', key_sealed = excluded.key_sealed, include_media = excluded.include_media,
         end_time = excluded.end_time, chat_cursor = 0, chats_total = 0, chats_done = 0, chats_skipped = 0, messages = 0, duplicates = 0,
         media_saved = 0, media_failed = 0, reactions = 0, notes = 0, error = '', attempts = 0, claimed_until = NULL,
         started_at = excluded.started_at, finished_at = NULL, updated_at = excluded.updated_at`,
    )
    .run(ws, seal(key), opts.includeMedia === false ? 0 : 1, now.slice(0, 16).replace('T', ' '), now, now);
  return (await getHistoryStatus(ws))!;
}

/** Corta la corrida: borra la clave. Lo ya importado queda. */
export async function cancelHistory(ws: string): Promise<HistoryStatusDto | null> {
  await getDb()
    .prepare("UPDATE groups_periskope_history SET status = 'cancelled', key_sealed = '', claimed_until = NULL, finished_at = ?, updated_at = ? WHERE ws = ? AND status IN ('queued', 'running', 'error')")
    .run(nowIso(), nowIso(), ws);
  return getHistoryStatus(ws);
}

/** Reintenta una corrida con error, desde donde quedó (la clave sigue guardada). */
export async function resumeHistory(ws: string): Promise<HistoryStatusDto | null> {
  await getDb()
    .prepare("UPDATE groups_periskope_history SET status = 'queued', error = '', attempts = 0, claimed_until = NULL, finished_at = NULL, updated_at = ? WHERE ws = ? AND status = 'error' AND key_sealed != ''")
    .run(nowIso(), ws);
  return getHistoryStatus(ws);
}

async function claim(ws: string, now: Date): Promise<HistoryRow | null> {
  const nowS = now.toISOString();
  const r = await getDb()
    .prepare(
      `UPDATE groups_periskope_history SET claimed_until = ?, status = 'running', updated_at = ?
       WHERE ws = ? AND status IN ('queued', 'running') AND (claimed_until IS NULL OR claimed_until < ?)`,
    )
    .run(new Date(now.getTime() + CLAIM_MS).toISOString(), nowS, ws, nowS);
  if (r.changes === 0) return null;
  return ((await getDb().prepare('SELECT * FROM groups_periskope_history WHERE ws = ?').get(ws)) as HistoryRow) ?? null;
}

// ---------- Mapeo de mensajes ----------

const SKIP_TYPES = new Set(['e2e_notification', 'notification_template', 'notification', 'gp2', 'protocol', 'call_log', 'ciphertext', 'broadcast_notification', 'revoked', 'unknown']);

/** El id de WhatsApp de un mensaje de Periskope (`unique_id`, o el tramo del `message_id`). */
export function waIdOf(m: Pick<PskMessage, 'message_id' | 'unique_id'>): string {
  if (m.unique_id) return String(m.unique_id);
  const parts = String(m.message_id ?? '').split('_');
  return parts.length >= 3 ? parts[2] : parts[parts.length - 1] ?? '';
}

function isoOrNull(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v).replace(' ', 'T').replace(/\+00$/, 'Z'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function jidPhone(jid: string | null | undefined): string {
  const s = String(jid ?? '');
  return /@(c\.us|s\.whatsapp\.net)$/.test(s) || /^\d+$/.test(s) ? phoneDigits(s.replace(/@.*$/, '')) : '';
}

function statusFor(m: PskMessage): string {
  if (!m.from_me) return 'received';
  const ack = Number(m.ack);
  return ack >= 4 ? 'read' : ack >= 2 ? 'delivered' : 'sent';
}

function bodyFor(m: PskMessage): string {
  const body = (m.body ?? '').toString();
  const type = (m.message_type ?? 'chat').toLowerCase();
  if (type === 'poll_creation') {
    const opts = (m.poll_info?.pollOptions ?? m.poll_info?.options ?? []).map((o) => (typeof o === 'string' ? o : String((o as { name?: string })?.name ?? ''))).filter(Boolean);
    return [m.poll_info?.pollName ?? body, ...opts.map((o) => `- ${o}`)].filter(Boolean).join('\n');
  }
  return body;
}

type LineRow = { id: string; phone: string };
type ChatLite = { id: string; number_id: string };

/**
 * El chat de Lines de un chat de Periskope. Si no existe y hay una línea que
 * coincide con el teléfono de Periskope, se crea (sin eventos). Sin línea que
 * coincida, null: el chat se cuenta como salteado.
 */
async function resolveChat(ws: string, pskChatId: string, orgPhone: string, lines: LineRow[], name?: string): Promise<ChatLite | null> {
  const db = getDb();
  const isGroup = pskChatId.endsWith('@g.us');
  const phone = isGroup ? '' : phoneDigits(pskChatId.replace(/@.*$/, ''));
  if (!isGroup && phone.length < 6) return null;
  const line = orgPhone ? lines.find((n) => n.phone && phoneDigits(n.phone) === phoneDigits(orgPhone.replace(/@.*$/, ''))) : undefined;
  const rows = (await db
    .prepare(
      `SELECT id, number_id FROM groups_chats WHERE user_id = ? AND ${isGroup ? 'provider_chat_id = ?' : "kind = 'dm' AND (phone = ? OR provider_chat_id = ?)"} ORDER BY last_message_at DESC`,
    )
    .all(ws, ...(isGroup ? [pskChatId] : [phone, pskChatId]))) as ChatLite[];
  const hit = (line && rows.find((r) => r.number_id === line.id)) || (!line ? rows[0] : undefined);
  if (hit) return hit;
  const target = line ?? (lines.length === 1 && !orgPhone ? lines[0] : undefined);
  if (!target) return rows[0] ?? null;
  const chat = await upsertChat(
    { id: target.id, user_id: ws },
    { providerChatId: isGroup ? pskChatId : `${phone}@s.whatsapp.net`, kind: isGroup ? 'group' : 'dm', name, phone },
    { silent: true },
  );
  return { id: chat.id, number_id: chat.number_id };
}

/** Pagina `{ <key>: [...] }` de un endpoint con offset. */
async function page<T>(get: PeriskopeFetch, path: string, key: string, offset: number, limit: number): Promise<T[]> {
  const sep = path.includes('?') ? '&' : '?';
  const body = (await get(`${path}${sep}offset=${offset}&limit=${limit}`)) as Record<string, unknown> | null;
  return Array.isArray(body?.[key]) ? (body![key] as T[]) : [];
}

// ---------- Una página de mensajes ----------

interface PageStats {
  messages: number;
  duplicates: number;
  mediaSaved: number;
  mediaFailed: number;
}

async function importMessagePage(
  job: HistoryRow,
  chat: ChatLite,
  batch: PskMessage[],
  clients: HistoryClients,
  byEmail: Map<string, string>,
  deadline: number,
): Promise<PageStats> {
  const db = getDb();
  const stats: PageStats = { messages: 0, duplicates: 0, mediaSaved: 0, mediaFailed: 0 };
  const items = batch.filter((m) => m?.message_id && !SKIP_TYPES.has((m.message_type ?? 'chat').toLowerCase()) && waIdOf(m));
  // Lo que ya está (llegó por WhatsApp o en una corrida anterior): una sola consulta por página.
  const ids = [...new Set(items.map(waIdOf))];
  const known = new Set<string>();
  if (ids.length) {
    const rows = (await db
      .prepare(`SELECT provider_message_id FROM groups_messages WHERE number_id = ? AND provider_message_id IN (${ids.map(() => '?').join(',')})`)
      .all(chat.number_id, ...ids)) as Array<{ provider_message_id: string }>;
    for (const r of rows) known.add(r.provider_message_id);
  }
  const { saveUpload } = await import('./uploads');
  const pending: Array<{ row: MessageRow; url: string; name: string; mime: string }> = [];
  let latest: { at: string; preview: string } | null = null;
  for (const m of items) {
    const waId = waIdOf(m);
    if (known.has(waId)) {
      stats.duplicates++;
      continue;
    }
    known.add(waId);
    const at = isoOrNull(m.timestamp) ?? nowIso();
    const fromMe = m.from_me === true;
    const media = m.media && (m.media.path || m.media.mimetype) ? m.media : null;
    const email = (m.performed_by ?? '').toLowerCase();
    const authorId = fromMe && email && email !== 'api' ? (byEmail.get(email) ?? null) : null;
    const body = bodyFor(m);
    const mime = (media?.mimetype ?? '').split(';')[0].trim();
    const row = await insertMessage({
      ws: job.ws,
      chatId: chat.id,
      numberId: chat.number_id,
      providerMessageId: waId,
      direction: fromMe ? 'out' : 'in',
      senderPhone: fromMe ? '' : jidPhone(m.author) || jidPhone(m.sender_phone),
      authorId,
      authorKind: fromMe ? (authorId ? 'person' : 'phone') : 'person',
      body,
      media: media ? { url: '', type: mime || (m.message_type ?? ''), name: (media.filename ?? '').slice(0, 200) } : null,
      status: statusFor(m),
      createdAt: at,
      forwarded: m.is_forwarded === true,
      meta: { imported: true, importedFrom: 'periskope', ...(m.quoted_message_id ? { pskQuoted: waIdOf({ message_id: m.quoted_message_id }) } : {}) },
    });
    if (!row) {
      stats.duplicates++;
      continue;
    }
    stats.messages++;
    if (m.is_deleted) await db.prepare('UPDATE groups_messages SET deleted_at = ? WHERE id = ?').run(isoOrNull(m.updated_at) ?? at, row.id);
    else if (m.prev_body) await db.prepare('UPDATE groups_messages SET edited_at = ? WHERE id = ?').run(isoOrNull(m.updated_at) ?? at, row.id);
    if (!m.is_deleted && (!latest || at >= latest.at)) latest = { at, preview: previewOf(body, mime, media?.filename ?? '') };
    if (media?.path && job.include_media === 1 && !m.is_deleted) pending.push({ row, url: media.path, name: media.filename ?? '', mime });
  }
  // Los archivos, de a pocos a la vez y hasta donde alcance el tiempo (lo que queda sin archivo se cuenta).
  let i = 0;
  const worker = async () => {
    while (i < pending.length) {
      const p = pending[i++];
      if (Date.now() > deadline) {
        stats.mediaFailed++;
        continue;
      }
      try {
        const file = await clients.media(p.url, MAX_MEDIA_BYTES);
        if (!file) throw new Error('no_file');
        const mimetype = file.mimetype || p.mime || 'application/octet-stream';
        const stored = await saveUpload('chat', p.name || file.filename || `periskope-${p.row.id.slice(0, 8)}`, mimetype, file.data, {
          workspaceId: job.ws,
          userId: null,
          app: 'groups',
          access: 'internal',
        });
        await db.prepare("UPDATE groups_messages SET media_url = ?, media_type = CASE WHEN media_type = '' THEN ? ELSE media_type END WHERE id = ? AND media_url = ''").run(stored, mimetype, p.row.id);
        stats.mediaSaved++;
      } catch (err) {
        if (err instanceof GroupsError && err.status === 429) throw err;
        stats.mediaFailed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MEDIA_CONCURRENCY, pending.length) }, worker));
  if (latest) {
    await db
      .prepare('UPDATE groups_chats SET last_message_at = ?, last_message_preview = ? WHERE id = ? AND (last_message_at IS NULL OR last_message_at <= ?)')
      .run(latest.at, latest.preview, chat.id, latest.at);
  }
  return stats;
}

/** Al terminar un chat: respuestas citadas, reacciones y notas privadas. */
async function finishChat(job: HistoryRow, chat: ChatLite, pskChatId: string, orgPhone: string, clients: HistoryClients, byEmail: Map<string, string>): Promise<{ reactions: number; notes: number }> {
  const db = getDb();
  // Respuestas: la API manda primero lo más nuevo, así que lo citado entra después de quien lo cita.
  await db
    .prepare(
      `UPDATE groups_messages SET reply_to_id = (
         SELECT t.id FROM groups_messages t WHERE t.chat_id = groups_messages.chat_id AND t.provider_message_id = json_extract(groups_messages.meta, '$.pskQuoted') LIMIT 1)
       WHERE chat_id = ? AND user_id = ? AND reply_to_id IS NULL AND json_valid(meta) AND json_extract(meta, '$.pskQuoted') IS NOT NULL`,
    )
    .run(chat.id, job.ws);
  let reactions = 0;
  const me = phoneDigits(orgPhone.replace(/@.*$/, ''));
  for (let offset = 0; offset < 50_000; offset += 500) {
    let list: Array<{ unique_id?: string | null; sender_id?: string | null; reaction?: string | null; timestamp?: string | null }>;
    try {
      list = await page(clients.get, `/reactions?chat_id=${encodeURIComponent(pskChatId)}`, 'reactions', offset, 500);
    } catch (err) {
      if (err instanceof GroupsError && err.status === 429) throw err;
      break;
    }
    for (const r of list) {
      if (!r?.unique_id || !r.reaction) continue;
      const msg = (await db.prepare('SELECT * FROM groups_messages WHERE chat_id = ? AND provider_message_id = ?').get(chat.id, String(r.unique_id))) as MessageRow | undefined;
      if (!msg) continue;
      const by = jidPhone(r.sender_id) || 'contact';
      if (await applyReaction(msg, { emoji: String(r.reaction), by, fromMe: Boolean(me) && by === me, at: isoOrNull(r.timestamp) ?? undefined })) reactions++;
    }
    if (list.length < 500) break;
  }
  // Notas privadas del chat (las mismas que importa la corrida por API: el client_id evita repetirlas).
  let notes = 0;
  for (let offset = 0; offset < 50_000; offset += 500) {
    let list: Array<{ message_id: string; body?: string | null; timestamp?: string | null; performed_by?: string | null; is_deleted?: boolean | null; media?: { filename?: string | null } | null }>;
    try {
      list = await page(clients.get, `/chats/${encodeURIComponent(pskChatId)}/notes`, 'notes', offset, 500);
    } catch (err) {
      if (err instanceof GroupsError && err.status === 429) throw err;
      break;
    }
    for (const n of list) {
      const text = (n?.body ?? '').trim() || (n?.media?.filename ?? '').trim();
      if (!n?.message_id || n.is_deleted || !text) continue;
      const row = await insertMessage({
        ws: job.ws,
        chatId: chat.id,
        numberId: chat.number_id,
        providerMessageId: null,
        direction: 'note',
        authorId: n.performed_by ? (byEmail.get(n.performed_by.toLowerCase()) ?? null) : null,
        body: text,
        status: 'sent',
        createdAt: isoOrNull(n.timestamp) ?? undefined,
        clientId: `psk:${String(n.message_id).slice(0, 120)}`,
        meta: { importedFrom: 'periskope' },
      });
      if (row) notes++;
    }
    if (list.length < 500) break;
  }
  return { reactions, notes };
}

// ---------- Una tanda ----------

/**
 * Avanza la corrida del workspace hasta `budgetMs`. null si no hay nada que
 * correr (o otra tanda la tiene reclamada).
 */
export async function runHistoryChunk(ws: string, opts: { budgetMs?: number; now?: Date; clients?: HistoryClients } = {}): Promise<HistoryStatusDto | null> {
  const deadline = Date.now() + (opts.budgetMs ?? 25_000);
  const job = await claim(ws, opts.now ?? new Date());
  if (!job) return null;
  const db = getDb();
  const key = open(job.key_sealed);
  if (!key) {
    await save(ws, job.started_at, { status: 'error', error: 'key_unavailable', claimed_until: null, finished_at: nowIso() });
    return getHistoryStatus(ws);
  }
  try {
    const clients = opts.clients ?? (await historyClients(ws, key));
    const lines = (await db.prepare('SELECT id, phone FROM groups_numbers WHERE user_id = ?').all(ws)) as LineRow[];
    const people = await listPeople(ws);
    const byEmail = new Map(people.filter((p) => p.email).map((p) => [p.email.toLowerCase(), p.id]));
    const alive = async () => ((await db.prepare('SELECT started_at, status FROM groups_periskope_history WHERE ws = ?').get(ws)) as { started_at: string; status: string } | undefined);

    // Fase 1: la lista de chats de Periskope.
    while (job.phase === 'chats' && Date.now() < deadline) {
      const chats = await page<{ chat_id?: string; org_phone?: string | null; chat_name?: string | null }>(clients.get, '/chats', 'chats', job.chat_cursor, CHATS_PAGE);
      for (const c of chats) {
        if (!c?.chat_id) continue;
        await db
          .prepare('INSERT OR IGNORE INTO groups_periskope_history_chats (ws, psk_chat_id, chat_id) VALUES (?, ?, NULL)')
          .run(ws, `${c.chat_id}|${(c.org_phone ?? '').replace(/@.*$/, '')}|${(c.chat_name ?? '').slice(0, 120)}`);
      }
      const total = ((await db.prepare('SELECT COUNT(*) AS n FROM groups_periskope_history_chats WHERE ws = ?').get(ws)) as { n: number }).n;
      if (chats.length < CHATS_PAGE) {
        Object.assign(job, { phase: 'messages', chats_total: Number(total) });
        await save(ws, job.started_at, { phase: 'messages', chat_cursor: 0, chats_total: Number(total) });
      } else {
        job.chat_cursor += CHATS_PAGE;
        await save(ws, job.started_at, { chat_cursor: job.chat_cursor, chats_total: Number(total) });
      }
    }

    // Fase 2: los mensajes, chat por chat, página por página.
    while (job.phase === 'messages' && Date.now() < deadline) {
      const cur = await alive();
      if (!cur || cur.started_at !== job.started_at || cur.status === 'cancelled') return getHistoryStatus(ws);
      const next = (await db
        .prepare('SELECT psk_chat_id, msg_offset, messages FROM groups_periskope_history_chats WHERE ws = ? AND done = 0 ORDER BY rowid LIMIT 1')
        .get(ws)) as { psk_chat_id: string; msg_offset: number; messages: number } | undefined;
      if (!next) {
        Object.assign(job, { phase: 'done' });
        break;
      }
      const [pskChatId, orgPhone, ...rest] = next.psk_chat_id.split('|');
      const name = rest.join('|');
      const chat = await resolveChat(ws, pskChatId, orgPhone, lines, name || undefined);
      if (!chat) {
        await db.prepare('UPDATE groups_periskope_history_chats SET done = 1 WHERE ws = ? AND psk_chat_id = ?').run(ws, next.psk_chat_id);
        job.chats_skipped++;
        job.chats_done++;
        await save(ws, job.started_at, { chats_skipped: job.chats_skipped, chats_done: job.chats_done });
        continue;
      }
      const batch = await page<PskMessage>(clients.get, `/chats/${encodeURIComponent(pskChatId)}/messages?end_time=${encodeURIComponent(job.end_time)}`, 'messages', next.msg_offset, HISTORY_PAGE);
      const stats = await importMessagePage(job, chat, batch, clients, byEmail, deadline + 10_000);
      job.messages += stats.messages;
      job.duplicates += stats.duplicates;
      job.media_saved += stats.mediaSaved;
      job.media_failed += stats.mediaFailed;
      const last = batch.length < HISTORY_PAGE;
      await db
        .prepare('UPDATE groups_periskope_history_chats SET msg_offset = ?, chat_id = ?, messages = messages + ?, done = ? WHERE ws = ? AND psk_chat_id = ?')
        .run(next.msg_offset + batch.length, chat.id, stats.messages, last ? 1 : 0, ws, next.psk_chat_id);
      if (last) {
        const extra = await finishChat(job, chat, pskChatId, orgPhone, clients, byEmail);
        job.reactions += extra.reactions;
        job.notes += extra.notes;
        job.chats_done++;
      }
      await save(ws, job.started_at, {
        messages: job.messages,
        duplicates: job.duplicates,
        media_saved: job.media_saved,
        media_failed: job.media_failed,
        reactions: job.reactions,
        notes: job.notes,
        chats_done: job.chats_done,
        attempts: 0,
      });
    }

    if (job.phase === 'done') {
      await save(ws, job.started_at, { status: 'done', phase: 'done', key_sealed: '', claimed_until: null, finished_at: nowIso(), error: '' });
      await recordAudit(ws, {
        chatId: null,
        chatName: 'Periskope',
        actorId: ws,
        action: 'imported',
        detail: { source: 'periskope', kind: 'history', chats: job.chats_done, messages: job.messages, media: job.media_saved, reactions: job.reactions, notes: job.notes },
      }).catch(() => null);
    } else await save(ws, job.started_at, { claimed_until: null });
  } catch (err) {
    if (err instanceof GroupsError && err.status === 429) {
      // Periskope pidió bajar el ritmo: un minuto de espera, sin gastar intentos.
      await save(ws, job.started_at, { error: 'periskope_rate_limited', claimed_until: new Date(Date.now() + 60_000).toISOString() });
    } else {
      const attempts = job.attempts + 1;
      const code = err instanceof GroupsError ? err.code : 'periskope_unavailable';
      // Una clave que ya no sirve no se reintenta: se pide de nuevo.
      if (code === 'periskope_auth') await save(ws, job.started_at, { status: 'error', error: code, key_sealed: '', claimed_until: null, finished_at: nowIso() });
      else if (attempts >= MAX_ATTEMPTS) await save(ws, job.started_at, { status: 'error', error: code, attempts, claimed_until: null, finished_at: nowIso() });
      else await save(ws, job.started_at, { error: code, attempts, claimed_until: new Date(Date.now() + attempts * 60_000).toISOString() });
    }
  }
  return getHistoryStatus(ws);
}

/** Cron de cada minuto: avanza las corridas pendientes. */
export async function runHistoryJobs(opts: { budgetMs?: number; now?: Date } = {}): Promise<{ ran: number; done: number }> {
  const start = Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const nowS = (opts.now ?? new Date()).toISOString();
  const rows = (await getDb()
    .prepare("SELECT ws FROM groups_periskope_history WHERE status IN ('queued', 'running') AND (claimed_until IS NULL OR claimed_until < ?) ORDER BY updated_at LIMIT 5")
    .all(nowS)) as Array<{ ws: string }>;
  const out = { ran: 0, done: 0 };
  for (const r of rows) {
    const left = budget - (Date.now() - start);
    if (left < 3_000) break;
    const st = await runHistoryChunk(r.ws, { budgetMs: left, now: opts.now }).catch(() => null);
    if (st) {
      out.ran++;
      if (st.status === 'done') out.done++;
    }
  }
  return out;
}

/** Corre una tanda después de responder (o acá mismo si no hay request). */
export async function kickHistory(ws: string): Promise<void> {
  const job = () => runHistoryChunk(ws, { budgetMs: 25_000 }).catch(() => null);
  try {
    const { after } = await import('next/server');
    after(job);
  } catch {
    await job();
  }
}
