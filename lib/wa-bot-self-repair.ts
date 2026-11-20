/**
 * Inbox y Lines: arreglo de una vez de los mensajes de otro que quedaron en
 * el chat con uno mismo antes de lib/wa-self-chat.ts.
 *
 * Cómo decide (solo lo comprobable):
 * - Al chat de Meta AI: el servidor de WhatsApp (Evolution) guarda ese mismo id
 *   bajo el id propio y su copia trae la marca de Meta AI (botMetadata,
 *   botMessageSecret, botInvokeMessage; isBotTraffic). Vale también para lo
 *   propio (lo que uno le escribió a Meta AI).
 * - Un mensaje recibido (no propio) sin esa marca: en el chat con uno mismo todo
 *   es propio, así que es de otra persona. Su lid no se guardó (Evolution lo
 *   reemplazó por el teléfono propio): va al chat por su nombre de perfil, como
 *   en vivo (unknownSenderJid).
 * - Lo propio sin marca, o que el servidor no tiene, queda donde está: puede
 *   ser un mensaje a uno mismo. Si el servidor no responde, esa cuenta no se toca.
 *
 * Sin `apply` solo cuenta. Idempotente: lo movido ya no está en el chat propio.
 * Si el chat de Meta AI ya tiene el mismo mensaje (Inbox, por el historial),
 * el del chat propio se borra (es el mismo id de WhatsApp). El informe tiene
 * solo cuentas: ni teléfonos, ni ids, ni contenido. No corre solo: lo corre
 * scripts/repair-wa-bot-self-chat.ts o MAINTENANCE_JOBS=bot-self-repair:dry
 * (y después :apply). Server-only.
 */
import { getDb } from './db';
import { META_AI_JID, phoneDigits, type HistorySource, type InboundEvent } from './groups-provider';
import { isOwnChat, META_AI_NAME, unknownSenderJid } from './wa-self-chat';

export interface BotSelfRepairCounts {
  /** Cuentas (líneas de Lines o cuentas de Inbox) con chat propio que se revisaron. */
  accounts: number;
  /** Mensajes del chat propio. */
  selfMessages: number;
  /** De esos, cuántos tiene el servidor bajo el id propio. */
  foundAtGateway: number;
  /** Se mueven (o se moverían) al chat de Meta AI. */
  moved: number;
  /** Recibidos sin marca de Meta AI: se mueven (o se moverían) al chat del nombre de quien los mandó. */
  movedBySender: number;
  /** Ya estaban también en el chat de Meta AI: se borra la copia del chat propio (Inbox). */
  duplicatesRemoved: number;
  /** Cuentas cuyo servidor no respondió (no se toca nada de ellas). */
  failed: number;
}

export interface BotSelfRepairReport {
  applied: boolean;
  inbox: BotSelfRepairCounts;
  lines: BotSelfRepairCounts;
}

/** El historial del servidor de una cuenta (para tests se reemplaza). */
export interface BotSelfRepairDeps {
  linesHistory?: (numberId: string) => Promise<HistorySource | undefined>;
  inboxHistory?: (accountId: string) => Promise<HistorySource | undefined>;
  /** Tope de páginas por chat (500 mensajes por página). */
  maxPages?: number;
}

const PAGE = 500;
const CHUNK = 100;

const zero = (): BotSelfRepairCounts => ({ accounts: 0, selfMessages: 0, foundAtGateway: 0, moved: 0, movedBySender: 0, duplicatesRemoved: 0, failed: 0 });

/**
 * Los ids del servidor que son de Meta AI con el id propio, y todos los que tiene bajo ese id. Pura: los eventos ya
 * vienen de evolutionMessageEvents (con `bot`).
 */
export function provenBotIds(events: InboundEvent[], ownPhone: string): { bot: Set<string>; seen: Set<string> } {
  const bot = new Set<string>();
  const seen = new Set<string>();
  for (const e of events) {
    if (e.type !== 'message' || e.isGroup) continue;
    seen.add(e.providerMessageId);
    if (e.bot && isOwnChat(e.chatId, ownPhone)) bot.add(e.providerMessageId);
  }
  return { bot, seen };
}

async function gatewayEvents(history: HistorySource, jid: string, maxPages: number): Promise<InboundEvent[]> {
  if (!history.messagePage) return history.messages(jid, PAGE);
  const out: InboundEvent[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await history.messagePage(jid, PAGE, page);
    out.push(...r.events);
    if (!r.more) break;
  }
  return out;
}

/**
 * Adónde va cada mensaje del chat propio: Meta AI si el servidor lo prueba, el chat del nombre de quien lo mandó si
 * es recibido; lo demás no se mueve. Pura.
 */
export function planSelfChatMoves(
  rows: Array<{ id: string; incoming: boolean; senderName: string }>,
  bot: Set<string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const target = bot.has(r.id) ? META_AI_JID : r.incoming ? unknownSenderJid(r.senderName) : '';
    if (!target) continue;
    out.set(target, [...(out.get(target) ?? []), r.id]);
  }
  return out;
}

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

