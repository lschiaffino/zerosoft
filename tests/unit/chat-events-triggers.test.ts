import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createChatConversation, createChatMessage, createChatWidget, getOrCreateChatVisitor, markMessagesRead } from '@/lib/chat-data';
import { makeUser } from './helpers';

const TRIGGERS = [
  ['chat_events_msg_ins', 'chat_messages'],
  ['chat_events_msg_read', 'chat_messages'],
  ['chat_events_msg_upd', 'chat_messages'],
  ['chat_events_conv_ins', 'chat_conversations'],
  ['chat_events_conv_upd', 'chat_conversations'],
  ['chat_events_typing_ins', 'chat_typing'],
  ['chat_events_typing_upd', 'chat_typing'],
  ['chat_events_typing_del', 'chat_typing'],
  ['chat_events_presence_ins', 'chat_presence'],
  ['chat_events_presence_upd', 'chat_presence'],
  ['chat_events_presence_del', 'chat_presence'],
];

/**
 * El tiempo real de Chat depende de estos triggers y un trigger vive con su
 * tabla. Si una migración reconstruye una de estas tablas y no los recrea, este
 * test falla: hay que recrearlos en esa misma migración (ver la 147).
 */
describe('triggers de chat_events después de todas las migraciones', () => {
  it('siguen todos, en su tabla', async () => {
    const rows = (await getDb().prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'chat_events_%'").all()) as Array<{ name: string; tbl_name: string }>;
    const found = new Map(rows.map((r) => [r.name, r.tbl_name]));
    for (const [name, table] of TRIGGERS) expect(found.get(name), name).toBe(table);
  });

  it('un mensaje anota un evento y marcar muchos leídos anota uno por conversación', async () => {
    const owner = await makeUser('o');
    const widget = await createChatWidget(owner.id, null, { name: 'W' } as never);
    const v = await getOrCreateChatVisitor(widget.id, 'k', {});
    const c = await createChatConversation(widget.id, v.id);
    const count = async () => Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM chat_events WHERE conversation_id = ?').get(c.id)) as { n: number }).n);
    const start = await count();
    for (let i = 0; i < 6; i++) await createChatMessage(c.id, 'visitor', { body: `m${i}` });
    const afterMessages = await count();
    expect(afterMessages).toBeGreaterThan(start);
    await markMessagesRead(c.id, 'user');
    expect((await count()) - afterMessages).toBeLessThanOrEqual(1);
  });
});
