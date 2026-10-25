import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createImportJob, getImportJob, getImportJobRow, type ImportJobView } from '@/lib/import-jobs';
import { runImportJob, startImportJob } from '@/lib/import-runner';
import { importCreateSchema } from '@/lib/import-http';
import {
  adfToMarkdown,
  asanaProjectGid,
  asanaStatus,
  fetchAsanaStep,
  fetchJiraStep,
  fetchShortcutStep,
  jiraIssueToNormalized,
  jiraJql,
  jiraStatusCategory,
  normalizeJiraSite,
  shortcutNextToken,
  shortcutStateCategory,
} from '@/lib/track-import-sources-more';
import { makeUser } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function runToEnd(id: string): Promise<ImportJobView> {
  for (let i = 0; i < 60; i++) {
    const view = (await runImportJob(id, 5_000))!;
    if (!['fetching', 'importing'].includes(view.status)) return view;
  }
  throw new Error('job did not finish');
}

function stubRoutes(routes: (url: URL, init: RequestInit) => unknown) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (raw: string, init: RequestInit = {}) => {
      const url = new URL(String(raw));
      calls.push({ url: url.toString(), headers: (init.headers ?? {}) as Record<string, string> });
      const body = routes(url, init);
      return new Response(JSON.stringify(body ?? { message: 'Not Found' }), { status: body ? 200 : 404 });
    }),
  );
  return calls;
}

describe('import: helpers puros', () => {
  it('ADF de Jira → Markdown', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Steps' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Click ' },
            { type: 'text', text: 'Save', marks: [{ type: 'strong' }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://x.dev' } }] },
            { type: 'mention', attrs: { text: '@Ana' } },
          ],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two', marks: [{ type: 'code' }] }] }] },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'x()' }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }] },
      ],
    };
    expect(adfToMarkdown(doc)).toBe('## Steps\n\nClick **Save**\n[docs](https://x.dev)@Ana\n\n- one\n- `two`\n\n```js\nx()\n```\n\n> quoted');
    expect(adfToMarkdown('plain v2')).toBe('plain v2');
    expect(adfToMarkdown(null)).toBe('');
  });

  it('Jira: sitio, JQL y status', () => {
    expect(normalizeJiraSite('acme.atlassian.net/')).toBe('https://acme.atlassian.net');
    expect(normalizeJiraSite('https://ACME.atlassian.net')).toBe('https://acme.atlassian.net');
    expect(normalizeJiraSite('http://evil.example.com')).toBeNull();
    expect(normalizeJiraSite('https://acme.atlassian.net.evil.com')).toBeNull();
    expect(jiraJql('eng')).toBe('project = "ENG" ORDER BY created ASC');
    expect(jiraJql('project = ENG AND labels = x')).toBe('project = ENG AND labels = x');
    expect(jiraStatusCategory('new', 'To Do')).toBe('todo');
    expect(jiraStatusCategory('new', 'Backlog')).toBe('backlog');
    expect(jiraStatusCategory('indeterminate', 'In Review')).toBe('in_progress');
    expect(jiraStatusCategory('done', 'Done')).toBe('done');
    expect(jiraStatusCategory('done', "Won't Do")).toBe('cancelled');
    const issue = jiraIssueToNormalized({
      id: '1',
      key: 'ENG-7',
      fields: {
        summary: 'Login fails',
        priority: { name: 'Highest' },
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        assignee: { emailAddress: 'Ana@Acme.dev', displayName: 'Ana' },
        labels: ['auth'],
        issuetype: { name: 'Bug' },
        project: { key: 'ENG', name: 'Engineering' },
        parent: { key: 'ENG-1' },
        duedate: '2024-05-01',
        comment: { comments: [{ id: '55', author: { displayName: 'Bo' }, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'same here' }] }] }, created: '2024-04-01T10:00:00.000+0000' }] },
      },
    });
    expect(issue).toMatchObject({
      extId: 'ENG-7',
      priority: 'urgent',
      status: { category: 'in_progress', name: 'In Progress' },
      assignee: { email: 'ana@acme.dev' },
      labels: [{ name: 'auth' }, { name: 'Bug' }],
      parentExtId: 'ENG-1',
      dueDate: '2024-05-01',
      project: { extId: 'name:engineering', key: 'ENG' },
    });
    expect(issue.comments[0]).toMatchObject({ extId: 'jira-comment:55', body: 'same here', authorName: 'Bo' });
  });

  it('Asana y Shortcut: proyecto, status y paginado', () => {
    expect(asanaProjectGid('1201234567890')).toBe('1201234567890');
    expect(asanaProjectGid('https://app.asana.com/0/1201234567890/list')).toBe('1201234567890');
    expect(asanaProjectGid('https://app.asana.com/1/111222333/project/1209876543210/board')).toBe('1209876543210');
    expect(asanaProjectGid('nope')).toBeNull();
    expect(asanaStatus(true, 'Doing')).toEqual({ name: null, category: 'done' });
    expect(asanaStatus(false, 'Doing')).toEqual({ name: 'Doing', category: 'in_progress' });
    expect(asanaStatus(false, 'Backlog')).toEqual({ name: 'Backlog', category: 'backlog' });
    expect(asanaStatus(false, 'Done')).toEqual({ name: 'Done', category: 'todo' });
    expect(shortcutStateCategory('started', 'In Development')).toBe('in_progress');
    expect(shortcutStateCategory('unstarted', 'Backlog')).toBe('backlog');
    expect(shortcutStateCategory('done', 'Completed')).toBe('done');
    expect(shortcutNextToken('/api/v3/search/stories?query=x&next=abc%3D')).toBe('abc=');
    expect(shortcutNextToken(null)).toBeNull();
  });

  it('schema: valida sitio de Jira y proyecto de Asana', () => {
    const jira = importCreateSchema.safeParse({ app: 'track', source: 'jira', site: 'acme.atlassian.net', email: 'a@b.co', token: 'tok_12345678', query: 'ENG', target: 'new' });
    expect(jira.success && jira.data.source === 'jira' && jira.data.site).toBe('https://acme.atlassian.net');
    expect(importCreateSchema.safeParse({ app: 'track', source: 'jira', site: 'example.com', email: 'a@b.co', token: 'tok_12345678', query: 'ENG', target: 'new' }).success).toBe(false);
    const asana = importCreateSchema.safeParse({ app: 'track', source: 'asana', token: 'tok_12345678', project: 'https://app.asana.com/0/1201234567890/list', target: 'new' });
    expect(asana.success && asana.data.source === 'asana' && asana.data.project).toBe('1201234567890');
  });
});

