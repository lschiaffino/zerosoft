/**
 * Tareas de toda la suite. Hay un solo modelo: la tarea del CRM
 * (crm_activities con type 'task'), que ya tiene título, notas, responsable,
 * vencimiento, hecho, repetición, proyecto, adjuntos (crm_task_files) y los
 * registros del CRM (contacto, empresa, deal). Este módulo suma:
 *
 * - prioridad (como HubSpot: sin prioridad, baja, media, alta);
 * - task_links: vínculos con registros de otras apps (chat y mensaje de
 *   Groups, conversación de Chat, página de Docs, issue de Track), con el
 *   nombre y el link de vuelta resueltos al leer;
 * - pasar una tarea a Track (un issue vinculado; cuando el issue se cierra,
 *   la tarea se completa y si se reabre, se reabre).
 *
 * Track sigue siendo la herramienta del trabajo de producto con equipo,
 * estados y ciclos; una tarea es un pendiente personal sobre un cliente o
 * un registro. Server-only.
 */
import { getDb } from './db';
import { trackVisibleSql } from './track-access';
import { LINK_APP, isTaskLinkKind, visibleLinks, type TaskLink, type TaskLinkKind } from './tasks-shared';

export {
  API_LINK_KINDS,
  LINK_APP,
  TASK_LINK_KINDS,
  TASK_PRIORITIES,
  cleanPriority,
  isTaskLinkKind,
  primaryLink,
  visibleLinks,
  type TaskLink,
  type TaskLinkKind,
  type TaskPriority,
} from './tasks-shared';

function hrefFor(kind: TaskLinkKind, refId: string, chatId?: string | null): string {
  switch (kind) {
    case 'lines_chat':
      return `/app/lines/inbox/${encodeURIComponent(refId)}`;
    case 'lines_message':
      return chatId ? `/app/lines/inbox/${encodeURIComponent(chatId)}` : '';
    case 'chat_conversation':
      return `/app/chat/inbox/${encodeURIComponent(refId)}`;
    case 'docs_page':
      return `/app/docs/${encodeURIComponent(refId)}`;
    case 'track_issue':
      return `/app/track/issues/${encodeURIComponent(refId)}`;
  }
}

