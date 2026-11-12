/**
 * Groups: importación de chats y mensajes al conectar un número (como
 * WhatsApp Web o Periskope al vincular). Lee el historial que el gateway ya
 * guardó (Evolution con base de datos) y lo trae en tandas:
 *
 *   groups → chats → contacts → messages → pictures → older → done
 *
 * - Por defecto trae TODO el historial que guardó el gateway, en dos
 *   pasadas: `messages` trae la página más nueva de cada chat (la bandeja
 *   queda usable enseguida, de los chats más recientes a los más viejos) y
 *   `older` sigue hacia atrás, página por página, hasta el principio de cada
 *   chat. La página de cada chat queda guardada (groups_import_chats.page):
 *   un timeout o una caída del gateway se retoma en el mismo punto.
 * - El tope real lo pone WhatsApp: un dispositivo vinculado solo recibe el
 *   historial que el teléfono le manda al vincular. Lo anterior no está en
 *   el gateway y no se puede traer.
 * - Con `per_chat` > 0 (elegido en "Reimportar") trae solo los últimos N de
 *   cada chat, como antes.
 * - Una fila por número en groups_imports con su fase y cursor. Cada tanda
 *   reclama la fila (compare-and-set en claimed_until) y corre con un tope
 *   de tiempo: el cron de cada minuto la retoma donde quedó, así sobrevive a
 *   los timeouts de las funciones serverless. `started_at` es la generación:
 *   si alguien reimporta a mitad de una tanda, esa tanda ya no escribe.
 * - Es idempotente: los mensajes tienen índice único por id del proveedor,
 *   los chats por id de chat del número.
 * - Lo importado no dispara nada: ni avisos, ni push, ni reglas, ni SLA, ni
 *   "sin responder", ni eventos de Flow o webhooks.
 * - Todo va por number_id y el workspace del número: nunca cruza a otro.
 *
 * Server-only.
 */
import { getDb } from './db';
import {
  applyReaction,
  getNumberRow,
  getNumberRowById,
  inboundMeta,
  insertMessage,
  lidChatName,
  previewOf,
  providerFor,
  providerErrorCode,
  refreshChatPreview,
  refreshMemberCount,
  upsertChat,
  type ChatRow,
  type IngestResult,
  type MessageRow,
  type NumberRow,
} from './groups';
import { isGroupJid, isLidJid, phoneDigits, type GroupsProvider, type InboundEvent } from './groups-provider';
import { parsePoll, pollPreview, voteOptions } from './groups-polls';
import { defaultBridgeFetch } from './groups-provider-bridge';
import { fillLinesNames, learnLinesContacts, learnLinesEvents } from './groups-wa-names';

export type ImportPhase = 'groups' | 'chats' | 'contacts' | 'messages' | 'pictures' | 'older' | 'done';
export type ImportState = 'queued' | 'running' | 'done' | 'error';

export interface ImportStatus {
  numberId: string;
  status: ImportState;
  phase: ImportPhase;
  chatsTotal: number;
  chatsDone: number;
  messages: number;
  perChat: number;
  error: string;
  startedAt: string;
  finishedAt: string | null;
}

interface ImportRow {
  number_id: string;
  user_id: string;
  status: ImportState;
  phase: ImportPhase;
  cursor: number;
  per_chat: number;
  chats_total: number;
  chats_done: number;
  messages: number;
  error: string;
  attempts: number;
  claimed_until: string | null;
  started_at: string;
  finished_at: string | null;
  updated_at: string;
}

/** Mensajes por chat que se traen: 0 es todo el historial (lo normal); si no, los últimos N, entre 10 y 500. */
export const IMPORT_ALL = 0;
export const IMPORT_PER_CHAT_OPTIONS = [IMPORT_ALL, 20, 50, 100, 200] as const;
export const IMPORT_PER_CHAT_DEFAULT = IMPORT_ALL;
/** Mensajes por página al recorrer todo el historial de un chat. */
export const HISTORY_PAGE = 100;
/** Páginas por chat como máximo (100 × 1000 = 100.000 mensajes). */
const MAX_PAGES_PER_CHAT = 1000;
/** Pausa entre páginas del historial viejo (no saturar al gateway). */
const OLDER_GAP_MS = 150;
const CHATS_PAGE = 100;
const CONTACTS_PAGE = 500;
const PICTURES_PAGE = 10;
/** Cuánto dura un claim (más que una tanda: si la función muere, otra la retoma después). */
const CLAIM_MS = 90_000;
const MAX_ATTEMPTS = 8;
/** Foto de perfil: tope de lo que se baja. */
const MAX_PICTURE = 1024 * 1024;

