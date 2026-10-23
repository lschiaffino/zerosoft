import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createImportJob, getImportJobRow, type ImportJobView } from '@/lib/import-jobs';
import { cancelImportJob, runImportJob, startImportJob } from '@/lib/import-runner';
import { getImportJob } from '@/lib/import-jobs';
import {
  csvCell,
  csvToIssues,
  detectCsvPreset,
  normalizeDate,
  normalizePriority,
  statusCategoryFromName,
  suggestMapping,
} from '@/lib/track-import-map';
import { priorityFromLabels } from '@/lib/track-import-sources';
import { createProject, listStatuses } from '@/lib/track-data';
import { exportIssuesCsv } from '@/lib/track-export';
import { parseCsv } from '@/lib/csv-parse';
import { makeUser } from './helpers';

const LINEAR_CSV = [
  'ID,Team,Title,Description,Status,Estimate,Priority,Project,Assignee,Labels,Cycle Number,Cycle Name,Cycle Start,Cycle End,Created,Due Date,Parent issue',
  'ENG-1,Engineering,Set up CI,"Run tests on **every** push",In Review,3,High,Q3 Launch,{email},"Infra, DX",4,Cycle 4,2024-05-01,2024-05-14,2024-04-28T10:00:00.000Z,2024-05-10,',
  'ENG-2,Engineering,Write docs,,Todo,,No priority,Q3 Launch,someone@else.test,Docs,,,,,2024-04-29T10:00:00.000Z,,ENG-1',
  'ENG-3,Engineering,Old bug,,Canceled,1,Urgent,,,,,,,,2024-01-01T00:00:00.000Z,,',
].join('\n');

async function runToEnd(id: string): Promise<ImportJobView> {
  for (let i = 0; i < 50; i++) {
    const view = (await runImportJob(id, 5_000))!;
    if (!['fetching', 'importing'].includes(view.status)) return view;
  }
  throw new Error('job did not finish');
}

async function trackJob(userId: string, source: string, opts: Record<string, unknown>, extra: { secret?: string; payload?: string } = {}) {
  return createImportJob({ workspaceId: userId, teamId: null, userId, app: 'track', source, options: opts, ...extra });
}

describe('track import: mapeo', () => {
  it('normaliza prioridades de Linear, Jira y texto', () => {
    expect([1, 2, 3, 4, 0].map(normalizePriority)).toEqual(['urgent', 'high', 'medium', 'low', 'medium']);
    expect(['Highest', 'Blocker', 'High', 'Medium', 'Low', 'Lowest', 'No priority', ''].map(normalizePriority)).toEqual([
      'urgent',
      'urgent',
      'high',
      'medium',
      'low',
      'low',
      'medium',
      'medium',
    ]);
  });

  it('deduce la categoría del status por el nombre', () => {
    expect(['In Review', 'Done', "Won't do", 'Backlog', 'Selected for Development', 'Closed'].map(statusCategoryFromName)).toEqual([
      'in_progress',
      'done',
      'cancelled',
      'backlog',
      'in_progress',
      'done',
    ]);
  });

  it('entiende las fechas de Jira e ISO', () => {
    expect(normalizeDate('15/Jan/24 3:30 PM')).toBe('2024-01-15T15:30:00.000Z');
    expect(normalizeDate('2024-02-01 10:00')).toBe('2024-02-01T10:00:00.000Z');
    expect(normalizeDate('nope')).toBeNull();
  });

  it('detecta Linear y Jira y sugiere el mapeo', () => {
    const linear = parseCsv(LINEAR_CSV)[0];
    expect(detectCsvPreset(linear)).toBe('linear');
    const m = suggestMapping(linear, 'linear');
    expect(m).toMatchObject({ id: 'ID', title: 'Title', project: 'Team', milestone: 'Project', cycle: 'Cycle Name', parent: 'Parent issue' });
    const jira = ['Summary', 'Issue key', 'Issue Type', 'Status', 'Labels', 'Labels', 'Comment', 'Custom field (Story Points)'];
    expect(detectCsvPreset(jira)).toBe('jira');
    expect(suggestMapping(jira, 'jira')).toMatchObject({ title: 'Summary', id: 'Issue key', estimate: 'Custom field (Story Points)', comments: 'Comment' });
  });

  it('junta columnas repetidas de Jira (labels y comentarios)', () => {
    const csv = [
      'Summary,Issue key,Status,Priority,Labels,Labels,Comment,Comment,Issue Type,Project name,Sprint',
      'Login breaks,PROJ-7,In Progress,Highest,auth,web,"15/Jan/24 10:00 AM;ana@acme.test;First note","16/Jan/24 9:00 AM;bob;Second",Bug,Project X,Sprint 3',
    ].join('\n');
    const headers = parseCsv(csv)[0];
    const [issue] = csvToIssues(csv, { ...suggestMapping(headers, 'jira'), cycle: 'Sprint' }, { source: 'jira' });
    expect(issue.extId).toBe('PROJ-7');
    expect(issue.project).toMatchObject({ name: 'Project X', key: 'PROJ' });
    expect(issue.labels.map((l) => l.name)).toEqual(['auth', 'web', 'Bug', 'Sprint 3']);
    expect(issue.priority).toBe('urgent');
    expect(issue.status.category).toBe('in_progress');
    expect(issue.comments).toHaveLength(2);
    expect(issue.comments[0]).toMatchObject({ authorEmail: 'ana@acme.test', body: 'First note', createdAt: '2024-01-15T10:00:00.000Z' });
    expect(issue.comments[1]).toMatchObject({ authorName: 'bob', body: 'Second' });
  });

  it('prioridad desde labels de GitHub', () => {
    expect(priorityFromLabels(['bug', 'priority: high'])).toBe('high');
    expect(priorityFromLabels(['P0'])).toBe('urgent');
    expect(priorityFromLabels(['bug'])).toBeNull();
  });

  it('el export neutraliza fórmulas sin romper listas de Markdown', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('- item')).toBe('- item');
    expect(csvCell('-cmd')).toBe(`'-cmd`);
    expect(csvCell('-3')).toBe('-3');
  });
});

