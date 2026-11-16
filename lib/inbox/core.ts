/**
 * Inbox: cuentas, chats, mensajes, carpetas, snippets y envíos programados.
 * Server-only. Cada función recibe `owner` (el id real de la persona) y todas
 * las consultas filtran por él: no hay forma de pedir datos de otra persona,
 * tampoco siendo admin del workspace.
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import { dbBatch, getDb, type BatchStatement } from '../db';
import { inboxSortKey } from '../schema/inbox-lines-perf-migration';
import { open, seal } from '../secret-box';
import { parseSearch, threadIdsMatching } from './message-search';
import { sendUnarchiveMark, snoozeWakeMark } from '../wa-archive-sync';
import { readHiddenInWhatsapp } from '../wa-privacy';
import { publicLink } from '../wa-link-thumb';
import { canMoveFolder, depthOf, descendantIds, MAX_FOLDER_DEPTH, rollupUnread, siblingOrder } from './folder-tree';
import {
  InboxError,
  LIMITS,
  WAITING_AFTER_MS,
  cleanShortcut,
  parseRule,
  previewOf,
  type AccountStatus,
  type FolderDto,
  type FolderRule,
  type InboxAccountDto,
  type InboxChannel,
  type InboxView,
  type MentionNames,
  type MessageDto,
  type MessageQuote,
  type MessageReaction,
  type WaMessageMeta,
  type ScheduledDto,
  type ScheduledStatus,
  type SnippetDto,
  type ThreadDto,
  type ThreadKind,
} from './types';

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function nowIso(now = new Date()): string {
  return now.toISOString();
}

// ---------------------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------------------

export interface AccountRow {
  id: string;
  owner_id: string;
  kind: InboxChannel;
  provider: string;
  label: string;
  address: string;
  status: AccountStatus;
  config: string;
  webhook_secret: string;
  sync_cursor: string;
  sync_claimed_until: string | null;
  last_sync_at: string | null;
  error: string;
  created_at: string;
  updated_at: string;
  /** WhatsApp: "Confirmaciones de lectura" ('all', 'none' o '' sin saber) y cuándo se leyó (lib/wa-privacy.ts). */
  read_receipts?: string;
  privacy_at?: string | null;
  /** WhatsApp: no puede sincronizar el archivado ('app_state_unavailable'; lib/wa-archive-sync.ts). */
  archive_sync_error?: string;
  /** WhatsApp: cuándo se empezó a vincular por última vez (el QR). NULL en las cuentas vinculadas antes de guardarlo. */
  linked_at?: string | null;
}

/** Credenciales de la cuenta, descifradas. */
export function readAccountConfig<T extends Record<string, unknown>>(row: Pick<AccountRow, 'config'>): Partial<T> {
  const plain = open(row.config);
  if (!plain) return {};
  try {
    const parsed = JSON.parse(plain) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Partial<T>) : {};
  } catch {
    return {};
  }
}

export async function writeAccountConfig(id: string, config: Record<string, unknown>): Promise<void> {
  await getDb().prepare('UPDATE inbox_accounts SET config = ?, updated_at = ? WHERE id = ?').run(seal(JSON.stringify(config)), nowIso(), id);
}

export function accountDto(r: AccountRow): InboxAccountDto {
  let backfilling = false;
  try {
    const c = r.sync_cursor ? (JSON.parse(r.sync_cursor) as { phase?: string }) : null;
    backfilling = r.kind === 'whatsapp' && r.provider === 'managed' && !!c?.phase && c.phase !== 'done';
  } catch {
    backfilling = false;
  }
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    address: r.address,
    status: r.status,
    error: r.error,
    lastSyncAt: r.last_sync_at,
    backfilling,
    archiveSyncBroken: r.kind === 'whatsapp' && !!r.archive_sync_error,
  };
}

export async function listAccounts(owner: string): Promise<AccountRow[]> {
  return (await getDb().prepare('SELECT * FROM inbox_accounts WHERE owner_id = ? ORDER BY kind DESC, created_at').all(owner)) as unknown as AccountRow[];
}

export async function getAccount(owner: string, id: string): Promise<AccountRow> {
  const row = (await getDb().prepare('SELECT * FROM inbox_accounts WHERE id = ? AND owner_id = ?').get(id, owner)) as AccountRow | undefined;
  if (!row) throw new InboxError('not_found', 404);
  return row;
}

/** Solo para el webhook y el cron (sin dueño a mano): nunca se expone por API. */
export async function getAccountById(id: string): Promise<AccountRow | null> {
  return ((await getDb().prepare('SELECT * FROM inbox_accounts WHERE id = ?').get(id)) as AccountRow | undefined) ?? null;
}

export async function createAccount(owner: string, input: { kind: InboxChannel; provider: string; label?: string; address?: string }): Promise<AccountRow> {
  const id = newId('iba');
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO inbox_accounts (id, owner_id, kind, provider, label, address, status, webhook_secret, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'disconnected', ?, ?, ?)`,
    )
    .run(id, owner, input.kind, input.provider, (input.label ?? '').slice(0, 80), (input.address ?? '').slice(0, 200), randomBytes(24).toString('hex'), now, now);
  return getAccount(owner, id);
}

export async function setAccountState(id: string, patch: Partial<Pick<AccountRow, 'status' | 'address' | 'error' | 'provider' | 'label' | 'sync_cursor' | 'last_sync_at'>>): Promise<void> {
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  if (!keys.length) return;
  await getDb()
    .prepare(`UPDATE inbox_accounts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => (patch[k] ?? null) as string | null), nowIso(), id);
}

/** Borra la cuenta con sus chats, mensajes y envíos (cascade). */
export async function deleteAccountRow(owner: string, id: string): Promise<void> {
  const r = await getDb().prepare('DELETE FROM inbox_accounts WHERE id = ? AND owner_id = ?').run(id, owner);
  // La libreta de WhatsApp de la cuenta se va con ella.
  if (r.changes > 0) await import('../wa-contacts').then((m) => m.forgetContacts('inbox', id)).catch(() => null);
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

export interface ThreadRow {
  id: string;
  owner_id: string;
  account_id: string;
  channel: InboxChannel;
  kind: ThreadKind;
  external_id: string;
  title: string;
  handle: string;
  preview: string;
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_from_me: number;
  unread: number;
  pinned_at: string | null;
  done_at: string | null;
  archived_at?: string | null;
  snoozed_until: string | null;
  /** 1: "Mantener archivado" (ni un mensaje ni el teléfono lo sacan de Archivados; trigger en la base). */
  keep_archived?: number;
  /** 1: el pospuesto archivó el chat (no estaba archivado); al cancelarlo vuelve a la bandeja. */
  snooze_archived?: number;
  woke_at: string | null;
  woke_reason: string;
  follow_up_at: string | null;
  follow_up_since: string | null;
  muted_until: string | null;
  draft: string;
  notes: string;
  created_at: string;
  updated_at: string;
  /** WhatsApp: URL de la foto en su servidor (nunca sale al navegador). */
  avatar_url?: string;
  /** WhatsApp: JSON con "info", descripción y participantes (ver lib/inbox/wa-meta.ts). */
  info?: string;
  info_at?: string | null;
  last_sender?: string;
  last_kind?: string;
  last_status?: string;
  presence?: string;
  presence_who?: string;
  presence_at?: string | null;
  last_seen_at?: string | null;
  summary?: string;
  summary_at?: string | null;
  /** Desde cuándo le falta un mensaje que WhatsApp no pudo entregar (lib/wa-history-gaps.ts). */
  history_gap_at?: string | null;
  /** Sacado de Inbox (lib/inbox/removed.ts): fuera de todas las vistas hasta que se recupera o se purga. */
  removed_at?: string | null;
}

/** Versión corta de la URL de la foto: cambia el link (y la caché del navegador) cuando cambia la foto. */
export function avatarVersion(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 10);
}

/** Presencia que se muestra: escribiendo/grabando (25 s) o en línea (5 min desde el último aviso). */
export function presenceOf(r: Pick<ThreadRow, 'presence' | 'presence_at'>, now = new Date()): ThreadDto['presence'] {
  const at = r.presence_at ? Date.parse(r.presence_at) : NaN;
  if (!r.presence || !Number.isFinite(at)) return '';
  const age = now.getTime() - at;
  if (age < 0 || age > 5 * 60_000) return '';
  if (r.presence === 'composing') return age < 25_000 ? 'typing' : 'online';
  if (r.presence === 'recording') return age < 25_000 ? 'recording' : 'online';
  if (r.presence === 'available' || r.presence === 'paused') return 'online';
  return '';
}

/** El chat de la persona. Uno sacado de Inbox no se abre (404) hasta que se recupera. */
export async function getThreadRow(owner: string, id: string): Promise<ThreadRow> {
  const row = (await getDb().prepare('SELECT * FROM inbox_threads WHERE id = ? AND owner_id = ? AND removed_at IS NULL').get(id, owner)) as ThreadRow | undefined;
  if (!row) throw new InboxError('not_found', 404);
  return row;
}

export async function findThread(accountId: string, externalId: string): Promise<ThreadRow | null> {
  return ((await getDb().prepare('SELECT * FROM inbox_threads WHERE account_id = ? AND external_id = ?').get(accountId, externalId)) as ThreadRow | undefined) ?? null;
}

/** Busca o crea el chat de una cuenta. El título solo se pisa si viene uno y el actual está vacío o `forceTitle`. */
export async function upsertThread(
  account: Pick<AccountRow, 'id' | 'owner_id' | 'kind'>,
  input: ThreadInput,
): Promise<ThreadRow> {
  const db = getDb();
  const insert = threadInsert(account, input);
  await db.prepare(insert.sql).run(...insert.args);
  const row = (await findThread(account.id, input.externalId.slice(0, 300)))!;
  return finishThread(row, input);
}

export interface ThreadInput {
  externalId: string;
  kind: ThreadKind;
  title?: string;
  handle?: string;
  forceTitle?: boolean;
}

/** El INSERT de un chat que puede existir (no pisa nada si ya está). */
function threadInsert(account: Pick<AccountRow, 'id' | 'owner_id' | 'kind'>, input: ThreadInput): BatchStatement {
  const now = nowIso();
  return {
    sql: `INSERT INTO inbox_threads (id, owner_id, account_id, channel, kind, external_id, title, handle, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (account_id, external_id) DO NOTHING`,
    args: [newId('ibt'), account.owner_id, account.id, account.kind, input.kind, input.externalId.slice(0, 300), (input.title ?? '').trim().slice(0, 200), (input.handle ?? '').slice(0, 200), now, now],
  };
}

