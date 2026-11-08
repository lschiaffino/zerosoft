import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import {
  chatPresence,
  cleanContacts,
  connectNumber,
  countArchivedChats,
  countUnreadChats,
  createNumber,
  droppedNumbers,
  getChat,
  getNumberRowById,
  ingestEvents,
  listChats,
  listMessages,
  sendMessage,
  syncMembers,
  updateChat,
  updateSettings,
} from '@/lib/groups';
import { evolutionPresence, evolutionProvider, parseEvolutionWebhook } from '@/lib/groups-provider-bridge';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
  resetFakeProvider();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup(label: string) {
  const user = await makeUser(label);
  const n = await createNumber(user.id, user.id, { provider: 'fake' });
  await connectNumber(user.id, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return { user, row: (await getNumberRowById(n.id))! };
}

const inbound = (chatId: string, id: string, body: string, extra: Record<string, unknown> = {}) => ({
  type: 'message' as const,
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  fromMe: false,
  senderPhone: chatId.endsWith('@g.us') ? '5491155550000' : chatId.split('@')[0],
  senderName: 'Ana',
  providerMessageId: id,
  body,
  ...extra,
});

describe('Archivados y "Eliminar chat"', () => {
  it('archivar saca el chat de la lista y de los no leídos; la búsqueda y la vista de archivados lo encuentran', async () => {
    const { user, row } = await setup('wa2-archive');
    await ingestEvents(row, [inbound('5491100000001@s.whatsapp.net', 'A-1', 'hola'), inbound('5491100000002@s.whatsapp.net', 'A-2', 'buenas')]);
    const [a] = (await listChats(user.id, user.id, { q: 'hola' })).rows;
    await updateChat(user.id, a.id, { archived: true });
    expect((await listChats(user.id, user.id)).rows.map((r) => r.id)).not.toContain(a.id);
    expect((await listChats(user.id, user.id, { archived: true })).rows.map((r) => r.id)).toEqual([a.id]);
    expect((await listChats(user.id, user.id, { q: 'hola' })).rows[0]).toMatchObject({ id: a.id, archived: true });
    expect(await countArchivedChats(user.id)).toEqual({ total: 1, unread: 1 });
    expect(await countUnreadChats(user.id)).toBe(1);
    // Llega otro mensaje: sigue archivado (por defecto, como WhatsApp hoy).
    await ingestEvents(row, [inbound('5491100000001@s.whatsapp.net', 'A-3', 'sigo acá')]);
    expect((await getChat(user.id, a.id))!.archived).toBe(true);
    // Con "mantener archivados" apagado, vuelve a la lista.
    await updateSettings(user.id, { keepArchived: false });
    await ingestEvents(row, [inbound('5491100000001@s.whatsapp.net', 'A-4', 'hola?')]);
    expect((await getChat(user.id, a.id))!.archived).toBe(false);
  });

  it('eliminar oculta el chat (lista, no leídos, búsqueda) y vuelve con un mensaje nuevo, con su historial', async () => {
    const { user, row } = await setup('wa2-hide');
    await ingestEvents(row, [inbound('5491100000003@s.whatsapp.net', 'H-1', 'primer mensaje')]);
    const [c] = (await listChats(user.id, user.id)).rows;
    await updateChat(user.id, c.id, { pinned: true });
    await updateChat(user.id, c.id, { hidden: true });
    expect((await listChats(user.id, user.id)).rows).toHaveLength(0);
    expect((await listChats(user.id, user.id, { q: 'primer' })).rows).toHaveLength(0);
    expect(await countUnreadChats(user.id)).toBe(0);
    await ingestEvents(row, [inbound('5491100000003@s.whatsapp.net', 'H-2', 'volví')]);
    const back = (await listChats(user.id, user.id)).rows;
    expect(back.map((r) => r.id)).toEqual([c.id]);
    expect(back[0].pinned).toBe(false);
    expect((await listMessages(user.id, c.id)).map((m) => m.body)).toEqual(['primer mensaje', 'volví']);
  });
});

describe('Presencia (escribiendo, grabando, en línea)', () => {
  it('Evolution: PRESENCE_UPDATE de un 1 a 1 y de un grupo (gana quien escribe, sin lids)', () => {
    expect(parseEvolutionWebhook({ event: 'presence.update', data: { id: '5491100000001@s.whatsapp.net', presences: { '5491100000001@s.whatsapp.net': { lastKnownPresence: 'composing' } } } })).toEqual([
      { type: 'presence', chatId: '5491100000001@s.whatsapp.net', who: '', state: 'composing' },
    ]);
    expect(
      evolutionPresence({
        id: '120363000000000001@g.us',
        presences: { '5491100000009@s.whatsapp.net': { lastKnownPresence: 'available' }, '5491100000008@s.whatsapp.net': { lastKnownPresence: 'recording' } },
      }),
    ).toEqual([{ type: 'presence', chatId: '120363000000000001@g.us', who: '5491100000008', state: 'recording' }]);
    expect(evolutionPresence({ id: 'status@broadcast', presences: {} })).toEqual([]);
    expect(evolutionPresence({ id: '5491100000001@s.whatsapp.net', presences: { x: { lastKnownPresence: 'weird' } } })).toEqual([]);
  });

  it('escribiendo dura unos segundos; en línea, minutos; un mensaje nuevo la borra', async () => {
    const now = Date.parse('2026-11-07T12:00:00.000Z');
    const at = (s: number) => new Date(now - s * 1000).toISOString();
    expect(chatPresence({ presence: 'composing', presence_who: '', presence_at: at(10) }, now)?.state).toBe('composing');
    expect(chatPresence({ presence: 'composing', presence_who: '', presence_at: at(40) }, now)).toBeNull();
    expect(chatPresence({ presence: 'available', presence_who: '', presence_at: at(300) }, now)?.state).toBe('available');
    expect(chatPresence({ presence: null, presence_who: '', presence_at: at(1) }, now)).toBeNull();

    const { user, row } = await setup('wa2-presence');
    await ingestEvents(row, [inbound('120363000000000002@g.us', 'P-1', 'hola', { senderName: 'Juana', senderPhone: '5491100000077' })]);
    await ingestEvents(row, [{ type: 'presence', chatId: '120363000000000002@g.us', who: '5491100000077', state: 'composing' }]);
    const [g] = (await listChats(user.id, user.id)).rows;
    expect(g.presence).toMatchObject({ state: 'composing', name: 'Juana' });
    // La presencia no crea chats.
    await ingestEvents(row, [{ type: 'presence', chatId: '5491199999999@s.whatsapp.net', who: '', state: 'composing' }]);
    expect((await listChats(user.id, user.id)).rows).toHaveLength(1);
    await ingestEvents(row, [inbound('120363000000000002@g.us', 'P-2', 'listo', { senderName: 'Juana', senderPhone: '5491100000077' })]);
    expect((await listChats(user.id, user.id)).rows[0].presence ?? null).toBeNull();
  });
});

describe('Tarjetas de contacto', () => {
  it('limpia los contactos (teléfono válido, hasta 10)', () => {
    expect(cleanContacts([{ name: ' Ana ', phone: '+54 9 11 5555-0000' }, { name: 'x', phone: '12' }, 'nada'])).toEqual([{ name: 'Ana', phone: '5491155550000' }]);
    expect(cleanContacts(Array.from({ length: 20 }, (_, i) => ({ name: `n${i}`, phone: `54911555500${String(i).padStart(2, '0')}` })))).toHaveLength(10);
  });

  it('manda la tarjeta, la guarda con los contactos y la vista previa [contact]', async () => {
    const { user, row } = await setup('wa2-contact');
    await ingestEvents(row, [inbound('5491100000004@s.whatsapp.net', 'C-1', 'pasame el contacto')]);
    const [c] = (await listChats(user.id, user.id)).rows;
    const m = await sendMessage(user.id, user.id, c.id, { contacts: [{ name: 'Soporte', phone: '+54 9 11 4444-0000' }] });
    expect(m).toMatchObject({ status: 'sent', body: '', contacts: [{ name: 'Soporte', phones: ['5491144440000'] }] });
    expect(fakeSent(row.id).at(-1)).toMatchObject({ kind: 'contact', text: 'Soporte +5491144440000' });
    expect((await getChat(user.id, c.id))!.lastMessagePreview).toBe('[contact]');
    await expect(sendMessage(user.id, user.id, c.id, { contacts: [{ name: 'x', phone: '1' }] })).rejects.toMatchObject({ code: 'invalid_contact_card' });
  });

  it('Evolution: /message/sendContact con wuid y teléfono con +', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
      const u = new URL(String(input instanceof Request ? input.url : input));
      calls.push({ path: u.pathname, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
      if (u.pathname.startsWith('/message/sendContact')) return Response.json({ key: { id: 'EVO-CARD-1' } });
      return Response.json({});
    });
    const p = evolutionProvider({ baseUrl: 'https://evo.example.test', apiKey: 'k', session: 'zs' });
    expect(await p.sendContact!('5491100000004@s.whatsapp.net', [{ name: 'Ana', phone: '5491155550000' }])).toEqual({ id: 'EVO-CARD-1' });
    expect(calls[0]).toEqual({
      path: '/message/sendContact/zs',
      body: { number: '5491100000004@s.whatsapp.net', contact: [{ fullName: 'Ana', wuid: '5491155550000', phoneNumber: '+5491155550000' }] },
    });
    await p.markRead!('5491100000004@s.whatsapp.net', ['M1', 'M2']);
    expect(calls[1]).toEqual({
      path: '/chat/markMessageAsRead/zs',
      body: { readMessages: [{ remoteJid: '5491100000004@s.whatsapp.net', fromMe: false, id: 'M1' }, { remoteJid: '5491100000004@s.whatsapp.net', fromMe: false, id: 'M2' }] },
    });
  });
});

