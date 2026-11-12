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
import { planOf, roundTrips, scansOf, tableScans } from './read-probe';

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
    // Y nada de eso recorre una tabla: el plan de CADA sentencia, con sus argumentos de verdad.
    expect(seen.seen).toHaveLength(seen.statements);
    expect(seen.seen.filter((x) => x.sql.includes('?')).length).toBeGreaterThanOrEqual(6);
    expect(await scansOf(seen.seen)).toEqual([]);
    // Lo mismo para el aviso que consulta cada pantalla y cada lector del stream.
    expect(tableScans(await planOf('SELECT id, chat_id, number_id, kind FROM wa_live_events WHERE app = ? AND scope_id = ? AND id > ? ORDER BY id LIMIT ?', ['lines', 'x', 0, 200]))).toEqual([]);
    expect(tableScans(await planOf('SELECT MAX(id) AS id FROM wa_live_events WHERE app = ? AND scope_id = ?', ['lines', 'x']))).toEqual([]);
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
    expect(await scansOf(seen.seen)).toEqual([]);
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
    // 5 consultas antes del proveedor (la quinta, en la misma vuelta que el chat: ¿este clientId ya se mandó?).
    expect(beforeProvider).toBeLessThanOrEqual(6);
    // Consultas en total (la del clientId va en paralelo con otras: no suma espera).
    expect(seen.trips).toBeLessThanOrEqual(7);
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
    // Más, en la misma vuelta que el chat y su cuenta: ¿este clientId ya se mandó?
    expect(insert).toBeLessThanOrEqual(4);
    // Consultas en total (la del clientId va en paralelo con otras: no suma espera).
    expect(seen.trips).toBeLessThanOrEqual(7);
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

/** Lo que tira la base cuando no responde (algo pasajero: el proveedor tiene que reintentar). */
const dbDown = () => Object.assign(new Error('SERVER_ERROR: la base no responde'), { name: 'LibsqlError', code: 'SERVER_ERROR' });