const nowIso = () => new Date().toISOString();

function toStatus(r: ImportRow): ImportStatus {
  return {
    numberId: r.number_id,
    status: r.status,
    phase: r.phase,
    chatsTotal: r.chats_total,
    chatsDone: r.chats_done,
    messages: r.messages,
    perChat: r.per_chat,
    error: r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export function clampPerChat(raw: unknown): number {
  if (raw === 'all') return IMPORT_ALL;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return IMPORT_PER_CHAT_DEFAULT;
  return Math.max(10, Math.min(500, n));
}

/** Los proveedores que tienen historial para importar. */
export function canImport(provider: string): boolean {
  return provider === 'managed' || provider === 'evolution';
}

/**
 * Pone en cola la importación de un número. `restart`: "Reimportar" (vuelve
 * a empezar aunque esté corriendo). Sin restart, solo si no hay una en curso.
 * Devuelve true si quedó una importación nueva en cola.
 */
export async function queueImport(
  number: Pick<NumberRow, 'id' | 'user_id' | 'provider'>,
  opts: { restart?: boolean; perChat?: number } = {},
): Promise<boolean> {
  if (!canImport(number.provider)) return false;
  const db = getDb();
  const now = nowIso();
  const perChat = clampPerChat(opts.perChat ?? IMPORT_PER_CHAT_DEFAULT);
  const existing = (await db.prepare('SELECT * FROM groups_imports WHERE number_id = ?').get(number.id)) as ImportRow | undefined;
  if (existing && !opts.restart && (existing.status === 'queued' || existing.status === 'running')) return false;
  // Los chats ya recorridos quedan anotados (complete): la corrida nueva los vuelve a mirar desde lo más nuevo y corta
  // al llegar a lo que ya tenía, en vez de recorrer todo el historial otra vez.
  await db.prepare('UPDATE groups_import_chats SET done = 0, page = 0 WHERE number_id = ?').run(number.id);
  await db
    .prepare(
      `INSERT INTO groups_imports (number_id, user_id, status, phase, cursor, per_chat, chats_total, chats_done, messages, error, attempts, claimed_until, started_at, finished_at, updated_at)
       VALUES (?, ?, 'queued', 'groups', 0, ?, 0, 0, 0, '', 0, NULL, ?, NULL, ?)
       ON CONFLICT(number_id) DO UPDATE SET status = 'queued', phase = 'groups', cursor = 0, per_chat = excluded.per_chat, chats_total = 0,
         chats_done = 0, messages = 0, error = '', attempts = 0, claimed_until = NULL, started_at = excluded.started_at, finished_at = NULL, updated_at = excluded.updated_at`,
    )
    .run(number.id, number.user_id, perChat, now, now);
  return true;
}

export async function getImportStatus(ws: string, numberId: string): Promise<ImportStatus | null> {
  const r = (await getDb().prepare('SELECT * FROM groups_imports WHERE number_id = ? AND user_id = ?').get(numberId, ws)) as ImportRow | undefined;
  return r ? toStatus(r) : null;
}

/** Importaciones del workspace en curso o recién terminadas (la bandeja muestra el progreso). */
export async function activeImports(ws: string, viewer?: import('./groups-access').GroupsViewer): Promise<ImportStatus[]> {
  const since = new Date(Date.now() - 2 * 60_000).toISOString();
  const rows = (await getDb()
    .prepare("SELECT * FROM groups_imports WHERE user_id = ? AND (status IN ('queued', 'running') OR (finished_at IS NOT NULL AND finished_at > ?))")
    .all(ws, since)) as ImportRow[];
  const { visibleNumberIds } = await import('./groups-access');
  const visible = await visibleNumberIds(viewer);
  return rows.filter((r) => !visible || visible.has(r.number_id)).map(toStatus);
}

/** Corre una tanda después de responder (o acá mismo si no hay request). */
export async function kickImport(numberId: string): Promise<void> {
  const job = () => runImportChunk(numberId, { budgetMs: 25_000 }).catch(() => null);
  try {
    const { after } = await import('next/server');
    after(job);
  } catch {
    await job();
  }
}

// ======================================================================
// Guardar historial (lo usan la importación y el webhook messages.set)
// ======================================================================

/** Nombre y foto de un contacto o grupo: completa lo que falta, nunca pisa un nombre puesto a mano. */
export async function applyContact(number: Pick<NumberRow, 'id' | 'user_id'>, ev: { chatId: string; name?: string; pictureUrl?: string }): Promise<void> {
  const db = getDb();
  const ids = [ev.chatId];
  // Un contacto con teléfono también nombra al chat que todavía es "@lid" (y al revés no se puede saber).
  const row = (await db
    .prepare(`SELECT id, name, kind, provider_chat_id FROM groups_chats WHERE number_id = ? AND provider_chat_id IN (${ids.map(() => '?').join(',')})`)
    .get(number.id, ...ids)) as Pick<ChatRow, 'id' | 'name' | 'kind' | 'provider_chat_id'> | undefined;
  if (!row || !ev.name) return;
  const lidNames = ['Contacto de WhatsApp', 'WhatsApp contact', 'Contato do WhatsApp'];
  if (row.kind === 'group' ? row.name !== ev.name && !row.name : !row.name || lidNames.includes(row.name)) {
    await db.prepare('UPDATE groups_chats SET name = ? WHERE id = ?').run(ev.name.slice(0, 200), row.id);
  }
  // Los nombres de las personas en los grupos donde participa (si no tenían).
  const phone = phoneDigits(ev.chatId);
  if (phone && !isGroupJid(ev.chatId)) {
    await db
      .prepare(
        `UPDATE groups_members SET name = ? WHERE phone = ? AND name = ''
           AND EXISTS (SELECT 1 FROM groups_chats c WHERE c.id = groups_members.chat_id AND c.number_id = ?)`,
      )
      .run(ev.name.slice(0, 120), phone, number.id);
  }
}

/**
 * Guarda eventos del historial sin efectos: ni avisos, ni reglas, ni SLA, ni
 * no leídos, ni eventos. Agrupa por chat para tocar cada chat una sola vez.
 */
export async function ingestHistory(number: NumberRow, incoming: InboundEvent[]): Promise<IngestResult> {
  const res: IngestResult = { messages: 0, duplicates: 0, ignored: 0 };
  // La libreta del número (nombres de perfil, lid ↔ teléfono) antes de guardar: quien vino solo con su lid sale con teléfono.
  const events = await learnLinesEvents(number, incoming.slice(0, 2000));
  const db = getDb();
  const ws = number.user_id;
  const chats = new Map<string, ChatRow>();
  const byProvider = new Map<string, string>();
  const latest = new Map<string, { at: string; preview: string }>();
  const groupsTouched = new Set<string>();
  let lidName: string | null = null;

  async function chatFor(ev: Extract<InboundEvent, { type: 'message' }>): Promise<ChatRow> {
    const hit = chats.get(ev.chatId);
    if (hit) {
      if (!hit.name && !ev.isGroup && !ev.fromMe && ev.senderName) {
        await db.prepare("UPDATE groups_chats SET name = ? WHERE id = ? AND name = ''").run(ev.senderName.slice(0, 200), hit.id);
        hit.name = ev.senderName;
      }
      return hit;
    }
    const isGroup = ev.isGroup || isGroupJid(ev.chatId);
    let name = isGroup ? ev.chatName : ev.fromMe ? undefined : ev.senderName || undefined;
    if (!isGroup && !name && isLidJid(ev.chatId)) name = lidName ??= await lidChatName(ws);
    const row = await upsertChat(number, { providerChatId: ev.chatId, kind: isGroup ? 'group' : 'dm', name, phone: isGroup ? '' : phoneDigits(ev.chatId) }, { silent: true });
    chats.set(ev.chatId, row);
    return row;
  }

  async function messageId(providerId: string): Promise<{ id: string } | undefined> {
    const local = byProvider.get(providerId);
    if (local) return { id: local };
    return (await db.prepare('SELECT id FROM groups_messages WHERE number_id = ? AND provider_message_id = ?').get(number.id, providerId)) as
      | { id: string }
      | undefined;
  }

  for (const ev of events.slice(0, 2000)) {
    try {
      if (ev.type === 'message') {
        const chat = await chatFor(ev);
        const replyToId = ev.replyToProviderId ? ((await messageId(ev.replyToProviderId))?.id ?? null) : null;
        const at = ev.timestamp && Number.isFinite(Date.parse(ev.timestamp)) ? new Date(ev.timestamp).toISOString() : nowIso();
        const poll = ev.poll && ev.poll.options.length >= 2 ? ev.poll : null;
        const row = await insertMessage({
          ws,
          chatId: chat.id,
          numberId: number.id,
          providerMessageId: ev.providerMessageId,
          direction: ev.fromMe ? 'out' : 'in',
          senderPhone: ev.senderPhone,
          senderName: ev.senderName,
          authorKind: ev.fromMe ? 'phone' : 'person',
          body: ev.body,
          media: ev.media && (ev.media.type || ev.media.url) ? ev.media : null,
          replyToId,
          status: ev.fromMe ? (ev.status ?? 'sent') : 'received',
          createdAt: at,
          forwarded: ev.forwarded,
          meta: { ...(inboundMeta(ev) ?? {}), imported: true },
          poll,
        });
        if (!row) {
          res.duplicates++;
          continue;
        }
        res.messages++;
        byProvider.set(ev.providerMessageId, row.id);
        const prev = latest.get(chat.id);
        if (!prev || at >= prev.at) {
          const text = poll ? pollPreview(poll) : previewOf(ev.body, ev.media?.type ?? '', ev.media?.name ?? '');
          latest.set(chat.id, { at, preview: text });
        }
        // Quien escribió en un grupo es miembro: su nombre de perfil sirve para mostrarlo.
        if (chat.kind === 'group' && !ev.fromMe && ev.senderPhone) {
          await db
            .prepare(
              `INSERT INTO groups_members (chat_id, phone, name, role, created_at) VALUES (?, ?, ?, 'member', ?)
               ON CONFLICT(chat_id, phone) DO UPDATE SET name = excluded.name WHERE excluded.name != '' AND groups_members.name = ''`,
            )
            .run(chat.id, phoneDigits(ev.senderPhone), (ev.senderName ?? '').slice(0, 120), at);
          groupsTouched.add(chat.id);
        }
      } else if (ev.type === 'reaction') {
        const target = await messageId(ev.targetProviderMessageId);
        const msg = target ? ((await db.prepare('SELECT * FROM groups_messages WHERE id = ?').get(target.id)) as MessageRow | undefined) : undefined;
        if (!msg) {
          res.ignored++;
          continue;
        }
        // Sin tickets por reacción: es historia.
        await applyReaction(msg, { emoji: ev.emoji, by: ev.fromMe ? 'phone' : ev.senderPhone || ev.senderName || 'contact', fromMe: ev.fromMe });
      } else if (ev.type === 'edit' || ev.type === 'revoke') {
        const target = await messageId(ev.providerMessageId);
        if (!target) {
          res.ignored++;
          continue;
        }
        if (ev.type === 'edit') await db.prepare('UPDATE groups_messages SET body = ?, edited_at = COALESCE(edited_at, ?) WHERE id = ?').run(ev.body.slice(0, 8000), nowIso(), target.id);
        else await db.prepare('UPDATE groups_messages SET deleted_at = COALESCE(deleted_at, ?), pinned_at = NULL WHERE id = ?').run(nowIso(), target.id);
        await refreshChatPreview(target.id);
      } else if (ev.type === 'status') {
        const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };
        const row = (await db.prepare('SELECT id, status FROM groups_messages WHERE number_id = ? AND provider_message_id = ?').get(number.id, ev.providerMessageId)) as
          | { id: string; status: string }
          | undefined;
        if (row && (rank[ev.status] ?? 0) > (rank[row.status] ?? 0)) await db.prepare('UPDATE groups_messages SET status = ? WHERE id = ?').run(ev.status, row.id);
      } else if (ev.type === 'poll_vote') {
        const target = await messageId(ev.pollProviderMessageId);
        const msg = target ? ((await db.prepare('SELECT * FROM groups_messages WHERE id = ?').get(target.id)) as MessageRow | undefined) : undefined;
        const poll = parsePoll(msg?.poll);
        if (!msg || !poll || !ev.voterPhone) {
          res.ignored++;
          continue;
        }
        await db
          .prepare(
            `INSERT INTO groups_poll_votes (message_id, voter, voter_name, options, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(message_id, voter) DO UPDATE SET options = excluded.options, updated_at = excluded.updated_at`,
          )
          .run(msg.id, phoneDigits(ev.voterPhone), (ev.voterName ?? '').slice(0, 120), JSON.stringify(voteOptions(poll, ev.options)), nowIso());
      } else if (ev.type === 'contact') {
        await applyContact(number, ev);
      } else res.ignored++;
    } catch (err) {
      // Historial: se cuenta y se loguea, nunca pide un reintento (no se reenvía la tanda entera por un mensaje).
      res.ignored++;
      // eslint-disable-next-line no-console
      console.error('[groups] history event failed', ev.type, (err as Error)?.name ?? 'error');
    }
  }
  // Cada chat queda con su último mensaje (si lo importado es más nuevo que lo que tenía). Sin no leídos ni espera.
  for (const [chatId, l] of latest) {
    await db
      .prepare('UPDATE groups_chats SET last_message_at = ?, last_message_preview = ? WHERE id = ? AND (last_message_at IS NULL OR last_message_at <= ?)')
      .run(l.at, l.preview, chatId, l.at);
  }
  for (const id of groupsTouched) await refreshMemberCount(id);
  return res;
}

// ======================================================================
// Tandas
// ======================================================================

async function claim(numberId: string, now: Date): Promise<ImportRow | null> {
  const db = getDb();
  const nowS = now.toISOString();
  const r = await db
    .prepare(
      `UPDATE groups_imports SET claimed_until = ?, status = 'running', updated_at = ?
       WHERE number_id = ? AND status IN ('queued', 'running') AND (claimed_until IS NULL OR claimed_until < ?)`,
    )
    .run(new Date(now.getTime() + CLAIM_MS).toISOString(), nowS, numberId, nowS);
  if (r.changes === 0) return null;
  return ((await db.prepare('SELECT * FROM groups_imports WHERE number_id = ?').get(numberId)) as ImportRow) ?? null;
}

/** Guarda el avance de la generación que tenemos (si reimportaron mientras tanto, no escribe nada). */
async function save(job: ImportRow, patch: Partial<Pick<ImportRow, 'phase' | 'cursor' | 'chats_total' | 'chats_done' | 'messages' | 'status' | 'error' | 'attempts' | 'finished_at' | 'claimed_until'>>): Promise<boolean> {
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  if (keys.length === 0) return true;
  const r = await getDb()
    .prepare(`UPDATE groups_imports SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE number_id = ? AND started_at = ?`)
    .run(...keys.map((k) => patch[k] as string | number | null), nowIso(), job.number_id, job.started_at);
  Object.assign(job, patch);
  return r.changes > 0;
}

/** Baja la foto de perfil y la guarda en nuestro storage (las URLs de WhatsApp vencen). */
export async function storePicture(url: string): Promise<string> {
  if (!/^https?:\/\//.test(url)) return '';
  const res = await defaultBridgeFetch(url, { method: 'GET' });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return '';
  }
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!/^image\/(jpeg|png|webp)$/.test(type) || Number(res.headers.get('content-length') ?? 0) > MAX_PICTURE) {
    await res.body?.cancel().catch(() => {});
    return '';
  }
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length === 0 || data.length > MAX_PICTURE) return '';
  const { saveUpload } = await import('./uploads');
  return saveUpload('chat', `avatar.${type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'}`, type, data);
}