describe('Tildes azules, tope de envíos, líneas caídas y grupos grandes', () => {
  it('leer el chat en Groups lo marca leído en WhatsApp solo con la opción activada', async () => {
    const { user, row } = await setup('wa2-read');
    await ingestEvents(row, [inbound('5491100000005@s.whatsapp.net', 'R-1', 'uno'), inbound('5491100000005@s.whatsapp.net', 'R-2', 'dos')]);
    const [c] = (await listChats(user.id, user.id)).rows;
    await updateChat(user.id, c.id, { read: true });
    expect(fakeSent(row.id).filter((s) => s.kind === 'read')).toHaveLength(0);
    await ingestEvents(row, [inbound('5491100000005@s.whatsapp.net', 'R-3', 'tres')]);
    await updateSettings(user.id, { readReceipts: true });
    await updateChat(user.id, c.id, { read: true });
    expect(fakeSent(row.id).filter((s) => s.kind === 'read')).toEqual([expect.objectContaining({ chatId: '5491100000005@s.whatsapp.net', text: 'R-3' })]);
  });

  it('una línea no manda más de 40 mensajes por minuto', async () => {
    vi.stubEnv('RATE_LIMIT_DISABLED', 'false');
    const { user, row } = await setup('wa2-rate');
    await ingestEvents(row, [inbound('5491100000006@s.whatsapp.net', 'L-1', 'hola')]);
    const [c] = (await listChats(user.id, user.id)).rows;
    await getDb().prepare('DELETE FROM rate_limits WHERE key = ?').run(`groups-send:${row.id}`);
    for (let i = 0; i < 40; i++) await sendMessage(user.id, user.id, c.id, { body: `m${i}` });
    await expect(sendMessage(user.id, user.id, c.id, { body: 'uno más' })).rejects.toMatchObject({ code: 'send_rate_limited' });
    // Las notas internas no cuentan.
    await expect(sendMessage(user.id, user.id, c.id, { body: 'nota', note: true })).resolves.toMatchObject({ direction: 'note' });
  });

  it('línea caída: solo las que tenían chats', async () => {
    const { user, row } = await setup('wa2-dropped');
    const other = await createNumber(user.id, user.id, { provider: 'fake' });
    await getDb().prepare("UPDATE groups_numbers SET status = 'qr' WHERE id IN (?, ?)").run(row.id, other.id);
    expect(await droppedNumbers(user.id)).toEqual([]);
    await ingestEvents(row, [inbound('5491100000010@s.whatsapp.net', 'D-1', 'hola')]);
    expect((await droppedNumbers(user.id)).map((n) => n.id)).toEqual([row.id]);
  });

  it('un grupo de 1.000 miembros se sincroniza entero', async () => {
    const { user, row } = await setup('wa2-big');
    await ingestEvents(row, [inbound('120363000000000099@g.us', 'B-1', 'hola')]);
    const [g] = (await listChats(user.id, user.id)).rows;
    const state = (globalThis as unknown as { __groupsFake: Map<string, { groups: Map<string, { participants: Array<{ phone: string; role: string }> }> }> }).__groupsFake.get(row.id)!;
    const grp = state.groups.get('120363000000000099@g.us');
    if (grp) grp.participants = Array.from({ length: 1000 }, (_, i) => ({ phone: `54911${String(i).padStart(8, '0')}`, role: i === 0 ? 'superadmin' : 'member' }));
    else state.groups.set('120363000000000099@g.us', { participants: Array.from({ length: 1000 }, (_, i) => ({ phone: `54911${String(i).padStart(8, '0')}`, role: 'member' })) } as never);
    const members = await syncMembers(user.id, g.id);
    expect(members).toHaveLength(1000);
    expect((await getChat(user.id, g.id))!.memberCount).toBe(1000);
  });
});
