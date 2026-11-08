/**
 * Inbox: WhatsApp personal por QR. Reusa el adaptador de Evolution API de
 * Groups (lib/groups-provider-managed.ts): el mismo servidor, una instancia
 * propia por cuenta personal, con nombre y token al azar que genera el
 * servidor. El token de la instancia vive cifrado en inbox_accounts.config;
 * la clave global del servidor nunca se guarda en la cuenta.
 *
 * En tests y demo (GROUPS_FAKE=1) usa el proveedor falso de Groups: muestra
 * un QR, a los segundos queda conectado y nada sale a WhatsApp.
 */
import { fakeProvider, fakeProviderAllowed } from '../groups-provider-fake';
import { deleteManagedInstance, managedEnv, managedProvider, newManagedInstance, queueManagedDelete, validManagedConfig, type ManagedEnv } from '../groups-provider-managed';
import { cleanPushName } from '../groups-provider-bridge';
import { ProviderError, phoneDigits, type ConnectState, type GroupsProvider, type InboundEvent } from '../groups-provider';
import { getDb } from '../db';
import {
  addMessage,
  createAccount,
  findThread,
  listAccounts,
  nowIso,
  readAccountConfig,
  setAccountState,
  upsertThread,
  writeAccountConfig,
  type AccountRow,
  type ThreadRow,
} from './core';
import { InboxError, waKindOf, type AccountStatus } from './types';

