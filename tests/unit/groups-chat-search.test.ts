import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { chatSearchTerms, HIT_END, HIT_START, searchChatMessages } from '@/lib/groups-chat-search';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

const inbound = (chatId: string, id: string, body: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  fromMe: false,
  senderPhone: '5491155550000',
  senderName: 'Ana',
  providerMessageId: id,
  body,
});

async function setup(label: string) {
  const user = await makeUser(label);
  const n = await createNumber(user.id, user.id, { provider: 'fake' });
  await connectNumber(user.id, n.id);
  const row = (await getNumberRowById(n.id))!;
  const a = `54911${Math.floor(1e7 + Math.random() * 8e7)}@c.us`;
  const b = `54911${Math.floor(1e7 + Math.random() * 8e7)}@c.us`;
  await ingestEvents(row, [inbound(a, `${label}-1`, 'Te mando el presupuesto mañana'), inbound(a, `${label}-2`, 'El presupuesto final es 100'), inbound(b, `${label}-3`, 'presupuesto de otro chat')]);
  const chats = (await listChats(user.id, user.id)).rows;
  const chatA = chats.find((c) => c.phone && a.startsWith(c.phone))!;
  return { user, chatA };
}

describe('Lines: buscar mensajes dentro de un chat', () => {
  it('palabras de la búsqueda', () => {
    expect(chatSearchTerms('  "presupuesto   final" ')).toEqual(['presupuesto', 'final']);
    expect(chatSearchTerms('')).toEqual([]);
  });

  it('solo los mensajes del chat, del más nuevo al más viejo, con lo encontrado marcado', async () => {
    const { user, chatA } = await setup('lcs');
    const r = await searchChatMessages(user.id, null, [chatA.id], 'presupuesto');
    expect(r.hits).toHaveLength(2);
    expect(r.hits.every((h) => h.chatId === chatA.id)).toBe(true);
    expect(r.hits[0].snippet).toContain(`${HIT_START}presupuesto${HIT_END} final`);
    expect(r.hits[0].senderName).toBe('Ana');
    // Todas las palabras tienen que estar.
    expect((await searchChatMessages(user.id, null, [chatA.id], 'presupuesto final')).hits).toHaveLength(1);
    // Paginado: lo anterior al último resultado.
    const one = await searchChatMessages(user.id, null, [chatA.id], 'presupuesto', { limit: 1 });
    expect(one.more).toBe(true);
    const next = await searchChatMessages(user.id, null, [chatA.id], 'presupuesto', { limit: 1, before: one.hits[0].sentAt });
    expect(next.hits.map((h) => h.id)).not.toContain(one.hits[0].id);
  });

  it('nunca devuelve mensajes de otro workspace', async () => {
    const a = await setup('lcsa');
    const b = await setup('lcsb');
    expect((await searchChatMessages(b.user.id, null, [a.chatA.id], 'presupuesto')).hits).toHaveLength(0);
  });
});