async function setPicture(chatId: string, url: string): Promise<void> {
  const stored = await storePicture(url).catch(() => '');
  if (stored) await getDb().prepare("UPDATE groups_chats SET picture_url = ? WHERE id = ? AND picture_url = ''").run(stored, chatId);
}

/** Una fase: devuelve false si no quedó tiempo o hubo que cortar. */
async function step(job: ImportRow, number: NumberRow, provider: GroupsProvider, deadline: number): Promise<void> {
  const db = getDb();
  const history = provider.history!;
  switch (job.phase) {
    case 'groups': {
      // Los grupos con su nombre (también los que no tienen mensajes guardados).
      const groups = await provider.listGroups().catch(() => []);
      for (const g of groups.slice(0, 2000)) {
        const chat = await upsertChat(number, { providerChatId: g.id, kind: 'group', name: g.name }, { silent: true });
        if (g.name && !chat.name) await db.prepare('UPDATE groups_chats SET name = ? WHERE id = ?').run(g.name.slice(0, 200), chat.id);
        if (g.description && !chat.description) await db.prepare('UPDATE groups_chats SET description = ? WHERE id = ?').run(g.description.slice(0, 2000), chat.id);
        if (g.announce !== undefined || g.locked !== undefined) {
          await db
            .prepare('UPDATE groups_chats SET announce = COALESCE(?, announce), locked = COALESCE(?, locked) WHERE id = ?')
            .run(g.announce === undefined ? null : Number(g.announce), g.locked === undefined ? null : Number(g.locked), chat.id);
        }
      }
      await save(job, { phase: 'chats', cursor: 0 });
      return;
    }
    case 'chats': {
      const rows = await history.chats(job.cursor, CHATS_PAGE);
      let lid: string | null = null;
      for (const c of rows) {
        let name = c.name || undefined;
        if (!c.isGroup && !name && isLidJid(c.chatId)) name = lid ??= await lidChatName(number.user_id);
        const chat = await upsertChat(number, { providerChatId: c.chatId, kind: c.isGroup ? 'group' : 'dm', name, phone: c.isGroup ? '' : phoneDigits(c.chatId) }, { silent: true });
        // No leídos como en el teléfono (solo si acá no había nada pendiente).
        // Solo en chats que trajo esta importación: un chat que el equipo ya leyó no vuelve a quedar sin leer.
        if (c.unread > 0 && chat.created_at >= job.started_at) await db.prepare('UPDATE groups_chats SET unread_count = ? WHERE id = ? AND unread_count = 0').run(Math.min(c.unread, 9999), chat.id);
        await db
          .prepare('INSERT OR IGNORE INTO groups_import_chats (number_id, remote_jid, chat_id, last_at, done) VALUES (?, ?, ?, ?, 0)')
          .run(number.id, c.remoteJid, chat.id, Math.floor(c.lastAt));
        if (c.pictureUrl && !chat.picture_url && Date.now() < deadline) await setPicture(chat.id, c.pictureUrl);
      }
      const total = ((await db.prepare('SELECT COUNT(DISTINCT chat_id) AS n FROM groups_import_chats WHERE number_id = ?').get(number.id)) as { n: number }).n;
      // La última página (o un tope de seguridad) pasa a los contactos.
      if (rows.length < CHATS_PAGE || job.cursor >= 200) await save(job, { phase: 'contacts', cursor: 0, chats_total: Number(total) });
      else await save(job, { cursor: job.cursor + 1, chats_total: Number(total) });
      return;
    }
    case 'contacts': {
      const rows = await history.contacts(job.cursor, CONTACTS_PAGE).catch(() => []);
      // La libreta del número (nombres y lid ↔ teléfono) y, con ella, los chats y miembros que solo tenían el número.
      await learnLinesContacts(number, rows).catch(() => 0);
      for (const c of rows) await applyContact(number, { chatId: c.chatId, name: c.name });
      if (rows.length < CONTACTS_PAGE || job.cursor >= 100) {
        await fillLinesNames(number.id).catch(() => 0);
        await save(job, { phase: 'messages', cursor: 0 });
      } else await save(job, { cursor: job.cursor + 1 });
      return;
    }
    case 'messages': {
      // Los chats más recientes primero: lo que se ve arriba de la lista se completa antes. De cada chat, lo más nuevo.
      const next = (await db
        .prepare('SELECT remote_jid, chat_id, complete FROM groups_import_chats WHERE number_id = ? AND done = 0 AND page = 0 ORDER BY last_at DESC LIMIT 1')
        .get(number.id)) as { remote_jid: string; chat_id: string; complete: number } | undefined;
      if (!next) {
        await save(job, { phase: 'pictures', cursor: 0 });
        return;
      }
      const all = job.per_chat === IMPORT_ALL;
      let events: InboundEvent[];
      let more = false;
      if (all && history.messagePage) {
        const page = await history.messagePage(next.remote_jid, HISTORY_PAGE, 1);
        events = page.events;
        more = page.more;
      } else events = await history.messages(next.remote_jid, all ? 500 : job.per_chat);
      const r = await ingestHistory(number, events);
      // Queda para la pasada `older` si hay mensajes anteriores, salvo que este chat ya se haya recorrido entero
      // antes y esta página no traiga nada nuevo (reimportar no vuelve a caminar todo el historial).
      const keep = all && more && !(Number(next.complete) === 1 && r.messages === 0);
      await db
        .prepare('UPDATE groups_import_chats SET page = 1, done = ?, complete = CASE WHEN ? = 1 THEN 1 ELSE complete END WHERE number_id = ? AND remote_jid = ?')
        .run(keep ? 0 : 1, all && !more ? 1 : 0, number.id, next.remote_jid);
      // Un chat con dos ids (teléfono y lid) cuenta una vez: está hecho cuando a ninguno le falta su primera página.
      const left = (await db.prepare('SELECT COUNT(*) AS n FROM groups_import_chats WHERE number_id = ? AND chat_id = ? AND page = 0').get(number.id, next.chat_id)) as { n: number };
      await save(job, { messages: job.messages + r.messages, chats_done: job.chats_done + (Number(left.n) === 0 ? 1 : 0) });
      return;
    }
    case 'older': {
      // El resto del historial, hacia atrás: una página por paso, con la página de cada chat guardada.
      const next = (await db
        .prepare('SELECT remote_jid, page, complete FROM groups_import_chats WHERE number_id = ? AND done = 0 ORDER BY last_at DESC LIMIT 1')
        .get(number.id)) as { remote_jid: string; page: number; complete: number } | undefined;
      if (!next || !history.messagePage) {
        await db.prepare('UPDATE groups_import_chats SET done = 1 WHERE number_id = ? AND done = 0').run(number.id);
        await save(job, { phase: 'done', cursor: 0 });
        return;
      }
      const pageNo = Math.max(1, Number(next.page)) + 1;
      const page = await history.messagePage(next.remote_jid, HISTORY_PAGE, pageNo);
      const r = await ingestHistory(number, page.events);
      const end = !page.more || pageNo >= MAX_PAGES_PER_CHAT;
      // Ya recorrido antes y esta página no trajo nada nuevo: lo anterior ya está.
      const caughtUp = Number(next.complete) === 1 && r.messages === 0;
      await db
        .prepare('UPDATE groups_import_chats SET page = ?, done = ?, complete = CASE WHEN ? = 1 THEN 1 ELSE complete END WHERE number_id = ? AND remote_jid = ?')
        .run(pageNo, end || caughtUp ? 1 : 0, end ? 1 : 0, number.id, next.remote_jid);
      await save(job, { messages: job.messages + r.messages, cursor: job.cursor + 1 });
      if (Date.now() + OLDER_GAP_MS < deadline) await new Promise((done) => setTimeout(done, OLDER_GAP_MS));
      return;
    }
    case 'pictures': {
      // Fotos de perfil de los chats sin foto, de los más recientes a los más viejos. Los grupos sin miembros los traen acá.
      const rows = (await db
        .prepare(
          `SELECT id, kind, provider_chat_id, picture_url, member_count FROM groups_chats WHERE number_id = ?
           ORDER BY COALESCE(last_message_at, created_at) DESC, id LIMIT ? OFFSET ?`,
        )
        .all(number.id, PICTURES_PAGE, job.cursor)) as Array<Pick<ChatRow, 'id' | 'kind' | 'provider_chat_id' | 'picture_url' | 'member_count'>>;
      for (const c of rows) {
        if (Date.now() > deadline) break;
        if (!c.picture_url) {
          const url = await history.picture(c.provider_chat_id).catch(() => '');
          if (url) await setPicture(c.id, url);
        }
        // Los grupos traen sus miembros de WhatsApp (los del historial son solo quienes escribieron).
        if (c.kind === 'group') {
          const { syncMembers } = await import('./groups');
          await syncMembers(number.user_id, c.id).catch(() => null);
        }
      }
      // Hasta 500 fotos por importación (las demás llegan con los mensajes nuevos).
      // Con todo el historial pedido, después de las fotos sigue hacia atrás en cada chat.
      if (rows.length < PICTURES_PAGE || job.cursor + PICTURES_PAGE >= 500) {
        // Los miembros que trajo WhatsApp sin nombre: el de la libreta.
        await fillLinesNames(number.id).catch(() => 0);
        await save(job, { phase: job.per_chat === IMPORT_ALL ? 'older' : 'done', cursor: 0 });
      }
      else await save(job, { cursor: job.cursor + PICTURES_PAGE });
      return;
    }
    default:
      return;
  }
}

