/**
 * Lines e Inbox: el camino rápido de WhatsApp. Cuántas idas a la base cuesta
 * un mensaje que llega y uno que se manda (en Turso cada ida es una vuelta de
 * red: si esto sube, se nota en la demora), y que juntar sentencias no cambió
 * lo que queda guardado. Con el proveedor falso; nombres y números inventados.
 * Corre sobre una base propia (ver dbFile).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbFile = vi.hoisted(() => {
  const file = `${(process.env.TMPDIR ?? '/tmp').replace(/\/$/, '')}/zerosoft-fast-${process.pid}-${Date.now()}.db`;
  process.env.TURSO_DATABASE_URL = `file:${file}`;
  return file;
});

import fs from 'fs';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getChat, getNumberRowById, ingestEvents, listChats, listMessages, updateSettings, type NumberRow } from '@/lib/groups';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { addMessage, getThreadRow, listThreads, type AccountRow } from '@/lib/inbox/core';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { makeUser } from './helpers';
import { roundTrips, scansOf } from './read-probe';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({
  ...(await orig<typeof import('@/lib/session')>()),
  getCurrentUser: async () => session.user,
}));
// Como en un request: lo que va en after() corre cuando la respuesta ya salió (flush()) y no cuenta en sus idas.
const deferred: Array<() => Promise<unknown>> = [];
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (job: (() => unknown) | Promise<unknown>) => {
    deferred.push(() => Promise.resolve(typeof job === 'function' ? job() : job).catch(() => null));
  },
}));
async function flush() {
  while (deferred.length) for (const job of deferred.splice(0)) await job();
}

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  resetFakeProvider();
  session.user = null;
});
afterEach(async () => {
  await flush();
  vi.unstubAllEnvs();
});
afterAll(() => {
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(`${dbFile}${ext}`, { force: true });
});

const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);

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

function message(chatId: string, id: string, over: Record<string, unknown> = {}) {
  return { type: 'message' as const, chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName: 'Vera Prueba', providerMessageId: id, body: 'hola', timestamp: new Date().toISOString(), ...over };
}

async function linesWebhook(number: NumberRow, events: unknown[]) {
  const { POST } = await import('@/app/api/groups/webhook/[id]/[secret]/route');
  const res = await POST(new Request('http://zerosoft.test/api/groups/webhook/x/y', { method: 'POST', body: JSON.stringify({ events }) }), {
    params: Promise.resolve({ id: number.id, secret: number.webhook_secret }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { messages: number; duplicates: number };
}

async function inboxWebhook(account: AccountRow, events: unknown[]) {
  const { POST } = await import('@/app/api/inbox/webhook/[id]/[secret]/route');
  const res = await POST(new Request('http://zerosoft.test/api/inbox/webhook/x/y', { method: 'POST', body: JSON.stringify({ events }) }), {
    params: Promise.resolve({ id: account.id, secret: account.webhook_secret! }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { messages: number };
}

describe('Lines: un mensaje que llega', () => {
  it('queda guardado y avisado con 4 consultas (2 esperas), con el límite de pedidos prendido', async () => {
    const { number } = await linesSetup('fast-lines');
    const jid = '5491100096001@s.whatsapp.net';
    await linesWebhook(number, [message(jid, 'f-0')]);
    await flush();
    const seen = await roundTrips(() => linesWebhook(number, [message(jid, 'f-1', { body: 'segundo' })]));
    // Antes de este cambio eran 12 idas a la base, una detrás de la otra (8 hasta que el chat avisaba).
    // Hoy son 4, y se esperan de a dos: el límite por IP junto con la línea; la libreta junto con una tanda que
    // lleva el chat, el mensaje y el aviso.
    expect(seen.trips).toBeLessThanOrEqual(4);
    const saved = seen.sql.findIndex((q) => /INTO groups_messages/.test(q));
    const touched = seen.sql.findIndex((q) => /UPDATE groups_chats SET last_message_at/.test(q));
    expect(saved).toBeGreaterThanOrEqual(0);
    // El aviso a las pantallas sale en la misma tanda que el mensaje.
    expect(touched).toBe(saved + 1);
    // Y nada de eso recorre una tabla.
    expect(await scansOf(seen.sql.map((sql) => ({ sql, args: [] })).filter((s) => !s.sql.includes('?')))).toEqual([]);
    await flush();
  });

  it('repetido no cuenta dos veces ni toca el chat; el orden de llegada se respeta', async () => {
    const { ws, number } = await linesSetup('fast-dup');
    const jid = '5491100096101@s.whatsapp.net';
    expect(await linesWebhook(number, [message(jid, 'd-1', { body: 'uno' })])).toMatchObject({ messages: 1, duplicates: 0 });
    expect(await linesWebhook(number, [message(jid, 'd-1', { body: 'uno' })])).toMatchObject({ messages: 0, duplicates: 1 });
    // El mismo webhook dos veces a la vez (el proveedor reintentó): un solo mensaje.
    const both = await Promise.all([linesWebhook(number, [message(jid, 'd-2', { body: 'dos' })]), linesWebhook(number, [message(jid, 'd-2', { body: 'dos' })])]);
    expect(both.reduce((n, r) => n + r.messages, 0)).toBe(1);
    await flush();
    const [chat] = (await listChats(ws, ws, {})).rows;
    expect(chat.unread).toBe(2);
    expect(chat.lastMessagePreview).toBe('dos');
    expect((await listMessages(ws, chat.id, { limit: 20 })).map((m) => m.body)).toEqual(['uno', 'dos']);
  });

  it('una respuesta queda enlazada al mensaje citado, y un chat nuevo se crea en la misma ida', async () => {
    const { ws, number } = await linesSetup('fast-reply');
    const jid = '5491100096201@s.whatsapp.net';
    const first = await roundTrips(() => linesWebhook(number, [message(jid, 'r-1', { body: 'pregunta' })]));
    // Un chat y un contacto nuevos suman guardar el contacto en la libreta y ponerle su nombre a sus chats.
    expect(first.trips).toBeLessThanOrEqual(8);
    await linesWebhook(number, [message(jid, 'r-2', { body: 'respuesta', replyToProviderId: 'r-1' })]);
    await linesWebhook(number, [message(jid, 'r-3', { body: 'a algo que no tenemos', replyToProviderId: 'no-existe' })]);
    await flush();
    const [chat] = (await listChats(ws, ws, {})).rows;
    expect(chat.name).toBe('Vera Prueba');
    const msgs = await listMessages(ws, chat.id, { limit: 20 });
    expect(msgs[1].replyToId).toBe(msgs[0].id);
    expect(msgs[2].replyToId).toBeNull();
  });

  it('un chat archivado se queda archivado con un mensaje nuevo, salvo que el workspace pida que vuelva', async () => {
    const { ws, number } = await linesSetup('fast-archived');
    const jid = '5491100096301@s.whatsapp.net';
    await linesWebhook(number, [message(jid, 'a-1')]);
    await flush();
    const [chat] = (await listChats(ws, ws, {})).rows;
    await getDb().prepare("UPDATE groups_chats SET archived_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(chat.id);
    await linesWebhook(number, [message(jid, 'a-2')]);
    expect((await getChat(ws, chat.id))!.archived).toBe(true);
    // Los ajustes llegan en la misma tanda que el mensaje: el cambio vale para el próximo.
    await updateSettings(ws, { keepArchived: false });
    await linesWebhook(number, [message(jid, 'a-3')]);
    expect((await getChat(ws, chat.id))!.archived).toBe(false);
  });

  it('lo que sigue al mensaje (asignación, eventos) corre después de responder, no antes', async () => {
    const { number } = await linesSetup('fast-after');
    const jid = '5491100096401@s.whatsapp.net';
    await linesWebhook(number, [message(jid, 'p-0')]);
    await flush();
    const seen = await roundTrips(() => linesWebhook(number, [message(jid, 'p-1')]));
    expect(seen.sql.some((q) => /groups_assign_rules|FROM webhooks/.test(q))).toBe(false);
    const later = await roundTrips(flush);
    expect(later.sql.some((q) => /groups_assign_rules/.test(q))).toBe(true);
  });
});

describe('Inbox: un mensaje que llega', () => {
  it('queda guardado y avisado con 4 consultas (2 esperas)', async () => {
    const { account } = await inboxSetup('fast-inbox');
    const jid = '5491100096501@s.whatsapp.net';
    await inboxWebhook(account, [message(jid, 'i-0')]);
    const seen = await roundTrips(() => inboxWebhook(account, [message(jid, 'i-1', { body: 'segundo' })]));
    // Antes eran 7 idas a la base, una detrás de la otra. Hoy 4, de a dos: el límite por IP junto con la cuenta;
    // la libreta junto con una tanda que lleva el chat, el mensaje y el aviso.
    expect(seen.trips).toBeLessThanOrEqual(4);
    const saved = seen.sql.findIndex((q) => /INTO inbox_messages/.test(q));
    expect(seen.sql[saved + 1]).toMatch(/UPDATE inbox_threads SET\s+preview/);
  });

  it('repetido no suma no leídos; uno más viejo no pisa la vista previa ni la hora', async () => {
    const { owner, account } = await inboxSetup('fast-inbox-order');
    const jid = '5491100096601@s.whatsapp.net';
    const t1 = '2026-11-10T10:00:00.000Z';
    const t0 = '2026-11-10T09:00:00.000Z';
    expect(await inboxWebhook(account, [message(jid, 'o-1', { body: 'el nuevo', timestamp: t1 })])).toMatchObject({ messages: 1 });
    expect(await inboxWebhook(account, [message(jid, 'o-1', { body: 'el nuevo', timestamp: t1 })])).toMatchObject({ messages: 0 });
    // Llega tarde uno anterior (fuera de orden): entra al chat y cuenta como no leído, pero la fila sigue mostrando el último.
    expect(await inboxWebhook(account, [message(jid, 'o-0', { body: 'el viejo', timestamp: t0 })])).toMatchObject({ messages: 1 });
    const [t] = await listThreads(owner);
    expect(t.preview).toBe('el nuevo');
    expect(t.lastMessageAt).toBe(t1);
    expect(t.unread).toBe(2);
    // Uno mío con la misma hora que el último sí es "el más nuevo" (>=) y deja el chat leído.
    const row = await getThreadRow(owner, t.id);
    expect(await addMessage(row, { externalId: 'o-2', fromMe: true, body: 'mío', status: 'sent', sentAt: t1 })).toBe(true);
    expect(await addMessage(row, { externalId: 'o-2', fromMe: true, body: 'mío', status: 'sent', sentAt: t1 })).toBe(false);
    const after = await getThreadRow(owner, t.id);
    expect(after.preview).toBe('mío');
    expect(after.unread).toBe(0);
    expect(after.last_from_me).toBe(1);
  });
});

describe('mandar', () => {
  it('Lines: el proveedor recibe el texto después de 2 esperas a la base (dueño), y la respuesta trae el clientId', async () => {
    const { ws, number } = await linesSetup('fast-send');
    await linesWebhook(number, [message('5491100096701@s.whatsapp.net', 's-0')]);
    await flush();
    const [chat] = (await listChats(ws, ws, {})).rows;
    session.user = { id: ws, email: 'fast-send@test.local', name: 'fast', team: null, role: 'owner' };
    const { POST } = await import('@/lib/routes/groups/chats/[id]/messages/route');
    let atProvider = -1;
    let body: Record<string, unknown> = {};
    const seen = await roundTrips(async () => {
      const before = fakeSent(number.id).length;
      const started = Date.now();
      const res = await POST(new Request(`http://zerosoft.test/api/groups/chats/${chat.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'respuesta', clientId: 'cid-12345678' }) }), {
        params: Promise.resolve({ id: chat.id }),
      });
      expect(res.status).toBe(201);
      body = (await res.json()) as Record<string, unknown>;
      expect(fakeSent(number.id).length).toBe(before + 1);
      atProvider = fakeSent(number.id)[before].at - started;
    });
    expect(atProvider).toBeGreaterThanOrEqual(0);
    // Antes: 6 idas hasta el proveedor y 12 en total, en fila. Hoy: 4 consultas antes del proveedor en 2 idas
    // (tope de escrituras + quién mira + chat; línea + tope de envíos) y una tanda después.
    const beforeProvider = seen.sql.findIndex((q) => /INTO groups_messages/.test(q));
    expect(beforeProvider).toBeLessThanOrEqual(5);
    expect(seen.trips).toBeLessThanOrEqual(6);
    expect((body.meta as Record<string, unknown>).cid).toBe('cid-12345678');
    expect(body.status).toBe('sent');
    // Un clientId raro no se guarda.
    const res2 = await POST(new Request(`http://zerosoft.test/api/groups/chats/${chat.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'otra', clientId: '<script>' }) }), {
      params: Promise.resolve({ id: chat.id }),
    });
    expect(((await res2.json()) as { meta: Record<string, unknown> }).meta.cid).toBeUndefined();
  });

  it('Lines: quien no ve el chat no manda ni gasta el tope de envíos de la línea', async () => {
    const { ws, number } = await linesSetup('fast-send-denied');
    await linesWebhook(number, [message('5491100096801@s.whatsapp.net', 'x-0')]);
    await flush();
    const [chat] = (await listChats(ws, ws, {})).rows;
    await getDb().prepare("UPDATE groups_numbers SET visibility = 'restricted' WHERE id = ?").run(number.id);
    const member = await makeUser('fast-member');
    session.user = { id: ws, email: 'owner@test.local', name: 'ws', team: null, role: 'member', actingUser: { id: member.id, email: member.email } };
    const { POST } = await import('@/lib/routes/groups/chats/[id]/messages/route');
    const sentBefore = fakeSent(number.id).length;
    const seen = await roundTrips(async () => {
      const res = await POST(new Request(`http://zerosoft.test/api/groups/chats/${chat.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'no debería salir' }) }), {
        params: Promise.resolve({ id: chat.id }),
      });
      expect(res.status).toBe(404);
    });
    expect(fakeSent(number.id).length).toBe(sentBefore);
    expect(seen.sql.some((q) => /INTO groups_messages/.test(q))).toBe(false);
    // El tope de envíos de la línea (groups-send:<línea>) no se tocó: solo el de escrituras de la persona.
    const gate = (await getDb().prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE key = ?").get(`groups-send:${number.id}`)) as { n: number };
    expect(Number(gate.n)).toBe(0);
  });

  it('Inbox: el proveedor recibe el texto después de 3 consultas (2 esperas), y el mensaje guardado lleva el clientId', async () => {
    const { owner, account } = await inboxSetup('fast-inbox-send');
    await inboxWebhook(account, [message('5491100096901@s.whatsapp.net', 'is-0')]);
    const [t] = await listThreads(owner);
    session.user = { id: owner, email: 'fast-inbox-send@test.local', name: 'fast', team: null, role: 'owner' };
    const { POST } = await import('@/lib/routes/inbox/threads/[id]/messages/route');
    let body: { messages: Array<{ body: string; meta?: { cid?: string } | null; status: string }> } = { messages: [] };
    const seen = await roundTrips(async () => {
      const res = await POST(
        new Request(`http://zerosoft.test/api/inbox/threads/${t.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'respuesta', clientId: 'cid-abcdefgh' }) }),
        { params: Promise.resolve({ id: t.id }) },
      );
      expect(res.status).toBe(201);
      body = await res.json();
    });
    // Antes: 3 idas hasta el proveedor. Hoy: el límite por IP y, juntos, el chat y su cuenta.
    const insert = seen.sql.findIndex((q) => /INTO inbox_messages/.test(q));
    expect(insert).toBeLessThanOrEqual(3);
    expect(seen.trips).toBeLessThanOrEqual(6);
    const mine = body.messages[body.messages.length - 1];
    expect(mine.body).toBe('respuesta');
    expect(mine.meta?.cid).toBe('cid-abcdefgh');
    expect(fakeSent(`inbox-${account.id}`).at(-1)?.text).toBe('respuesta');
    // Con un chat de otra persona: 404 y nada sale.
    const other = await inboxSetup('fast-inbox-other');
    session.user = { id: other.owner, email: 'other@test.local', name: 'other', team: null, role: 'owner' };
    const sentBefore = fakeSent(`inbox-${account.id}`).length;
    const res = await POST(new Request(`http://zerosoft.test/api/inbox/threads/${t.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'ajeno' }) }), {
      params: Promise.resolve({ id: t.id }),
    });
    expect(res.status).toBe(404);
    expect(fakeSent(`inbox-${account.id}`).length).toBe(sentBefore);
  });
});

describe('las rutas del aviso en vivo', () => {
  const sse = { accept: 'text/event-stream' };
  async function firstFrame(res: Response): Promise<string> {
    const r = res.body!.getReader();
    const { value } = await r.read();
    await r.cancel();
    return new TextDecoder().decode(value);
  }

  it('sin sesión no hay stream ni consulta, en ninguna de las dos apps', async () => {
    session.user = null;
    const groups = await import('@/app/api/groups/live/route');
    const inbox = await import('@/app/api/inbox/live/route');
    for (const headers of [sse, { accept: 'application/json' }]) {
      expect((await groups.GET(new Request('http://zerosoft.test/api/groups/live', { headers }))).status).toBe(401);
      expect((await inbox.GET(new Request('http://zerosoft.test/api/inbox/live', { headers }))).status).toBe(401);
    }
  });

  it('con sesión: stream para EventSource, JSON para la consulta, y 204 con el stream apagado', async () => {
    const { ws } = await linesSetup('live-route');
    session.user = { id: ws, email: 'live-route@test.local', name: 'live', team: null, role: 'owner' };
    const groups = await import('@/app/api/groups/live/route');
    const inbox = await import('@/app/api/inbox/live/route');
    for (const [mod, url] of [
      [groups, 'http://zerosoft.test/api/groups/live'],
      [inbox, 'http://zerosoft.test/api/inbox/live'],
    ] as const) {
      const abort = new AbortController();
      const stream = await mod.GET(new Request(url, { headers: sse, signal: abort.signal }));
      expect(stream.status).toBe(200);
      expect(stream.headers.get('content-type')).toContain('text/event-stream');
      expect(await firstFrame(stream)).toContain('event: ready');
      abort.abort();
      const poll = await mod.GET(new Request(`${url}?cursor=0`));
      expect(poll.headers.get('content-type')).toContain('application/json');
      expect(await poll.json()).toMatchObject({ events: [] });
    }
    vi.stubEnv('WA_LIVE', 'poll');
    expect((await groups.GET(new Request('http://zerosoft.test/api/groups/live', { headers: sse }))).status).toBe(204);
    expect((await inbox.GET(new Request('http://zerosoft.test/api/inbox/live', { headers: sse }))).status).toBe(204);
    // La consulta sigue andando: es a lo que cae la pantalla.
    expect((await inbox.GET(new Request('http://zerosoft.test/api/inbox/live?cursor=0'))).status).toBe(200);
  });
});
