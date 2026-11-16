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
 * - Al abrir un chat con la marca, la pantalla lo pide sola una vez (`auto`).
 * - "Traer mensajes que faltan" en el menú del chat (refreshChatHistory) le
 *   pide al teléfono, con anclas exactas, lo anterior a los huecos y los días
 *   anteriores al último mensaje, y dice qué trajo (refreshStatus).
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
  /** Los mensajes guardados del chat, para anclar "Traer mensajes que faltan" (refreshChatHistory). */
  stored: StoredMessages;
}

/** Un mensaje guardado como ancla, con su hora tal como está en la base (`at`, para contar hasta ahí). */
export type StoredAnchor = HistoryAnchor & { at: string };

export interface StoredMessages {
  /** El mensaje de WhatsApp guardado `offset` lugares antes del más nuevo (0: el más nuevo). */
  fromNewest: (offset: number) => Promise<StoredAnchor | null>;
  /** El primer mensaje guardado posterior a `ts` (segundos). */
  after: (ts: number) => Promise<StoredAnchor | null>;
  /** Cuántos mensajes hay guardados del chat hasta `at` inclusive. */
  countUpTo: (at: string) => Promise<number>;
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
  /** `anchor`: el gateway no pudo pedir desde nuestro mensaje más viejo (no lo tiene y no acepta el ancla): lo que mande ya lo tenemos. */
  | { ok: false; error: 'rate_limited' | 'unsupported' | 'not_connected' | 'busy' | 'failed' | 'empty_chat' | 'anchor'; retryInMs?: number };

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

