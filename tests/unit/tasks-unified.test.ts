import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import os from 'os';
import path from 'path';
import { getDb } from '@/lib/db';
import { createActivity, getActivity, updateActivity } from '@/lib/crm';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listMessages, updateChat } from '@/lib/groups';
import { createGroupTask, getGroupTask, listGroupTasks, updateGroupTask } from '@/lib/groups-tasks';
import { linkTask, primaryLink, promoteTaskToTrack, syncTasksFromIssue, taskLinks, tasksLinkedTo, TaskLinkError } from '@/lib/tasks';
import { MIGRATIONS } from '@/lib/schema/migrations';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});

async function chatWithContact(label: string) {
  const user = await makeUser(label);
  const n = await createNumber(user.id, user.id, { provider: 'fake' });
  await connectNumber(user.id, n.id);
  const row = (await getNumberRowById(n.id))!;
  const providerId = `1203630000${Math.floor(Math.random() * 1e8)}@g.us`;
  await ingestEvents(row, [
    { type: 'message', chatId: providerId, isGroup: true, fromMe: false, senderPhone: '5491155550000', senderName: 'Ana', providerMessageId: `M-${label}`, body: 'Mandame la propuesta' },
  ]);
  const chatId = ((await getDb().prepare('SELECT id FROM groups_chats WHERE user_id = ? AND provider_chat_id = ?').get(user.id, providerId)) as { id: string }).id;
  const contactId = crypto.randomUUID();
  const now = new Date().toISOString();
  await getDb()
    .prepare('INSERT INTO crm_contacts (id, user_id, first_name, last_name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(contactId, user.id, 'Ana', 'Pérez', `${label}@example.com`, now, now);
  await updateChat(user.id, chatId, { crmContactId: contactId });
  const msg = (await listMessages(user.id, chatId))[0];
  return { user, chatId, contactId, msg };
}

describe('tareas de la suite', () => {
  it('una tarea creada en un chat queda en el contacto del CRM con el vínculo de vuelta al chat y al mensaje', async () => {
    const { user, chatId, contactId, msg } = await chatWithContact('tu-lines');
    const task = await createGroupTask(user.id, user.id, { chatId, messageId: msg.id, title: 'Mandar propuesta', priority: 'high' });
    expect(task).toMatchObject({ source: 'lines', priority: 'high' });

    const crm = await getActivity(user.id, task.id);
    expect(crm).toMatchObject({ type: 'task', contact_id: contactId, priority: 'high' });

    const links = (await taskLinks(user.id, [task.id])).get(task.id)!;
    expect(links.map((l) => l.kind).sort()).toEqual(['lines_chat', 'lines_message']);
    const source = primaryLink(links)!;
    expect(source).toMatchObject({ kind: 'lines_message', href: `/app/groups/inbox/${chatId}`, detail: 'Mandame la propuesta', chatId });
    expect(await tasksLinkedTo(user.id, 'lines_chat', chatId)).toEqual([task.id]);
  });

  it('una tarea creada en el contacto del CRM aparece en el chat y se completa desde ahí', async () => {
    const { user, chatId, contactId } = await chatWithContact('tu-crm');
    const crmTask = await createActivity(user.id, { type: 'task', subject: 'Llamar a Ana', contactId });
    // Sin CRM (false), el chat no muestra tareas del contacto.
    expect((await listGroupTasks(user.id, user.id, { chatId, status: 'all', crm: false })).map((t) => t.id)).not.toContain(crmTask.id);
    const inChat = await listGroupTasks(user.id, user.id, { chatId, status: 'all', crm: null });
    expect(inChat.find((t) => t.id === crmTask.id)).toMatchObject({ source: 'crm', title: 'Llamar a Ana', chatId });
    // Visibilidad del CRM que no la incluye: tampoco en el chat.
    expect((await listGroupTasks(user.id, user.id, { chatId, status: 'all', crm: ['someone-else'] })).map((t) => t.id)).not.toContain(crmTask.id);

    expect(await getGroupTask(user.id, crmTask.id)).toBeNull();
    const done = await updateGroupTask(user.id, crmTask.id, { done: true }, null);
    expect(done.done).toBe(true);
    expect((await getActivity(user.id, crmTask.id))!.done).toBe(1);
  });

  it('linkTask valida el registro y el workspace, y es idempotente', async () => {
    const { user, chatId } = await chatWithContact('tu-link');
    const other = await makeUser('tu-link-other');
    const task = await createActivity(user.id, { type: 'task', subject: 'x' });
    await linkTask(user.id, task.id, 'lines_chat', chatId);
    await linkTask(user.id, task.id, 'lines_chat', chatId);
    expect((await taskLinks(user.id, [task.id])).get(task.id)).toHaveLength(1);
    await expect(linkTask(other.id, task.id, 'lines_chat', chatId)).rejects.toBeInstanceOf(TaskLinkError);
    await expect(linkTask(user.id, task.id, 'docs_page', 'nope')).rejects.toMatchObject({ code: 'invalid_link' });
    const note = await createActivity(user.id, { type: 'note', subject: 'n' });
    await expect(linkTask(user.id, note.id, 'lines_chat', chatId)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('la tarea repetida conserva sus vínculos y su prioridad', async () => {
    const { user, chatId } = await chatWithContact('tu-repeat');
    const task = await createActivity(user.id, { type: 'task', subject: 'Seguimiento', repeat: 'weekly', dueAt: '2030-01-01 12:00:00', priority: 'medium' });
    await linkTask(user.id, task.id, 'lines_chat', chatId);
    const after = await updateActivity(user.id, task.id, { done: true });
    const next = await getActivity(user.id, after!.repeat_next_id!);
    expect(next).toMatchObject({ priority: 'medium' });
    expect((await taskLinks(user.id, [next!.id])).get(next!.id)!.map((l) => l.kind)).toEqual(['lines_chat']);
  });

  it('pasar a Track crea un issue (uno solo aunque se pida dos veces) y cerrarlo completa la tarea', async () => {
    const user = await makeUser('tu-track');
    const { createProject, listStatuses, updateIssue, getIssue } = await import('@/lib/track-data');
    const project = await createProject(user.id, null, { name: 'Ventas' } as Parameters<typeof createProject>[2]);
    const task = await createActivity(user.id, { type: 'task', subject: 'Arreglar el alta', body: 'Lo pidió Ana', priority: 'high' });
    const session = { id: user.id, team: null };
    expect(await promoteTaskToTrack(user.id, session, task.id, 'missing')).toEqual({ error: 'project_not_found' });
    const [a, b] = await Promise.all([
      promoteTaskToTrack(user.id, session, task.id, project.id),
      promoteTaskToTrack(user.id, session, task.id, project.id),
    ]);
    expect('issueId' in a && 'issueId' in b).toBe(true);
    if (!('issueId' in a) || !('issueId' in b)) return;
    expect(a.issueId).toBe(b.issueId);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    const issue = (await getIssue(a.issueId))!;
    expect(issue).toMatchObject({ title: 'Arreglar el alta', priority: 'high' });
    expect((await taskLinks(user.id, [task.id])).get(task.id)!.find((l) => l.kind === 'track_issue')).toMatchObject({
      href: `/app/track/issues/${a.issueId}`,
      label: issue.identifier,
    });

    const statuses = await listStatuses(project.id);
    const done = statuses.find((s) => s.category === 'done')!;
    const todo = statuses.find((s) => s.category !== 'done' && s.category !== 'cancelled')!;
    await updateIssue(a.issueId, { statusId: done.id }, user.id);
    expect((await getActivity(user.id, task.id))!.done).toBe(1);
    await updateIssue(a.issueId, { statusId: todo.id }, user.id);
    expect((await getActivity(user.id, task.id))!.done).toBe(0);
    expect(await syncTasksFromIssue(a.issueId, false)).toBe(0);
  });
});

describe('284_tasks_unified', () => {
  function freshClient() {
    return createClient({ url: `file:${path.join(os.tmpdir(), `mig-tasks-${crypto.randomUUID()}.db`)}` });
  }

  it('pasa las tareas de Groups y de reuniones de Docs a task_links sin perder filas, y se puede correr dos veces', async () => {
    const c = freshClient();
    await c.executeMultiple(`
      CREATE TABLE crm_activities (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE groups_tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, chat_id TEXT NOT NULL, message_id TEXT, activity_id TEXT NOT NULL UNIQUE, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE docs_meetings (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, page_id TEXT NOT NULL, actions TEXT NOT NULL DEFAULT '[]', created_by TEXT);
      INSERT INTO crm_activities (id, user_id, type, subject) VALUES ('t1', 'ws', 'task', 'Desde el chat'), ('t2', 'ws', 'task', 'Desde el mensaje'), ('t3', 'ws', 'task', 'De la reunión');
      INSERT INTO groups_tasks (id, user_id, chat_id, message_id, activity_id) VALUES ('t1', 'ws', 'chat1', NULL, 't1'), ('t2', 'ws', 'chat1', 'msg9', 't2'), ('gone', 'ws', 'chat2', NULL, 'deleted');
      INSERT INTO docs_meetings (id, workspace_id, page_id, actions) VALUES
        ('m1', 'ws', 'page1', '[{"text":"a","sent":{"kind":"crm","id":"t3"}},{"text":"b","sent":{"kind":"track","id":"i1"}},{"text":"c"}]'),
        ('m2', 'ws', 'page2', 'not json');
    `);
    const m = MIGRATIONS.find((x) => x.id === '284_tasks_unified')!;
    await m.up(c);
    await m.up(c);
    const links = (await c.execute('SELECT task_id, kind, ref_id FROM task_links ORDER BY task_id, kind')).rows.map((r) => [r.task_id, r.kind, r.ref_id]);
    expect(links).toEqual([
      ['t1', 'lines_chat', 'chat1'],
      ['t2', 'lines_chat', 'chat1'],
      ['t2', 'lines_message', 'msg9'],
      ['t3', 'docs_page', 'page1'],
    ]);
    const cols = (await c.execute('PRAGMA table_info(crm_activities)')).rows.map((r) => r.name);
    expect(cols).toContain('priority');
    expect((await c.execute('SELECT COUNT(*) AS n FROM groups_tasks')).rows[0].n).toBe(3);
  });
});