/** Lo que sigue a tener la fila del chat: completar el nombre y el número si faltaban. */
async function finishThread(row: ThreadRow, input: ThreadInput): Promise<ThreadRow> {
  const db = getDb();
  const title = (input.title ?? '').trim().slice(0, 200);
  if (title && (input.forceTitle || !row.title) && row.title !== title) {
    await db.prepare('UPDATE inbox_threads SET title = ?, updated_at = ? WHERE id = ?').run(title, nowIso(), row.id);
    row.title = title;
  }
  if (input.handle && !row.handle) {
    await db.prepare('UPDATE inbox_threads SET handle = ? WHERE id = ?').run(input.handle.slice(0, 200), row.id);
    row.handle = input.handle;
  }
  return row;
}

export interface NewMessage {
  externalId: string;
  fromMe: boolean;
  senderName?: string;
  senderHandle?: string;
  subject?: string;
  body: string;
  emailTo?: string;
  emailCc?: string;
  emailMessageId?: string;
  mediaType?: string;
  mediaName?: string;
  mediaRef?: string;
  replyTo?: string;
  status?: string;
  sentAt?: string;
  /** Mensaje viejo (historial o importación): no cuenta como no leído ni saca el chat de Hecho. */
  history?: boolean;
  /** Id que puso la pantalla al mandar (único por chat): un reintento del mismo envío encuentra este mensaje. */
  clientId?: string;
  /** Ya leído en el proveedor (Gmail sin UNREAD). */
  read?: boolean;
  /** WhatsApp: datos de la media, ubicación, contactos o encuesta (JSON de WaMessageMeta). */
  meta?: string;
  forwarded?: boolean;
  /** Tipo para la vista previa de la lista (voice, location, contact, poll…); si no, el de la media. */
  kind?: string;
}

/**
 * Guarda un mensaje (sin duplicar: único por chat + id del proveedor) y
 * actualiza el chat: vista previa, no leídos y, si llega uno nuevo de la otra
 * persona, el chat vuelve a la bandeja (sale de Hecho) y se cancela el
 * "recordame si no contesta" (contestó). Devuelve false si ya estaba.
 */
const NEW_MESSAGE_COLS = `id, owner_id, thread_id, external_id, from_me, sender_name, sender_handle, subject, body, email_to, email_cc,
         email_message_id, media_type, media_name, media_ref, reply_to, status, sent_at, created_at, meta, forwarded, client_id`;

/** Los valores de un mensaje nuevo después de thread_id, en el orden de NEW_MESSAGE_COLS. */
function messageTail(m: NewMessage, sentAt: string): Array<string | number> {
  return [
    m.externalId.slice(0, 300),
    m.fromMe ? 1 : 0,
    (m.senderName ?? '').slice(0, 200),
    (m.senderHandle ?? '').slice(0, 200),
    (m.subject ?? '').slice(0, 500),
    m.body.slice(0, 100_000),
    (m.emailTo ?? '').slice(0, 2000),
    (m.emailCc ?? '').slice(0, 2000),
    (m.emailMessageId ?? '').slice(0, 500),
    (m.mediaType ?? '').slice(0, 40),
    (m.mediaName ?? '').slice(0, 300),
    (m.mediaRef ?? '').slice(0, 4000),
    (m.replyTo ?? '').slice(0, 300),
    (m.status ?? '').slice(0, 20),
    sentAt,
    nowIso(),
    (m.meta ?? '').slice(0, 40_000),
    m.forwarded ? 1 : 0,
    m.clientId ?? null,
  ] as Array<string | number>;
}

const MESSAGE_TAIL_MARKS = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?';

/**
 * Lo que un mensaje nuevo le cambia a su chat en la lista (`where` elige el
 * chat). "Es el más nuevo" se decide en la base, contra la fila como está en
 * ese momento: last_message_at vacío o anterior o igual a la hora del mensaje.
 */
function threadTouch(m: NewMessage, sentAt: string, where: string, whereArgs: string[], fromHere = false): BatchStatement {
  const preview = previewOf(m.subject ? `${m.subject} · ${m.body}` : m.body, m.mediaType);
  const newer = '(last_message_at IS NULL OR last_message_at <= ?)';
  const live = !m.fromMe && !m.history ? 1 : 0;
  // Un mensaje mío en vivo (desde acá, programado, por la API o desde el teléfono) saca el chat de WhatsApp de
  // Archivados, también si estaba "hecho". Como WhatsApp, que lo desarchiva solo: no se le manda nada. El que llega
  // del teléfono, solo si es el más nuevo del chat (uno viejo que llega tarde no desarchiva); el que sale de acá, siempre.
  const out = outgoingLive(m) ? 1 : 0;
  const sure = fromHere ? 1 : 0;
  const now = nowIso();
  // Un chat sacado de Inbox sigue guardando lo que llega, pero no se mueve: al recuperarlo vuelve a donde estaba.
  const kept = 'removed_at IS NULL AND ';
  return {
    sql: `UPDATE inbox_threads SET
         preview = CASE WHEN ${newer} THEN ? ELSE preview END,
         last_from_me = CASE WHEN ${newer} THEN ? ELSE last_from_me END,
         last_sender = CASE WHEN ${newer} THEN ? ELSE last_sender END,
         last_kind = CASE WHEN ${newer} THEN ? ELSE last_kind END,
         last_status = CASE WHEN ${newer} THEN ? ELSE last_status END,
         last_message_at = CASE WHEN last_message_at IS NULL OR last_message_at < ? THEN ? ELSE last_message_at END,
         last_inbound_at = CASE WHEN ? = 0 AND (last_inbound_at IS NULL OR last_inbound_at < ?) THEN ? ELSE last_inbound_at END,
         last_outbound_at = CASE WHEN ? = 1 AND (last_outbound_at IS NULL OR last_outbound_at < ?) THEN ? ELSE last_outbound_at END,
         unread = CASE WHEN ? = 1 THEN 0 ELSE unread + ? END,
         done_at = CASE WHEN ${kept}(? = 1 OR (? = 1 AND channel = 'whatsapp')) AND (? = 1 OR ${newer}) THEN NULL ELSE done_at END,
         archived_at = CASE WHEN ${kept}((? = 1 AND (muted_until IS NULL OR muted_until <= ? OR (snoozed_until IS NOT NULL AND snooze_archived = 1))) OR (? = 1 AND channel = 'whatsapp')) AND (? = 1 OR ${newer}) THEN NULL ELSE archived_at END,
         snoozed_until = CASE WHEN ${kept}(? = 1 OR (? = 1 AND channel = 'whatsapp')) AND (? = 1 OR ${newer}) THEN NULL ELSE snoozed_until END,
         snooze_archived = CASE WHEN ${kept}(? = 1 OR (? = 1 AND channel = 'whatsapp')) AND (? = 1 OR ${newer}) THEN 0 ELSE snooze_archived END,
         follow_up_at = CASE WHEN ${kept}? = 1 THEN NULL ELSE follow_up_at END,
         updated_at = ?
       WHERE ${where}`,
    args: [
      sentAt,
      preview,
      sentAt,
      m.fromMe ? 1 : 0,
      sentAt,
      m.fromMe ? '' : (m.senderName || m.senderHandle || '').slice(0, 200),
      sentAt,
      (m.kind || m.mediaType || '').slice(0, 20),
      sentAt,
      m.fromMe ? (m.status ?? '').slice(0, 20) : '',
      sentAt,
      sentAt,
      m.fromMe ? 1 : 0,
      sentAt,
      sentAt,
      m.fromMe ? 1 : 0,
      sentAt,
      sentAt,
      // Un mensaje mío en vivo (desde el teléfono o desde acá) deja el chat leído.
      m.fromMe && !m.history ? 1 : 0,
      !m.fromMe && !m.history && !m.read ? 1 : 0,
      // Llega algo nuevo de la otra persona: vuelve a la bandeja.
      live,
      out,
      sure,
      sentAt,
      // Como WhatsApp: un mensaje nuevo saca el chat de Archivados (salvo que esté silenciado; si lo archivó un
      // pospuesto, vuelve igual).
      live,
      now,
      out,
      sure,
      sentAt,
      // El pospuesto termina cuando el chat sale de Archivados: llega un mensaje, o sale uno por WhatsApp.
      live,
      out,
      sure,
      sentAt,
      live,
      out,
      sure,
      sentAt,
      live,
      now,
      ...whereArgs,
    ],
  };
}

/** ¿Un mensaje mío en vivo (no del historial)? Es el que desarchiva el chat. */
function outgoingLive(m: NewMessage): boolean {
  return m.fromMe && !m.history;
}

/** Antes de tocar el chat: el desarchivado por envío queda anotado para el eco del teléfono (lib/wa-archive-sync.ts). */
function unarchiveMark(m: NewMessage, sentAt: string, messageId: string, fromHere = false): BatchStatement[] {
  const mine = 'c.id = (SELECT thread_id FROM inbox_messages WHERE id = ?)';
  // Uno que llega a un chat pospuesto lo despierta: el desarchivado va también al teléfono (lib/wa-archive-sync.ts).
  if (!m.fromMe && !m.history) return [snoozeWakeMark('inbox', `${mine} AND (c.last_message_at IS NULL OR c.last_message_at <= ?)`, [messageId, sentAt])];
  if (!outgoingLive(m)) return [];
  return [fromHere ? sendUnarchiveMark('inbox', mine, [messageId]) : sendUnarchiveMark('inbox', `${mine} AND (c.last_message_at IS NULL OR c.last_message_at <= ?)`, [messageId, sentAt])];
}

/** Lo que cambia en la fila que ya tiene quien llama (así el próximo mensaje de la tanda compara contra lo nuevo). */
function noteNewest(thread: ThreadRow, m: NewMessage, sentAt: string): void {
  if (thread.last_message_at && sentAt < thread.last_message_at) return;
  thread.last_message_at = sentAt;
  thread.preview = previewOf(m.subject ? `${m.subject} · ${m.body}` : m.body, m.mediaType);
  thread.last_from_me = m.fromMe ? 1 : 0;
  if (outgoingLive(m) && thread.channel === 'whatsapp') {
    thread.archived_at = null;
    thread.done_at = null;
    thread.snoozed_until = null;
  }
}

/**
 * Guarda un mensaje y lo que le cambia a su chat en la lista, en una sola ida
 * a la base (todo o nada). false si ya estaba (mismo id del proveedor en el
 * chat): el chat no se toca.
 */
