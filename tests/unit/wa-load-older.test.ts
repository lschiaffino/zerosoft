/**
 * "Cargar mensajes anteriores" (Inbox y Lines): el pedido al teléfono sale
 * anclado en el mensaje más viejo que tenemos, lo que llega se guarda como
 * historial sin duplicar, los pedidos se espacian cuando no traen nada, y sin
 * línea no se pide. Con el WhatsApp falso: un chat cuyo número empieza con
 * 1777 tiene 70 mensajes anteriores en "el teléfono". Datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { findThread, getAccountById } from '@/lib/inbox/core';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { connectNumber, createNumber, getNumberRowById, ingestEvents } from '@/lib/groups';
import { evolutionProvider } from '@/lib/groups-provider-bridge';
import { FAKE_OLDER_TOTAL, fakeHistoryRequests, fakeOlderHistory, resetFakeProvider } from '@/lib/groups-provider-fake';
import type { InboundEvent } from '@/lib/groups-provider';
import { OLDER_COUNT, OLDER_MAX_INTERVAL_MS, OLDER_MIN_INTERVAL_MS, fetchTarget, loadOlderHistory, olderInterval, olderResponse } from '@/lib/wa-history-gaps';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** El número falso ya vinculado (el QR se "escanea" a los segundos). */
function linked(id: string) {
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);
  if (s) s.connectedAt = Date.now() - 5000;
}

