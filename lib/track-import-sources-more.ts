/**
 * Track — import por API desde Jira Cloud, Asana y Shortcut. Igual que Linear
 * y GitHub (lib/track-import-sources.ts): cada `fetch…Step` trae una página,
 * devuelve issues normalizados (y comentarios aparte cuando la fuente los da
 * por separado) y el cursor de la siguiente; el runner los deja en
 * import_job_items. El secreto llega descifrado del job y solo va en headers.
 *
 * - Jira Cloud: sitio (https://<sitio>.atlassian.net) + email + API token
 *   (Basic). REST v3 /rest/api/3/search/jql con nextPageToken. Pide una clave
 *   de proyecto o una JQL (Jira no acepta búsquedas sin restricción).
 * - Asana: token personal (Bearer) y un proyecto. Tareas con paginado por
 *   offset; los comentarios (stories comment_added) se leen tarea por tarea
 *   en una fase aparte, con tope por paso.
 * - Shortcut: token (header Shortcut-Token). Workflows, miembros y epics
 *   primero (para nombres de status, emails y milestones), después la
 *   búsqueda de stories con detail=full (trae los comentarios).
 */
import { ImportError, sourceBase, sourceFetch } from './import-jobs';
import {
  finishIssue,
  normalizeDate,
  normalizeDay,
  normalizeEstimate,
  normalizePriority,
  safeImportColor,
  statusCategoryFromName,
  type ImportStatusCategory,
  type NormalizedComment,
  type NormalizedIssue,
} from './track-import-map';
import type { FetchStepResult } from './track-import-sources';

// ---------- ADF (Atlassian Document Format) → Markdown ----------

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
}

function adfInline(n: AdfNode): string {
  if (n.type === 'text') {
    let t = n.text ?? '';
    for (const m of n.marks ?? []) {
      if (m.type === 'strong') t = `**${t}**`;
      else if (m.type === 'em') t = `_${t}_`;
      else if (m.type === 'code') t = `\`${t}\``;
      else if (m.type === 'strike') t = `~~${t}~~`;
      else if (m.type === 'link' && typeof m.attrs?.href === 'string') t = `[${t}](${m.attrs.href})`;
    }
    return t;
  }
  if (n.type === 'hardBreak') return '\n';
  if (n.type === 'mention') return String(n.attrs?.text ?? '@');
  if (n.type === 'emoji') return String(n.attrs?.text ?? n.attrs?.shortName ?? '');
  if (n.type === 'inlineCard' || n.type === 'blockCard') return String(n.attrs?.url ?? '');
  if (n.type === 'status') return String(n.attrs?.text ?? '');
  if (n.type === 'date') {
    const ts = Number(n.attrs?.timestamp);
    return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : '';
  }
  return (n.content ?? []).map(adfInline).join('');
}

function adfBlock(n: AdfNode, depth = 0): string {
  const kids = n.content ?? [];
  switch (n.type) {
    case 'doc':
      return kids.map((k) => adfBlock(k, depth)).filter(Boolean).join('\n\n');
    case 'paragraph':
      return kids.map(adfInline).join('');
    case 'heading':
      return `${'#'.repeat(Math.min(Math.max(Number(n.attrs?.level) || 1, 1), 6))} ${kids.map(adfInline).join('')}`;
    case 'bulletList':
    case 'orderedList':
      return kids
        .map((item, i) => {
          const marker = n.type === 'orderedList' ? `${i + 1}.` : '-';
          const body = (item.content ?? []).map((c) => adfBlock(c, depth + 1)).join('\n');
          return `${'  '.repeat(depth)}${marker} ${body.trimStart()}`;
        })
        .join('\n');
    case 'taskList':
      return kids
        .map((item) => `${'  '.repeat(depth)}- [${item.attrs?.state === 'DONE' ? 'x' : ' '}] ${(item.content ?? []).map(adfInline).join('')}`)
        .join('\n');
    case 'codeBlock':
      return `\`\`\`${typeof n.attrs?.language === 'string' ? n.attrs.language : ''}\n${kids.map(adfInline).join('')}\n\`\`\``;
    case 'blockquote':
      return kids
        .map((k) => adfBlock(k, depth))
        .join('\n\n')
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    case 'rule':
      return '---';
    case 'panel':
    case 'expand':
    case 'nestedExpand':
    case 'layoutSection':
    case 'layoutColumn':
      return kids.map((k) => adfBlock(k, depth)).filter(Boolean).join('\n\n');
    case 'table':
      return kids
        .map((row) => (row.content ?? []).map((cell) => (cell.content ?? []).map((c) => adfBlock(c, depth)).join(' ')).join(' | '))
        .join('\n');
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return '';
    default:
      return kids.length ? kids.map(adfInline).join('') : adfInline(n);
  }
}