function inList(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

/** Track: el issue es de un equipo de este workspace que la persona ve. */
function trackIssueSql(person: string): { sql: string; args: string[] } {
  const v = trackVisibleSql('p', person);
  return {
    sql: `SELECT i.id, i.identifier, i.title FROM track_issues i JOIN track_projects p ON p.id = i.project_id
      WHERE (p.owner_id = ? OR p.team_id IN (SELECT t.id FROM teams t WHERE t.owner_id = ?)) AND ${v.sql}`,
    args: v.args,
  };
}

/**
 * ¿El registro existe en el workspace y la persona lo puede ver? (chats de líneas que ve,
 * páginas fuera de teamspaces cerrados, issues de equipos que ve).
 */
export async function linkTargetExists(
  ws: string,
  kind: TaskLinkKind,
  refId: string,
  viewer: { personId: string; role: import('./teams').TeamRole },
): Promise<boolean> {
  const db = getDb();
  const one = async (sql: string) => Boolean(await db.prepare(sql).get(refId, ws));
  switch (kind) {
    case 'lines_chat':
    case 'lines_message': {
      const row = (await db
        .prepare(kind === 'lines_chat' ? 'SELECT id AS chat_id FROM groups_chats WHERE id = ? AND user_id = ?' : 'SELECT chat_id FROM groups_messages WHERE id = ? AND user_id = ?')
        .get(refId, ws)) as { chat_id: string } | undefined;
      if (!row) return false;
      const { canSeeChat, groupsViewer } = await import('./groups-access');
      return canSeeChat(await groupsViewer(ws, viewer.personId, viewer.role), row.chat_id);
    }
    case 'chat_conversation':
      return one('SELECT 1 FROM chat_conversations c JOIN chat_widgets w ON w.id = c.widget_id WHERE c.id = ? AND w.user_id = ?');
    case 'docs_page': {
      const { hiddenTeamspaceIds, teamspaceFilterSql } = await import('./docs-access');
      const f = teamspaceFilterSql(await hiddenTeamspaceIds(ws, viewer.personId));
      return Boolean(await db.prepare(`SELECT 1 FROM docs_pages WHERE id = ? AND user_id = ?${f.sql}`).get(refId, ws, ...f.args));
    }
    case 'track_issue': {
      const t = trackIssueSql(viewer.personId);
      return Boolean(await db.prepare(`${t.sql} AND i.id = ?`).get(ws, ws, ...t.args, refId));
    }
  }
}

async function isTask(ws: string, taskId: string): Promise<boolean> {
  return Boolean(await getDb().prepare("SELECT 1 FROM crm_activities WHERE id = ? AND user_id = ? AND type = 'task'").get(taskId, ws));
}

export class TaskLinkError extends Error {
  constructor(public code: 'not_found' | 'invalid_link') {
    super(code);
  }
}

/**
 * Vincula una tarea con un registro de otra app. Idempotente (el mismo
 * vínculo dos veces es uno). El registro tiene que ser del workspace.
 */
export async function linkTask(ws: string, taskId: string, kind: TaskLinkKind, refId: string, actor: string | null = null): Promise<void> {
  if (!(await isTask(ws, taskId))) throw new TaskLinkError('not_found');
  if (!isTaskLinkKind(kind) || !refId) throw new TaskLinkError('invalid_link');
  const { workspaceRole } = await import('./api-auth');
  const viewer = actor ? { personId: actor, role: await workspaceRole(ws, actor) } : { personId: ws, role: 'owner' as const };
  if (!(await linkTargetExists(ws, kind, refId, viewer))) throw new TaskLinkError('invalid_link');
  await getDb()
    .prepare('INSERT OR IGNORE INTO task_links (task_id, workspace_id, kind, ref_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(taskId, ws, kind, refId, actor, new Date().toISOString());
}

export async function unlinkTask(ws: string, taskId: string, kind: TaskLinkKind, refId: string): Promise<boolean> {
  return (
    (await getDb().prepare('DELETE FROM task_links WHERE task_id = ? AND workspace_id = ? AND kind = ? AND ref_id = ?').run(taskId, ws, kind, refId))
      .changes > 0
  );
}

/** Ids de las tareas vinculadas a un registro. */
export async function tasksLinkedTo(ws: string, kind: TaskLinkKind, refId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare('SELECT task_id FROM task_links WHERE workspace_id = ? AND kind = ? AND ref_id = ? ORDER BY created_at')
    .all(ws, kind, refId)) as Array<{ task_id: string }>;
  return rows.map((r) => r.task_id);
}

interface LinkRow {
  task_id: string;
  kind: string;
  ref_id: string;
}

/** Vínculos de varias tareas, con nombre y link resueltos (una consulta por tipo). */
export async function taskLinks(ws: string, taskIds: string[]): Promise<Map<string, TaskLink[]>> {
  const out = new Map<string, TaskLink[]>();
  const ids = [...new Set(taskIds)].slice(0, 500);
  if (!ids.length) return out;
  const db = getDb();
  const rows = (await db
    .prepare(`SELECT task_id, kind, ref_id FROM task_links WHERE workspace_id = ? AND task_id IN (${inList(ids.length)}) ORDER BY created_at`)
    .all(ws, ...ids)) as LinkRow[];
  if (!rows.length) return out;

  const byKind = new Map<TaskLinkKind, string[]>();
  for (const r of rows) {
    if (!isTaskLinkKind(r.kind)) continue;
    byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r.ref_id]);
  }
  const info = new Map<string, { label: string; detail: string; chatId?: string | null }>();
  const key = (k: string, id: string) => `${k}:${id}`;
  const load = async (kind: TaskLinkKind, sql: string, map: (r: Record<string, unknown>) => { id: string; label: string; detail: string; chatId?: string | null }) => {
    const refs = [...new Set(byKind.get(kind) ?? [])];
    if (!refs.length) return;
    const found = (await db.prepare(sql.replace('(?*)', `(${inList(refs.length)})`)).all(...refs, ws)) as Array<Record<string, unknown>>;
    for (const r of found) {
      const m = map(r);
      info.set(key(kind, m.id), m);
    }
  };
  const { chatDisplayName } = await import('./groups');
  await load(
    'lines_chat',
    'SELECT id, name, phone, provider_chat_id FROM groups_chats WHERE id IN (?*) AND user_id = ?',
    (r) => ({
      id: String(r.id),
      label: chatDisplayName({ name: String(r.name ?? ''), phone: String(r.phone ?? ''), provider_chat_id: String(r.provider_chat_id ?? '') }),
      detail: '',
    }),
  );
  // Texto de los mensajes de Lines, para nombrar después sus menciones ("@<dígitos>" → "@Nombre").
  const lineMessages: Array<{ id: string; body: string; meta: string | null; number_id: string }> = [];
  await load(
    'lines_message',
    `SELECT m.id, m.chat_id, m.body, m.meta, m.number_id, c.name, c.phone, c.provider_chat_id FROM groups_messages m JOIN groups_chats c ON c.id = m.chat_id
     WHERE m.id IN (?*) AND m.user_id = ?`,
    (r) => {
      lineMessages.push({ id: String(r.id), body: String(r.body ?? ''), meta: (r.meta as string | null) ?? null, number_id: String(r.number_id ?? '') });
      return {
        id: String(r.id),
        label: chatDisplayName({ name: String(r.name ?? ''), phone: String(r.phone ?? ''), provider_chat_id: String(r.provider_chat_id ?? '') }),
        detail: String(r.body ?? '').slice(0, 280),
        chatId: String(r.chat_id),
      };
    },
  );
  if (lineMessages.some((m) => m.body.includes('@'))) {
    const { linesRowTexts } = await import('./groups-wa-names');
    const named = await linesRowTexts(ws, lineMessages, { shared: true });
    lineMessages.forEach((m, i) => {
      const item = info.get(key('lines_message', m.id));
      if (item) item.detail = named[i].slice(0, 280);
    });
  }
  await load(
    'chat_conversation',
    `SELECT c.id, c.subject, v.name, v.email FROM chat_conversations c JOIN chat_widgets w ON w.id = c.widget_id
     LEFT JOIN chat_visitors v ON v.id = c.visitor_id WHERE c.id IN (?*) AND w.user_id = ?`,
    (r) => ({ id: String(r.id), label: String(r.name || r.email || ''), detail: String(r.subject ?? '') }),
  );
  await load('docs_page', 'SELECT id, title FROM docs_pages WHERE id IN (?*) AND user_id = ?', (r) => ({
    id: String(r.id),
    label: String(r.title ?? ''),
    detail: '',
  }));
  // Track: el issue se resuelve sin workspace (sus proyectos son de equipo); el
  // vínculo solo se crea desde un proyecto que la persona ve (promoteTaskToTrack).
  {
    const refs = [...new Set(byKind.get('track_issue') ?? [])];
    if (refs.length) {
      const found = (await db
        .prepare(`SELECT id, identifier, title FROM track_issues WHERE id IN (${inList(refs.length)})`)
        .all(...refs)) as Array<{ id: string; identifier: string; title: string }>;
      for (const r of found) info.set(key('track_issue', r.id), { label: r.identifier, detail: r.title });
    }
  }

  for (const r of rows) {
    if (!isTaskLinkKind(r.kind)) continue;
    const i = info.get(key(r.kind, r.ref_id));
    const link: TaskLink = {
      kind: r.kind,
      refId: r.ref_id,
      label: i?.label ?? '',
      detail: i?.detail ?? '',
      href: i ? hrefFor(r.kind, r.ref_id, i.chatId) : '',
      app: LINK_APP[r.kind],
      missing: !i,
      ...(r.kind === 'lines_chat' ? { chatId: r.ref_id } : r.kind === 'lines_message' && i?.chatId ? { chatId: i.chatId } : {}),
    };
    out.set(r.task_id, [...(out.get(r.task_id) ?? []), link]);
  }
  return out;
}

