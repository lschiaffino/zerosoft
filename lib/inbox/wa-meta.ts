/**
 * Inbox: lo que hace que WhatsApp se vea como WhatsApp. Datos del chat
 * (asunto y foto del grupo, "info" del contacto, participantes), la foto
 * servida con la sesión de la persona, presencia, reacciones y los datos de
 * presentación de cada mensaje. Server-only.
 *
 * La URL de la foto es la del servidor de WhatsApp (vence a las semanas):
 * vive en inbox_threads.avatar_url y nunca llega al navegador. La pantalla
 * pide /api/inbox/avatar/<chat>, que la baja con la sesión de la dueña y la
 * deja en la caché privada del navegador; si venció, se pide una nueva.
 */
import type { InboundEvent, ChatInfo, MemberRole } from '../groups-provider';
import { phoneDigits } from '../groups-provider';
import { safeFetch } from '../safe-fetch';
import { getDb } from '../db';
import { listAccounts, nowIso, type AccountRow, type ThreadRow } from './core';
import { InboxError, type MessageReaction, type ParticipantDto, type WaDetailsDto, type WaMessageMeta } from './types';
import { waProviderFor } from './whatsapp';
import { inboxScope, learnFromChatInfo } from './wa-names';
import { namesByPhone } from '../wa-contacts';

type MessageEvent = Extract<InboundEvent, { type: 'message' }>;

/** Datos de presentación del mensaje (lo que no entra en las columnas). '' si no hay nada. */
export function messageMeta(e: MessageEvent): { meta: string; kind: string } {
  const out: WaMessageMeta = {};
  const info = e.media?.info;
  let kind = '';
  if (info) {
    if (info.width) out.width = info.width;
    if (info.height) out.height = info.height;
    if (info.duration) out.duration = info.duration;
    if (info.ptt || info.kind === 'voice') out.ptt = true;
    if (info.pages) out.pages = info.pages;
    if (info.size) out.size = info.size;
    if (info.mimetype) out.mime = info.mimetype.slice(0, 100);
    if (info.thumbnail && info.thumbnail.length < 24_000) out.thumb = info.thumbnail;
    if (info.viewOnce) out.viewOnce = true;
    if (info.animated) out.animated = true;
    if (info.lottie) out.lottie = true;
    if (info.sha && /^[0-9a-f]{64}$/.test(info.sha)) out.sha = info.sha;
    if (info.waveform?.length) out.waveform = info.waveform.slice(0, 64);
    kind = out.ptt ? 'voice' : info.kind === 'sticker' ? 'sticker' : '';
  }
  if (e.location) {
    out.location = {
      lat: e.location.lat,
      lng: e.location.lng,
      ...(e.location.name ? { name: e.location.name.slice(0, 200) } : {}),
      ...(e.location.address ? { address: e.location.address.slice(0, 300) } : {}),
      ...(e.location.url ? { url: e.location.url.slice(0, 500) } : {}),
      ...(e.location.live ? { live: true } : {}),
    };
    kind = 'location';
  }
  if (e.contacts?.length) {
    out.contacts = e.contacts.slice(0, 20).map((c) => ({ name: (c.name ?? '').slice(0, 120), phones: (c.phones ?? []).slice(0, 5).map((p) => String(p).slice(0, 30)) }));
    kind = 'contact';
  }
  if (e.link) out.link = { url: e.link.url, title: e.link.title, ...(e.link.description ? { description: e.link.description } : {}), ...(e.link.thumbnail ? { thumb: e.link.thumbnail } : {}) };
  if (e.poll) {
    out.poll = { question: e.poll.question.slice(0, 300), options: e.poll.options.slice(0, 12).map((o) => o.slice(0, 100)), multi: !!e.poll.multi };
    kind = 'poll';
  }
  // A quién menciona (teléfono o "<lid>@lid"): con eso "@<dígitos>" se muestra con el nombre.
  if (e.mentions?.length) out.mentions = e.mentions.filter((m) => typeof m === 'string' && /^\d{5,20}(@lid)?$/.test(m)).slice(0, 50);
  return { meta: Object.keys(out).length ? JSON.stringify(out) : '', kind };
}

// ---------------------------------------------------------------------------
// Reacciones
// ---------------------------------------------------------------------------

