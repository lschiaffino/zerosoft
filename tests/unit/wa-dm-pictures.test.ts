/**
 * Inbox y Lines: la foto de perfil de un chat 1:1. Un 1:1 que se importó sin
 * foto (o cuyo pedido de foto falló) pide la de la persona al abrirlo, la
 * guarda en la libreta (copia nuestra) y la pantalla la muestra antes que la
 * del chat. Con el proveedor falso (foto solo para números que terminan en
 * par); números inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getChat, getNumberRowById, listChats, type MessageDto, type NumberRow } from '@/lib/groups';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { getThread, listThreads, type AccountRow } from '@/lib/inbox/core';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { lookupContacts, rememberContacts, type ContactScope } from '@/lib/wa-contacts';
import {
  adoptChatPicture,
  cardPhones,
  contactPictures,
  dmAvatar,
  dmPerson,
  refreshDmPicture,
  resetPicturePauses,
  type PictureRow,
  withCardPictures,
} from '@/lib/wa-contact-pictures';
import { maskMessage, type GroupsViewer } from '@/lib/groups-access';
import { ProviderError } from '@/lib/groups-provider';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({
  ...(await orig<typeof import('@/lib/session')>()),
  getCurrentUser: async () => session.user,
}));
// Como en un request: lo que va en after() corre cuando la respuesta ya salió (flush()).
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
  resetPicturePauses();
  session.user = null;
});
afterEach(async () => {
  await flush();
  vi.unstubAllEnvs();
});

const A = '5491170004442';
const pic = (n: number) => `https://pps.whatsapp.net/v/t61/${n}.jpg?oh=firma${n}&oe=vence`;
const evenPhone = () => `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}${[0, 2, 4, 6, 8][Math.floor(Math.random() * 5)]}`;
const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);

async function scopeFor(): Promise<ContactScope> {
  const user = await makeUser('wa-dm-pics');
  return { app: 'inbox', accountId: `acc_${user.id}`, userId: user.id };
}

describe('1:1 (puro)', () => {
  it('la persona del chat: teléfono, o lid si el chat es @lid', () => {
    expect(dmPerson('5491170004442', '5491170004442@s.whatsapp.net')).toEqual({ phone: '5491170004442' });
    expect(dmPerson('', '118571178918144@lid')).toEqual({ lid: '118571178918144' });
    expect(dmPerson('', '120363000000000001@g.us')).toEqual({});
    expect(dmPerson('12', '12@s.whatsapp.net')).toEqual({});
  });

  it('se muestra la foto guardada de la persona antes que la del chat', () => {
    expect(dmAvatar('/uploads/chat/persona.jpg', '/api/inbox/avatar/ibt_1?v=1')).toBe('/uploads/chat/persona.jpg');
    expect(dmAvatar(undefined, '/api/inbox/avatar/ibt_1?v=1')).toBe('/api/inbox/avatar/ibt_1?v=1');
    expect(dmAvatar('', '')).toBe('');
  });
});

describe('refreshDmPicture', () => {
  it('sin foto guardada: aprovecha la URL del chat sin pedir otra a WhatsApp', async () => {
    const scope = await scopeFor();
    const provider = { profilePicture: vi.fn(async () => pic(9)) };
    const store = vi.fn(async () => '/uploads/chat/uno.jpg');
    expect(await refreshDmPicture(scope, provider, { phone: A }, { chatPicture: pic(1), store, gapMs: 0 })).toBe(true);
    expect(provider.profilePicture).not.toHaveBeenCalled();
    expect((await contactPictures(scope, [A])).get(A)).toBe('/uploads/chat/uno.jpg');
    // Ya está al día: abrirlo otra vez no pide ni baja nada.
    expect(await refreshDmPicture(scope, provider, { phone: A }, { chatPicture: pic(1), store, gapMs: 0 })).toBe(false);
    expect(store).toHaveBeenCalledTimes(1);
    expect(provider.profilePicture).not.toHaveBeenCalled();
  });

  it('la URL del chat venció (no se pudo bajar): se pide a WhatsApp', async () => {
    const scope = await scopeFor();
    const provider = { profilePicture: vi.fn(async () => pic(2)) };
    const store = vi.fn(async (url: string) => (url === pic(2) ? '/uploads/chat/dos.jpg' : ''));
    expect(await refreshDmPicture(scope, provider, { phone: A }, { chatPicture: pic(1), store, gapMs: 0 })).toBe(true);
    expect(provider.profilePicture).toHaveBeenCalledWith(`${A}@s.whatsapp.net`);
    expect((await contactPictures(scope, [A])).get(A)).toBe('/uploads/chat/dos.jpg');
  });

  it('un chat por lid se pide por lid, y uno que la libreta no conoce no entra como teléfono', async () => {
    const scope = await scopeFor();
    const LID = '118571178918144';
    const provider = { profilePicture: vi.fn(async () => pic(3)) };
    expect(await refreshDmPicture(scope, provider, { lid: LID }, { gapMs: 0, store: async () => '/uploads/chat/tres.jpg' })).toBe(false);
    expect(provider.profilePicture).not.toHaveBeenCalled();
    await rememberContacts(scope, [{ lid: LID, push: 'Lid Prueba' }]);
    expect(await refreshDmPicture(scope, provider, { lid: LID }, { gapMs: 0, store: async () => '/uploads/chat/tres.jpg' })).toBe(true);
    expect(provider.profilePicture).toHaveBeenCalledWith(`${LID}@lid`);
  });

  it('un 429 no borra nada ni cuenta como "sin foto"', async () => {
    const scope = await scopeFor();
    const provider = {
      profilePicture: vi.fn(async () => {
        throw new ProviderError('rate_limited', 429);
      }),
    };
    expect(await refreshDmPicture(scope, provider, { phone: A }, { gapMs: 0 })).toBe(false);
    const r = (await lookupContacts(scope, [A])).get(A) as PictureRow;
    expect(r.picture_at).toBeNull();
  });
});

describe('adoptChatPicture', () => {
  it('la URL vieja del chat no pisa una foto guardada; la recién pedida sí, si cambió', async () => {
    const scope = await scopeFor();
    await adoptChatPicture(scope, { phone: A }, pic(1), { store: async () => '/uploads/chat/uno.jpg' });
    const later = new Date(Date.now() + 60_000);
    expect(await adoptChatPicture(scope, { phone: A }, pic(2), { now: later, store: async () => '/uploads/chat/dos.jpg' })).toBe(true);
    expect((await contactPictures(scope, [A])).get(A)).toBe('/uploads/chat/uno.jpg');
    expect(await adoptChatPicture(scope, { phone: A }, pic(2), { now: later, fresh: true, store: async () => '/uploads/chat/dos.jpg' })).toBe(true);
    expect((await contactPictures(scope, [A])).get(A)).toBe('/uploads/chat/dos.jpg');
  });
});

describe('abrir un 1:1', () => {
  async function inboxSetup(label: string): Promise<{ owner: string; account: AccountRow }> {
    const u = await makeUser(label);
    const { account } = await connectWhatsapp(u.id);
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
    const s = fakeState(`inbox-${account.id}`);
    if (s) s.connectedAt = Date.now() - 5000;
    return { owner: u.id, account: { ...account, status: 'connected' } };
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

  function message(chatId: string, over: Record<string, unknown> = {}) {
    return { type: 'message' as const, chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName: 'Vera Prueba', providerMessageId: `m-${Math.random().toString(36).slice(2)}`, body: 'hola', timestamp: new Date().toISOString(), ...over };
  }

  it('Inbox: un 1:1 sin foto la pide al abrirlo y la lista y el chat la muestran', async () => {
    const { owner, account } = await inboxSetup('dm-pic-inbox');
    const phone = evenPhone();
    const { POST } = await import('@/app/api/inbox/webhook/[id]/[secret]/route');
    const res = await POST(new Request('http://zerosoft.test/api/inbox/webhook/x/y', { method: 'POST', body: JSON.stringify({ events: [message(`${phone}@s.whatsapp.net`)] }) }), {
      params: Promise.resolve({ id: account.id, secret: account.webhook_secret! }),
    });
    expect(res.status).toBe(200);
    const [t] = await listThreads(owner);
    // Como el caso del bug: los datos del chat ya se pidieron y la foto no vino.
    await getDb().prepare("UPDATE inbox_threads SET avatar_url = '', info_at = ? WHERE id = ?").run(new Date().toISOString(), t.id);
    expect((await getThread(owner, t.id)).avatar).toBe('');
    const rev = Number(((await getDb().prepare('SELECT rev FROM inbox_threads WHERE id = ?').get(t.id)) as { rev: number }).rev);

    session.user = { id: owner, email: 'dm-pic-inbox@test.local', name: 'dm', team: null, role: 'owner' };
    const { GET } = await import('@/lib/routes/inbox/threads/[id]/route');
    const opened = await GET(new Request(`http://zerosoft.test/api/inbox/threads/${t.id}`), { params: Promise.resolve({ id: t.id }) });
    expect(opened.status).toBe(200);
    expect(deferred.length).toBeGreaterThan(0);
    await flush();

    const stored = (await contactPictures({ app: 'inbox', accountId: account.id }, [phone])).get(phone) ?? '';
    expect(stored).toMatch(/^data:image\//);
    expect((await getThread(owner, t.id)).avatar).toBe(stored);
    expect((await listThreads(owner)).find((x) => x.id === t.id)?.avatar).toBe(stored);
    // La versión del chat subió: la pantalla no se queda con un 304 sin foto.
    const after = Number(((await getDb().prepare('SELECT rev FROM inbox_threads WHERE id = ?').get(t.id)) as { rev: number }).rev);
    expect(after).toBeGreaterThan(rev);
  });

  it('Lines: un 1:1 sin foto la pide al abrirlo y la lista y el chat la muestran', async () => {
    const { ws, number } = await linesSetup('dm-pic-lines');
    const phone = evenPhone();
    const { POST } = await import('@/app/api/groups/webhook/[id]/[secret]/route');
    const res = await POST(new Request('http://zerosoft.test/api/groups/webhook/x/y', { method: 'POST', body: JSON.stringify({ events: [message(`${phone}@s.whatsapp.net`)] }) }), {
      params: Promise.resolve({ id: number.id, secret: number.webhook_secret }),
    });
    expect(res.status).toBe(200);
    const chat = (await listChats(ws, ws, { numberId: number.id })).rows.find((c) => c.phone === phone)!;
    await getDb().prepare("UPDATE groups_chats SET picture_url = '' WHERE id = ?").run(chat.id);
    expect((await getChat(ws, chat.id))?.pictureUrl).toBe('');

    const { loadChatPage } = await import('@/lib/groups-page');
    await loadChatPage({ id: ws, email: 'dm-pic-lines@test.local', name: 'dm', role: 'owner' } as never, chat.id);
    await flush();

    const stored = (await contactPictures({ app: 'lines', accountId: number.id }, [phone])).get(phone) ?? '';
    expect(stored).toMatch(/^data:image\//);
    expect((await getChat(ws, chat.id))?.pictureUrl).toBe(stored);
    expect((await listChats(ws, ws, { numberId: number.id })).rows.find((c) => c.id === chat.id)?.pictureUrl).toBe(stored);
  });
});

describe('tarjetas de contacto (vCard)', () => {
  it('el teléfono de cada tarjeta es el primero (waid), sin repetir ni basura', () => {
    expect(cardPhones([[{ phones: ['+54 9 11 7000-4442', '1155550000'] }, { phones: [] }], undefined, [{ phones: ['5491170004442'] }, { phones: ['12'] }]])).toEqual([A]);
  });

  it('cada tarjeta lleva la foto guardada de la persona; sin foto, nada (la pantalla muestra el ícono)', async () => {
    const scope = await scopeFor();
    await adoptChatPicture(scope, { phone: A }, pic(1), { store: async () => '/uploads/chat/uno.jpg' });
    const cards = [[{ name: 'Con foto', phones: [A] }, { name: 'Sin foto', phones: ['5491170009990'] as string[] } as { name: string; phones: string[]; picture?: string }]];
    await withCardPictures(scope, cards);
    expect(cards[0][0]).toMatchObject({ picture: '/uploads/chat/uno.jpg' });
    expect(cards[0][1].picture).toBeUndefined();
  });

  it('Lines: quien no ve los teléfonos los recibe ocultos también en las tarjetas', () => {
    const m = { senderPhone: '', reactions: [], contacts: [{ name: 'Persona', phones: [A], picture: '/uploads/chat/uno.jpg' }] } as unknown as MessageDto;
    const out = maskMessage({ mask: true } as unknown as GroupsViewer, m);
    expect(out.contacts?.[0].phones[0]).not.toContain('70004');
    expect(out.contacts?.[0].phones[0]).toMatch(/•/);
    expect(out.contacts?.[0].picture).toBe('/uploads/chat/uno.jpg');
    expect(maskMessage({ mask: false } as unknown as GroupsViewer, m).contacts?.[0].phones[0]).toBe(A);
  });

  it('Lines: "Enviar mensaje" en una tarjeta lee el número del mensaje, no del pedido', async () => {
    const u = await makeUser('dm-pic-card');
    const ws = u.id;
    const created = await createNumber(ws, ws, { provider: 'fake' });
    await connectNumber(ws, created.id);
    const s = fakeState(created.id);
    if (s) s.connectedAt = Date.now() - 5000;
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(created.id);
    const number = (await getNumberRowById(created.id))!;
    const sender = '5491170001110';
    const { POST } = await import('@/app/api/groups/webhook/[id]/[secret]/route');
    const event = { type: 'message', chatId: `${sender}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: sender, senderName: 'Persona', providerMessageId: `card-${number.id}`, body: '', timestamp: new Date().toISOString(), contacts: [{ name: 'Otra', phones: [A] }] };
    const res = await POST(new Request('http://zerosoft.test/api/groups/webhook/x/y', { method: 'POST', body: JSON.stringify({ events: [event] }) }), {
      params: Promise.resolve({ id: number.id, secret: number.webhook_secret }),
    });
    expect(res.status).toBe(200);
    const row = (await getDb().prepare('SELECT id, chat_id FROM groups_messages WHERE number_id = ? AND meta LIKE ?').get(number.id, '%contacts%')) as { id: string; chat_id: string };
    const chatId = row.chat_id;
    const msgId = row.id;
    const { personPhone } = await import('@/lib/groups-person');
    expect(await personPhone(ws, chatId, { messageId: msgId, card: 0 })).toBe(A);
    await expect(personPhone(ws, chatId, { messageId: msgId, card: 3 })).rejects.toThrow();
    await expect(personPhone(ws, 'otro_chat', { messageId: msgId, card: 0 })).rejects.toThrow();
  });
});
