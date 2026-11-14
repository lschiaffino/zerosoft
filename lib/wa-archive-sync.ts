/**
 * Inbox y Lines: archivar o desarchivar en WhatsApp lo que se hace acá.
 *
 * - Cada pedido deja una fila por chat (wa_archive_push) con el último estado
 *   pedido y un `version` que sube con cada pedido. Se manda después de
 *   responder (next/server `after`) y, si falla, se reintenta con backoff desde
 *   el cron de cada minuto. Archivar y deshacer enseguida deja una sola fila:
 *   gana lo último.
 * - Antes de mandar se mira el chat: si su estado ya no es el pedido (llegó un
 *   mensaje que lo desarchivó, o se cambió desde el teléfono), no se manda.
 * - El eco: WhatsApp avisa del cambio que acabamos de mandar. Un aviso que
 *   coincide con lo pedido no cambia nada. Uno que repite el pedido anterior
 *   en los segundos siguientes a cambiarlo (archivar y deshacer enseguida) es
 *   el eco viejo y se ignora. Cualquier otro manda el teléfono, y el pedido
 *   pendiente se cancela. Los avisos de WhatsApp nunca generan un pedido: no
 *   hay ida y vuelta.
 *
 * Server-only.
 */
import { after } from 'next/server';
import { getDb } from './db';
import { ProviderError, isGroupJid, isLidJid, lidDigits, phoneDigits, type ArchiveRef, type GroupsProvider } from './groups-provider';

export type ArchiveApp = 'inbox' | 'lines';

/** Un aviso de WhatsApp igual al pedido anterior, si el último es de hace menos que esto, es el eco viejo. */
export const ECHO_WINDOW_MS = 15_000;
/** Esperas entre reintentos: 30 s, 2 min, 10 min, 1 h, 6 h. Después se deja. */
export const RETRY_BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
const CLAIM_MS = 60_000;
/** Chats que se mandan en el momento (el resto, en el cron). */
const NOW_LIMIT = 50;

export interface PushRow {
  app: ArchiveApp;
  chat_id: string;
  scope_id: string;
  archived: number;
  version: number;
  requested_at: string;
  attempts: number;
  next_at: string;
  claimed_until: string | null;
  done_at: string | null;
  last_error: string;
  sent: string;
  sent_count: number;
  /** El estado pedido antes del último (para reconocer su eco). */
  prev_archived: number | null;
  prev_at: string | null;
}

type Attempt =
  | { kind: 'sent'; sent: string }
  /** No hay nada que mandar (chat borrado, proveedor sin archivar, el estado cambió). */
  | { kind: 'skip'; reason: string }
  | { kind: 'fail'; error: string; retry: boolean };

