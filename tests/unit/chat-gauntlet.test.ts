import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import {
  applyAssignmentRules,
  createAssignmentRule,
  createChatConversation,
  createChatWidget,
  getChatConversation,
  getOrCreateChatVisitor,
  getVisitorConversationWithMessages,
  listChatMessagesWithUsers,
  updateChatConversation,
} from '@/lib/chat-data';
import { addMember, createTeam } from '@/lib/teams';
import { makeUser } from './helpers';

type FakeUser = {
  id: string;
  email: string;
  actingUser?: { id: string; email: string; name: string | null };
  team?: { id: string } | null;
};
const session = vi.hoisted(() => ({ user: null as null | FakeUser }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: FakeUser) => u.actingUser?.id ?? u.id,
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    void task().catch(() => {});
  },
}));
vi.mock('@/lib/uploads', async (orig) => ({
  ...(await orig<typeof import('@/lib/uploads')>()),
  saveUpload: async (_folder: string, filename: string) => `/uploads/chat/${filename}`,
}));

const agentMessages = await import('@/lib/routes/chat/conversations/[id]/messages/route');
const agentAttachments = await import('@/lib/routes/chat/conversations/[id]/attachments/route');
const conversationRoute = await import('@/lib/routes/chat/conversations/[id]/route');
const rulesRoute = await import('@/lib/routes/chat/widgets/[id]/rules/route');
const visitorMessages = await import('@/app/api/chat/messages/route');
const visitorUpload = await import('@/app/api/chat/messages/upload/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
let ipN = 0;
function jsonReq(url: string, method: string, body?: unknown) {
  ipN += 1;
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${ipN >> 8}.${ipN & 255}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function setup(label: string) {
  const owner = await makeUser(label);
  const widget = await createChatWidget(owner.id, null, { name: `${label} widget` });
  const externalId = `ext-${crypto.randomUUID()}`;
  const visitor = await getOrCreateChatVisitor(widget.id, externalId);
  const conversation = await createChatConversation(widget.id, visitor.id);
  return { owner, widget, visitor, externalId, conversation };
}

async function notificationsFor(userId: string, conversationId: string) {
  return (await getDb()
    .prepare('SELECT * FROM notifications WHERE user_id = ? AND source_id = ?')
    .all(userId, conversationId)) as Array<{ title: string }>;
}

beforeEach(() => {
  session.user = null;
});

describe('Chat: respuesta del agente a una conversación resuelta', () => {
  it('la reabre para que el visitante la vea', async () => {
    const { owner, widget, externalId, conversation } = await setup('reopen');
    await updateChatConversation(conversation.id, { status: 'resolved' });
    session.user = { id: owner.id, email: owner.email };
    const res = await agentMessages.POST(
      jsonReq(`http://x/api/chat/conversations/${conversation.id}/messages`, 'POST', { body: 'Seguimos' }),
      ctx(conversation.id),
    );
    expect(res.status).toBe(201);
    expect((await getChatConversation(conversation.id))?.status).toBe('open');
    const forVisitor = await getVisitorConversationWithMessages(widget.id, externalId);
    expect(forVisitor?.messages.map((m) => m.body)).toContain('Seguimos');
  });

  it('una nota interna no la reabre', async () => {
    const { owner, conversation } = await setup('reopen-note');
    await updateChatConversation(conversation.id, { status: 'resolved' });
    session.user = { id: owner.id, email: owner.email };
    await agentMessages.POST(
      jsonReq(`http://x/api/chat/conversations/${conversation.id}/messages`, 'POST', { body: 'nota', note: true }),
      ctx(conversation.id),
    );
    expect((await getChatConversation(conversation.id))?.status).toBe('resolved');
  });

  it('rechaza mensajes de agente demasiado largos', async () => {
    const { owner, conversation } = await setup('agent-long');
    session.user = { id: owner.id, email: owner.email };
    const res = await agentMessages.POST(
      jsonReq(`http://x/api/chat/conversations/${conversation.id}/messages`, 'POST', { body: 'x'.repeat(5001) }),
      ctx(conversation.id),
    );
    expect(res.status).toBe(400);
  });
});

describe('Chat: asignación solo a agentes del widget', () => {
  it('PATCH assignedTo de otro workspace → 400 y no filtra su email', async () => {
    const { owner, conversation } = await setup('assign');
    const stranger = await makeUser('stranger');
    session.user = { id: owner.id, email: owner.email };
    const res = await conversationRoute.PATCH(
      jsonReq(`http://x/api/chat/conversations/${conversation.id}`, 'PATCH', { assignedTo: stranger.id }),
      ctx(conversation.id),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain(stranger.email);
    expect((await getChatConversation(conversation.id))?.assigned_to).toBeNull();

    const ok = await conversationRoute.PATCH(
      jsonReq(`http://x/api/chat/conversations/${conversation.id}`, 'PATCH', { assignedTo: owner.id }),
      ctx(conversation.id),
    );
    expect(ok.status).toBe(200);
  });

  it('las reglas no aceptan assignTo ajeno', async () => {
    const { owner, widget } = await setup('rules');
    const stranger = await makeUser('stranger');
    session.user = { id: owner.id, email: owner.email };
    const res = await rulesRoute.POST(
      jsonReq(`http://x/api/chat/widgets/${widget.id}/rules`, 'POST', {
        name: 'r',
        matchType: 'all',
        assignTo: stranger.id,
      }),
      ctx(widget.id),
    );
    expect(res.status).toBe(400);
  });
});

describe('Chat: round-robin por carga activa', () => {
  it('un agente nuevo no absorbe todas las entrantes', async () => {
    const owner = await makeUser('rr-own');
    const a = await makeUser('rr-a');
    const b = await makeUser('rr-b');
    const team = await createTeam(owner.id, 'Soporte RR');
    await addMember(team.id, a.id, 'member');
    await addMember(team.id, b.id, 'member');
    const widget = await createChatWidget(owner.id, team.id, { name: 'rr' });
    await createAssignmentRule(widget.id, { name: 'rr', matchType: 'round_robin' });
    const visitor = await getOrCreateChatVisitor(widget.id, `ext-${crypto.randomUUID()}`);
    // Historial: el owner y A ya atendieron (y resolvieron) muchas conversaciones.
    for (let i = 0; i < 5; i += 1) {
      for (const agent of [owner.id, a.id]) {
        const c = await createChatConversation(widget.id, visitor.id);
        await updateChatConversation(c.id, { assignedTo: agent, status: 'resolved' });
      }
    }
    const agents = [
      { id: owner.id, email: owner.email, name: owner.name, image: null },
      { id: a.id, email: a.email, name: a.name, image: null },
      { id: b.id, email: b.email, name: b.name, image: null },
    ];
    const assigned: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const c = await createChatConversation(widget.id, visitor.id);
      assigned.push((await applyAssignmentRules(widget.id, c.id, 'hola', agents))!);
    }
    expect(new Set(assigned).size).toBe(3);
  });
});

describe('Chat: adjunto como primer mensaje del visitante', () => {
  it('aplica reglas de asignación y notifica', async () => {
    const owner = await makeUser('up-own');
    const widget = await createChatWidget(owner.id, null, { name: 'up' });
    await createAssignmentRule(widget.id, { name: 'all', matchType: 'all', assignTo: owner.id });
    const externalId = `ext-${crypto.randomUUID()}`;
    const form = new FormData();
    form.append('widgetId', widget.id);
    form.append('visitorId', externalId);
    form.append('file', new File([new Uint8Array([137, 80, 78, 71])], 'captura.png', { type: 'image/png' }));
    const res = await visitorUpload.POST(
      new Request('http://x/api/chat/messages/upload', {
        method: 'POST',
        body: form,
        headers: { 'x-forwarded-for': '10.8.0.1' },
      }),
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as { conversation: { id: string; assigned_to: string | null } };
    expect(data.conversation.assigned_to).toBe(owner.id);
    expect((await getChatConversation(data.conversation.id))?.assigned_to).toBe(owner.id);
    expect(await notificationsFor(owner.id, data.conversation.id)).toHaveLength(1);
  });
});

describe('Chat: límites del POST público del visitante', () => {
  it('rechaza body, subject o fields excesivos', async () => {
    const { widget } = await setup('limits');
    const base = { widgetId: widget.id, visitorId: `ext-${crypto.randomUUID()}` };
    const post = (extra: Record<string, unknown>) =>
      visitorMessages.POST(jsonReq('http://x/api/chat/messages', 'POST', { ...base, ...extra }));
    expect((await post({ body: 'x'.repeat(5001) })).status).toBe(400);
    expect((await post({ body: 'hola', subject: 's'.repeat(201) })).status).toBe(400);
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, 'v']));
    expect((await post({ body: 'Started chat', fields: many })).status).toBe(400);
    expect((await post({ body: 'Started chat', fields: { email: 'x'.repeat(1001) } })).status).toBe(400);
    expect((await post({ body: 'hola', fields: { email: 'a@b.c' } })).status).toBe(201);
  });
});

describe('Chat: adjuntos del agente', () => {
  it('quedan atribuidos al miembro real, no al owner del workspace', async () => {
    const owner = await makeUser('att-own');
    const member = await makeUser('att-mem');
    const team = await createTeam(owner.id, 'Soporte att');
    await addMember(team.id, member.id, 'member');
    const widget = await createChatWidget(owner.id, team.id, { name: 'att' });
    const visitor = await getOrCreateChatVisitor(widget.id, `ext-${crypto.randomUUID()}`);
    const conversation = await createChatConversation(widget.id, visitor.id);
    session.user = {
      id: owner.id,
      email: owner.email,
      actingUser: { id: member.id, email: member.email, name: member.name },
      team: { id: team.id },
    };
    const form = new FormData();
    form.append('file', new File([new Uint8Array([37, 80, 68, 70])], 'doc.pdf', { type: 'application/pdf' }));
    const res = await agentAttachments.POST(
      new Request(`http://x/api/chat/conversations/${conversation.id}/attachments`, { method: 'POST', body: form }),
      ctx(conversation.id),
    );
    expect(res.status).toBe(201);
    const [msg] = await listChatMessagesWithUsers(conversation.id);
    expect(msg.user_id).toBe(member.id);
  });
});