  let outcome: OlderOutcome;
  try {
    await rateLimit(`wa-history-older:${app}:${target.accountId}`, OLDER_LINE_HOURLY_CAP, 3600);
    // El gateway puede conocer el chat 1:1 por el otro id (lid ↔ teléfono): si el pedido anterior no trajo nada, este
    // va con el otro.
    const asked = await askPhone(provider, target, anchor, OLDER_COUNT, empty % 2 === 1);
    // El gateway dijo desde qué mensaje pidió y no es el nuestro (no lo tiene guardado y no acepta el ancla): el
    // teléfono va a mandar lo que ya tenemos. No es "no hay más": es que desde acá no se puede pedir.
    // Lo trae el webhook: `pending`. Si el proveedor ya respondió (con o sin mensajes), no hay nada que esperar.
    outcome = asked.anchored !== false ? { ok: true, delivered: asked.delivered, pending: !asked.answered } : { ok: false, error: 'anchor' };
    // eslint-disable-next-line no-console
    console.info(`[wa-history] ${app} older requested, anchored ${asked.anchored}, delivered ${asked.delivered}`);
  } catch (err) {
    const code = err instanceof ProviderError ? err.code : 'error';
    // eslint-disable-next-line no-console
    console.warn(`[wa-history] ${app} older failed: ${code}`);
    outcome = { ok: false, error: code === 'not_connected' ? 'not_connected' : 'failed' };
  }
  // Un pedido que falló no cuenta como "no trajo nada" ni corre la espera: se puede reintentar enseguida.
  if (outcome.ok) {
    await db
      .prepare('UPDATE wa_history_fetch SET claimed_until = NULL, older_at = ?, older_anchor = ?, older_empty = ? WHERE app = ? AND chat_id = ?')
      .run(iso(nowFn()), anchor.id, empty, app, chatId);
  } else {
    await db.prepare('UPDATE wa_history_fetch SET claimed_until = NULL WHERE app = ? AND chat_id = ?').run(app, chatId);
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// "Traer mensajes que faltan"
// ---------------------------------------------------------------------------

/** Mensajes que se piden al teléfono por cada ancla. */
export const REFRESH_COUNT = 50;
/** Pedidos al teléfono por cada "Traer mensajes que faltan" (anclas distintas). */
export const REFRESH_REQUESTS = 3;
/** Entre una ventana y la anterior, en mensajes guardados (un poco menos que REFRESH_COUNT: se solapan). */
export const REFRESH_STEP = 45;
/** Un "Traer mensajes que faltan" por chat cada tanto (dos pestañas o dos toques siguen el mismo). */
export const REFRESH_MIN_INTERVAL_MS = 20_000;
/** "Traer mensajes que faltan" por línea por hora (cada uno son hasta REFRESH_REQUESTS pedidos al teléfono). */
export const REFRESH_LINE_HOURLY_CAP = 15;
/** Cuánto se espera la respuesta del teléfono antes de decir que no respondió. */
export const REFRESH_WAIT_MS = 40_000;

export type RefreshOutcome =
  /**
   * Salieron `requests` pedidos. `delivered`: lo que ya llegó (un proveedor que responde en el momento); lo demás llega
   * por el webhook y se sigue con refreshStatus. `answered`: el proveedor ya respondió. `recent`: este chat ya se pidió
   * hace un momento (otra pestaña, dos toques): no salió otro, se sigue ese.
   */
  | { ok: true; requests: number; delivered: number; answered: boolean; recent?: boolean }
  /** El chat no tiene ningún mensaje de WhatsApp guardado desde el que pedir. */
  | { ok: true; empty: true }
  /**
   * `gateway_outdated`: el gateway no aceptó ninguna de nuestras anclas (no tiene esos mensajes y no tiene el parche
   * 0006): lo que mande el teléfono no es lo que se pidió.
   */
  | { ok: false; error: 'rate_limited' | 'unsupported' | 'not_connected' | 'failed' | 'gateway_outdated' | 'busy' };

/**
 * Las anclas de un "Traer mensajes que faltan", sin repetir: el mensaje guardado justo después del hueco más viejo
 * (avisos `missing`), el último mensaje del chat (los días anteriores al último mensaje), el que sigue al hueco más
 * nuevo y, para ir más atrás, los que están REFRESH_STEP, 2 × REFRESH_STEP... lugares antes del último. Hasta
 * REFRESH_REQUESTS.
 */
export async function refreshAnchors(target: FetchTarget): Promise<StoredAnchor[]> {
  const gaps = (await openGaps(target.app, target.chatId)).map((g) => Number(g.msg_ts)).filter((t) => Number.isFinite(t) && t > 0);
  const newest = await target.stored.fromNewest(0);
  if (!newest) return [];
  const candidates: Array<() => Promise<StoredAnchor | null>> = [];
  if (gaps.length) candidates.push(() => target.stored.after(Math.min(...gaps)));
  candidates.push(async () => newest);
  if (gaps.length > 1) candidates.push(() => target.stored.after(Math.max(...gaps)));
  for (let k = 1; k <= REFRESH_REQUESTS; k++) candidates.push(() => target.stored.fromNewest(k * REFRESH_STEP));
  const out: StoredAnchor[] = [];
  for (const next of candidates) {
    if (out.length >= REFRESH_REQUESTS) break;
    const a = await next();
    if (a && !out.some((o) => o.id === a.id)) out.push(a);
  }
  return out;
}

interface RefreshRow {
  refresh_at: string | null;
  refresh_cut: string;
  refresh_base: number;
  refresh_answered: number;
  refresh_requests: number;
}

const REFRESH_COLS = 'refresh_at, refresh_cut, refresh_base, refresh_answered, refresh_requests';

/**
 * "Traer mensajes que faltan" (menú del chat, Inbox y Lines): le pide al teléfono los mensajes anteriores a varias
 * anclas que tenemos guardadas (refreshAnchors): alrededor de los huecos conocidos y los días anteriores al último
 * mensaje. Lo que manda llega como historial y se guarda sin duplicar (el id del mensaje en WhatsApp).
 *
 * Para poder decir qué pasó (refreshStatus) se anota cuántos mensajes había hasta el último guardado: lo que se suma
 * hasta ahí es lo que trajo el pedido (lo que llega en vivo es posterior). Que el teléfono respondió lo anota el
 * ingreso del historial (noteHistoryArrived) o el proveedor que responde en el momento.
 *
 * Topes: uno por chat cada REFRESH_MIN_INTERVAL_MS (claim de la fila, compartido con los otros pedidos de historial)
 * y REFRESH_LINE_HOURLY_CAP por línea por hora.
 */
export async function refreshChatHistory(target: FetchTarget, nowFn = () => Date.now()): Promise<RefreshOutcome> {
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

  const row = (await db.prepare(`SELECT ${REFRESH_COLS} FROM wa_history_fetch WHERE app = ? AND chat_id = ?`).get(app, chatId)) as RefreshRow | undefined;
  const recent = async (): Promise<RefreshOutcome> => {
    const st = await refreshStatus(target, nowFn);
    return { ok: true, requests: 0, delivered: st.state === 'idle' ? 0 : st.added, answered: st.state !== 'idle' && st.answered, recent: true };
  };
  if (row?.refresh_at && now - Date.parse(row.refresh_at) < REFRESH_MIN_INTERVAL_MS) return recent();
  const lineKey = `wa-history-refresh:${app}:${target.accountId}`;
  if (await isRateLimited(lineKey, REFRESH_LINE_HOURLY_CAP, 3600)) return { ok: false, error: 'rate_limited' };

  await db
    .prepare(`INSERT INTO wa_history_fetch (app, chat_id, account_id, scope_id) VALUES (?, ?, ?, ?) ON CONFLICT(app, chat_id) DO NOTHING`)
    .run(app, chatId, target.accountId, target.scopeId);
  const claim = await db
    .prepare('UPDATE wa_history_fetch SET claimed_until = ? WHERE app = ? AND chat_id = ? AND (claimed_until IS NULL OR claimed_until < ?)')
    .run(iso(now + CLAIM_MS), app, chatId, iso(now));
  // Otro pedido de historial de este chat en curso: si es un "Traer mensajes que faltan" reciente, se sigue ese; si es
  // otro ("Cargar mensajes anteriores", el automático), que se reintente en un momento.
  if (claim.changes === 0) return row?.refresh_at && now - Date.parse(row.refresh_at) < REFRESH_WAIT_MS ? recent() : { ok: false, error: 'busy' };
  const release = (sets = '', args: Array<string | number> = []) =>
    db.prepare(`UPDATE wa_history_fetch SET claimed_until = NULL${sets} WHERE app = ? AND chat_id = ?`).run(...args, app, chatId);

  try {
    await resolveGaps(app, { chatIds: [chatId] }, now);
    const anchors = await refreshAnchors(target);
    if (anchors.length === 0) {
      await release();
      return { ok: true, empty: true };
    }
    // Hasta el último mensaje guardado: lo que se sume hasta ahí lo trae este pedido.
    const cut = anchors.reduce((a, b) => (b.timestamp > a.timestamp ? b : a)).at;
    const base = await target.stored.countUpTo(cut);
    await db
      .prepare('UPDATE wa_history_fetch SET refresh_at = ?, refresh_cut = ?, refresh_base = ?, refresh_answered = 0, refresh_requests = 0 WHERE app = ? AND chat_id = ?')
      .run(iso(now), cut, base, app, chatId);
    await rateLimit(lineKey, REFRESH_LINE_HOURLY_CAP, 3600);

    let requests = 0;
    let delivered = 0;
    let answered = false;
    let elsewhere = 0;
    let failed = 0;
    let offline = false;
    for (const anchor of anchors) {
      try {
        const asked = await askPhone(provider, target, anchor, REFRESH_COUNT);
        requests++;
        delivered += asked.delivered;
        answered ||= asked.answered;
        if (asked.anchored === false) elsewhere++;
      } catch (err) {
        failed++;
        if (err instanceof ProviderError && err.code === 'not_connected') {
          offline = true;
          break;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.info(`[wa-history] ${app} refresh: anchors ${anchors.length}, sent ${requests}, elsewhere ${elsewhere}, failed ${failed}, delivered ${delivered}`);

    let outcome: RefreshOutcome;
    if (offline && requests === 0) outcome = { ok: false, error: 'not_connected' };
    else if (requests === 0) outcome = { ok: false, error: 'failed' };
    else if (elsewhere === requests && !answered) outcome = { ok: false, error: 'gateway_outdated' };
    else outcome = { ok: true, requests, delivered, answered };
    if (outcome.ok) {
      // `refresh_answered` puede haberlo puesto ya el ingreso del historial (noteHistoryArrived): solo se suma.
      await release(', refresh_requests = ?, refresh_answered = MAX(refresh_answered, ?)', [requests, answered ? 1 : 0]);
      await resolveGaps(app, { chatIds: [chatId] }, nowFn());
    } else {
      // Sin pedido que seguir: se puede reintentar enseguida.
      await release(', refresh_at = NULL');
    }
    return outcome;
  } catch (err) {
    await release(', refresh_at = NULL').catch(() => null);
    throw err;
  }
}

export type RefreshStatus =
  | { state: 'idle' }
  /** `added`: mensajes que se sumaron hasta el último guardado desde el pedido; `answered`: el teléfono respondió. */
  | { state: 'waiting' | 'done'; added: number; answered: boolean; elapsedMs: number };

/**
 * Cómo va el último "Traer mensajes que faltan" del chat. 'waiting' mientras el teléfono no respondió y no pasó
 * REFRESH_WAIT_MS; 'done' después (la pantalla dice "no respondió" si `answered` es false y no llegó nada).
 */
export async function refreshStatus(target: FetchTarget, nowFn = () => Date.now()): Promise<RefreshStatus> {
  const row = (await getDb().prepare(`SELECT ${REFRESH_COLS} FROM wa_history_fetch WHERE app = ? AND chat_id = ?`).get(target.app, target.chatId)) as
    | RefreshRow
    | undefined;
  if (!row?.refresh_at || !row.refresh_cut) return { state: 'idle' };
  const elapsedMs = Math.max(0, nowFn() - Date.parse(row.refresh_at));
  const added = Math.max(0, (await target.stored.countUpTo(row.refresh_cut)) - Number(row.refresh_base));
  const answered = Number(row.refresh_answered) === 1 || added > 0;
  return { state: answered || elapsedMs >= REFRESH_WAIT_MS ? 'done' : 'waiting', added, answered, elapsedMs };
}

/**
 * Llegó historial de WhatsApp para estos chats (ids de WhatsApp) de una línea: si alguno tenía un "Traer mensajes que
 * faltan" en curso, el teléfono respondió (aunque lo que mandó ya estuviera guardado). Una consulta por tanda.
 */
export async function noteHistoryArrived(app: GapApp, accountId: string, jids: Iterable<string>, now = Date.now()): Promise<void> {
  const list = [...new Set([...jids].filter(Boolean))].slice(0, 200);
  if (list.length === 0) return;
  const marks = list.map(() => '?').join(',');
  const chats =
    app === 'lines'
      ? `SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id IN (${marks})`
      : `SELECT id FROM inbox_threads WHERE account_id = ? AND external_id IN (${marks})`;
  await getDb()
    .prepare(
      `UPDATE wa_history_fetch SET refresh_answered = 1 WHERE app = ? AND account_id = ? AND refresh_answered = 0
         AND refresh_at IS NOT NULL AND refresh_at > ? AND chat_id IN (${chats})`,
    )
    .run(app, accountId, iso(now - 10 * 60_000), accountId, ...list);
}

/** "Traer mensajes que faltan" desde la pantalla (null: el chat no existe o no es de WhatsApp). */
export async function requestRefresh(app: GapApp, scopeId: string, chatId: string): Promise<RefreshOutcome | null> {
  const target = await fetchTarget(app, scopeId, chatId);
  if (!target) return null;
  return refreshChatHistory(target);
}

/** Cómo va el "Traer mensajes que faltan" de un chat (null: el chat no existe o no es de WhatsApp). */
export async function requestRefreshStatus(app: GapApp, scopeId: string, chatId: string): Promise<RefreshStatus | null> {
  const target = await fetchTarget(app, scopeId, chatId);
  if (!target) return null;
  return refreshStatus(target);
}

/** La respuesta HTTP de "Traer mensajes que faltan" (el texto lo pone la pantalla). */
export function refreshResponse(out: RefreshOutcome): { status: number; body: Record<string, unknown> } {
  if (out.ok) return { status: 200, body: 'empty' in out ? { ok: true, empty: true } : { ...out } };
  switch (out.error) {
    case 'rate_limited':
      return { status: 429, body: { error: 'history_rate_limited' } };
    case 'not_connected':
      return { status: 409, body: { error: 'not_connected' } };
    case 'unsupported':
      return { status: 400, body: { error: 'unsupported' } };
    case 'gateway_outdated':
      return { status: 502, body: { error: 'history_gateway_outdated' } };
    case 'busy':
      return { status: 503, body: { error: 'history_busy' } };
    default:
      return { status: 502, body: { error: 'history_failed' } };
  }
}

/** Lo que pasó con un pedido anclado al teléfono. */
interface Asked {
  /** Mensajes que el proveedor devolvió en el momento (y se guardaron). */
  delivered: number;
  /** El proveedor respondió en el momento (con o sin mensajes): no hay nada que esperar del webhook. */
  answered: boolean;
  /** El gateway pidió desde nuestro mensaje (true), desde otro suyo (false) o no dijo desde cuál ('unknown'). */
  anchored: boolean | 'unknown';
}

/**
 * Le pide al teléfono los `count` mensajes anteriores a `anchor` (un mensaje que tenemos guardado). Lo usan "Cargar
 * mensajes anteriores" y "Traer mensajes que faltan". Va con el ancla exacta (parche 0006 de infra/evolution) y con
 * `after` para un gateway sin ese parche, que busca en su base el primer mensaje posterior. El gateway puede conocer el
 * chat 1:1 por el otro id (lid ↔ teléfono): `preferAlt` pide primero con el otro; y si dice que no conoce el chat,
 * se reintenta con el otro. Lo que el proveedor devuelve en el momento se guarda como historial. Tira el error del
 * proveedor.
 */
async function askPhone(provider: GroupsProvider, target: FetchTarget, anchor: HistoryAnchor, count: number, preferAlt = false): Promise<Asked> {
  const fetchHistory = provider.fetchHistory!.bind(provider);
  const opts = { count, after: Math.max(1, anchor.timestamp - 1), anchor: { id: anchor.id, fromMe: anchor.fromMe, timestamp: anchor.timestamp, ...(anchor.participant ? { participant: anchor.participant } : {}) } };
  const alt = async () => (target.altJid ? await target.altJid().catch(() => '') : '');
  const first = preferAlt ? (await alt()) || target.jid : target.jid;
  let res: { requestId?: string; events?: InboundEvent[]; anchorId?: string };
  try {
    res = await fetchHistory(first, opts);
  } catch (err) {
    const other = err instanceof ProviderError && err.code === 'not_found' && first === target.jid ? await alt() : '';
    if (!other) throw err;
    res = await fetchHistory(other, opts);
  }
  const events = (res.events ?? []).map((e) => (e.type === 'message' ? { ...e, history: true } : e));
  if (events.length) await target.ingest(events);
  return {
    delivered: events.filter((e) => e.type === 'message').length,
    answered: res.events !== undefined,
    anchored: res.anchorId ? res.anchorId === anchor.id : 'unknown',
  };
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
    case 'anchor':
      return { status: 502, body: { error: 'history_anchor' } };
    default:
      return { status: 502, body: { error: 'history_failed' } };
  }
}

/** El chat de cada app, listo para pedir su historial (null: no existe o no es de WhatsApp). */
export async function fetchTarget(app: GapApp, scopeId: string, chatId: string): Promise<FetchTarget | null> {
  return app === 'lines' ? linesTarget(scopeId, chatId) : inboxTarget(scopeId, chatId);
}

/** El ancla de un mensaje guardado (la hora, en segundos; en un grupo, quién lo mandó si hay teléfono). */
function anchorOf(id: string, fromMe: boolean, at: string): HistoryAnchor | null {
  // Las fechas de Lines pueden venir como "YYYY-MM-DD HH:MM:SS" (UTC).
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at.replace(' ', 'T')}Z`);
  if (!id || !Number.isFinite(ms)) return null;
  return { id, fromMe, timestamp: Math.floor(ms / 1000) };
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
           ORDER BY created_at ASC, rowid ASC LIMIT 1`,
        )
        .get(chat.id)) as { id: string; direction: string; created_at: string; sender_phone: string } | undefined;
      return m ? anchorOf(m.id, m.direction === 'out', m.created_at) : null;
    },
    stored: storedMessages(
      `SELECT provider_message_id AS id, direction = 'out' AS from_me, created_at AS at FROM groups_messages
       WHERE chat_id = ? AND provider_message_id IS NOT NULL AND provider_message_id <> '' AND direction IN ('in', 'out')`,
      'created_at',
      'SELECT COUNT(*) AS n FROM groups_messages WHERE chat_id = ? AND julianday(created_at) <= julianday(?)',
      chat.id,
    ),
  };
}