export async function addMessage(thread: ThreadRow, m: NewMessage): Promise<boolean> {
  const sentAt = validIso(m.sentAt) ?? nowIso();
  const id = newId('ibm');
  const res = await dbBatch([
    {
      sql: `INSERT INTO inbox_messages (${NEW_MESSAGE_COLS})
       VALUES (?, ?, ?, ${MESSAGE_TAIL_MARKS})
       ON CONFLICT DO NOTHING`,
      args: [id, thread.owner_id, thread.id, ...messageTail(m, sentAt)],
    },
    // Lo guarda quien lo mandó desde acá (o la sincronización de Gmail y la importación, que no desarchivan).
    ...unarchiveMark(m, sentAt, id, true),
    // Solo si el mensaje entró: uno repetido no existe con este id.
    threadTouch(m, sentAt, 'id = ? AND EXISTS (SELECT 1 FROM inbox_messages WHERE id = ?)', [thread.id, id], true),
  ]);
  if (res[0].changes === 0) return false;
  noteNewest(thread, m, sentAt);
  // Lo que mandé desde la app a un chat por teléfono: si el eco de WhatsApp llegó antes solo con el lid y abrió otro
  // chat, se juntan (lib/wa-dedupe-run.ts). Después de responder: nunca suma espera al envío.
  if (m.fromMe && !m.history && thread.channel === 'whatsapp' && thread.kind === 'dm' && /@s\.whatsapp\.net$/.test(thread.external_id)) {
    const job = () => import('../wa-dedupe-run').then((d) => d.mergeAfterOwnSend(thread, m.externalId)).catch(() => null);
    try {
      const { after } = await import('next/server');
      after(job);
    } catch {
      // Fuera de un request (crons, pruebas): en segundo plano.
      void job();
    }
  }
  return true;
}

/**
 * Un mensaje que llega por webhook, en una sola ida a la base: el chat (se
 * crea si no estaba), el mensaje y lo que le cambia al chat en la lista (que
 * es lo que avisa a la pantalla abierta). Todo o nada. Devuelve el chat y si
 * el mensaje era nuevo.
 */
export async function addMessageToChat(
  account: Pick<AccountRow, 'id' | 'owner_id' | 'kind'>,
  input: ThreadInput,
  m: NewMessage,
): Promise<{ thread: ThreadRow; added: boolean; id: string }> {
  const sentAt = validIso(m.sentAt) ?? nowIso();
  const id = newId('ibm');
  const external = input.externalId.slice(0, 300);
  const res = await dbBatch([
    threadInsert(account, input),
    { sql: 'SELECT * FROM inbox_threads WHERE account_id = ? AND external_id = ?', args: [account.id, external] },
    {
      sql: `INSERT INTO inbox_messages (${NEW_MESSAGE_COLS})
       VALUES (?, ?, (SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?), ${MESSAGE_TAIL_MARKS})
       ON CONFLICT DO NOTHING`,
      args: [id, account.owner_id, account.id, external, ...messageTail(m, sentAt)],
    },
    ...unarchiveMark(m, sentAt, id),
    threadTouch(m, sentAt, 'id = (SELECT thread_id FROM inbox_messages WHERE id = ?)', [id]),
  ]);
  const thread = await finishThread(res[1].rows[0] as unknown as ThreadRow, input);
  const added = res[2].changes > 0;
  if (added) noteNewest(thread, m, sentAt);
  return { thread, added, id };
}

function validIso(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function likeArg(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Condición SQL de la regla de una carpeta (sobre el alias t). */
function ruleSql(rule: FolderRule | null): { sql: string; args: string[] } | null {
  if (!rule) return null;
  const parts: string[] = [];
  const args: string[] = [];
  if (rule.channel) {
    parts.push('t.channel = ?');
    args.push(rule.channel);
  }
  if (rule.kind) {
    parts.push('t.kind = ?');
    args.push(rule.kind);
  }
  if (rule.from) {
    parts.push("(t.title LIKE ? ESCAPE '\\' OR t.handle LIKE ? ESCAPE '\\')");
    args.push(likeArg(rule.from), likeArg(rule.from));
  }
  return parts.length ? { sql: parts.join(' AND '), args } : null;
}

export interface ListOptions {
  view?: InboxView;
  folderId?: string;
  q?: string;
  limit?: number;
  now?: Date;
  /** Cursor de la página anterior (`next`): trae los chats que siguen. */
  cursor?: string | null;
}

/** Columnas que usa una fila de la lista (sin info del contacto, notas ni resumen: no viajan en cada consulta). */
const LIST_COLS = [
  'id', 'account_id', 'channel', 'kind', 'external_id', 'title', 'handle', 'preview', 'last_message_at', 'last_from_me', 'unread', 'pinned_at', 'done_at',
  'archived_at', 'keep_archived', 'snoozed_until', 'woke_at', 'woke_reason', 'follow_up_at', 'muted_until', 'draft', 'avatar_url', 'last_sender', 'last_kind', 'last_status',
  'presence', 'presence_who', 'presence_at', 'last_seen_at',
]
  .map((c) => `t.${c}`)
  .join(', ');

const SORT_KEY = inboxSortKey('t');

/** Tope de fijados que entran en la primera página (son pocos: se fijan a mano). */
const MAX_PINNED = 200;

interface ListCursor {
  k: string;
  id: string;
}

export function encodeListCursor(c: ListCursor): string {
  return Buffer.from(JSON.stringify([c.k, c.id]), 'utf8').toString('base64url');
}

export function decodeListCursor(raw: string | null | undefined): ListCursor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string' && v[0].length <= 80 && v[1].length <= 80) return { k: v[0], id: v[1] };
  } catch {
    /* cursor roto: primera página */
  }
  return null;
}

export interface ThreadPage {
  threads: ThreadDto[];
  /** Cursor para la página que sigue; null si no hay más. */
  next: string | null;
  /** Cuántos de `threads` son los fijados que van adelante en la primera página (no cuentan para `limit`). */
  pinned: number;
}

/**
 * Chats de una vista o carpeta, fijados primero y después por último
 * mensaje. Con búsqueda, mira en todas las vistas (también Hecho) y en el
 * texto de los mensajes.
 */
export async function listThreads(owner: string, opts: ListOptions = {}): Promise<ThreadDto[]> {
  return (await listThreadsPage(owner, opts)).threads;
}

/**
 * Una página de la lista, con cursor (keyset): los fijados entran todos en la
 * primera; el resto va por (orden, id), así lo que llega mientras se baja no
 * repite ni saltea filas. Cada consulta lee solo su página (índices
 * idx_inbox_threads_list y idx_inbox_threads_unread).
 */
export async function listThreadsPage(owner: string, opts: ListOptions = {}): Promise<ThreadPage> {
  const now = opts.now ?? new Date();
  if (opts.view === 'removed' && !opts.folderId) {
    const { listRemoved } = await import('./removed');
    return { threads: await listRemoved(owner, now), next: null, pinned: 0 };
  }
  const nowS = now.toISOString();
  // Los sacados de Inbox no están en ninguna vista, carpeta ni búsqueda.
  const where: string[] = ['t.removed_at IS NULL'];
  const args: Array<string | number> = [];
  const q = (opts.q ?? '').trim().slice(0, LIMITS.searchQuery);
  const view = opts.view ?? 'inbox';
  const active = '(t.done_at IS NULL AND t.archived_at IS NULL AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?))';
  // Una carpeta sin reglas es un conjunto chico de chats: se buscan por id y se ordenan, en vez de recorrer la bandeja en orden.
  let smallSet = false;
  if (q) {
    // Nombre, número o vista previa del chat, o algún mensaje (índice de texto completo; sin él, LIKE).
    const parsed = parseSearch(q);
    const text = [...parsed.phrases, ...parsed.terms].join(' ') || q;
    const l = likeArg(text);
    const hits = await threadIdsMatching(owner, q);
    if (hits === null) {
      where.push(
        `(t.title LIKE ? ESCAPE '\\' OR t.handle LIKE ? ESCAPE '\\' OR t.preview LIKE ? ESCAPE '\\'
          OR EXISTS (SELECT 1 FROM inbox_messages m WHERE m.thread_id = t.id AND (m.body LIKE ? ESCAPE '\\' OR m.subject LIKE ? ESCAPE '\\')))`,
      );
      args.push(l, l, l, l, l);
    } else {
      where.push(`(t.title LIKE ? ESCAPE '\\' OR t.handle LIKE ? ESCAPE '\\' OR t.preview LIKE ? ESCAPE '\\'${hits.length ? ` OR t.id IN (${hits.map(() => '?').join(', ')})` : ''})`);
      args.push(l, l, l, ...hits);
    }
  }
  if (opts.folderId) {
    const folder = await getFolderRow(owner, opts.folderId);
    // La carpeta muestra también lo de sus subcarpetas (como sus no leídos).
    const all = (await getDb().prepare('SELECT * FROM inbox_folders WHERE owner_id = ?').all(owner)) as unknown as FolderRow[];
    const tree = all.map((f) => ({ id: f.id, parentId: f.parent_id, position: f.position }));
    const ids = [folder.id, ...descendantIds(tree, folder.id)];
    const rules = all.filter((f) => ids.includes(f.id)).map((f) => ruleSql(parseRuleText(f.rule))).filter((r): r is NonNullable<typeof r> => r !== null);
    where.push(
      `(t.id IN (SELECT thread_id FROM inbox_thread_folders WHERE folder_id IN (${ids.map(() => '?').join(', ')}))${rules.map((r) => ` OR (${r.sql})`).join('')})`,
    );
    args.push(...ids, ...rules.flatMap((r) => r.args));
    smallSet = rules.length === 0;
    if (!q) {
      where.push(active);
      args.push(nowS);
    }
  } else if (!q) {
    switch (view) {
      case 'inbox':
        where.push(active);
        args.push(nowS);
        break;
      case 'unread':
        where.push(active, 't.unread > 0');
        args.push(nowS);
        break;
      case 'reply':
        where.push(active, 't.last_from_me = 0', "t.kind <> 'group'", 't.last_message_at IS NOT NULL');
        args.push(nowS);
        break;
      case 'waiting':
        where.push(active, 't.last_from_me = 1', 't.last_outbound_at < ?');
        args.push(nowS, new Date(now.getTime() - WAITING_AFTER_MS).toISOString());
        break;
      case 'whatsapp':
        where.push(active, "t.channel = 'whatsapp'");
        args.push(nowS);
        break;
      case 'email':
        where.push(active, "t.channel = 'gmail'");
        args.push(nowS);
        break;
      case 'groups':
        where.push(active, "t.kind = 'group'");
        args.push(nowS);
        break;
      case 'pinned':
        where.push('t.pinned_at IS NOT NULL', 't.archived_at IS NULL');
        break;
      case 'snoozed':
        where.push('t.snoozed_until > ?');
        args.push(nowS);
        break;
      case 'scheduled':
        where.push("EXISTS (SELECT 1 FROM inbox_scheduled s WHERE s.thread_id = t.id AND s.status IN ('pending','failed','missed'))");
        break;
      case 'nofolder': {
        // Lo de la bandeja que no está en ninguna carpeta: ni puesto a mano (clave primaria thread_id, folder_id de
        // inbox_thread_folders) ni por la regla de alguna. Mismo filtro que los contadores (matchesRuleSql).
        where.push(active, 'NOT EXISTS (SELECT 1 FROM inbox_thread_folders tf JOIN inbox_folders fo ON fo.id = tf.folder_id WHERE tf.thread_id = t.id)');
        args.push(nowS);
        for (const r of await folderRules(owner)) {
          where.push(`NOT COALESCE((${r.sql}), 0)`);
          args.push(...r.args);
        }
        break;
      }
      // "Hecho" y "Archivado" son una sola cosa para quien usa Inbox: la vista Archivados muestra los dos.
      case 'done':
      case 'archived':
        where.push('(t.archived_at IS NOT NULL OR t.done_at IS NOT NULL)');
        break;
    }
  }
  // Orden: una sola clave más el id (desempate estable para el cursor). Los fijados van aparte, primero.
  const plain = !q && !opts.folderId;
  const mode: { key: string; dir: 'ASC' | 'DESC'; pinnedFirst: boolean } =
    plain && view === 'snoozed'
      ? { key: 't.snoozed_until', dir: 'ASC', pinnedFirst: false }
      : plain && (view === 'done' || view === 'archived')
          ? { key: SORT_KEY, dir: 'DESC', pinnedFirst: false }
          : // Los chats sin mensajes (los que trae el historial de WhatsApp antes que sus mensajes) van al final.
            { key: SORT_KEY, dir: 'DESC', pinnedFirst: true };
  const limit = Math.min(Math.max(opts.limit ?? 300, 1), 1000);
  const cursor = decodeListCursor(opts.cursor);
  // `+` saca al índice del orden: el motor filtra por los ids de la carpeta y ordena ese conjunto.
  const ownerSql = smallSet ? '+t.owner_id = ?' : 't.owner_id = ?';
  const orderSql = `${smallSet ? '+' : ''}${mode.key} ${mode.dir}, t.id ${mode.dir}`;
  const select = `SELECT ${LIST_COLS}, ${mode.key} AS sort_key,
         (SELECT group_concat(folder_id) FROM inbox_thread_folders f WHERE f.thread_id = t.id) AS folder_ids,
         (SELECT COUNT(*) FROM inbox_scheduled s WHERE s.thread_id = t.id AND s.status IN ('pending','failed','missed')) AS scheduled_count,
         CASE WHEN t.last_kind IN ('image', 'video') THEN (SELECT m.id FROM inbox_messages m WHERE m.thread_id = t.id AND m.hidden_at IS NULL ORDER BY m.sent_at DESC LIMIT 1) END AS last_media_id,
         CASE WHEN t.channel = 'whatsapp' AND t.kind != 'group' THEN (SELECT a.read_receipts FROM inbox_accounts a WHERE a.id = t.account_id) END AS account_receipts
       FROM inbox_threads t`;
  type Row = ThreadRow & { folder_ids: string | null; scheduled_count: number; sort_key: string | null };
  const db = getDb();
  const base = [ownerSql, ...where];
  // Los fijados son pocos: se leen por su índice (sin él, el motor recorre la bandeja entera buscándolos).
  const pinned =
    mode.pinnedFirst && !cursor
      ? ((await db
          .prepare(
            `${select} INDEXED BY idx_inbox_threads_pinned WHERE ${['t.owner_id = ?', ...where, 't.pinned_at IS NOT NULL'].join(' AND ')} ORDER BY ${mode.key} ${mode.dir}, t.id ${mode.dir} LIMIT ${MAX_PINNED}`,
          )
          .all(owner, ...args)) as unknown as Row[])
      : [];
  const rest = [...base];
  const restArgs: Array<string | number> = [owner, ...args];
  if (mode.pinnedFirst) rest.push('t.pinned_at IS NULL');
  if (cursor) {
    // (clave, id) después del cursor. El primer término deja que el índice arranque en la clave.
    const op = mode.dir === 'DESC' ? '<' : '>';
    rest.push(`${mode.key} ${op}= ?`, `(${mode.key} ${op} ? OR t.id ${op} ?)`);
    restArgs.push(cursor.k, cursor.k, cursor.id);
  }
  const rows = (await db.prepare(`${select} WHERE ${rest.join(' AND ')} ORDER BY ${orderSql} LIMIT ${limit + 1}`).all(...restArgs)) as unknown as Row[];
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    threads: await withPreviewMentions(owner, [...pinned, ...page].map((r) => threadDto(r, now))),
    next: more && last && last.sort_key != null ? encodeListCursor({ k: String(last.sort_key), id: last.id }) : null,
    pinned: pinned.length,
  };
}