/**
 * Una tanda de la importación de un número, con tope de tiempo. Reclama la
 * fila; si otra corrida la tiene, no hace nada.
 */
export async function runImportChunk(numberId: string, opts: { budgetMs?: number; now?: Date } = {}): Promise<ImportStatus | null> {
  const start = Date.now();
  const deadline = start + (opts.budgetMs ?? 25_000);
  const job = await claim(numberId, opts.now ?? new Date());
  if (!job) return null;
  const number = await getNumberRowById(numberId);
  if (!number || number.user_id !== job.user_id) {
    await getDb().prepare('DELETE FROM groups_imports WHERE number_id = ?').run(numberId);
    return null;
  }
  let provider: GroupsProvider;
  try {
    provider = providerFor(number);
  } catch {
    await save(job, { status: 'error', error: 'provider_unavailable', claimed_until: null, finished_at: nowIso() });
    return toStatus(job);
  }
  if (!provider.history) {
    await save(job, { status: 'done', phase: 'done', claimed_until: null, finished_at: nowIso() });
    return toStatus(job);
  }
  // Sin conexión no hay qué leer: espera (el cron reintenta) sin gastar intentos.
  if (number.status !== 'connected') {
    await save(job, { claimed_until: new Date(Date.now() + 60_000).toISOString() });
    return toStatus(job);
  }
  try {
    while (job.phase !== 'done' && Date.now() < deadline) {
      const before = `${job.phase}:${job.cursor}:${job.chats_done}`;
      await step(job, number, provider, deadline);
      // Reimportaron mientras tanto: esta tanda se retira.
      const current = (await getDb().prepare('SELECT started_at FROM groups_imports WHERE number_id = ?').get(numberId)) as { started_at: string } | undefined;
      if (current?.started_at !== job.started_at) return null;
      if (`${job.phase}:${job.cursor}:${job.chats_done}` === before && job.phase !== 'messages') break;
    }
    if (job.phase === 'done') await save(job, { status: 'done', claimed_until: null, finished_at: nowIso(), error: '', attempts: 0 });
    else await save(job, { claimed_until: null, attempts: 0, error: '' });
  } catch (err) {
    const attempts = job.attempts + 1;
    const code = providerErrorCode(err);
    if (attempts >= MAX_ATTEMPTS) await save(job, { status: 'error', error: code, attempts, claimed_until: null, finished_at: nowIso() });
    // Espera creciente antes del próximo intento (lo retoma el cron).
    else await save(job, { error: code, attempts, claimed_until: new Date(Date.now() + attempts * 60_000).toISOString() });
  }
  return toStatus(job);
}