async function inboxTarget(owner: string, threadId: string): Promise<FetchTarget | null> {
  const t = (await getDb().prepare('SELECT id, account_id, external_id, channel FROM inbox_threads WHERE id = ? AND owner_id = ? AND removed_at IS NULL').get(threadId, owner)) as
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
        .prepare("SELECT external_id AS id, from_me, sent_at, sender_handle FROM inbox_messages WHERE thread_id = ? AND external_id <> '' AND external_id NOT LIKE 'local-%' ORDER BY sent_at ASC, rowid ASC LIMIT 1")
        .get(t.id)) as { id: string; from_me: number; sent_at: string; sender_handle: string } | undefined;
      return m ? anchorOf(m.id, Number(m.from_me) === 1, m.sent_at) : null;
    },
    stored: storedMessages(
      "SELECT external_id AS id, from_me, sent_at AS at FROM inbox_messages WHERE thread_id = ? AND external_id <> '' AND external_id NOT LIKE 'local-%'",
      'sent_at',
      'SELECT COUNT(*) AS n FROM inbox_messages WHERE thread_id = ? AND julianday(sent_at) <= julianday(?)',
      t.id,
    ),
  };
}

/**
 * Las consultas de anclas sobre los mensajes de un chat. `select` filtra los mensajes de WhatsApp del chat (el primer
 * `?` es el chat) y devuelve id, from_me y at; `col` es la columna de la hora. Las horas pueden venir como ISO o como
 * "YYYY-MM-DD HH:MM:SS": se comparan con julianday.
 */
function storedMessages(select: string, col: string, count: string, chatId: string): StoredMessages {
  type Row = { id: string; from_me: number; at: string };
  const toAnchor = (m: Row | undefined): StoredAnchor | null => {
    const a = m ? anchorOf(m.id, Number(m.from_me) === 1, m.at) : null;
    return a && m ? { ...a, at: m.at } : null;
  };
  return {
    fromNewest: async (offset) =>
      toAnchor((await getDb().prepare(`${select} ORDER BY julianday(${col}) DESC, rowid DESC LIMIT 1 OFFSET ?`).get(chatId, Math.max(0, Math.floor(offset)))) as Row | undefined),
    after: async (ts) =>
      toAnchor((await getDb().prepare(`${select} AND julianday(${col}) > julianday(?, 'unixepoch') ORDER BY julianday(${col}) ASC, rowid ASC LIMIT 1`).get(chatId, Math.floor(ts))) as Row | undefined),
    countUpTo: async (at) => Number(((await getDb().prepare(count).get(chatId, at)) as { n: number } | undefined)?.n ?? 0),
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