/** Chat 1:1 de WhatsApp guardado por lid (sin teléfono a la vista). */
function lidThread(r: Pick<ThreadRow, 'channel' | 'kind' | 'external_id'>): boolean {
  return r.channel === 'whatsapp' && r.kind === 'dm' && /@lid$/i.test(r.external_id);
}

/** El lid (dígitos) de cada chat por lid armado acá: no viaja a la pantalla, solo lo usa withLidTitles. */
const LID_OF = new WeakMap<ThreadDto, string>();

export function threadDto(
  r: ThreadRow & { folder_ids?: string | null; scheduled_count?: number; last_media_id?: string | null; account_receipts?: string | null },
  now = new Date(),
): ThreadDto {
  const snoozed = r.snoozed_until && r.snoozed_until > now.toISOString() ? r.snoozed_until : null;
  const dto: ThreadDto = {
    id: r.id,
    accountId: r.account_id,
    channel: r.channel,
    kind: r.kind,
    // Un grupo sin asunto todavía queda vacío (la pantalla muestra "Grupo"), nunca el id crudo. Un chat por lid
    // ("…@lid", el id anónimo de WhatsApp) nunca muestra sus dígitos como si fueran un teléfono: withLidTitles le
    // pone el nombre de la libreta o "Contacto de WhatsApp".
    title: lidThread(r) ? (/^\+?\d+$/.test(r.title) ? '' : r.title) : r.title || r.handle || (r.kind === 'group' ? '' : r.external_id.replace(/@.*/, '')),
    handle: lidThread(r) ? '' : r.handle,
    preview: r.preview,
    lastMessageAt: r.last_message_at,
    lastFromMe: r.last_from_me === 1,
    unread: Number(r.unread),
    pinned: !!r.pinned_at,
    done: !!r.done_at,
    archived: !!r.archived_at,
    keepArchived: r.keep_archived === 1,
    snoozedUntil: snoozed,
    woke: r.woke_at && (r.woke_reason === 'snooze' || r.woke_reason === 'followup') ? r.woke_reason : '',
    wokeAt: r.woke_at && (r.woke_reason === 'snooze' || r.woke_reason === 'followup') ? r.woke_at : null,
    followUpAt: r.follow_up_at,
    mutedUntil: r.muted_until && r.muted_until > now.toISOString() ? r.muted_until : null,
    draft: r.draft,
    folderIds: r.folder_ids ? String(r.folder_ids).split(',') : [],
    scheduledCount: Number(r.scheduled_count ?? 0),
    avatar: r.avatar_url ? `/api/inbox/avatar/${r.id}?v=${avatarVersion(r.avatar_url)}` : '',
    lastSender: r.last_sender ?? '',
    lastKind: r.last_kind ?? '',
    lastStatus: r.last_status ?? '',
    // 1:1 con las confirmaciones de lectura apagadas en el teléfono: solo cambia la explicación de las tildes
    // azules (el estado sigue siendo el real; lib/wa-privacy.ts).
    ...(r.channel === 'whatsapp' && readHiddenInWhatsapp(r.account_receipts, r.kind === 'group') ? { readHidden: true } : {}),
    presence: presenceOf(r, now),
    presenceWho: r.presence_who ?? '',
    lastSeenAt: r.last_seen_at ?? null,
    lastMediaId: r.last_media_id ?? null,
    ...(r.history_gap_at ? { historyGap: true } : {}),
  };
  if (lidThread(r)) LID_OF.set(dto, r.external_id.slice(0, r.external_id.indexOf('@')));
  return dto;
}

export async function getThread(owner: string, id: string): Promise<ThreadDto> {
  const r = (await getDb()
    .prepare(
      `SELECT t.*,
         (SELECT group_concat(folder_id) FROM inbox_thread_folders f WHERE f.thread_id = t.id) AS folder_ids,
         (SELECT COUNT(*) FROM inbox_scheduled s WHERE s.thread_id = t.id AND s.status IN ('pending','failed','missed')) AS scheduled_count,
         CASE WHEN t.last_kind IN ('image', 'video') THEN (SELECT m.id FROM inbox_messages m WHERE m.thread_id = t.id AND m.hidden_at IS NULL ORDER BY m.sent_at DESC LIMIT 1) END AS last_media_id,
         CASE WHEN t.channel = 'whatsapp' AND t.kind != 'group' THEN (SELECT a.read_receipts FROM inbox_accounts a WHERE a.id = t.account_id) END AS account_receipts
       FROM inbox_threads t WHERE t.id = ? AND t.owner_id = ? AND t.removed_at IS NULL`,
    )
    .get(id, owner)) as (ThreadRow & { folder_ids: string | null; scheduled_count: number }) | undefined;
  if (!r) throw new InboxError('not_found', 404);
  return (await withPreviewMentions(owner, [threadDto(r)]))[0];
}

/**
 * La vista previa de los chats de WhatsApp con "@Nombre" en lugar de
 * "@<dígitos>" (teléfono o lid), con la libreta de la cuenta.
 */
async function withPreviewMentions(owner: string, threads: ThreadDto[]): Promise<ThreadDto[]> {
  await withPresenceNames(threads).catch(() => null);
  await withLidTitles(owner, threads).catch(() => null);
  await withContactPictures(threads).catch(() => null);
  const items = threads.map((t) => ({ accountId: t.channel === 'whatsapp' && t.preview.includes('@') ? t.accountId : '', text: t.preview }));
  if (!items.some((i) => i.accountId)) return threads;
  const { mentionSelf, resolveTextMentions, someoneWord } = await import('../wa-contacts');
  const texts = await resolveTextMentions('inbox', items, { someone: () => someoneWord(owner), self: mentionSelf('inbox', owner) }).catch(() => items.map((i) => i.text));
  threads.forEach((t, i) => (t.preview = texts[i]));
  return threads;
}

/**
 * Chats 1:1 guardados por lid y sin nombre: el de la libreta de la cuenta (por lid) o, si no se conoce,
 * "Contacto de WhatsApp" en el idioma de la persona. Solo los de la página sin título: una consulta por cuenta.
 */
async function withLidTitles(owner: string, threads: ThreadDto[]): Promise<void> {
  const list = threads.filter((t) => !t.title && LID_OF.has(t));
  if (!list.length) return;
  const { displayName, lookupContacts } = await import('../wa-contacts');
  const byAccount = new Map<string, ThreadDto[]>();
  for (const t of list) byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t]);
  let fallback: string | null = null;
  for (const [accountId, rows] of byAccount) {
    const book = await lookupContacts({ app: 'inbox', accountId }, rows.map((t) => LID_OF.get(t)!)).catch(() => new Map());
    for (const t of rows) {
      const name = displayName(book.get(LID_OF.get(t)!));
      t.title = name || (fallback ??= await import('../groups').then((g) => g.lidChatName(owner)).catch(() => 'WhatsApp contact'));
    }
  }
}