async function defaultLinesHistory(numberId: string): Promise<HistorySource | undefined> {
  const { getNumberRowById, providerFor } = await import('./groups');
  const row = await getNumberRowById(numberId);
  return row ? providerFor(row).history : undefined;
}

async function defaultInboxHistory(accountId: string): Promise<HistorySource | undefined> {
  const { getAccountById } = await import('./inbox/core');
  const { waProviderFor } = await import('./inbox/whatsapp');
  const acc = await getAccountById(accountId);
  return acc ? waProviderFor(acc).history : undefined;
}

export async function repairBotSelfChat(opts: { apply: boolean }, deps: BotSelfRepairDeps = {}): Promise<BotSelfRepairReport> {
  const maxPages = deps.maxPages ?? 20;
  return {
    applied: opts.apply,
    lines: await repairLines(opts.apply, deps.linesHistory ?? defaultLinesHistory, maxPages),
    inbox: await repairInbox(opts.apply, deps.inboxHistory ?? defaultInboxHistory, maxPages),
  };
}

async function repairLines(apply: boolean, historyFor: (id: string) => Promise<HistorySource | undefined>, maxPages: number): Promise<BotSelfRepairCounts> {
  const db = getDb();
  const c = zero();
  const numbers = (await db
    .prepare("SELECT id, user_id, phone FROM groups_numbers WHERE provider IN ('evolution', 'managed') AND phone != ''")
    .all()) as Array<{ id: string; user_id: string; phone: string }>;
  for (const n of numbers) {
    const own = phoneDigits(n.phone);
    if (own.length < 8) continue;
    const self = (await db
      .prepare("SELECT id, provider_chat_id FROM groups_chats WHERE number_id = ? AND kind = 'dm' AND provider_chat_id IN (?, ?)")
      .get(n.id, `${own}@s.whatsapp.net`, `${own}@c.us`)) as { id: string; provider_chat_id: string } | undefined;
    if (!self) continue;
    const rows = ((await db
      .prepare('SELECT provider_message_id AS pid, direction, sender_name FROM groups_messages WHERE chat_id = ? AND provider_message_id IS NOT NULL')
      .all(self.id)) as Array<{ pid: string; direction: string; sender_name: string }>).map((r) => ({ id: r.pid, incoming: r.direction === 'in', senderName: r.sender_name }));
    if (!rows.length) continue;
    c.accounts++;
    c.selfMessages += rows.length;
    let proven: ReturnType<typeof provenBotIds>;
    try {
      const history = await historyFor(n.id);
      if (!history) throw new Error('no history');
      proven = provenBotIds(await gatewayEvents(history, self.provider_chat_id, maxPages), own);
    } catch {
      c.failed++;
      continue;
    }
    c.foundAtGateway += rows.filter((r) => proven.seen.has(r.id)).length;
    const plan = planSelfChatMoves(rows, proven.bot);
    for (const [jid, ids] of plan) {
      if (jid === META_AI_JID) c.moved += ids.length;
      else c.movedBySender += ids.length;
    }
    if (!apply || !plan.size) continue;
    const { refreshChatPreview, upsertChat } = await import('./groups');
    const touched = [self.id];
    for (const [jid, ids] of plan) {
      const name = jid === META_AI_JID ? META_AI_NAME : rows.find((r) => r.id === ids[0])?.senderName || '';
      const target = await upsertChat({ id: n.id, user_id: n.user_id }, { providerChatId: jid, kind: 'dm', name, phone: '' }, { silent: true });
      touched.push(target.id);
      for (const part of chunks(ids)) {
        await db
          .prepare(`UPDATE groups_messages SET chat_id = ? WHERE chat_id = ? AND number_id = ? AND provider_message_id IN (${part.map(() => '?').join(',')})`)
          .run(target.id, self.id, n.id, ...part);
      }
    }
    for (const chatId of touched) {
      const last = (await db
        .prepare("SELECT id, created_at FROM groups_messages WHERE chat_id = ? AND direction IN ('in', 'out') ORDER BY created_at DESC, rowid DESC LIMIT 1")
        .get(chatId)) as { id: string; created_at: string } | undefined;
      await db.prepare('UPDATE groups_chats SET last_message_at = ?, last_message_preview = ? WHERE id = ?').run(last?.created_at ?? null, '', chatId);
      if (last) await refreshChatPreview(last.id);
    }
    // El chat propio había tomado el nombre de quien escribía: si es uno de esos, vuelve a no tener nombre.
    const names = [...new Set(rows.filter((r) => r.incoming && r.senderName).map((r) => r.senderName))];
    if (names.length) {
      await db.prepare(`UPDATE groups_chats SET name = '' WHERE id = ? AND name IN (${names.map(() => '?').join(',')})`).run(self.id, ...names);
    }
  }
  return c;
}