function appBase(): string {
  return (process.env.NEXTAUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * Servidor de WhatsApp de Inbox: por defecto el mismo Evolution de Groups
 * (GROUPS_BRIDGE_URL/KEY), con una instancia por cuenta. INBOX_BRIDGE_URL y
 * INBOX_BRIDGE_KEY lo mandan a otro servidor si algún día hace falta separarlo.
 */
export function inboxBridgeEnv(): ManagedEnv | null {
  const baseUrl = String(process.env.INBOX_BRIDGE_URL ?? '').trim().replace(/\/+$/, '');
  const globalKey = String(process.env.INBOX_BRIDGE_KEY ?? '').trim();
  if (baseUrl && globalKey && /^https?:\/\/[^\s]+$/.test(baseUrl)) return { baseUrl, globalKey };
  return managedEnv();
}

export function whatsappAvailable(): boolean {
  return fakeProviderAllowed() || inboxBridgeEnv() !== null;
}

export function webhookUrlFor(account: Pick<AccountRow, 'id' | 'webhook_secret'>): string {
  return `${appBase()}/api/inbox/webhook/${account.id}/${account.webhook_secret}`;
}

/** Proveedor de la cuenta. Lanza si la cuenta no tiene credenciales válidas o el modo no está disponible. */
export function waProviderFor(account: AccountRow): GroupsProvider {
  if (account.kind !== 'whatsapp') throw new InboxError('invalid_account', 400);
  if (account.provider === 'fake') {
    if (!fakeProviderAllowed()) throw new InboxError('whatsapp_unavailable', 503);
    return fakeProvider(`inbox-${account.id}`);
  }
  if (account.provider === 'managed') {
    const cfg = readAccountConfig<{ session: string; instanceToken: string }>(account);
    const env = inboxBridgeEnv();
    if (!validManagedConfig(cfg) || !env) throw new InboxError('not_connected', 409);
    // Inbox pide el historial completo al vincular (Groups no).
    return managedProvider(cfg, { env, fullHistory: true });
  }
  throw new InboxError('not_connected', 409);
}

function statusOf(s: ConnectState['status']): AccountStatus {
  return s === 'connected' ? 'connected' : s === 'qr' ? 'qr' : s === 'error' ? 'error' : s === 'pending' ? 'pending' : 'disconnected';
}

/** La cuenta de WhatsApp de la persona (una por persona), creándola si no existe. */
export async function ensureWhatsappAccount(owner: string): Promise<AccountRow> {
  const existing = (await listAccounts(owner)).find((a) => a.kind === 'whatsapp');
  if (existing) return existing;
  return createAccount(owner, { kind: 'whatsapp', provider: '', label: 'WhatsApp' });
}

/**
 * Arranca la vinculación por QR: crea la instancia (o reusa la que hay) y
 * devuelve el estado con el QR. La persona lo escanea desde WhatsApp ›
 * Dispositivos vinculados.
 */
export async function connectWhatsapp(owner: string): Promise<{ account: AccountRow; state: ConnectState }> {
  if (!whatsappAvailable()) throw new InboxError('whatsapp_unavailable', 503);
  let account = await ensureWhatsappAccount(owner);
  if (!account.provider || (account.provider === 'managed' && !validManagedConfig(readAccountConfig(account)))) {
    if (fakeProviderAllowed()) {
      await setAccountState(account.id, { provider: 'fake' });
    } else {
      await writeAccountConfig(account.id, newManagedInstance());
      await setAccountState(account.id, { provider: 'managed' });
    }
    account = (await ensureWhatsappAccount(owner))!;
  }
  let state: ConnectState;
  try {
    state = await waProviderFor(account).connect(webhookUrlFor(account));
  } catch (err) {
    await setAccountState(account.id, { status: 'error', error: err instanceof ProviderError ? err.code : 'provider_error' });
    throw new InboxError(err instanceof ProviderError && err.code === 'unreachable' ? 'whatsapp_unreachable' : 'whatsapp_error', 502);
  }
  await applyState(account, state);
  return { account, state };
}

/** Estado actual (para el QR que se refresca): lo pide al servidor y lo guarda. */
export async function whatsappState(account: AccountRow): Promise<ConnectState> {
  let state: ConnectState;
  try {
    state = await waProviderFor(account).state();
  } catch (err) {
    if (err instanceof InboxError) return { status: 'disconnected' };
    return { status: account.status === 'connected' ? 'connected' : 'error' };
  }
  await applyState(account, state);
  return state;
}

async function applyState(account: AccountRow, state: ConnectState): Promise<void> {
  const status = statusOf(state.status);
  const patch: Parameters<typeof setAccountState>[1] = { status, error: status === 'error' ? account.error || 'provider_error' : '' };
  if (state.phone) patch.address = phoneDigits(state.phone);
  // Primera conexión: arranca la importación de lo que guardó el servidor, con un margen
  // para que WhatsApp termine de mandar el historial (cada tanda nueva la vuelve a correr).
  if (status === 'connected' && !account.sync_cursor) patch.sync_cursor = backfillCursor(Date.now() + BACKFILL_DELAY_MS);
  await setAccountState(account.id, patch);
  Object.assign(account, patch);
}

/**
 * Desvincula: cierra la sesión y borra la instancia (si el borrado falla, queda
 * en la cola de reintentos de Groups). Los chats guardados quedan, salvo que
 * `wipe` borre la cuenta entera.
 */
export async function disconnectWhatsapp(account: AccountRow): Promise<void> {
  try {
    await waProviderFor(account).disconnect();
  } catch {
    /* sin credenciales: no hay nada que cerrar */
  }
  if (account.provider === 'managed') {
    const cfg = readAccountConfig<{ session: string }>(account);
    const env = inboxBridgeEnv();
    const session = cfg.session;
    if (session && env) {
      // Si el borrado falla y es el servidor de Groups, queda en su cola de reintentos.
      await deleteManagedInstance(session, { env }).catch(async () => {
        if (env.baseUrl === managedEnv()?.baseUrl) await queueManagedDelete(session).catch(() => null);
      });
    }
  }
  await writeAccountConfig(account.id, {});
  await setAccountState(account.id, { status: 'disconnected', provider: '', sync_cursor: '', error: '' });
}

const MEDIA_LABEL: Record<string, string> = { image: 'image', video: 'video', audio: 'audio', ptt: 'audio', document: 'document', sticker: 'sticker' };

function mediaKind(mime: string, type: string): string {
  if (MEDIA_LABEL[type]) return MEDIA_LABEL[type];
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return mime ? 'document' : '';
}

type MessageEvent = Extract<InboundEvent, { type: 'message' }>;

function threadInput(e: { chatId: string; isGroup?: boolean; chatName?: string; senderName?: string; fromMe?: boolean }) {
  const kind = e.isGroup || waKindOf(e.chatId) === 'group' ? 'group' : 'dm';
  // En un chat de a dos, el nombre es el de la otra persona (pushName de lo que manda ella).
  const title = kind === 'group' ? e.chatName : e.fromMe ? undefined : e.senderName || e.chatName;
  return { externalId: e.chatId, kind, title, handle: kind === 'dm' ? phoneDigits(e.chatId) : '' } as const;
}

async function ingestMessage(account: AccountRow, e: MessageEvent, history: boolean): Promise<boolean> {
  const thread = await upsertThread(account, threadInput(e));
  const media = e.media;
  let body = e.body ?? '';
  if (!body && e.location) body = [e.location.name, e.location.address].filter(Boolean).join(' · ') || '📍';
  if (!body && e.contacts?.length) body = e.contacts.map((c) => c.name).filter(Boolean).join(', ');
  if (!body && e.poll) body = e.poll.question;
  return addMessage(thread, {
    externalId: e.providerMessageId,
    fromMe: e.fromMe,
    senderName: e.fromMe ? '' : e.senderName,
    senderHandle: e.fromMe ? '' : e.senderPhone,
    body,
    mediaType: media ? mediaKind(media.type, '') || 'document' : '',
    mediaName: media?.name ?? '',
    mediaRef: media?.fetchRef ? JSON.stringify(media.fetchRef) : '',
    replyTo: e.replyToProviderId ?? '',
    status: e.fromMe ? (e.status ?? 'sent') : '',
    sentAt: e.timestamp,
    history: history || e.history,
  });
}

/** Guarda lo que manda el servidor de WhatsApp (webhook o historial). Devuelve cuántos mensajes nuevos entraron. */
export async function ingestWhatsappEvents(account: AccountRow, events: InboundEvent[], opts: { history?: boolean } = {}): Promise<{ messages: number }> {
  const db = getDb();
  let messages = 0;
  for (const e of events.slice(0, 2000)) {
    try {
      switch (e.type) {
        case 'message':
          if (await ingestMessage(account, e, !!opts.history)) messages++;
          break;
        case 'contact': {
          if (!e.name) break;
          const t = await findThread(account.id, e.chatId);
          if (t && (!t.title || t.title === t.handle)) await db.prepare('UPDATE inbox_threads SET title = ? WHERE id = ?').run(e.name.slice(0, 200), t.id);
          break;
        }
        case 'status':
          await db
            .prepare('UPDATE inbox_messages SET status = ? WHERE external_id = ? AND from_me = 1 AND thread_id IN (SELECT id FROM inbox_threads WHERE account_id = ?)')
            .run(e.status, e.providerMessageId, account.id);
          break;
        case 'edit':
          await db
            .prepare('UPDATE inbox_messages SET body = ?, edited = 1 WHERE external_id = ? AND thread_id IN (SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?)')
            .run(e.body.slice(0, 100_000), e.providerMessageId, account.id, e.chatId);
          break;
        case 'revoke':
          // Se marca y se conserva el contenido: solo lo ve la persona dueña de la cuenta.
          await db
            .prepare('UPDATE inbox_messages SET revoked_at = ? WHERE external_id = ? AND thread_id IN (SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?)')
            .run(nowIso(), e.providerMessageId, account.id, e.chatId);
          break;
        case 'session': {
          const fresh = { ...account };
          await applyState(fresh, { status: e.status, phone: e.phone });
          break;
        }
        default:
          break;
      }
    } catch {
      // Un evento roto no frena el resto (el proveedor no reintenta lo ya guardado).
    }
  }
  return { messages };
}

/**
 * Chats del historial que manda WhatsApp al vincular (CHATS_SET de Evolution:
 * [{ remoteJid, instanceId, name }]). Aparecen en la lista aunque todavía no
 * haya mensajes. Los "@lid" se saltean: el chat queda con el id con teléfono
 * cuando llegan sus mensajes (si no, quedaría duplicado).
 */
export async function ingestHistoryChats(account: AccountRow, rows: unknown): Promise<number> {
  const list = Array.isArray(rows) ? rows : [];
  let n = 0;
  for (const raw of list.slice(0, 2000)) {
    const c = (raw ?? {}) as { remoteJid?: unknown; id?: unknown; name?: unknown };
    const jid = String(c.remoteJid ?? c.id ?? '');
    if (!/^[\d-]{5,40}@(s\.whatsapp\.net|g\.us)$/.test(jid)) continue;
    const isGroup = jid.endsWith('@g.us');
    try {
      await upsertThread(account, { externalId: jid, kind: isGroup ? 'group' : 'dm', title: cleanPushName(c.name) || undefined, handle: isGroup ? '' : phoneDigits(jid) });
      n++;
    } catch {
      /* uno roto no frena el resto */
    }
  }
  return n;
}

const BACKFILL_DELAY_MS = 60_000;

function backfillCursor(after: number): string {
  return JSON.stringify({ phase: 'chats', page: 0, after } satisfies Backfill);
}

/**
 * Vuelve a correr la importación desde el principio en un minuto. Se llama con
 * cada tanda de historial: mientras WhatsApp sigue mandando, se corre el
 * arranque; cuando termina, la importación trae lo que guardó el servidor
 * (también lo que no entró por el webhook por tamaño). Es idempotente.
 */
export async function scheduleWhatsappBackfill(accountId: string, now = Date.now()): Promise<void> {
  await getDb()
    .prepare("UPDATE inbox_accounts SET sync_cursor = ?, updated_at = ? WHERE id = ? AND kind = 'whatsapp'")
    .run(backfillCursor(now + BACKFILL_DELAY_MS), new Date(now).toISOString(), accountId);
}

/**
 * "Volver a sincronizar": WhatsApp manda el historial solo al vincular un
 * dispositivo. Cierra la sesión del servidor, crea una instancia nueva que
 * pide el historial completo y devuelve el QR para escanear de nuevo. Los
 * chats guardados quedan (no se duplican: el id de cada mensaje es el mismo).
 */
export async function resyncWhatsapp(owner: string): Promise<{ account: AccountRow; state: ConnectState }> {
  const account = (await listAccounts(owner)).find((a) => a.kind === 'whatsapp');
  if (!account) throw new InboxError('not_connected', 409);
  await disconnectWhatsapp(account);
  return connectWhatsapp(owner);
}

/** Manda un texto al chat y lo guarda como enviado. */
export async function sendWhatsappText(account: AccountRow, thread: ThreadRow, text: string): Promise<string> {
  if (account.status !== 'connected') throw new InboxError('not_connected', 409);
  let id: string;
  try {
    id = (await waProviderFor(account).sendText(thread.external_id, text)).id;
  } catch (err) {
    if (err instanceof InboxError) throw err;
    throw new InboxError(err instanceof ProviderError && err.code === 'not_connected' ? 'not_connected' : 'send_failed', 502);
  }
  await addMessage(thread, { externalId: id || `local-${Date.now()}`, fromMe: true, body: text, status: 'sent' });
  return id;
}

/** Chat nuevo con un número (con código de país). */
export async function startWhatsappChat(owner: string, phone: string): Promise<ThreadRow> {
  const digits = phoneDigits(phone);
  if (digits.length < 8 || digits.length > 15) throw new InboxError('invalid_phone', 400);
  const account = (await listAccounts(owner)).find((a) => a.kind === 'whatsapp');
  if (!account || account.status !== 'connected') throw new InboxError('not_connected', 409);
  return upsertThread(account, { externalId: `${digits}@s.whatsapp.net`, kind: 'dm', handle: digits });
}

export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/** Baja un archivo recibido (foto, audio, documento) del servidor de WhatsApp. */
export async function fetchWhatsappMedia(account: AccountRow, mediaRef: string): Promise<{ data: Buffer; mimetype: string; filename: string }> {
  let ref: { providerMessageId: string; chatId: string; fromMe: boolean };
  try {
    ref = JSON.parse(mediaRef) as typeof ref;
  } catch {
    throw new InboxError('not_found', 404);
  }
  const p = waProviderFor(account);
  if (!p.fetchMedia) throw new InboxError('not_found', 404);
  try {
    return await p.fetchMedia(ref, MAX_MEDIA_BYTES);
  } catch {
    throw new InboxError('media_unavailable', 502);
  }
}

// ---------------------------------------------------------------------------
// Importación de lo que guardó el servidor al vincular (cron, en tandas)
// ---------------------------------------------------------------------------

interface Backfill {
  phase: 'chats' | 'messages' | 'done';
  page: number;
  queue?: string[];
  /** No antes de (ms): deja que WhatsApp termine de mandar el historial. */
  after?: number;
}

const CHATS_PAGE = 50;
const MAX_CHATS = 200;
const PER_CHAT = 40;

/**
 * Una tanda de la importación inicial de una cuenta conectada: primero los
 * chats (nombre, no leídos), después los últimos mensajes de cada uno. Se
 * reclama la cuenta con compare-and-set para que dos corridas no la pisen.
 */
export async function runWhatsappBackfill(account: AccountRow, deadline: number, now = new Date()): Promise<boolean> {
  let cursor: Backfill;
  try {
    cursor = JSON.parse(account.sync_cursor) as Backfill;
  } catch {
    return false;
  }
  if (!cursor?.phase || cursor.phase === 'done' || account.status !== 'connected') return false;
  if (cursor.after && cursor.after > now.getTime()) return false;
  const original = account.sync_cursor;
  const db = getDb();
  const nowS = now.toISOString();
  const claim = await db
    .prepare('UPDATE inbox_accounts SET sync_claimed_until = ? WHERE id = ? AND (sync_claimed_until IS NULL OR sync_claimed_until < ?)')
    .run(new Date(now.getTime() + 5 * 60_000).toISOString(), account.id, nowS);
  if (claim.changes === 0) return false;
  let provider: GroupsProvider;
  try {
    provider = waProviderFor(account);
  } catch {
    await db.prepare('UPDATE inbox_accounts SET sync_claimed_until = NULL WHERE id = ?').run(account.id);
    return false;
  }
  const history = provider.history;
  try {
    if (!history) cursor = { phase: 'done', page: 0 };
    while (history && cursor.phase !== 'done' && Date.now() < deadline) {
      if (cursor.phase === 'chats') {
        const rows = await history.chats(cursor.page, CHATS_PAGE);
        const queue = cursor.queue ?? [];
        for (const c of rows) {
          const t = await upsertThread(account, { externalId: c.chatId, kind: c.isGroup ? 'group' : 'dm', title: c.name || undefined, handle: c.isGroup ? '' : phoneDigits(c.chatId) });
          if (c.unread > 0) await db.prepare('UPDATE inbox_threads SET unread = ? WHERE id = ? AND unread = 0').run(Math.min(c.unread, 9999), t.id);
          if (queue.length < MAX_CHATS) queue.push(c.remoteJid);
        }
        const last = rows.length < CHATS_PAGE || (cursor.page + 1) * CHATS_PAGE >= MAX_CHATS;
        cursor = last ? { phase: 'messages', page: 0, queue } : { phase: 'chats', page: cursor.page + 1, queue };
      } else {
        const queue = cursor.queue ?? [];
        const jid = queue.shift();
        if (!jid) {
          cursor = { phase: 'done', page: 0 };
          break;
        }
        const events = await history.messages(jid, PER_CHAT).catch(() => [] as InboundEvent[]);
        await ingestWhatsappEvents(account, events, { history: true });
        cursor = { phase: 'messages', page: 0, queue };
      }
    }
  } catch {
    // El servidor falló a mitad: se sigue en la próxima corrida desde el mismo punto.
  }
  // Si llegó historial nuevo mientras corría (scheduleWhatsappBackfill), gana ese reinicio.
  await db
    .prepare('UPDATE inbox_accounts SET sync_cursor = ?, last_sync_at = ?, updated_at = ? WHERE id = ? AND sync_cursor = ?')
    .run(JSON.stringify(cursor), nowS, nowS, account.id, original);
  await db.prepare('UPDATE inbox_accounts SET sync_claimed_until = NULL WHERE id = ?').run(account.id);
  return true;
}
