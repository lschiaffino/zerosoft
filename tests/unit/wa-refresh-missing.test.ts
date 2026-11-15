/**
 * "Traer mensajes que faltan" (Inbox y Lines): el pedido al teléfono sale
 * anclado en mensajes que tenemos (después de los huecos, el último y más
 * atrás), lo que llega se guarda sin duplicar, y la pantalla puede decir qué
 * pasó: cuántos trajo, que no faltaba nada, que el teléfono no respondió, que
 * la línea está desconectada o topada, o que el gateway no acepta el ancla.
 * Con el WhatsApp falso; números, nombres y textos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { findThread, getAccountById, type AccountRow } from '@/lib/inbox/core';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, type NumberRow } from '@/lib/groups';
import { fakeHistoryRequests, fakeProvider, FAKE_ELSEWHERE_PREFIX, FAKE_OLDER_PREFIX, FAKE_SILENT_PREFIX, resetFakeProvider } from '@/lib/groups-provider-fake';
import type { InboundEvent } from '@/lib/groups-provider';
import { rateLimit } from '@/lib/rate-limit';
import {
  REFRESH_COUNT,
  REFRESH_LINE_HOURLY_CAP,
  REFRESH_MIN_INTERVAL_MS,
  REFRESH_REQUESTS,
  REFRESH_STEP,
  REFRESH_WAIT_MS,
  fetchTarget,
  noteHistoryArrived,
  openGaps,
  refreshAnchors,
  refreshChatHistory,
  refreshResponse,
  refreshStatus,
  requestRefresh,
  requestRefreshStatus,
} from '@/lib/wa-history-gaps';
import { finalState, replyState } from '@/components/groups/wa/refresh-state';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function linked(id: string) {
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);
  if (s) s.connectedAt = Date.now() - 5000;
}

const uniq = () => Math.random().toString(36).slice(2, 10);
const phone = (prefix = '5491100') => `${prefix}${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

function msg(chatId: string, id: string, minutesAgo: number, body: string, fromMe = false): Extract<InboundEvent, { type: 'message' }> {
  return {
    type: 'message',
    chatId,
    isGroup: false,
    fromMe,
    senderPhone: fromMe ? '' : chatId.replace(/@.*/, ''),
    senderName: fromMe ? '' : 'Contacto de prueba',
    providerMessageId: id,
    body,
    timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

async function lines(label: string): Promise<{ ws: string; number: NumberRow }> {
  const u = await makeUser(label);
  const n = await createNumber(u.id, u.id, { provider: 'fake' });
  await connectNumber(u.id, n.id);
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  linked(n.id);
  return { ws: u.id, number: (await getNumberRowById(n.id))! };
}

async function inbox(label: string): Promise<{ owner: string; account: AccountRow }> {
  const u = await makeUser(label);
  const { account: a } = await connectWhatsapp(u.id);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
  linked(`inbox-${a.id}`);
  return { owner: u.id, account: (await getAccountById(a.id))! };
}

async function chatOf(numberId: string, jid: string): Promise<string> {
  return ((await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(numberId, jid)) as { id: string }).id;
}

const linesBodies = async (chatId: string) =>
  ((await getDb().prepare('SELECT body FROM groups_messages WHERE chat_id = ? ORDER BY created_at, rowid').all(chatId)) as Array<{ body: string }>).map((r) => r.body);
const linesDupes = async (chatId: string) =>
  Number(
    ((await getDb().prepare('SELECT COUNT(*) AS n FROM (SELECT provider_message_id FROM groups_messages WHERE chat_id = ? GROUP BY provider_message_id HAVING COUNT(*) > 1)').get(chatId)) as { n: number })
      .n,
  );

