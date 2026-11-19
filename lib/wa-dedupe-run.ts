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
        ...(opts.all && app === 'inbox' ? [inboxSharedPairsInsert(run, { scope, own: true })] : []),
        ...explicitPairsInsert(app, run, scope, pairs),
      ],
      dbBatch,
      { mediaFiles: true, agentLinks: true, chatFolders: true },
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
 * Inbox: mensajes de esta tanda (recibidos o propios) que ya estaban en otro
 * chat 1:1 de la cuenta (uno por lid y el otro por teléfono) → pares para
 * juntar.
 */
export async function inboxTwinsFromMessages(account: { id: string; owner_id: string }, externalIds: string[]): Promise<ChatPair[]> {
  const ids = [...new Set(externalIds.filter((id) => id && !id.startsWith('local-')))].slice(0, 2000);
  if (!ids.length) return [];
  const db = getDb();
  const repeated: string[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = (await db
      .prepare(`SELECT external_id FROM inbox_messages WHERE owner_id = ? AND external_id IN (${chunk.map(() => '?').join(',')}) GROUP BY external_id HAVING COUNT(*) > 1`)
      .all(account.owner_id, ...chunk)) as Array<{ external_id: string }>;
    repeated.push(...rows.map((r) => r.external_id));
  }
  if (!repeated.length) return [];
  const sightings: MessageSighting[] = [];
  for (let i = 0; i < repeated.length; i += 200) {
    const chunk = repeated.slice(i, i + 200);
    const rows = (await db
      .prepare(
        `SELECT m.external_id AS k, m.thread_id AS c, m.from_me, t.external_id AS jid, t.kind FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id
         WHERE m.owner_id = ? AND m.external_id IN (${chunk.map(() => '?').join(',')}) AND t.account_id = ?`,
      )
      .all(account.owner_id, ...chunk, account.id)) as Array<{ k: string; c: string; from_me: number; jid: string; kind: string }>;
    for (const r of rows) sightings.push({ key: r.k, chatId: r.c, jid: r.jid, dm: r.kind === 'dm', inbound: Number(r.from_me) === 0 });
  }
  const pairs = twinPairs(sightings);
  await learnPairs({ app: 'inbox', accountId: account.id, userId: account.owner_id }, pairs);
  return pairs;
}

/**
 * Lines: el id de WhatsApp es único por número, así que el mismo mensaje
 * (recibido o propio) que llega a otro chat (por lid o por teléfono) se
 * ignora. Si ese otro chat es el gemelo, es la misma persona → par para juntar.
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
  // El chat al que quería entrar cuenta como otra vista del mismo mensaje (recibido o propio).
  const stored = new Map(sightings.map((s) => [s.key, s.inbound]));
  for (const d of list) if (stored.has(d.key)) sightings.push({ key: d.key, chatId: d.chatId, jid: d.jid, dm: true, inbound: stored.get(d.key)! });
  const pairs = twinPairs(sightings);
  await learnPairs({ app: 'lines', accountId: number.id, userId: number.user_id }, pairs);
  return pairs;
}

/**
 * Un lid sin par en la libreta (llegó sin el teléfono al lado) es de un
 * teléfono cuando la tanda lo ata a un mensaje que ya está guardado en el chat
 * 1:1 de ese teléfono, en la misma cuenta o número:
 * - el mismo mensaje (el eco de lo que mando, que WhatsApp devuelve con el lid);
 * - una respuesta por lid que cita un mensaje de ese chat (en un 1:1 solo se
 *   cita lo del mismo chat);
 * - la tilde de entregado o leído de lo que mandé a ese teléfono, que vuelve
 *   desde el lid.
 * Pasa aunque los dos chats ya tengan nombre y foto: el nombre no dice nada.
 * Los eventos de ese lid van al chat del teléfono, la libreta aprende el par y
 * un chat por lid que ya estaba se junta con el del teléfono. Un lid atado a
 * dos teléfonos no se toca. Una consulta por índice por tanda, solo si hay
 * eventos por lid.
 */