describe('lo que no se puede perder', () => {
  it('un mensaje que no se pudo guardar: el webhook responde 500 (el proveedor reintenta) y el reintento lo recupera sin duplicar', async () => {
    const { ws, number } = await linesSetup('fail-lines');
    const jid = '5491100097001@s.whatsapp.net';
    const { POST } = await import('@/app/api/groups/webhook/[id]/[secret]/route');
    const post = (events: unknown[]) =>
      POST(new Request('http://zerosoft.test/api/groups/webhook/x/y', { method: 'POST', body: JSON.stringify({ events }) }), { params: Promise.resolve({ id: number.id, secret: number.webhook_secret }) });
    const db = await import('@/lib/db');
    // La base falla una vez justo al guardar (la tanda del mensaje).
    const spy = vi.spyOn(db, 'dbBatch').mockRejectedValueOnce(dbDown());
    const bad = await post([message(jid, 'fl-1', { body: 'no te pierdas' }), { type: 'presence', chatId: jid, state: 'composing', who: '5491100097001' }]);
    expect(bad.status).toBe(500);
    expect(await bad.json()).toMatchObject({ ok: false, failed: 1, messages: 0 });
    spy.mockRestore();
    // Evolution reintenta el mismo cuerpo: ahora entra, una vez.
    const again = await post([message(jid, 'fl-1', { body: 'no te pierdas' })]);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, messages: 1 });
    expect(await (await post([message(jid, 'fl-1', { body: 'no te pierdas' })])).json()).toMatchObject({ ok: true, messages: 0, duplicates: 1 });
    await flush();
    const [chat] = (await listChats(ws, ws, {})).rows;
    expect((await listMessages(ws, chat.id, { limit: 10 })).map((m) => m.body)).toEqual(['no te pierdas']);
    // Un evento que no es un mensaje y falla (un estado de algo que no tenemos) no pide reintento.
    expect((await post([{ type: 'status', providerMessageId: 'no-existe', status: 'read' }])).status).toBe(200);

    // Inbox, igual.
    const { owner, account } = await inboxSetup('fail-inbox');
    const inbox = await import('@/app/api/inbox/webhook/[id]/[secret]/route');
    const ipost = (events: unknown[]) =>
      inbox.POST(new Request('http://zerosoft.test/api/inbox/webhook/x/y', { method: 'POST', body: JSON.stringify({ events }) }), { params: Promise.resolve({ id: account.id, secret: account.webhook_secret! }) });
    const spy2 = vi.spyOn(db, 'dbBatch').mockRejectedValueOnce(dbDown());
    const ibad = await ipost([message(jid, 'fi-1', { body: 'tampoco este' })]);
    expect(ibad.status).toBe(500);
    spy2.mockRestore();
    expect((await ipost([message(jid, 'fi-1', { body: 'tampoco este' })])).status).toBe(200);
    expect((await listThreads(owner)).map((t) => t.preview)).toEqual(['tampoco este']);
  });

  it('M11: lo que no tiene otro momento para rehacerse corre antes de responder (ticket por palabra clave, respondido desde el teléfono)', async () => {
    const { ws, number } = await linesSetup('inline-lines');
    await updateSettings(ws, { ticketKeywords: ['urgente'] });
    const jid = '5491100097101@s.whatsapp.net';
    await linesWebhook(number, [message(jid, 'in-0')]);
    await flush();
    const [chat] = (await listChats(ws, ws, {})).rows;
    // El webhook responde y lo de después (after) todavía no corrió.
    await linesWebhook(number, [message(jid, 'in-1', { body: 'es urgente, por favor' })]);
    const tickets = (await getDb().prepare("SELECT source FROM groups_tickets WHERE chat_id = ?").all(chat.id)) as Array<{ source: string }>;
    expect(tickets).toEqual([{ source: 'keyword' }]);
    // Contestan desde el teléfono (en otro chat, que sí queda esperando): deja de esperar ya, sin depender de lo
    // que corre después.
    const jid2 = '5491100097102@s.whatsapp.net';
    await linesWebhook(number, [message(jid2, 'in-3', { body: 'hola' })]);
    const other = (await listChats(ws, ws, {})).rows.find((c) => c.id !== chat.id)!;
    expect((await getChat(ws, other.id))!.awaitingSince).not.toBeNull();
    await linesWebhook(number, [message(jid2, 'in-2', { fromMe: true, body: 'ya lo vemos' })]);
    expect((await getChat(ws, other.id))!.awaitingSince).toBeNull();
    // Lo de después no vuelve a abrir el ticket.
    await flush();
    expect(((await getDb().prepare('SELECT COUNT(*) AS n FROM groups_tickets WHERE chat_id = ?').get(chat.id)) as { n: number }).n).toBe(1);
  });

  it('M7: si el eco del webhook guarda el mensaje antes que el envío, queda a nombre de quien lo mandó, con su clientId, y el evento sale una vez', async () => {
    const { ws, number } = await linesSetup('echo-lines');
    const jid = '5491100097201@s.whatsapp.net';
    await linesWebhook(number, [message(jid, 'ec-0')]);
    await flush();
    const [chat] = (await listChats(ws, ws, {})).rows;
    const events = await import('@/lib/events');
    const emitted = vi.spyOn(events, 'emitEventSoon');
    // El proveedor falso manda el eco (el mismo id) ANTES de devolverle el id a quien envía.
    const fake = await import('@/lib/groups-provider-fake');
    const provider = fake.fakeProvider(number.id);
    const realSend = provider.sendText.bind(provider);
    const spy = vi.spyOn(fake, 'fakeProvider').mockImplementation(() => ({
      ...provider,
      sendText: async (chatId: string, text: string) => {
        const res = await realSend(chatId, text);
        await ingestEvents(number, [message(jid, res.id, { fromMe: true, body: text, status: 'sent' })]);
        return res;
      },
    }));
    const { sendMessage } = await import('@/lib/groups');
    const dto = await sendMessage(ws, ws, chat.id, { body: 'con eco adelantado', clientId: 'cid-eco-0001' });
    spy.mockRestore();
    await flush();
    // Una sola fila, y es de quien la mandó desde acá (no "desde el teléfono"), con su clientId.
    const rows = (await getDb().prepare("SELECT author_id, author_kind, meta FROM groups_messages WHERE chat_id = ? AND body = 'con eco adelantado'").all(chat.id)) as Array<{ author_id: string; author_kind: string; meta: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ author_id: ws, author_kind: 'person' });
    expect(JSON.parse(rows[0].meta).cid).toBe('cid-eco-0001');
    expect(dto).toMatchObject({ authorId: ws, authorKind: 'person', body: 'con eco adelantado' });
    expect(dto.meta.cid).toBe('cid-eco-0001');
    // "Mensaje enviado" salió una vez (la del eco), no dos.
    expect(emitted.mock.calls.filter((c) => c[1] === 'groups.message.sent')).toHaveLength(1);
    emitted.mockRestore();
    // Sin carrera: el envío normal sigue saliendo a nombre de la persona y emite su evento.
    const emitted2 = vi.spyOn(events, 'emitEventSoon');
    const normal = await sendMessage(ws, ws, chat.id, { body: 'sin carrera' });
    expect(normal).toMatchObject({ authorId: ws, authorKind: 'person' });
    expect(emitted2.mock.calls.filter((c) => c[1] === 'groups.message.sent')).toHaveLength(1);
    emitted2.mockRestore();
  });

  it('M13: un pedido mal armado no le gasta envíos a la línea (se valida antes de contar)', async () => {
    const { ws, number } = await linesSetup('gate-lines');
    await linesWebhook(number, [message('5491100097301@s.whatsapp.net', 'g-0')]);
    await flush();
    const [chat] = (await listChats(ws, ws, {})).rows;
    session.user = { id: ws, email: 'gate@test.local', name: 'gate', team: null, role: 'owner' };
    const { POST } = await import('@/lib/routes/groups/chats/[id]/messages/route');
    const send = (body: unknown) => POST(new Request(`http://zerosoft.test/api/groups/chats/${chat.id}/messages`, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: chat.id }) });
    const gate = async () => Number(((await getDb().prepare('SELECT COALESCE(SUM(count), 0) AS n FROM rate_limits WHERE key = ?').get(`groups-send:${number.id}`)) as { n: number }).n);
    const before = await gate();
    for (const bad of [{ body: '   ' }, {}, { body: 'x', media: 'no-es-un-archivo' }, { poll: { question: '', options: [] } }, { contacts: [{ name: 'x', phone: '1' }] }]) {
      const res = await send(bad);
      expect(res.status, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    expect(await gate()).toBe(before);
    // Uno bien armado sí cuenta (una vez).
    expect((await send({ body: 'hola' })).status).toBe(201);
    expect(await gate()).toBe(before + 1);
    // Una nota interna no sale a WhatsApp: no cuenta.
    expect((await send({ body: 'nota', note: true })).status).toBe(201);
    expect(await gate()).toBe(before + 1);
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

  it('con sesión: apagado por defecto (204 y la consulta dice stream: false); prendido para ese workspace, stream', async () => {
    const { ws } = await linesSetup('live-route');
    session.user = { id: ws, email: 'live-route@test.local', name: 'live', team: null, role: 'owner', sid: null };
    const groups = await import('@/app/api/groups/live/route');
    const inbox = await import('@/app/api/inbox/live/route');
    const all = [
      [groups, 'http://zerosoft.test/api/groups/live'],
      [inbox, 'http://zerosoft.test/api/inbox/live'],
    ] as const;
    // Sin WA_LIVE_WORKSPACES: nadie tiene stream. La consulta anda y le dice a la pantalla que no lo intente.
    for (const [mod, url] of all) {
      const off = await mod.GET(new Request(url, { headers: sse }));
      expect(off.status).toBe(204);
      expect(off.headers.get('cache-control')).toContain('no-store');
      const poll = await mod.GET(new Request(`${url}?cursor=0`));
      expect(poll.status).toBe(200);
      expect(poll.headers.get('cache-control')).toContain('no-store');
      expect(await poll.json()).toMatchObject({ events: [], stream: false });
    }
    // Prendido para otro workspace: este sigue sin stream.
    vi.stubEnv('WA_LIVE_WORKSPACES', 'otro-workspace');
    expect((await groups.GET(new Request(all[0][1], { headers: sse }))).status).toBe(204);
    // Prendido para este (el id del dueño vale para su Lines y para su Inbox).
    vi.stubEnv('WA_LIVE_WORKSPACES', `otro-workspace,${ws}`);
    for (const [mod, url] of all) {
      const abort = new AbortController();
      const stream = await mod.GET(new Request(`${url}?tab=t1`, { headers: sse, signal: abort.signal }));
      expect(stream.status).toBe(200);
      expect(stream.headers.get('content-type')).toContain('text/event-stream');
      expect(stream.headers.get('cache-control')).toBe('private, no-store, no-transform');
      expect(await firstFrame(stream)).toContain('event: ready');
      abort.abort();
      expect(await (await mod.GET(new Request(`${url}?cursor=0`))).json()).toMatchObject({ stream: true });
    }
  });

  it('M5: la revalidación del stream corre con la ruta de verdad y sin la sesión del pedido (se cierra al cerrar la sesión)', async () => {
    const { ws } = await linesSetup('live-reval');
    const sid = `sid-${Math.random().toString(36).slice(2, 12)}`;
    const now = new Date().toISOString();
    await getDb()
      .prepare('INSERT INTO user_sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(sid, ws, now, now, new Date(Date.now() + 3_600_000).toISOString());
    session.user = { id: ws, email: 'live-reval@test.local', name: 'live', team: null, role: 'owner', sid };
    vi.stubEnv('WA_LIVE_WORKSPACES', 'all');
    // Para no esperar un minuto: la primera revalidación a 1 s.
    const real = await import('@/lib/wa-live');
    const spy = vi.spyOn(real, 'liveStream');
    const { GET } = await import('@/app/api/inbox/live/route');
    const res = await GET(new Request('http://zerosoft.test/api/inbox/live', { headers: sse }));
    expect(res.status).toBe(200);
    await res.body!.cancel();
    // La función de revalidar que arma la ruta, tal cual, llamada después y SIN sesión en el pedido: no usa
    // getCurrentUser ni cookies (acá el mock de la sesión ya no devuelve a nadie).
    const check = spy.mock.calls.at(-1)![0].check;
    session.user = null;
    expect(await check()).toMatchObject({ app: 'inbox', owner: ws });
    await getDb().prepare('UPDATE user_sessions SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), sid);
    expect(await check()).toBeNull();
    spy.mockRestore();
  });
});
