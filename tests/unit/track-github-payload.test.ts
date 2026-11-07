import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createIssue, createProject, getIssue } from '@/lib/track-data';
import { signGithubPayload } from '@/lib/track-github';
import { makeUser } from './helpers';

/**
 * GitHub con un payload real: la forma de un `pull_request` tal como lo
 * manda GitHub (docs.github.com/webhooks/webhook-events-and-payloads#pull_request),
 * con todos los campos que no usamos, y un branch con el formato que arma
 * Linear (usuario/eng-12-titulo), que es el que trae un equipo que se muda.
 */

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const configRoute = await import('@/app/api/track/github/route');
const webhookRoute = await import('@/lib/routes/track/github/webhook/[hookId]/route');

function githubPrPayload(action: string, o: { number: number; branch: string; title: string; body: string; merged?: boolean; draft?: boolean }) {
  const repo = {
    id: 1296269,
    node_id: 'MDEwOlJlcG9zaXRvcnkxMjk2MjY5',
    name: 'web',
    full_name: 'acme/web',
    private: true,
    owner: { login: 'acme', id: 1, type: 'Organization', site_admin: false },
    html_url: 'https://github.com/acme/web',
    default_branch: 'main',
  };
  const merged = o.merged ?? false;
  return {
    action,
    number: o.number,
    pull_request: {
      url: `https://api.github.com/repos/acme/web/pulls/${o.number}`,
      id: 1,
      node_id: 'MDExOlB1bGxSZXF1ZXN0MQ==',
      html_url: `https://github.com/acme/web/pull/${o.number}`,
      diff_url: `https://github.com/acme/web/pull/${o.number}.diff`,
      number: o.number,
      state: action === 'closed' ? 'closed' : 'open',
      locked: false,
      title: o.title,
      user: { login: 'octocat', id: 583231, type: 'User', site_admin: false },
      body: o.body,
      created_at: '2026-11-01T12:00:00Z',
      updated_at: '2026-11-01T12:05:00Z',
      closed_at: action === 'closed' ? '2026-11-02T09:00:00Z' : null,
      merged_at: merged ? '2026-11-02T09:00:00Z' : null,
      merge_commit_sha: merged ? 'e5bd3914e2e596debea16f433f57875b5b90bcd6' : null,
      assignee: null,
      assignees: [],
      requested_reviewers: [],
      labels: [],
      milestone: null,
      draft: o.draft ?? false,
      head: { label: `acme:${o.branch}`, ref: o.branch, sha: '6dcb09b5b57875f334f61aebed695e2e4193db5e', user: { login: 'acme' }, repo },
      base: { label: 'acme:main', ref: 'main', sha: '9049f1265b7d61be4a8904a9a27120d2064dab3b', user: { login: 'acme' }, repo },
      author_association: 'MEMBER',
      auto_merge: null,
      merged,
      mergeable: null,
      comments: 0,
      review_comments: 0,
      commits: 1,
      additions: 10,
      deletions: 2,
      changed_files: 1,
    },
    repository: repo,
    organization: { login: 'acme', id: 1 },
    sender: { login: 'octocat', id: 583231, type: 'User', site_admin: false },
  };
}

function deliver(hookId: string, secret: string, payload: unknown) {
  const raw = JSON.stringify(payload);
  const req = new NextRequest(`http://x/api/track/github/webhook/${hookId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'GitHub-Hookshot/abc123',
      'x-github-event': 'pull_request',
      'x-github-delivery': crypto.randomUUID(),
      'x-github-hook-id': '292430182',
      'x-hub-signature': 'sha1=ignored',
      'x-hub-signature-256': signGithubPayload(secret, raw),
    },
    body: raw,
  }) as never;
  return webhookRoute.POST(req, { params: Promise.resolve({ hookId }) });
}

describe('Track GitHub: payload real de pull_request', () => {
  it('un branch de Linear (usuario/eng-12-…) mueve el issue a en progreso al abrir y a hecho al mergear', async () => {
    const u = await makeUser('ghreal');
    const team = await createProject(u.id, null, { name: 'Web', slug: `eng${Math.random().toString(36).slice(2, 6)}` });
    const issue = await createIssue(team.id, u.id, { title: 'Fix login', description: [] }, { source: 'app' });
    const branch = `octocat/${issue.identifier.toLowerCase()}-fix-login`;

    session.user = { ...u, team: null, role: 'owner' };
    const conf = (await (await configRoute.PUT(new NextRequest('http://x/api/track/github', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repos: ['acme/web'] }),
    }) as never)).json()) as { secret: string; config: { id: string } };

    const opened = await deliver(conf.config.id, conf.secret, githubPrPayload('opened', { number: 7, branch, title: 'Fix login on Safari', body: 'Small fix.' }));
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual({ linked: 1, moved: 1 });
    expect((await getIssue(issue.id))?.status_category).toBe('in_progress');

    const merged = await deliver(conf.config.id, conf.secret, githubPrPayload('closed', { number: 7, branch, title: 'Fix login on Safari', body: 'Small fix.', merged: true }));
    expect(await merged.json()).toEqual({ linked: 1, moved: 1 });
    expect((await getIssue(issue.id))?.status_category).toBe('done');
  });
});
