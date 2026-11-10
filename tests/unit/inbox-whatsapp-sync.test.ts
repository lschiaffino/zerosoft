/**
 * Inbox + WhatsApp personal sobre Evolution API v2.3.7: lo que pasa al
 * vincular un número. Los cuerpos de webhook y las respuestas de findChats /
 * findMessages copian la forma real de v2.3.7 (ids y textos cambiados).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createAccount, getAccountById, listMessages, listThreads, writeAccountConfig, readAccountConfig } from '@/lib/inbox/core';
import { connectWhatsapp, resyncWhatsapp, runWhatsappBackfill } from '@/lib/inbox/whatsapp';
import { managedProvider, newManagedInstance } from '@/lib/groups-provider-managed';
import { makeUser } from './helpers';

const webhookRoute = await import('@/app/api/inbox/webhook/[id]/[secret]/route');

const BRIDGE = 'https://evo.example.test';
const GLOBAL_KEY = 'global-key-test';
const INSTANCE_ID = '00000000-0000-4000-8000-000000000001';

interface Call {
  path: string;
  method: string;
  apikey: string | null;
  body: Record<string, unknown> | undefined;
}

/** findChats de v2.3.7: sale de la tabla de mensajes (sin mensajes devuelve []). */
const FIND_CHATS = [
  {
    id: 'chat0000000000000000001',
    remoteJid: '100000000000001@lid',
    pushName: null,
    profilePicUrl: 'https://example.test/avatar.jpg',
    updatedAt: '2026-11-08T23:30:37.000Z',
    windowStart: null,
    windowExpires: null,
    windowActive: false,
    lastMessage: {
      id: 'msg00000000000000000001',
      key: { id: '3B0000000000000000A1', fromMe: true, remoteJid: '100000000000001@lid', participant: '', remoteJidAlt: '5491100000123@s.whatsapp.net', addressingMode: 'lid' },
      pushName: 'Você',
      participant: null,
      messageType: 'conversation',
      message: { conversation: 'gracias' },
      contextInfo: null,
      source: 'unknown',
      messageTimestamp: 1794180637,
      instanceId: INSTANCE_ID,
      sessionId: null,
      status: 'SERVER_ACK',
    },
    unreadCount: null,
    isSaved: true,
  },
];

/** findMessages de v2.3.7: { messages: { total, pages, currentPage, records } }, del más nuevo al más viejo. */
const FIND_MESSAGES = {
  messages: {
    total: 3,
    pages: 1,
    currentPage: 1,
    records: [
      {
        id: 'msg00000000000000000001',
        key: { id: '3B0000000000000000A1', fromMe: true, remoteJid: '100000000000001@lid', participant: '', remoteJidAlt: '5491100000123@s.whatsapp.net', addressingMode: 'lid' },
        pushName: 'Yo',
        messageType: 'conversation',
        message: { conversation: 'gracias' },
        messageTimestamp: 1794180637,
        instanceId: INSTANCE_ID,
        source: 'unknown',
        contextInfo: null,
        MessageUpdate: [{ status: 'DELIVERY_ACK' }],
      },
      {
        id: 'msg00000000000000000002',
        key: { id: '3B0000000000000000A2', fromMe: true, remoteJid: '100000000000001@lid', participant: '', remoteJidAlt: '5491100000123@s.whatsapp.net', addressingMode: 'lid' },
        pushName: 'Yo',
        messageType: 'reactionMessage',
        message: { reactionMessage: { key: { id: '3A0000000000000000A3', fromMe: false, remoteJid: '100000000000001@lid' }, text: '❤️', senderTimestampMs: { low: -1115694513, high: 417, unsigned: false } } },
        messageTimestamp: 1794180635,
        instanceId: INSTANCE_ID,
        source: 'unknown',
        contextInfo: null,
        MessageUpdate: [],
      },
      {
        id: 'msg00000000000000000003',
        key: { id: '3A0000000000000000A3', fromMe: false, remoteJid: '100000000000001@lid', participant: '', remoteJidAlt: '5491100000123@s.whatsapp.net', addressingMode: 'lid' },
        pushName: 'Ana P',
        messageType: 'conversation',
        message: { conversation: 'Mañana te mando el contrato', messageContextInfo: { threadId: [], deviceListMetadataVersion: 2 } },
        messageTimestamp: 1794180627,
        instanceId: INSTANCE_ID,
        source: 'ios',
        contextInfo: null,
        MessageUpdate: [{ status: 'READ' }],
      },
    ],
  },
};