const uniq = () => Math.random().toString(36).slice(2, 10);
const phoneWithHistory = () => `1777${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

function msg(chatId: string, id: string, minutesAgo: number, body: string, fromMe = false): InboundEvent {
  return {
    type: 'message',
    chatId,
    isGroup: false,
    fromMe,
    senderPhone: fromMe ? '' : chatId.replace(/@.*/, ''),
    senderName: fromMe ? '' : 'Ana Ejemplo',
    providerMessageId: id,
    body,
    timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  } as InboundEvent;
}

describe('esperas entre pedidos', () => {
  it('se duplican con cada pedido seguido que no trajo nada, hasta el tope', () => {
    expect(olderInterval(0)).toBe(OLDER_MIN_INTERVAL_MS);
    expect(olderInterval(1)).toBe(OLDER_MIN_INTERVAL_MS * 2);
    expect(olderInterval(3)).toBe(OLDER_MIN_INTERVAL_MS * 8);
    expect(olderInterval(50)).toBe(OLDER_MAX_INTERVAL_MS);
  });

  it('la respuesta a la pantalla: en curso no es un error; sin línea, 409; sin más, "none"', () => {
    expect(olderResponse({ ok: true, delivered: 50, pending: false })).toEqual({ status: 200, body: { ok: true, delivered: 50, pending: false } });
    expect(olderResponse({ ok: true, none: true })).toEqual({ status: 200, body: { ok: true, none: true } });
    expect(olderResponse({ ok: false, error: 'busy', retryInMs: 1500 }).body).toMatchObject({ ok: true, pending: true, recent: true });
    expect(olderResponse({ ok: false, error: 'not_connected' }).status).toBe(409);
    expect(olderResponse({ ok: false, error: 'rate_limited' }).status).toBe(429);
    expect(olderResponse({ ok: false, error: 'failed' }).status).toBe(502);
    expect(olderResponse({ ok: false, error: 'anchor' })).toEqual({ status: 502, body: { error: 'history_anchor' } });
    expect(olderResponse({ ok: false, error: 'empty_chat' }).body).toEqual({ ok: true, none: true });
  });
});

describe('el teléfono falso', () => {
  it('devuelve de a tandas los anteriores al ancla, y después nada', () => {
    const chat = '17770000001@s.whatsapp.net';
    const t = Math.floor(Date.now() / 1000);
    const a = fakeOlderHistory(chat, { id: 'x', timestamp: t }, 50) as Array<Extract<InboundEvent, { type: 'message' }>>;
    expect(a).toHaveLength(50);
    expect(a[0].providerMessageId).toBe('old-17770000001-1');
    // Todos anteriores al ancla, cada uno más viejo que el anterior.
    expect(Date.parse(a[0].timestamp!)).toBeLessThan(t * 1000);
    expect(Date.parse(a[49].timestamp!)).toBeLessThan(Date.parse(a[0].timestamp!));
    const last = a[49];
    const b = fakeOlderHistory(chat, { id: last.providerMessageId, timestamp: Math.floor(Date.parse(last.timestamp!) / 1000) }, 50) as typeof a;
    expect(b).toHaveLength(FAKE_OLDER_TOTAL - 50);
    expect(Date.parse(b[0].timestamp!)).toBeLessThan(Date.parse(last.timestamp!));
    const end = b[b.length - 1];
    expect(fakeOlderHistory(chat, { id: end.providerMessageId, timestamp: Math.floor(Date.parse(end.timestamp!) / 1000) }, 50)).toHaveLength(0);
    // Un chat cualquiera no tiene historial anterior.
    expect(fakeOlderHistory('15550000001@s.whatsapp.net', { id: 'x', timestamp: t }, 50)).toHaveLength(0);
  });
});

describe('Evolution', () => {
  it('manda el ancla exacta (y `after` para un gateway sin el parche) y dice desde cuál pidió', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetch = vi.fn(async (_url: string | URL, init: RequestInit = {}) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ requestId: 'r1', anchor: { id: 'A1', fromMe: false, timestamp: 1700000000 }, count: 50 }), { status: 201 });
    });
    const p = evolutionProvider({ baseUrl: 'https://evo.example.com', apiKey: 'k', session: 's' }, { fetch: fetch as never });
    const r = await p.fetchHistory!('15550001111@s.whatsapp.net', { count: 50, after: 1699999999, anchor: { id: 'A1', fromMe: false, timestamp: 1700000000 } });
    expect(bodies[0]).toEqual({ remoteJid: '15550001111@s.whatsapp.net', count: 50, after: 1699999999, anchor: { id: 'A1', fromMe: false, timestamp: 1700000000 } });
    expect(r).toEqual({ requestId: 'r1', anchorId: 'A1' });
    // Sin ancla (mensajes que faltan), como antes.
    await p.fetchHistory!('15550001111@s.whatsapp.net', { count: 50 });
    expect(bodies[1]).toEqual({ remoteJid: '15550001111@s.whatsapp.net', count: 50 });
  });
});

describe('Inbox', () => {
  async function account(label: string) {
    const u = await makeUser(label);
    const { account: a } = await connectWhatsapp(u.id);
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
    linked(`inbox-${a.id}`);
    return { u, acc: (await getAccountById(a.id))! };
  }
  const count = async (threadId: string) => Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM inbox_messages WHERE thread_id = ?').get(threadId)) as { n: number }).n);

  it('pide desde el más viejo guardado, guarda lo que llega sin duplicar y espacia los pedidos que no traen nada', async () => {
    const { u, acc } = await account('lo-in1');
    const chatId = `${phoneWithHistory()}@s.whatsapp.net`;
    const tag = uniq();
    await ingestWhatsappEvents(acc, [msg(chatId, `m1-${tag}`, 30, 'el más viejo que tenemos'), msg(chatId, `m2-${tag}`, 20, 'dos', true), msg(chatId, `m3-${tag}`, 10, 'tres')]);
    const thread = (await findThread(acc.id, chatId))!;
    await getDb().prepare('UPDATE inbox_threads SET unread = 0 WHERE id = ?').run(thread.id);
    const target = (await fetchTarget('inbox', u.id, thread.id))!;
    const requests = () => fakeHistoryRequests(`inbox-${acc.id}`);
    let now = Date.now();
    const clock = () => now;

    // 1. Los 50 anteriores al más viejo.
    expect(await loadOlderHistory(target, clock)).toEqual({ ok: true, delivered: OLDER_COUNT, pending: false });
    expect(requests()).toHaveLength(1);
    expect(requests()[0]).toMatchObject({ chatId, count: OLDER_COUNT, anchorId: `m1-${tag}` });
    expect(await count(thread.id)).toBe(3 + OLDER_COUNT);
    // Es historial: no cuenta como no leído ni mueve el chat.
    const after = (await getDb().prepare('SELECT unread, preview FROM inbox_threads WHERE id = ?').get(thread.id)) as { unread: number; preview: string };
    expect(Number(after.unread)).toBe(0);
    expect(after.preview).toBe('tres');

    // 2. Enseguida, otro clic: hay uno recién hecho, no sale otro pedido.
    now += 1000;
    expect(await loadOlderHistory(target, clock)).toMatchObject({ ok: false, error: 'busy' });
    expect(requests()).toHaveLength(1);

    // 3. Pasada la espera: los que quedan, anclado en el más viejo nuevo.
    now += OLDER_MIN_INTERVAL_MS;
    expect(await loadOlderHistory(target, clock)).toEqual({ ok: true, delivered: FAKE_OLDER_TOTAL - OLDER_COUNT, pending: false });
    expect(requests()[1].anchorId).toMatch(/^old-\d+-50$/);
    expect(await count(thread.id)).toBe(3 + FAKE_OLDER_TOTAL);

    // 4. El teléfono no tiene más: los pedidos se espacian y, después de dos sin nada, se responde "no hay más"
    //    sin molestar al teléfono.
    now += OLDER_MIN_INTERVAL_MS + 1;
    expect(await loadOlderHistory(target, clock)).toEqual({ ok: true, delivered: 0, pending: false });
    now += olderInterval(0) + 1;
    expect(await loadOlderHistory(target, clock)).toEqual({ ok: true, delivered: 0, pending: false });
    now += olderInterval(1) + 1;
    expect(await loadOlderHistory(target, clock)).toEqual({ ok: true, delivered: 0, pending: false });
    const made = requests().length;
    now += 1000;
    expect(await loadOlderHistory(target, clock)).toEqual({ ok: true, none: true });
    expect(requests()).toHaveLength(made);
    // Nada se duplicó.
    const dup = (await getDb().prepare('SELECT COUNT(*) AS n FROM (SELECT external_id FROM inbox_messages WHERE thread_id = ? GROUP BY external_id HAVING COUNT(*) > 1)').get(thread.id)) as { n: number };
    expect(Number(dup.n)).toBe(0);
    expect(await count(thread.id)).toBe(3 + FAKE_OLDER_TOTAL);
  });

  it('sin línea no se pide; un chat sin mensajes de WhatsApp no tiene desde dónde; si el teléfono falla, no cuenta como "no hay más"', async () => {
    const { u, acc } = await account('lo-in2');
    const chatId = `1778${Math.floor(1_000_000 + Math.random() * 8_999_999)}@s.whatsapp.net`;
    await ingestWhatsappEvents(acc, [msg(chatId, `m1-${uniq()}`, 30, 'uno')]);
    const thread = (await findThread(acc.id, chatId))!;
    let now = Date.now();
    const clock = () => now;
    // El teléfono no responde (1778): error, se puede reintentar.
    const target = (await fetchTarget('inbox', u.id, thread.id))!;
    expect(await loadOlderHistory(target, clock)).toEqual({ ok: false, error: 'failed' });
    // Un pedido que falló no corre la espera: se puede reintentar enseguida.
    now += 500;
    expect(await loadOlderHistory(target, clock)).toEqual({ ok: false, error: 'failed' });
    const row = (await getDb().prepare("SELECT older_empty, older_at, claimed_until FROM wa_history_fetch WHERE app = 'inbox' AND chat_id = ?").get(thread.id)) as { older_empty: number; older_at: string | null; claimed_until: string | null };
    expect(Number(row.older_empty)).toBe(0);
    expect(row.older_at).toBeNull();
    expect(row.claimed_until).toBeNull();
    // Desvinculada.
    await getDb().prepare("UPDATE inbox_accounts SET status = 'disconnected' WHERE id = ?").run(acc.id);
    expect(await loadOlderHistory((await fetchTarget('inbox', u.id, thread.id))!, clock)).toEqual({ ok: false, error: 'not_connected' });
    // Otra persona no llega al chat.
    expect(await fetchTarget('inbox', 'otra-persona', thread.id)).toBeNull();
  });
});

describe('un gateway que no puede pedir desde nuestro mensaje', () => {
  it('si ancla en otro mensaje, no es "no hay más": es un error y no cuenta como pedido sin nada', async () => {
    const u = await makeUser('lo-anchor');
    const { account: a } = await connectWhatsapp(u.id);
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
    linked(`inbox-${a.id}`);
    const acc = (await getAccountById(a.id))!;
    const chatId = `${phoneWithHistory()}@s.whatsapp.net`;
    await ingestWhatsappEvents(acc, [msg(chatId, `m1-${uniq()}`, 30, 'uno')]);
    const thread = (await findThread(acc.id, chatId))!;
    const target = (await fetchTarget('inbox', u.id, thread.id))!;
    // El gateway (sin el parche del ancla y sin ese mensaje guardado) pide desde uno más nuevo suyo.
    const real = target.provider();
    const wrong = { ...target, provider: () => ({ ...real, caps: real.caps, fetchHistory: async () => ({ requestId: 'r', anchorId: 'otro-mensaje' }) }) as typeof real };
    expect(await loadOlderHistory(wrong)).toEqual({ ok: false, error: 'anchor' });
    const row = (await getDb().prepare("SELECT older_empty, older_at FROM wa_history_fetch WHERE app = 'inbox' AND chat_id = ?").get(thread.id)) as { older_empty: number; older_at: string | null };
    expect(Number(row.older_empty)).toBe(0);
    expect(row.older_at).toBeNull();
    // Lo que llega por el webhook (el proveedor no lo devuelve en el momento) queda pendiente.
    const later = { ...target, provider: () => ({ ...real, caps: real.caps, fetchHistory: async () => ({ requestId: 'r' }) }) as typeof real };
    expect(await loadOlderHistory(later)).toEqual({ ok: true, delivered: 0, pending: true });
  });
});

describe('Lines', () => {
  it('pide desde el más viejo guardado y guarda lo que llega sin duplicar; otro workspace no llega al chat', async () => {
    const user = await makeUser('lo-ln1');
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
    linked(n.id);
    const row = (await getNumberRowById(n.id))!;
    const chatId = `${phoneWithHistory()}@s.whatsapp.net`;
    const tag = uniq();
    await ingestEvents(row, [msg(chatId, `m1-${tag}`, 30, 'el más viejo que tenemos'), msg(chatId, `m2-${tag}`, 10, 'dos')]);
    const chat = (await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(n.id, chatId)) as { id: string };
    await getDb().prepare('UPDATE groups_chats SET unread_count = 0 WHERE id = ?').run(chat.id);
    const count = async () => Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM groups_messages WHERE chat_id = ?').get(chat.id)) as { n: number }).n);
    const target = (await fetchTarget('lines', user.id, chat.id))!;
    let now = Date.now();
    expect(await loadOlderHistory(target, () => now)).toEqual({ ok: true, delivered: OLDER_COUNT, pending: false });
    expect(fakeHistoryRequests(n.id)[0]).toMatchObject({ chatId, anchorId: `m1-${tag}` });
    expect(await count()).toBe(2 + OLDER_COUNT);
    expect(Number(((await getDb().prepare('SELECT unread_count AS n FROM groups_chats WHERE id = ?').get(chat.id)) as { n: number }).n)).toBe(0);
    now += OLDER_MIN_INTERVAL_MS + 1;
    expect(await loadOlderHistory(target, () => now)).toMatchObject({ ok: true, delivered: FAKE_OLDER_TOTAL - OLDER_COUNT });
    expect(await count()).toBe(2 + FAKE_OLDER_TOTAL);
    const other = await makeUser('lo-ln2');
    expect(await fetchTarget('lines', other.id, chat.id)).toBeNull();
  });
});
