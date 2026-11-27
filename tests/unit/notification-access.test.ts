/**
 * Los avisos guardados respetan el acceso de hoy en todos lados: la campana
 * (lista y contador), la app de escritorio y los emails de Track. Miradas:
 * anónimo, otro workspace, quien dejó el workspace, miembro sin acceso al team
 * privado, invitado, miembro y owner.
 */
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/session';
import { createIssue, createProject } from '@/lib/track-data';
import { setGuest, setProjectVisibility } from '@/lib/track-access';
import { createNotification, type NotificationType } from '@/lib/notifications';
import { addMember, removeMember } from '@/lib/teams';
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

const { GET, PATCH } = await import('@/app/api/notifications/route');
const { desktopBadge } = await import('@/lib/desktop-badge');
const { sendImmediateTrackEmails, sendTrackDigests, setNotifyPrefs } = await import('@/lib/track-notify');

/** Marcas que no deben salir en lo que ve quien no tiene acceso. */
const SECRET_ISSUE = 'zz-secret-issue-title';
const SECRET_PLAN = 'zz-secret-plan-name';
const SECRET_INITIATIVE = 'zz-secret-initiative-name';
const OPEN_ISSUE = 'zz-open-issue-title';

async function setup() {
  const w = await workspaceWithMember('notif-acc');
  const leaver = await makeUser('notif-acc-leaver');
  await addMember(w.team.id, leaver.id, 'member');
  const scope = { teamId: w.team.id, ownerId: w.owner.id };
  const open = await createProject(w.owner.id, w.team.id, { name: 'Open team' });
  const secret = await createProject(w.owner.id, w.team.id, { name: 'Private team' });
  const openIssue = await createIssue(open.id, w.owner.id, { title: 'Open', priority: 'low', description: [] });
  const secretIssue = await createIssue(secret.id, w.owner.id, { title: 'Secret', priority: 'low', description: [] });
  const { createPlan } = await import('@/lib/track-plans');
  const { planCreateSchema, initiativeCreateSchema } = await import('@/lib/track-planning-schema');
  const { createInitiative } = await import('@/lib/track-initiatives');
  const created = await createPlan(scope, w.owner.id, planCreateSchema.parse({ name: 'Plan' }));
  if (!created.ok) throw new Error(created.error);
  const plan = created.plan;
  const initiative = await createInitiative(scope, w.owner.id, initiativeCreateSchema.parse({ name: 'Initiative' }));

  const issueNote = (userId: string, issue: { id: string }, title: string, type: NotificationType = 'assigned') =>
    createNotification({ userId, type, title, body: title, href: `/app/track/issues/${issue.id}`, sourceType: 'track_issue', sourceId: issue.id, meta: { issueIdentifier: title, actorName: 'A' } });
  const everything = async (userId: string) => {
    await issueNote(userId, openIssue, OPEN_ISSUE);
    await issueNote(userId, secretIssue, SECRET_ISSUE, 'status_change');
    await createNotification({ userId, type: 'project_update', title: SECRET_PLAN, href: `/app/track/projects/${plan.id}?tab=updates`, sourceType: 'track_plan', sourceId: plan.id });
    await createNotification({ userId, type: 'project_update', title: SECRET_INITIATIVE, href: `/app/track/initiatives/${initiative.id}#updates`, sourceType: 'track_initiative', sourceId: initiative.id });
  };
  // Todos recibieron los avisos cuando todavía tenían acceso.
  for (const u of [w.owner, w.member, w.friend, leaver]) await everything(u.id);
  await issueNote(w.stranger.id, openIssue, OPEN_ISSUE);
  // Después: el team pasa a privado, alguien se va del workspace y `friend` queda como invitado del team abierto.
  await setProjectVisibility(secret.id, 'private', w.owner.id);
  await removeMember(w.team.id, leaver.id);
  await setGuest(w.team.id, w.friend.email, [open.id], w.owner.id);
  return { w, leaver };
}

async function bell(user: SessionUser | null) {
  session.user = user;
  const res = await GET(new NextRequest('http://localhost/api/notifications?limit=20'));
  return { status: res.status, text: res.status === 200 ? await res.text() : '' };
}

const shows = (text: string) => ({
  open: text.includes(OPEN_ISSUE),
  secretIssue: text.includes(SECRET_ISSUE),
  plan: text.includes(SECRET_PLAN),
  initiative: text.includes(SECRET_INITIATIVE),
  unread: (JSON.parse(text) as { unreadCount: number }).unreadCount,
  rows: (JSON.parse(text) as { rows: unknown[] }).rows.length,
});