/** Lo que hace cada app para mandar un pedido (estado actual, proveedor y mensaje de referencia). */
interface Target {
  /** Estado actual del chat acá (null: el chat no existe o no es de WhatsApp). */
  archived: boolean | null;
  connected: boolean;
  provider: () => GroupsProvider;
  chatJid: string;
  /** Libreta de la cuenta o número (para el id alternativo lid ↔ teléfono). */
  contacts: { app: ArchiveApp; accountId: string };
  ref: (jid: string) => Promise<ArchiveRef | undefined>;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Anota el pedido (uno por chat: el último manda). */
export async function queueArchivePush(app: ArchiveApp, scopeId: string, chatIds: string[], archived: boolean, now = new Date()): Promise<void> {
  const db = getDb();
  const at = now.toISOString();
  for (const id of [...new Set(chatIds)].slice(0, 500)) {
    await db
      .prepare(
        `INSERT INTO wa_archive_push (app, chat_id, scope_id, archived, version, requested_at, attempts, next_at, done_at, last_error)
         VALUES (?, ?, ?, ?, 1, ?, 0, ?, NULL, '')
         ON CONFLICT(app, chat_id) DO UPDATE SET prev_archived = wa_archive_push.archived, prev_at = wa_archive_push.requested_at,
           archived = excluded.archived, scope_id = excluded.scope_id, version = wa_archive_push.version + 1,
           requested_at = excluded.requested_at, attempts = 0, next_at = excluded.next_at, done_at = NULL, last_error = ''`,
      )
      .run(app, id, scopeId, archived ? 1 : 0, at, at);
  }
}

/** Anota y manda después de responder (fuera de un request, acá mismo). */
export async function requestArchivePush(app: ArchiveApp, scopeId: string, chatIds: string[], archived: boolean): Promise<void> {
  if (!chatIds.length) return;
  await queueArchivePush(app, scopeId, chatIds, archived);
  const ids = [...new Set(chatIds)].slice(0, NOW_LIMIT);
  const job = async () => {
    for (const id of ids) await flushArchivePush(app, id).catch((err) => logFailure(app, 'flush_error', err));
  };
  try {
    after(job);
  } catch {
    // Sin request (tests, cron, scripts): en el momento.
    await job();
  }
}

export async function getArchivePush(app: ArchiveApp, chatId: string): Promise<PushRow | undefined> {
  return (await getDb().prepare('SELECT * FROM wa_archive_push WHERE app = ? AND chat_id = ?').get(app, chatId)) as PushRow | undefined;
}

function logFailure(app: ArchiveApp, code: string, err?: unknown) {
  // Sin datos del chat: solo la app y el código.
  // eslint-disable-next-line no-console
  console.warn(`[wa-archive] ${app} push failed: ${code}${err instanceof ProviderError ? ` (${err.code})` : ''}`);
}

/**
 * Manda el pedido pendiente de un chat si le toca (claim por fila: dos corridas
 * no lo mandan dos veces). Si mientras tanto llegó otro pedido, se manda ese.
 */
export async function flushArchivePush(app: ArchiveApp, chatId: string, now = () => Date.now()): Promise<'sent' | 'skipped' | 'failed' | 'idle'> {
  const db = getDb();
  for (let round = 0; round < 3; round++) {
    const row = await getArchivePush(app, chatId);
    const t = now();
    if (!row || row.done_at || Date.parse(row.next_at) > t) return 'idle';
    const claim = await db
      .prepare(
        `UPDATE wa_archive_push SET claimed_until = ? WHERE app = ? AND chat_id = ? AND version = ? AND done_at IS NULL
           AND (claimed_until IS NULL OR claimed_until < ?)`,
      )
      .run(iso(t + CLAIM_MS), app, chatId, row.version, iso(t));
    if (claim.changes === 0) return 'idle';
    let result: Attempt;
    try {
      result = await attempt(row);
    } catch (err) {
      result = { kind: 'fail', error: err instanceof ProviderError ? err.code : 'error', retry: true };
    }
    const end = now();
    let res: { changes: number };
    if (result.kind === 'sent') {
      console.info(`[wa-archive] ${app} push sent: ${result.sent.slice(0, 300)}`);
      res = await db
        .prepare(
          `UPDATE wa_archive_push SET done_at = ?, claimed_until = NULL, last_error = '', sent = ?, sent_count = sent_count + 1
           WHERE app = ? AND chat_id = ? AND version = ?`,
        )
        .run(iso(end), result.sent.slice(0, 2000), app, chatId, row.version);
      // Llegó otro pedido mientras se mandaba este: se cuenta el envío y se sigue con el nuevo.
      if (res.changes === 0) await db.prepare('UPDATE wa_archive_push SET sent_count = sent_count + 1, sent = ? WHERE app = ? AND chat_id = ?').run(result.sent.slice(0, 2000), app, chatId);
    } else if (result.kind === 'skip') {
      // Sin esto un pedido que no sale no deja rastro: queda en el log de Vercel con el motivo.
      console.info(`[wa-archive] ${app} push skipped: ${result.reason}`);
      res = await db
        .prepare('UPDATE wa_archive_push SET done_at = ?, claimed_until = NULL, last_error = ? WHERE app = ? AND chat_id = ? AND version = ?')
        .run(iso(end), result.reason, app, chatId, row.version);
    } else {
      const attempts = row.attempts + 1;
      const giveUp = !result.retry || attempts > RETRY_BACKOFF_MS.length;
      logFailure(app, giveUp ? `${result.error}, gave up` : result.error);
      res = await db
        .prepare(
          `UPDATE wa_archive_push SET attempts = ?, last_error = ?, claimed_until = NULL, next_at = ?, done_at = ?
           WHERE app = ? AND chat_id = ? AND version = ?`,
        )
        .run(attempts, result.error.slice(0, 200), iso(end + (RETRY_BACKOFF_MS[attempts - 1] ?? 0)), giveUp ? iso(end) : null, app, chatId, row.version);
    }
    if (res.changes > 0) return result.kind === 'sent' ? 'sent' : result.kind === 'skip' ? 'skipped' : 'failed';
    // Hay un pedido más nuevo: se suelta el claim y se manda ese.
    await db.prepare('UPDATE wa_archive_push SET claimed_until = NULL WHERE app = ? AND chat_id = ?').run(app, chatId);
  }
  return 'idle';
}

/** Cron: los pedidos que esperan su reintento (y los que no se mandaron en el momento). */
export async function runArchivePushes(opts: { limit?: number; deadline?: number } = {}, now = new Date()): Promise<{ sent: number; failed: number }> {
  const db = getDb();
  const rows = (await db
    .prepare('SELECT app, chat_id FROM wa_archive_push WHERE done_at IS NULL AND next_at <= ? ORDER BY next_at LIMIT ?')
    .all(now.toISOString(), Math.max(1, Math.min(opts.limit ?? 100, 500)))) as Array<{ app: ArchiveApp; chat_id: string }>;
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const out = await flushArchivePush(r.app, r.chat_id, () => Math.max(Date.now(), now.getTime())).catch(() => 'failed' as const);
    if (out === 'sent') sent++;
    if (out === 'failed') failed++;
  }
  // Lo terminado hace más de una semana ya no sirve ni para el eco.
  await db.prepare('DELETE FROM wa_archive_push WHERE done_at IS NOT NULL AND done_at < ?').run(iso(now.getTime() - 7 * 86_400_000));
  return { sent, failed };
}

