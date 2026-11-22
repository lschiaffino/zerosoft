/**
 * CRM, bloque A3: el listado de tareas (vistas, filtros, edición en masa),
 * las colas con nombre y los recordatorios, con las miradas de siempre: owner,
 * admin, miembro con "mine", miembro de un equipo de ventas y otro workspace.
 * Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createActivity, createContact } from '@/lib/crm';
import { createSalesTeam, ownerScopeFor, setMemberVisibility } from '@/lib/crm-visibility';
import { createQueue, listQueues, withQueueNames, type QueueViewer } from '@/lib/crm-task-queues';
import { dueOnDate, listTaskIndex, openCountsByQueue, type TaskIndexContext } from '@/lib/crm-tasks-index';
import { parseTaskIndexFilter, queueParamsFor, reminderFromDue, shiftReminder } from '@/lib/crm-tasks-shared';
import { fireTaskReminders } from '@/lib/crm-task-reminders';
import { localDayHour, runTaskDigests } from '@/lib/crm-task-digest';
import { listQueueTasks } from '@/lib/crm-work-queue';
import { listNotifications } from '@/lib/notifications';
import { pickViewState, isViewEntity } from '@/lib/crm-views-shared';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import type { TeamRole } from '@/lib/teams';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
const sentEmails = vi.hoisted(() => [] as Array<{ to: string; subject: string; text: string; html?: string }>);
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: async (opts: { to: string; subject: string; text: string; html?: string }) => {
    sentEmails.push(opts);
    return { ok: true, provider: 'test' };
  },
}));

const bulkRoute = await import('@/app/api/crm/tasks/bulk/route');
const queuesRoute = await import('@/app/api/crm/tasks/queues/route');
const queueRoute = await import('@/lib/routes/crm/tasks/queues/[id]/route');
const activitiesRoute = await import('@/app/api/crm/activities/route');
const activityRoute = await import('@/lib/routes/crm/activities/[id]/route');
const viewsRoute = await import('@/app/api/crm/views/route');
const digestRoute = await import('@/app/api/crm/tasks/digest/route');

beforeEach(() => {
  session.user = null;
});

const ctxId = (id: string) => ({ params: Promise.resolve({ id }) });
const send = (method: string, body?: unknown, url = 'http://x') =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T,>(res: Response) => (await res.json()) as T;

async function setup(label: string, visibility: 'mine' | 'team' = 'mine') {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  await setMemberVisibility(ws, visibility);
  // member y friend en el mismo equipo de ventas: con "team" se ven entre ellos.
  await createSalesTeam(ws, { name: 'Field', members: [w.member.id, w.friend.id] });
  const ownerContact = await createContact(ws, { firstName: 'Hidden', lastName: 'Person', ownerId: ws });
  const memberContact = await createContact(ws, { firstName: 'Zeta', lastName: 'Member', ownerId: w.member.id });
  const friendContact = await createContact(ws, { firstName: 'Zeta', lastName: 'Friend', ownerId: w.friend.id });
  const task = (subject: string, extra: Record<string, unknown>) =>
    createActivity(ws, { type: 'task', subject, dueAt: '2020-01-01 10:00', ...extra });
  const tOwner = await task('Call hidden person', { contactId: ownerContact.id, ownerId: ws, priority: 'high' });
  const tMember = await task('Call zeta member', { contactId: memberContact.id, ownerId: w.member.id, taskKind: 'call' });
  const tFriend = await task('Email zeta friend', { contactId: friendContact.id, ownerId: w.friend.id, taskKind: 'email' });
  return { w, ws, ownerContact, memberContact, friendContact, tOwner, tMember, tFriend };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const owner = (s: Setup) => asOwner(s.w.owner);
const admin = (s: Setup) => asMember(s.w.owner, s.w.friend, 'admin');
const member = (s: Setup) => asMember(s.w.owner, s.w.member);
const teamMember = (s: Setup) => asMember(s.w.owner, s.w.friend);
const stranger = (s: Setup) => asOwner(s.w.stranger);

const viewerOf = (u: SessionUser): QueueViewer => ({ workspaceId: u.id, personId: u.actingUser?.id ?? u.id, role: u.role as TeamRole });
async function ctxOf(u: SessionUser): Promise<TaskIndexContext> {
  const v = viewerOf(u);
  return { workspaceId: u.id, viewer: v, ownerScope: await ownerScopeFor({ workspaceId: v.workspaceId, personId: v.personId, role: v.role }), timeZone: 'UTC' };
}
async function subjects(u: SessionUser, state: Record<string, string> = {}) {
  const { rows } = await listTaskIndex(parseTaskIndexFilter(state), await ctxOf(u));
  return rows.map((r) => r.subject).sort();
}

describe('listado de tareas', () => {
  it('cada mirada ve solo las tareas de registros que ve', async () => {
    const s = await setup('a3-list');
    expect(await subjects(owner(s))).toEqual(['Call hidden person', 'Call zeta member', 'Email zeta friend']);
    expect(await subjects(admin(s))).toEqual(['Call hidden person', 'Call zeta member', 'Email zeta friend']);
    expect(await subjects(member(s))).toEqual(['Call zeta member']);
    expect(await subjects(teamMember(s))).toEqual(['Email zeta friend']);
    // Otro workspace: nada de este.
    expect(await subjects(stranger(s))).toEqual([]);
  });

  it('con visibilidad de equipo, el equipo de ventas se ve entre sí pero no lo del owner', async () => {
    const s = await setup('a3-team', 'team');
    expect(await subjects(member(s))).toEqual(['Call zeta member', 'Email zeta friend']);
    expect(await subjects(teamMember(s))).toEqual(['Call zeta member', 'Email zeta friend']);
  });

  it('la búsqueda no encuentra por un registro que no se ve, y los filtros combinan', async () => {
    const s = await setup('a3-search');
    expect(await subjects(member(s), { q: 'Hidden' })).toEqual([]);
    expect(await subjects(owner(s), { q: 'Hidden' })).toEqual(['Call hidden person']);
    expect(await subjects(owner(s), { type: 'call' })).toEqual(['Call zeta member']);
    expect(await subjects(owner(s), { type: 'todo' })).toEqual(['Call hidden person']);
    expect(await subjects(owner(s), { priority: 'high' })).toEqual(['Call hidden person']);
    expect(await subjects(owner(s), { priority: 'none', type: 'email' })).toEqual(['Email zeta friend']);
    expect(await subjects(member(s), { owner: 'me' })).toEqual(['Call zeta member']);
    expect(await subjects(owner(s), { bucket: 'overdue' })).toHaveLength(3);
    expect(await subjects(owner(s), { bucket: 'done' })).toEqual([]);
    const { total } = await listTaskIndex(parseTaskIndexFilter({}), await ctxOf(owner(s)), 1, 2);
    expect(total).toBe(3);
  });
});

describe('colas de tareas', () => {
  it('la privada solo la ve quien la creó; la compartida, todo el workspace', async () => {
    const s = await setup('a3-queues');
    const priv = await createQueue(viewerOf(owner(s)), { name: 'Owner private' });
    const shared = await createQueue(viewerOf(owner(s)), { name: 'Team calls', shared: true });
    if (!priv.ok || !shared.ok) throw new Error('queue');
    expect((await listQueues(viewerOf(owner(s)))).map((q) => q.name)).toEqual(['Owner private', 'Team calls']);
    // Un admin tampoco ve la privada de otra persona.
    expect((await listQueues(viewerOf(admin(s)))).map((q) => q.name)).toEqual(['Team calls']);
    expect((await listQueues(viewerOf(member(s)))).map((q) => q.name)).toEqual(['Team calls']);
    expect(await listQueues(viewerOf(stranger(s)))).toEqual([]);

    // Una tarea en la cola privada del owner: el miembro la ve sin cola (ni id ni nombre).
    await getDb().prepare('UPDATE crm_activities SET queue_id = ? WHERE id = ?').run(priv.queue.id, s.tMember.id);
    const [asMemberRow] = await withQueueNames(viewerOf(member(s)), [{ id: s.tMember.id, queue_id: priv.queue.id }]);
    expect(asMemberRow).toEqual({ id: s.tMember.id, queue_id: null, queue_name: null });
    const [asOwnerRow] = await withQueueNames(viewerOf(owner(s)), [{ id: s.tMember.id, queue_id: priv.queue.id }]);
    expect(asOwnerRow.queue_name).toBe('Owner private');
    // Filtrar por una cola que no ve no trae nada; las cuentas no la incluyen.
    expect(await subjects(member(s), { queue: priv.queue.id })).toEqual([]);
    expect(await subjects(owner(s), { queue: priv.queue.id })).toEqual(['Call zeta member']);
    expect((await openCountsByQueue(await ctxOf(member(s)))).has(priv.queue.id)).toBe(false);
    // La API de actividades tampoco devuelve el id de la cola privada.
    session.user = member(s);
    const rows = (await json<{ rows: Array<{ id: string; queue_id: string | null }> }>(
      await activitiesRoute.GET(new NextRequest('http://x/api/crm/activities?bucket=overdue')),
    )).rows;
    expect(rows.find((r) => r.id === s.tMember.id)?.queue_id).toBeNull();
  });

  it('rutas: crear, renombrar, compartir y borrar con los permisos de cada mirada', async () => {
    const s = await setup('a3-queue-routes');
    session.user = owner(s);
    const priv = await json<{ id: string }>(await queuesRoute.POST(send('POST', { name: 'Mine' })));
    const shared = await json<{ id: string }>(await queuesRoute.POST(send('POST', { name: 'Everyone', shared: true })));
    expect((await queuesRoute.POST(send('POST', { name: '' }))).status).toBe(400);

    // Miembro: la privada no existe; la compartida la ve pero no la edita.
    session.user = member(s);
    expect((await queueRoute.GET(send('GET'), ctxId(priv.id))).status).toBe(404);
    expect((await queueRoute.PATCH(send('PATCH', { name: 'x' }), ctxId(priv.id))).status).toBe(404);
    expect((await queueRoute.DELETE(send('DELETE'), ctxId(priv.id))).status).toBe(404);
    expect((await queueRoute.GET(send('GET'), ctxId(shared.id))).status).toBe(200);
    expect((await queueRoute.PATCH(send('PATCH', { name: 'x' }), ctxId(shared.id))).status).toBe(403);
    const list = await json<{ rows: Array<{ id: string }> }>(await queuesRoute.GET());
    expect(list.rows.map((r) => r.id)).toEqual([shared.id]);

    // Equipo de ventas: igual que el miembro.
    session.user = teamMember(s);
    expect((await queueRoute.GET(send('GET'), ctxId(priv.id))).status).toBe(404);
    expect((await queueRoute.DELETE(send('DELETE'), ctxId(shared.id))).status).toBe(403);

    // Admin: edita la compartida; la privada del owner sigue sin existir para él.
    session.user = admin(s);
    expect((await queueRoute.PATCH(send('PATCH', { name: 'Everyone v2' }), ctxId(shared.id))).status).toBe(200);
    expect((await queueRoute.PATCH(send('PATCH', { name: 'x' }), ctxId(priv.id))).status).toBe(404);

    // Otro workspace: ninguna existe.
    session.user = stranger(s);
    expect((await queueRoute.GET(send('GET'), ctxId(shared.id))).status).toBe(404);
    expect((await queueRoute.DELETE(send('DELETE'), ctxId(shared.id))).status).toBe(404);
    expect((await json<{ rows: unknown[] }>(await queuesRoute.GET())).rows).toEqual([]);

    // Sin sesión.
    session.user = null;
    expect((await queuesRoute.GET()).status).toBe(401);

    // Borrar deja las tareas sin cola.
    session.user = owner(s);
    await getDb().prepare('UPDATE crm_activities SET queue_id = ? WHERE id = ?').run(shared.id, s.tOwner.id);
    expect((await queueRoute.DELETE(send('DELETE'), ctxId(shared.id))).status).toBe(204);
    const row = (await getDb().prepare('SELECT queue_id FROM crm_activities WHERE id = ?').get(s.tOwner.id)) as { queue_id: string | null };
    expect(row.queue_id).toBeNull();
  });

  it('poner una tarea en una cola: solo en una que la persona ve', async () => {
    const s = await setup('a3-queue-assign');
    const priv = await createQueue(viewerOf(owner(s)), { name: 'Owner private' });
    const mine = await createQueue(viewerOf(member(s)), { name: 'Member queue' });
    if (!priv.ok || !mine.ok) throw new Error('queue');
    session.user = member(s);
    expect((await activityRoute.PATCH(send('PATCH', { queueId: priv.queue.id }), ctxId(s.tMember.id))).status).toBe(400);
    expect((await activityRoute.PATCH(send('PATCH', { queueId: mine.queue.id }), ctxId(s.tMember.id))).status).toBe(200);
    // Una tarea que no ve, ni aunque la cola sea suya.
    expect((await activityRoute.PATCH(send('PATCH', { queueId: mine.queue.id }), ctxId(s.tOwner.id))).status).toBe(404);
    const created = await activitiesRoute.POST(send('POST', { type: 'task', subject: 'New one', queueId: priv.queue.id }));
    expect(created.status).toBe(400);
    // Una cola de otro workspace no existe.
    session.user = stranger(s);
    expect((await activitiesRoute.POST(send('POST', { type: 'task', subject: 'x', queueId: mine.queue.id }))).status).toBe(400);

    // La cola de trabajo con nombre trae sus tareas abiertas que la persona ve.
    session.user = member(s);
    const ctx = await ctxOf(member(s));
    const { taskFilterWhere } = await import('@/lib/crm-tasks-index');
    const filter = await taskFilterWhere({ bucket: 'all', queueId: mine.queue.id }, ctx);
    const tasks = await listQueueTasks(s.ws, { filter, ownerScope: ctx.ownerScope });
    expect(tasks.map((x) => x.id)).toEqual([s.tMember.id]);
  });
});

describe('edición en masa', () => {
  it('cada tarea pasa por la misma regla: las que no se ven cuentan como no hechas', async () => {
    const s = await setup('a3-bulk');
    const ids = [s.tOwner.id, s.tMember.id, s.tFriend.id];
    session.user = member(s);
    const res = await json<{ count: number; failed: number }>(await bulkRoute.POST(send('POST', { action: 'complete', ids })));
    expect(res).toEqual({ count: 1, failed: 2 });
    const done = (await getDb().prepare('SELECT id, done FROM crm_activities WHERE id IN (?, ?, ?)').all(...ids)) as Array<{ id: string; done: number }>;
    expect(done.find((r) => r.id === s.tOwner.id)?.done).toBe(0);
    expect(done.find((r) => r.id === s.tMember.id)?.done).toBe(1);

    // Equipo de ventas con "mine": solo la suya.
    session.user = teamMember(s);
    expect(await json(await bulkRoute.POST(send('POST', { action: 'set_property', ids, field: 'priority', value: 'low' })))).toEqual({ count: 1, failed: 2 });

    // Otro workspace: ninguna.
    session.user = stranger(s);
    expect(await json(await bulkRoute.POST(send('POST', { action: 'delete', ids })))).toEqual({ count: 0, failed: 3 });
    expect((await getDb().prepare('SELECT COUNT(*) AS c FROM crm_activities WHERE id IN (?, ?, ?)').get(...ids)) as { c: number }).toEqual({ c: 3 });

    // Admin y owner: todas.
    session.user = admin(s);
    expect(await json(await bulkRoute.POST(send('POST', { action: 'set_property', ids, field: 'taskKind', value: 'todo' })))).toEqual({ count: 3, failed: 0 });
    session.user = owner(s);
    expect(await json(await bulkRoute.POST(send('POST', { action: 'reopen', ids })))).toEqual({ count: 3, failed: 0 });
    // Owner que no es del workspace: error de referencia, nada cambia.
    expect((await bulkRoute.POST(send('POST', { action: 'set_property', ids, field: 'ownerId', value: s.w.stranger.id }))).status).toBe(400);
    // Sin sesión.
    session.user = null;
    expect((await bulkRoute.POST(send('POST', { action: 'complete', ids }))).status).toBe(401);
  });

  it('cola en masa: solo una visible; la fecha conserva la hora local', async () => {
    const s = await setup('a3-bulk-queue');
    const priv = await createQueue(viewerOf(owner(s)), { name: 'Owner private' });
    if (!priv.ok) throw new Error('queue');
    session.user = member(s);
    expect((await bulkRoute.POST(send('POST', { action: 'set_property', ids: [s.tMember.id], field: 'queueId', value: priv.queue.id }))).status).toBe(400);
    session.user = owner(s);
    expect(await json(await bulkRoute.POST(send('POST', { action: 'set_property', ids: [s.tMember.id], field: 'queueId', value: priv.queue.id })))).toEqual({ count: 1, failed: 0 });
    expect(await json(await bulkRoute.POST(send('POST', { action: 'set_property', ids: [s.tMember.id], field: 'dueDate', value: '2031-03-04' })))).toEqual({ count: 1, failed: 0 });
    const row = (await getDb().prepare('SELECT due_at, queue_id FROM crm_activities WHERE id = ?').get(s.tMember.id)) as { due_at: string; queue_id: string };
    expect(row).toEqual({ due_at: '2031-03-04 10:00', queue_id: priv.queue.id });
    expect((await bulkRoute.POST(send('POST', { action: 'set_property', ids: [s.tMember.id], field: 'dueDate', value: 'tomorrow' }))).status).toBe(400);
  });

  it('dueOnDate: hora local de antes, 9:00 si no había', () => {
    // Buenos Aires es UTC-3: 13:00 UTC son las 10:00 locales.
    expect(dueOnDate('2026-01-10 13:00', '2026-02-01', 'America/Argentina/Buenos_Aires')).toBe('2026-02-01 13:00');
    expect(dueOnDate(null, '2026-02-01', 'America/Argentina/Buenos_Aires')).toBe('2026-02-01 12:00');
    expect(dueOnDate('2026-01-10', '2026-02-01', 'UTC')).toBe('2026-02-01 09:00');
  });
});

describe('recordatorios', () => {
  it('le llega a quien tiene la tarea y la ve, una sola vez', async () => {
    const s = await setup('a3-remind');
    const at = '2020-01-01 09:00';
    const visible = await createActivity(s.ws, { type: 'task', subject: 'Remind member', contactId: s.memberContact.id, ownerId: s.w.member.id, reminderAt: at });
    // Asignada al miembro pero de un contacto que no ve: no le llega nada (ni el título).
    const hidden = await createActivity(s.ws, { type: 'task', subject: 'Remind hidden zz', contactId: s.ownerContact.id, ownerId: s.w.member.id, reminderAt: at });
    // Sin owner: al dueño del workspace.
    const unowned = await createActivity(s.ws, { type: 'task', subject: 'Remind owner', reminderAt: at });
    // Completada: no se avisa.
    const done = await createActivity(s.ws, { type: 'task', subject: 'Done one', ownerId: s.w.friend.id, contactId: s.friendContact.id, reminderAt: at });
    await getDb().prepare('UPDATE crm_activities SET done = 1 WHERE id = ?').run(done.id);

    await fireTaskReminders({ now: new Date('2020-01-01T09:01:00Z') });
    await fireTaskReminders({ now: new Date('2020-01-01T09:02:00Z') });

    const memberNotes = (await listNotifications(s.w.member.id)).filter((n) => (n.type as string) === 'crm_task_reminder');
    expect(memberNotes.map((n) => n.source_id)).toEqual([visible.id]);
    expect(JSON.stringify(memberNotes)).not.toMatch(/zz/);
    const ownerNotes = (await listNotifications(s.ws)).filter((n) => (n.type as string) === 'crm_task_reminder');
    expect(ownerNotes.map((n) => n.source_id)).toEqual([unowned.id]);
    expect((await listNotifications(s.w.friend.id)).filter((n) => (n.type as string) === 'crm_task_reminder')).toEqual([]);
    expect((await listNotifications(s.w.stranger.id)).filter((n) => (n.type as string) === 'crm_task_reminder')).toEqual([]);
    // El recordatorio de la tarea que no ve quedó reclamado: no vuelve a intentar.
    const claimed = (await getDb().prepare('SELECT reminder_sent_at FROM crm_activities WHERE id = ?').get(hidden.id)) as { reminder_sent_at: string | null };
    expect(claimed.reminder_sent_at).not.toBeNull();

    // Cambiar la hora lo vuelve a dejar pendiente.
    session.user = member(s);
    expect((await activityRoute.PATCH(send('PATCH', { reminderAt: '2020-01-02 09:00' }), ctxId(visible.id))).status).toBe(200);
    const again = (await getDb().prepare('SELECT reminder_sent_at FROM crm_activities WHERE id = ?').get(visible.id)) as { reminder_sent_at: string | null };
    expect(again.reminder_sent_at).toBeNull();
  });

  it('quien ya no está en el workspace no recibe el recordatorio', async () => {
    const s = await setup('a3-remind-gone');
    const task = await createActivity(s.ws, { type: 'task', subject: 'Remind gone', ownerId: s.w.member.id, contactId: s.memberContact.id, reminderAt: '2020-01-01 09:00' });
    await getDb().prepare('DELETE FROM team_members WHERE user_id = ?').run(s.w.member.id);
    await fireTaskReminders({ now: new Date('2020-01-01T09:01:00Z') });
    expect((await listNotifications(s.w.member.id)).filter((n) => n.source_id === task.id)).toEqual([]);
  });

  it('reminderFromDue calcula el instante antes del vencimiento', () => {
    expect(reminderFromDue('2026-03-10 15:30', '1h')).toBe('2026-03-10 14:30');
    expect(reminderFromDue('2026-03-10 15:30', 'at_due')).toBe('2026-03-10 15:30');
    expect(reminderFromDue('2026-03-10', '1d')).toBe('2026-03-09 00:00');
    expect(reminderFromDue(null, '1h')).toBeNull();
    expect(reminderFromDue('2026-03-10 15:30', 'none')).toBeNull();
  });
});

describe('vistas guardadas de tareas', () => {
  it('tasks es un objeto con vistas y guarda solo su estado', () => {
    expect(isViewEntity('tasks')).toBe(true);
    expect(pickViewState('tasks', { bucket: 'today', type: 'call', stageId: 'x', queue: 'q1' })).toEqual({ bucket: 'today', type: 'call', queue: 'q1' });
    expect(queueParamsFor(parseTaskIndexFilter({ bucket: 'overdue', type: 'call', owner: 'me' }))).toEqual({ scope: 'overdue', owner: 'me', type: 'call' });
    expect(parseTaskIndexFilter({ bucket: 'nope', priority: 'urgent', owner: "x' OR 1" })).toMatchObject({ bucket: 'all', priority: undefined, owner: undefined, sort: 'due' });
  });

  it('una vista privada de tareas no la ve nadie más', async () => {
    const s = await setup('a3-views');
    session.user = member(s);
    const res = await viewsRoute.POST(send('POST', { entity: 'tasks', name: 'My calls', visibility: 'private', query: { type: 'call' } }));
    expect(res.status).toBe(201);
    session.user = owner(s);
    const rows = (await json<{ rows: Array<{ name: string }> }>(await viewsRoute.GET(new NextRequest('http://x/api/crm/views?entity=tasks')))).rows;
    expect(rows.map((r) => r.name)).not.toContain('My calls');
    session.user = stranger(s);
    expect((await json<{ rows: unknown[] }>(await viewsRoute.GET(new NextRequest('http://x/api/crm/views?entity=tasks')))).rows).toEqual([]);
  });
});

describe('email diario de tareas', () => {
  it('cada persona lo activa para sí y trae solo sus tareas que ve, una vez por día', async () => {
    const s = await setup('a3-digest');
    // Asignada al miembro pero de un contacto que no ve: no entra.
    await createActivity(s.ws, { type: 'task', subject: 'Hidden digest zz', contactId: s.ownerContact.id, ownerId: s.w.member.id, dueAt: '2020-01-01 10:00' });
    session.user = member(s);
    expect(await json(await digestRoute.GET())).toEqual({ enabled: false });
    expect(await json(await digestRoute.PUT(send('PUT', { enabled: true })))).toEqual({ enabled: true });
    expect((await digestRoute.PUT(send('PUT', { enabled: 'yes' }))).status).toBe(400);
    // Lo de una persona no lo activa para otra ni en otro workspace.
    session.user = teamMember(s);
    expect(await json(await digestRoute.GET())).toEqual({ enabled: false });
    session.user = stranger(s);
    expect(await json(await digestRoute.GET())).toEqual({ enabled: false });
    session.user = null;
    expect((await digestRoute.GET()).status).toBe(401);

    const memberEmail = s.w.member.email;
    sentEmails.length = 0;
    // Antes de las 8 (UTC, sin zona guardada): nada.
    await runTaskDigests({ now: new Date('2026-05-04T07:30:00Z') });
    expect(sentEmails.filter((e) => e.to === memberEmail)).toEqual([]);
    await runTaskDigests({ now: new Date('2026-05-04T08:10:00Z') });
    await runTaskDigests({ now: new Date('2026-05-04T09:10:00Z') });
    const mine = sentEmails.filter((e) => e.to === memberEmail);
    expect(mine).toHaveLength(1);
    expect(mine[0].text).toContain('Call zeta member');
    expect(mine[0].text).not.toMatch(/zz|Hidden person|Email zeta friend|Call hidden person/);
    // Nadie más lo pidió.
    expect(sentEmails.filter((e) => e.to !== memberEmail)).toEqual([]);
    // Al día siguiente vuelve a salir; apagado, no.
    await runTaskDigests({ now: new Date('2026-05-05T08:10:00Z') });
    expect(sentEmails.filter((e) => e.to === memberEmail)).toHaveLength(2);
    session.user = member(s);
    await digestRoute.PUT(send('PUT', { enabled: false }));
    await runTaskDigests({ now: new Date('2026-05-06T08:10:00Z') });
    expect(sentEmails.filter((e) => e.to === memberEmail)).toHaveLength(2);
  });

  it('localDayHour usa la zona de la persona', () => {
    expect(localDayHour('America/Argentina/Buenos_Aires', new Date('2026-05-04T02:00:00Z'))).toEqual({ day: '2026-05-03', hour: 23 });
    expect(localDayHour('UTC', new Date('2026-05-04T02:00:00Z'))).toEqual({ day: '2026-05-04', hour: 2 });
  });
});

describe('ajustes de la revisión', () => {
  it('nadie saca una tarea de la cola privada de otra persona', async () => {
    const s = await setup('a3-steal');
    const priv = await createQueue(viewerOf(owner(s)), { name: 'Owner private' });
    const mine = await createQueue(viewerOf(member(s)), { name: 'Member queue' });
    if (!priv.ok || !mine.ok) throw new Error('queue');
    await getDb().prepare('UPDATE crm_activities SET queue_id = ? WHERE id = ?').run(priv.queue.id, s.tMember.id);
    session.user = member(s);
    expect((await activityRoute.PATCH(send('PATCH', { queueId: null }), ctxId(s.tMember.id))).status).toBe(400);
    expect((await activityRoute.PATCH(send('PATCH', { queueId: mine.queue.id }), ctxId(s.tMember.id))).status).toBe(400);
    expect(await json(await bulkRoute.POST(send('POST', { action: 'set_property', ids: [s.tMember.id], field: 'queueId', value: null })))).toEqual({ count: 0, failed: 1 });
    // Otros cambios sí, y la cola queda.
    expect((await activityRoute.PATCH(send('PATCH', { priority: 'low' }), ctxId(s.tMember.id))).status).toBe(200);
    const row = (await getDb().prepare('SELECT queue_id FROM crm_activities WHERE id = ?').get(s.tMember.id)) as { queue_id: string };
    expect(row.queue_id).toBe(priv.queue.id);
    // Quien la creó, sí.
    session.user = owner(s);
    expect((await activityRoute.PATCH(send('PATCH', { queueId: null }), ctxId(s.tMember.id))).status).toBe(200);
  });

  it('el recordatorio se corre con el vencimiento y vuelve a quedar pendiente', async () => {
    const s = await setup('a3-shift');
    const t = await createActivity(s.ws, { type: 'task', subject: 'Shift me', ownerId: s.w.member.id, contactId: s.memberContact.id, dueAt: '2030-01-10 15:00', reminderAt: '2030-01-10 14:00' });
    await getDb().prepare("UPDATE crm_activities SET reminder_sent_at = '2030-01-10 14:00' WHERE id = ?").run(t.id);
    session.user = member(s);
    expect((await activityRoute.PATCH(send('PATCH', { dueAt: '2030-01-17 15:00' }), ctxId(t.id))).status).toBe(200);
    const row = (await getDb().prepare('SELECT reminder_at, reminder_sent_at FROM crm_activities WHERE id = ?').get(t.id)) as { reminder_at: string; reminder_sent_at: string | null };
    expect(row).toEqual({ reminder_at: '2030-01-17 14:00', reminder_sent_at: null });
    expect(shiftReminder('2030-01-10 14:00', '2030-01-10 15:00', null)).toBeNull();
  });

  it('owner = yo, para el dueño del workspace, incluye las tareas sin owner', async () => {
    const s = await setup('a3-me');
    await createActivity(s.ws, { type: 'task', subject: 'Unowned one', dueAt: '2020-01-01 10:00' });
    expect(await subjects(owner(s), { owner: 'me' })).toEqual(['Call hidden person', 'Unowned one']);
  });
});