describe('campana: los avisos respetan el acceso de hoy', () => {
  it('cada mirada ve solo lo que hoy puede ver, y el contador coincide', async () => {
    const { w, leaver } = await setup();

    expect((await bell(null)).status).toBe(401);

    // Otro workspace: el aviso es suyo pero el issue no.
    expect(shows((await bell(asOwner(w.stranger))).text)).toEqual({ open: false, secretIssue: false, plan: false, initiative: false, unread: 0, rows: 0 });
    // Dejó el workspace: nada de lo de antes.
    expect(shows((await bell(asOwner(leaver))).text)).toEqual({ open: false, secretIssue: false, plan: false, initiative: false, unread: 0, rows: 0 });
    // Miembro sin acceso al team privado: todo menos ese issue.
    expect(shows((await bell(asMember(w.owner, w.member))).text)).toEqual({ open: true, secretIssue: false, plan: true, initiative: true, unread: 3, rows: 3 });
    // Invitado: solo el issue de su team, sin projects ni iniciativas.
    expect(shows((await bell(asMember(w.owner, w.friend))).text)).toEqual({ open: true, secretIssue: false, plan: false, initiative: false, unread: 1, rows: 1 });
    // Owner: todo.
    expect(shows((await bell(asOwner(w.owner))).text)).toEqual({ open: true, secretIssue: true, plan: true, initiative: true, unread: 4, rows: 4 });
  });

  it('miembro: al darle acceso al team privado vuelve a ver el aviso', async () => {
    const { w } = await setup();
    const { addProjectAccess } = await import('@/lib/track-access');
    const { getDb } = await import('@/lib/db');
    const secretId = ((await getDb().prepare("SELECT id FROM track_projects WHERE team_id = ? AND name = 'Private team'").get(w.team.id)) as { id: string }).id;
    await addProjectAccess(secretId, w.member.id, w.owner.id);
    expect(shows((await bell(asMember(w.owner, w.member))).text)).toMatchObject({ secretIssue: true, unread: 4 });
  });

  it('una respuesta guardada (ETag) no sobrevive a perder el acceso', async () => {
    const w = await workspaceWithMember('notif-etag');
    const team = await createProject(w.owner.id, w.team.id, { name: 'Soon private' });
    const issue = await createIssue(team.id, w.owner.id, { title: 'x', priority: 'low', description: [] });
    await createNotification({ userId: w.member.id, type: 'assigned', title: SECRET_ISSUE, href: `/app/track/issues/${issue.id}`, sourceType: 'track_issue', sourceId: issue.id });
    session.user = asMember(w.owner, w.member);
    const first = await GET(new NextRequest('http://localhost/api/notifications?limit=5'));
    expect(await first.text()).toContain(SECRET_ISSUE);
    const etag = first.headers.get('etag')!;
    // Sin cambios: 304.
    expect((await GET(new NextRequest('http://localhost/api/notifications?limit=5', { headers: { 'if-none-match': etag } }))).status).toBe(304);
    await setProjectVisibility(team.id, 'private', w.owner.id);
    const after = await GET(new NextRequest('http://localhost/api/notifications?limit=5', { headers: { 'if-none-match': etag } }));
    expect(after.status).toBe(200);
    expect(await after.text()).not.toContain(SECRET_ISSUE);
  });

  it('comentarios (por el link) y avisos de algo borrado', async () => {
    const w = await workspaceWithMember('notif-misc');
    const team = await createProject(w.owner.id, w.team.id, { name: 'T' });
    const issue = await createIssue(team.id, w.owner.id, { title: 'x', priority: 'low', description: [] });
    await createNotification({ userId: w.member.id, type: 'comment', title: SECRET_ISSUE, href: `/app/track/issues/${issue.id}`, sourceType: 'track_comment', sourceId: 'comment-1' });
    await createNotification({ userId: w.member.id, type: 'assigned', title: OPEN_ISSUE, href: '/app/track/issues/gone', sourceType: 'track_issue', sourceId: 'gone' });
    await setProjectVisibility(team.id, 'private', w.owner.id);
    const seen = shows((await bell(asMember(w.owner, w.member))).text);
    // El del issue que ya no ve, no; el de algo que ya no existe queda como estaba.
    expect(seen).toMatchObject({ secretIssue: false, open: true, unread: 1, rows: 1 });
  });

  it('marcar todo leído devuelve el contador visible', async () => {
    const { w } = await setup();
    session.user = asMember(w.owner, w.member);
    const res = await PATCH(new NextRequest('http://localhost/api/notifications', { method: 'PATCH', body: JSON.stringify({ readAll: false }) }));
    expect(((await res.json()) as { unreadCount: number }).unreadCount).toBe(3);
  });

  it('la paginación se arma sobre lo visible', async () => {
    const { w } = await setup();
    session.user = asMember(w.owner, w.friend);
    const res = await GET(new NextRequest('http://localhost/api/notifications?limit=1&page=1'));
    const body = (await res.json()) as { rows: Array<{ title: string }> };
    expect(body.rows.map((r) => r.title)).toEqual([OPEN_ISSUE]);
    const res2 = await GET(new NextRequest('http://localhost/api/notifications?limit=1&page=2'));
    expect(((await res2.json()) as { rows: unknown[] }).rows).toHaveLength(0);
  });
});