export async function routeLidByKnownMessages<E extends { type: string }>(app: WaApp, scope: ContactScope & { ownerId?: string }, events: E[]): Promise<E[]> {
  type M = { type: string; chatId?: string; isGroup?: boolean; fromMe?: boolean; providerMessageId?: string; replyToProviderId?: string; senderPhone?: string; chatLid?: string };
  const lidOf = (e: M) => (typeof e.chatId === 'string' && /^\d{5,24}@lid$/.test(e.chatId) && !e.isGroup ? e.chatId.slice(0, -4) : '');
  const usable = (k: unknown): k is string => typeof k === 'string' && k.length > 0 && !k.startsWith('local-');
  // Cada lid de la tanda con los ids de mensaje que lo atan a un chat.
  const ties: Array<{ lid: string; key: string }> = [];
  for (const e of events as unknown as M[]) {
    const lid = lidOf(e);
    if (!lid) continue;
    if (e.type === 'message') {
      if (usable(e.providerMessageId)) ties.push({ lid, key: e.providerMessageId });
      if (usable(e.replyToProviderId)) ties.push({ lid, key: e.replyToProviderId });
    } else if (e.type === 'status' && usable(e.providerMessageId)) ties.push({ lid, key: e.providerMessageId });
  }
  if (!ties.length) return events;
  const keys = [...new Set(ties.map((t) => t.key))].slice(0, 500);
  const marks = keys.map(() => '?').join(',');
  const rows = (
    app === 'inbox'
      ? await getDb()
          .prepare(
            `SELECT m.external_id AS k, t.external_id AS jid FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id
             WHERE m.owner_id = ? AND m.external_id IN (${marks}) AND t.account_id = ? AND t.kind = 'dm' AND t.external_id LIKE '%@s.whatsapp.net'`,
          )
          .all(scope.ownerId ?? scope.userId, ...keys, scope.accountId)
      : await getDb()
          .prepare(
            `SELECT m.provider_message_id AS k, c.provider_chat_id AS jid FROM groups_messages m JOIN groups_chats c ON c.id = m.chat_id
             WHERE m.number_id = ? AND m.provider_message_id IN (${marks}) AND c.kind = 'dm' AND c.provider_chat_id LIKE '%@s.whatsapp.net'`,
          )
          .all(scope.accountId, ...keys)
  ) as Array<{ k: string; jid: string }>;
  if (!rows.length) return events;
  const byKey = new Map<string, Set<string>>();
  for (const r of rows) byKey.set(r.k, (byKey.get(r.k) ?? new Set()).add(r.jid));
  const byLid = new Map<string, Set<string>>();
  for (const t of ties) for (const jid of byKey.get(t.key) ?? []) byLid.set(t.lid, (byLid.get(t.lid) ?? new Set()).add(jid));
  const route = new Map<string, string>();
  for (const [lid, jids] of byLid) {
    const phone = jids.size === 1 ? /^(\d{6,16})@s\.whatsapp\.net$/.exec([...jids][0])?.[1] : undefined;
    if (phone) route.set(lid, phone);
  }
  if (!route.size) return events;
  await rememberContacts(
    scope,
    [...route].map(([lid, phone]) => ({ lid, phone })),
  ).catch(() => null);
  // Un chat por lid que ya estaba (la respuesta llegó antes que la tilde): se junta con el del teléfono.
  await mergeLidChats(app, scope.accountId, { lids: [...route.keys()] });
  return events.map((e) => {
    const m = e as unknown as M;
    const phone = route.get(lidOf(m));
    if (!phone || m.type === 'status') return e;
    const next: M = { ...m, chatId: `${phone}@s.whatsapp.net` };
    if (m.type === 'message') {
      next.chatLid = m.chatLid || lidOf(m);
      if (!m.fromMe && !m.senderPhone) next.senderPhone = phone;
    }
    return next as unknown as E;
  });
}

/**
 * Inbox: lo que acabo de mandar desde la app quedó en el chat del teléfono;
 * si el eco de WhatsApp llegó antes (solo con el lid) y abrió otro chat, se
 * juntan ahora. Una lectura por índice; casi siempre no encuentra nada.
 */
export async function mergeAfterOwnSend(thread: { account_id: string; owner_id: string }, externalId: string): Promise<MergeCounts> {
  if (!externalId || externalId.startsWith('local-')) return EMPTY;
  const account = { id: thread.account_id, owner_id: thread.owner_id };
  const pairs = await inboxTwinsFromMessages(account, [externalId]).catch(() => [] as ChatPair[]);
  return pairs.length ? mergeLidChats('inbox', account.id, { pairs }) : EMPTY;
}