describe('la respuesta a la pantalla', () => {
  it('cada resultado con su status; la pantalla saca de ahí el estado final', () => {
    expect(refreshResponse({ ok: true, requests: 2, delivered: 1, answered: true })).toEqual({ status: 200, body: { ok: true, requests: 2, delivered: 1, answered: true } });
    expect(refreshResponse({ ok: true, empty: true })).toEqual({ status: 200, body: { ok: true, empty: true } });
    expect(refreshResponse({ ok: false, error: 'not_connected' })).toEqual({ status: 409, body: { error: 'not_connected' } });
    expect(refreshResponse({ ok: false, error: 'rate_limited' })).toEqual({ status: 429, body: { error: 'history_rate_limited' } });
    expect(refreshResponse({ ok: false, error: 'gateway_outdated' })).toEqual({ status: 502, body: { error: 'history_gateway_outdated' } });
    expect(refreshResponse({ ok: false, error: 'failed' })).toEqual({ status: 502, body: { error: 'history_failed' } });
    expect(refreshResponse({ ok: false, error: 'unsupported' }).status).toBe(400);
    expect(refreshResponse({ ok: false, error: 'busy' })).toEqual({ status: 503, body: { error: 'history_busy' } });
    expect(replyState({ status: 503, error: 'history_busy' })).toBe('error');

    expect(replyState({ status: 409, error: 'not_connected' })).toBe('offline');
    expect(replyState({ status: 429 })).toBe('limited');
    expect(replyState({ status: 502, error: 'history_gateway_outdated' })).toBe('outdated');
    expect(replyState({ status: 502, error: 'history_failed' })).toBe('error');
    expect(replyState({ status: 0 })).toBe('error');
    expect(replyState({ status: 200, empty: true })).toBe('none');
    expect(replyState({ status: 200, requests: 3 })).toBeNull();
    expect(finalState(4, true)).toBe('done');
    expect(finalState(4, false)).toBe('done');
    expect(finalState(0, true)).toBe('none');
    expect(finalState(0, false)).toBe('noanswer');
  });
});