/**
 * Un aviso de archivado que llega de WhatsApp: ¿es el eco viejo de un pedido
 * nuestro (el anterior al último, cambiado hace segundos)? true = ignorarlo.
 * Si no lo es y contradice un pedido pendiente, manda el teléfono: el pedido
 * se cancela.
 */
export async function isArchiveEcho(app: ArchiveApp, chatId: string, archived: boolean, now = Date.now()): Promise<boolean> {
  const row = await getArchivePush(app, chatId);
  if (!row) return false;
  if ((row.archived === 1) === archived) return false;
  const changedAt = Math.max(Date.parse(row.requested_at) || 0, row.done_at ? Date.parse(row.done_at) || 0 : 0);
  if (row.prev_archived !== null && (row.prev_archived === 1) === archived && now - changedAt < ECHO_WINDOW_MS) return true;
  if (!row.done_at) {
    await getDb()
      .prepare("UPDATE wa_archive_push SET done_at = ?, last_error = 'superseded_by_phone' WHERE app = ? AND chat_id = ? AND version = ? AND done_at IS NULL")
      .run(iso(now), app, chatId, row.version);
  }
  return false;
}

/** El mismo chat 1:1 con el otro id que conoce WhatsApp (teléfono ↔ lid), si la libreta lo sabe. */
async function altJid(contacts: Target['contacts'], jid: string): Promise<string> {
  if (isGroupJid(jid)) return '';
  const db = getDb();
  if (isLidJid(jid)) {
    const lid = lidDigits(jid);
    const r = (await db.prepare("SELECT phone FROM wa_contacts WHERE app = ? AND account_id = ? AND lid = ? AND phone <> '' LIMIT 1").get(contacts.app, contacts.accountId, lid)) as
      | { phone: string }
      | undefined;
    return r?.phone ? `${r.phone}@s.whatsapp.net` : '';
  }
  const phone = phoneDigits(jid);
  if (!phone) return '';
  const r = (await db.prepare("SELECT lid FROM wa_contacts WHERE app = ? AND account_id = ? AND phone = ? AND lid <> '' LIMIT 1").get(contacts.app, contacts.accountId, phone)) as
    | { lid: string }
    | undefined;
  return r?.lid ? `${r.lid}@lid` : '';
}

async function attempt(row: PushRow): Promise<Attempt> {
  const target = row.app === 'inbox' ? await inboxTarget(row) : await linesTarget(row);
  if (!target || target.archived === null) return { kind: 'skip', reason: 'gone' };
  const want = row.archived === 1;
  // El chat ya no está como se pidió (un mensaje lo desarchivó, o se cambió desde el teléfono): no se pisa.
  if (target.archived !== want) return { kind: 'skip', reason: 'superseded' };
  if (!target.connected) return { kind: 'fail', error: 'not_connected', retry: true };
  let provider: GroupsProvider;
  try {
    provider = target.provider();
  } catch {
    return { kind: 'fail', error: 'not_connected', retry: true };
  }
  if (!provider.archiveChat) return { kind: 'skip', reason: 'unsupported' };
  const ref = await target.ref(target.chatJid);
  // Un 1:1 que WhatsApp puede tener por teléfono o por lid: se manda con los dos ids. Alcanza con que salga uno (el
  // proveedor puede conocer el chat solo por el otro); si fallan los dos, se reintenta con el error del principal.
  const alt = await altJid(target.contacts, target.chatJid).catch(() => '');
  let mainErr: unknown = null;
  try {
    await provider.archiveChat(target.chatJid, want, ref);
  } catch (err) {
    mainErr = err;
  }
  let altSent = false;
  if (alt) {
    try {
      await provider.archiveChat(alt, want, await target.ref(alt));
      altSent = true;
    } catch {
      /* queda el principal */
    }
  }
  if (mainErr && !altSent) throw mainErr;
  return {
    kind: 'sent',
    sent: JSON.stringify({ jid: target.chatJid, archive: want, ts: ref?.timestamp ?? null, ...(mainErr ? { mainFailed: true } : {}), ...(altSent ? { alt } : {}) }),
  };
}