/** Cron de cada minuto: avanza las importaciones pendientes con el tiempo que haya. */
export async function runImports(opts: { budgetMs?: number; now?: Date } = {}): Promise<{ ran: number; done: number }> {
  const start = Date.now();
  const budget = opts.budgetMs ?? 25_000;
  const nowS = (opts.now ?? new Date()).toISOString();
  const rows = (await getDb()
    .prepare("SELECT number_id FROM groups_imports WHERE status IN ('queued', 'running') AND (claimed_until IS NULL OR claimed_until < ?) ORDER BY updated_at LIMIT 10")
    .all(nowS)) as Array<{ number_id: string }>;
  const out = { ran: 0, done: 0 };
  for (const r of rows) {
    const left = budget - (Date.now() - start);
    if (left < 3_000) break;
    const st = await runImportChunk(r.number_id, { budgetMs: left, now: opts.now }).catch(() => null);
    if (st) {
      out.ran++;
      if (st.status === 'done') out.done++;
    }
  }
  return out;
}

/** "Reimportar" desde la interfaz: vuelve a empezar y corre la primera tanda enseguida. */
export async function reimport(ws: string, numberId: string, perChat?: number): Promise<ImportStatus | null> {
  const number = await getNumberRow(ws, numberId);
  if (!number) return null;
  if (!canImport(number.provider)) return null;
  await queueImport(number, { restart: true, perChat });
  await kickImport(number.id);
  return getImportStatus(ws, numberId);
}