function evolutionMock() {
  const calls: Call[] = [];
  const handler = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ path: url.pathname, method: init.method ?? 'GET', apikey: new Headers(init.headers).get('apikey'), body });
    const p = url.pathname;
    let out: unknown = {};
    if (p.startsWith('/instance/create')) out = { instance: { instanceName: body?.instanceName, status: 'created' } };
    else if (p.startsWith('/instance/connectionState')) out = { instance: { state: 'connecting' } };
    else if (p.startsWith('/instance/connect/')) out = { base64: 'data:image/png;base64,QRDATA' };
    else if (p.startsWith('/chat/findChats')) out = Number(body?.skip ?? 0) === 0 ? FIND_CHATS : [];
    else if (p.startsWith('/chat/findMessages')) out = FIND_MESSAGES;
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, handler };
}

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
  vi.stubEnv('GROUPS_FAKE', '');
  vi.stubEnv('INBOX_BRIDGE_URL', BRIDGE);
  vi.stubEnv('INBOX_BRIDGE_KEY', GLOBAL_KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function managedAccount(prefix: string) {
  const u = await makeUser(prefix);
  const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'managed', label: 'WhatsApp' });
  const cfg = newManagedInstance();
  await writeAccountConfig(a.id, cfg);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
  return { u, account: (await getAccountById(a.id))!, cfg };
}

function hook(account: { id: string; webhook_secret: string }, body: unknown) {
  return webhookRoute.POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: account.id, secret: account.webhook_secret }),
  });
}

function envelope(event: string, instance: string, token: string, data: unknown) {
  return { event, instance, data, destination: 'https://zerosoft.ai/api/inbox/webhook/x/y', date_time: '2026-11-08T20:30:37.000Z', sender: '5491100000999@s.whatsapp.net', server_url: BRIDGE, apikey: token };
}