/** Segundos de una fecha guardada (ISO, o "YYYY-MM-DD HH:MM:SS" de SQLite, que es UTC). */
export function secondsOf(at: string): number {
  const s = String(at ?? '').trim();
  const norm = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  return Math.floor(Date.parse(norm) / 1000);
}

/** El mensaje más nuevo que sirve de referencia (en un grupo, uno mío o uno ajeno con quién lo mandó). */
export function pickRef(rows: Array<{ id: string; fromMe: boolean; at: string; sender: string }>, group: boolean): ArchiveRef | undefined {
  for (const r of rows) {
    const ts = secondsOf(r.at);
    if (!r.id || !Number.isFinite(ts) || ts <= 0) continue;
    if (!group || r.fromMe) return { id: r.id, fromMe: r.fromMe, timestamp: ts };
    const digits = phoneDigits(r.sender);
    if (digits) return { id: r.id, fromMe: false, timestamp: ts, participant: `${digits}@s.whatsapp.net` };
  }
  return undefined;
}

async function inboxTarget(row: PushRow): Promise<Target | null> {
  const db = getDb();
  const t = (await db
    .prepare("SELECT id, account_id, external_id, archived_at, done_at, channel FROM inbox_threads WHERE id = ? AND owner_id = ?")
    .get(row.chat_id, row.scope_id)) as { id: string; account_id: string; external_id: string; archived_at: string | null; done_at: string | null; channel: string } | undefined;
  if (!t || t.channel !== 'whatsapp') return null;
  const { getAccount } = await import('./inbox/core');
  const { waProviderFor } = await import('./inbox/whatsapp');
  const account = await getAccount(row.scope_id, t.account_id).catch(() => null);
  if (!account) return null;
  return {
    // Archivados en Inbox son los archivados y los "hechos" (la misma vista y el mismo botón).
    archived: !!t.archived_at || !!t.done_at,
    connected: account.status === 'connected',
    provider: () => waProviderFor(account),
    chatJid: t.external_id,
    contacts: { app: 'inbox', accountId: account.id },
    ref: async (jid) => {
      const rows = (await db
        .prepare("SELECT external_id, from_me, sent_at, sender_handle FROM inbox_messages WHERE thread_id = ? AND external_id NOT LIKE 'local-%' ORDER BY sent_at DESC LIMIT 20")
        .all(t.id)) as Array<{ external_id: string; from_me: number; sent_at: string; sender_handle: string }>;
      return pickRef(
        rows.map((r) => ({ id: r.external_id, fromMe: r.from_me === 1, at: r.sent_at, sender: r.sender_handle })),
        isGroupJid(jid),
      );
    },
  };
}

async function linesTarget(row: PushRow): Promise<Target | null> {
  const db = getDb();
  const chat = (await db
    .prepare('SELECT id, number_id, provider_chat_id, archived_at FROM groups_chats WHERE id = ? AND user_id = ?')
    .get(row.chat_id, row.scope_id)) as { id: string; number_id: string; provider_chat_id: string; archived_at: string | null } | undefined;
  if (!chat) return null;
  const { getNumberRow, providerFor } = await import('./groups');
  const number = await getNumberRow(row.scope_id, chat.number_id);
  if (!number) return null;
  return {
    archived: !!chat.archived_at,
    connected: number.status === 'connected',
    provider: () => providerFor(number),
    chatJid: chat.provider_chat_id,
    contacts: { app: 'lines', accountId: number.id },
    ref: async (jid) => {
      const rows = (await db
        .prepare(
          `SELECT provider_message_id, direction, created_at, sender_phone FROM groups_messages
           WHERE chat_id = ? AND direction IN ('in', 'out') AND provider_message_id IS NOT NULL AND provider_message_id <> ''
           ORDER BY created_at DESC LIMIT 20`,
        )
        .all(chat.id)) as Array<{ provider_message_id: string; direction: string; created_at: string; sender_phone: string }>;
      return pickRef(
        rows.map((r) => ({ id: r.provider_message_id, fromMe: r.direction === 'out', at: r.created_at, sender: r.sender_phone })),
        isGroupJid(jid),
      );
    },
  };
}
