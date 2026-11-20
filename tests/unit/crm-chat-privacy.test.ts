import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents } from '@/lib/groups';
import { setLineAccess } from '@/lib/groups-lines';
import { createGroupTask } from '@/lib/groups-tasks';
import { listTrash } from '@/lib/crm-trash';
import { createActivity, deleteActivity, exportRows, getActivity, getCrmOverview, listTasks, listTimeline, nextTaskFor, searchTasks } from '@/lib/crm';
import {
  chatHiddenSql,
  isChatHidden,
  noChatReader,
  personChatReader,
  privateChatMarker,
  redactChatTasks,
  sessionChatReader,
} from '@/lib/crm-chat-privacy';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

/**
 * CRM: una tarea que salió de un chat de Lines muestra su título y sus notas solo a quien ve ese chat.
 * Dos personas del mismo workspace: `friend` tiene la línea del chat; `member`, no. Textos inventados.
 */

const PERSON = '5491155550177';
const SECRET_TITLE = 'zqx titulo reservado del chat';
const SECRET_NOTES = 'zqx notas reservadas del chat';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

async function world(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const n = await createNumber(ws, ws, { provider: 'fake', name: 'Linea privada' });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  const line = (await getNumberRowById(n.id))!;
  await ingestEvents(line, [
    {
      type: 'message' as const,
      chatId: `${PERSON}@c.us`,
      isGroup: false,
      fromMe: false,
      senderPhone: PERSON,
      senderName: 'Cliente Privado',
      providerMessageId: `${label}-m1`,
      body: 'hola',
    },
  ]);
  await setLineAccess(ws, line.id, { ownerId: ws, visibility: 'restricted', personIds: [w.friend.id], teamIds: [] });
  const chat = (await getDb().prepare('SELECT id FROM groups_chats WHERE user_id = ? AND number_id = ?').get(ws, line.id)) as { id: string };
  const due = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const task = await createGroupTask(ws, w.friend.id, { chatId: chat.id, title: SECRET_TITLE, notes: SECRET_NOTES, dueAt: due, ownerId: w.member.id });
  const plain = await createActivity(ws, { type: 'task', subject: 'zqx tarea comun', body: 'zqx notas comunes', ownerId: w.member.id });
  return {
    ...w,
    ws,
    chatId: chat.id,
    taskId: task.activityId,
    plainId: plain.id,
    ownerReader: await sessionChatReader(asOwner(w.owner), 'en'),
    friendReader: await sessionChatReader(asMember(w.owner, w.friend), 'en'),
    memberReader: await sessionChatReader(asMember(w.owner, w.member), 'es'),
  };
}

