/**
 * Avisos de Track (issues, y los hilos de comentarios de projects e
 * iniciativas): la campana, su contador, la app de escritorio y los emails de
 * Track solo los muestran si la persona hoy tiene Track en ese workspace:
 * Track en Miembros y en Apps del workspace. Miradas: anónimo, miembro sin
 * Track en Miembros, miembro con Track solo para admins, admin, miembro con
 * Track y owner. Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/session';
import { createIssue, createProject } from '@/lib/track-data';
import { createNotification } from '@/lib/notifications';
import { addMember, setMemberApps } from '@/lib/teams';
import { saveWorkspaceAppRule } from '@/lib/workspace-apps';
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
const { sendImmediateTrackEmails, setNotifyPrefs } = await import('@/lib/track-notify');

beforeEach(() => {
  mail.sent = [];
});

const ISSUE = 'zz-track-app-issue';
const THREAD = 'zz-track-app-thread-text';

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const admin = await makeUser(`${label}-admin`);
  await addMember(w.team.id, admin.id, 'admin');
  const scope = { teamId: w.team.id, ownerId: w.owner.id };
  const project = await createProject(w.owner.id, w.team.id, { name: 'Team' });
  const issue = await createIssue(project.id, w.owner.id, { title: 'Issue', priority: 'low', description: [] });
  const { createPlan } = await import('@/lib/track-plans');
  const { planCreateSchema } = await import('@/lib/track-planning-schema');
  const created = await createPlan(scope, w.owner.id, planCreateSchema.parse({ name: 'Plan' }));
  if (!created.ok) throw new Error(created.error);
  const plan = created.plan;
  for (const u of [w.owner, w.member, admin]) {
    await createNotification({ userId: u.id, type: 'assigned', title: ISSUE, body: ISSUE, href: `/app/track/issues/${issue.id}`, sourceType: 'track_issue', sourceId: issue.id, meta: { issueIdentifier: ISSUE, actorName: 'A' } });
  }
  // Un comentario en el hilo del project que menciona a todos (lib/track-entity-comments.ts).
  const { createEntityComment } = await import('@/lib/track-entity-comments');
  await createEntityComment(
    { type: 'plan', id: plan.id, name: plan.name, team_id: plan.team_id, owner_id: plan.owner_id, lead_id: plan.lead_id },
    w.friend.id,
    { body: `${THREAD} @${w.owner.email} @${w.member.email} @${admin.email}` },
  );
  return { w, ws: w.owner.id, admin };
}

async function bell(user: SessionUser | null): Promise<{ status: number; text: string; unread: number }> {
  session.user = user;
  const res = await GET(new NextRequest('http://localhost/api/notifications?limit=20'));
  const text = await res.text();
  return { status: res.status, text, unread: res.status === 200 ? (JSON.parse(text) as { unreadCount: number }).unreadCount : 0 };
}

describe('avisos de Track: solo con Track hoy en ese workspace', () => {
  it('anónimo nada; miembro con Track los ve; sin Track en Miembros, ni campana, ni escritorio, ni email', async () => {
    const s = await setup('nta-member');
    expect((await bell(null)).status).toBe(401);
    const before = await bell(asMember(s.w.owner, s.w.member));
    expect(before.text).toContain(ISSUE);
    expect(before.text).toContain(THREAD);
    expect(before.unread).toBe(2);

    await setMemberApps(s.w.team.id, s.w.member.id, ['crm']);
    // La sesión del test no se vuelve a leer: el aviso mira el acceso de hoy en la base.
    const after = await bell(asMember(s.w.owner, s.w.member));
    expect(after.text).not.toContain(ISSUE);
    expect(after.text).not.toContain(THREAD);
    expect(after.unread).toBe(0);
    const badge = JSON.stringify(await desktopBadge(asMember(s.w.owner, s.w.member), null));
    expect(badge).not.toContain(ISSUE);
    expect(badge).not.toContain(THREAD);
    await setNotifyPrefs(s.w.member.id, { emailMode: 'immediate', locale: 'en' }, new Date(Date.now() - 10 * 60_000));
    await sendImmediateTrackEmails({ now: new Date(Date.now() + 2 * 60_000) });
    expect(mail.sent.filter((m) => m.to === s.w.member.email)).toHaveLength(0);
  });

  it('Track solo para admins (Apps del workspace): el miembro no; admin y owner sí, también por email', async () => {
    const s = await setup('nta-rule');
    await saveWorkspaceAppRule(s.ws, 'track', { mode: 'admins', people: [], teams: [], denied: [] }, s.ws);
    const member = await bell(asMember(s.w.owner, s.w.member));
    expect(member.text).not.toContain(THREAD);
    expect(member.text).not.toContain(ISSUE);
    expect(member.unread).toBe(0);
    const admin = await bell(asMember(s.w.owner, s.admin, 'admin'));
    expect(admin.text).toContain(THREAD);
    expect(admin.unread).toBe(2);
    const owner = await bell(asOwner(s.w.owner));
    expect(owner.text).toContain(ISSUE);
    for (const u of [s.w.member, s.admin]) await setNotifyPrefs(u.id, { emailMode: 'immediate', locale: 'en' }, new Date(Date.now() - 10 * 60_000));
    await sendImmediateTrackEmails({ now: new Date(Date.now() + 2 * 60_000) });
    expect(mail.sent.filter((m) => m.to === s.w.member.email)).toHaveLength(0);
    const toAdmin = mail.sent.filter((m) => m.to === s.admin.email);
    expect(toAdmin).toHaveLength(1);
    expect(toAdmin[0].text).toContain(ISSUE);
  });
});