/** Lista nueva de reacciones: una por persona (la nueva pisa la anterior; vacío la saca). */
export function applyReaction(list: MessageReaction[], r: { emoji: string; by: string; name: string }): MessageReaction[] {
  const rest = list.filter((x) => x.by !== r.by);
  if (!r.emoji) return rest;
  return [...rest, { emoji: r.emoji.slice(0, 16), by: r.by.slice(0, 40), name: r.name.slice(0, 120) }].slice(-200);
}

function readReactions(raw: string | null | undefined): MessageReaction[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as MessageReaction[]).filter((x) => x && typeof x.emoji === 'string' && typeof x.by === 'string') : [];
  } catch {
    return [];
  }
}

/** Guarda una reacción sobre un mensaje del chat (por id del proveedor). */
export async function storeReaction(account: Pick<AccountRow, 'id'>, chatId: string, target: string, r: { emoji: string; by: string; name: string }): Promise<boolean> {
  const db = getDb();
  const row = (await db
    .prepare(
      'SELECT m.id, m.reactions FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id WHERE t.account_id = ? AND t.external_id = ? AND m.external_id = ?',
    )
    .get(account.id, chatId, target)) as { id: string; reactions: string } | undefined;
  if (!row) return false;
  const next = applyReaction(readReactions(row.reactions), r);
  // Compare-and-set sobre el valor leído: dos reacciones a la vez no se pisan (la segunda reintenta).
  for (let i = 0; i < 3; i++) {
    const res = await db.prepare('UPDATE inbox_messages SET reactions = ? WHERE id = ? AND reactions = ?').run(JSON.stringify(next), row.id, row.reactions);
    if (res.changes) return true;
    const fresh = (await db.prepare('SELECT reactions FROM inbox_messages WHERE id = ?').get(row.id)) as { reactions: string } | undefined;
    if (!fresh) return false;
    row.reactions = fresh.reactions;
    next.splice(0, next.length, ...applyReaction(readReactions(fresh.reactions), r));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Presencia
// ---------------------------------------------------------------------------

/** Escribiendo, grabando, en línea o se fue (con la hora de "últ. vez"). */
export async function storePresence(account: Pick<AccountRow, 'id'>, e: Extract<InboundEvent, { type: 'presence' }>, now = new Date()): Promise<void> {
  const at = nowIso(now);
  await getDb()
    .prepare(
      `UPDATE inbox_threads SET presence = ?, presence_who = ?, presence_at = ?,
         last_seen_at = CASE WHEN ? = 'unavailable' THEN ? ELSE last_seen_at END
       WHERE account_id = ? AND external_id = ?`,
    )
    .run(e.state, e.who ?? '', at, e.state, at, account.id, e.chatId);
}

// ---------------------------------------------------------------------------
// Datos del chat (nombre, foto, info, participantes)
// ---------------------------------------------------------------------------

export interface ThreadInfo {
  about: string;
  participants: Array<{ phone: string; role: MemberRole }>;
  size: number;
  createdAt: number | null;
  isBusiness: boolean;
  /** Bloqueado desde Inbox (WhatsApp no avisa el estado a los dispositivos vinculados). */
  blocked?: boolean;
}

export function parseThreadInfo(raw: string | undefined | null): ThreadInfo {
  const empty: ThreadInfo = { about: '', participants: [], size: 0, createdAt: null, isBusiness: false, blocked: false };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as Partial<ThreadInfo>;
    return {
      about: typeof v.about === 'string' ? v.about : '',
      participants: Array.isArray(v.participants) ? v.participants.filter((p) => p && typeof p.phone === 'string') : [],
      size: Number(v.size) || 0,
      createdAt: Number(v.createdAt) || null,
      isBusiness: v.isBusiness === true,
      blocked: v.blocked === true,
    };
  } catch {
    return empty;
  }
}

/** Cada cuánto se vuelven a pedir los datos de un chat (la foto de WhatsApp vence a las semanas). */
export const INFO_TTL_MS = 3 * 86_400_000;

/**
 * Pide los datos del chat al servidor y los guarda. En un grupo el asunto
 * siempre pisa el nombre (lo cambian en WhatsApp); en un 1:1 solo llena un
 * nombre vacío o que era el teléfono (el que puso la persona a mano queda).
 */
export async function applyChatInfo(thread: Pick<ThreadRow, 'id' | 'kind' | 'title' | 'handle'> & { info?: string }, info: ChatInfo, now = new Date()): Promise<void> {
  const db = getDb();
  const name = info.name.trim().slice(0, 200);
  const keepTitle = thread.kind === 'group' ? !name : !name || (thread.title && thread.title !== thread.handle);
  const stored: ThreadInfo = {
    about: info.about.slice(0, 2000),
    participants: (info.participants ?? []).slice(0, 2000),
    size: info.size ?? info.participants?.length ?? 0,
    createdAt: info.createdAt ?? null,
    isBusiness: !!info.isBusiness,
    // Lo que se marcó desde acá queda (el servidor no lo informa).
    blocked: parseThreadInfo(thread.info).blocked,
  };
  await db
    .prepare(`UPDATE inbox_threads SET avatar_url = ?, info = ?, info_at = ?${keepTitle ? '' : ', title = ?'} WHERE id = ?`)
    .run(...([info.pictureUrl.slice(0, 2000), JSON.stringify(stored), nowIso(now), ...(keepTitle ? [] : [name]), thread.id] as string[]));
}

/** Pide y guarda los datos de un chat. Devuelve false si el servidor no los dio. */
export async function refreshChatInfo(account: AccountRow, thread: ThreadRow, now = new Date()): Promise<boolean> {
  if (thread.channel !== 'whatsapp' || account.status !== 'connected') return false;
  let info: ChatInfo | null = null;
  try {
    const p = waProviderFor(account);
    if (!p.chatInfo) return false;
    info = await p.chatInfo(thread.external_id);
  } catch {
    info = null;
  }
  if (!info) {
    // Igual se marca la hora: no se reintenta en cada corrida un chat que el servidor no conoce.
    await getDb().prepare('UPDATE inbox_threads SET info_at = ? WHERE id = ?').run(nowIso(now), thread.id);
    return false;
  }
  await applyChatInfo(thread, info, now);
  // La libreta aprende del grupo (lid ↔ teléfono y nombres de los participantes) o del contacto (nombre e info).
  await learnFromChatInfo(account, thread.external_id, info).catch(() => null);
  return true;
}

/** ¿Algún chat de la cuenta sin datos o con datos vencidos? Dos búsquedas por idx_inbox_threads_info (una fila cada una). */
export async function hasStaleInfo(accountId: string, stale: string): Promise<boolean> {
  const row = (await getDb()
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM inbox_threads WHERE account_id = ? AND info_at IS NULL)
           OR EXISTS (SELECT 1 FROM inbox_threads WHERE account_id = ? AND info_at < ?) AS due`,
    )
    .get(accountId, accountId, stale)) as { due: number } | undefined;
  return Number(row?.due ?? 0) === 1;
}

/**
 * Chats que necesitan datos: grupos sin asunto primero, después los que
 * nunca se pidieron y los vencidos, los más recientes antes. Cada chat se
 * reclama con compare-and-set sobre info_at (dos corridas no piden el mismo).
 */
export async function refreshStaleInfo(account: AccountRow, opts: { now?: Date; deadline?: number; limit?: number; ids?: string[] } = {}): Promise<number> {
  if (account.kind !== 'whatsapp' || account.status !== 'connected') return 0;
  const now = opts.now ?? new Date();
  const deadline = opts.deadline ?? Date.now() + 10_000;
  const db = getDb();
  const stale = new Date(now.getTime() - INFO_TTL_MS).toISOString();
  const byIds = opts.ids?.length ? ` AND id IN (${opts.ids.map(() => '?').join(',')})` : '';
  // El cron pasa cada minuto: si ningún chat de la cuenta tiene datos por pedir o vencidos, no se leen sus chats.
  if (!byIds && !(await hasStaleInfo(account.id, stale))) return 0;
  const rows = (await db
    .prepare(
      `SELECT * FROM inbox_threads WHERE account_id = ? AND channel = 'whatsapp' AND (info_at IS NULL OR info_at < ?)${byIds}
       ORDER BY (kind = 'group' AND title = '') DESC, (info_at IS NULL) DESC, COALESCE(last_message_at, created_at) DESC LIMIT ?`,
    )
    .all(account.id, stale, ...(opts.ids ?? []), Math.min(opts.limit ?? 40, 200))) as unknown as ThreadRow[];
  let n = 0;
  for (const t of rows) {
    if (Date.now() > deadline) break;
    const claim = await db
      .prepare('UPDATE inbox_threads SET info_at = ? WHERE id = ? AND (info_at IS NULL OR info_at = ?)')
      .run(nowIso(now), t.id, t.info_at ?? null);
    if (!claim.changes) continue;
    if (await refreshChatInfo(account, t, now)) n++;
  }
  return n;
}

/** Cron: datos de los chats de todas las cuentas conectadas, en tandas. */
export async function refreshAllStaleInfo(now = new Date(), deadline = Date.now() + 15_000): Promise<number> {
  const accounts = (await getDb()
    .prepare("SELECT * FROM inbox_accounts WHERE kind = 'whatsapp' AND status = 'connected' ORDER BY updated_at LIMIT 20")
    .all()) as unknown as AccountRow[];
  let n = 0;
  for (const a of accounts) {
    if (Date.now() > deadline) break;
    n += await refreshStaleInfo(a, { now, deadline, limit: 40 }).catch(() => 0);
  }
  return n;
}

/** Al listar: los chats a la vista que todavía no tienen datos (para pedirlos después de responder). */
export async function refreshVisible(owner: string, threadIds: string[]): Promise<void> {
  if (!threadIds.length) return;
  const account = (await listAccounts(owner)).find((a) => a.kind === 'whatsapp' && a.status === 'connected');
  if (!account) return;
  await refreshStaleInfo(account, { ids: threadIds.slice(0, 30), limit: 30, deadline: Date.now() + 20_000 });
}

// ---------------------------------------------------------------------------
// Foto
// ---------------------------------------------------------------------------

const AVATAR_HOSTS = /(^|\.)(whatsapp\.net|fbcdn\.net|whatsapp\.com)$/i;
const AVATAR_MAX = 2 * 1024 * 1024;

/** data:image/...;base64 (solo el proveedor falso) → bytes. */
function fromDataUrl(url: string): { data: Buffer; mime: string } | null {
  const m = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([a-z0-9+/=]+)$/i.exec(url);
  if (!m) return null;
  const data = Buffer.from(m[2], 'base64');
  return data.length && data.length <= AVATAR_MAX ? { data, mime: m[1].toLowerCase() } : null;
}

async function download(url: string): Promise<{ data: Buffer; mime: string } | 'expired' | null> {
  if (url.startsWith('data:')) return fromDataUrl(url);
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!AVATAR_HOSTS.test(host)) return null;
  let res: Response;
  try {
    res = await safeFetch(url, { headers: { accept: 'image/*' } }, 8000);
  } catch {
    return null;
  }
  if (res.status === 403 || res.status === 404 || res.status === 410) return 'expired';
  if (!res.ok || !res.body) return null;
  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > AVATAR_MAX) {
      await reader.cancel().catch(() => null);
      return null;
    }
    chunks.push(value);
  }
  return { data: Buffer.concat(chunks), mime };
}

/** La foto de un chat de la persona. Si la URL venció, pide una nueva una vez. */
export async function avatarFor(owner: string, threadId: string): Promise<{ data: Buffer; mime: string }> {
  const db = getDb();
  const thread = (await db.prepare('SELECT * FROM inbox_threads WHERE id = ? AND owner_id = ?').get(threadId, owner)) as ThreadRow | undefined;
  if (!thread || thread.channel !== 'whatsapp' || !thread.avatar_url) throw new InboxError('not_found', 404);
  const first = await download(thread.avatar_url);
  if (first && first !== 'expired') return first;
  if (first === 'expired') {
    const account = (await db.prepare('SELECT * FROM inbox_accounts WHERE id = ? AND owner_id = ?').get(thread.account_id, owner)) as AccountRow | undefined;
    if (account && (await refreshChatInfo(account, thread))) {
      const fresh = (await db.prepare('SELECT avatar_url FROM inbox_threads WHERE id = ?').get(thread.id)) as { avatar_url: string } | undefined;
      const again = fresh?.avatar_url ? await download(fresh.avatar_url) : null;
      if (again && again !== 'expired') return again;
    }
  }
  throw new InboxError('not_found', 404);
}

// ---------------------------------------------------------------------------
// Participantes de un grupo con nombre
// ---------------------------------------------------------------------------

/** Info del contacto o del grupo para la conversación y el panel (sin pedir nada al servidor). */
export async function waDetails(owner: string, thread: ThreadRow, account: AccountRow): Promise<WaDetailsDto> {
  const info = parseThreadInfo(thread.info);
  const myPhone = phoneDigits(account.address);
  return {
    about: info.about,
    size: info.size,
    createdAt: info.createdAt ? new Date(info.createdAt * 1000).toISOString() : null,
    isBusiness: info.isBusiness,
    myPhone,
    participants: thread.kind === 'group' ? (await groupParticipants(owner, thread, myPhone)).slice(0, 1000) : [],
    infoAt: thread.info_at ?? null,
    blocked: !!info.blocked,
    commonGroups: thread.kind === 'dm' && thread.handle ? await commonGroups(owner, thread) : [],
  };
}

/** Grupos en común: los grupos de la cuenta donde está este teléfono (según los participantes guardados). */
async function commonGroups(owner: string, thread: ThreadRow): Promise<NonNullable<WaDetailsDto['commonGroups']>> {
  const phone = phoneDigits(thread.handle);
  if (!phone) return [];
  const rows = (await getDb()
    .prepare(
      `SELECT id, title, avatar_url FROM inbox_threads WHERE owner_id = ? AND account_id = ? AND kind = 'group' AND info LIKE ? ESCAPE '\\'
       ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT 30`,
    )
    .all(owner, thread.account_id, `%"phone":"${phone}"%`)) as Array<{ id: string; title: string; avatar_url: string }>;
  return rows.map((r) => ({ id: r.id, title: r.title, avatar: r.avatar_url ? `/api/inbox/avatar/${r.id}` : '' }));
}

export type SharedKind = 'media' | 'docs' | 'links' | 'starred';

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

/** Lo compartido en el chat para el panel de info: fotos y videos, documentos, links o destacados (lo más nuevo primero). */
export async function sharedContent(owner: string, threadId: string, kind: SharedKind): Promise<
  Array<{ id: string; mediaType: string; mediaName: string; body: string; sentAt: string; fromMe: boolean; senderName: string; senderHandle: string; size?: number; urls?: string[] }>
> {
  const thread = (await getDb().prepare('SELECT id, account_id, channel FROM inbox_threads WHERE id = ? AND owner_id = ?').get(threadId, owner)) as
    | { id: string; account_id: string; channel: string }
    | undefined;
  if (!thread) throw new InboxError('not_found', 404);
  const where =
    kind === 'media'
      ? "media_type IN ('image', 'video') AND media_ref <> '' AND revoked_at IS NULL"
      : kind === 'docs'
        ? "media_type = 'document' AND revoked_at IS NULL"
        : kind === 'links'
          ? "(body LIKE '%http://%' OR body LIKE '%https://%') AND revoked_at IS NULL"
          : 'starred_at IS NOT NULL';
  const rows = (await getDb()
    .prepare(
      `SELECT id, media_type, media_name, body, sent_at, from_me, sender_name, sender_handle, meta FROM inbox_messages
       WHERE thread_id = ? AND owner_id = ? AND hidden_at IS NULL AND ${where} ORDER BY ${kind === 'starred' ? 'starred_at' : 'sent_at'} DESC LIMIT 120`,
    )
    .all(threadId, owner)) as Array<{ id: string; media_type: string; media_name: string; body: string; sent_at: string; from_me: number; sender_name: string; sender_handle: string; meta: string }>;
  const metas = rows.map((r) => {
    try {
      return r.meta ? (JSON.parse(r.meta) as { size?: number; mentions?: unknown }) : {};
    } catch {
      return {};
    }
  });
  // "@<dígitos>" → "@Nombre" (destacados, pies de foto), antes de cortar el texto.
  let bodies = rows.map((r) => r.body);
  if (thread.channel === 'whatsapp' && bodies.some((b) => b.includes('@'))) {
    const { resolveTextMentions, someoneWord } = await import('../wa-contacts');
    bodies = await resolveTextMentions(
      'inbox',
      rows.map((r, i) => ({ accountId: r.body.includes('@') ? thread.account_id : '', text: r.body, mentions: metas[i].mentions })),
      { someone: () => someoneWord(owner) },
    ).catch(() => bodies);
  }
  return rows.map((r, i) => {
    const size = metas[i].size;
    return {
      id: r.id,
      mediaType: r.media_type,
      mediaName: r.media_name,
      body: bodies[i].slice(0, 500),
      sentAt: r.sent_at,
      fromMe: r.from_me === 1,
      senderName: r.sender_name,
      senderHandle: r.sender_handle,
      ...(size ? { size } : {}),
      ...(kind === 'links' ? { urls: [...new Set(r.body.match(URL_RE) ?? [])].map((u) => u.replace(/[).,;:!?]+$/, '')).slice(0, 5) } : {}),
    };
  });
}

/**
 * Presencia propia (como WhatsApp Web): al abrir el chat se suscribe a la del
 * otro ("pausa", sin avisar nada), y mientras se escribe o graba se manda
 * "escribiendo" o "grabando" por unos segundos.
 */
export async function sendMyPresence(owner: string, threadId: string, state: 'composing' | 'recording' | 'paused'): Promise<void> {
  const db = getDb();
  const thread = (await db.prepare('SELECT * FROM inbox_threads WHERE id = ? AND owner_id = ?').get(threadId, owner)) as ThreadRow | undefined;
  if (!thread) throw new InboxError('not_found', 404);
  if (thread.channel !== 'whatsapp') return;
  const account = (await db.prepare('SELECT * FROM inbox_accounts WHERE id = ? AND owner_id = ?').get(thread.account_id, owner)) as AccountRow | undefined;
  if (!account || account.status !== 'connected') return;
  const p = waProviderFor(account);
  if (!p.sendPresence) return;
  await p.sendPresence(thread.external_id, state, state === 'paused' ? 0 : 4000).catch(() => null);
}

/** Bloquear o desbloquear el contacto en WhatsApp (solo chats 1:1). */
export async function setBlocked(owner: string, threadId: string, block: boolean): Promise<void> {
  const db = getDb();
  const thread = (await db.prepare('SELECT * FROM inbox_threads WHERE id = ? AND owner_id = ?').get(threadId, owner)) as ThreadRow | undefined;
  if (!thread) throw new InboxError('not_found', 404);
  if (thread.channel !== 'whatsapp' || thread.kind !== 'dm') throw new InboxError('unsupported', 400);
  const account = (await db.prepare('SELECT * FROM inbox_accounts WHERE id = ? AND owner_id = ?').get(thread.account_id, owner)) as AccountRow | undefined;
  if (!account || account.status !== 'connected') throw new InboxError('not_connected', 409);
  const p = waProviderFor(account);
  if (!p.blockContact) throw new InboxError('unsupported', 400);
  try {
    await p.blockContact(thread.external_id, block);
  } catch {
    throw new InboxError('send_failed', 502);
  }
  const info = parseThreadInfo(thread.info);
  await db.prepare('UPDATE inbox_threads SET info = ? WHERE id = ?').run(JSON.stringify({ ...info, blocked: block }), thread.id);
}

/**
 * Participantes con el nombre que se conoce: el del chat 1:1 con esa persona
 * o el último nombre con el que escribió en el grupo. Los admins primero.
 */
export async function groupParticipants(owner: string, thread: ThreadRow, myPhone: string): Promise<ParticipantDto[]> {
  const info = parseThreadInfo(thread.info);
  const phones = info.participants.map((p) => phoneDigits(p.phone)).filter(Boolean).slice(0, 1000);
  if (!phones.length) return [];
  const db = getDb();
  const marks = phones.map(() => '?').join(',');
  const dms = (await db
    .prepare(`SELECT id, title, handle, avatar_url FROM inbox_threads WHERE owner_id = ? AND account_id = ? AND kind = 'dm' AND handle IN (${marks})`)
    .all(owner, thread.account_id, ...phones)) as Array<{ id: string; title: string; handle: string; avatar_url: string }>;
  const byPhone = new Map(dms.map((d) => [d.handle, d]));
  const senders = (await db
    .prepare(
      `SELECT sender_handle, sender_name FROM inbox_messages WHERE thread_id = ? AND from_me = 0 AND sender_handle IN (${marks}) AND sender_name <> '' GROUP BY sender_handle`,
    )
    .all(thread.id, ...phones)) as Array<{ sender_handle: string; sender_name: string }>;
  const sent = new Map(senders.map((s) => [s.sender_handle, s.sender_name]));
  // La libreta de la cuenta: nombres de contactos y de perfil de toda la cuenta (también de quien nunca escribió acá).
  const book = await namesByPhone(inboxScope({ id: thread.account_id, owner_id: owner }), phones).catch(() => new Map<string, string>());
  const rank = { superadmin: 0, admin: 1, member: 2 } as const;
  return info.participants
    .map((p) => {
      const phone = phoneDigits(p.phone);
      const dm = byPhone.get(phone);
      const me = !!myPhone && phone === myPhone;
      return {
        phone,
        role: p.role,
        name: me ? '' : (dm?.title && dm.title !== phone ? dm.title : '') || book.get(phone) || sent.get(phone) || '',
        threadId: dm?.id ?? null,
        avatar: dm?.avatar_url ? `/api/inbox/avatar/${dm.id}` : '',
        me,
      };
    })
    .sort((a, b) => Number(b.me) - Number(a.me) || rank[a.role] - rank[b.role] || (a.name ? 0 : 1) - (b.name ? 0 : 1) || a.name.localeCompare(b.name));
}