/**
 * "Traer más": los mensajes anteriores de un chat, del historial que guardó el
 * gateway (la importación trae los últimos N). Pide la página que sigue a lo
 * que ya hay; lo repetido no se duplica. Devuelve cuántos mensajes nuevos.
 */
export async function importOlder(ws: string, chatId: string, pageSize = 50): Promise<{ added: number; done: boolean }> {
  const db = getDb();
  const chat = (await db.prepare('SELECT * FROM groups_chats WHERE id = ? AND user_id = ?').get(chatId, ws)) as ChatRow | undefined;
  if (!chat) return { added: 0, done: true };
  const number = await getNumberRow(ws, chat.number_id);
  if (!number || !canImport(number.provider)) return { added: 0, done: true };
  const provider = providerFor(number);
  if (!provider.history) return { added: 0, done: true };
  const jids = ((await db.prepare('SELECT remote_jid FROM groups_import_chats WHERE number_id = ? AND chat_id = ?').all(number.id, chat.id)) as Array<{ remote_jid: string }>).map(
    (r) => r.remote_jid,
  );
  if (jids.length === 0) jids.push(chat.provider_chat_id);
  const have = (await db.prepare("SELECT COUNT(*) AS n FROM groups_messages WHERE chat_id = ? AND provider_message_id IS NOT NULL").get(chat.id)) as { n: number };
  let added = 0;
  let got = 0;
  for (const jid of jids) {
    const page = Math.floor(Number(have.n) / pageSize) + 1;
    const events = await provider.history.messages(jid, pageSize, page);
    got += events.length;
    added += (await ingestHistory(number, events)).messages;
  }
  return { added, done: got < pageSize };
}
