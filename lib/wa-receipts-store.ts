/**
 * Info del mensaje de WhatsApp (Lines e Inbox): guardar y leer las
 * confirmaciones de cada persona (tabla wa_message_receipts) y pedírselas al
 * gateway a demanda. Server-only. Lo puro está en lib/wa-receipts.ts.
 *
 * Carga: nada de esto agrega webhooks. Las confirmaciones de un 1:1 ya llegan
 * (status) y se guardan solo cuando cambian las tildes (como mucho tres
 * escrituras por mensaje). Las de un grupo se piden al gateway solo cuando
 * alguien abre la Info: un pedido por apertura, como mucho uno cada
 * RECEIPT_FETCH_GAP_MS por mensaje y por proceso, y ninguno durante
 * UNSUPPORTED_TTL_MS en una línea cuyo gateway no las da (404). Lo que trae se
 * guarda solo si cambió (una apertura repetida no escribe nada).
 */
import { getDb } from './db';
import type { GroupsProvider } from './groups-provider';
import { collapseReceipts, mergeReceipt, type GatewayReceipt, type ReceiptApp, type ReceiptInput, type ReceiptTimes } from './wa-receipts';

export interface ReceiptRow extends ReceiptTimes {
  participant: string;
}

/** Entre dos pedidos al gateway por el mismo mensaje (por proceso). */
export const RECEIPT_FETCH_GAP_MS = 15_000;
/** Una línea cuyo gateway respondió 404 no se vuelve a probar en este tiempo. */
export const UNSUPPORTED_TTL_MS = 10 * 60_000;
/** Lo más que se espera al gateway antes de mostrar lo guardado. */
export const RECEIPT_FETCH_TIMEOUT_MS = 6_000;

const lastFetch = new Map<string, { at: number; ok: boolean }>();
const unsupportedUntil = new Map<string, number>();

function prune<V>(map: Map<string, V>, before: number, at: (v: V) => number, max = 5000): void {
  if (map.size < max) return;
  for (const [k, v] of map) if (at(v) < before) map.delete(k);
  // Si sigue lleno (todo vigente), se va lo más viejo.
  while (map.size >= max) map.delete(map.keys().next().value as string);
}

/** Para los tests: olvida los pedidos recientes y las líneas sin soporte. */
export function resetReceiptFetchState(): void {
  lastFetch.clear();
  unsupportedUntil.clear();
}

export async function receiptRows(app: ReceiptApp, messageId: string): Promise<ReceiptRow[]> {
  const rows = (await getDb()
    .prepare('SELECT participant, delivered_at, read_at, played_at FROM wa_message_receipts WHERE app = ? AND message_id = ? LIMIT 2000')
    .all(app, messageId)) as Array<{ participant: string; delivered_at: string | null; read_at: string | null; played_at: string | null }>;
  return rows.map((r) => ({ participant: r.participant, deliveredAt: r.delivered_at, readAt: r.read_at, playedAt: r.played_at }));
}

const keepEarliest = (col: string) => `${col} = CASE WHEN excluded.${col} IS NOT NULL AND (${col} IS NULL OR excluded.${col} < ${col}) THEN excluded.${col} ELSE ${col} END`;

/**
 * Suma confirmaciones de un mensaje. Junta las repetidas, compara con lo
 * guardado y escribe solo lo que cambia, en tandas de 100 filas por sentencia.
 * El ON CONFLICT también se queda con la hora más temprana, así dos escrituras
 * a la vez no se pisan. Devuelve cuántas personas cambiaron.
 */
