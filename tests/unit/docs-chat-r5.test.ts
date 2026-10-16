import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import {
  createAssignmentRule,
  createChatConversation,
  createChatWidget,
  getChatConversation,
  getOrCreateChatVisitor,
  updateChatConversation,
} from '@/lib/chat-data';
import { markHandoff } from '@/lib/chat-bot-ai';
import { createDocPage, createDocShare, updateDocPage } from '@/lib/docs';
import { getHelpFeedbackStats, listHelpCollections, recordHelpFeedback } from '@/lib/docs-help';
import { addMember, createTeam, removeMember } from '@/lib/teams';
import { makeUser } from './helpers';

type FakeUser = {
  id: string;
  email: string;
  role: string;
  team?: { id: string } | null;
  actingUser?: { id: string; email: string; name: string | null };
};
const session = vi.hoisted(() => ({ user: null as null | FakeUser }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: FakeUser) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: FakeUser) => u.role === 'owner' || u.role === 'admin',
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    void task().catch(() => {});
  },
}));

const visitorMessages = await import('@/app/api/chat/messages/route');
const pageRoute = await import('@/app/api/docs/pages/[id]/route');
const mentionsRoute = await import('@/app/api/docs/pages/[id]/mentions/route');
const membersRoute = await import('@/app/api/docs/members/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
let ipN = 0;
function jsonReq(url: string, method: string, body?: unknown) {
  ipN += 1;
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.5.${ipN >> 8}.${ipN & 255}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const para = (content: string) => [{ id: crypto.randomUUID(), type: 'paragraph' as const, content }];

async function notificationsFor(userId: string, conversationId: string) {
  return (await getDb()
    .prepare('SELECT * FROM notifications WHERE user_id = ? AND source_id = ?')
    .all(userId, conversationId)) as Array<{ title: string }>;
}

async function teamWidget(label: string) {
  const owner = await makeUser(`${label}-own`);
  const member = await makeUser(`${label}-mem`);
  const team = await createTeam(owner.id, `Soporte ${label}`);
  await addMember(team.id, member.id, 'member');
  const widget = await createChatWidget(owner.id, team.id, { name: label });
  const externalId = `ext-${crypto.randomUUID()}`;
  const visitor = await getOrCreateChatVisitor(widget.id, externalId);
  const conversation = await createChatConversation(widget.id, visitor.id);
  return { owner, member, team, widget, visitor, externalId, conversation };
}

beforeEach(() => {
  session.user = null;
});

describe('Chat: agente que sale del team', () => {
  it('removeMember deja sin asignar sus conversaciones del team', async () => {
    const { member, team, conversation } = await teamWidget('rm1');
    await updateChatConversation(conversation.id, { assignedTo: member.id });
    await removeMember(team.id, member.id);
    expect((await getChatConversation(conversation.id))?.assigned_to).toBeNull();
  });

  it('un mensaje del visitante no le llega a un asignado que ya no es agente, y las reglas reparten', async () => {
    const { owner, member, team, widget, externalId, conversation } = await teamWidget('rm2');
    await removeMember(team.id, member.id);
    // Asignación vieja que quedó colgada (p. ej. de antes del fix).
    await getDb().prepare('UPDATE chat_conversations SET assigned_to = ? WHERE id = ?').run(member.id, conversation.id);
    await createAssignmentRule(widget.id, { name: 'all', matchType: 'all', assignTo: owner.id });
    const res = await visitorMessages.POST(
      jsonReq('http://x/api/chat/messages', 'POST', { widgetId: widget.id, visitorId: externalId, body: 'hola, sigo esperando' }),
    );
    expect(res.status).toBe(201);
    expect(await notificationsFor(member.id, conversation.id)).toHaveLength(0);
    expect((await getChatConversation(conversation.id))?.assigned_to).toBe(owner.id);
  });

  it('markHandoff no notifica a un asignado que ya no es agente', async () => {
    const { owner, member, team, widget, conversation } = await teamWidget('rm3');
    await removeMember(team.id, member.id);
    await getDb().prepare('UPDATE chat_conversations SET assigned_to = ? WHERE id = ?').run(member.id, conversation.id);
    const conv = (await getChatConversation(conversation.id))!;
    await markHandoff(widget, conv);
    expect(await notificationsFor(member.id, conversation.id)).toHaveLength(0);
    expect(await notificationsFor(owner.id, conversation.id)).toHaveLength(1);
  });
});

describe('Chat: respuesta del visitante a una conversación pendiente', () => {
  it('la vuelve a Abiertas', async () => {
    const { widget, externalId, conversation } = await teamWidget('pend');
    await updateChatConversation(conversation.id, { status: 'pending' });
    const res = await visitorMessages.POST(
      jsonReq('http://x/api/chat/messages', 'POST', { widgetId: widget.id, visitorId: externalId, body: 'ya está' }),
    );
    expect(res.status).toBe(201);
    expect((await getChatConversation(conversation.id))?.status).toBe('open');
  });
});

describe('Docs: concurrencia en PATCH que no tocan el contenido', () => {
  it('publicar sobre una base vieja da 409 (no adelanta la base a la versión ajena)', async () => {
    const owner = await makeUser('r5conf');
    const page = await createDocPage(owner.id, { title: 'P' });
    const base = page.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    await updateDocPage(owner.id, page.id, { content: para('de B'), base_updated_at: base });
    session.user = { id: owner.id, email: owner.email, role: 'owner' };
    const res = await pageRoute.PATCH(
      jsonReq(`http://t/api/docs/pages/${page.id}`, 'PATCH', { published: true, base_updated_at: base }),
      ctx(page.id),
    );
    expect(res.status).toBe(409);
  });
});

describe('Docs: menciones desde el workspace de la página', () => {
  async function setup() {
    const owner = await makeUser('mo');
    const ownerMate = await makeUser('mo-mate');
    const ownerTeam = await createTeam(owner.id, 'Dueños');
    await addMember(ownerTeam.id, ownerMate.id, 'member');
    const guestOwner = await makeUser('mg-own');
    const guest = await makeUser('mg');
    const guestMate = await makeUser('mg-mate');
    const guestTeam = await createTeam(guestOwner.id, 'Invitados');
    await addMember(guestTeam.id, guest.id, 'member');
    await addMember(guestTeam.id, guestMate.id, 'member');
    const page = await createDocPage(owner.id, { title: 'Plan secreto' });
    await createDocShare(owner.id, page.id, 'user', guest.id, 'edit');
    // El invitado escribe desde su propio team activo.
    session.user = {
      id: guestOwner.id,
      email: guest.email,
      role: 'member',
      team: { id: guestTeam.id },
      actingUser: { id: guest.id, email: guest.email, name: null },
    };
    return { owner, ownerMate, guestMate, page };
  }

  it('el invitado no notifica a sus compañeros y sí puede mencionar al equipo dueño', async () => {
    const { ownerMate, guestMate, page } = await setup();
    const mention = (userId: string) =>
      mentionsRoute.POST(jsonReq(`http://t/api/docs/pages/${page.id}/mentions`, 'POST', { user_id: userId }), ctx(page.id));
    expect((await mention(guestMate.id)).status).toBe(404);
    expect((await mention(ownerMate.id)).status).toBe(201);
  });

  it('el popover lista los del workspace de la página', async () => {
    const { owner, ownerMate, guestMate, page } = await setup();
    const res = await membersRoute.GET(new NextRequest(`http://t/api/docs/members?page=${page.id}`));
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
    expect(ids).toContain(owner.id);
    expect(ids).toContain(ownerMate.id);
    expect(ids).not.toContain(guestMate.id);
  });
});

describe('Centro de ayuda: home liviana y votos', () => {
  it('las colecciones traen excerpt; los artículos no se parsean', async () => {
    const u = await makeUser('r5help');
    const root = await createDocPage(u.id, { title: 'Inicio', content: para('Bienvenida al producto.') });
    const child = await createDocPage(u.id, { title: 'Facturas', parent_id: root.id, content: para('Llegan por mail.') });
    await updateDocPage(u.id, root.id, { published: true });
    await updateDocPage(u.id, child.id, { published: true });
    const cols = await listHelpCollections(u.id);
    expect(cols[0].excerpt).toBe('Bienvenida al producto.');
    expect(cols[0].articles[0].excerpt).toBe('');
  });

  it('un voto por visitante: votar de nuevo lo cambia en vez de sumar', async () => {
    const u = await makeUser('r5vote');
    const page = await createDocPage(u.id, { title: 'Votable' });
    await updateDocPage(u.id, page.id, { published: true });
    expect(await recordHelpFeedback(page.id, true, 'voter-aaaaaaaa')).toBe(true);
    expect(await recordHelpFeedback(page.id, true, 'voter-aaaaaaaa')).toBe(true);
    expect(await getHelpFeedbackStats(u.id, page.id)).toEqual({ yes: 1, no: 0 });
    await recordHelpFeedback(page.id, false, 'voter-aaaaaaaa');
    expect(await getHelpFeedbackStats(u.id, page.id)).toEqual({ yes: 0, no: 1 });
    await recordHelpFeedback(page.id, true, 'voter-bbbbbbbb');
    expect(await getHelpFeedbackStats(u.id, page.id)).toEqual({ yes: 1, no: 1 });
  });
});