/**
 * La foto de un chat 1:1 de WhatsApp: la guardada de la persona en la libreta (lib/wa-contact-pictures.ts,
 * copia nuestra que no vence) y, si no hay, la del chat (/api/inbox/avatar). Una consulta por cuenta.
 */
export async function withContactPictures(threads: ThreadDto[]): Promise<void> {
  const dms = threads.filter((t) => t.channel === 'whatsapp' && t.kind === 'dm' && /^\d{5,20}$/.test(t.handle));
  if (!dms.length) return;
  const { contactPictures, dmAvatar } = await import('../wa-contact-pictures');
  const byAccount = new Map<string, ThreadDto[]>();
  for (const t of dms) byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t]);
  for (const [accountId, list] of byAccount) {
    const pics = await contactPictures({ app: 'inbox', accountId }, list.map((t) => t.handle));
    for (const t of list) t.avatar = dmAvatar(pics.get(t.handle), t.avatar);
  }
}

/**
 * Quién escribe o graba en un grupo, como WhatsApp ("Andrés está escribiendo…"): el nombre de la
 * libreta de la cuenta, por teléfono o por lid ("<dígitos>@lid"). Sin nombre queda vacío y la pantalla
 * muestra el teléfono si lo hay. Solo los grupos con alguien escribiendo ahora (pocos): una consulta por cuenta.
 */
async function withPresenceNames(threads: ThreadDto[]): Promise<void> {
  const key = (who: string) => who.replace(/@lid$/, '');
  const live = threads.filter((t) => t.kind === 'group' && (t.presence === 'typing' || t.presence === 'recording') && /^\d{5,20}$/.test(key(t.presenceWho)));
  if (!live.length) return;
  const { displayName, lookupContacts } = await import('../wa-contacts');
  const byAccount = new Map<string, ThreadDto[]>();
  for (const t of live) byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t]);
  for (const [accountId, list] of byAccount) {
    const rows = await lookupContacts({ app: 'inbox', accountId }, list.map((t) => key(t.presenceWho)));
    for (const t of list) {
      const r = rows.get(key(t.presenceWho));
      t.presenceName = displayName(r);
      // Un lid que la libreta conoce con teléfono: la pantalla muestra ese teléfono si no hay nombre.
      if (!t.presenceName && r?.phone && t.presenceWho.endsWith('@lid')) t.presenceWho = r.phone;
    }
  }
}

interface MessageRow {
  id: string;
  from_me: number;
  sender_name: string;
  sender_handle: string;
  subject: string;
  body: string;
  email_to: string;
  media_type: string;
  media_name: string;
  media_ref: string;
  status: string;
  edited: number;
  revoked_at: string | null;
  sent_at: string;
  reply_to?: string;
  meta?: string;
  reactions?: string;
  forwarded?: number;
  starred_at?: string | null;
}

/** Meta para el navegador: la imagen grande del link va por la ruta del mensaje, sin la clave ni los bytes. */
function publicMeta(meta: WaMessageMeta | null, id: string): WaMessageMeta | null {
  if (!meta?.link) return meta;
  return { ...meta, link: publicLink(meta.link, `/api/inbox/media/${id}?link=1`) };
}

