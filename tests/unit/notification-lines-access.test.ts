/**
 * Avisos de chats de Lines (asignaciones, menciones, tickets, tareas): la
 * campana, su contador, la app de escritorio y los emails de Track (al
 * momento y resumen) solo los muestran si la persona hoy ve ese chat: sigue
 * en el workspace, tiene Lines y ve esa línea. Miradas: anónimo, quien se
 * fue del workspace, miembro sin acceso a la línea, miembro con Lines
 * apagada, miembro con acceso y owner. Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/session';
import { createNotification } from '@/lib/notifications';
import { createNumber, upsertChat } from '@/lib/groups';
import { personCanSeeChat } from '@/lib/groups-access';
import { saveWorkspaceAppRule } from '@/lib/workspace-apps';
import { addMember, removeMember } from '@/lib/teams';
import { getDb } from '@/lib/db';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));
const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string; text: string; html: string }> }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: async (opts: { to: string; subject: string; text: string; html: string }) => {
    mail.sent.push(opts);
    return { ok: true };
  },
}));

const { GET } = await import('@/app/api/notifications/route');
const { desktopBadge } = await import('@/lib/desktop-badge');
const { sendImmediateTrackEmails, sendTrackDigests, setNotifyPrefs } = await import('@/lib/track-notify');

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  mail.sent = [];
});

const OPEN_CHAT = 'zz-open-line-chat';
const CLOSED_CHAT = 'zz-restricted-line-chat';

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const leaver = await makeUser(`${label}-leaver`);
  await addMember(w.team.id, leaver.id, 'member');
  const open = await createNumber(ws, ws, { provider: 'fake', name: 'Open', visibility: 'all' });
  const closed = await createNumber(ws, ws, { provider: 'fake', name: 'Closed', visibility: 'restricted' });
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const openChat = await upsertChat({ id: open.id, user_id: ws }, { providerChatId: `12036303${stamp}@g.us`, kind: 'group', name: 'Open' }, { silent: true });
  const closedChat = await upsertChat({ id: closed.id, user_id: ws }, { providerChatId: `12036304${stamp}@g.us`, kind: 'group', name: 'Closed' }, { silent: true });
  const ticketId = crypto.randomUUID();
  await getDb()
    .prepare("INSERT INTO groups_tickets (id, user_id, chat_id, number, title, status, priority, created_at, updated_at) VALUES (?, ?, ?, 1, 'T', 'open', 'normal', ?, ?)")
    .run(ticketId, ws, closedChat.id, new Date().toISOString(), new Date().toISOString())
    .catch(() => null);
  const notes = async (userId: string) => {
    await createNotification({ userId, type: 'assigned', title: OPEN_CHAT, href: `/app/lines/inbox/${openChat.id}`, sourceType: 'groups_chat', sourceId: openChat.id, meta: { chatName: OPEN_CHAT, actorName: 'A' } });
    await createNotification({ userId, type: 'mention', title: CLOSED_CHAT, href: `/app/lines/inbox/${closedChat.id}`, sourceType: 'groups_chat', sourceId: closedChat.id, meta: { chatName: CLOSED_CHAT, actorName: 'A' } });
    await createNotification({ userId, type: 'groups_reminder', title: `${CLOSED_CHAT}-task`, href: `/app/lines/inbox/${closedChat.id}`, sourceType: 'groups_task', sourceId: 'task-x' });
  };
  for (const u of [w.owner, w.member, leaver]) await notes(u.id);
  await removeMember(w.team.id, leaver.id);
  return { w, ws, leaver, openChat, closedChat };
}

async function bell(user: SessionUser | null): Promise<{ status: number; text: string; unread: number }> {
  session.user = user;
  const res = await GET(new NextRequest('http://localhost/api/notifications?limit=20'));
  const text = await res.text();
  return { status: res.status, text, unread: res.status === 200 ? (JSON.parse(text) as { unreadCount: number }).unreadCount : 0 };
}

describe('avisos de chats de Lines: solo los de chats que hoy se ven', () => {
  it('campana y contador: anónimo, quien se fue, miembro sin la línea, owner', async () => {
    const s = await setup('nla-bell');
    expect((await bell(null)).status).toBe(401);
    const gone = await bell(asOwner(s.leaver));
    expect(gone.text).not.toContain(OPEN_CHAT);
    expect(gone.text).not.toContain(CLOSED_CHAT);
    expect(gone.unread).toBe(0);
    const member = await bell(asMember(s.w.owner, s.w.member));
    expect(member.text).toContain(OPEN_CHAT);
    expect(member.text).not.toContain(CLOSED_CHAT);
    expect(member.unread).toBe(1);
    const owner = await bell(asOwner(s.w.owner));
    expect(owner.text).toContain(CLOSED_CHAT);
    expect(owner.unread).toBe(3);
    // Quien se fue tampoco "ve" el chat para avisos nuevos.
    expect(await personCanSeeChat(s.ws, s.leaver.id, s.openChat.id)).toBe(false);
    expect(await personCanSeeChat(s.ws, s.w.member.id, s.openChat.id)).toBe(true);
    expect(await personCanSeeChat(s.ws, s.w.member.id, s.closedChat.id)).toBe(false);
  });

  it('con Lines apagada para los miembros (Apps del workspace), ninguno', async () => {
    const s = await setup('nla-off');
    await saveWorkspaceAppRule(s.ws, 'groups', { mode: 'admins', people: [], teams: [], denied: [] }, s.ws);
    const member = await bell(asMember(s.w.owner, s.w.member));
    expect(member.text).not.toContain(OPEN_CHAT);
    expect(member.unread).toBe(0);
    expect(await personCanSeeChat(s.ws, s.w.member.id, s.openChat.id)).toBe(false);
  });

  it('app de escritorio y email inmediato: lo mismo', async () => {
    const s = await setup('nla-mail');
    const badge = await desktopBadge(asMember(s.w.owner, s.w.member), null);
    expect(JSON.stringify(badge)).not.toContain(CLOSED_CHAT);
    for (const u of [s.w.member, s.leaver]) await setNotifyPrefs(u.id, { emailMode: 'immediate', locale: 'en' }, new Date(Date.now() - 10 * 60_000));
    await sendImmediateTrackEmails({ now: new Date(Date.now() + 2 * 60_000) });
    const toMember = mail.sent.filter((m) => m.to === s.w.member.email);
    expect(toMember).toHaveLength(1);
    expect(toMember[0].text).toContain(OPEN_CHAT);
    expect(toMember[0].text + toMember[0].html + toMember[0].subject).not.toContain(CLOSED_CHAT);
    expect(mail.sent.filter((m) => m.to === s.leaver.email)).toHaveLength(0);
  });

  it('resumen diario: lo mismo', async () => {
    const s = await setup('nla-digest');
    for (const u of [s.w.member, s.leaver]) await setNotifyPrefs(u.id, { emailMode: 'digest', timezone: 'UTC', locale: 'en' }, new Date(Date.now() - 10 * 60_000));
    const at = new Date();
    at.setUTCHours(9, 0, 0, 0);
    if (at.getTime() < Date.now()) at.setUTCDate(at.getUTCDate() + 1);
    await sendTrackDigests({ now: at });
    const toMember = mail.sent.filter((m) => m.to === s.w.member.email);
    expect(toMember).toHaveLength(1);
    expect(toMember[0].text).toContain(OPEN_CHAT);
    expect(toMember[0].text + toMember[0].html).not.toContain(CLOSED_CHAT);
    expect(mail.sent.filter((m) => m.to === s.leaver.email)).toHaveLength(0);
  });
});
