import { describe, expect, it, vi } from 'vitest';

import { getDb } from '@/lib/db';
import {
  conversationOrderBy,
  createChatConversation,
  createChatMessage,
  createChatWidget,
  getOrCreateChatVisitor,
  listChatConversations,
  parseConversationSort,
} from '@/lib/chat-data';
import { inboxQuery } from '@/components/chat/inbox-model';
import { makeUser } from './helpers';

describe('orden de la bandeja de Chat', () => {
  it('parsea solo valores conocidos', () => {
    expect(parseConversationSort('waiting')).toBe('waiting');
    expect(parseConversationSort('oldest')).toBe('oldest');
    expect(parseConversationSort('x; DROP TABLE')).toBeUndefined();
    expect(parseConversationSort(null)).toBeUndefined();
  });

  it('el ORDER BY por defecto es la actividad reciente', () => {
    expect(conversationOrderBy(undefined)).toBe('c.updated_at DESC');
    expect(conversationOrderBy('recent')).toBe('c.updated_at DESC');
    expect(conversationOrderBy('oldest')).toBe('c.updated_at ASC');
  });

  it('inboxQuery manda sort solo si no es el default', () => {
    const base = { status: 'open', assignee: 'any', q: '', tag: '' } as const;
    expect(inboxQuery({ ...base }, [], 'u1').sort).toBeUndefined();
    expect(inboxQuery({ ...base, sort: 'recent' }, [], 'u1').sort).toBeUndefined();
    expect(inboxQuery({ ...base, sort: 'waiting' }, [], 'u1').sort).toBe('waiting');
  });

  it('waiting: primero quien espera hace más, luego las respondidas', async () => {
    const db = getDb();
    const owner = await makeUser('sort');
    const widget = await createChatWidget(owner.id, null, { name: 'Sort widget' });
    const mk = async (tag: string) => {
      const v = await getOrCreateChatVisitor(widget.id, `vis-${tag}-${crypto.randomUUID()}`);
      return createChatConversation(widget.id, v.id);
    };
    const waitingLong = await mk('long');
    const waitingShort = await mk('short');
    const answered = await mk('answered');

    const at = async (convId: string, sender: 'visitor' | 'user', iso: string, body: string, note = false) => {
      const m = await createChatMessage(convId, sender, { body, userId: sender === 'user' ? owner.id : undefined, isNote: note } as Parameters<typeof createChatMessage>[2]);
      await db.prepare('UPDATE chat_messages SET created_at = ? WHERE id = ?').run(iso, m.id);
    };
    await at(waitingLong.id, 'visitor', '2026-01-01T10:00:00.000Z', 'hola');
    // una nota interna posterior no cuenta como respuesta
    await at(waitingLong.id, 'user', '2026-01-01T10:05:00.000Z', 'nota', true);
    await at(waitingShort.id, 'visitor', '2026-01-01T12:00:00.000Z', 'ayuda');
    await at(answered.id, 'visitor', '2026-01-01T08:00:00.000Z', 'precio?');
    await at(answered.id, 'user', '2026-01-01T08:10:00.000Z', 'diez');
    for (const [c, u] of [[waitingLong, '2026-01-02T00:00:00.000Z'], [waitingShort, '2026-01-02T00:01:00.000Z'], [answered, '2026-01-02T00:02:00.000Z']] as const) {
      await db.prepare('UPDATE chat_conversations SET updated_at = ? WHERE id = ?').run(u, c.id);
    }

    const waiting = await listChatConversations([widget.id], { sort: 'waiting' });
    expect(waiting.map((r) => r.id)).toEqual([waitingLong.id, waitingShort.id, answered.id]);
    const recent = await listChatConversations([widget.id]);
    expect(recent.map((r) => r.id)).toEqual([answered.id, waitingShort.id, waitingLong.id]);
    const oldest = await listChatConversations([widget.id], { sort: 'oldest' });
    expect(oldest.map((r) => r.id)).toEqual([waitingLong.id, waitingShort.id, answered.id]);
  });
});