async function repairInbox(apply: boolean, historyFor: (id: string) => Promise<HistorySource | undefined>, maxPages: number): Promise<BotSelfRepairCounts> {
  const db = getDb();
  const c = zero();
  const accounts = (await db
    .prepare("SELECT id, owner_id, kind, address FROM inbox_accounts WHERE kind = 'whatsapp' AND provider = 'managed' AND address != ''")
    .all()) as Array<{ id: string; owner_id: string; kind: 'whatsapp'; address: string }>;
  for (const a of accounts) {
    const own = phoneDigits(a.address);
    if (own.length < 8) continue;
    const self = (await db
      .prepare("SELECT id, external_id FROM inbox_threads WHERE account_id = ? AND kind = 'dm' AND external_id IN (?, ?)")
      .get(a.id, `${own}@s.whatsapp.net`, `${own}@c.us`)) as { id: string; external_id: string } | undefined;
    if (!self) continue;
    const rows = ((await db
      .prepare('SELECT external_id AS pid, from_me, sender_name FROM inbox_messages WHERE thread_id = ?')
      .all(self.id)) as Array<{ pid: string; from_me: number; sender_name: string }>).map((r) => ({ id: r.pid, incoming: !r.from_me, senderName: r.sender_name }));
    if (!rows.length) continue;
    c.accounts++;
    c.selfMessages += rows.length;
    let proven: ReturnType<typeof provenBotIds>;
    try {
      const history = await historyFor(a.id);
      if (!history) throw new Error('no history');
      proven = provenBotIds(await gatewayEvents(history, self.external_id, maxPages), own);
    } catch {
      c.failed++;
      continue;
    }
    c.foundAtGateway += rows.filter((r) => proven.seen.has(r.id)).length;
    const plan = planSelfChatMoves(rows, proven.bot);
    const { upsertThread } = await import('./inbox/core');
    const touched = [self.id];
    for (const [jid, ids] of plan) {
      if (jid === META_AI_JID) c.moved += ids.length;
      else c.movedBySender += ids.length;
      const existing = (await db.prepare('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?').get(a.id, jid)) as { id: string } | undefined;
      if (existing) {
        for (const part of chunks(ids)) {
          const r = (await db
            .prepare(`SELECT COUNT(*) AS n FROM inbox_messages WHERE thread_id = ? AND external_id IN (${part.map(() => '?').join(',')})`)
            .get(existing.id, ...part)) as { n: number };
          c.duplicatesRemoved += Number(r.n);
        }
      }
      if (!apply) continue;
      const title = jid === META_AI_JID ? META_AI_NAME : rows.find((r) => r.id === ids[0])?.senderName || undefined;
      const target = existing ?? (await upsertThread(a, { externalId: jid, kind: 'dm', title, handle: '' }));
      touched.push(target.id);
      for (const part of chunks(ids)) {
        const marks = part.map(() => '?').join(',');
        // UNIQUE (thread_id, external_id): el que ya está en el otro chat se queda; la copia del propio se va.
        await db.prepare(`UPDATE OR IGNORE inbox_messages SET thread_id = ? WHERE thread_id = ? AND external_id IN (${marks})`).run(target.id, self.id, ...part);
        await db.prepare(`DELETE FROM inbox_messages WHERE thread_id = ? AND external_id IN (${marks})`).run(self.id, ...part);
      }
    }
    if (!apply || !plan.size) continue;
    for (const threadId of touched) await refreshInboxThread(threadId);
    const names = [...new Set(rows.filter((r) => r.incoming && r.senderName).map((r) => r.senderName))];
    if (names.length) {
      await db.prepare(`UPDATE inbox_threads SET title = '' WHERE id = ? AND title IN (${names.map(() => '?').join(',')})`).run(self.id, ...names);
    }
  }
  return c;
}

/** La hora, la vista previa y quién habló último de un chat de Inbox, a partir de sus mensajes. */
async function refreshInboxThread(threadId: string): Promise<void> {
  const db = getDb();
  const last = (await db
    .prepare('SELECT body, media_name, from_me, sent_at FROM inbox_messages WHERE thread_id = ? ORDER BY sent_at DESC, rowid DESC LIMIT 1')
    .get(threadId)) as { body: string; media_name: string; from_me: number; sent_at: string } | undefined;
  await db
    .prepare(
      `UPDATE inbox_threads SET
         last_message_at = ?, preview = ?, last_from_me = ?,
         last_inbound_at = (SELECT MAX(sent_at) FROM inbox_messages WHERE thread_id = ? AND from_me = 0),
         last_outbound_at = (SELECT MAX(sent_at) FROM inbox_messages WHERE thread_id = ? AND from_me = 1)
       WHERE id = ?`,
    )
    .run(last?.sent_at ?? null, last ? (last.body || last.media_name).replace(/\s+/g, ' ').slice(0, 160) : '', last?.from_me ? 1 : 0, threadId, threadId, threadId);
}