function parseJson<T>(raw: string | undefined | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function messageDto(r: MessageRow, reply: MessageQuote | null = null): MessageDto {
  const reactions = parseJson<MessageReaction[]>(r.reactions);
  return {
    reply,
    reactions: Array.isArray(reactions) ? reactions.filter((x) => x && typeof x.emoji === 'string' && x.emoji) : [],
    forwarded: r.forwarded === 1,
    starred: !!r.starred_at,
    meta: publicMeta(parseJson<WaMessageMeta>(r.meta), r.id),
    id: r.id,
    fromMe: r.from_me === 1,
    senderName: r.sender_name,
    senderHandle: r.sender_handle,
    subject: r.subject,
    body: r.body,
    emailTo: r.email_to,
    mediaType: r.media_type,
    mediaName: r.media_name,
    hasMedia: !!r.media_ref,
    status: r.status,
    edited: r.edited === 1,
    revoked: !!r.revoked_at,
    sentAt: r.sent_at,
  };
}

/** Cursor de una página de mensajes: "<sent_at>~<rowid>" del más viejo que se tiene. */
function messageCursor(r: { sent_at: string; rid?: number | null } | undefined): string | null {
  return r && r.rid != null ? `${r.sent_at}~${r.rid}` : null;
}

export interface MessagePage {
  messages: MessageDto[];
  more: boolean;
  /** Para pedir la página anterior (?before=): el mensaje más viejo de esta. */
  cursor: string | null;
}

/**
 * Los últimos `limit` mensajes (o los anteriores a `before`), en orden
 * cronológico. `before` es el cursor de la página anterior ("<sent_at>~<rowid>":
 * varios mensajes en el mismo segundo no se saltean ni se repiten); también
 * acepta una fecha sola. Lo nuevo que llega mientras se sube no mueve las páginas.
 */
export async function listMessages(owner: string, threadId: string, opts: { before?: string; limit?: number; around?: string } = {}): Promise<MessagePage> {
  const thread = await getThreadRow(owner, threadId);
  const page = await messagePage(owner, threadId, opts);
  if (thread.channel === 'whatsapp') {
    await withMentionNames(thread.account_id, page.messages).catch(() => null);
    // Tarjetas de contacto: la foto de cada persona, si está guardada.
    const { withCardPictures } = await import('../wa-contact-pictures');
    await withCardPictures({ app: 'inbox', accountId: thread.account_id }, page.messages.map((m) => m.meta?.contacts)).catch(() => null);
  }
  return page;
}

/**
 * Cada mensaje con "@<dígitos>" lleva a quién menciona (nombre y teléfono,
 * de la libreta de la cuenta): la pantalla lo muestra como "@Nombre".
 */
async function withMentionNames(accountId: string, messages: MessageDto[]): Promise<void> {
  const { inboxMentions } = await import('./wa-names');
  // También el texto citado de una respuesta (con la lista de mencionados del mensaje citado, si está en la página).
  const byId = new Map(messages.map((m) => [m.id, m]));
  const quoteOf = (m: MessageDto) => (m.reply?.body.includes('@') ? { body: m.reply.body, meta: { mentions: byId.get(m.reply.id)?.meta?.mentions } } : null);
  const quotes = messages.map(quoteOf).filter((q): q is NonNullable<typeof q> => !!q);
  const map = await inboxMentions(accountId, [...messages, ...quotes]);
  if (!Object.keys(map).length) return;
  const { ownMentions } = await import('../wa-mentions');
  for (const m of messages) {
    if (m.body.includes('@')) {
      const own: MentionNames = ownMentions(map, { body: m.body, mentions: m.meta?.mentions });
      if (Object.keys(own).length) m.mentionNames = own;
    }
    const q = quoteOf(m);
    if (q && m.reply) {
      const own: MentionNames = ownMentions(map, { body: q.body, mentions: q.meta.mentions });
      if (Object.keys(own).length) m.reply = { ...m.reply, mentionNames: own };
    }
  }
}

async function messagePage(owner: string, threadId: string, opts: { before?: string; limit?: number; around?: string }): Promise<MessagePage> {
  type Row = MessageRow & { rid: number };
  if (opts.around) {
    // Ir a un mensaje (desde la búsqueda): 40 anteriores y todo lo que sigue hasta el más nuevo (con tope).
    const target = (await getDb().prepare('SELECT sent_at FROM inbox_messages WHERE id = ? AND thread_id = ? AND owner_id = ?').get(opts.around, threadId, owner)) as { sent_at: string } | undefined;
    if (target) {
      const older = (await getDb()
        .prepare('SELECT sent_at FROM inbox_messages WHERE thread_id = ? AND owner_id = ? AND sent_at < ? ORDER BY sent_at DESC LIMIT 1 OFFSET 39')
        .get(threadId, owner, target.sent_at)) as { sent_at: string } | undefined;
      const from = older?.sent_at ?? '';
      const rows = (await getDb()
        .prepare('SELECT *, rowid AS rid FROM inbox_messages WHERE thread_id = ? AND owner_id = ? AND hidden_at IS NULL AND sent_at >= ? ORDER BY sent_at ASC, rowid ASC LIMIT 3000')
        .all(threadId, owner, from)) as unknown as Row[];
      const quotes = await quotesFor(threadId, rows);
      return { messages: rows.map((r) => messageDto(r, r.reply_to ? (quotes.get(r.reply_to) ?? null) : null)), more: !!older, cursor: messageCursor(rows[0]) };
    }
  }
  const limit = Math.min(Math.max(opts.limit ?? 150, 1), 500);
  const [rawAt, rawRid] = (opts.before ?? '').split('~');
  const before = validIso(rawAt);
  const rid = rawRid && /^\d{1,15}$/.test(rawRid) ? Number(rawRid) : null;
  const where = ['thread_id = ?', 'owner_id = ?', 'hidden_at IS NULL'];
  const args: Array<string | number> = [threadId, owner];
  if (before && rid !== null) {
    where.push('sent_at <= ?', '(sent_at < ? OR rowid < ?)');
    args.push(before, before, rid);
  } else if (before) {
    where.push('sent_at < ?');
    args.push(before);
  }
  const rows = (await getDb()
    .prepare(`SELECT *, rowid AS rid FROM inbox_messages WHERE ${where.join(' AND ')} ORDER BY sent_at DESC, rowid DESC LIMIT ?`)
    .all(...args, limit + 1)) as unknown as Row[];
  const more = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const quotes = await quotesFor(threadId, page);
  return { messages: page.map((r) => messageDto(r, r.reply_to ? (quotes.get(r.reply_to) ?? null) : null)), more, cursor: messageCursor(page[0]) };
}

/** Los mensajes citados por las respuestas de una página (por id del proveedor, dentro del mismo chat). */
async function quotesFor(threadId: string, rows: MessageRow[]): Promise<Map<string, MessageQuote>> {
  const ids = [...new Set(rows.map((r) => r.reply_to).filter((x): x is string => !!x))].slice(0, 200);
  const out = new Map<string, MessageQuote>();
  if (!ids.length) return out;
  const found = (await getDb()
    .prepare(
      `SELECT id, external_id, from_me, sender_name, sender_handle, body, media_type, revoked_at FROM inbox_messages WHERE thread_id = ? AND external_id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(threadId, ...ids)) as Array<{ id: string; external_id: string; from_me: number; sender_name: string; sender_handle: string; body: string; media_type: string; revoked_at: string | null }>;
  for (const q of found) {
    out.set(q.external_id, {
      id: q.id,
      fromMe: q.from_me === 1,
      senderName: q.sender_name,
      senderHandle: q.sender_handle,
      body: q.revoked_at ? '' : q.body.slice(0, 300),
      mediaType: q.media_type,
    });
  }
  // Respuestas en privado (las mías o las que me mandaron): el citado es de un grupo de la misma cuenta.
  const missing = ids.filter((x) => !out.has(x));
  if (missing.length) {
    const other = (await getDb()
      .prepare(
        `SELECT m.id, m.external_id, m.from_me, m.sender_name, m.sender_handle, m.body, m.media_type, m.revoked_at, t.id AS chat_id, t.title AS chat_title
         FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id
         WHERE t.account_id = (SELECT account_id FROM inbox_threads WHERE id = ?) AND t.kind = 'group' AND m.external_id IN (${missing.map(() => '?').join(',')})
         LIMIT 200`,
      )
      .all(threadId, ...missing)) as Array<{ id: string; external_id: string; from_me: number; sender_name: string; sender_handle: string; body: string; media_type: string; revoked_at: string | null; chat_id: string; chat_title: string }>;
    for (const q of other) {
      out.set(q.external_id, {
        id: q.id,
        fromMe: q.from_me === 1,
        senderName: q.sender_name,
        senderHandle: q.sender_handle,
        body: q.revoked_at ? '' : q.body.slice(0, 300),
        mediaType: q.media_type,
        chat: { id: q.chat_id, title: q.chat_title },
      });
    }
  }
  return out;
}

/** ¿Ya está guardado el envío con este clientId en este chat? (índice único por chat y clientId). */
export async function sentWithClientId(owner: string, threadId: string, clientId: string | undefined): Promise<boolean> {
  if (!clientId) return false;
  return !!(await getDb().prepare('SELECT 1 AS ok FROM inbox_messages WHERE thread_id = ? AND client_id = ? AND owner_id = ?').get(threadId, clientId, owner));
}

export async function getMessageRow(owner: string, id: string): Promise<MessageRow & { thread_id: string; external_id: string }> {
  // El mensaje de un chat sacado de Inbox no se lee ni se toca hasta recuperar el chat.
  const r = (await getDb()
    .prepare('SELECT m.* FROM inbox_messages m WHERE m.id = ? AND m.owner_id = ? AND NOT EXISTS (SELECT 1 FROM inbox_threads t WHERE t.id = m.thread_id AND t.removed_at IS NOT NULL)')
    .get(id, owner)) as
    | (MessageRow & { thread_id: string; external_id: string })
    | undefined;
  if (!r) throw new InboxError('not_found', 404);
  return r;
}

export type ThreadAction =
  | { action: 'done' }
  | { action: 'undone' }
  | { action: 'read' }
  | { action: 'unread' }
  | { action: 'pin' }
  | { action: 'unpin' }
  | { action: 'archive' }
  | { action: 'unarchive' }
  /** Mantener archivado: prenderlo archiva el chat; apagarlo lo deja donde está. */
  | { action: 'keepArchived'; on: boolean }
  | { action: 'snooze'; until: string }
  | { action: 'unsnooze' }
  | { action: 'followUp'; at: string }
  | { action: 'clearFollowUp' }
  | { action: 'mute'; until: string | null }
  | { action: 'addFolder'; folderId: string }
  | { action: 'removeFolder'; folderId: string }
  | { action: 'seen' };

export function futureIso(raw: string, now: Date): string {
  const t = Date.parse(raw);
  if (!Number.isFinite(t) || t <= now.getTime() + 30_000) throw new InboxError('date_in_past', 400);
  if (t > now.getTime() + 3 * 365 * 86_400_000) throw new InboxError('invalid_input', 400);
  return new Date(t).toISOString();
}

/** El chat está pospuesto y fue el pospuesto el que lo archivó (columnas de inbox_threads). */
const SNOOZE_ARCHIVED = '(snoozed_until IS NOT NULL AND snooze_archived = 1)';

/** Una acción sobre uno o varios chats (todos de la persona; los ajenos se ignoran). Devuelve los ids que cambiaron. */
export async function applyThreadAction(owner: string, ids: string[], a: ThreadAction, now = new Date()): Promise<string[]> {
  const db = getDb();
  const nowS = nowIso(now);
  if (a.action === 'addFolder' || a.action === 'removeFolder') await getFolderRow(owner, a.folderId);
  const asked = [...new Set(ids)].slice(0, 500);
  if (!asked.length) return [];
  // Solo los chats de la persona: los ids ajenos se ignoran en silencio.
  const owned = (await db
    .prepare(`SELECT id FROM inbox_threads WHERE owner_id = ? AND removed_at IS NULL AND id IN (${asked.map(() => '?').join(',')})`)
    .all(owner, ...asked)) as Array<{ id: string }>;
  const unique = owned.map((r) => r.id);
  if (!unique.length) return [];
  let sql: string;
  let extra: Array<string | number | null> = [];
  switch (a.action) {
    case 'done':
      sql = 'done_at = ?, snoozed_until = NULL, snooze_archived = 0, woke_at = NULL, woke_reason = \'\', unread = 0';
      extra = [nowS];
      break;
    case 'undone':
      // Volver a la bandeja saca de Archivados venga de "hecho" o de "archivar" (y apaga "Mantener archivado").
      // Sacarlo de Archivados a mano cancela el pospuesto.
      sql = 'done_at = NULL, archived_at = NULL, keep_archived = 0, snoozed_until = NULL, snooze_archived = 0';
      break;
    case 'read':
      sql = 'unread = 0';
      break;
    case 'unread':
      sql = 'unread = CASE WHEN unread = 0 THEN 1 ELSE unread END';
      break;
    case 'pin':
      sql = 'pinned_at = COALESCE(pinned_at, ?)';
      extra = [nowS];
      break;
    case 'unpin':
      sql = 'pinned_at = NULL';
      break;
    case 'archive':
      // Como WhatsApp: archivar suelta el fijado.
      sql = 'archived_at = COALESCE(archived_at, ?), pinned_at = NULL';
      extra = [nowS];
      break;
    case 'unarchive':
      // Desarchivar a mano apaga "Mantener archivado" (en el mismo UPDATE: el trigger lo deja pasar) y cancela el pospuesto.
      sql = 'archived_at = NULL, done_at = NULL, keep_archived = 0, snoozed_until = NULL, snooze_archived = 0';
      break;
    case 'keepArchived':
      sql = a.on ? 'keep_archived = 1, archived_at = COALESCE(archived_at, ?), pinned_at = NULL' : 'keep_archived = 0';
      extra = a.on ? [nowS] : [];
      break;
    case 'snooze':
      // Posponer archiva el chat (queda en Archivados y en Pospuestos) hasta que vuelve. `snooze_archived` anota si
      // lo archivó el pospuesto: uno que ya estaba archivado o "hecho" queda como estaba.
      sql = `snooze_archived = CASE WHEN ${SNOOZE_ARCHIVED} OR (archived_at IS NULL AND done_at IS NULL) THEN 1 ELSE 0 END,
        archived_at = CASE WHEN archived_at IS NULL AND done_at IS NULL THEN ? ELSE archived_at END,
        snoozed_until = ?, woke_at = NULL, woke_reason = ''`;
      extra = [nowS, futureIso(a.until, now)];
      break;
    case 'unsnooze':
      // Cancelar el pospuesto (o Deshacer) deja el chat como estaba antes de posponerlo.
      sql = `archived_at = CASE WHEN ${SNOOZE_ARCHIVED} THEN NULL ELSE archived_at END, snoozed_until = NULL, snooze_archived = 0`;
      break;
    case 'followUp':
      sql = 'follow_up_at = ?, follow_up_since = ?';
      extra = [futureIso(a.at, now), nowS];
      break;
    case 'clearFollowUp':
      sql = 'follow_up_at = NULL, follow_up_since = NULL';
      break;
    case 'mute':
      sql = 'muted_until = ?';
      extra = [a.until === null ? null : futureIso(a.until, now)];
      break;
    case 'seen':
      sql = "woke_at = NULL, woke_reason = '', unread = 0";
      break;
    case 'addFolder': {
      for (const id of unique) {
        await db
          .prepare('INSERT OR IGNORE INTO inbox_thread_folders (thread_id, folder_id) SELECT id, ? FROM inbox_threads WHERE id = ? AND owner_id = ?')
          .run(a.folderId, id, owner);
      }
      return unique;
    }
    case 'removeFolder': {
      for (const id of unique) {
        await db
          .prepare('DELETE FROM inbox_thread_folders WHERE folder_id = ? AND thread_id IN (SELECT id FROM inbox_threads WHERE id = ? AND owner_id = ?)')
          .run(a.folderId, id, owner);
      }
      return unique;
    }
  }
  const marks = unique.map(() => '?').join(',');
  // "Mantener archivado" en un chat que no estaba en Archivados: lo archiva, también en WhatsApp.
  const toArchive =
    a.action === 'keepArchived' && a.on
      ? ((await db
          .prepare(`SELECT id FROM inbox_threads WHERE owner_id = ? AND channel = 'whatsapp' AND archived_at IS NULL AND done_at IS NULL AND id IN (${marks})`)
          .all(owner, ...unique)) as Array<{ id: string }>)
      : [];
  // Posponer y cancelar el pospuesto archivan o desarchivan solo algunos chats: los de WhatsApp se miran antes de cambiarlos.
  let snoozePush: string[] = [];
  if (a.action === 'snooze' || a.action === 'unsnooze') {
    const moved = a.action === 'snooze' ? 'archived_at IS NULL AND done_at IS NULL' : `${SNOOZE_ARCHIVED} AND archived_at IS NOT NULL`;
    snoozePush = ((await db
      .prepare(`SELECT id FROM inbox_threads WHERE owner_id = ? AND channel = 'whatsapp' AND ${moved} AND id IN (${marks})`)
      .all(owner, ...unique)) as Array<{ id: string }>).map((r) => r.id);
  }
  await db.prepare(`UPDATE inbox_threads SET ${sql}, updated_at = ? WHERE owner_id = ? AND id IN (${marks})`).run(...extra, nowS, owner, ...unique);
  if (toArchive.length) {
    const { requestArchivePush } = await import('../wa-archive-sync');
    await requestArchivePush('inbox', owner, toArchive.map((r) => r.id), true);
  }
  if (snoozePush.length) {
    const { requestArchivePush } = await import('../wa-archive-sync');
    await requestArchivePush('inbox', owner, snoozePush, a.action === 'snooze');
  }
  // Archivar o desarchivar también se manda a WhatsApp: después de responder y con reintentos (lib/wa-archive-sync.ts).
  // "Archivar" de la barra (antes "Hecho", acción 'done') y volver a la bandeja ('undone') también: para quien lo usa
  // es lo mismo que archivar, y el chat tiene que quedar igual en el teléfono.
  if (a.action === 'archive' || a.action === 'unarchive' || a.action === 'done' || a.action === 'undone') {
    const wa = (await db
      .prepare(`SELECT id FROM inbox_threads WHERE owner_id = ? AND channel = 'whatsapp' AND id IN (${marks})`)
      .all(owner, ...unique)) as Array<{ id: string }>;
    const { requestArchivePush } = await import('../wa-archive-sync');
    await requestArchivePush('inbox', owner, wa.map((r) => r.id), a.action === 'archive' || a.action === 'done');
  }
  return unique;
}

export async function saveDraft(owner: string, threadId: string, text: string): Promise<void> {
  const res = await getDb()
    .prepare('UPDATE inbox_threads SET draft = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND removed_at IS NULL')
    .run(text.slice(0, LIMITS.draft), nowIso(), threadId, owner);
  if (res.changes === 0) throw new InboxError('not_found', 404);
}

export async function saveNotes(owner: string, threadId: string, text: string): Promise<void> {
  const res = await getDb()
    .prepare('UPDATE inbox_threads SET notes = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND removed_at IS NULL')
    .run(text.slice(0, LIMITS.notes), nowIso(), threadId, owner);
  if (res.changes === 0) throw new InboxError('not_found', 404);
}

export async function renameThread(owner: string, threadId: string, title: string): Promise<void> {
  const clean = title.trim().slice(0, 200);
  if (!clean) throw new InboxError('invalid_input', 400);
  const res = await getDb().prepare('UPDATE inbox_threads SET title = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND removed_at IS NULL').run(clean, nowIso(), threadId, owner);
  if (res.changes === 0) throw new InboxError('not_found', 404);
}

/**
 * Contadores de la barra: no leídos de la bandeja, por responder, pospuestos, archivados y programados.
 * Cada uno sale de su índice (idx_inbox_threads_unread, _reply, _snoozed, _archived): no recorre los chats de la persona.
 */
export async function inboxCounts(owner: string, now = new Date()): Promise<Record<string, number>> {
  const nowS = now.toISOString();
  const r = (await getDb()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM inbox_threads INDEXED BY idx_inbox_threads_unread WHERE owner_id = ? AND removed_at IS NULL AND unread > 0 AND done_at IS NULL AND archived_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= ?)) AS inbox,
         (SELECT COUNT(*) FROM inbox_threads INDEXED BY idx_inbox_threads_reply WHERE owner_id = ? AND removed_at IS NULL AND done_at IS NULL AND archived_at IS NULL AND last_from_me = 0 AND kind <> 'group' AND last_message_at IS NOT NULL
            AND (snoozed_until IS NULL OR snoozed_until <= ?)) AS reply,
         (SELECT COUNT(*) FROM inbox_threads WHERE owner_id = ? AND snoozed_until > ? AND removed_at IS NULL) AS snoozed,
         (SELECT COUNT(*) FROM inbox_threads WHERE owner_id = ? AND (archived_at IS NOT NULL OR done_at IS NOT NULL) AND removed_at IS NULL) AS archived,
         (SELECT COUNT(*) FROM inbox_scheduled s WHERE s.owner_id = ? AND s.status IN ('pending','failed','missed')
            AND NOT EXISTS (SELECT 1 FROM inbox_threads t WHERE t.id = s.thread_id AND t.removed_at IS NOT NULL)) AS scheduled,
         (SELECT COUNT(*) FROM inbox_threads WHERE owner_id = ? AND removed_at IS NOT NULL) AS removed`
    )
    .get(owner, nowS, owner, nowS, owner, nowS, owner, owner, owner)) as
    | { inbox: number | null; reply: number | null; snoozed: number | null; archived: number | null; scheduled: number | null; removed: number | null }
    | undefined;
  return {
    inbox: Number(r?.inbox ?? 0),
    reply: Number(r?.reply ?? 0),
    snoozed: Number(r?.snoozed ?? 0),
    archived: Number(r?.archived ?? 0),
    scheduled: Number(r?.scheduled ?? 0),
    removed: Number(r?.removed ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Carpetas (splits)
// ---------------------------------------------------------------------------

interface FolderRow {
  id: string;
  owner_id: string;
  name: string;
  color: string;
  icon: string;
  position: number;
  parent_id: string | null;
  rule: string;
}

function parseRuleText(raw: string): FolderRule | null {
  if (!raw) return null;
  try {
    return parseRule(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Condiciones SQL de las reglas de todas las carpetas de la persona. */
async function folderRules(owner: string): Promise<Array<{ sql: string; args: string[] }>> {
  const rows = (await getDb().prepare("SELECT rule FROM inbox_folders WHERE owner_id = ? AND rule <> ''").all(owner)) as Array<{ rule: string }>;
  return rows.map((f) => ruleSql(parseRuleText(f.rule))).filter((r): r is NonNullable<typeof r> => r !== null);
}

async function getFolderRow(owner: string, id: string): Promise<FolderRow> {
  const r = (await getDb().prepare('SELECT * FROM inbox_folders WHERE id = ? AND owner_id = ?').get(id, owner)) as FolderRow | undefined;
  if (!r) throw new InboxError('not_found', 404);
  return r;
}

/** Como LIKE de SQLite: sin distinguir mayúsculas en ASCII. */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** ¿El chat cumple la regla de la carpeta? Lo mismo que ruleSql (LIKE de SQLite), sobre una fila ya leída: el contador y la lista coinciden. */
function matchesRuleSql(rule: FolderRule | null, t: { channel: string; kind: string; title: string; handle: string }): boolean {
  if (!rule) return false;
  let any = false;
  if (rule.channel) {
    if (t.channel !== rule.channel) return false;
    any = true;
  }
  if (rule.kind) {
    if (t.kind !== rule.kind) return false;
    any = true;
  }
  if (rule.from) {
    const needle = asciiLower(rule.from);
    if (!asciiLower(t.title).includes(needle) && !asciiLower(t.handle).includes(needle)) return false;
    any = true;
  }
  return any;
}

/** Tope de chats sin leer que se miran para los contadores de carpetas (el contador muestra 99+). */
const MAX_UNREAD_SCAN = 5000;

export async function listFolders(owner: string, now = new Date()): Promise<FolderDto[]> {
  return (await folderOverview(owner, now)).folders;
}

/**
 * Las carpetas con sus no leídos y, aparte, los no leídos de "Sin carpeta"
 * (chats de la bandeja que no están en ninguna, ni por regla). Sin carpetas,
 * "Sin carpeta" no se muestra: cuenta 0.
 */
export async function folderOverview(owner: string, now = new Date()): Promise<{ folders: FolderDto[]; noFolderUnread: number }> {
  const db = getDb();
  const rows = (await db.prepare('SELECT * FROM inbox_folders WHERE owner_id = ? ORDER BY position, created_at').all(owner)) as unknown as FolderRow[];
  if (!rows.length) return { folders: [], noFolderUnread: 0 };
  const nowS = now.toISOString();
  // Chats sin leer de la bandeja, una sola consulta (índice idx_inbox_threads_unread), con sus carpetas a mano.
  // Las reglas se evalúan acá sobre esas filas; después los no leídos suben a los padres sin repetir.
  const unread = (await db
    .prepare(
      `SELECT t.id, t.channel, t.kind, t.title, t.handle,
         (SELECT group_concat(folder_id) FROM inbox_thread_folders f WHERE f.thread_id = t.id) AS folder_ids
       FROM inbox_threads t INDEXED BY idx_inbox_threads_unread
       WHERE t.owner_id = ? AND t.removed_at IS NULL AND t.unread > 0 AND t.done_at IS NULL AND t.archived_at IS NULL AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?) LIMIT ${MAX_UNREAD_SCAN}`,
    )
    .all(owner, nowS)) as Array<{ id: string; channel: string; kind: string; title: string; handle: string; folder_ids: string | null }>;
  const own = new Map<string, Set<string>>();
  const add = (folderId: string, threadId: string) => {
    const set = own.get(folderId);
    if (set) set.add(threadId);
    else own.set(folderId, new Set([threadId]));
  };
  const rules = rows.map((f) => ({ id: f.id, rule: parseRuleText(f.rule) })).filter((f) => f.rule !== null);
  const ids = new Set(rows.map((f) => f.id));
  let loose = 0;
  for (const t of unread) {
    let filed = false;
    if (t.folder_ids)
      for (const fid of String(t.folder_ids).split(',')) {
        add(fid, t.id);
        if (ids.has(fid)) filed = true;
      }
    for (const f of rules)
      if (matchesRuleSql(f.rule, t)) {
        add(f.id, t.id);
        filed = true;
      }
    if (!filed) loose++;
  }
  const tree = rows.map((f) => ({ id: f.id, parentId: f.parent_id, position: f.position }));
  const total = rollupUnread(tree, own);
  const folders = rows.map((f) => ({
    id: f.id,
    name: f.name,
    color: f.color,
    icon: f.icon,
    position: f.position,
    parentId: f.parent_id,
    rule: parseRuleText(f.rule),
    count: total.get(f.id) ?? 0,
    ownCount: own.get(f.id)?.size ?? 0,
  }));
  return { folders, noFolderUnread: loose };
}

async function folderTree(owner: string) {
  const rows = (await getDb().prepare('SELECT id, parent_id, position FROM inbox_folders WHERE owner_id = ?').all(owner)) as Array<{ id: string; parent_id: string | null; position: number }>;
  return rows.map((r) => ({ id: r.id, parentId: r.parent_id, position: Number(r.position) }));
}

export interface FolderInput {
  name?: string;
  color?: string;
  icon?: string;
  parentId?: string | null;
  rule?: FolderRule | null;
}

function cleanColor(c: string | undefined): string {
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : '';
}

export async function createFolder(owner: string, input: FolderInput): Promise<FolderDto> {
  const name = (input.name ?? '').trim().slice(0, LIMITS.folderName);
  if (!name) throw new InboxError('invalid_input', 400);
  const db = getDb();
  const count = (await db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS maxp FROM inbox_folders WHERE owner_id = ?').get(owner)) as { n: number; maxp: number };
  if (Number(count.n) >= LIMITS.folders) throw new InboxError('too_many', 400);
  if (input.parentId) {
    await getFolderRow(owner, input.parentId);
    if (depthOf(await folderTree(owner), input.parentId) + 1 > MAX_FOLDER_DEPTH) throw new InboxError('too_deep', 400);
  }
  const id = newId('ibf');
  const now = nowIso();
  await db
    .prepare('INSERT INTO inbox_folders (id, owner_id, name, color, icon, position, parent_id, rule, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, owner, name, cleanColor(input.color), (input.icon ?? '').slice(0, 8), Number(count.maxp) + 1, input.parentId ?? null, input.rule ? JSON.stringify(input.rule) : '', now, now);
  return (await listFolders(owner)).find((f) => f.id === id)!;
}

export async function updateFolder(owner: string, id: string, input: FolderInput & { position?: number }): Promise<void> {
  const f = await getFolderRow(owner, id);
  const db = getDb();
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, LIMITS.folderName);
    if (!name) throw new InboxError('invalid_input', 400);
    sets.push('name = ?');
    args.push(name);
  }
  if (input.color !== undefined) {
    sets.push('color = ?');
    args.push(cleanColor(input.color));
  }
  if (input.icon !== undefined) {
    sets.push('icon = ?');
    args.push(input.icon.slice(0, 8));
  }
  if (input.rule !== undefined) {
    sets.push('rule = ?');
    args.push(input.rule ? JSON.stringify(input.rule) : '');
  }
  if (input.position !== undefined) {
    sets.push('position = ?');
    args.push(Math.max(0, Math.floor(input.position)));
  }
  if (input.parentId !== undefined && input.parentId !== f.parent_id) {
    // Ni dentro de sí misma, ni de sus subcarpetas, ni más hondo que el tope.
    const check = canMoveFolder(await folderTree(owner), f.id, input.parentId);
    if (check !== 'ok') throw new InboxError(check, 400);
    sets.push('parent_id = ?');
    args.push(input.parentId);
  }
  if (!sets.length) return;
  await db.prepare(`UPDATE inbox_folders SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND owner_id = ?`).run(...args, nowIso(), id, owner);
}

export async function reorderFolders(owner: string, ids: string[]): Promise<void> {
  const db = getDb();
  let i = 0;
  for (const id of ids.slice(0, LIMITS.folders)) {
    await db.prepare('UPDATE inbox_folders SET position = ? WHERE id = ? AND owner_id = ?').run(i++, id, owner);
  }
}

/**
 * Mueve una carpeta: dentro de `parentId` (null = primer nivel), antes de
 * `beforeId` (null = al final). Reordena a los hermanos del destino.
 */
export async function moveFolder(owner: string, id: string, parentId: string | null, beforeId: string | null): Promise<void> {
  const f = await getFolderRow(owner, id);
  const tree = await folderTree(owner);
  const check = canMoveFolder(tree, id, parentId);
  if (check !== 'ok') throw new InboxError(check, 400);
  if (beforeId && !tree.some((x) => x.id === beforeId && (x.parentId ?? null) === parentId)) beforeId = null;
  const db = getDb();
  const now = nowIso();
  if ((f.parent_id ?? null) !== parentId) await db.prepare('UPDATE inbox_folders SET parent_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?').run(parentId, now, id, owner);
  const moved = tree.map((x) => (x.id === id ? { ...x, parentId } : x));
  for (const [sid, pos] of siblingOrder(moved, id, parentId, beforeId)) {
    await db.prepare('UPDATE inbox_folders SET position = ? WHERE id = ? AND owner_id = ? AND position <> ?').run(pos, sid, owner, pos);
  }
}

/** Las subcarpetas suben un nivel; los chats no se borran. */
export async function deleteFolder(owner: string, id: string): Promise<void> {
  const f = await getFolderRow(owner, id);
  const db = getDb();
  await db.prepare('UPDATE inbox_folders SET parent_id = ? WHERE parent_id = ? AND owner_id = ?').run(f.parent_id, id, owner);
  await db.prepare('DELETE FROM inbox_folders WHERE id = ? AND owner_id = ?').run(id, owner);
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

export async function listSnippets(owner: string): Promise<SnippetDto[]> {
  const rows = (await getDb().prepare('SELECT id, shortcut, title, body FROM inbox_snippets WHERE owner_id = ? ORDER BY title COLLATE NOCASE').all(owner)) as unknown as SnippetDto[];
  return rows.map((r) => ({ id: r.id, shortcut: r.shortcut, title: r.title, body: r.body }));
}

export async function createSnippet(owner: string, input: { title: string; body: string; shortcut?: string }): Promise<SnippetDto> {
  const title = input.title.trim().slice(0, LIMITS.snippetTitle);
  const body = input.body.slice(0, LIMITS.snippetBody);
  if (!title || !body.trim()) throw new InboxError('invalid_input', 400);
  const db = getDb();
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM inbox_snippets WHERE owner_id = ?').get(owner)) as { n: number };
  if (Number(n.n) >= LIMITS.snippets) throw new InboxError('too_many', 400);
  const id = newId('ibs');
  const now = nowIso();
  const shortcut = cleanShortcut(input.shortcut ?? '');
  await db.prepare('INSERT INTO inbox_snippets (id, owner_id, shortcut, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, owner, shortcut, title, body, now, now);
  return { id, shortcut, title, body };
}

export async function updateSnippet(owner: string, id: string, input: { title?: string; body?: string; shortcut?: string }): Promise<void> {
  const sets: string[] = [];
  const args: string[] = [];
  if (input.title !== undefined) {
    const t = input.title.trim().slice(0, LIMITS.snippetTitle);
    if (!t) throw new InboxError('invalid_input', 400);
    sets.push('title = ?');
    args.push(t);
  }
  if (input.body !== undefined) {
    if (!input.body.trim()) throw new InboxError('invalid_input', 400);
    sets.push('body = ?');
    args.push(input.body.slice(0, LIMITS.snippetBody));
  }
  if (input.shortcut !== undefined) {
    sets.push('shortcut = ?');
    args.push(cleanShortcut(input.shortcut));
  }
  if (!sets.length) return;
  const res = await getDb().prepare(`UPDATE inbox_snippets SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND owner_id = ?`).run(...args, nowIso(), id, owner);
  if (res.changes === 0) throw new InboxError('not_found', 404);
}

export async function deleteSnippet(owner: string, id: string): Promise<void> {
  const res = await getDb().prepare('DELETE FROM inbox_snippets WHERE id = ? AND owner_id = ?').run(id, owner);
  if (res.changes === 0) throw new InboxError('not_found', 404);
}

// ---------------------------------------------------------------------------
// Envíos programados
// ---------------------------------------------------------------------------

export interface ScheduledRow {
  id: string;
  owner_id: string;
  thread_id: string;
  body: string;
  send_at: string;
  status: ScheduledStatus;
  error: string;
  batch_id: string;
  seq: number;
  delay_s: number;
  media_url: string;
  media_name: string;
  media_type: string;
  /** 'voice': el archivo sale como nota de voz. */
  media_kind: string;
  media_duration: number;
  /** Mensaje (nuestro id) que cita. */
  reply_to: string;
}

export async function listScheduled(owner: string, threadId?: string): Promise<ScheduledDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT s.*, t.title AS thread_title, t.handle AS thread_handle, t.channel AS channel FROM inbox_scheduled s JOIN inbox_threads t ON t.id = s.thread_id
       WHERE s.owner_id = ? ${threadId ? 'AND s.thread_id = ?' : ''} AND t.removed_at IS NULL AND s.status IN ('pending','sending','failed','missed')
       ORDER BY s.send_at, s.seq LIMIT 500`,
    )
    .all(...(threadId ? [owner, threadId] : [owner]))) as Array<ScheduledRow & { thread_title: string; thread_handle: string; channel: InboxChannel }>;
  return rows.map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    threadTitle: r.thread_title || r.thread_handle,
    channel: r.channel,
    body: r.body,
    sendAt: r.send_at,
    status: r.status,
    error: r.error,
    batchId: r.batch_id || r.id,
    seq: Number(r.seq ?? 0),
    delaySec: Number(r.delay_s ?? 0),
    mediaName: r.media_name ?? '',
    mediaType: r.media_type ?? '',
    mediaUrl: r.media_url ?? '',
    mediaVoice: r.media_kind === 'voice',
    mediaDuration: Number(r.media_duration ?? 0),
    replyTo: r.reply_to ?? '',
  }));
}

export async function createScheduled(owner: string, threadId: string, body: string, sendAt: string, now = new Date()): Promise<ScheduledDto> {
  await getThreadRow(owner, threadId);
  const text = body.trim().slice(0, LIMITS.message);
  if (!text) throw new InboxError('invalid_input', 400);
  const at = futureIso(sendAt, now);
  const id = newId('ibq');
  const nowS = nowIso(now);
  await getDb()
    .prepare("INSERT INTO inbox_scheduled (id, owner_id, thread_id, body, send_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)")
    .run(id, owner, threadId, text, at, nowS, nowS);
  return (await listScheduled(owner, threadId)).find((s) => s.id === id)!;
}

export async function updateScheduled(owner: string, id: string, input: { body?: string; sendAt?: string }, now = new Date()): Promise<void> {
  const sets: string[] = ["status = 'pending'", "error = ''"];
  const args: string[] = [];
  if (input.body !== undefined) {
    const text = input.body.trim().slice(0, LIMITS.message);
    if (!text) throw new InboxError('invalid_input', 400);
    sets.push('body = ?');
    args.push(text);
  }
  if (input.sendAt !== undefined) {
    sets.push('send_at = ?');
    args.push(futureIso(input.sendAt, now));
  }
  const res = await getDb()
    .prepare(`UPDATE inbox_scheduled SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND owner_id = ? AND status IN ('pending','failed','missed')`)
    .run(...args, nowIso(now), id, owner);
  if (res.changes === 0) throw new InboxError('not_found', 404);
}

export async function cancelScheduled(owner: string, id: string): Promise<void> {
  const res = await getDb()
    .prepare("UPDATE inbox_scheduled SET status = 'cancelled', updated_at = ? WHERE id = ? AND owner_id = ? AND status IN ('pending','failed','missed')")
    .run(nowIso(), id, owner);
  if (res.changes === 0) throw new InboxError('not_found', 404);
}

/**
 * Reclama un programado para mandarlo (compare-and-set: dos corridas nunca
 * mandan el mismo). `force` lo manda aunque no haya llegado la hora (Enviar ya).
 */
export async function claimScheduled(id: string, now: Date, force = false): Promise<ScheduledRow | null> {
  const nowS = nowIso(now);
  const res = await getDb()
    .prepare(
      `UPDATE inbox_scheduled SET status = 'sending', claimed_until = ?, updated_at = ?
       WHERE id = ? AND ${force ? "status IN ('pending','failed','missed')" : "status = 'pending' AND send_at <= ?"}`,
    )
    .run(...(force ? [new Date(now.getTime() + 5 * 60_000).toISOString(), nowS, id] : [new Date(now.getTime() + 5 * 60_000).toISOString(), nowS, id, nowS]));
  if (res.changes === 0) return null;
  return ((await getDb().prepare('SELECT * FROM inbox_scheduled WHERE id = ?').get(id)) as ScheduledRow | undefined) ?? null;
}

export async function finishScheduled(id: string, ok: boolean, error = ''): Promise<void> {
  const now = nowIso();
  await getDb()
    .prepare(`UPDATE inbox_scheduled SET status = ?, error = ?, sent_at = ?, claimed_until = NULL, updated_at = ? WHERE id = ?`)
    .run(ok ? 'sent' : 'failed', error.slice(0, 200), ok ? now : null, now, id);
}

export async function getScheduledOwned(owner: string, id: string): Promise<ScheduledRow> {
  const r = (await getDb().prepare('SELECT * FROM inbox_scheduled WHERE id = ? AND owner_id = ?').get(id, owner)) as ScheduledRow | undefined;
  if (!r) throw new InboxError('not_found', 404);
  return r;
}