/** Descripción o comentario de Jira (ADF en v3, texto en v2) → Markdown. */
export function adfToMarkdown(doc: unknown): string {
  if (doc == null) return '';
  if (typeof doc === 'string') return doc;
  if (typeof doc !== 'object') return '';
  return adfBlock(doc as AdfNode).replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- Jira Cloud ----------

const JIRA_PAGE = 50;
const JIRA_FIELDS = 'summary,description,status,priority,assignee,labels,created,duedate,parent,project,comment,issuetype';

/** Sitio de Jira Cloud normalizado (https://acme.atlassian.net) o null. */
export function normalizeJiraSite(raw: string): string | null {
  const v = raw.trim().replace(/\/+$/, '');
  const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== 'https:' || !/^[a-z0-9-]+\.(atlassian\.net|jira\.com)$/i.test(u.hostname)) return null;
    return `https://${u.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

/** Clave de proyecto (ENG) → JQL; si ya es una JQL, tal cual. */
export function jiraJql(input: string): string {
  const v = input.trim();
  if (/^[A-Z][A-Z0-9_]{0,19}$/i.test(v)) return `project = "${v.toUpperCase()}" ORDER BY created ASC`;
  return v;
}

/** Categoría de Jira (new / indeterminate / done) con el nombre para afinar. */
export function jiraStatusCategory(key: string | null | undefined, name: string | null | undefined): ImportStatusCategory {
  const byName = statusCategoryFromName(name);
  if (key === 'done') return byName === 'cancelled' ? 'cancelled' : 'done';
  if (key === 'indeterminate') return 'in_progress';
  return byName === 'backlog' ? 'backlog' : 'todo';
}

interface JiraUser {
  emailAddress?: string | null;
  displayName?: string | null;
}

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    status?: { name?: string; statusCategory?: { key?: string } } | null;
    priority?: { name?: string } | null;
    assignee?: JiraUser | null;
    labels?: string[];
    created?: string;
    duedate?: string | null;
    parent?: { key?: string } | null;
    project?: { key?: string; name?: string } | null;
    issuetype?: { name?: string; subtask?: boolean } | null;
    comment?: { comments?: Array<{ id: string; author?: JiraUser | null; body?: unknown; created?: string }> } | null;
  };
}

export function jiraIssueToNormalized(i: JiraIssue): NormalizedIssue {
  const f = i.fields ?? {};
  const projectName = f.project?.name || f.project?.key || 'Jira';
  const statusName = f.status?.name ?? null;
  const type = f.issuetype?.name;
  return finishIssue({
    extId: i.key,
    key: i.key,
    // Mismo extId de proyecto que el import por CSV de Jira: reimportar no duplica proyectos.
    project: { extId: `name:${projectName.toLowerCase()}`, name: projectName, key: f.project?.key ?? null },
    title: f.summary || i.key,
    description: adfToMarkdown(f.description),
    status: { name: statusName, category: jiraStatusCategory(f.status?.statusCategory?.key, statusName) },
    priority: normalizePriority(f.priority?.name),
    assignee: f.assignee ? { email: f.assignee.emailAddress?.toLowerCase() ?? null, name: f.assignee.displayName ?? null } : null,
    estimate: null,
    labels: [...(f.labels ?? []), ...(type && !f.issuetype?.subtask ? [type] : [])].map((name) => ({ name })),
    cycle: null,
    milestone: null,
    parentExtId: f.parent?.key ?? null,
    createdAt: normalizeDate(f.created),
    dueDate: normalizeDay(f.duedate),
    comments: (f.comment?.comments ?? []).map(
      (c): NormalizedComment => ({
        extId: `jira-comment:${c.id}`,
        authorEmail: c.author?.emailAddress?.toLowerCase() ?? null,
        authorName: c.author?.displayName ?? null,
        body: adfToMarkdown(c.body),
        createdAt: normalizeDate(c.created),
      }),
    ),
  });
}

/** El secreto de Jira se guarda como "email:token" (Basic auth). */
export function jiraAuthHeader(secret: string): string {
  return `Basic ${Buffer.from(secret).toString('base64')}`;
}

export async function fetchJiraStep(secret: string, site: string, query: string, cursor: Record<string, unknown>): Promise<FetchStepResult> {
  const origin = normalizeJiraSite(site);
  if (!origin) throw new ImportError('invalid_input');
  const jql = jiraJql(query);
  if (!jql) throw new ImportError('invalid_input');
  const base = sourceBase('jira', origin);
  const params = new URLSearchParams({ jql, fields: JIRA_FIELDS, maxResults: String(JIRA_PAGE) });
  if (typeof cursor.next === 'string' && cursor.next) params.set('nextPageToken', cursor.next);
  const { data } = await sourceFetch<{ issues?: JiraIssue[]; nextPageToken?: string | null; isLast?: boolean }>(
    `${base}/rest/api/3/search/jql?${params}`,
    { headers: { authorization: jiraAuthHeader(secret), accept: 'application/json' } },
  );
  const issues = data.issues ?? [];
  const next = data.nextPageToken ?? null;
  return {
    items: issues.map((i) => ({ kind: 'issue', data: jiraIssueToNormalized(i) })),
    cursor: { next },
    done: data.isLast === true || !next || issues.length === 0,
  };
}

// ---------- Asana ----------

const ASANA_PAGE = 100;
/** Tareas cuyos comentarios se leen por paso (una llamada por tarea). */
const ASANA_STORIES_PER_STEP = 10;
const ASANA_TASK_FIELDS = 'name,notes,completed,assignee.email,assignee.name,due_on,created_at,tags.name,tags.color,memberships.section.name,parent.gid';

/** gid de un proyecto de Asana desde su URL (/0/<gid>/…, /project/<gid>/…) o el gid suelto. */
export function asanaProjectGid(raw: string): string | null {
  const v = raw.trim();
  if (/^\d{6,25}$/.test(v)) return v;
  const byProject = /\/project\/(\d{6,25})/.exec(v);
  if (byProject) return byProject[1];
  const legacy = /app\.asana\.com\/0\/(\d{6,25})/.exec(v);
  return legacy ? legacy[1] : null;
}

/** Status de una tarea: completada → done; si no, por el nombre de la sección. */
export function asanaStatus(completed: boolean, section: string | null | undefined): { name: string | null; category: ImportStatusCategory } {
  if (completed) return { name: null, category: 'done' };
  const name = section?.trim() || null;
  const v = (name ?? '').toLowerCase();
  if (/progress|doing|curso|andamento|review|revis/.test(v)) return { name, category: 'in_progress' };
  if (/backlog|icebox|someday|later/.test(v)) return { name, category: 'backlog' };
  // Una sección "Done" con la tarea sin completar no la cierra.
  const byName = statusCategoryFromName(name);
  return { name, category: byName === 'in_progress' || byName === 'backlog' ? byName : 'todo' };
}

interface AsanaTask {
  gid: string;
  name?: string;
  notes?: string;
  completed?: boolean;
  assignee?: { email?: string | null; name?: string | null } | null;
  due_on?: string | null;
  created_at?: string;
  tags?: Array<{ name?: string; color?: string | null }>;
  memberships?: Array<{ section?: { name?: string } | null }>;
  parent?: { gid?: string } | null;
}

/** Colores de Asana con nombre (dark-red, light-green…) → hex. */
const ASANA_COLORS: Record<string, string> = {
  red: '#e8384f',
  orange: '#fd612c',
  yellow: '#eec300',
  green: '#62d26f',
  teal: '#4ecbc4',
  blue: '#4573d2',
  purple: '#8d84e8',
  pink: '#f9aaef',
  gray: '#8da3a6',
};

function asanaColor(raw: string | null | undefined): string | null {
  const key = String(raw ?? '').replace(/^(dark|light|hot)-/, '').replace('aqua', 'teal').replace('magenta', 'pink').replace('indigo', 'purple');
  return ASANA_COLORS[key] ?? safeImportColor(raw);
}

export function asanaTaskToNormalized(projectGid: string, projectName: string, t: AsanaTask): NormalizedIssue {
  const section = t.memberships?.find((m) => m.section?.name)?.section?.name ?? null;
  return finishIssue({
    extId: `asana:${t.gid}`,
    key: null,
    project: { extId: `asana:${projectGid}`, name: projectName || 'Asana', key: null },
    title: t.name || `Task ${t.gid}`,
    description: t.notes ?? '',
    status: asanaStatus(t.completed === true, section),
    priority: 'medium',
    assignee: t.assignee ? { email: t.assignee.email?.toLowerCase() ?? null, name: t.assignee.name ?? null } : null,
    estimate: null,
    labels: (t.tags ?? []).filter((x) => x.name).map((x) => ({ name: x.name as string, color: asanaColor(x.color) })),
    cycle: null,
    milestone: null,
    parentExtId: t.parent?.gid ? `asana:${t.parent.gid}` : null,
    createdAt: normalizeDate(t.created_at),
    dueDate: normalizeDay(t.due_on),
    comments: [],
  });
}

interface AsanaStory {
  gid: string;
  resource_subtype?: string;
  type?: string;
  text?: string;
  created_at?: string;
  created_by?: { name?: string | null; email?: string | null } | null;
}

/**
 * Fases: project (valida token y proyecto, trae el nombre) → tasks página a
 * página → stories de las tareas de esa página (de a 10 por paso) → la
 * página siguiente de tasks.
 */
export async function fetchAsanaStep(token: string, project: string, cursor: Record<string, unknown>): Promise<FetchStepResult> {
  const gid = asanaProjectGid(project);
  if (!gid) throw new ImportError('invalid_input');
  const base = `${sourceBase('asana', 'https://app.asana.com')}/api/1.0`;
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const phase = (cursor.phase as string) || 'project';
  const name = typeof cursor.name === 'string' ? cursor.name : '';

  if (phase === 'project') {
    const { data } = await sourceFetch<{ data?: { name?: string } }>(`${base}/projects/${gid}?opt_fields=name`, { headers });
    return { items: [], cursor: { phase: 'tasks', name: data.data?.name ?? 'Asana', offset: null }, done: false };
  }

  if (phase === 'tasks') {
    const params = new URLSearchParams({ opt_fields: ASANA_TASK_FIELDS, limit: String(ASANA_PAGE) });
    if (typeof cursor.offset === 'string' && cursor.offset) params.set('offset', cursor.offset);
    const { data } = await sourceFetch<{ data?: AsanaTask[]; next_page?: { offset?: string } | null }>(
      `${base}/projects/${gid}/tasks?${params}`,
      { headers },
    );
    const tasks = data.data ?? [];
    const nextOffset = data.next_page?.offset ?? null;
    return {
      items: tasks.map((t) => ({ kind: 'issue', data: asanaTaskToNormalized(gid, name, t) })),
      cursor: { phase: 'stories', name, queue: tasks.map((t) => t.gid), nextOffset },
      done: false,
    };
  }

  // stories
  const queue = Array.isArray(cursor.queue) ? (cursor.queue as string[]) : [];
  const batch = queue.slice(0, ASANA_STORIES_PER_STEP);
  const rest = queue.slice(ASANA_STORIES_PER_STEP);
  const items: FetchStepResult['items'] = [];
  for (const taskGid of batch) {
    const { data } = await sourceFetch<{ data?: AsanaStory[] }>(
      `${base}/tasks/${taskGid}/stories?opt_fields=type,resource_subtype,text,created_at,created_by.name,created_by.email&limit=100`,
      { headers },
    );
    for (const s of data.data ?? []) {
      if (s.resource_subtype !== 'comment_added' || !s.text?.trim()) continue;
      items.push({
        kind: 'comment',
        data: {
          issueExtId: `asana:${taskGid}`,
          comment: {
            extId: `asana-story:${s.gid}`,
            authorEmail: s.created_by?.email?.toLowerCase() ?? null,
            authorName: s.created_by?.name ?? null,
            body: s.text.slice(0, 5000),
            createdAt: normalizeDate(s.created_at),
          },
        },
      });
    }
  }
  const nextOffset = typeof cursor.nextOffset === 'string' ? cursor.nextOffset : null;
  if (rest.length > 0) return { items, cursor: { phase: 'stories', name, queue: rest, nextOffset }, done: false };
  if (nextOffset) return { items, cursor: { phase: 'tasks', name, offset: nextOffset }, done: false };
  return { items, cursor: { phase: 'done', name }, done: true };
}

// ---------- Shortcut ----------

const SHORTCUT_PAGE = 25;

/** Tipo de estado de Shortcut (unstarted, started, done) con el nombre para backlog. */
export function shortcutStateCategory(type: string | null | undefined, name: string | null | undefined): ImportStatusCategory {
  if (type === 'done') return 'done';
  if (type === 'started') return 'in_progress';
  return statusCategoryFromName(name) === 'backlog' ? 'backlog' : 'todo';
}

interface ShortcutMeta {
  states: Record<string, { name: string; type: string; workflow: string }>;
  members: Record<string, { email: string | null; name: string | null }>;
  epics: Record<string, { name: string; deadline: string | null }>;
}

interface ShortcutStory {
  id: number;
  name?: string;
  description?: string;
  story_type?: string;
  estimate?: number | null;
  deadline?: string | null;
  labels?: Array<{ name?: string; color?: string | null }>;
  owner_ids?: string[];
  comments?: Array<{ id: number; text?: string; author_id?: string; created_at?: string; deleted?: boolean }>;
  created_at?: string;
  epic_id?: number | null;
  workflow_state_id?: number;
  parent_story_id?: number | null;
}

export function shortcutStoryToNormalized(s: ShortcutStory, meta: ShortcutMeta): NormalizedIssue {
  const state = meta.states[String(s.workflow_state_id ?? '')];
  const projectName = state?.workflow || 'Shortcut';
  const owner = s.owner_ids?.[0] ? meta.members[s.owner_ids[0]] : null;
  const epic = s.epic_id ? meta.epics[String(s.epic_id)] : null;
  const type = s.story_type ? s.story_type.charAt(0).toUpperCase() + s.story_type.slice(1) : null;
  return finishIssue({
    extId: `sc-${s.id}`,
    key: `sc-${s.id}`,
    project: { extId: `shortcut:${projectName.toLowerCase()}`, name: projectName, key: null },
    title: s.name || `Story ${s.id}`,
    description: s.description ?? '',
    status: { name: state?.name ?? null, category: shortcutStateCategory(state?.type, state?.name) },
    priority: 'medium',
    assignee: owner ? { email: owner.email?.toLowerCase() ?? null, name: owner.name } : null,
    estimate: normalizeEstimate(s.estimate),
    labels: [...(s.labels ?? []).filter((l) => l.name).map((l) => ({ name: l.name as string, color: safeImportColor(l.color) })), ...(type ? [{ name: type }] : [])],
    cycle: null,
    milestone: epic && s.epic_id ? { extId: `epic:${s.epic_id}`, name: epic.name, targetDate: normalizeDay(epic.deadline) } : null,
    parentExtId: s.parent_story_id ? `sc-${s.parent_story_id}` : null,
    createdAt: normalizeDate(s.created_at),
    dueDate: normalizeDay(s.deadline),
    comments: (s.comments ?? [])
      .filter((c) => !c.deleted && c.text?.trim())
      .map((c) => {
        const author = c.author_id ? meta.members[c.author_id] : null;
        return {
          extId: `sc-comment:${c.id}`,
          authorEmail: author?.email?.toLowerCase() ?? null,
          authorName: author?.name ?? null,
          body: c.text as string,
          createdAt: normalizeDate(c.created_at),
        };
      }),
  });
}

/** Token de paginado de la búsqueda (el `next` viene como path con ?next=…). */
export function shortcutNextToken(next: string | null | undefined): string | null {
  if (!next) return null;
  try {
    return new URL(next, 'https://x').searchParams.get('next');
  } catch {
    return null;
  }
}

/**
 * Fases: meta (workflows, miembros y epics, valida el token) → stories con la
 * búsqueda (`query`, por defecto todas las no archivadas), 25 por página.
 */
export async function fetchShortcutStep(token: string, query: string, cursor: Record<string, unknown>): Promise<FetchStepResult> {
  const base = `${sourceBase('shortcut', 'https://api.app.shortcut.com')}/api/v3`;
  const headers = { 'shortcut-token': token, accept: 'application/json' };
  const phase = (cursor.phase as string) || 'meta';

  if (phase === 'meta') {
    const [{ data: workflows }, { data: members }, epicsRes] = await Promise.all([
      sourceFetch<Array<{ name: string; states?: Array<{ id: number; name: string; type: string }> }>>(`${base}/workflows`, { headers }),
      sourceFetch<Array<{ id: string; profile?: { email_address?: string | null; name?: string | null } }>>(`${base}/members`, { headers }),
      sourceFetch<Array<{ id: number; name: string; deadline?: string | null }>>(`${base}/epics`, { headers }).catch(() => ({ data: [] })),
    ]);
    const meta: ShortcutMeta = { states: {}, members: {}, epics: {} };
    for (const w of workflows ?? []) for (const s of w.states ?? []) meta.states[String(s.id)] = { name: s.name, type: s.type, workflow: w.name };
    for (const m of members ?? []) meta.members[m.id] = { email: m.profile?.email_address ?? null, name: m.profile?.name ?? null };
    for (const e of epicsRes.data ?? []) meta.epics[String(e.id)] = { name: e.name, deadline: e.deadline ?? null };
    return { items: [], cursor: { phase: 'stories', meta, next: null }, done: false };
  }

  const meta = (cursor.meta ?? { states: {}, members: {}, epics: {} }) as ShortcutMeta;
  const params = new URLSearchParams({ query: query.trim() || '!is:archived', page_size: String(SHORTCUT_PAGE), detail: 'full' });
  if (typeof cursor.next === 'string' && cursor.next) params.set('next', cursor.next);
  const { data } = await sourceFetch<{ data?: ShortcutStory[]; next?: string | null }>(`${base}/search/stories?${params}`, { headers });
  const stories = data.data ?? [];
  const next = shortcutNextToken(data.next);
  return {
    items: stories.map((s) => ({ kind: 'issue', data: shortcutStoryToNormalized(s, meta) })),
    cursor: { phase: 'stories', meta, next },
    done: !next || stories.length === 0,
  };
}