describe('Lines', () => {
  it('un mensaje que se perdió sin aviso (la línea caída): se pide antes del último y vuelve, una sola vez', async () => {
    const { ws, number } = await lines('rm-l1');
    const provider = fakeProvider(number.id);
    const jid = `${phone()}@s.whatsapp.net`;
    const tag = uniq();
    await ingestEvents(number, [msg(jid, `a-${tag}`, 30, 'uno')]);
    // El del medio solo lo tiene el teléfono (sin aviso de que falta).
    await ingestEvents(number, provider.parseWebhook({ events: [{ type: 'fake_dropped', message: msg(jid, `b-${tag}`, 20, 'dos', true) }] }));
    await ingestEvents(number, [msg(jid, `c-${tag}`, 10, 'tres')]);
    const chatId = await chatOf(number.id, jid);
    expect(await linesBodies(chatId)).toEqual(['uno', 'tres']);
    expect(await openGaps('lines', chatId)).toEqual([]);

    const out = await requestRefresh('lines', ws, chatId);
    expect(out).toEqual({ ok: true, requests: 1, delivered: 1, answered: true });
    // Anclado en el último guardado, con `after` para un gateway sin el parche del ancla.
    expect(fakeHistoryRequests(number.id)).toEqual([expect.objectContaining({ chatId: jid, count: REFRESH_COUNT, anchorId: `c-${tag}` })]);
    expect(await linesBodies(chatId)).toEqual(['uno', 'dos', 'tres']);
    expect(await requestRefreshStatus('lines', ws, chatId)).toMatchObject({ state: 'done', added: 1, answered: true });

    // Otra vez lo mismo desde el historial: no se duplica, y el estado sigue diciendo 1.
    await ingestEvents(number, [{ ...msg(jid, `b-${tag}`, 20, 'dos', true), history: true }], { history: true });
    expect(await linesDupes(chatId)).toBe(0);
    expect(await requestRefreshStatus('lines', ws, chatId)).toMatchObject({ added: 1 });
    // Otro workspace no llega.
    const other = await makeUser('rm-l1b');
    expect(await requestRefresh('lines', other.id, chatId)).toBeNull();
    expect(await requestRefreshStatus('lines', other.id, chatId)).toBeNull();
  });

  it('con un hueco avisado, el primer pedido se ancla en el mensaje que sigue al hueco y el hueco se cierra', async () => {
    const { ws, number } = await lines('rm-l2');
    const provider = fakeProvider(number.id);
    const jid = `${phone()}@s.whatsapp.net`;
    const tag = uniq();
    await ingestEvents(number, [msg(jid, `a-${tag}`, 50, 'uno')]);
    await ingestEvents(number, provider.parseWebhook({ events: [{ type: 'fake_withheld', message: msg(jid, `b-${tag}`, 40, 'dos') }] }));
    await ingestEvents(number, [msg(jid, `c-${tag}`, 30, 'tres'), msg(jid, `d-${tag}`, 5, 'cuatro')]);
    const chatId = await chatOf(number.id, jid);
    expect(await openGaps('lines', chatId)).toHaveLength(1);

    const target = (await fetchTarget('lines', ws, chatId))!;
    expect((await refreshAnchors(target)).map((a) => a.id)).toEqual([`c-${tag}`, `d-${tag}`]);
    expect(await refreshChatHistory(target)).toMatchObject({ ok: true, requests: 2, delivered: 1 });
    expect(fakeHistoryRequests(number.id).map((r) => r.anchorId)).toEqual([`c-${tag}`, `d-${tag}`]);
    expect(await linesBodies(chatId)).toEqual(['uno', 'dos', 'tres', 'cuatro']);
    expect(await openGaps('lines', chatId)).toEqual([]);
  });

  it('va más atrás del último: hasta REFRESH_REQUESTS anclas separadas por REFRESH_STEP mensajes', async () => {
    const { ws, number } = await lines('rm-l3');
    const jid = `${phone()}@s.whatsapp.net`;
    const tag = uniq();
    const many = Array.from({ length: 120 }, (_, i) => msg(jid, `m${i}-${tag}`, 300 - i, `n${i}`));
    await ingestEvents(number, many, { history: true });
    const chatId = await chatOf(number.id, jid);
    const anchors = await refreshAnchors((await fetchTarget('lines', ws, chatId))!);
    expect(anchors.map((a) => a.id)).toEqual([`m119-${tag}`, `m${119 - REFRESH_STEP}-${tag}`, `m${119 - 2 * REFRESH_STEP}-${tag}`]);
    expect(anchors).toHaveLength(REFRESH_REQUESTS);
    // Las anclas llevan su hora en segundos.
    expect(anchors[0].timestamp).toBe(Math.floor(Date.parse(many[119].timestamp!) / 1000));
  });

  it('el teléfono con historial anterior: lo que manda se guarda sin duplicar aunque las ventanas se solapen', async () => {
    const { ws, number } = await lines('rm-l4');
    const jid = `${phone(FAKE_OLDER_PREFIX)}@s.whatsapp.net`;
    const tag = uniq();
    await ingestEvents(number, [msg(jid, `a-${tag}`, 10, 'uno')]);
    const chatId = await chatOf(number.id, jid);
    const target = (await fetchTarget('lines', ws, chatId))!;
    let now = Date.now();
    expect(await refreshChatHistory(target, () => now)).toMatchObject({ ok: true, requests: 1, delivered: REFRESH_COUNT });
    now += REFRESH_MIN_INTERVAL_MS + 1;
    // Ahora hay 51: anclas en el último y en el que está REFRESH_STEP antes; el teléfono manda lo que ya está y más.
    expect(await refreshChatHistory(target, () => now)).toMatchObject({ ok: true, requests: 2 });
    expect(await linesDupes(chatId)).toBe(0);
  });
});