export async function storeReceipts(app: ReceiptApp, ownerId: string, messageId: string, list: readonly ReceiptInput[], now = new Date()): Promise<number> {
  const incoming = collapseReceipts(list);
  if (!incoming.size || !messageId || !ownerId) return 0;
  const saved = new Map((await receiptRows(app, messageId)).map((r) => [r.participant, r]));
  const changed: Array<[string, ReceiptTimes]> = [];
  for (const [participant, times] of incoming) {
    const m = mergeReceipt(saved.get(participant), times);
    if (m.changed) changed.push([participant, m.times]);
  }
  if (!changed.length) return 0;
  const at = now.toISOString();
  const db = getDb();
  for (let i = 0; i < changed.length; i += 100) {
    const chunk = changed.slice(i, i + 100);
    const args = chunk.flatMap(([p, t]) => [app, messageId, p, ownerId, t.deliveredAt, t.readAt, t.playedAt, at]);
    await db
      .prepare(
        `INSERT INTO wa_message_receipts (app, message_id, participant, owner_id, delivered_at, read_at, played_at, updated_at)
         VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
         ON CONFLICT (app, message_id, participant) DO UPDATE SET
           ${keepEarliest('delivered_at')}, ${keepEarliest('read_at')}, ${keepEarliest('played_at')}, updated_at = excluded.updated_at`,
      )
      .run(...args);
  }
  return changed.length;
}

/**
 * La confirmación de un 1:1 que llegó por el webhook (status), con la hora de
 * llegada. Se llama solo cuando las tildes avanzaron.
 */
export async function recordDirectReceipt(app: ReceiptApp, ownerId: string, messageId: string, status: string, played: boolean, now = new Date()): Promise<void> {
  const at = now.toISOString();
  const input: ReceiptInput =
    status === 'delivered' ? { participant: '', deliveredAt: at } : status === 'read' ? { participant: '', readAt: at, ...(played ? { playedAt: at } : {}) } : { participant: '' };
  if (!input.deliveredAt && !input.readAt) return;
  await storeReceipts(app, ownerId, messageId, [input], now);
}

export type LiveReceipts = { kind: 'ok'; list: GatewayReceipt[] } | { kind: 'recent' } | { kind: 'unsupported' } | { kind: 'skipped' } | { kind: 'failed' };

/** ¿Está apagado el pedido al gateway? (WA_GROUP_RECEIPTS_FETCH=0, para cortarlo sin deploy del gateway). */
export function receiptFetchDisabled(): boolean {
  return process.env.WA_GROUP_RECEIPTS_FETCH === '0';
}

/**
 * Pide al gateway las confirmaciones de un mensaje propio de un grupo.
 * `line` identifica la línea (para recordar que su gateway no las da).
 * - 'unsupported': el gateway no tiene el parche o lo tiene apagado (404), o el
 *   proveedor no las da.
 * - 'recent': se trajo bien hace menos de RECEIPT_FETCH_GAP_MS (lo guardado está al día).
 * - 'skipped': está apagado, o el último pedido (hace menos de RECEIPT_FETCH_GAP_MS) falló.
 * - 'failed': el gateway no respondió a tiempo o dio otro error.
 */
export async function fetchLiveReceipts(provider: GroupsProvider, line: string, chatId: string, providerMessageId: string, now = Date.now()): Promise<LiveReceipts> {
  if (!provider.messageReceipts) return { kind: 'unsupported' };
  if (receiptFetchDisabled()) return { kind: 'skipped' };
  if ((unsupportedUntil.get(line) ?? 0) > now) return { kind: 'unsupported' };
  const key = `${line}|${providerMessageId}`;
  const prev = lastFetch.get(key);
  if (prev && now - prev.at < RECEIPT_FETCH_GAP_MS) return { kind: prev.ok ? 'recent' : 'skipped' };
  prune(lastFetch, now - RECEIPT_FETCH_GAP_MS, (v) => v.at);
  const mark = { at: now, ok: false };
  lastFetch.set(key, mark);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), RECEIPT_FETCH_TIMEOUT_MS);
    });
    const res = await Promise.race([provider.messageReceipts(chatId, providerMessageId), timeout]);
    if (res === 'timeout') return { kind: 'failed' };
    if (res === null) {
      prune(unsupportedUntil, now, (v) => v);
      unsupportedUntil.set(line, now + UNSUPPORTED_TTL_MS);
      return { kind: 'unsupported' };
    }
    mark.ok = true;
    return { kind: 'ok', list: res };
  } catch {
    return { kind: 'failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
