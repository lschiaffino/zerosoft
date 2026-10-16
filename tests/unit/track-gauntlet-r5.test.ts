import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createIssue,
  createIssueAttachment,
  createProject,
  deleteIssue,
  deleteIssueAttachment,
  deleteProject,
  getIssue,
  listAllIssues,
  listStatuses,
  updateIssue,
  updateProject,
} from '@/lib/track-data';
import { signGithubPayload } from '@/lib/track-github';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const blob = vi.hoisted(() => ({ deleted: [] as string[] }));
vi.mock('@vercel/blob', () => ({
  put: async () => ({ url: 'https://blob.test/x' }),
  del: async (urls: string | string[]) => {
    blob.deleted.push(...(Array.isArray(urls) ? urls : [urls]));
  },
}));

const configRoute = await import('@/app/api/track/github/route');
const webhookRoute = await import('@/app/api/track/github/webhook/[hookId]/route');
const issueRoute = await import('@/app/api/track/issues/[id]/route');
const allIssuesRoute = await import('@/app/api/track/issues/route');

const json = (method: string, body?: unknown, url = 'http://x/api') =>
  new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const app = { source: 'app' as const };
const uid = () => crypto.randomUUID().slice(0, 6);

function delivery(hookId: string, event: string, payload: unknown, secret: string) {
  const raw = JSON.stringify(payload);
  const req = new NextRequest(`http://x/api/track/github/webhook/${hookId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-hub-signature-256': signGithubPayload(secret, raw),
    },
    body: raw,
  }) as never;
  return webhookRoute.POST(req, { params: Promise.resolve({ hookId }) });
}

afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

describe('Track gauntlet r5: webhook fuera de orden', () => {
  it('una entrega atrasada no baja un vínculo mergeado ni un merge reenviado vuelve a cerrar el issue', async () => {
    const a = await makeUser('r5gh');
    const project = await createProject(a.id, null, { name: 'Gh r5', slug: `r5g${uid()}` });
    const issue = await createIssue(project.id, a.id, { title: 'Arreglo', description: [] }, app);
    session.user = { ...a, team: null, role: 'owner' };
    const repo = `acme/r5-${uid()}`;
    const conf = (await (await configRoute.PUT(json('PUT', { repos: [repo] }))).json()) as {
      secret: string;
      config: { id: string };
    };
    const pr = (action: string, extra: Record<string, unknown> = {}) => ({
      action,
      repository: { full_name: repo },
      pull_request: {
        number: 45,
        html_url: `https://github.com/${repo}/pull/45`,
        title: 'Arreglo',
        body: '',
        head: { ref: issue.identifier.toLowerCase() },
        merged: false,
        state: 'open',
        ...extra,
      },
    });
    const merge = pr('closed', { merged: true, state: 'closed' });

    expect(await (await delivery(conf.config.id, 'pull_request', merge, conf.secret)).json()).toEqual({
      linked: 1,
      moved: 1,
    });
    expect((await getIssue(issue.id))?.status_category).toBe('done');

    // synchronize procesado después del merge: el vínculo sigue 'merged'.
    await delivery(conf.config.id, 'pull_request', pr('synchronize'), conf.secret);
    const { listIssueLinks } = await import('@/lib/track-github');
    expect((await listIssueLinks(issue.id)).map((l) => l.state)).toEqual(['merged']);

    // Alguien reabre a mano y un admin reenvía la entrega del merge.
    const todo = (await listStatuses(project.id)).find((s) => s.category === 'todo')!;
    await updateIssue(issue.id, { statusId: todo.id }, a.id);
    expect(await (await delivery(conf.config.id, 'pull_request', merge, conf.secret)).json()).toEqual({
      linked: 1,
      moved: 0,
    });
    expect((await getIssue(issue.id))?.status_id).toBe(todo.id);
  });
});

