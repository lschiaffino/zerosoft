/**
 * Inbox y Lines: mensajes que faltan en un chat de WhatsApp.
 *
 * WhatsApp a veces entrega un mensaje que el servidor no puede descifrar (la
 * sesión de cifrado con ese teléfono se rompió). Evolution los tiraba sin
 * avisar; con el parche 0002 de infra/evolution le pide al teléfono que lo
 * reenvíe y avisa por el webhook (`missing`). Acá:
 *
 * - Cada aviso deja un hueco (wa_history_gaps, uno por mensaje) y marca el
 *   chat (history_gap_at). Si el mensaje ya está guardado, no hay hueco.
 * - Se agenda un pedido de historial para ese chat (wa_history_fetch) a los
 *   AUTO_DELAY_MS: varios avisos seguidos del mismo chat son un solo pedido.
 *   Lo manda el cron de cada minuto (claim por fila). Si en ese tiempo el
 *   teléfono reenvió el mensaje, no se pide nada.
 * - El historial llega como historial (sin avisos, reglas ni agente) y lo
 *   repetido no se duplica (el id del mensaje en WhatsApp). El hueco se cierra
 *   cuando el mensaje con ese id está guardado; la marca del chat, cuando no le
 *   quedan huecos. Los que nadie recupera vencen a los GAP_TTL_MS.
 * - Topes: LINE_HOURLY_CAP pedidos por hora por línea (el teléfono hace el
 *   trabajo), uno por chat cada CHAT_MIN_INTERVAL_MS a mano o
 *   AUTO_CHAT_INTERVAL_MS solo, y AUTO_MAX pedidos solos por hueco abierto.
 * - "Traer mensajes que faltan" en el menú del chat pide lo mismo a mano; al
 *   abrir un chat con la marca, la pantalla lo pide sola una vez (`auto`).
 * - "Cargar mensajes anteriores" (arriba del chat, cuando lo guardado se
 *   termina) pide los OLDER_COUNT mensajes anteriores al más viejo que
 *   tenemos (loadOlderHistory): un pedido por chat a la vez, con esperas que
 *   crecen si el teléfono no trae nada, y un tope por línea por hora.
 *
 * Server-only.
 */
import { getDb } from './db';
import { ProviderError, type GroupsProvider, type HistoryAnchor, type InboundEvent } from './groups-provider';
import { isRateLimited, rateLimit } from './rate-limit';

export type GapApp = 'inbox' | 'lines';
type MissingEvent = Extract<InboundEvent, { type: 'missing' }>;

/** Espera entre el aviso y el pedido automático (el reenvío del teléfono suele llegar antes). */
export const AUTO_DELAY_MS = 30_000;
/** Pedidos de historial por línea (número de Lines o cuenta de Inbox) por hora. */
export const LINE_HOURLY_CAP = 20;
/** Un pedido a mano por chat cada tanto. */
export const CHAT_MIN_INTERVAL_MS = 60_000;
/** Un pedido automático (aviso o abrir el chat) por chat cada tanto. */
export const AUTO_CHAT_INTERVAL_MS = 10 * 60_000;
/** Pedidos automáticos por chat mientras tenga huecos abiertos (después, solo a mano). */
export const AUTO_MAX = 3;
/** Un hueco que nadie recuperó en una semana se deja. */
export const GAP_TTL_MS = 7 * 86_400_000;
/** Mensajes que se piden al teléfono por pedido. */
export const HISTORY_COUNT = 50;
const CLAIM_MS = 60_000;

const CHAT_TABLE: Record<GapApp, string> = { lines: 'groups_chats', inbox: 'inbox_threads' };

/** El mensaje guardado con ese id (Lines: por número; Inbox: por chat). */
const STORED: Record<GapApp, string> = {
  lines: 'SELECT 1 FROM groups_messages m WHERE m.number_id = wa_history_gaps.account_id AND m.provider_message_id = wa_history_gaps.message_id',
  inbox: 'SELECT 1 FROM inbox_messages m WHERE m.thread_id = wa_history_gaps.chat_id AND m.external_id = wa_history_gaps.message_id',
};

