import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createIssue, createIssueComment, createProject, listAllIssues, listIssues, listStatuses, updateIssue } from '@/lib/track-data';
import { isSubscribedToIssue, listIssueSubscriberIds, setIssueSubscription } from '@/lib/track-subscriptions';
import { addMember, createTeam } from '@/lib/teams';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    void task().catch(() => {});
  },
}));
vi.mock('@/lib/events', () => ({ emitEvent: async () => {} }));

const subscriptionRoute = await import('@/lib/routes/track/issues/[id]/subscription/route');

const req = (method: string, body?: unknown) =>
  new NextRequest('http://x/s', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;

async function team() {
  const owner = await makeUser('own');
  const dev = await makeUser('dev');
  const other = await makeUser('oth');
  const outsider = await makeUser('out');
  const t = await createTeam(owner.id, 'Team');
  await addMember(t.id, dev.id);
  await addMember(t.id, other.id);
  const project = await createProject(owner.id, t.id, { name: `P ${crypto.randomUUID().slice(0, 6)}` });
  const as = (u: { id: string; email: string }) => ({ ...u, team: { id: t.id }, role: 'member' });
  return { owner, dev, other, outsider, team: t, project, as };
}

async function notificationsFor(userId: string, issueId: string) {
  return (await getDb()
    .prepare('SELECT type, meta FROM notifications WHERE user_id = ? AND source_id = ? ORDER BY created_at')
    .all(userId, issueId)) as Array<{ type: string; meta: string }>;
}

describe('Track: suscripción a issues', () => {
  it('creador, asignado y quien comenta se suscriben solos', async () => {
    const { owner, dev, other, project } = await team();
    const issue = await createIssue(project.id, owner.id, { title: 'Bug', assigneeId: dev.id });
    expect(await listIssueSubscriberIds(issue.id)).toEqual([owner.id, dev.id].sort());
    await createIssueComment(issue.id, other.id, { body: 'me sumo' });
    expect(await isSubscribedToIssue(issue.id, other.id)).toBe(true);
  });

  it('los comentarios avisan a todos los suscriptos menos al autor', async () => {
    const { owner, dev, other, project } = await team();
    const issue = await createIssue(project.id, owner.id, { title: 'Bug' });
    await createIssueComment(issue.id, other.id, { body: 'primero' });
    await createIssueComment(issue.id, dev.id, { body: 'segundo' });
    expect((await notificationsFor(owner.id, issue.id)).filter((n) => n.type === 'comment')).toHaveLength(2);
    // other comentó primero: recibe el aviso del segundo comentario.
    expect((await notificationsFor(other.id, issue.id)).map((n) => n.type)).toEqual(['comment']);
    expect(await notificationsFor(dev.id, issue.id)).toHaveLength(0);
  });

  it('la baja manual se respeta: ni comentar ni asignarse vuelve a suscribir', async () => {
    const { owner, dev, project } = await team();
    const issue = await createIssue(project.id, owner.id, { title: 'Bug' });
    await setIssueSubscription(issue.id, owner.id, false);
    await createIssueComment(issue.id, owner.id, { body: 'igual comento' });
    expect(await isSubscribedToIssue(issue.id, owner.id)).toBe(false);
    await createIssueComment(issue.id, dev.id, { body: 'hola' });
    expect((await notificationsFor(owner.id, issue.id)).filter((n) => n.type === 'comment')).toHaveLength(0);
  });

  it('cambios de status y del issue llegan a los suscriptos; el nuevo asignado recibe "asignado"', async () => {
    const { owner, dev, other, project } = await team();
    const statuses = await listStatuses(project.id);
    const issue = await createIssue(project.id, owner.id, { title: 'Bug' });
    await setIssueSubscription(issue.id, other.id, true);

    const done = statuses.find((s) => s.category === 'done')!;
    await updateIssue(issue.id, { statusId: done.id }, dev.id);
    expect((await notificationsFor(owner.id, issue.id)).map((n) => n.type)).toEqual(['status_change']);
    expect((await notificationsFor(other.id, issue.id)).map((n) => n.type)).toEqual(['status_change']);

    await updateIssue(issue.id, { priority: 'urgent', title: 'Bug grave', assigneeId: dev.id }, owner.id);
    const otherTypes = await notificationsFor(other.id, issue.id);
    expect(otherTypes.map((n) => n.type)).toEqual(['status_change', 'issue_update']);
    expect(JSON.parse(otherTypes[1].meta).changes.split(',').sort()).toEqual(['assignee', 'priority', 'title']);
    // El asignado no lo hizo él: recibe "te asignaron", no el aviso genérico.
    expect((await notificationsFor(dev.id, issue.id)).map((n) => n.type)).toEqual(['assigned']);
    expect(await isSubscribedToIssue(issue.id, dev.id)).toBe(true);
  });

  it('quien ya no es del equipo no recibe avisos', async () => {
    const { owner, outsider, project } = await team();
    const issue = await createIssue(project.id, owner.id, { title: 'Bug' });
    await setIssueSubscription(issue.id, outsider.id, true);
    expect(await listIssueSubscriberIds(issue.id)).toEqual([owner.id]);
  });

  it('la API suscribe y da de baja; otro workspace recibe 404', async () => {
    const { owner, dev, outsider, project, as } = await team();
    const issue = await createIssue(project.id, owner.id, { title: 'Bug' });
    const params = { params: Promise.resolve({ id: issue.id }) };

    session.user = as(dev);
    expect(await (await subscriptionRoute.GET(req('GET'), params)).json()).toEqual({ subscribed: false });
    const on = await subscriptionRoute.PUT(req('PUT', { subscribed: true }), params);
    expect(await on.json()).toEqual({ subscribed: true });
    const off = await subscriptionRoute.PUT(req('PUT', { subscribed: false }), params);
    expect(await off.json()).toEqual({ subscribed: false });
    expect((await subscriptionRoute.PUT(req('PUT', { subscribed: 'yes' }), params)).status).toBe(400);

    session.user = { ...outsider, team: null, role: 'owner' };
    expect((await subscriptionRoute.GET(req('GET'), params)).status).toBe(404);
  });
});

describe('Track: búsqueda en descripción y comentarios', () => {
  it('encuentra por texto de la descripción y de los comentarios, no por las claves del JSON', async () => {
    const { owner, project } = await team();
    const a = await createIssue(project.id, owner.id, {
      title: 'Uno',
      description: [{ type: 'text', text: 'El checkout falla en Safari' }],
    });
    const b = await createIssue(project.id, owner.id, { title: 'Dos' });
    await createIssueComment(b.id, owner.id, { body: 'Pasa con el cupón NAVIDAD' });
    await createIssue(project.id, owner.id, { title: 'Tres' });

    const ids = async (q: string) => (await listIssues(project.id, { q })).rows.map((r) => r.id);
    expect(await ids('safari')).toEqual([a.id]);
    expect(await ids('navidad')).toEqual([b.id]);
    // "text" y "type" son claves del JSON de la descripción: no deben matchear.
    expect(await ids('type')).toEqual([]);
    expect(await ids('Dos')).toEqual([b.id]);
  });

  it('% y _ se buscan literales', async () => {
    const { owner, project } = await team();
    const pct = await createIssue(project.id, owner.id, { title: 'Descuento 100% off' });
    const under = await createIssue(project.id, owner.id, { title: 'Renombrar user_id' });
    await createIssue(project.id, owner.id, { title: 'Algo sin comodines userXid' });

    const ids = async (q: string) => (await listIssues(project.id, { q })).rows.map((r) => r.id);
    expect(await ids('%')).toEqual([pct.id]);
    expect(await ids('user_id')).toEqual([under.id]);
    expect(await ids('\\')).toEqual([]);

    const all = await listAllIssues(project.team_id, owner.id, { q: '0% o' });
    expect(all.rows.map((r) => r.id)).toEqual([pct.id]);
  });

  it('una descripción vieja que no es JSON se busca igual', async () => {
    const { owner, project } = await team();
    const issue = await createIssue(project.id, owner.id, { title: 'Legacy' });
    await getDb().prepare('UPDATE track_issues SET description = ? WHERE id = ?').run('texto plano {roto', issue.id);
    expect((await listIssues(project.id, { q: 'plano' })).rows.map((r) => r.id)).toEqual([issue.id]);
  });
});

describe('Track: orden por vencimiento y actualización', () => {
  it('due pone primero las fechas cercanas y al final las sin fecha; updated el último tocado', async () => {
    const { owner, project } = await team();
    const late = await createIssue(project.id, owner.id, { title: 'late', dueDate: '2026-12-01' });
    const none = await createIssue(project.id, owner.id, { title: 'none' });
    const soon = await createIssue(project.id, owner.id, { title: 'soon', dueDate: '2026-11-01' });

    expect((await listIssues(project.id, { sort: 'due' })).rows.map((r) => r.id)).toEqual([soon.id, late.id, none.id]);

    await getDb().prepare('UPDATE track_issues SET updated_at = ? WHERE id = ?').run('2099-01-01T00:00:00.000Z', late.id);
    expect((await listIssues(project.id, { sort: 'updated' })).rows[0].id).toBe(late.id);
  });
});
