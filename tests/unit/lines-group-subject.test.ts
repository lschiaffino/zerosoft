/**
 * Lines: un grupo que llega sin asunto (del historial, o un gateway que no lo manda) nunca muestra su id
 * "@g.us". Se pide el asunto a WhatsApp apenas llega el mensaje, como Inbox, y mientras tanto la lista dice
 * "Grupo" en el idioma de quien mira, como Inbox. Con el WhatsApp falso; nombres y números inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { chatDisplayName, connectNumber, createNumber, fillGroupSubject, getChat, getNumberRowById, ingestEvents, listChats, type NumberRow } from '@/lib/groups';
import { pageLocale } from '@/lib/groups-http';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);
const groupJid = () => `120363${Math.floor(1e11 + Math.random() * 8e11)}@g.us`;

async function line(label: string) {
  const u = await makeUser(label);
  const n = await createNumber(u.id, u.id, { provider: 'fake' });
  await connectNumber(u.id, n.id);
  const s = fakeState(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return { ws: u.id, number: (await getNumberRowById(n.id)) as NumberRow };
}

function groupMessage(chatId: string, over: Record<string, unknown> = {}) {
  return {
    type: 'message' as const,
    chatId,
    isGroup: true,
    fromMe: false,
    senderPhone: '15550001009',
    senderName: 'Persona Prueba',
    providerMessageId: `m-${Math.random().toString(36).slice(2)}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  };
}

describe('Lines: grupo sin asunto', () => {
  it('pide el asunto a WhatsApp al llegar el mensaje y nunca muestra el id', async () => {
    const { ws, number } = await line('lgs-a');
    const jid = groupJid();
    await ingestEvents(number, [groupMessage(jid)]);
    const [c] = (await listChats(ws, ws)).rows;
    expect(c.kind).toBe('group');
    // El WhatsApp falso contesta "Grupo <últimos 4 dígitos>" para un grupo sin asunto conocido.
    expect(c.name).toBe(`Grupo ${jid.replace(/\D/g, '').slice(-4)}`);
    expect(c.name).not.toContain('@g.us');
  });

  it('no pisa el asunto que vino con el mensaje', async () => {
    const { ws, number } = await line('lgs-b');
    await ingestEvents(number, [groupMessage(groupJid(), { chatName: 'Equipo Prueba' })]);
    const [c] = (await listChats(ws, ws)).rows;
    expect(c.name).toBe('Equipo Prueba');
  });

  it('sin asunto todavía: un nombre genérico en el idioma de quien mira', async () => {
    const { ws, number } = await line('lgs-c');
    await ingestEvents(number, [groupMessage(groupJid(), { chatName: 'Equipo Prueba' })]);
    const [c] = (await listChats(ws, ws)).rows;
    await getDb().prepare("UPDATE groups_chats SET name = '' WHERE id = ?").run(c.id);
    await getDb().prepare("UPDATE users SET locale = 'es' WHERE id = ?").run(ws);
    expect((await listChats(ws, ws)).rows[0].name).toBe('Grupo');
    expect((await getChat(ws, c.id))!.name).toBe('Grupo');
    await getDb().prepare("UPDATE users SET locale = 'pt' WHERE id = ?").run(ws);
    expect((await listChats(ws, ws)).rows[0].name).toBe('Grupo');
  });

  it('el idioma de la página gana al guardado de la persona', async () => {
    const { ws, number } = await line('lgs-page');
    await ingestEvents(number, [groupMessage(groupJid(), { chatName: 'Equipo Prueba' })]);
    const [c] = (await listChats(ws, ws)).rows;
    await getDb().prepare("UPDATE groups_chats SET name = '' WHERE id = ?").run(c.id);
    await getDb().prepare("UPDATE users SET locale = 'en' WHERE id = ?").run(ws);
    expect((await listChats(ws, ws, { locale: 'es' })).rows[0].name).toBe('Grupo');
    expect((await getChat(ws, c.id, 'es'))!.name).toBe('Grupo');
    expect((await listChats(ws, ws)).rows[0].name).toBe('Group');
  });

  it('pageLocale: solo la cookie NEXT_LOCALE con un idioma de la app', () => {
    const req = (cookie?: string) => new Request('http://x.test/api/groups/chats', { headers: cookie ? { cookie } : {} });
    expect(pageLocale(req('a=1; NEXT_LOCALE=pt'))).toBe('pt');
    expect(pageLocale(req('NEXT_LOCALE=fr'))).toBeUndefined();
    expect(pageLocale(req())).toBeUndefined();
  });

  it('chatDisplayName: grupo, lid y 1:1 sin nombre', () => {
    const g = groupJid();
    expect(chatDisplayName({ name: '', phone: '', provider_chat_id: g })).toBe('Group');
    expect(chatDisplayName({ name: '', phone: '', provider_chat_id: g }, 'es-AR')).toBe('Grupo');
    expect(chatDisplayName({ name: '', phone: '', provider_chat_id: g }, 'xx')).toBe('Group');
    expect(chatDisplayName({ name: '', phone: '', provider_chat_id: '123456789012@lid' }, 'pt')).toBe('Contato do WhatsApp');
    expect(chatDisplayName({ name: '', phone: '15550001009', provider_chat_id: '15550001009@s.whatsapp.net' })).toBe('+15550001009');
    expect(chatDisplayName({ name: 'Equipo Prueba', phone: '', provider_chat_id: g })).toBe('Equipo Prueba');
  });

  it('la línea de otro workspace no le pone nombre a un chat ajeno', async () => {
    const a = await line('lgs-own');
    const b = await line('lgs-other');
    const jid = groupJid();
    await ingestEvents(a.number, [groupMessage(jid, { chatName: 'Equipo Prueba' })]);
    const [c] = (await listChats(a.ws, a.ws)).rows;
    await getDb().prepare("UPDATE groups_chats SET name = '' WHERE id = ?").run(c.id);
    expect(await fillGroupSubject(b.number, c.id, jid)).toBe(false);
    const row = (await getDb().prepare('SELECT name FROM groups_chats WHERE id = ?').get(c.id)) as { name: string };
    expect(row.name).toBe('');
    // La propia sí.
    expect(await fillGroupSubject(a.number, c.id, jid)).toBe(true);
  });
});