export interface GapChat {
  /** Id del chat acá (groups_chats.id o inbox_threads.id). */
  chatId: string;
  /** Número de Lines o cuenta de Inbox. */
  accountId: string;
  /** Workspace (Lines) o dueño (Inbox). */
  scopeId: string;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function lineKey(app: GapApp, accountId: string): string {
  return `wa-history:${app}:${accountId}`;
}

/**
 * Un aviso `missing`: anota el hueco, marca el chat y agenda el pedido de
 * historial. 'stored': el mensaje ya estaba (llegó antes que el aviso).
 */
export async function recordMissing(app: GapApp, chat: GapChat, ev: MissingEvent, now = Date.now()): Promise<'recorded' | 'known' | 'stored'> {
  const db = getDb();
  const id = ev.messageId.slice(0, 200);
  const stored =
    app === 'lines'
      ? await db.prepare('SELECT 1 AS x FROM groups_messages WHERE number_id = ? AND provider_message_id = ?').get(chat.accountId, id)
      : await db.prepare('SELECT 1 AS x FROM inbox_messages WHERE thread_id = ? AND external_id = ?').get(chat.chatId, id);
  if (stored) return 'stored';
  const ts = ev.timestamp ? Math.floor(Date.parse(ev.timestamp) / 1000) : NaN;
  const res = await db
    .prepare(
      `INSERT INTO wa_history_gaps (app, account_id, message_id, chat_id, from_me, msg_ts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(app, account_id, message_id) DO NOTHING`,
    )
    .run(app, chat.accountId, id, chat.chatId, ev.fromMe ? 1 : 0, Number.isFinite(ts) && ts > 0 ? ts : null, iso(now));
  if (res.changes === 0) return 'known';
  await db.prepare(`UPDATE ${CHAT_TABLE[app]} SET history_gap_at = COALESCE(history_gap_at, ?) WHERE id = ?`).run(iso(now), chat.chatId);
  // Un hueco nuevo vuelve a habilitar los pedidos automáticos; si ya hay uno agendado, queda ese (un pedido por tanda).
  await db
    .prepare(
      `INSERT INTO wa_history_fetch (app, chat_id, account_id, scope_id, due_at, auto_count) VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT(app, chat_id) DO UPDATE SET due_at = COALESCE(wa_history_fetch.due_at, excluded.due_at), auto_count = 0,
         account_id = excluded.account_id, scope_id = excluded.scope_id`,
    )
    .run(app, chat.chatId, chat.accountId, chat.scopeId, iso(now + AUTO_DELAY_MS));
  return 'recorded';
}

/**
 * Cierra los huecos cuyo mensaje ya está guardado (y los vencidos) y saca la
 * marca de los chats que se quedaron sin huecos. `chatIds` o `accountId`
 * acotan; sin nada, todos (cron). Devuelve cuántos huecos se cerraron.
 */
export async function resolveGaps(app: GapApp, scope: { chatIds?: string[]; accountId?: string } = {}, now = Date.now()): Promise<number> {
  if (scope.chatIds && scope.chatIds.length === 0) return 0;
  const db = getDb();
  const at = iso(now);
  const ids = scope.chatIds ? [...new Set(scope.chatIds)].slice(0, 200) : [];
  let where = scope.chatIds ? ` AND chat_id IN (${ids.map(() => '?').join(',')})` : '';
  const args: string[] = [...ids];
  if (scope.accountId) {
    where += ' AND account_id = ?';
    args.push(scope.accountId);
  }
  const found = await db
    .prepare(`UPDATE wa_history_gaps SET resolved_at = ? WHERE app = ? AND resolved_at IS NULL${where} AND EXISTS (${STORED[app]})`)
    .run(at, app, ...args);
  const expired = await db
    .prepare(`UPDATE wa_history_gaps SET resolved_at = ? WHERE app = ? AND resolved_at IS NULL${where} AND created_at < ?`)
    .run(at, app, ...args, iso(now - GAP_TTL_MS));
  const changed = found.changes + expired.changes;
  if (changed > 0) {
    const table = CHAT_TABLE[app];
    // Solo los chats de los huecos que se cerraron recién (sin recorrer la tabla de chats).
    await db
      .prepare(
        `UPDATE ${table} SET history_gap_at = NULL WHERE history_gap_at IS NOT NULL
           AND id IN (SELECT chat_id FROM wa_history_gaps WHERE app = ? AND resolved_at = ?)
           AND NOT EXISTS (SELECT 1 FROM wa_history_gaps g WHERE g.app = ? AND g.chat_id = ${table}.id AND g.resolved_at IS NULL)`,
      )
      .run(app, at, app);
    // Sin huecos no hay nada que pedir solo.
    await db
      .prepare(
        `UPDATE wa_history_fetch SET due_at = NULL WHERE app = ? AND due_at IS NOT NULL
           AND chat_id IN (SELECT chat_id FROM wa_history_gaps WHERE app = ? AND resolved_at = ?)
           AND NOT EXISTS (SELECT 1 FROM wa_history_gaps g WHERE g.app = ? AND g.chat_id = wa_history_fetch.chat_id AND g.resolved_at IS NULL)`,
      )
      .run(app, app, at, app);
  }
  return found.changes;
}

/** Huecos abiertos de un chat. */
export async function openGaps(app: GapApp, chatId: string): Promise<Array<{ message_id: string; msg_ts: number | null; from_me: number }>> {
  return (await getDb()
    .prepare('SELECT message_id, msg_ts, from_me FROM wa_history_gaps WHERE app = ? AND chat_id = ? AND resolved_at IS NULL ORDER BY msg_ts')
    .all(app, chatId)) as Array<{ message_id: string; msg_ts: number | null; from_me: number }>;
}

/** Lo que hace cada app para pedir el historial de un chat. */
export interface FetchTarget extends GapChat {
  app: GapApp;
  connected: boolean;
  provider: () => GroupsProvider;
  /** Id del chat en WhatsApp. */
  jid: string;
  /** El mismo chat 1:1 con el otro id (teléfono ↔ lid), si se conoce. */
  altJid?: () => Promise<string>;
  /** Guarda lo que el proveedor devolvió en el momento (como historial). */
  ingest: (events: InboundEvent[]) => Promise<void>;
  /** El mensaje de WhatsApp más viejo guardado de este chat (null si no hay ninguno). */
  oldest: () => Promise<HistoryAnchor | null>;
}

export type FetchOutcome =
  | { ok: true; requestId?: string; delivered: number }
  | { ok: false; error: 'rate_limited' | 'unsupported' | 'not_connected' | 'busy' | 'failed'; code?: string };

/**
 * Le pide al teléfono el historial del chat. `auto`: lo pide el sistema (el
 * aviso o abrir el chat), con topes más estrictos y solo si hay huecos.
 */
export async function fetchChatHistory(target: FetchTarget, opts: { auto?: boolean } = {}, nowFn = () => Date.now()): Promise<FetchOutcome> {
  const db = getDb();
  const { app, chatId } = target;
  const now = nowFn();
  let provider: GroupsProvider;
  try {
    provider = target.provider();
  } catch {
    return { ok: false, error: 'not_connected' };
  }
  if (!provider.fetchHistory || !provider.caps.fetchHistory) return { ok: false, error: 'unsupported' };
  if (!target.connected) return { ok: false, error: 'not_connected' };
  // El teléfono ya mandó lo que faltaba: no hay nada que pedir solo.
  if (opts.auto) {
    await resolveGaps(app, { chatIds: [chatId] }, now);
    if ((await openGaps(app, chatId)).length === 0) return { ok: false, error: 'rate_limited', code: 'no_gaps' };
  }
  const row = (await db.prepare('SELECT last_at, auto_count, claimed_until FROM wa_history_fetch WHERE app = ? AND chat_id = ?').get(app, chatId)) as
    | { last_at: string | null; auto_count: number; claimed_until: string | null }
    | undefined;
  const last = row?.last_at ? Date.parse(row.last_at) : 0;
  if (now - last < (opts.auto ? AUTO_CHAT_INTERVAL_MS : CHAT_MIN_INTERVAL_MS)) return { ok: false, error: 'rate_limited', code: 'chat' };
  if (opts.auto && Number(row?.auto_count ?? 0) >= AUTO_MAX) return { ok: false, error: 'rate_limited', code: 'auto_max' };
  if (await isRateLimited(lineKey(app, target.accountId), LINE_HOURLY_CAP, 3600)) return { ok: false, error: 'rate_limited', code: 'line' };
  // Claim: dos pedidos a la vez (dos pestañas, el cron) no salen los dos.
  await db
    .prepare(`INSERT INTO wa_history_fetch (app, chat_id, account_id, scope_id) VALUES (?, ?, ?, ?) ON CONFLICT(app, chat_id) DO NOTHING`)
    .run(app, chatId, target.accountId, target.scopeId);
  const claim = await db
    .prepare('UPDATE wa_history_fetch SET claimed_until = ? WHERE app = ? AND chat_id = ? AND (claimed_until IS NULL OR claimed_until < ?)')
    .run(iso(now + CLAIM_MS), app, chatId, iso(now));
  if (claim.changes === 0) return { ok: false, error: 'busy' };
  await rateLimit(lineKey(app, target.accountId), LINE_HOURLY_CAP, 3600);

  // Anclado en el primer mensaje posterior al hueco más viejo: lo que falta entra en lo que manda el teléfono.
  const gaps = await openGaps(app, chatId);
  const times = gaps.map((g) => g.msg_ts);
  const after = times.length && times.every((t) => typeof t === 'number' && t > 0) ? Math.min(...(times as number[])) - 1 : undefined;
  let outcome: FetchOutcome;
  try {
    let res: { requestId?: string; events?: InboundEvent[] };
    try {
      res = await provider.fetchHistory(target.jid, { count: HISTORY_COUNT, ...(after ? { after } : {}) });
    } catch (err) {
      // El gateway puede conocer el chat 1:1 solo por el otro id (lid ↔ teléfono).
      const alt = err instanceof ProviderError && err.code === 'not_found' && target.altJid ? await target.altJid().catch(() => '') : '';
      if (!alt) throw err;
      res = await provider.fetchHistory(alt, { count: HISTORY_COUNT, ...(after ? { after } : {}) });
    }
    const events = (res.events ?? []).map((e) => (e.type === 'message' ? { ...e, history: true } : e));
    if (events.length) await target.ingest(events);
    outcome = { ok: true, ...(res.requestId ? { requestId: res.requestId } : {}), delivered: events.filter((e) => e.type === 'message').length };
  } catch (err) {
    const code = err instanceof ProviderError ? err.code : 'error';
    // eslint-disable-next-line no-console
    console.warn(`[wa-history] ${app} fetch failed: ${code}`);
    outcome = { ok: false, error: code === 'not_connected' ? 'not_connected' : 'failed', code };
  }
  const end = nowFn();
  await db
    .prepare(
      `UPDATE wa_history_fetch SET claimed_until = NULL, due_at = NULL, last_at = ?, last_error = ?,
         auto_count = auto_count + ? WHERE app = ? AND chat_id = ?`,
    )
    .run(iso(end), outcome.ok ? '' : String(outcome.code ?? outcome.error).slice(0, 100), opts.auto ? 1 : 0, app, chatId);
  if (outcome.ok) {
    console.info(`[wa-history] ${app} fetch requested${outcome.requestId ? ` (${outcome.requestId.slice(0, 60)})` : ''}, gaps ${gaps.length}, delivered ${outcome.delivered}`);
    await resolveGaps(app, { chatIds: [chatId] }, end);
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// "Cargar mensajes anteriores"
// ---------------------------------------------------------------------------

/** Mensajes por pedido. */
export const OLDER_COUNT = 50;
/** Entre dos pedidos del mismo chat. Se duplica con cada pedido seguido que no trajo nada (hasta OLDER_MAX_INTERVAL_MS). */
export const OLDER_MIN_INTERVAL_MS = 4_000;
export const OLDER_MAX_INTERVAL_MS = 10 * 60_000;
/** Pedidos de mensajes anteriores por línea por hora (aparte de los de mensajes que faltan). */
export const OLDER_LINE_HOURLY_CAP = 40;
/** Pedidos seguidos sin nada nuevo después de los cuales se dice "no hay más" sin molestar al teléfono (hasta que pase la espera). */
export const OLDER_EMPTY_STOP = 2;

export type OlderOutcome =
  /** Salió el pedido. `delivered`: lo que ya llegó (un proveedor que responde en el momento); si no, llega por el webhook. */
  | { ok: true; delivered: number; pending: boolean }
  /** El teléfono ya no trajo nada las últimas veces: no hay mensajes anteriores (se vuelve a probar pasada la espera). */
  | { ok: true; none: true }
  | { ok: false; error: 'rate_limited' | 'unsupported' | 'not_connected' | 'busy' | 'failed' | 'empty_chat'; retryInMs?: number };

/** Cuánto hay que esperar entre pedidos de un chat según cuántos seguidos no trajeron nada. */
export function olderInterval(empty: number): number {
  return Math.min(OLDER_MAX_INTERVAL_MS, OLDER_MIN_INTERVAL_MS * 2 ** Math.max(0, Math.min(empty, 12)));
}

/**
 * Le pide al teléfono los OLDER_COUNT mensajes anteriores al más viejo que
 * tenemos guardado de este chat. Lo que manda llega como historial (por el
 * webhook, o en el momento si el proveedor lo devuelve) y se guarda con el
 * mismo camino que la importación: lo repetido no se duplica.
 *
 * - Un pedido por chat a la vez (claim de la fila, compartido con el de
 *   mensajes que faltan).
 * - Si el más viejo guardado es el mismo que en el pedido anterior, ese pedido
 *   no trajo nada: la espera hasta el próximo se duplica, y después de
 *   OLDER_EMPTY_STOP seguidos se responde "no hay más" sin pedirle nada al
 *   teléfono hasta que pase la espera.
 * - Tope por línea por hora (el teléfono hace el trabajo; muchos pedidos
 *   seguidos pueden marcar el número).
 */
export async function loadOlderHistory(target: FetchTarget, nowFn = () => Date.now()): Promise<OlderOutcome> {
  const db = getDb();
  const { app, chatId } = target;
  const now = nowFn();
  let provider: GroupsProvider;
  try {
    provider = target.provider();
  } catch {
    return { ok: false, error: 'not_connected' };
  }
  if (!provider.fetchHistory || !provider.caps.fetchHistory) return { ok: false, error: 'unsupported' };
  if (!target.connected) return { ok: false, error: 'not_connected' };
  const anchor = await target.oldest();
  if (!anchor) return { ok: false, error: 'empty_chat' };

  const row = (await db.prepare('SELECT older_at, older_anchor, older_empty FROM wa_history_fetch WHERE app = ? AND chat_id = ?').get(app, chatId)) as
    | { older_at: string | null; older_anchor: string; older_empty: number }
    | undefined;
  // ¿El pedido anterior trajo algo? Si el más viejo sigue siendo el mismo, no.
  const sameAnchor = !!row?.older_at && row.older_anchor === anchor.id;
  const empty = sameAnchor ? Number(row?.older_empty ?? 0) + 1 : 0;
  const last = row?.older_at ? Date.parse(row.older_at) : 0;
  const wait = olderInterval(sameAnchor ? Number(row?.older_empty ?? 0) : 0);
  if (last && now - last < wait) {
    // Ya se pidió desde este mismo mensaje y no trajo nada varias veces: no hay más (por ahora).
    if (sameAnchor && Number(row?.older_empty ?? 0) >= OLDER_EMPTY_STOP) return { ok: true, none: true };
    return { ok: false, error: 'busy', retryInMs: wait - (now - last) };
  }
  if (await isRateLimited(`wa-history-older:${app}:${target.accountId}`, OLDER_LINE_HOURLY_CAP, 3600)) return { ok: false, error: 'rate_limited' };

  await db
    .prepare(`INSERT INTO wa_history_fetch (app, chat_id, account_id, scope_id) VALUES (?, ?, ?, ?) ON CONFLICT(app, chat_id) DO NOTHING`)
    .run(app, chatId, target.accountId, target.scopeId);
  const claim = await db
    .prepare('UPDATE wa_history_fetch SET claimed_until = ? WHERE app = ? AND chat_id = ? AND (claimed_until IS NULL OR claimed_until < ?)')
    .run(iso(now + CLAIM_MS), app, chatId, iso(now));
  if (claim.changes === 0) return { ok: false, error: 'busy', retryInMs: 3000 };
  await rateLimit(`wa-history-older:${app}:${target.accountId}`, OLDER_LINE_HOURLY_CAP, 3600);

  let outcome: OlderOutcome;
  try {
    // `after`: para un gateway sin el parche del ancla, que busca en su base el primer mensaje posterior.
    const opts = { count: OLDER_COUNT, after: Math.max(1, anchor.timestamp - 1), anchor };
    let res: { requestId?: string; events?: InboundEvent[]; anchorId?: string };
    try {
      res = await provider.fetchHistory(target.jid, opts);
    } catch (err) {
      // El gateway puede conocer el chat 1:1 solo por el otro id (lid ↔ teléfono).
      const alt = err instanceof ProviderError && err.code === 'not_found' && target.altJid ? await target.altJid().catch(() => '') : '';
      if (!alt) throw err;
      res = await provider.fetchHistory(alt, opts);
    }
    const events = (res.events ?? []).map((e) => (e.type === 'message' ? { ...e, history: true } : e));
    if (events.length) await target.ingest(events);
    const delivered = events.filter((e) => e.type === 'message').length;
    // Lo trae el webhook: `pending`. Si el proveedor ya respondió (con o sin mensajes), no hay nada que esperar.
    outcome = { ok: true, delivered, pending: res.events === undefined };
    // eslint-disable-next-line no-console
    console.info(`[wa-history] ${app} older requested, anchored ${res.anchorId ? res.anchorId === anchor.id : 'unknown'}, delivered ${delivered}`);
  } catch (err) {
    const code = err instanceof ProviderError ? err.code : 'error';
    // eslint-disable-next-line no-console
    console.warn(`[wa-history] ${app} older failed: ${code}`);
    outcome = { ok: false, error: code === 'not_connected' ? 'not_connected' : 'failed' };
  }
  // Un pedido que falló no cuenta como "no trajo nada".
  await db
    .prepare('UPDATE wa_history_fetch SET claimed_until = NULL, older_at = ?, older_anchor = ?, older_empty = ? WHERE app = ? AND chat_id = ?')
    .run(iso(nowFn()), outcome.ok ? anchor.id : (row?.older_anchor ?? ''), outcome.ok ? empty : Number(row?.older_empty ?? 0), app, chatId);
  return outcome;
}

/** "Cargar mensajes anteriores" desde la pantalla (null: el chat no existe o no es de WhatsApp). */
export async function requestOlderHistory(app: GapApp, scopeId: string, chatId: string): Promise<OlderOutcome | null> {
  const target = await fetchTarget(app, scopeId, chatId);
  if (!target) return null;
  return loadOlderHistory(target);
}

/** La respuesta HTTP de "Cargar mensajes anteriores" (el texto lo pone la pantalla). */
export function olderResponse(out: OlderOutcome): { status: number; body: Record<string, unknown> } {
  if (out.ok) return { status: 200, body: 'none' in out ? { ok: true, none: true } : { ok: true, delivered: out.delivered, pending: out.pending } };
  switch (out.error) {
    case 'busy':
      // Hay un pedido en curso o recién hecho: la pantalla sigue esperando lo que traiga.
      return { status: 200, body: { ok: true, delivered: 0, pending: true, recent: true, retryInMs: out.retryInMs ?? 0 } };
    case 'empty_chat':
      return { status: 200, body: { ok: true, none: true } };
    case 'rate_limited':
      return { status: 429, body: { error: 'history_rate_limited' } };
    case 'not_connected':
      return { status: 409, body: { error: 'not_connected' } };
    case 'unsupported':
      return { status: 400, body: { error: 'unsupported' } };
    default:
      return { status: 502, body: { error: 'history_failed' } };
  }
}

/** El chat de cada app, listo para pedir su historial (null: no existe o no es de WhatsApp). */
export async function fetchTarget(app: GapApp, scopeId: string, chatId: string): Promise<FetchTarget | null> {
  return app === 'lines' ? linesTarget(scopeId, chatId) : inboxTarget(scopeId, chatId);
}

/** El ancla de un mensaje guardado (la hora, en segundos; en un grupo, quién lo mandó si hay teléfono). */
function anchorOf(id: string, fromMe: boolean, at: string, senderPhone: string): HistoryAnchor | null {
  // Las fechas de Lines pueden venir como "YYYY-MM-DD HH:MM:SS" (UTC).
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at.replace(' ', 'T')}Z`);
  if (!id || !Number.isFinite(ms)) return null;
  const phone = senderPhone.replace(/\D/g, '');
  return { id, fromMe, timestamp: Math.floor(ms / 1000), ...(phone.length >= 6 ? { participant: `${phone}@s.whatsapp.net` } : {}) };
}

async function linesTarget(ws: string, chatId: string): Promise<FetchTarget | null> {
  const chat = (await getDb().prepare('SELECT id, number_id, provider_chat_id FROM groups_chats WHERE id = ? AND user_id = ?').get(chatId, ws)) as
    | { id: string; number_id: string; provider_chat_id: string }
    | undefined;
  if (!chat) return null;
  const { getNumberRow, providerFor, ingestEvents } = await import('./groups');
  const number = await getNumberRow(ws, chat.number_id);
  if (!number) return null;
  const { altJid } = await import('./wa-archive-sync');
  return {
    app: 'lines',
    chatId: chat.id,
    accountId: number.id,
    scopeId: ws,
    connected: number.status === 'connected',
    provider: () => providerFor(number),
    jid: chat.provider_chat_id,
    altJid: () => altJid({ app: 'lines', accountId: number.id }, chat.provider_chat_id),
    ingest: async (events) => void (await ingestEvents(number, events, { history: true })),
    oldest: async () => {
      const m = (await getDb()
        .prepare(
          `SELECT provider_message_id AS id, direction, created_at, sender_phone FROM groups_messages
           WHERE chat_id = ? AND provider_message_id IS NOT NULL AND provider_message_id <> '' AND direction IN ('in', 'out')
           ORDER BY created_at ASC LIMIT 1`,
        )
        .get(chat.id)) as { id: string; direction: string; created_at: string; sender_phone: string } | undefined;
      return m ? anchorOf(m.id, m.direction === 'out', m.created_at, chat.provider_chat_id.endsWith('@g.us') && m.direction === 'in' ? m.sender_phone : '') : null;
    },
  };
}

async function inboxTarget(owner: string, threadId: string): Promise<FetchTarget | null> {
  const t = (await getDb().prepare('SELECT id, account_id, external_id, channel FROM inbox_threads WHERE id = ? AND owner_id = ?').get(threadId, owner)) as
    | { id: string; account_id: string; external_id: string; channel: string }
    | undefined;
  if (!t || t.channel !== 'whatsapp') return null;
  const { getAccount } = await import('./inbox/core');
  const { waProviderFor, ingestWhatsappEvents } = await import('./inbox/whatsapp');
  const account = await getAccount(owner, t.account_id).catch(() => null);
  if (!account) return null;
  const { altJid } = await import('./wa-archive-sync');
  return {
    app: 'inbox',
    chatId: t.id,
    accountId: account.id,
    scopeId: owner,
    connected: account.status === 'connected',
    provider: () => waProviderFor(account),
    jid: t.external_id,
    altJid: () => altJid({ app: 'inbox', accountId: account.id }, t.external_id),
    ingest: async (events) => void (await ingestWhatsappEvents(account, events, { history: true })),
    oldest: async () => {
      const m = (await getDb()
        .prepare("SELECT external_id AS id, from_me, sent_at, sender_handle FROM inbox_messages WHERE thread_id = ? AND external_id <> '' AND external_id NOT LIKE 'local-%' ORDER BY sent_at ASC LIMIT 1")
        .get(t.id)) as { id: string; from_me: number; sent_at: string; sender_handle: string } | undefined;
      return m ? anchorOf(m.id, Number(m.from_me) === 1, m.sent_at, t.external_id.endsWith('@g.us') && Number(m.from_me) !== 1 ? m.sender_handle : '') : null;
    },
  };
}

/**
 * La respuesta HTTP de un pedido desde la pantalla. A mano, los errores con su
 * código (el texto lo pone la pantalla); `auto`, siempre 200 (no se muestra).
 */
export function historyResponse(out: FetchOutcome, auto: boolean): { status: number; body: Record<string, unknown> } {
  if (out.ok) return { status: 200, body: { ok: true, delivered: out.delivered } };
  if (auto) return { status: 200, body: { ok: false, error: out.error } };
  // Este chat ya se pidió hace un momento (a mano, solo o en otra pestaña): el pedido salió, no es un error.
  if (out.error === 'busy' || out.code === 'chat') return { status: 200, body: { ok: true, delivered: 0, recent: true } };
  switch (out.error) {
    case 'rate_limited':
      return { status: 429, body: { error: 'history_rate_limited' } };
    case 'not_connected':
      return { status: 409, body: { error: 'not_connected' } };
    case 'unsupported':
      return { status: 400, body: { error: 'unsupported' } };
    default:
      return { status: 502, body: { error: 'history_failed' } };
  }
}

/** Pide el historial de un chat desde la pantalla (a mano o al abrirlo con la marca). */
export async function requestChatHistory(app: GapApp, scopeId: string, chatId: string, opts: { auto?: boolean } = {}): Promise<FetchOutcome | null> {
  const target = await fetchTarget(app, scopeId, chatId);
  if (!target) return null;
  return fetchChatHistory(target, opts);
}

/**
 * Cron de cada minuto: los pedidos agendados que ya tocan (claim en
 * fetchChatHistory) y el barrido de huecos (mensajes que llegaron por el
 * reenvío del teléfono, vencidos).
 */
export async function runHistoryFetches(opts: { limit?: number; deadline?: number } = {}, now = Date.now()): Promise<{ sent: number; skipped: number; resolved: number }> {
  const db = getDb();
  const resolved = (await resolveGaps('lines', {}, now)) + (await resolveGaps('inbox', {}, now));
  const rows = (await db
    .prepare('SELECT app, chat_id, scope_id FROM wa_history_fetch WHERE due_at IS NOT NULL AND due_at <= ? ORDER BY due_at LIMIT ?')
    .all(iso(now), Math.max(1, Math.min(opts.limit ?? 20, 100)))) as Array<{ app: GapApp; chat_id: string; scope_id: string }>;
  let sent = 0;
  let skipped = 0;
  for (const r of rows) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const target = await fetchTarget(r.app, r.scope_id, r.chat_id).catch(() => null);
    const out = target ? await fetchChatHistory(target, { auto: true }, () => Math.max(Date.now(), now)).catch(() => null) : null;
    if (out?.ok) sent++;
    else {
      skipped++;
      // Topado (la línea o el chat), ocupado o desconectado: se reintenta más tarde. Lo demás (sin huecos, sin chat, sin
      // soporte, el gateway lo rechazó) no se repite solo: queda el botón del menú.
      const retry = out && !out.ok && (out.code === 'line' || out.code === 'chat' || out.error === 'busy' || out.error === 'not_connected');
      await db
        .prepare('UPDATE wa_history_fetch SET due_at = ?, last_error = ? WHERE app = ? AND chat_id = ? AND (claimed_until IS NULL OR claimed_until < ?)')
        .run(retry ? iso(now + 15 * 60_000) : null, out && !out.ok ? String(out.code ?? out.error) : 'gone', r.app, r.chat_id, iso(now));
    }
  }
  // Lo cerrado hace más de un mes ya no sirve.
  await db.prepare('DELETE FROM wa_history_gaps WHERE resolved_at IS NOT NULL AND resolved_at < ?').run(iso(now - 30 * 86_400_000));
  return { sent, skipped, resolved };
}