describe('estados', () => {
  it('el teléfono no responde: espera, y después de REFRESH_WAIT_MS sale "no respondió"; si llega historial, respondió', async () => {
    const { owner, account } = await inbox('rm-i1');
    const jid = `${phone(FAKE_SILENT_PREFIX)}@s.whatsapp.net`;
    const tag = uniq();
    await ingestWhatsappEvents(account, [msg(jid, `a-${tag}`, 30, 'uno'), msg(jid, `b-${tag}`, 10, 'dos')]);
    const thread = (await findThread(account.id, jid))!;
    const target = (await fetchTarget('inbox', owner, thread.id))!;
    let now = Date.now();
    const clock = () => now;
    expect(await refreshChatHistory(target, clock)).toEqual({ ok: true, requests: 1, delivered: 0, answered: false });
    expect(await refreshStatus(target, clock)).toMatchObject({ state: 'waiting', added: 0, answered: false });
    now += REFRESH_WAIT_MS;
    expect(await refreshStatus(target, clock)).toMatchObject({ state: 'done', added: 0, answered: false });

    // Dos toques seguidos: el segundo sigue al primero (no sale otro pedido).
    now = Date.now() + 1000;
    expect(await refreshChatHistory(target, clock)).toMatchObject({ ok: true, requests: 0, recent: true });
    expect(fakeHistoryRequests(`inbox-${account.id}`)).toHaveLength(1);

    // Llega el historial por el webhook con lo que ya teníamos: respondió, no faltaba nada.
    await ingestWhatsappEvents(account, [{ ...msg(jid, `a-${tag}`, 30, 'uno'), history: true }], { history: true });
    expect(await refreshStatus(target, clock)).toMatchObject({ state: 'done', added: 0, answered: true });
  });

  it('con otro pedido de historial del chat en curso ("Cargar mensajes anteriores"), no sale y se puede reintentar', async () => {
    const { ws, number } = await lines('rm-l8');
    const jid = `${phone()}@s.whatsapp.net`;
    await ingestEvents(number, [msg(jid, `a-${uniq()}`, 10, 'uno')]);
    const chatId = await chatOf(number.id, jid);
    await getDb()
      .prepare("INSERT INTO wa_history_fetch (app, chat_id, account_id, scope_id, claimed_until) VALUES ('lines', ?, ?, ?, ?)")
      .run(chatId, number.id, ws, new Date(Date.now() + 30_000).toISOString());
    expect(await requestRefresh('lines', ws, chatId)).toEqual({ ok: false, error: 'busy' });
    expect(fakeHistoryRequests(number.id)).toHaveLength(0);
    await getDb().prepare("UPDATE wa_history_fetch SET claimed_until = NULL WHERE app = 'lines' AND chat_id = ?").run(chatId);
    expect(await requestRefresh('lines', ws, chatId)).toMatchObject({ ok: true, requests: 1 });
  });

  it('el historial de otro chat no cuenta como respuesta', async () => {
    const { owner, account } = await inbox('rm-i2');
    const jid = `${phone(FAKE_SILENT_PREFIX)}@s.whatsapp.net`;
    await ingestWhatsappEvents(account, [msg(jid, `a-${uniq()}`, 10, 'uno')]);
    const thread = (await findThread(account.id, jid))!;
    const target = (await fetchTarget('inbox', owner, thread.id))!;
    await refreshChatHistory(target);
    await noteHistoryArrived('inbox', account.id, [`${phone()}@s.whatsapp.net`]);
    expect(await refreshStatus(target)).toMatchObject({ state: 'waiting', answered: false });
  });

  it('el gateway pide desde otro mensaje (sin el parche 0006): lo dice, y se puede reintentar enseguida', async () => {
    const { ws, number } = await lines('rm-l5');
    const jid = `${phone(FAKE_ELSEWHERE_PREFIX)}@s.whatsapp.net`;
    await ingestEvents(number, [msg(jid, `a-${uniq()}`, 10, 'uno')]);
    const chatId = await chatOf(number.id, jid);
    expect(await requestRefresh('lines', ws, chatId)).toEqual({ ok: false, error: 'gateway_outdated' });
    expect(await requestRefreshStatus('lines', ws, chatId)).toEqual({ state: 'idle' });
    expect(await requestRefresh('lines', ws, chatId)).toEqual({ ok: false, error: 'gateway_outdated' });
    expect(fakeHistoryRequests(number.id)).toHaveLength(2);
  });

  it('desconectada, sin mensajes, y el tope por línea', async () => {
    const { ws, number } = await lines('rm-l6');
    const jid = `${phone()}@s.whatsapp.net`;
    await ingestEvents(number, [msg(jid, `a-${uniq()}`, 10, 'uno')]);
    const chatId = await chatOf(number.id, jid);

    for (let i = 0; i < REFRESH_LINE_HOURLY_CAP; i++) await rateLimit(`wa-history-refresh:lines:${number.id}`, REFRESH_LINE_HOURLY_CAP, 3600);
    expect(await requestRefresh('lines', ws, chatId)).toEqual({ ok: false, error: 'rate_limited' });
    expect(fakeHistoryRequests(number.id)).toHaveLength(0);

    await getDb().prepare("UPDATE groups_numbers SET status = 'disconnected' WHERE id = ?").run(number.id);
    expect(await requestRefresh('lines', ws, chatId)).toEqual({ ok: false, error: 'not_connected' });

    // Un chat sin ningún mensaje de WhatsApp: no hay desde dónde pedir.
    const { ws: ws2, number: n2 } = await lines('rm-l7');
    const jid2 = `${phone()}@s.whatsapp.net`;
    await ingestEvents(n2, [msg(jid2, `a-${uniq()}`, 10, 'uno')]);
    const chat2 = await chatOf(n2.id, jid2);
    await getDb().prepare('DELETE FROM groups_messages WHERE chat_id = ?').run(chat2);
    expect(await requestRefresh('lines', ws2, chat2)).toEqual({ ok: true, empty: true });
  });
});