describe('Track gauntlet r5: triage desde el detalle', () => {
  it('asignar o mover un issue en triage lo acepta y aparece en las listas', async () => {
    const a = await makeUser('r5tr');
    const p = await createProject(a.id, null, { name: 'Triage r5' });
    await updateProject(p.id, { triageEnabled: true });
    const issue = await createIssue(p.id, a.id, { title: 'del agente', description: [] }, { source: 'chat' });
    expect(issue.triage).toBe(1);
    session.user = { ...a, team: null, role: 'owner' };

    // Cambiar el título no lo acepta.
    await issueRoute.PATCH(json('PATCH', { title: 'del agente (editado)' }), params(issue.id));
    expect((await getIssue(issue.id))?.triage).toBe(1);

    const res = await issueRoute.PATCH(json('PATCH', { assigneeId: a.id }), params(issue.id));
    expect(res.status).toBe(200);
    expect((await getIssue(issue.id))?.triage).toBe(0);
    const { rows } = await listAllIssues(null, a.id, { projectId: p.id });
    expect(rows.map((r) => r.id)).toContain(issue.id);
  });
});

describe('Track gauntlet r5: página Issues', () => {
  it('no incluye issues de proyectos archivados y el endpoint pagina con total', async () => {
    const a = await makeUser('r5al');
    const live = await createProject(a.id, null, { name: 'Vivo r5' });
    const old = await createProject(a.id, null, { name: 'Viejo r5' });
    for (let i = 0; i < 3; i++) await createIssue(live.id, a.id, { title: `vivo ${i}`, description: [] }, app);
    const hidden = await createIssue(old.id, a.id, { title: 'archivado', description: [] }, app);
    await updateProject(old.id, { status: 'archived' });

    const all = await listAllIssues(null, a.id, { pageSize: 100 });
    expect(all.rows.map((r) => r.id)).not.toContain(hidden.id);
    expect(all.total).toBe(3);

    session.user = { ...a, team: null, role: 'owner' };
    const res = await allIssuesRoute.GET(
      new NextRequest('http://x/api/track/issues?page=2&pageSize=2') as never,
    );
    const body = (await res.json()) as { rows: unknown[]; total: number; page: number };
    expect([body.rows.length, body.total, body.page]).toEqual([1, 3, 2]);
  });
});

describe('Track gauntlet r5: adjuntos', () => {
  it('borrar el adjunto, el issue o el proyecto borra también el blob', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'test';
    blob.deleted.length = 0;
    const a = await makeUser('r5at');
    const p = await createProject(a.id, null, { name: 'Adjuntos r5' });
    const issue = await createIssue(p.id, a.id, { title: 'con archivos', description: [] }, app);
    const child = await createIssue(p.id, a.id, { title: 'sub', description: [], parentId: issue.id }, app);
    const file = (url: string) => ({ filename: 'x.csv', contentType: 'text/csv', size: 1, url });

    const one = await createIssueAttachment(issue.id, a.id, file('https://blob.test/one'));
    expect(await deleteIssueAttachment(one.id, issue.id)).toBe(true);
    expect(blob.deleted).toEqual(['https://blob.test/one']);

    await createIssueAttachment(child.id, a.id, file('https://blob.test/child'));
    await deleteIssue(issue.id);
    expect(blob.deleted).toContain('https://blob.test/child');

    const other = await createIssue(p.id, a.id, { title: 'otro', description: [] }, app);
    await createIssueAttachment(other.id, a.id, file('https://blob.test/project'));
    await deleteProject(p.id);
    expect(blob.deleted).toContain('https://blob.test/project');
  });
});

describe('Track gauntlet r5: identificadores', () => {
  it('numera por prefijo exacto: un slug que empieza igual no corre la numeración', async () => {
    const a = await makeUser('r5ida');
    const slug = `r5i${uid()}`;
    const pa = await createProject(a.id, null, { name: 'A', slug });
    const pb = await createProject(a.id, null, { name: 'B', slug: `${slug}-core` });
    for (let i = 0; i < 3; i++) await createIssue(pb.id, a.id, { title: `${i}`, description: [] }, app);
    const first = await createIssue(pa.id, a.id, { title: '1', description: [] }, app);
    const second = await createIssue(pa.id, a.id, { title: '2', description: [] }, app);
    expect([first.identifier, second.identifier]).toEqual([`${slug.toUpperCase()}-1`, `${slug.toUpperCase()}-2`]);
  });
});
