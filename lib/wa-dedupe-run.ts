/**
 * Inbox y Lines: juntar los chats de la misma persona (lid y teléfono) desde
 * la app, con lib/wa-dedupe.ts. Se llama al terminar cada tanda del webhook o
 * de la importación (con lo que esa tanda enseñó) y al terminar de leer la
 * libreta del servidor (todos los chats por lid de la cuenta o número).
 * Nunca rompe una tanda: si algo falla, se loguea y queda para la próxima.
 * Server-only.
 */
import { dbBatch, getDb } from './db';
import { rememberContacts, type ContactScope } from './wa-contacts';
import { contactPairsInsert, explicitPairsInsert, inboxSharedPairsInsert, runMerge, twinPairs, type ChatPair, type MergeCounts, type MessageSighting, type WaApp } from './wa-dedupe';

const EMPTY: MergeCounts = { merged: 0, renamed: 0, messages: 0 };

/**
 * Una corrida para una cuenta (Inbox) o un número (Lines). `lids`: solo esos
 * chats por lid (los que la tanda acaba de mapear); sin `lids`, todos.
 * `pairs`: pares ya resueltos por mensajes repetidos.
 */
export async function mergeLidChats(app: WaApp, scope: string, opts: { lids?: string[]; pairs?: ChatPair[]; all?: boolean } = {}): Promise<MergeCounts> {
  const lids = opts.lids?.filter(Boolean) ?? [];
  const pairs = opts.pairs ?? [];
  if (!opts.all && !lids.length && !pairs.length) return EMPTY;
  try {
    // Lo común (cada mensaje de quien tiene lid trae el par): no hay chat por lid que juntar. Una lectura por índice
    // lo descarta sin abrir una escritura.
    if (!opts.all && !pairs.length) {
      const t = app === 'inbox' ? { chats: 'inbox_threads', scope: 'account_id', jid: 'external_id' } : { chats: 'groups_chats', scope: 'number_id', jid: 'provider_chat_id' };
      const jids = lids.slice(0, 500).map((d) => `${d}@lid`);
      const hit = await getDb()
        .prepare(`SELECT 1 FROM ${t.chats} WHERE ${t.scope} = ? AND ${t.jid} IN (${jids.map(() => '?').join(',')}) LIMIT 1`)
        .get(scope, ...jids);
      if (!hit) return EMPTY;
    }
    return await runMerge(
      app,
      (run) => [
        ...(opts.all || lids.length ? [contactPairsInsert(app, run, { scope, ...(opts.all ? {} : { lids }) })] : []),
        ...(opts.all && app === 'inbox' ? [inboxSharedPairsInsert(run, { scope })] : []),
        ...explicitPairsInsert(app, run, scope, pairs),
      ],
      dbBatch,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[wa-dedupe] merge failed', app, (err as Error)?.message ?? 'error');
    return EMPTY;
  }
}

/** Lo que dos chats con el mismo mensaje recibido enseñan: el lid es de ese teléfono (va a la libreta). */
async function learnPairs(scope: ContactScope, pairs: ChatPair[]): Promise<void> {
  if (!pairs.length) return;
  await rememberContacts(
    scope,
    pairs.map((p) => ({ lid: p.lid, phone: p.phone })),
  ).catch(() => null);
}

/**
 * Inbox: mensajes recibidos de esta tanda que ya estaban en otro chat 1:1 de
 * la cuenta (uno por lid y el otro por teléfono) → pares para juntar.
 */
export async function inboxTwinsFromMessages(account: { id: string; owner_id: string }, externalIds: string[]): Promise<ChatPair[]> {
  const ids = [...new Set(externalIds.filter(Boolean))].slice(0, 2000);
  if (!ids.length) return [];
  const db = getDb();
  const repeated: string[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = (await db
      .prepare(`SELECT external_id FROM inbox_messages WHERE owner_id = ? AND external_id IN (${chunk.map(() => '?').join(',')}) AND from_me = 0 GROUP BY external_id HAVING COUNT(*) > 1`)
      .all(account.owner_id, ...chunk)) as Array<{ external_id: string }>;
    repeated.push(...rows.map((r) => r.external_id));
  }
  if (!repeated.length) return [];
  const sightings: MessageSighting[] = [];
  for (let i = 0; i < repeated.length; i += 200) {
    const chunk = repeated.slice(i, i + 200);
    const rows = (await db
      .prepare(
        `SELECT m.external_id AS k, m.thread_id AS c, t.external_id AS jid, t.kind FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id
         WHERE m.owner_id = ? AND m.external_id IN (${chunk.map(() => '?').join(',')}) AND m.from_me = 0 AND t.account_id = ?`,
      )
      .all(account.owner_id, ...chunk, account.id)) as Array<{ k: string; c: string; jid: string; kind: string }>;
    for (const r of rows) sightings.push({ key: r.k, chatId: r.c, jid: r.jid, dm: r.kind === 'dm', inbound: true });
  }
  const pairs = twinPairs(sightings);
  await learnPairs({ app: 'inbox', accountId: account.id, userId: account.owner_id }, pairs);
  return pairs;
}

/**
 * Lines: el id de WhatsApp es único por número, así que el mismo mensaje
 * recibido que llega a otro chat (por lid o por teléfono) se ignora. Si ese
 * otro chat es el gemelo, es la misma persona → par para juntar.
 */
export async function linesTwinsFromDuplicates(number: { id: string; user_id: string }, dups: Array<{ key: string; chatId: string; jid: string; dm: boolean }>): Promise<ChatPair[]> {
  const list = dups.filter((d) => d.key && d.dm).slice(0, 2000);
  if (!list.length) return [];
  const db = getDb();
  const sightings: MessageSighting[] = [];
  const keys = [...new Set(list.map((d) => d.key))];
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200);
    const rows = (await db
      .prepare(
        `SELECT m.provider_message_id AS k, m.chat_id AS c, m.direction, c.provider_chat_id AS jid, c.kind FROM groups_messages m JOIN groups_chats c ON c.id = m.chat_id
         WHERE m.number_id = ? AND m.provider_message_id IN (${chunk.map(() => '?').join(',')})`,
      )
      .all(number.id, ...chunk)) as Array<{ k: string; c: string; direction: string; jid: string; kind: string }>;
    for (const r of rows) sightings.push({ key: r.k, chatId: r.c, jid: r.jid, dm: r.kind === 'dm', inbound: r.direction === 'in' });
  }
  // El chat al que quería entrar cuenta como el mismo mensaje recibido solo si el guardado es recibido.
  const inbound = new Set(sightings.filter((s) => s.inbound).map((s) => s.key));
  for (const d of list) if (inbound.has(d.key)) sightings.push({ key: d.key, chatId: d.chatId, jid: d.jid, dm: true, inbound: true });
  const pairs = twinPairs(sightings);
  await learnPairs({ app: 'lines', accountId: number.id, userId: number.user_id }, pairs);
  return pairs;
}