describe('escritorio y emails: lo mismo', () => {
  it('la app de escritorio no muestra títulos ni cuenta avisos que la persona ya no ve', async () => {
    const { w, leaver } = await setup();
    const asLeaver = await desktopBadge(asOwner(leaver), new Date(Date.now() - 60_000).toISOString());
    expect(JSON.stringify(asLeaver.notifications)).toBe('[]');
    expect(asLeaver.bell).toBe(0);
    expect(asLeaver.byPath.track ?? 0).toBe(0);
    const asMemberBadge = await desktopBadge(asMember(w.owner, w.member), new Date(Date.now() - 60_000).toISOString());
    const text = JSON.stringify(asMemberBadge);
    expect(text).not.toContain(SECRET_ISSUE);
    expect(asMemberBadge.bell).toBe(3);
    expect(asMemberBadge.byPath.track).toBe(3);
  });

  it('el email inmediato deja afuera los avisos de issues que la persona ya no ve', async () => {
    const { w, leaver } = await setup();
    await setNotifyPrefs(w.member.id, { emailMode: 'immediate', locale: 'en' }, new Date(Date.now() - 10 * 60_000));
    await setNotifyPrefs(leaver.id, { emailMode: 'immediate', locale: 'en' }, new Date(Date.now() - 10 * 60_000));
    await sendImmediateTrackEmails({ now: new Date(Date.now() + 2 * 60_000) });
    const toMember = mail.sent.filter((m) => m.to === w.member.email);
    expect(toMember).toHaveLength(1);
    expect(toMember[0].text).toContain(OPEN_ISSUE);
    expect(toMember[0].text + toMember[0].html + toMember[0].subject).not.toContain(SECRET_ISSUE);
    // Los updates de projects e iniciativas que ve también van al email.
    expect(toMember[0].text).toContain(SECRET_PLAN);
    expect(toMember[0].text).toContain(SECRET_INITIATIVE);
    expect(mail.sent.filter((m) => m.to === leaver.email)).toHaveLength(0);
  });

  it('el resumen diario tampoco los incluye', async () => {
    const { w, leaver } = await setup();
    await setNotifyPrefs(w.friend.id, { emailMode: 'digest', timezone: 'UTC', locale: 'en' }, new Date(Date.now() - 10 * 60_000));
    await setNotifyPrefs(leaver.id, { emailMode: 'digest', timezone: 'UTC', locale: 'en' }, new Date(Date.now() - 10 * 60_000));
    const at = new Date();
    at.setUTCHours(9, 0, 0, 0);
    if (at.getTime() < Date.now()) at.setUTCDate(at.getUTCDate() + 1);
    await sendTrackDigests({ now: at });
    const toGuest = mail.sent.filter((m) => m.to === w.friend.email);
    expect(toGuest).toHaveLength(1);
    expect(toGuest[0].text).toContain(OPEN_ISSUE);
    expect(toGuest[0].text + toGuest[0].html).not.toContain(SECRET_ISSUE);
    // Un invitado no ve planificación: ni projects ni iniciativas en el resumen.
    expect(toGuest[0].text + toGuest[0].html).not.toContain(SECRET_PLAN);
    expect(toGuest[0].text + toGuest[0].html).not.toContain(SECRET_INITIATIVE);
    expect(mail.sent.filter((m) => m.to === leaver.email)).toHaveLength(0);
  });
});
