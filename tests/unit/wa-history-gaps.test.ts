/**
 * Mensajes que WhatsApp no pudo entregar (Evolution con el parche 0002 de
 * infra/evolution): el aviso del webhook, el hueco en el chat, el pedido de
 * historial con sus topes y lo que llega del teléfono (sin duplicados, en su
 * lugar y sin avisos). Inbox y Lines, con el WhatsApp falso; nombres y números
 * inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { getThread, listMessages as listInboxMessages, type AccountRow } from '@/lib/inbox/core';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { evolutionProvider, parseEvolutionWebhook } from '@/lib/groups-provider-bridge';
import { fakeHistoryRequests, fakeProvider, resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getChat, getNumberRowById, ingestEvents, listMessages, type NumberRow } from '@/lib/groups';
import { rateLimit } from '@/lib/rate-limit';
import {
  AUTO_CHAT_INTERVAL_MS,
  AUTO_DELAY_MS,
  CHAT_MIN_INTERVAL_MS,
  LINE_HOURLY_CAP,
  historyResponse,
  openGaps,
  recordMissing,
  requestChatHistory,
  runHistoryFetches,
} from '@/lib/wa-history-gaps';
import type { InboundEvent } from '@/lib/groups-provider';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);

const uid = () => Math.random().toString(36).slice(2, 10);

function inbound(chatId: string, over: Record<string, unknown> = {}): Extract<InboundEvent, { type: 'message' }> {
  return {
    type: 'message' as const,
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: chatId.replace(/@.*/, ''),
    senderName: 'Julieta Prueba',
    providerMessageId: `m-${uid()}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  };
}

async function linesSetup(label: string): Promise<{ ws: string; number: NumberRow }> {
  const u = await makeUser(label);
  const n = await createNumber(u.id, u.id, { provider: 'fake' });
  await connectNumber(u.id, n.id);
  const s = fakeState(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return { ws: u.id, number: (await getNumberRowById(n.id))! };
}

async function inboxSetup(label: string): Promise<{ owner: string; account: AccountRow }> {
  const u = await makeUser(label);
  const { account } = await connectWhatsapp(u.id);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
  const s = fakeState(`inbox-${account.id}`);
  if (s) s.connectedAt = Date.now() - 5000;
  return { owner: u.id, account: { ...account, status: 'connected' } };
}

async function chatOf(numberId: string, jid: string): Promise<string> {
  const r = (await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(numberId, jid)) as { id: string };
  return r.id;
}

async function fetchRow(app: string, chatId: string) {
  return (await getDb().prepare('SELECT * FROM wa_history_fetch WHERE app = ? AND chat_id = ?').get(app, chatId)) as
    | { due_at: string | null; last_at: string | null; auto_count: number; last_error: string }
    | undefined;
}

describe('el aviso de Evolution (parche 0002)', () => {
  const T = 1_762_700_000;

  it('MESSAGES_UPSERT con zsUndecryptable → missing, con el teléfono si el chat vino por lid', () => {
    const body = {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '123456789012345@lid', remoteJidAlt: '5491100009001@s.whatsapp.net', fromMe: true, id: '3EB0MISSING1' },
        messageTimestamp: T,
        messageStubType: 'CIPHERTEXT',
        messageStubParameters: ['No session record'],
        zsUndecryptable: true,
      },
    };
    expect(parseEvolutionWebhook(body)).toEqual([
      { type: 'missing', chatId: '5491100009001@s.whatsapp.net', messageId: '3EB0MISSING1', fromMe: true, timestamp: new Date(T * 1000).toISOString() },
    ]);
  });

  it('sin la marca, sin id o en el historial no es un aviso; un mensaje normal sigue igual', () => {
    const stub = { key: { remoteJid: '5491100009002@s.whatsapp.net', fromMe: false, id: 'X1' }, messageStubType: 'CIPHERTEXT', messageTimestamp: T };
    expect(parseEvolutionWebhook({ event: 'messages.upsert', data: stub })).toEqual([]);
    expect(parseEvolutionWebhook({ event: 'messages.upsert', data: { ...stub, key: { remoteJid: '5491100009002@s.whatsapp.net' }, zsUndecryptable: true } })).toEqual([]);
    expect(parseEvolutionWebhook({ event: 'messages.set', data: [{ ...stub, zsUndecryptable: true }] })).toEqual([]);
    const normal = parseEvolutionWebhook({
      event: 'MESSAGES_UPSERT',
      data: { key: { remoteJid: '5491100009002@s.whatsapp.net', fromMe: false, id: 'OK1' }, message: { conversation: 'hola' }, messageTimestamp: T, pushName: 'Juli' },
    });
    expect(normal).toEqual([expect.objectContaining({ type: 'message', providerMessageId: 'OK1', body: 'hola' })]);
  });

  it('fetchHistory llama a /chat/fetchHistory con el chat, la cantidad y el ancla', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? 'null')) });
      return new Response(JSON.stringify({ requestId: 'REQ-1', anchor: { id: 'A1' }, count: 50 }), { status: 201, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;
    const p = evolutionProvider({ baseUrl: 'https://evo.example.test', apiKey: 'k', session: 'zs-abc' }, { fetch });
    expect(await p.fetchHistory!('5491100009003@s.whatsapp.net', { count: 500, after: T + 0.7 })).toEqual({ requestId: 'REQ-1' });
    expect(calls).toEqual([{ url: 'https://evo.example.test/chat/fetchHistory/zs-abc', body: { remoteJid: '5491100009003@s.whatsapp.net', count: 100, after: T } }]);
    expect(p.caps.fetchHistory).toBe(true);
  });
});

describe('Lines', () => {
  it('el aviso deja el hueco y la marca; si el mensaje llega (reenvío del teléfono) se cierra sin pedir historial', async () => {
    const { ws, number } = await linesSetup('wa-gap-a');
    const jid = '5491100009101@s.whatsapp.net';
    await ingestEvents(number, [inbound(jid, { providerMessageId: 'L-OLD' })]);
    const chatId = await chatOf(number.id, jid);
    const before = Date.now();
    await ingestEvents(number, [{ type: 'missing', chatId: jid, messageId: 'L-MISS', fromMe: true, timestamp: new Date().toISOString() }]);
    expect((await getChat(ws, chatId))?.historyGap).toBe(true);
    expect(await openGaps('lines', chatId)).toEqual([expect.objectContaining({ message_id: 'L-MISS', from_me: 1 })]);
    const row = await fetchRow('lines', chatId);
    expect(Date.parse(row!.due_at!)).toBeGreaterThanOrEqual(before + AUTO_DELAY_MS - 50);

    // Repetido: no hay otro hueco. Uno que ya está guardado: tampoco.
    expect(await recordMissing('lines', { chatId, accountId: number.id, scopeId: ws }, { type: 'missing', chatId: jid, messageId: 'L-MISS', fromMe: true })).toBe('known');
    expect(await recordMissing('lines', { chatId, accountId: number.id, scopeId: ws }, { type: 'missing', chatId: jid, messageId: 'L-OLD', fromMe: false })).toBe('stored');

    // El teléfono lo reenvía (llega en vivo con el mismo id): el cron lo ve, cierra el hueco y no pide nada.
    await ingestEvents(number, [inbound(jid, { providerMessageId: 'L-MISS', fromMe: true, body: 'lo que faltaba' })]);
    const out = await runHistoryFetches({}, Date.now() + AUTO_DELAY_MS + 1000);
    expect(out.resolved).toBeGreaterThanOrEqual(1);
    expect(fakeHistoryRequests(number.id)).toEqual([]);
    expect(await openGaps('lines', chatId)).toEqual([]);
    expect((await getChat(ws, chatId))?.historyGap).toBeUndefined();
    expect((await fetchRow('lines', chatId))?.due_at).toBeNull();
  });

  it('el cron pide el historial: llega una vez, en su lugar y sin avisos; el hueco se cierra', async () => {
    const { ws, number } = await linesSetup('wa-gap-b');
    const provider = fakeProvider(number.id);
    const jid = '5491100009102@s.whatsapp.net';
    const t0 = Date.now() - 10 * 60_000;
    const at = (min: number) => new Date(t0 + min * 60_000).toISOString();
    await ingestEvents(number, [inbound(jid, { providerMessageId: 'B1', body: 'uno', timestamp: at(0) })]);
    const chatId = await chatOf(number.id, jid);
    await getDb().prepare('UPDATE groups_chats SET unread_count = 0, awaiting_since = NULL WHERE id = ?').run(chatId);
    // El mensaje del medio no se pudo descifrar (lo manda el número falso como aviso); después llega otro.
    const withheld = inbound(jid, { providerMessageId: 'B2', body: 'dos', fromMe: false, timestamp: at(1) });
    await ingestEvents(number, provider.parseWebhook({ events: [{ type: 'fake_withheld', message: withheld }] }));
    await ingestEvents(number, [inbound(jid, { providerMessageId: 'B3', body: 'tres', fromMe: true, timestamp: at(2) })]);
    expect((await getChat(ws, chatId))?.historyGap).toBe(true);

    // Antes de la espera no sale nada; después, el pedido anclado justo antes del que falta.
    expect((await runHistoryFetches({}, Date.now())).sent).toBe(0);
    const out = await runHistoryFetches({}, Date.now() + AUTO_DELAY_MS + 1000);
    expect(out.sent).toBe(1);
    const reqs = fakeHistoryRequests(number.id);
    expect(reqs).toEqual([expect.objectContaining({ chatId: jid, count: 50, after: Math.floor(Date.parse(at(1)) / 1000) - 1 })]);

    const msgs = await listMessages(ws, chatId);
    expect(msgs.map((m) => m.body)).toEqual(['uno', 'dos', 'tres']);
    const chat = await getChat(ws, chatId);
    expect(chat?.historyGap).toBeUndefined();
    // Del historial: sin "sin leer" ni "esperando respuesta".
    expect(chat?.unread).toBe(0);
    expect(chat?.awaitingSince).toBeNull();

    // Si el historial lo vuelve a traer (Evolution manda la tanda entera), no se duplica.
    await ingestEvents(number, [{ ...withheld, history: true }], { history: true });
    expect((await listMessages(ws, chatId)).filter((m) => m.body === 'dos')).toHaveLength(1);
    expect((await fetchRow('lines', chatId))?.auto_count).toBe(1);
  });

  it('topes: uno a mano por chat cada tanto, los automáticos más espaciados y con máximo, y un cupo por línea', async () => {
    const { ws, number } = await linesSetup('wa-gap-c');
    const jid = '5491100009103@s.whatsapp.net';
    await ingestEvents(number, [inbound(jid, { providerMessageId: 'C1' })]);
    const chatId = await chatOf(number.id, jid);

    expect(await requestChatHistory('lines', ws, chatId)).toEqual(expect.objectContaining({ ok: true, delivered: 0 }));
    expect(await requestChatHistory('lines', ws, chatId)).toEqual({ ok: false, error: 'rate_limited', code: 'chat' });
    // Sin huecos, abrir el chat no pide nada.
    expect(await requestChatHistory('lines', ws, chatId, { auto: true })).toEqual({ ok: false, error: 'rate_limited', code: 'no_gaps' });

    await ingestEvents(number, [{ type: 'missing', chatId: jid, messageId: 'C-MISS', fromMe: false }]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + CHAT_MIN_INTERVAL_MS + 1000);
    // A mano ya se puede; solo, todavía no (más espaciado).
    expect(await requestChatHistory('lines', ws, chatId, { auto: true })).toEqual({ ok: false, error: 'rate_limited', code: 'chat' });
    expect((await requestChatHistory('lines', ws, chatId))?.ok).toBe(true);
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(Date.now() + AUTO_CHAT_INTERVAL_MS + 1000);
      expect((await requestChatHistory('lines', ws, chatId, { auto: true }))?.ok).toBe(true);
    }
    vi.setSystemTime(Date.now() + AUTO_CHAT_INTERVAL_MS + 1000);
    expect(await requestChatHistory('lines', ws, chatId, { auto: true })).toEqual({ ok: false, error: 'rate_limited', code: 'auto_max' });
    vi.useRealTimers();

    // El cupo de la línea (lo comparten todos sus chats).
    const other = '5491100009104@s.whatsapp.net';
    await ingestEvents(number, [inbound(other, { providerMessageId: 'C2' })]);
    const otherId = await chatOf(number.id, other);
    for (let i = 0; i < LINE_HOURLY_CAP; i++) await rateLimit(`wa-history:lines:${number.id}`, LINE_HOURLY_CAP, 3600);
    expect(await requestChatHistory('lines', ws, otherId)).toEqual({ ok: false, error: 'rate_limited', code: 'line' });
  });

  it('la respuesta HTTP: a mano con el código del error; automático, siempre 200', () => {
    expect(historyResponse({ ok: true, delivered: 2 }, false)).toEqual({ status: 200, body: { ok: true, delivered: 2 } });
    // El mismo chat hace un momento: el pedido ya salió (no es un error para quien toca el menú).
    expect(historyResponse({ ok: false, error: 'rate_limited', code: 'chat' }, false)).toEqual({ status: 200, body: { ok: true, delivered: 0, recent: true } });
    expect(historyResponse({ ok: false, error: 'rate_limited', code: 'line' }, false)).toEqual({ status: 429, body: { error: 'history_rate_limited' } });
    expect(historyResponse({ ok: false, error: 'failed', code: 'not_found' }, false)).toEqual({ status: 502, body: { error: 'history_failed' } });
    expect(historyResponse({ ok: false, error: 'not_connected' }, false).status).toBe(409);
    expect(historyResponse({ ok: false, error: 'rate_limited' }, true)).toEqual({ status: 200, body: { ok: false, error: 'rate_limited' } });
  });

  it('otro workspace no puede pedir el historial de un chat ajeno', async () => {
    const { number } = await linesSetup('wa-gap-d');
    const other = await makeUser('wa-gap-d2');
    const jid = '5491100009105@s.whatsapp.net';
    await ingestEvents(number, [inbound(jid, { providerMessageId: 'D1' })]);
    expect(await requestChatHistory('lines', other.id, await chatOf(number.id, jid))).toBeNull();
  });
});

describe('Inbox', () => {
  it('aviso, marca en el chat, pedido a mano que trae el mensaje en su lugar y cierra el hueco', async () => {
    const { owner, account } = await inboxSetup('wa-gap-i');
    const provider = fakeProvider(`inbox-${account.id}`);
    const jid = '5491100009201@s.whatsapp.net';
    const t0 = Date.now() - 10 * 60_000;
    const at = (min: number) => new Date(t0 + min * 60_000).toISOString();
    await ingestWhatsappEvents(account, [inbound(jid, { providerMessageId: 'I1', body: 'uno', timestamp: at(0) })]);
    const withheld = inbound(jid, { providerMessageId: 'I2', body: 'dos', fromMe: true, timestamp: at(1) });
    await ingestWhatsappEvents(account, provider.parseWebhook({ events: [{ type: 'fake_withheld', message: withheld }] }));
    await ingestWhatsappEvents(account, [inbound(jid, { providerMessageId: 'I3', body: 'tres', timestamp: at(2) })]);
    const t = (await getDb().prepare('SELECT id, unread FROM inbox_threads WHERE account_id = ? AND external_id = ?').get(account.id, jid)) as { id: string; unread: number };
    expect((await getThread(owner, t.id)).historyGap).toBe(true);

    const out = await requestChatHistory('inbox', owner, t.id);
    expect(out).toEqual(expect.objectContaining({ ok: true, delivered: 1 }));
    expect(fakeHistoryRequests(`inbox-${account.id}`)).toEqual([expect.objectContaining({ chatId: jid, after: Math.floor(Date.parse(at(1)) / 1000) - 1 })]);
    const page = await listInboxMessages(owner, t.id);
    expect(page.messages.map((m) => m.body)).toEqual(['uno', 'dos', 'tres']);
    const thread = await getThread(owner, t.id);
    expect(thread.historyGap).toBeUndefined();
    expect(thread.unread).toBe(t.unread);
    expect(await openGaps('inbox', t.id)).toEqual([]);

    // De nuevo desde el historial: no se duplica.
    await ingestWhatsappEvents(account, [{ ...withheld, history: true }], { history: true });
    expect((await listInboxMessages(owner, t.id)).messages.filter((m) => m.body === 'dos')).toHaveLength(1);
  });

  it('un aviso de un chat que no está en Inbox no crea nada', async () => {
    const { account } = await inboxSetup('wa-gap-j');
    await ingestWhatsappEvents(account, [{ type: 'missing', chatId: '5491100009202@s.whatsapp.net', messageId: 'J1', fromMe: false }]);
    const n = (await getDb().prepare("SELECT COUNT(*) AS n FROM wa_history_gaps WHERE app = 'inbox' AND account_id = ?").get(account.id)) as { n: number };
    expect(Number(n.n)).toBe(0);
  });
});
