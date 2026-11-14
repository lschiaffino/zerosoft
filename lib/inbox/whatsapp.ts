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
import { ProviderError, isLidJid, lidDigits, phoneDigits, type ConnectState, type GroupsProvider, type InboundEvent } from '../groups-provider';
import { getDb } from '../db';
import {
  addMessage,
  addMessageToChat,
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
import { InboxError, normalizeWaJid, waKindOf, type AccountStatus } from './types';
import { messageMeta, storePresence, storeReaction } from './wa-meta';
import { inboxScope, learnFromEvents, senderPhoneFor } from './wa-names';
import { lookupContacts, displayName, phoneForLid } from '../wa-contacts';
import { pokeLive } from '../wa-live';
import { transientError } from '../transient-error';

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
  const first = status === 'connected' && !account.sync_cursor;
  if (first) patch.sync_cursor = backfillCursor(Date.now() + BACKFILL_DELAY_MS);
  const wasConnected = account.status === 'connected';
  await setAccountState(account.id, patch);
  Object.assign(account, patch);
  // Recién conectada (o sin el dato todavía): sus confirmaciones de lectura (lib/wa-privacy.ts).
  if (status === 'connected' && (!wasConnected || !account.privacy_at)) {
    const { refreshPrivacy } = await import('../wa-privacy');
    try {
      await refreshPrivacy('inbox', account.id, waProviderFor(account));
    } catch {
      // Sin proveedor: la lee el repaso diario.
    }
  }
  // Y, detrás de ese arranque rápido (los chats recientes), todo el historial que guardó el servidor: una
  // importación en segundo plano que se retoma sola (lib/inbox/import-jobs.ts). Una vez por cuenta. El servidor
  // falso de las pruebas no la arranca solo: sus chats de mentira no tienen que aparecer en cada cuenta de prueba.
  if (first && account.provider !== 'fake') {
    const { ensureAutoImport } = await import('./import-jobs');
    await ensureAutoImport(account, 'whatsapp').catch(() => null);
  }
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

/**
 * Tipo con que se guarda (media_type) un archivo recibido. Un sticker es "sticker" aunque su mimetype sea
 * image/webp (antes quedaba "image" y la burbuja lo dibujaba como una foto grande); el resto sale del mimetype.
 */
export function inboxMediaType(mime: string, kind = ''): string {
  if (kind === 'sticker') return 'sticker';
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

async function ingestMessage(account: AccountRow, e: MessageEvent, history: boolean, onSaved: () => void = () => {}): Promise<boolean> {
  const input = threadInput(e);
  // Quien manda solo con su lid: el teléfono, si la libreta ya lo conoce.
  const senderPhone = e.fromMe ? '' : await senderPhoneFor(account, e).catch(() => e.senderPhone);
  const media = e.media;
  let body = e.body ?? '';
  if (!body && e.location) body = [e.location.name, e.location.address].filter(Boolean).join(' · ') || '📍';
  if (!body && e.contacts?.length) body = e.contacts.map((c) => c.name).filter(Boolean).join(', ');
  if (!body && e.poll) body = e.poll.question;
  const { meta, kind } = messageMeta(e);
  // Una sola ida a la base: el chat, el mensaje y el chat al tope de la lista (lo que avisa a la pantalla).
  const { thread, added } = await addMessageToChat(account, input, {
    meta,
    kind,
    forwarded: !!e.forwarded,
    externalId: e.providerMessageId,
    fromMe: e.fromMe,
    senderName: e.fromMe ? '' : e.senderName,
    senderHandle: senderPhone,
    body,
    mediaType: media ? inboxMediaType(media.type, media.info?.kind) || 'document' : '',
    mediaName: media?.name ?? '',
    mediaRef: media?.fetchRef ? JSON.stringify(media.fetchRef) : '',
    replyTo: e.replyToProviderId ?? '',
    status: e.fromMe ? (e.status ?? 'sent') : '',
    sentAt: e.timestamp,
    history: history || e.history,
  });
  onSaved();
  // Quien tenga Inbox abierto en esta instancia se entera ya (lib/wa-live.ts).
  if (added) pokeLive('inbox', account.owner_id);
  // Un chat 1:1 que quedaría con el número (lo abrí yo, o llegó sin nombre): el nombre de la libreta. Si falla, el
  // mensaje ya está guardado: se loguea y se sigue.
  if (input.kind === 'dm' && thread.handle && (!thread.title || thread.title === thread.handle)) {
    try {
      const known = displayName((await lookupContacts(inboxScope(account), [thread.handle])).get(thread.handle));
      if (known) {
        await getDb().prepare("UPDATE inbox_threads SET title = ? WHERE id = ? AND (title = '' OR title = handle)").run(known.slice(0, 200), thread.id);
        thread.title = known;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[inbox] chat name failed', (err as Error)?.name ?? 'error');
    }
  }
  return added;
}

/** ¿La tanda trae a alguien solo con su lid, o contactos? Entonces la libreta va antes de guardar los mensajes. */
function needsBookFirst(e: InboundEvent): boolean {
  if (e.type !== 'message') return e.type === 'contact' || e.type === 'archive';
  const m = e as { chatId: string; senderPhone?: string; senderLid?: string; chatLid?: string };
  return isLidJid(m.chatId) || Boolean(m.chatLid) || (Boolean(m.senderLid) && !m.senderPhone);
}

/**
 * Archivar o desarchivar desde el teléfono (WhatsApp avisa con el id del chat,
 * que puede ser su lid). Un chat que todavía no está en Inbox no se crea por
 * esto; uno que ya está así no se toca; el eco viejo de un pedido nuestro se
 * ignora (lib/wa-archive-sync.ts). Nunca manda nada de vuelta a WhatsApp.
 */
export async function applyPhoneArchive(account: AccountRow, chatId: string, archived: boolean): Promise<boolean> {
  const t = await findPhoneThread(account, chatId);
  const { isArchiveEcho, traceArchive } = await import('../wa-archive-sync');
  if (!t) return traceArchive('inbox', chatId, archived, 'not_found');
  if (!!t.archived_at === archived) return traceArchive('inbox', chatId, archived, 'same');
  if (await isArchiveEcho('inbox', t.id, archived)) return traceArchive('inbox', chatId, archived, 'echo');
  traceArchive('inbox', chatId, archived, 'applied');
  await getDb()
    .prepare('UPDATE inbox_threads SET archived_at = ?, pinned_at = CASE WHEN ? THEN NULL ELSE pinned_at END, updated_at = ? WHERE id = ?')
    .run(archived ? nowIso() : null, archived ? 1 : 0, nowIso(), t.id);
  return true;
}

/** El chat de un aviso de WhatsApp, que puede venir con el lid (no crea nada). */
async function findPhoneThread(account: AccountRow, chatId: string) {
  let t = await findThread(account.id, normalizeWaJid(chatId));
  if (!t && isLidJid(chatId)) {
    const phone = await phoneForLid(inboxScope(account), lidDigits(chatId)).catch(() => '');
    if (phone) t = await findThread(account.id, `${phone}@s.whatsapp.net`);
  }
  return t;
}

/** Guarda lo que manda el servidor de WhatsApp (webhook o historial). Devuelve cuántos mensajes nuevos entraron. */
export async function ingestWhatsappEvents(account: AccountRow, events: InboundEvent[], opts: { history?: boolean } = {}): Promise<{ messages: number; failed?: number }> {
  const db = getDb();
  let messages = 0;
  /** Mensajes que no se pudieron guardar (un error, no un repetido): el webhook responde 500 y el servidor reintenta. */
  let failed = 0;
  // La libreta (nombres de perfil, lid ↔ teléfono). Si la tanda trae a alguien solo con su lid, primero: los mensajes
  // ya la usan. Si no, la libreta no cambia cómo se guarda nada y se aprende mientras se guarda el mensaje.
  const slice = events.slice(0, 2000);
  let learning: Promise<unknown> | null = null;
  if (slice.some(needsBookFirst)) await learnFromEvents(account, slice).catch(() => null);
  else learning = learnFromEvents(account, slice).catch(() => null);
  // Mensajes ya guardados: lo que falle después de guardarlos (el nombre del chat) no pide reintento.
  const stored = new Set<string>();
  for (const e of slice) {
    try {
      switch (e.type) {
        case 'message':
          if (await ingestMessage(account, e, !!opts.history, () => stored.add(e.providerMessageId))) messages++;
          break;
        case 'contact': {
          const t = await findThread(account.id, e.chatId);
          if (!t) break;
          if (e.name && (!t.title || t.title === t.handle)) await db.prepare('UPDATE inbox_threads SET title = ? WHERE id = ?').run(e.name.slice(0, 200), t.id);
          if (e.pictureUrl && /^https:\/\//.test(e.pictureUrl) && !t.avatar_url) await db.prepare('UPDATE inbox_threads SET avatar_url = ? WHERE id = ?').run(e.pictureUrl.slice(0, 2000), t.id);
          break;
        }
        case 'archive':
          await applyPhoneArchive(account, e.chatId, e.archived);
          break;
        case 'missing': {
          // WhatsApp entregó un mensaje que no se pudo descifrar: hueco en el chat y pedido de historial (lib/wa-history-gaps.ts).
          const t = await findPhoneThread(account, e.chatId);
          if (!t) break;
          const { recordMissing } = await import('../wa-history-gaps');
          await recordMissing('inbox', { chatId: t.id, accountId: account.id, scopeId: account.owner_id }, e);
          break;
        }
        case 'status': {
          // Las tildes no vuelven atrás (llega "entregado" después de "leído").
          const rank = "CASE status WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'sent' THEN 1 ELSE 0 END";
          const next = { sent: 1, delivered: 2, read: 3, failed: 0 }[e.status] ?? 0;
          const guard = e.status === 'failed' ? "status IN ('', 'sent')" : `${rank} < ${next}`;
          await db
            .prepare(`UPDATE inbox_messages SET status = ? WHERE external_id = ? AND from_me = 1 AND ${guard} AND thread_id IN (SELECT id FROM inbox_threads WHERE account_id = ?)`)
            .run(e.status, e.providerMessageId, account.id);
          // Las tildes de la fila de la lista, si es el último mensaje del chat.
          await db
            .prepare(
              `UPDATE inbox_threads SET last_status = (SELECT m.status FROM inbox_messages m WHERE m.thread_id = inbox_threads.id AND m.external_id = ?)
               WHERE account_id = ? AND last_from_me = 1
                 AND id IN (SELECT m.thread_id FROM inbox_messages m WHERE m.external_id = ? AND m.from_me = 1 AND m.sent_at = inbox_threads.last_message_at)`,
            )
            .run(e.providerMessageId, account.id, e.providerMessageId);
          break;
        }
        case 'reaction':
          await storeReaction(account, e.chatId, e.targetProviderMessageId, { emoji: e.emoji, by: e.fromMe ? 'me' : e.senderPhone || e.senderName || '?', name: e.fromMe ? '' : e.senderName });
          break;
        case 'presence':
          await storePresence(account, e);
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
    } catch (err) {
      // Un evento roto no frena el resto. Pide reintento (500) solo un mensaje EN VIVO que no se pudo guardar por algo
      // pasajero (la base, la red): un mensaje roto del historial (messages.set, hasta 2000 por tanda) o con una forma
      // inesperada se loguea y se sigue; si no, el servidor reenviaría la tanda entera una y otra vez.
      if (e.type === 'message' && !opts.history && !e.history && !stored.has(e.providerMessageId) && transientError(err)) failed++;
      // eslint-disable-next-line no-console
      console.error('[inbox] webhook event failed', e.type, (err as Error)?.name ?? 'error');
    }
  }
  if (learning) await learning;
  // El historial que se pidió por un mensaje que faltaba (lib/wa-history-gaps.ts): si lo trajo, el hueco se cierra.
  if (messages > 0 && (opts.history || slice.some((e) => e.type === 'message' && e.history))) {
    await import('../wa-history-gaps').then((g) => g.resolveGaps('inbox', { accountId: account.id })).catch(() => 0);
  }
  // Tildes, reacciones, ediciones, escribiendo: quien mira en esta instancia se entera ya.
  if (slice.length) pokeLive('inbox', account.owner_id);
  return failed ? { messages, failed } : { messages };
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
    const c = (raw ?? {}) as { remoteJid?: unknown; id?: unknown; name?: unknown; archived?: unknown; archive?: unknown };
    const jid = String(c.remoteJid ?? c.id ?? '');
    if (!/^[\d-]{5,40}@(s\.whatsapp\.net|g\.us)$/.test(jid)) continue;
    const isGroup = jid.endsWith('@g.us');
    try {
      const t = await upsertThread(account, { externalId: jid, kind: isGroup ? 'group' : 'dm', title: cleanPushName(c.name) || undefined, handle: isGroup ? '' : phoneDigits(jid) });
      // Los archivados del historial entran marcados como archivados (no ensucian la bandeja).
      if (c.archived === true || c.archive === true) await markArchived(t.id);
      n++;
    } catch {
      /* uno roto no frena el resto */
    }
  }
  return n;
}

/** Marca un chat como archivado sin tocar uno que ya lo está (conserva la fecha). */
export async function markArchived(threadId: string): Promise<void> {
  await getDb().prepare('UPDATE inbox_threads SET archived_at = COALESCE(archived_at, ?), pinned_at = NULL WHERE id = ?').run(nowIso(), threadId);
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
export async function sendWhatsappText(
  account: AccountRow,
  thread: ThreadRow,
  text: string,
  opts: { replyTo?: string; mentions?: string[]; clientId?: string; linkPreview?: boolean; forwarded?: boolean } = {},
): Promise<string> {
  if (account.status !== 'connected') throw new InboxError('not_connected', 409);
  let id: string;
  try {
    const o = {
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      ...(opts.mentions?.length ? { mentions: opts.mentions } : {}),
      ...(opts.linkPreview === false ? { linkPreview: false } : {}),
    };
    id = (await waProviderFor(account).sendText(thread.external_id, text, Object.keys(o).length ? o : undefined)).id;
  } catch (err) {
    if (err instanceof InboxError) throw err;
    throw new InboxError(err instanceof ProviderError && err.code === 'not_connected' ? 'not_connected' : 'send_failed', 502);
  }
  await addMessage(thread, {
    externalId: id || `local-${Date.now()}`,
    fromMe: true,
    body: text,
    status: 'sent',
    replyTo: opts.replyTo ?? '',
    // clientId: un reintento del mismo envío no lo guarda dos veces. noPreview: la persona sacó la vista previa del link.
    ...(opts.clientId || opts.linkPreview === false
      ? {
          meta: JSON.stringify({ ...(opts.clientId ? { cid: opts.clientId } : {}), ...(opts.linkPreview === false ? { noPreview: true } : {}) }),
          ...(opts.clientId ? { clientId: opts.clientId } : {}),
        }
      : {}),
    ...(opts.forwarded ? { forwarded: true } : {}),
  });
  // Quien tenga Inbox abierto en esta instancia (otra pestaña) lo ve ya.
  pokeLive('inbox', account.owner_id);
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
          if (c.archived) await markArchived(t.id);
          if (c.unread > 0) await db.prepare('UPDATE inbox_threads SET unread = ? WHERE id = ? AND unread = 0').run(Math.min(c.unread, 9999), t.id);
          if (c.pictureUrl && !t.avatar_url) await db.prepare("UPDATE inbox_threads SET avatar_url = ? WHERE id = ? AND avatar_url = ''").run(c.pictureUrl.slice(0, 2000), t.id);
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