describe('Inbox WhatsApp: historial al vincular', () => {
  it('la instancia de Inbox pide el historial completo (también si ya existía); sin la opción no se pide', async () => {
    const mock = evolutionMock();
    vi.stubGlobal('fetch', mock.handler);
    const u = await makeUser('ibsync-create');
    await connectWhatsapp(u.id);
    const create = mock.calls.find((c) => c.path === '/instance/create')!;
    expect(create.body).toMatchObject({ syncFullHistory: true, integration: 'WHATSAPP-BAILEYS' });
    expect((create.body!.webhook as { events: string[] }).events).toEqual(expect.arrayContaining(['MESSAGES_SET', 'CHATS_SET', 'CONTACTS_UPSERT', 'MESSAGES_UPSERT']));
    const settings = mock.calls.find((c) => c.path.startsWith('/settings/set/'))!;
    expect(settings.body).toMatchObject({ syncFullHistory: true });
    expect(settings.apikey).not.toBe(GLOBAL_KEY);

    const groups = evolutionMock();
    const p = managedProvider(newManagedInstance(), { env: { baseUrl: BRIDGE, globalKey: GLOBAL_KEY }, fetch: (url, init) => groups.handler(url, init) });
    await p.connect('https://zerosoft.ai/api/groups/webhook/a/b');
    expect(groups.calls.find((c) => c.path === '/instance/create')!.body).toMatchObject({ syncFullHistory: false });
    expect(groups.calls.some((c) => c.path.startsWith('/settings/set/'))).toBe(false);
  });

  it('CHATS_SET lista los chats antes que los mensajes; MESSAGES_UPSERT con @lid cae en el chat con teléfono', async () => {
    const { u, account, cfg } = await managedAccount('ibsync-chats');
    const chatsSet = envelope('chats.set', cfg.session, cfg.instanceToken, [
      { remoteJid: '5491100000123@s.whatsapp.net', instanceId: INSTANCE_ID, name: 'Ana P' },
      { remoteJid: '120363041234567890@g.us', instanceId: INSTANCE_ID, name: 'Familia' },
      { remoteJid: '5491100000001@s.whatsapp.net', instanceId: INSTANCE_ID },
      { remoteJid: '100000000000001@lid', instanceId: INSTANCE_ID, name: null },
      { remoteJid: 'status@broadcast', instanceId: INSTANCE_ID },
      { remoteJid: '120363999999999999@newsletter', instanceId: INSTANCE_ID, name: 'Canal' },
    ]);
    const r = await hook(account, chatsSet);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, chats: 3 });
    let threads = await listThreads(u.id, { view: 'whatsapp' });
    expect(threads.map((t) => t.title).sort()).toEqual(['5491100000001', 'Ana P', 'Familia']);
    // Cada tanda de historial deja la importación desde el servidor para dentro de un minuto.
    const cursor = JSON.parse((await getAccountById(account.id))!.sync_cursor) as { phase: string; after: number };
    expect(cursor.phase).toBe('chats');
    expect(cursor.after).toBeGreaterThan(Date.now() + 30_000);

    // Webhook de v2.3.7 (evento en minúsculas con punto, chat @lid con remoteJidAlt).
    const upsert = envelope('messages.upsert', cfg.session, cfg.instanceToken, {
      key: { id: '3A0000000000000000A3', fromMe: false, remoteJid: '100000000000001@lid', participant: '', remoteJidAlt: '5491100000123@s.whatsapp.net', addressingMode: 'lid' },
      pushName: 'Ana P',
      status: 'DELIVERY_ACK',
      message: { conversation: 'Mañana te mando el contrato', messageContextInfo: { threadId: [], deviceListMetadataVersion: 2 } },
      contextInfo: null,
      messageType: 'conversation',
      messageTimestamp: 1794180627,
      instanceId: INSTANCE_ID,
      source: 'ios',
    });
    const r2 = await hook(account, upsert);
    expect(await r2.json()).toMatchObject({ ok: true, messages: 1 });
    threads = await listThreads(u.id, { view: 'whatsapp' });
    // El chat con mensajes va primero; los que solo trajo el historial, después.
    expect(threads[0]).toMatchObject({ title: 'Ana P', unread: 1 });
    expect(threads).toHaveLength(3);
    const msgs = (await listMessages(u.id, threads[0].id)).messages;
    expect(msgs.map((m) => m.body)).toEqual(['Mañana te mando el contrato']);

    // Mayúsculas (otras versiones) y otra instancia: lo primero entra, lo segundo no.
    const upper = await hook(account, envelope('MESSAGES_UPSERT', cfg.session, cfg.instanceToken, { ...(upsert.data as Record<string, unknown>), key: { ...((upsert.data as { key: Record<string, unknown> }).key), id: 'UPPER1' } }));
    expect(await upper.json()).toMatchObject({ messages: 1 });
    const other = await hook(account, envelope('messages.upsert', 'zs-00000000000000000000', cfg.instanceToken, upsert.data));
    expect(other.status).toBe(401);
  });

  it('MESSAGES_SET guarda el historial sin no leídos y la importación trae lo que guardó el servidor', async () => {
    const mock = evolutionMock();
    vi.stubGlobal('fetch', mock.handler);
    const { u, account, cfg } = await managedAccount('ibsync-history');
    const set = envelope('messages.set', cfg.session, cfg.instanceToken, [FIND_MESSAGES.messages.records[2]]);
    expect(await (await hook(account, set)).json()).toMatchObject({ ok: true, messages: 1 });
    let [t] = await listThreads(u.id, { view: 'whatsapp' });
    expect(t).toMatchObject({ title: 'Ana P', unread: 0 });

    // Antes del minuto de margen no corre; después trae findChats + findMessages.
    let acc = (await getAccountById(account.id))!;
    expect(await runWhatsappBackfill(acc, Date.now() + 10_000)).toBe(false);
    expect(await runWhatsappBackfill(acc, Date.now() + 10_000, new Date(Date.now() + 61_000))).toBe(true);
    expect(mock.calls.some((c) => c.path === `/chat/findChats/${cfg.session}`)).toBe(true);
    expect(mock.calls.find((c) => c.path === `/chat/findMessages/${cfg.session}`)!.body).toMatchObject({ where: { key: { remoteJid: '100000000000001@lid' } } });
    acc = (await getAccountById(account.id))!;
    expect(JSON.parse(acc.sync_cursor).phase).toBe('done');
    const threads = await listThreads(u.id, { view: 'whatsapp' });
    expect(threads).toHaveLength(1);
    t = threads[0];
    expect(t).toMatchObject({ title: 'Ana P', unread: 0 });
    const msgs = (await listMessages(u.id, t.id)).messages;
    // Sin duplicar lo que ya entró por el webhook; la reacción no es un mensaje.
    expect(msgs.map((m) => [m.body, m.fromMe])).toEqual([
      ['Mañana te mando el contrato', false],
      ['gracias', true],
    ]);
  });

  it('una tanda que llega mientras corre la importación la vuelve a programar', async () => {
    const mock = evolutionMock();
    const { account, cfg } = await managedAccount('ibsync-race');
    vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
      if (String(input).includes('/chat/findChats')) {
        // Otra tanda de historial entra a mitad de la importación.
        await hook(account, envelope('chats.set', cfg.session, cfg.instanceToken, [{ remoteJid: '5491100000002@s.whatsapp.net', instanceId: INSTANCE_ID }]));
      }
      return mock.handler(input, init);
    });
    await getDb().prepare('UPDATE inbox_accounts SET sync_cursor = ? WHERE id = ?').run(JSON.stringify({ phase: 'chats', page: 0 }), account.id);
    const acc = (await getAccountById(account.id))!;
    expect(await runWhatsappBackfill(acc, Date.now() + 10_000)).toBe(true);
    const cursor = JSON.parse((await getAccountById(account.id))!.sync_cursor) as { phase: string; after?: number };
    expect(cursor.phase).toBe('chats');
    expect(cursor.after).toBeGreaterThan(Date.now());
  });

  it('volver a sincronizar cierra la instancia vieja, crea otra con historial y devuelve el QR; los chats quedan', async () => {
    const mock = evolutionMock();
    vi.stubGlobal('fetch', mock.handler);
    const { u, account, cfg } = await managedAccount('ibsync-resync');
    await hook(account, envelope('chats.set', cfg.session, cfg.instanceToken, [{ remoteJid: '5491100000123@s.whatsapp.net', instanceId: INSTANCE_ID, name: 'Ana P' }]));
    const { account: after, state } = await resyncWhatsapp(u.id);
    expect(state).toMatchObject({ status: 'qr', qr: 'data:image/png;base64,QRDATA' });
    expect(mock.calls.some((c) => c.path === `/instance/delete/${cfg.session}`)).toBe(true);
    const next = readAccountConfig<{ session: string }>((await getAccountById(after.id))!);
    expect(next.session).not.toBe(cfg.session);
    expect(mock.calls.find((c) => c.path === '/instance/create')!.body).toMatchObject({ instanceName: next.session, syncFullHistory: true });
    expect(after.id).toBe(account.id);
    expect((await listThreads(u.id, { view: 'whatsapp' })).map((t) => t.title)).toEqual(['Ana P']);
  });
});