describe('import: pasos con fetch mockeado', () => {
  it('Jira: Basic auth y nextPageToken', async () => {
    const calls = stubRoutes((url) => {
      if (url.pathname !== '/rest/api/3/search/jql') return null;
      const token = url.searchParams.get('nextPageToken');
      return token === 'p2'
        ? { issues: [{ id: '2', key: 'ENG-2', fields: { summary: 'Two' } }], isLast: true }
        : { issues: [{ id: '1', key: 'ENG-1', fields: { summary: 'One' } }], nextPageToken: 'p2', isLast: false };
    });
    const first = await fetchJiraStep('ana@acme.dev:tok', 'acme.atlassian.net', 'ENG', {});
    expect(first).toMatchObject({ done: false, cursor: { next: 'p2' } });
    expect(calls[0].headers.authorization).toBe(`Basic ${Buffer.from('ana@acme.dev:tok').toString('base64')}`);
    expect(calls[0].url).toContain('https://acme.atlassian.net/rest/api/3/search/jql?jql=project');
    const second = await fetchJiraStep('ana@acme.dev:tok', 'acme.atlassian.net', 'ENG', first.cursor);
    expect(second.done).toBe(true);
    expect((second.items[0].data as { extId: string }).extId).toBe('ENG-2');
  });

  it('Asana: tareas, comentarios por tarea y offset', async () => {
    stubRoutes((url) => {
      const p = url.pathname;
      if (p === '/api/1.0/projects/1201234567890') return { data: { name: 'Launch' } };
      if (p === '/api/1.0/projects/1201234567890/tasks') {
        return url.searchParams.get('offset') === 'o2'
          ? { data: [{ gid: '3', name: 'Third', completed: true }], next_page: null }
          : { data: [{ gid: '1', name: 'First', memberships: [{ section: { name: 'Doing' } }], tags: [{ name: 'web', color: 'dark-blue' }] }, { gid: '2', name: 'Second' }], next_page: { offset: 'o2' } };
      }
      if (/^\/api\/1\.0\/tasks\/\d+\/stories$/.test(p)) {
        return { data: [{ gid: `s${p.split('/')[4]}`, resource_subtype: 'comment_added', text: 'note', created_by: { name: 'Bo' } }, { gid: 'x', resource_subtype: 'assigned', text: 'assigned' }] };
      }
      return null;
    });
    let cursor: Record<string, unknown> = {};
    const items: Array<{ kind: string; data: unknown }> = [];
    for (let i = 0; i < 10; i++) {
      const step = await fetchAsanaStep('tok', '1201234567890', cursor);
      items.push(...step.items);
      cursor = step.cursor;
      if (step.done) break;
    }
    const issues = items.filter((i) => i.kind === 'issue').map((i) => i.data as { extId: string; status: { category: string }; labels: Array<{ color: string | null }>; project: { name: string } });
    expect(issues.map((i) => i.extId)).toEqual(['asana:1', 'asana:2', 'asana:3']);
    expect(issues[0].status.category).toBe('in_progress');
    expect(issues[0].labels[0].color).toBe('#4573d2');
    expect(issues[0].project.name).toBe('Launch');
    expect(issues[2].status.category).toBe('done');
    expect(items.filter((i) => i.kind === 'comment')).toHaveLength(3);
  });

  it('Shortcut: header, metadatos y stories con comentarios', async () => {
    const calls = stubRoutes((url) => {
      const p = url.pathname;
      if (p === '/api/v3/workflows') return [{ name: 'Engineering', states: [{ id: 10, name: 'In Development', type: 'started' }] }];
      if (p === '/api/v3/members') return [{ id: 'm1', profile: { email_address: 'Ana@Acme.dev', name: 'Ana' } }];
      if (p === '/api/v3/epics') return [{ id: 5, name: 'Onboarding', deadline: '2024-06-01T00:00:00Z' }];
      if (p === '/api/v3/search/stories') {
        return {
          data: [
            {
              id: 42,
              name: 'Signup form',
              story_type: 'feature',
              estimate: 3,
              owner_ids: ['m1'],
              epic_id: 5,
              workflow_state_id: 10,
              labels: [{ name: 'web', color: '#ff0000' }],
              comments: [{ id: 1, text: 'looks good', author_id: 'm1' }, { id: 2, text: 'gone', deleted: true }],
            },
          ],
          next: null,
        };
      }
      return null;
    });
    const meta = await fetchShortcutStep('sc_tok', '', {});
    expect(calls[0].headers['shortcut-token']).toBe('sc_tok');
    const step = await fetchShortcutStep('sc_tok', '', meta.cursor);
    expect(step.done).toBe(true);
    expect(calls.at(-1)!.url).toContain('query=%21is%3Aarchived');
    expect(step.items[0].data).toMatchObject({
      extId: 'sc-42',
      status: { name: 'In Development', category: 'in_progress' },
      assignee: { email: 'ana@acme.dev' },
      estimate: 3,
      milestone: { extId: 'epic:5', name: 'Onboarding', targetDate: '2024-06-01' },
      labels: [{ name: 'web' }, { name: 'Feature' }],
      project: { name: 'Engineering' },
    });
    expect((step.items[0].data as { comments: unknown[] }).comments).toHaveLength(1);
  });

  it('Jira de punta a punta con el runner: reimport sin duplicados', async () => {
    const u = await makeUser('tjira');
    stubRoutes((url) =>
      url.pathname === '/rest/api/3/search/jql'
        ? {
            issues: [
              { id: '1', key: 'JR-1', fields: { summary: 'Parent', project: { key: 'JR', name: 'Jira proj' }, status: { name: 'Done', statusCategory: { key: 'done' } } } },
              { id: '2', key: 'JR-2', fields: { summary: 'Child', project: { key: 'JR', name: 'Jira proj' }, parent: { key: 'JR-1' } } },
            ],
            isLast: true,
          }
        : null,
    );
    const make = () =>
      createImportJob({ workspaceId: u.id, teamId: null, userId: u.id, app: 'track', source: 'jira', options: { target: 'new', site: 'https://acme.atlassian.net', query: 'JR' }, secret: 'a@b.co:tok' });
    const job = await make();
    const prev = (await runImportJob(job.id))!;
    expect(prev.preview).toMatchObject({ issues: 2 });
    await startImportJob((await getImportJob(job.id))!);
    const done = await runToEnd(job.id);
    expect(done.report).toMatchObject({ issues: 2, parents: 1 });
    expect((await getImportJobRow(job.id))?.secret).toBeNull();

    const again = await make();
    const prev2 = (await runImportJob(again.id))!;
    expect(prev2.preview).toMatchObject({ alreadyImported: 2 });
    const count = (await getDb()
      .prepare('SELECT COUNT(*) AS c FROM track_issues i JOIN track_projects p ON p.id = i.project_id WHERE p.owner_id = ?')
      .get(u.id)) as { c: number };
    expect(count.c).toBe(2);
  });
});