/**
 * Cambió el estado de un issue de Track: las tareas vinculadas se completan
 * cuando el issue se cierra como hecho y se reabren si el issue vuelve a abrirse.
 */
export async function syncTasksFromIssue(issueId: string, closed: boolean): Promise<number> {
  const rows = (await getDb()
    .prepare(
      `SELECT l.task_id, l.workspace_id FROM task_links l JOIN crm_activities a ON a.id = l.task_id
       WHERE l.kind = 'track_issue' AND l.ref_id = ? AND a.done = ?`,
    )
    .all(issueId, closed ? 0 : 1)) as Array<{ task_id: string; workspace_id: string }>;
  if (!rows.length) return 0;
  const { updateActivity } = await import('./crm');
  let n = 0;
  for (const r of rows) {
    if (await updateActivity(r.workspace_id, r.task_id, { done: closed })) n++;
  }
  return n;
}

/**
 * Pasa una tarea a Track: crea un issue en un proyecto que la persona ve, con
 * el título, las notas y el link a la tarea, y deja los dos vinculados. Si la
 * tarea ya tiene issue, devuelve ese (doble clic o dos pestañas no duplican).
 */
export async function promoteTaskToTrack(
  ws: string,
  user: { id: string; team?: { id: string } | null; actingUser?: { id: string } | null },
  taskId: string,
  projectId: string,
): Promise<{ issueId: string; identifier: string; created: boolean } | { error: 'not_found' | 'project_not_found' }> {
  const db = getDb();
  const task = (await db
    .prepare("SELECT id, subject, body, owner_id, priority, due_at FROM crm_activities WHERE id = ? AND user_id = ? AND type = 'task'")
    .get(taskId, ws)) as { id: string; subject: string; body: string; owner_id: string | null; priority: string | null; due_at: string | null } | undefined;
  if (!task) return { error: 'not_found' };
  const person = user.actingUser?.id ?? user.id;
  const existing = await linkedIssue(taskId, person);
  if (existing) return existing.visible ? { issueId: existing.issueId, identifier: existing.identifier, created: false } : { error: 'not_found' };
  const { listProjectMetas, createIssue } = await import('./track-data');
  const projects = await listProjectMetas(user.team?.id ?? null, user.id);
  if (!projects.some((p) => p.id === projectId)) return { error: 'project_not_found' };
  // Claim: un solo issue por tarea aunque lleguen dos pedidos a la vez.
  const claim = `pending:${crypto.randomUUID()}`;
  const claimed = await db
    .prepare(
      `INSERT OR IGNORE INTO task_links (task_id, workspace_id, kind, ref_id, created_by, created_at)
       SELECT ?, ?, 'track_issue', ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM task_links WHERE task_id = ? AND kind = 'track_issue')`,
    )
    .run(taskId, ws, claim, user.actingUser?.id ?? user.id, new Date().toISOString(), taskId);
  if (!claimed.changes) {
    // Otro pedido está creando el issue: esperar a que termine (unos segundos como mucho).
    for (let i = 0; i < 50; i++) {
      const other = await linkedIssue(taskId, person);
      if (other) return other.visible ? { issueId: other.issueId, identifier: other.identifier, created: false } : { error: 'not_found' };
      const pending = await db.prepare("SELECT 1 FROM task_links WHERE task_id = ? AND kind = 'track_issue'").get(taskId);
      if (!pending) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return { error: 'not_found' };
  }
  try {
    const priority = task.priority === 'high' || task.priority === 'low' ? task.priority : 'medium';
    const text = [task.body.trim(), `/app/crm/tasks/${task.id}`].filter(Boolean).join('\n\n');
    const issue = await createIssue(
      projectId,
      user.actingUser?.id ?? user.id,
      {
        title: (task.subject || 'Task').slice(0, 200),
        description: [{ type: 'text', text }],
        priority,
        assigneeId: task.owner_id ?? undefined,
        dueDate: /^\d{4}-\d{2}-\d{2}/.test(task.due_at ?? '') ? task.due_at!.slice(0, 10) : undefined,
      },
      { source: 'app' },
    );
    await db.prepare("UPDATE task_links SET ref_id = ? WHERE task_id = ? AND kind = 'track_issue' AND ref_id = ?").run(issue.id, taskId, claim);
    return { issueId: issue.id, identifier: issue.identifier, created: true };
  } catch (err) {
    await db.prepare("DELETE FROM task_links WHERE task_id = ? AND kind = 'track_issue' AND ref_id = ?").run(taskId, claim);
    throw err;
  }
}

/** Issue vinculado a la tarea y si la persona ve su equipo (lib/track-access). */
async function linkedIssue(taskId: string, person: string): Promise<{ issueId: string; identifier: string; visible: boolean } | null> {
  const v = trackVisibleSql('p', person);
  const row = (await getDb()
    .prepare(
      `SELECT i.id, i.identifier, ${v.sql} AS visible FROM task_links l JOIN track_issues i ON i.id = l.ref_id
       JOIN track_projects p ON p.id = i.project_id
       WHERE l.task_id = ? AND l.kind = 'track_issue' LIMIT 1`,
    )
    .get(...v.args, taskId)) as { id: string; identifier: string; visible: number } | undefined;
  return row ? { issueId: row.id, identifier: row.identifier, visible: Boolean(row.visible) } : null;
}

/** Tareas vinculadas a un issue de Track (para mostrarlas en el issue). */
export async function tasksForIssue(issueId: string): Promise<Array<{ id: string; workspaceId: string; subject: string; done: boolean }>> {
  const rows = (await getDb()
    .prepare(
      `SELECT a.id, l.workspace_id, a.subject, a.done FROM task_links l JOIN crm_activities a ON a.id = l.task_id
       WHERE l.kind = 'track_issue' AND l.ref_id = ? ORDER BY l.created_at`,
    )
    .all(issueId)) as Array<{ id: string; workspace_id: string; subject: string; done: number }>;
  return rows.map((r) => ({ id: r.id, workspaceId: r.workspace_id, subject: r.subject, done: r.done === 1 }));
}

/**
 * Vínculos de varias tareas como los ve una persona: de las apps que no usa y
 * de los chats de Groups que no ve (acceso por etiqueta) queda el tipo, sin
 * nombre ni link.
 */
export async function taskLinksFor(
  user: { id: string; role: import('./teams').TeamRole; actingUser?: { id: string } | null; apps?: import('./workspace').AppAccess },
  taskIds: string[],
): Promise<Map<string, TaskLink[]>> {
  const all = await taskLinks(user.id, taskIds);
  if (!all.size) return all;
  const { canUse } = await import('./permissions');
  const can = (app: TaskLink['app']) => canUse(user, app);
  let chats: Set<string> | null = null;
  let mask: ((s: string) => string) | null = null;
  if (can('groups') && [...all.values()].some((ls) => ls.some((l) => l.chatId))) {
    const { groupsViewer, visibleChatIds, maskPhoneText } = await import('./groups-access');
    const viewer = await groupsViewer(user.id, user.actingUser?.id ?? user.id, user.role);
    chats = await visibleChatIds(viewer);
    if (viewer.mask) mask = maskPhoneText;
  }
  // Páginas de teamspaces cerrados e issues de equipos privados que la persona no ve: sin nombre ni link.
  const person = user.actingUser?.id ?? user.id;
  const refsOf = (kind: TaskLink['kind']) => [...new Set([...all.values()].flatMap((ls) => ls.filter((l) => l.kind === kind).map((l) => l.refId)))];
  const hidden = new Set<string>();
  const pages = refsOf('docs_page');
  if (pages.length) {
    const { hiddenTeamspaceIds, teamspaceFilterSql } = await import('./docs-access');
    const f = teamspaceFilterSql(await hiddenTeamspaceIds(user.id, person));
    const ok = (await getDb()
      .prepare(`SELECT id FROM docs_pages WHERE id IN (${inList(pages.length)}) AND user_id = ?${f.sql}`)
      .all(...pages, user.id, ...f.args)) as Array<{ id: string }>;
    const seen = new Set(ok.map((r) => r.id));
    for (const p of pages) if (!seen.has(p)) hidden.add(`docs_page:${p}`);
  }
  const issues = refsOf('track_issue');
  if (issues.length) {
    const t = trackIssueSql(person);
    const ok = (await getDb().prepare(`${t.sql} AND i.id IN (${inList(issues.length)})`).all(user.id, user.id, ...t.args, ...issues)) as Array<{ id: string }>;
    const seen = new Set(ok.map((r) => r.id));
    for (const i of issues) if (!seen.has(i)) hidden.add(`track_issue:${i}`);
  }
  const out = new Map<string, TaskLink[]>();
  for (const [id, ls] of all) {
    out.set(
      id,
      visibleLinks(ls, can).map((l) => {
        if (hidden.has(`${l.kind}:${l.refId}`)) return { ...l, label: '', detail: '', href: '' };
        if (!l.chatId) return l;
        if (chats && !chats.has(l.chatId)) return { ...l, label: '', detail: '', href: '' };
        return mask ? { ...l, label: mask(l.label), detail: mask(l.detail) } : l;
      }),
    );
  }
  return out;
}

/** Suma a las tareas de un timeline de dónde vienen (el chat de WhatsApp, la página, el issue). */
export async function withTaskSources<T extends { id: string; type?: string; external?: boolean }>(
  user: Parameters<typeof taskLinksFor>[0],
  items: T[],
): Promise<Array<T & { source?: { href: string; app: TaskLink['app']; label: string } }>> {
  const ids = items.filter((i) => i.type === 'task' && !i.external).map((i) => i.id);
  if (!ids.length) return items;
  const links = await taskLinksFor(user, ids);
  const { primaryLink } = await import('./tasks-shared');
  return items.map((i) => {
    const l = primaryLink(links.get(i.id));
    return l && l.href ? { ...i, source: { href: l.href, app: l.app, label: l.label } } : i;
  });
}