describe('Inbox', () => {
  it('un mensaje perdido vuelve y el estado dice cuántos', async () => {
    const { owner, account } = await inbox('rm-i3');
    const provider = fakeProvider(`inbox-${account.id}`);
    const jid = `${phone()}@s.whatsapp.net`;
    const tag = uniq();
    await ingestWhatsappEvents(account, [msg(jid, `a-${tag}`, 60, 'uno')]);
    await ingestWhatsappEvents(account, provider.parseWebhook({ events: [{ type: 'fake_dropped', message: msg(jid, `b-${tag}`, 50, 'dos') }] }));
    await ingestWhatsappEvents(account, provider.parseWebhook({ events: [{ type: 'fake_dropped', message: msg(jid, `c-${tag}`, 40, 'tres', true) }] }));
    await ingestWhatsappEvents(account, [msg(jid, `d-${tag}`, 5, 'cuatro')]);
    const thread = (await findThread(account.id, jid))!;
    const unread = Number(((await getDb().prepare('SELECT unread FROM inbox_threads WHERE id = ?').get(thread.id)) as { unread: number }).unread);

    expect(await requestRefresh('inbox', owner, thread.id)).toEqual({ ok: true, requests: 1, delivered: 2, answered: true });
    const bodies = ((await getDb().prepare('SELECT body FROM inbox_messages WHERE thread_id = ? ORDER BY sent_at').all(thread.id)) as Array<{ body: string }>).map((r) => r.body);
    expect(bodies).toEqual(['uno', 'dos', 'tres', 'cuatro']);
    expect(await requestRefreshStatus('inbox', owner, thread.id)).toMatchObject({ state: 'done', added: 2, answered: true });
    // Del historial: no suma no leídos.
    expect(Number(((await getDb().prepare('SELECT unread FROM inbox_threads WHERE id = ?').get(thread.id)) as { unread: number }).unread)).toBe(unread);
    // Un mensaje nuevo en vivo después del pedido no cuenta como traído.
    await ingestWhatsappEvents(account, [msg(jid, `e-${tag}`, 0, 'cinco')]);
    expect(await requestRefreshStatus('inbox', owner, thread.id)).toMatchObject({ added: 2 });
    expect(await requestRefresh('inbox', 'otra-persona', thread.id)).toBeNull();
  });
});
