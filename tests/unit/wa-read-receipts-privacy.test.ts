/**
 * WhatsApp: "Confirmaciones de lectura" de cada línea (Lines) y cuenta (Inbox).
 * Se lee del proveedor y se guarda; con 'none', los 1:1 salientes leídos siguen
 * en "leído" (zerosoft muestra todo lo que sabe) y solo llevan la marca
 * readHidden para explicar las tildes. Los grupos no cambian. Marcar leído pasa
 * siempre por markRead, que con 'none' manda 'read-self'. Números inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { evolutionProvider, parseEvolutionPrivacy } from '@/lib/groups-provider-bridge';
import { fakeProvider, fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import type { FetchLike, InboundEvent } from '@/lib/groups-provider';
import {
  connectNumber,
  createNumber,
  getChat,
  getChatRow,
  getNumberRowById,
  ingestEvents,
  listChats,
  listMessages as listLinesMessages,
  refreshNumber,
  sendReadReceipts,
  updateSettings,
} from '@/lib/groups';
import { createAccount, findThread, getAccountById, getThread, listMessages as listInboxMessages, listThreads } from '@/lib/inbox/core';
import { ingestWhatsappEvents, waProviderFor } from '@/lib/inbox/whatsapp';
import { refreshInboxDaily, refreshLinesDaily } from '@/lib/wa-contacts-refresh';
import { privacyStale, readHiddenInWhatsapp, refreshPrivacy } from '@/lib/wa-privacy';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const PHONE = '5491177720001';
const GID = '120363000000000901@g.us';

function msg(over: Partial<Extract<InboundEvent, { type: 'message' }>>): InboundEvent {
  return {
    type: 'message',
    chatId: `${PHONE}@s.whatsapp.net`,
    isGroup: false,
    fromMe: true,
    senderPhone: '',
    senderName: '',
    providerMessageId: `m-${Math.random().toString(36).slice(2)}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    status: 'sent',
    ...over,
  } as InboundEvent;
}

const read = (id: string): InboundEvent => ({ type: 'status', providerMessageId: id, status: 'read' });

describe('Evolution: privacidad', () => {
  it('lee readreceipts de la respuesta (suelta o envuelta); otra cosa es null', () => {
    expect(parseEvolutionPrivacy({ readreceipts: 'none', profile: 'all', status: 'contacts', online: 'all', last: 'all', groupadd: 'all' })).toEqual({ readReceipts: 'none' });
    expect(parseEvolutionPrivacy({ readreceipts: 'all' })).toEqual({ readReceipts: 'all' });
    expect(parseEvolutionPrivacy({ privacySettings: { readreceipts: 'NONE' } })).toEqual({ readReceipts: 'none' });
    expect(parseEvolutionPrivacy({ data: { readreceipts: 'all' } })).toEqual({ readReceipts: 'all' });
    expect(parseEvolutionPrivacy({ readreceipts: 'contacts' })).toBeNull();
    expect(parseEvolutionPrivacy({})).toBeNull();
    expect(parseEvolutionPrivacy(null)).toBeNull();
    expect(parseEvolutionPrivacy('x')).toBeNull();
  });

  it('privacySettings pide GET /chat/fetchPrivacySettings/{instancia}; markRead solo usa markMessageAsRead', async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const f: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? '') });
      return new Response(url.includes('fetchPrivacySettings') ? JSON.stringify({ readreceipts: 'none' }) : '{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const p = evolutionProvider({ baseUrl: 'https://evo.example.com', apiKey: 'k', session: 'lin1' }, { fetch: f });
    expect(await p.privacySettings!()).toEqual({ readReceipts: 'none' });
    expect(calls[0]).toMatchObject({ url: 'https://evo.example.com/chat/fetchPrivacySettings/lin1', method: 'GET' });
    // Marcar leído: el "marcar leído" del servidor (Baileys readMessages manda 'read-self' con las confirmaciones
    // apagadas). Nunca un recibo armado a mano.
    calls.length = 0;
    await p.markRead!(`${PHONE}@s.whatsapp.net`, ['A1', 'A2']);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://evo.example.com/chat/markMessageAsRead/lin1');
    expect(JSON.parse(calls[0].body)).toEqual({
      readMessages: [
        { remoteJid: `${PHONE}@s.whatsapp.net`, fromMe: false, id: 'A1' },
        { remoteJid: `${PHONE}@s.whatsapp.net`, fromMe: false, id: 'A2' },
      ],
    });
  });

  it('helpers: solo 1:1 con none; vence al día', () => {
    expect(readHiddenInWhatsapp('none', false)).toBe(true);
    expect(readHiddenInWhatsapp('none', true)).toBe(false);
    expect(readHiddenInWhatsapp('all', false)).toBe(false);
    expect(readHiddenInWhatsapp('', false)).toBe(false);
    const now = new Date('2026-11-14T12:00:00Z');
    expect(privacyStale(null, now)).toBe(true);
    expect(privacyStale('2026-11-14T00:00:00Z', now)).toBe(false);
    expect(privacyStale('2026-11-13T11:00:00Z', now)).toBe(true);
  });
});

describe('Lines', () => {
  async function line(label: string, readreceipts?: 'all' | 'none') {
    const user = await makeUser(label);
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    // La privacidad del teléfono antes de vincular (como si ya estuviera así en WhatsApp).
    if (readreceipts) fakeProvider(n.id).parseWebhook({ events: [{ type: 'fake_privacy', readreceipts }] });
    await connectNumber(user.id, n.id);
    const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (s) s.connectedAt = Date.now() - 5000;
    // Pasa a conectado como lo vería la pantalla del QR: lee la privacidad.
    await refreshNumber(user.id, n.id);
    return { user, row: (await getNumberRowById(n.id))! };
  }

  it('al conectar guarda las confirmaciones de lectura', async () => {
    const { row } = await line('rrl1', 'none');
    expect(row.status).toBe('connected');
    expect(row.read_receipts).toBe('none');
    expect(row.privacy_at).toBeTruthy();
  });

  it('con none: el 1:1 leído sigue "read" (estado real) y lleva readHidden; el grupo no', async () => {
    const { user, row } = await line('rrl2', 'none');
    const dm = msg({ body: 'para Ana' });
    const grp = msg({ chatId: GID, isGroup: true, chatName: 'Equipo', body: 'para el grupo' });
    await ingestEvents(row, [dm, grp]);
    await ingestEvents(row, [read((dm as { providerMessageId: string }).providerMessageId), read((grp as { providerMessageId: string }).providerMessageId)]);
    const chats = (await listChats(user.id, user.id, {})).rows;
    const dmChat = chats.find((c) => c.kind === 'dm')!;
    const groupChat = chats.find((c) => c.kind === 'group')!;
    expect(dmChat.lastStatus).toBe('read');
    expect(dmChat.readHidden).toBe(true);
    expect(groupChat.lastStatus).toBe('read');
    expect(groupChat.readHidden).toBeUndefined();
    expect((await getChat(user.id, dmChat.id))!.readHidden).toBe(true);
    expect((await getChat(user.id, groupChat.id))!.readHidden).toBeUndefined();
    // El mensaje guarda y muestra el estado real.
    expect((await listLinesMessages(user.id, dmChat.id)).find((m) => m.body === 'para Ana')!.status).toBe('read');
    // Prendidas otra vez: nada que explicar.
    await getDb().prepare("UPDATE groups_numbers SET read_receipts = 'all' WHERE id = ?").run(row.id);
    expect((await listChats(user.id, user.id, {})).rows.find((c) => c.kind === 'dm')!.readHidden).toBeUndefined();
  });

  it('el repaso diario relee la privacidad vencida', async () => {
    const { user, row } = await line('rrl3', 'all');
    expect(row.read_receipts).toBe('all');
    fakeProvider(row.id).parseWebhook({ events: [{ type: 'fake_privacy', readreceipts: 'none' }] });
    await getDb().prepare("UPDATE groups_numbers SET privacy_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(row.id);
    await getDb()
      .prepare("INSERT OR REPLACE INTO wa_contact_sync (app, account_id, user_id, phase, cursor, updated_at) VALUES ('lines', ?, ?, 'idle', '', ?)")
      .run(row.id, user.id, new Date().toISOString());
    await refreshLinesDaily(new Date(), Date.now() + 10_000, 0, [row.id]);
    expect((await getNumberRowById(row.id))!.read_receipts).toBe('none');
  });

  it('un proveedor que no la dice deja lo que había; uno que falla no toca nada', async () => {
    const { row } = await line('rrl4', 'none');
    await refreshPrivacy('lines', row.id, { ...fakeProvider(row.id), privacySettings: async () => null });
    expect((await getNumberRowById(row.id))!.read_receipts).toBe('none');
    const before = (await getNumberRowById(row.id))!.privacy_at;
    const r = await refreshPrivacy('lines', row.id, {
      ...fakeProvider(row.id),
      privacySettings: async () => {
        throw new Error('down');
      },
    });
    expect(r).toBeNull();
    expect((await getNumberRowById(row.id))!.privacy_at).toBe(before);
  });

  it('marcar leído con las confirmaciones apagadas manda read-self (por markRead), nunca read', async () => {
    const { user, row } = await line('rrl5', 'none');
    await updateSettings(user.id, { readReceipts: true });
    await ingestEvents(row, [msg({ fromMe: false, senderPhone: PHONE, senderName: 'Ana', body: 'hola', status: undefined })]);
    const chat = (await listChats(user.id, user.id, {})).rows.find((c) => c.kind === 'dm')!;
    await sendReadReceipts(user.id, (await getChatRow(user.id, chat.id))!);
    const receipts = fakeSent(row.id).filter((s) => s.kind === 'read');
    expect(receipts).toHaveLength(1);
    expect(receipts[0].receipt).toBe('read-self');
    // Con las confirmaciones prendidas, el mismo camino manda 'read'.
    fakeProvider(row.id).parseWebhook({ events: [{ type: 'fake_privacy', readreceipts: 'all' }] });
    await sendReadReceipts(user.id, (await getChatRow(user.id, chat.id))!);
    expect(fakeSent(row.id).filter((s) => s.kind === 'read').map((s) => s.receipt)).toEqual(['read-self', 'read']);
  });
});

describe('Inbox', () => {
  async function account(label: string, readreceipts: 'all' | 'none') {
    const u = await makeUser(label);
    const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = '15550000001' WHERE id = ?").run(a.id);
    const acc = (await getAccountById(a.id))!;
    const p = waProviderFor(acc);
    await p.connect('http://x');
    const g = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(`inbox-${a.id}`);
    if (g) g.connectedAt = Date.now() - 5000;
    p.parseWebhook({ events: [{ type: 'fake_privacy', readreceipts }] });
    return { u, acc };
  }

  it('el repaso diario guarda la privacidad; con none el 1:1 leído lleva readHidden y sigue "read"', async () => {
    const { u, acc } = await account('rri1', 'none');
    await getDb()
      .prepare("INSERT OR REPLACE INTO wa_contact_sync (app, account_id, user_id, phase, cursor, updated_at) VALUES ('inbox', ?, ?, 'idle', '', ?)")
      .run(acc.id, u.id, new Date().toISOString());
    await refreshInboxDaily(new Date(), Date.now() + 10_000, 0, [acc.id]);
    const stored = (await getAccountById(acc.id))!;
    expect(stored.read_receipts).toBe('none');
    expect(stored.privacy_at).toBeTruthy();

    const dm = msg({ body: 'para Ana' });
    const grp = msg({ chatId: GID, isGroup: true, chatName: 'Equipo', body: 'para el grupo' });
    await ingestWhatsappEvents(stored, [dm, grp]);
    await ingestWhatsappEvents(stored, [read((dm as { providerMessageId: string }).providerMessageId), read((grp as { providerMessageId: string }).providerMessageId)]);
    const dmThread = (await findThread(acc.id, `${PHONE}@s.whatsapp.net`))!;
    const groupThread = (await findThread(acc.id, GID))!;
    const list = await listThreads(u.id, {});
    expect(list.find((t) => t.id === dmThread.id)).toMatchObject({ lastStatus: 'read', readHidden: true });
    expect(list.find((t) => t.id === groupThread.id)!.lastStatus).toBe('read');
    expect(list.find((t) => t.id === groupThread.id)!.readHidden).toBeUndefined();
    expect((await getThread(u.id, dmThread.id)).readHidden).toBe(true);
    expect((await getThread(u.id, groupThread.id)).readHidden).toBeUndefined();
    expect((await listInboxMessages(u.id, dmThread.id)).messages.find((m) => m.body === 'para Ana')!.status).toBe('read');
  });

  it('con all: sin readHidden', async () => {
    const { u, acc } = await account('rri2', 'all');
    await refreshPrivacy('inbox', acc.id, waProviderFor(acc));
    expect((await getAccountById(acc.id))!.read_receipts).toBe('all');
    const dm = msg({ body: 'hola' });
    await ingestWhatsappEvents(acc, [dm, read((dm as { providerMessageId: string }).providerMessageId)]);
    const t = (await findThread(acc.id, `${PHONE}@s.whatsapp.net`))!;
    expect((await getThread(u.id, t.id)).readHidden).toBeUndefined();
  });
});