describe('crm chat privacy', () => {
  it('readers: the owner reads everything without a filter; the two members get one', async () => {
    const w = await world('ccp-readers');
    expect(w.ownerReader).toBeNull();
    expect(w.friendReader).not.toBeNull();
    expect(w.memberReader).not.toBeNull();
    expect(await isChatHidden(w.ws, w.taskId, w.ownerReader)).toBe(false);
    expect(await isChatHidden(w.ws, w.taskId, w.friendReader)).toBe(false);
    expect(await isChatHidden(w.ws, w.taskId, w.memberReader)).toBe(true);
    // Una tarea que no salió de un chat no se tapa nunca.
    expect(await isChatHidden(w.ws, w.plainId, w.memberReader)).toBe(false);
    expect(chatHiddenSql('a', null)).toBeNull();
  });

  it('without the Lines app, no chat task is readable, even for someone who has the line', async () => {
    const w = await world('ccp-noapp');
    const reader = await sessionChatReader(asMember(w.owner, w.friend, 'member', ['crm']), 'en');
    expect(await isChatHidden(w.ws, w.taskId, reader)).toBe(true);
    expect(await isChatHidden(w.ws, w.taskId, noChatReader(w.ws))).toBe(true);
  });

  it('redacts title and notes for the person who cannot see the chat, in timeline, tasks and detail', async () => {
    const w = await world('ccp-lists');
    const pick = <T extends { id: string }>(rows: T[], id: string) => rows.find((r) => r.id === id);

    const memberTimeline = await listTimeline(w.ws, { type: 'task', chatReader: w.memberReader });
    const hidden = pick(memberTimeline, w.taskId)!;
    expect(hidden.subject).toBe(privateChatMarker('es'));
    expect(hidden.body).toBe('');
    expect(hidden.chat_private).toBe(1);
    expect(pick(memberTimeline, w.plainId)!.subject).toBe('zqx tarea comun');
    expect(JSON.stringify(memberTimeline)).not.toContain('reservad');

    const friendTimeline = await listTimeline(w.ws, { type: 'task', chatReader: w.friendReader });
    expect(pick(friendTimeline, w.taskId)!.subject).toBe(SECRET_TITLE);
    expect(pick(friendTimeline, w.taskId)!.body).toBe(SECRET_NOTES);
    expect(pick(friendTimeline, w.taskId)!.chat_private).toBeUndefined();

    const memberTasks = await listTasks(w.ws, { bucket: 'upcoming', chatReader: w.memberReader });
    expect(pick(memberTasks, w.taskId)!.subject).toBe(privateChatMarker('es'));
    const friendTasks = await listTasks(w.ws, { bucket: 'upcoming', chatReader: w.friendReader });
    expect(pick(friendTasks, w.taskId)!.subject).toBe(SECRET_TITLE);

    expect((await getActivity(w.ws, w.taskId, w.memberReader))!.body).toBe('');
    expect((await getActivity(w.ws, w.taskId, w.friendReader))!.body).toBe(SECRET_NOTES);
    // Sin lector (código interno, el owner): tal cual.
    expect((await getActivity(w.ws, w.taskId))!.subject).toBe(SECRET_TITLE);
  });

  it('search does not match hidden text, but still finds what the person can see', async () => {
    const w = await world('ccp-search');
    expect((await searchTasks(w.ws, 'titulo reservado', undefined, w.memberReader)).map((r) => r.id)).not.toContain(w.taskId);
    expect((await searchTasks(w.ws, 'notas reservadas', undefined, w.memberReader)).map((r) => r.id)).not.toContain(w.taskId);
    expect((await searchTasks(w.ws, 'titulo reservado', undefined, w.friendReader)).map((r) => r.id)).toContain(w.taskId);
    expect((await searchTasks(w.ws, 'tarea comun', undefined, w.memberReader)).map((r) => r.id)).toContain(w.plainId);
  });

  it('export, overview and next task follow the same rule', async () => {
    const w = await world('ccp-export');
    const exported = (await exportRows(w.ws, 'activities', undefined, undefined, w.memberReader)) as Array<{ id: string; subject: string; body: string }>;
    expect(exported.find((r) => r.id === w.taskId)!.subject).toBe(privateChatMarker('es'));
    expect(JSON.stringify(exported)).not.toContain('reservad');
    const own = (await exportRows(w.ws, 'activities', undefined, undefined, w.friendReader)) as Array<{ id: string; subject: string }>;
    expect(own.find((r) => r.id === w.taskId)!.subject).toBe(SECRET_TITLE);

    const overview = await getCrmOverview(w.ws, undefined, w.memberReader);
    expect(JSON.stringify([overview.recentActivities, overview.upcomingTasks])).not.toContain('reservad');

    const contact = (await getDb().prepare('SELECT contact_id FROM crm_activities WHERE id = ?').get(w.taskId)) as { contact_id: string | null };
    if (contact.contact_id) {
      const next = await nextTaskFor(w.ws, { contactId: contact.contact_id, chatReader: w.memberReader });
      expect(next?.subject).not.toBe(SECRET_TITLE);
    }
  });

  it('a person outside a request (notices, API keys) gets the reader of their access', async () => {
    const w = await world('ccp-person');
    expect(await personChatReader(w.ws, w.ws, 'en')).toBeNull();
    expect(await isChatHidden(w.ws, w.taskId, await personChatReader(w.ws, w.friend.id, 'en'))).toBe(false);
    expect(await isChatHidden(w.ws, w.taskId, await personChatReader(w.ws, w.member.id, 'en'))).toBe(true);
    // Alguien que ya no es del workspace no ve ningún chat.
    expect(await isChatHidden(w.ws, w.taskId, await personChatReader(w.ws, w.stranger.id, 'en'))).toBe(true);
  });

  it('the trash shows the marker, not the title, and is not searchable by it', async () => {
    const w = await world('ccp-trash');
    expect(await deleteActivity(w.ws, w.taskId)).toBe(true);
    const all = await listTrash(w.ws, { entity: 'activity' });
    expect(all.find((r) => r.record_id === w.taskId)?.label).toBe(privateChatMarker('en'));
    expect(JSON.stringify(all)).not.toContain(SECRET_TITLE);
    expect(await listTrash(w.ws, { q: 'titulo reservado' })).toEqual([]);
  });

  it('keeps the order and leaves rows from other chats alone', async () => {
    const w = await world('ccp-order');
    const rows = [
      { id: w.plainId, subject: 'a', body: 'b' },
      { id: w.taskId, subject: 'c', body: 'd' },
    ];
    const out = await redactChatTasks(w.ws, rows, w.memberReader);
    expect(out.map((r) => r.id)).toEqual([w.plainId, w.taskId]);
    expect(out[0]).toBe(rows[0]);
    expect(out[1].subject).toBe(privateChatMarker('es'));
  });
});