describe('track import: job de punta a punta', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('CSV de Linear: vista previa, escritura, padres, cycles y reimport sin duplicar', async () => {
    const u = await makeUser('timp');
    const csv = LINEAR_CSV.replace('{email}', u.email);
    const mapping = suggestMapping(parseCsv(csv)[0], 'linear');
    const job = await trackJob(u.id, 'linear_csv', { target: 'new', mapping }, { payload: csv });

    const preview = (await runImportJob(job.id))!;
    expect(preview.status).toBe('preview');
    const p = preview.preview as Record<string, unknown>;
    expect(p.issues).toBe(3);
    expect(p.alreadyImported).toBe(0);
    expect(p.projects).toEqual([{ name: 'Engineering', issues: 3, existing: null }]);
    const statuses = p.statuses as Array<{ name: string; category: string; existing: boolean }>;
    expect(statuses.find((s) => s.name === 'In Review')).toMatchObject({ category: 'in_progress', existing: false });
    expect(statuses.find((s) => s.name === 'Todo')).toMatchObject({ existing: true });
    const people = p.people as Array<{ label: string; member: string | null }>;
    expect(people.find((x) => x.label === u.email)?.member).toBeTruthy();
    expect(people.find((x) => x.label === 'someone@else.test')?.member).toBeNull();
    // El CSV no queda guardado después de leerlo.
    expect((await getImportJobRow(job.id))?.payload).toBeNull();

    expect(await startImportJob((await getImportJob(job.id))!)).toBe(true);
    const done = await runToEnd(job.id);
    expect(done.status).toBe('done');
    const r = done.report as Record<string, number> & { projects: Array<{ id: string }> };
    expect(r).toMatchObject({ issues: 3, skipped: 0, projectsCreated: 1, cyclesCreated: 1, milestonesCreated: 1, unassigned: 1, parents: 1 });

    const projectId = r.projects[0].id;
    const issues = (await getDb()
      .prepare('SELECT identifier, title, priority, assignee_id, estimate, parent_id, cycle_id, milestone_id, status_id, labels, source, created_at FROM track_issues WHERE project_id = ? ORDER BY created_at')
      .all(projectId)) as Array<Record<string, string | number | null>>;
    expect(issues.map((i) => i.title)).toEqual(['Old bug', 'Set up CI', 'Write docs']);
    const ci = issues[1];
    expect(ci).toMatchObject({ priority: 'high', assignee_id: u.id, estimate: 3, source: 'import', created_at: '2024-04-28T10:00:00.000Z' });
    expect(String(ci.identifier)).toMatch(/^ENG(-[a-z0-9]+)?-\d+$/i);
    expect(JSON.parse(String(ci.labels)).map((l: { name: string }) => l.name)).toEqual(['Infra', 'DX']);
    expect(ci.cycle_id).toBeTruthy();
    expect(ci.milestone_id).toBeTruthy();
    expect(issues[2].parent_id).toBeTruthy();
    const st = await listStatuses(projectId);
    expect(st.find((s) => s.name === 'In Review')?.category).toBe('in_progress');
    expect(st.find((s) => s.id === issues[0].status_id)?.category).toBe('cancelled');

    // Reimportar: todo saltea, nada se duplica.
    const again = await trackJob(u.id, 'linear_csv', { target: 'new', mapping }, { payload: csv });
    const prev2 = (await runImportJob(again.id))!;
    expect((prev2.preview as { alreadyImported: number }).alreadyImported).toBe(3);
    await startImportJob((await getImportJob(again.id))!);
    const done2 = await runToEnd(again.id);
    expect(done2.report).toMatchObject({ issues: 0, skipped: 3, projectsCreated: 0 });
    const count = (await getDb().prepare('SELECT COUNT(*) AS n FROM track_issues WHERE project_id = ?').get(projectId)) as { n: number };
    expect(Number(count.n)).toBe(3);

    // Export de vuelta a CSV.
    const out = parseCsv(await exportIssuesCsv(null, u.id, projectId));
    expect(out[0]).toContain('Title');
    expect(out.slice(1).map((row) => row[1])).toEqual(['Old bug', 'Set up CI', 'Write docs']);
    expect(out[2][5]).toBe(u.email);
  });

  it('a un proyecto existente: status por nombre y sin crear proyectos', async () => {
    const u = await makeUser('timp2');
    const project = await createProject(u.id, null, { name: 'Web' });
    const csv = 'Name,State\nFirst,Done\nSecond,Blocked\n';
    const mapping = { title: 'Name', status: 'State' };
    const job = await trackJob(u.id, 'csv', { target: project.id, mapping }, { payload: csv });
    const prev = (await runImportJob(job.id))!;
    expect((prev.preview as { projects: unknown[] }).projects).toEqual([{ name: 'Web', issues: 2, existing: 'Web' }]);
    await startImportJob((await getImportJob(job.id))!);
    const done = await runToEnd(job.id);
    expect(done.report).toMatchObject({ issues: 2, projectsCreated: 0, statusesCreated: 1 });
    const st = await listStatuses(project.id);
    expect(st.filter((s) => s.name === 'Done')).toHaveLength(1);
    expect(st.find((s) => s.name === 'Blocked')?.category).toBe('todo');
  });

  it('Linear por API: pagina, cuelga comentarios y borra el token antes de la vista previa', async () => {
    const u = await makeUser('tlin');
    const node = (n: number, extra: Record<string, unknown> = {}) => ({
      id: `uuid-${n}`,
      identifier: `APP-${n}`,
      title: `Issue ${n}`,
      description: 'desc',
      priority: 2,
      estimate: 2,
      createdAt: `2024-03-0${n}T00:00:00.000Z`,
      dueDate: null,
      state: { name: 'Started', type: 'started', color: '#f2c94c' },
      team: { key: 'APP', name: 'App' },
      project: null,
      cycle: { number: 7, name: null, startsAt: '2024-03-01T00:00:00.000Z', endsAt: '2024-03-14T00:00:00.000Z' },
      assignee: { email: u.email.toUpperCase(), name: 'X' },
      parent: null,
      labels: { nodes: [{ name: 'Bug', color: '#eb5757' }] },
      comments: { nodes: [{ id: `c${n}`, body: 'hello', createdAt: '2024-03-05T00:00:00.000Z', user: { email: 'stranger@x.test', name: 'Stranger' } }] },
      ...extra,
    });
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(String((init.headers as Record<string, string>).authorization));
        const after = JSON.parse(String(init.body)).variables.after;
        const page = after
          ? { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node(2, { parent: { identifier: 'APP-1' } })] }
          : { pageInfo: { hasNextPage: true, endCursor: 'cur1' }, nodes: [node(1)] };
        return new Response(JSON.stringify({ data: { issues: page } }), { status: 200 });
      }),
    );
    const job = await trackJob(u.id, 'linear', { target: 'new' }, { secret: 'lin_api_testtoken' });
    expect((await getImportJobRow(job.id))?.secret).toMatch(/^enc:v1:/);
    const prev = (await runImportJob(job.id))!;
    expect(prev.status).toBe('preview');
    expect(calls).toEqual(['lin_api_testtoken', 'lin_api_testtoken']);
    expect((await getImportJobRow(job.id))?.secret).toBeNull();
    expect(prev.preview).toMatchObject({ issues: 2, comments: 2, cycles: 1 });

    await startImportJob((await getImportJob(job.id))!);
    const done = await runToEnd(job.id);
    expect(done.report).toMatchObject({ issues: 2, comments: 2, parents: 1, cyclesCreated: 1 });
    const comments = (await getDb()
      .prepare(
        `SELECT c.body, c.user_id FROM track_issue_comments c JOIN track_issues i ON i.id = c.issue_id
         JOIN track_projects p ON p.id = i.project_id WHERE p.owner_id = ?`,
      )
      .all(u.id)) as Array<{ body: string; user_id: string }>;
    expect(comments[0].body).toBe('**Stranger**\n\nhello');
    expect(comments[0].user_id).toBe(u.id);
  });

  it('Linear con token inválido: falla con unauthorized y borra el token', async () => {
    const u = await makeUser('tlin2');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: 'Authentication required', extensions: { code: 'AUTHENTICATION_ERROR' } }] }), { status: 400 })),
    );
    const job = await trackJob(u.id, 'linear', { target: 'new' }, { secret: 'lin_api_bad_token' });
    const view = (await runImportJob(job.id))!;
    expect(view).toMatchObject({ status: 'failed', error: 'unauthorized' });
    expect((await getImportJobRow(job.id))?.secret).toBeNull();
  });

  it('GitHub: sin PRs, milestones, labels con color y comentarios del repo', async () => {
    const u = await makeUser('tgh');
    const routes: Record<string, unknown> = {
      '/repos/acme/web': { full_name: 'acme/web' },
      '/repos/acme/web/issues?state=all&per_page=100&page=1&sort=created&direction=asc': [
        {
          number: 1,
          title: 'Crash on save',
          body: 'Steps',
          state: 'closed',
          state_reason: 'completed',
          created_at: '2024-01-01T00:00:00Z',
          labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'priority: urgent', color: '000000' }],
          assignee: { login: u.email.split('@')[0] },
          milestone: { number: 3, title: 'v1.0', due_on: '2024-02-01T08:00:00Z' },
        },
        { number: 2, title: 'A PR', state: 'open', created_at: '2024-01-02T00:00:00Z', pull_request: {} },
        { number: 3, title: 'Not planned', state: 'closed', state_reason: 'not_planned', created_at: '2024-01-03T00:00:00Z' },
      ],
      '/repos/acme/web/issues/comments?per_page=100&page=1&sort=created&direction=asc': [
        { id: 11, body: 'Fixed in main', created_at: '2024-01-05T00:00:00Z', issue_url: 'https://api.github.com/repos/acme/web/issues/1', user: { login: 'octo' } },
        { id: 12, body: 'PR comment', created_at: '2024-01-05T00:00:00Z', issue_url: 'https://api.github.com/repos/acme/web/issues/2', user: { login: 'octo' } },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        expect((init.headers as Record<string, string>).authorization).toBe('Bearer ghp_testtoken123');
        const body = routes[String(url).replace('https://api.github.com', '')];
        return new Response(JSON.stringify(body ?? { message: 'Not Found' }), { status: body ? 200 : 404 });
      }),
    );
    const job = await trackJob(u.id, 'github', { target: 'new', repo: 'acme/web' }, { secret: 'ghp_testtoken123' });
    const prev = (await runImportJob(job.id))!;
    expect(prev.preview).toMatchObject({ issues: 2, comments: 2, milestones: 1 });
    await startImportJob((await getImportJob(job.id))!);
    const done = await runToEnd(job.id);
    expect(done.report).toMatchObject({ issues: 2, comments: 1, milestonesCreated: 1, unassigned: 0 });
    const rows = (await getDb()
      .prepare(
        `SELECT i.title, i.priority, i.assignee_id, s.category FROM track_issues i JOIN track_statuses s ON s.id = i.status_id
         JOIN track_projects p ON p.id = i.project_id WHERE p.owner_id = ? ORDER BY i.created_at`,
      )
      .all(u.id)) as Array<{ title: string; priority: string; assignee_id: string | null; category: string }>;
    expect(rows).toEqual([
      { title: 'Crash on save', priority: 'urgent', assignee_id: u.id, category: 'done' },
      { title: 'Not planned', priority: 'medium', assignee_id: null, category: 'cancelled' },
    ]);
  });

  it('cancelar borra el token y los items', async () => {
    const u = await makeUser('tcancel');
    const job = await trackJob(u.id, 'linear', { target: 'new' }, { secret: 'lin_api_whatever' });
    await cancelImportJob((await getImportJob(job.id))!);
    const row = await getImportJobRow(job.id);
    expect(row).toMatchObject({ status: 'cancelled', secret: null });
  });

  it('429 de la fuente: reintenta después sin fallar', async () => {
    const u = await makeUser('tretry');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '120' } })));
    const job = await trackJob(u.id, 'github', { target: 'new', repo: 'acme/web' }, { secret: 'ghp_testtoken123' });
    const view = (await runImportJob(job.id))!;
    expect(view.status).toBe('fetching');
    const row = await getImportJobRow(job.id);
    expect(new Date(row!.locked_until!).getTime()).toBeGreaterThan(Date.now() + 60_000);
    expect(row!.secret).toMatch(/^enc:v1:/);
  });
});
