/**
 * Fleet: GitHub y Vercel de mentira (FLEET_FAKE=1, token "fake…"). Devuelve las mismas formas que las APIs reales,
 * así los parsers de verdad se ejercitan en los e2e. "fake-bad" responde 401.
 * Datos: dos repos (acme/web, acme/api) con PRs de ramas de agentes, corridas y un release; un equipo de Vercel con
 * dos proyectos y deploys en distintos estados.
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4999' } });
}

function ago(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}
function agoMs(min: number): number {
  return Date.now() - min * 60_000;
}

const PULLS: Record<string, Array<Record<string, unknown>>> = {
  'acme/web': [
    {
      id: 'PR_1',
      number: 42,
      title: 'Fix login redirect loop',
      url: 'https://github.com/acme/web/pull/42',
      isDraft: false,
      createdAt: ago(90),
      updatedAt: ago(4),
      headRefName: 'agent/fix-login',
      headRefOid: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'BLOCKED',
      author: { login: 'octo-fake' },
      autoMergeRequest: { enabledAt: ago(3) },
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] },
    },
    {
      id: 'PR_2',
      number: 41,
      title: 'Dark mode for settings',
      url: 'https://github.com/acme/web/pull/41',
      isDraft: false,
      createdAt: ago(300),
      updatedAt: ago(30),
      headRefName: 'agent/dark-settings',
      headRefOid: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890',
      mergeable: 'CONFLICTING',
      mergeStateStatus: 'DIRTY',
      author: { login: 'octo-fake' },
      autoMergeRequest: null,
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
    },
  ],
  'acme/api': [
    {
      id: 'PR_3',
      number: 7,
      title: 'Rate limit the ingest endpoint',
      url: 'https://github.com/acme/api/pull/7',
      isDraft: true,
      createdAt: ago(60),
      updatedAt: ago(10),
      headRefName: 'agent/rate-limit',
      headRefOid: 'c3d4e5f60718293a4b5c6d7e8f90123456789012',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      author: { login: 'robot-fake' },
      autoMergeRequest: null,
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
    },
  ],
};

function runs(repo: string) {
  const pulls = PULLS[repo] ?? [];
  return {
    total_count: pulls.length + 1,
    workflow_runs: [
      ...pulls.map((p, i) => ({
        id: 1000 + Number(p.number) * 10 + i,
        name: 'CI',
        html_url: `https://github.com/${repo}/actions/runs/${1000 + Number(p.number)}`,
        head_branch: p.headRefName,
        head_sha: p.headRefOid,
        status: (p.commits as { nodes: Array<{ commit: { statusCheckRollup: { state: string } } }> }).nodes[0].commit.statusCheckRollup.state === 'PENDING' ? 'in_progress' : 'completed',
        conclusion: { PENDING: null, FAILURE: 'failure', SUCCESS: 'success' }[(p.commits as { nodes: Array<{ commit: { statusCheckRollup: { state: 'PENDING' | 'FAILURE' | 'SUCCESS' } } }> }).nodes[0].commit.statusCheckRollup.state],
        event: 'pull_request',
        actor: { login: p.author && (p.author as { login: string }).login },
        created_at: ago(20),
        updated_at: ago(5),
      })),
      { id: 999, name: 'Deploy', html_url: `https://github.com/${repo}/actions/runs/999`, head_branch: 'main', head_sha: 'f'.repeat(40), status: 'completed', conclusion: 'success', event: 'push', actor: { login: 'octo-fake' }, created_at: ago(200), updated_at: ago(190) },
    ],
  };
}

function releases(repo: string) {
  return repo === 'acme/web'
    ? [{ id: 501, tag_name: 'v1.4.0', name: 'v1.4.0', html_url: 'https://github.com/acme/web/releases/tag/v1.4.0', author: { login: 'octo-fake' }, draft: false, prerelease: false, published_at: ago(1440) }]
    : [];
}

const PROJECTS = [
  { id: 'prj_web', name: 'web', framework: 'nextjs', updatedAt: agoMs(5), targets: { production: { id: 'dpl_web_prod', alias: ['web.acme.dev'], url: 'web-abc.vercel.app' } } },
  { id: 'prj_docs', name: 'docs', framework: 'nextjs', updatedAt: agoMs(500), targets: { production: { id: 'dpl_docs_prod', alias: ['docs.acme.dev'] } } },
];

function deployments(projectId: string | null) {
  const all = [
    { uid: 'dpl_web_building', name: 'web', projectId: 'prj_web', url: 'web-git-agent-fix-login.vercel.app', inspectorUrl: 'https://vercel.com/acme/web/dpl_web_building', state: 'BUILDING', target: null, created: agoMs(3), meta: { githubCommitRef: 'agent/fix-login', githubCommitSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', githubCommitMessage: 'Fix login redirect loop', githubPrId: '42' }, creator: { username: 'octo-fake' } },
    { uid: 'dpl_web_err', name: 'web', projectId: 'prj_web', url: 'web-git-agent-dark-settings.vercel.app', inspectorUrl: 'https://vercel.com/acme/web/dpl_web_err', state: 'ERROR', target: null, created: agoMs(40), meta: { githubCommitRef: 'agent/dark-settings', githubCommitSha: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890', githubCommitMessage: 'Dark mode for settings', githubPrId: '41' }, creator: { username: 'octo-fake' } },
    { uid: 'dpl_web_prod', name: 'web', projectId: 'prj_web', url: 'web-abc.vercel.app', inspectorUrl: 'https://vercel.com/acme/web/dpl_web_prod', state: 'READY', target: 'production', created: agoMs(180), ready: agoMs(176), meta: { githubCommitRef: 'main', githubCommitSha: 'f'.repeat(40), githubCommitMessage: 'Merge pull request #40' }, creator: { username: 'octo-fake' } },
    { uid: 'dpl_web_old', name: 'web', projectId: 'prj_web', url: 'web-old.vercel.app', inspectorUrl: 'https://vercel.com/acme/web/dpl_web_old', state: 'READY', target: 'production', created: agoMs(2000), ready: agoMs(1995), meta: { githubCommitRef: 'main', githubCommitSha: 'e'.repeat(40), githubCommitMessage: 'Release v1.3' }, creator: { username: 'octo-fake' } },
    { uid: 'dpl_docs_prod', name: 'docs', projectId: 'prj_docs', url: 'docs-xyz.vercel.app', inspectorUrl: 'https://vercel.com/acme/docs/dpl_docs_prod', state: 'READY', target: 'production', created: agoMs(600), ready: agoMs(598), meta: { githubCommitRef: 'main', githubCommitSha: 'd'.repeat(40), githubCommitMessage: 'Docs: new guide' }, creator: { username: 'octo-fake' } },
  ];
  return { deployments: projectId ? all.filter((d) => d.projectId === projectId) : all };
}

export async function fakeResponse(url: string, init: RequestInit): Promise<Response> {
  const token = new Headers(init.headers).get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (token === 'fake-bad') return json({ message: 'Bad credentials' }, 401);
  const u = new URL(url);
  if (u.hostname === 'api.github.com') {
    if (u.pathname === '/user') return json({ login: token.includes('org') ? 'acme-bot' : 'octo-fake', id: 1 });
    if (u.pathname === '/user/repos') {
      return json([
        { full_name: 'acme/web', private: true, pushed_at: ago(4) },
        { full_name: 'acme/api', private: true, pushed_at: ago(10) },
        { full_name: 'octo-fake/dotfiles', private: false, pushed_at: ago(5000) },
      ]);
    }
    if (u.pathname === '/graphql') {
      const body = JSON.parse(String(init.body ?? '{}')) as { variables?: { owner?: string; name?: string } };
      const repo = `${body.variables?.owner}/${body.variables?.name}`;
      if (!PULLS[repo]) return json({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] });
      return json({ data: { repository: { pullRequests: { nodes: PULLS[repo] } } } });
    }
    const m = /^\/repos\/([^/]+\/[^/]+)\/(actions\/runs|releases)$/.exec(u.pathname);
    if (m) {
      if (!PULLS[m[1]]) return json({ message: 'Not Found' }, 404);
      return json(m[2] === 'releases' ? releases(m[1]) : runs(m[1]));
    }
    return json({ message: 'Not Found' }, 404);
  }
  if (u.hostname === 'api.vercel.com') {
    if (u.pathname === '/v2/user') return json({ user: { id: 'usr_fake', username: 'fake-user', email: 'fake@example.com' } });
    if (u.pathname === '/v2/teams') return json({ teams: [{ id: 'team_acme', slug: 'acme', name: 'Acme' }] });
    if (u.pathname === '/v9/projects') return json({ projects: PROJECTS, pagination: { count: PROJECTS.length } });
    if (u.pathname === '/v6/deployments') return json(deployments(u.searchParams.get('projectId')));
    return json({ error: { code: 'not_found' } }, 404);
  }
  return json({ message: 'Not Found' }, 404);
}
