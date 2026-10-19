import { describe, expect, it } from 'vitest';
import {
  countChatConversations,
  createChatConversation,
  createChatMessage,
  createChatWidget,
  getOrCreateChatVisitor,
  listChatConversations,
  matchSnippet,
} from '@/lib/chat-data';
import { makeUser } from './helpers';

async function setup() {
  const owner = await makeUser('chatsearch');
  const widget = await createChatWidget(owner.id, null, { name: 'W' });
  const visitor = await getOrCreateChatVisitor(widget.id, `ext-${crypto.randomUUID()}`, { name: 'Ana', email: 'ana@x.com' });
  const order = await createChatConversation(widget.id, visitor.id, 'Hello');
  await createChatMessage(order.id, 'visitor', { body: 'My order #A-4471 never arrived, can you check?' });
  await createChatMessage(order.id, 'user', { body: 'Looking into it now.', userId: owner.id });
  const other = await createChatConversation(widget.id, visitor.id, 'Other');
  await createChatMessage(other.id, 'visitor', { body: 'How do I reset my password?' });
  await createChatMessage(other.id, 'user', { body: 'Customer is on the legacy plan', userId: owner.id, isNote: true });
  return { owner, widget, order, other };
}

describe('Chat inbox: búsqueda por contenido de mensajes', () => {
  it('encuentra conversaciones por el texto de un mensaje, con el fragmento que coincide', async () => {
    const { widget, order } = await setup();
    const rows = await listChatConversations([widget.id], { q: 'A-4471' });
    expect(rows.map((r) => r.id)).toEqual([order.id]);
    expect(rows[0].match_snippet).toContain('#A-4471 never arrived');
    expect(await countChatConversations([widget.id], { q: 'A-4471' })).toBe(1);
  });

  it('incluye las notas internas (el inbox es solo para agentes)', async () => {
    const { widget, other } = await setup();
    const rows = await listChatConversations([widget.id], { q: 'legacy plan' });
    expect(rows.map((r) => r.id)).toEqual([other.id]);
    expect(rows[0].match_snippet).toBe('Customer is on the legacy plan');
  });

  it('sigue buscando por asunto, nombre y email; % y _ no son comodines', async () => {
    const { widget } = await setup();
    expect(await countChatConversations([widget.id], { q: 'ana@x.com' })).toBe(2);
    expect((await listChatConversations([widget.id], { q: 'Other' })).length).toBe(1);
    expect(await countChatConversations([widget.id], { q: '%' })).toBe(0);
    const plain = await listChatConversations([widget.id], {});
    expect(plain[0].match_snippet ?? null).toBeNull();
  });

  it('matchSnippet recorta alrededor de la coincidencia', () => {
    const long = `${'a'.repeat(200)} needle ${'b'.repeat(200)}`;
    const s = matchSnippet(long, 'NEEDLE', 10);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('needle');
    expect(matchSnippet('short text', 'zzz')).toBe('short text');
  });
});
