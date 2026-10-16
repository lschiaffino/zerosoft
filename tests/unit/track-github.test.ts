import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createIssue, createProject, getIssue, listStatuses } from '@/lib/track-data';
import {
  branchNameFor,
  getGithubConfig,
  parseIssueIdentifiers,
  plannedCategory,
  signGithubPayload,
  verifyGithubSignature,
} from '@/lib/track-github';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const configRoute = await import('@/app/api/track/github/route');
const webhookRoute = await import('@/app/api/track/github/webhook/[hookId]/route');
const issueGithubRoute = await import('@/app/api/track/issues/[id]/github/route');

const put = (body: unknown) =>
  new NextRequest('http://x/api/track/github', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;

function delivery(hookId: string, event: string, payload: unknown, secret: string, sigOverride?: string) {
  const raw = JSON.stringify(payload);
  const req = new NextRequest(`http://x/api/track/github/webhook/${hookId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-hub-signature-256': sigOverride ?? signGithubPayload(secret, raw),
    },
    body: raw,
  }) as never;
  return webhookRoute.POST(req, { params: Promise.resolve({ hookId }) });
}

describe('Track GitHub: helpers puros', () => {
  it('verifica la firma HMAC sha256', () => {
    const body = '{"a":1}';
    const sig = signGithubPayload('s3cret-s3cret-s3cret', body);
    expect(verifyGithubSignature('s3cret-s3cret-s3cret', body, sig)).toBe(true);
    expect(verifyGithubSignature('otro-secreto-otro-secreto', body, sig)).toBe(false);
    expect(verifyGithubSignature('s3cret-s3cret-s3cret', body + ' ', sig)).toBe(false);
    expect(verifyGithubSignature('s3cret-s3cret-s3cret', body, null)).toBe(false);
    expect(verifyGithubSignature('s3cret-s3cret-s3cret', body, 'sha1=abc')).toBe(false);
    expect(verifyGithubSignature('s3cret-s3cret-s3cret', body, 'sha256=zz')).toBe(false);
    expect(verifyGithubSignature('', body, sig)).toBe(false);
  });

  it('encuentra identificadores en branch, título y cuerpo', () => {
    const prefixes = ['ZER', 'MI-PROYECTO'];
    expect(parseIssueIdentifiers('zer-123-arreglar-login', prefixes)).toEqual(['ZER-123']);
    expect(parseIssueIdentifiers('Fix ZER-7 and zer-8', prefixes)).toEqual(['ZER-7', 'ZER-8']);
    expect(parseIssueIdentifiers('Closes MI-PROYECTO-12', prefixes)).toEqual(['MI-PROYECTO-12']);
    expect(parseIssueIdentifiers('feature/ZER-0012', prefixes)).toEqual(['ZER-12']);
    // No matchea dentro de otras palabras ni sin número.
    expect(parseIssueIdentifiers('BIZER-12 ZER- ZERO-1 ZER-12a3', prefixes)).toEqual([]);
    // Sin repetir y en orden de aparición.
    expect(parseIssueIdentifiers('ZER-2 ZER-1 ZER-2', prefixes)).toEqual(['ZER-2', 'ZER-1']);
    expect(parseIssueIdentifiers('ZER-1', [])).toEqual([]);
  });

  it('con prefijos que se pisan gana el más largo', () => {
    expect(parseIssueIdentifiers('APP-WEB-5', ['APP', 'APP-WEB'])).toEqual(['APP-WEB-5']);
    expect(parseIssueIdentifiers('APP-5', ['APP', 'APP-WEB'])).toEqual(['APP-5']);
  });

  it('arma el nombre de branch', () => {
    expect(branchNameFor('ZER-123', 'Arreglar el login (móvil)')).toBe('zer-123-arreglar-el-login-movil');
    expect(branchNameFor('ZER-1', '')).toBe('zer-1');
  });

  it('transiciones: nunca retrocede', () => {
    const on = { onPrOpen: 'in_progress', onPrMerge: 'done' } as const;
    expect(plannedCategory('todo', 'pr_opened', on)).toBe('in_progress');
    expect(plannedCategory('backlog', 'pr_opened', on)).toBe('in_progress');
    expect(plannedCategory(null, 'pr_opened', on)).toBe('in_progress');
    expect(plannedCategory('in_progress', 'pr_opened', on)).toBeNull();
    expect(plannedCategory('done', 'pr_opened', on)).toBeNull();
    expect(plannedCategory('in_progress', 'pr_merged', on)).toBe('done');
    expect(plannedCategory('cancelled', 'pr_merged', on)).toBeNull();
    expect(plannedCategory('todo', 'pr_closed', on)).toBeNull();
    expect(plannedCategory('todo', 'pr_updated', on)).toBeNull();
    const off = { onPrOpen: 'none', onPrMerge: 'none' } as const;
    expect(plannedCategory('todo', 'pr_opened', off)).toBeNull();
    expect(plannedCategory('todo', 'pr_merged', off)).toBeNull();
  });
});

describe('Track GitHub: config y webhook', () => {
  it('config: auth, admin, validación y aislamiento por workspace', async () => {
    const a = await makeUser('gha');
    const b = await makeUser('ghb');

    session.user = null;
    expect((await configRoute.GET()).status).toBe(401);

    session.user = { ...a, team: null, role: 'member' };
    expect((await configRoute.PUT(put({ repos: ['acme/web'] }))).status).toBe(403);

    session.user = { ...a, team: null, role: 'owner' };
    expect((await configRoute.PUT(put({ repos: ['no valid'] }))).status).toBe(400);
    expect((await configRoute.PUT(put({ repos: [] }))).status).toBe(400);
    const res = await configRoute.PUT(put({ repos: ['acme/web'] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { secret: string; config: { id: string } };
    expect(body.secret).toMatch(/^[0-9a-f]{48}$/);

    // El secreto se guarda cifrado.
    const row = (await getDb().prepare('SELECT secret FROM track_github WHERE id = ?').get(body.config.id)) as {
      secret: string;
    };
    expect(row.secret.startsWith('enc:v1:')).toBe(true);

    // Editar sin regenerar no devuelve secreto.
    const again = (await (await configRoute.PUT(put({ repos: ['acme/web', 'acme/api'] }))).json()) as {
      secret: string | null;
    };
    expect(again.secret).toBeNull();

    session.user = { ...b, team: null, role: 'owner' };
    const other = (await (await configRoute.GET()).json()) as { config: unknown };
    expect(other.config).toBeNull();
    expect(await getGithubConfig(a.id)).not.toBeNull();
  });

  it('webhook: firma, repos, vínculos y transiciones', async () => {
    const a = await makeUser('ghw');
    const b = await makeUser('ghw2');
    const project = await createProject(a.id, null, { name: 'Web', slug: `ghw-${crypto.randomUUID().slice(0, 6)}` });
    const prefix = project.slug.toUpperCase();
    const issue = await createIssue(project.id, a.id, { title: 'Login roto', description: [] }, { source: 'app' });
    const other = await createIssue(project.id, a.id, { title: 'Otro', description: [] }, { source: 'app' });
    // Un issue de otro workspace con el mismo número no se toca.
    const pb = await createProject(b.id, null, { name: 'Ajeno', slug: `ajeno-${crypto.randomUUID().slice(0, 6)}` });
    const foreign = await createIssue(pb.id, b.id, { title: 'Ajeno', description: [] }, { source: 'app' });

    session.user = { ...a, team: null, role: 'owner' };
    const conf = (await (await configRoute.PUT(put({ repos: ['acme/web'] }))).json()) as {
      secret: string;
      config: { id: string };
    };
    const hook = conf.config.id;
    const secret = conf.secret;

    expect((await delivery('nope', 'ping', {}, secret)).status).toBe(404);
    expect((await delivery(hook, 'ping', {}, secret, 'sha256=' + '0'.repeat(64))).status).toBe(401);
    expect((await delivery(hook, 'ping', {}, 'wrong-secret-wrong')).status).toBe(401);
    expect((await delivery(hook, 'ping', {}, secret)).status).toBe(200);

    const pr = (action: string, extra: Record<string, unknown> = {}, repo = 'acme/web') => ({
      action,
      repository: { full_name: repo },
      pull_request: {
        number: 42,
        html_url: 'https://github.com/acme/web/pull/42',
        title: `Arreglo login ${foreign.identifier}`,
        body: `Cierra ${other.identifier.toLowerCase()}`,
        head: { ref: `${issue.identifier.toLowerCase()}-login` },
        user: { login: 'octo' },
        author_association: 'MEMBER',
        merged: false,
        ...extra,
      },
    });

    // Repo no listado: se ignora.
    const ignored = await delivery(hook, 'pull_request', pr('opened', {}, 'acme/otro'), secret);
    expect(ignored.status).toBe(202);

    const opened = await delivery(hook, 'pull_request', pr('opened'), secret);
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual({ linked: 2, moved: 2 });
    expect((await getIssue(issue.id))?.status_category).toBe('in_progress');
    expect((await getIssue(foreign.id))?.status_category).not.toBe('in_progress');

    // Re-entregar "opened" no duplica el vínculo ni mueve de nuevo.
    expect(await (await delivery(hook, 'pull_request', pr('reopened'), secret)).json()).toEqual({ linked: 2, moved: 0 });

    const merged = await delivery(hook, 'pull_request', pr('closed', { merged: true }), secret);
    expect(await merged.json()).toEqual({ linked: 2, moved: 2 });
    expect((await getIssue(issue.id))?.status_category).toBe('done');

    // Commits por push: branch + mensaje.
    const push = await delivery(
      hook,
      'push',
      {
        ref: `refs/heads/${issue.identifier.toLowerCase()}-login`,
        repository: { full_name: 'acme/web' },
        commits: [
          { id: 'abc123', message: 'Arreglo\n\nmás detalle', url: 'https://github.com/acme/web/commit/abc123', author: { username: 'octo' } },
        ],
      },
      secret,
    );
    expect(await push.json()).toEqual({ linked: 1 });

    const links = await issueGithubRoute.GET(new NextRequest('http://x') as never, {
      params: Promise.resolve({ id: issue.id }),
    });
    const data = (await links.json()) as { branchName: string; rows: Array<{ kind: string; state: string; title: string }> };
    expect(data.branchName).toBe(`${prefix.toLowerCase()}-1-login-roto`);
    expect(data.rows.map((r) => [r.kind, r.state])).toEqual([
      ['pr', 'merged'],
      ['commit', 'pushed'],
    ]);
    expect(data.rows[1].title).toBe('Arreglo');

    // Aislamiento: otro workspace no ve los vínculos.
    session.user = { ...b, team: null, role: 'owner' };
    const hidden = await issueGithubRoute.GET(new NextRequest('http://x') as never, {
      params: Promise.resolve({ id: issue.id }),
    });
    expect(hidden.status).toBe(404);

    // Con transiciones apagadas no mueve.
    session.user = { ...a, team: null, role: 'owner' };
    await configRoute.PUT(put({ repos: ['acme/web'], onPrOpen: 'none', onPrMerge: 'none' }));
    const fresh = await createIssue(project.id, a.id, { title: 'Nuevo', description: [] }, { source: 'app' });
    const statusesBefore = (await getIssue(fresh.id))?.status_id;
    await delivery(hook, 'pull_request', { ...pr('opened'), pull_request: { ...pr('opened').pull_request, number: 43, head: { ref: fresh.identifier }, title: 'x', body: '' } }, secret);
    expect((await getIssue(fresh.id))?.status_id).toBe(statusesBefore);
    expect((await listStatuses(project.id)).length).toBeGreaterThan(0);
  });

  it('webhook: menciones sin palabra clave no cambian status y edited no reabre un PR mergeado', async () => {
    const a = await makeUser('ghm');
    const project = await createProject(a.id, null, { name: 'Api', slug: `ghm-${crypto.randomUUID().slice(0, 6)}` });
    const main = await createIssue(project.id, a.id, { title: 'Principal', description: [] }, { source: 'app' });
    const blocker = await createIssue(project.id, a.id, { title: 'Bloqueante', description: [] }, { source: 'app' });
    const before = (await getIssue(blocker.id))?.status_id;

    session.user = { ...a, team: null, role: 'owner' };
    const conf = (await (await configRoute.PUT(put({ repos: ['acme/api'] }))).json()) as {
      secret: string;
      config: { id: string };
    };
    const pr = (action: string, extra: Record<string, unknown> = {}) => ({
      action,
      repository: { full_name: 'acme/api' },
      pull_request: {
        number: 7,
        html_url: 'https://github.com/acme/api/pull/7',
        title: 'Arreglo',
        body: `Bloqueado por ${blocker.identifier}`,
        head: { ref: main.identifier.toLowerCase() },
        merged: false,
        state: 'open',
        ...extra,
      },
    });

    const merged = await delivery(conf.config.id, 'pull_request', pr('closed', { merged: true, state: 'closed' }), conf.secret);
    expect(await merged.json()).toEqual({ linked: 2, moved: 1 });
    expect((await getIssue(main.id))?.status_category).toBe('done');
    expect((await getIssue(blocker.id))?.status_id).toBe(before);

    await delivery(conf.config.id, 'pull_request', pr('edited', { merged: true, state: 'closed' }), conf.secret);
    await delivery(conf.config.id, 'pull_request', pr('labeled', { merged: true, state: 'closed' }), conf.secret);
    const links = (await (
      await issueGithubRoute.GET(new NextRequest('http://x') as never, { params: Promise.resolve({ id: main.id }) })
    ).json()) as { rows: Array<{ state: string }> };
    expect(links.rows.map((r) => r.state)).toEqual(['merged']);
  });

  it('webhook: un PR de alguien sin acceso (fork) no mueve issues ni vincula menciones sueltas', async () => {
    const a = await makeUser('ghf');
    const project = await createProject(a.id, null, { name: 'Pub', slug: `ghf-${crypto.randomUUID().slice(0, 6)}` });
    const issues: Awaited<ReturnType<typeof createIssue>>[] = [];
    for (let i = 0; i < 12; i++) {
      issues.push(await createIssue(project.id, a.id, { title: `I${i}`, description: [] }, { source: 'app' }));
    }
    const before = await Promise.all(issues.map(async (i) => (await getIssue(i.id))?.status_id));

    session.user = { ...a, team: null, role: 'owner' };
    const conf = (await (await configRoute.PUT(put({ repos: ['acme/pub'] }))).json()) as {
      secret: string;
      config: { id: string };
    };
    const pr = (action: string, association: string, extra: Record<string, unknown> = {}) => ({
      action,
      repository: { full_name: 'acme/pub' },
      pull_request: {
        number: 9,
        html_url: 'https://github.com/acme/pub/pull/9',
        title: 'Spam',
        body: `fixes ${issues.map((i) => i.identifier).join(', ')}\nver ${issues[0].identifier}`,
        head: { ref: 'patch-1', repo: { fork: true } },
        user: { login: 'extraño' },
        author_association: association,
        merged: false,
        state: 'open',
        ...extra,
      },
    });

    // Contributor externo: no mueve nada; vincula solo hasta el tope de movibles.
    const opened = await delivery(conf.config.id, 'pull_request', pr('opened', 'NONE'), conf.secret);
    expect(await opened.json()).toEqual({ linked: 10, moved: 0 });
    for (let i = 0; i < issues.length; i++) {
      expect((await getIssue(issues[i].id))?.status_id).toBe(before[i]);
    }

    // Un miembro sí mueve, pero con tope por entrega.
    const member = await delivery(conf.config.id, 'pull_request', pr('opened', 'MEMBER', { number: 10 }), conf.secret);
    expect(await member.json()).toEqual({ linked: 12, moved: 10 });
    expect((await getIssue(issues[11].id))?.status_id).toBe(before[11]);

    // Si alguien con acceso mergea el PR externo, ahí sí cuenta.
    const merged = await delivery(
      conf.config.id,
      'pull_request',
      pr('closed', 'NONE', { merged: true, state: 'closed' }),
      conf.secret,
    );
    expect(await merged.json()).toEqual({ linked: 12, moved: 10 });
    expect((await getIssue(issues[0].id))?.status_category).toBe('done');
  });

  it('webhook push: vincula commits de varios issues con una sola búsqueda', async () => {
    const a = await makeUser('ghp');
    const project = await createProject(a.id, null, { name: 'Push', slug: `ghp-${crypto.randomUUID().slice(0, 6)}` });
    const one = await createIssue(project.id, a.id, { title: 'Uno', description: [] }, { source: 'app' });
    const two = await createIssue(project.id, a.id, { title: 'Dos', description: [] }, { source: 'app' });
    session.user = { ...a, team: null, role: 'owner' };
    const conf = (await (await configRoute.PUT(put({ repos: ['acme/push'] }))).json()) as {
      secret: string;
      config: { id: string };
    };
    const commit = (id: string, message: string) => ({
      id,
      message,
      url: `https://github.com/acme/push/commit/${id}`,
      author: { username: 'octo' },
    });
    const res = await delivery(
      conf.config.id,
      'push',
      {
        ref: `refs/heads/${one.identifier.toLowerCase()}-x`,
        repository: { full_name: 'acme/push' },
        commits: [commit('c1', 'a'), commit('c2', `toca ${two.identifier.toLowerCase()}`), { id: 'c3' }],
      },
      conf.secret,
    );
    // c1 → one; c2 → one + two; c3 sin url se ignora.
    expect(await res.json()).toEqual({ linked: 3 });
  });
});
