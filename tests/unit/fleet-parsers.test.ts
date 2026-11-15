import { describe, expect, it } from 'vitest';
import { checksFromRollup, isRepoName, parsePullsGraphql, parseReleases, parseRepoList, parseRuns } from '@/lib/fleet/github';
import { deployStateOf, parseDeployments, parseProjects, parseTeams } from '@/lib/fleet/vercel';
import { baseName, clip, deliveryReason, hookOutput, normalizeHookPayload, redactSecrets, statusAfter } from '@/lib/fleet/types';
import { FleetError } from '@/lib/fleet/types';

describe('GitHub', () => {
  it('lee los PRs abiertos de la consulta GraphQL', () => {
    const body = {
      data: {
        repository: {
          pullRequests: {
            nodes: [
              {
                number: 42,
                title: 'Fix login',
                url: 'https://github.com/acme/web/pull/42',
                isDraft: false,
                createdAt: '2026-11-15T10:00:00Z',
                updatedAt: '2026-11-15T11:00:00Z',
                headRefName: 'agent/fix-login',
                headRefOid: 'abc123',
                mergeable: 'MERGEABLE',
                mergeStateStatus: 'BLOCKED',
                author: { login: 'octo' },
                autoMergeRequest: { enabledAt: '2026-11-15T11:00:00Z' },
                commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
              },
              { number: 7, title: 'Draft', url: 'u', isDraft: true, author: null, autoMergeRequest: null, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } },
              { number: 'x', title: 'roto' },
            ],
          },
        },
      },
    };
    const prs = parsePullsGraphql('acme/web', body);
    expect(prs).toHaveLength(2);
    expect(prs[0]).toMatchObject({
      externalId: 'acme/web#42',
      number: 42,
      author: 'octo',
      branch: 'agent/fix-login',
      sha: 'abc123',
      draft: false,
      autoMerge: true,
      mergeable: 'MERGEABLE',
      mergeState: 'blocked',
      checks: 'failure',
      updatedAt: '2026-11-15T11:00:00.000Z',
    });
    expect(prs[1]).toMatchObject({ number: 7, draft: true, autoMerge: false, checks: '', author: '' });
  });

  it('un repo que no existe es un error claro', () => {
    expect(() => parsePullsGraphql('acme/none', { errors: [{ type: 'NOT_FOUND' }] })).toThrow(FleetError);
    try {
      parsePullsGraphql('acme/none', { errors: [{ type: 'NOT_FOUND' }] });
    } catch (err) {
      expect((err as FleetError).code).toBe('repo_not_found');
    }
  });

  it('estado del CI desde statusCheckRollup', () => {
    expect(checksFromRollup('SUCCESS')).toBe('success');
    expect(checksFromRollup('ERROR')).toBe('failure');
    expect(checksFromRollup('EXPECTED')).toBe('pending');
    expect(checksFromRollup(null)).toBe('');
  });

  it('corridas, releases y repos', () => {
    const runs = parseRuns('acme/web', {
      workflow_runs: [{ id: 9, name: 'CI', html_url: 'h', head_branch: 'main', head_sha: 's', status: 'completed', conclusion: 'success', event: 'push', actor: { login: 'a' }, updated_at: '2026-11-15T00:00:00Z' }, { name: 'sin id' }],
    });
    expect(runs).toEqual([expect.objectContaining({ externalId: 'acme/web/runs/9', status: 'completed', conclusion: 'success', actor: 'a' })]);
    const rel = parseReleases('acme/web', [{ id: 1, tag_name: 'v1', name: '', html_url: 'h', author: { login: 'a' }, draft: false, prerelease: true, published_at: '2026-11-15T00:00:00Z' }]);
    expect(rel[0]).toMatchObject({ tag: 'v1', name: 'v1', prerelease: true });
    expect(parseRepoList([{ full_name: 'a/b', private: true }, { full_name: 'no valido' }])).toEqual([{ fullName: 'a/b', private: true, pushedAt: null }]);
    expect(isRepoName('acme/web')).toBe(true);
    expect(isRepoName('../etc')).toBe(false);
    expect(isRepoName('a/b/c')).toBe(false);
  });
});

describe('Vercel', () => {
  it('proyectos con el deploy que sirve producción', () => {
    const p = parseProjects({ projects: [{ id: 'prj_1', name: 'web', framework: 'nextjs', updatedAt: 1763200000000, targets: { production: { id: 'dpl_1', alias: ['web.acme.dev'] } } }, { name: 'sin id' }] });
    expect(p).toEqual([{ externalId: 'prj_1', name: 'web', productionDeploymentId: 'dpl_1', url: 'https://web.acme.dev', framework: 'nextjs', updatedAt: new Date(1763200000000).toISOString() }]);
  });

  it('deploys: estado, rama, commit y PR', () => {
    const d = parseDeployments(
      {
        deployments: [
          { uid: 'dpl_1', name: 'web', projectId: 'prj_1', url: 'web-1.vercel.app', state: 'BUILDING', target: null, created: 1763200000000, meta: { githubCommitRef: 'agent/x', githubCommitSha: 'abc', githubCommitMessage: 'Fix\n\nlong body', githubPrId: '42' }, creator: { username: 'octo' } },
          { uid: 'dpl_2', projectId: 'prj_1', url: 'web-2.vercel.app', readyState: 'READY', target: 'production', created: 1763200000000, ready: 1763200060000, meta: {} },
        ],
      },
      new Map([['prj_1', 'web']]),
    );
    expect(d[0]).toMatchObject({ externalId: 'dpl_1', project: 'web', state: 'building', target: 'preview', branch: 'agent/x', sha: 'abc', commitMessage: 'Fix', prNumber: 42, creator: 'octo', url: 'https://web-1.vercel.app' });
    expect(d[1]).toMatchObject({ project: 'web', state: 'ready', target: 'production', prNumber: null, readyAt: new Date(1763200060000).toISOString() });
    expect(deployStateOf('ERROR')).toBe('error');
    expect(deployStateOf('CANCELED')).toBe('canceled');
    expect(deployStateOf('INITIALIZING')).toBe('building');
    expect(parseTeams({ teams: [{ id: 't1', slug: 'acme', name: 'Acme' }, {}] })).toEqual([{ id: 't1', slug: 'acme', name: 'Acme' }]);
  });
});

describe('Hook: lo que se acepta y se guarda', () => {
  it('del JSON crudo de Claude Code toma solo los campos de la lista: la ruta queda en la carpeta', () => {
    const ev = normalizeHookPayload({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'abc-123',
      cwd: '/Users/someone/private/projects/web',
      transcript_path: '/Users/someone/.claude/projects/x.jsonl',
      prompt: 'Use ghp_abcdefghijklmnopqrstuvwxyz0123 to push',
    });
    expect(ev).toMatchObject({ event: 'UserPromptSubmit', sessionKey: 'abc-123', project: 'web', text: 'Use [redacted] to push' });
    expect(JSON.stringify(ev)).not.toContain('/Users/');
    expect(JSON.stringify(ev)).not.toContain('transcript');
  });

  it('formato compacto del script, con Orca y recortes', () => {
    const ev = normalizeHookPayload({ event: 'Stop', session: 's1', project: 'a/b/web', branch: 'main', text: 'x'.repeat(20_000), orca_pane: 'pane-1', orca_worktree: 'wt', stop_hook_active: true });
    expect(ev?.project).toBe('web');
    expect(ev?.text.length).toBe(8000);
    expect(ev?.orcaPane).toBe('pane-1');
    expect(ev?.stopHookActive).toBe(true);
  });

  it('rechaza eventos desconocidos y ids de sesión raros', () => {
    expect(normalizeHookPayload({ event: 'PreToolUse', session: 's' })).toBeNull();
    expect(normalizeHookPayload({ event: 'Stop', session: '../../etc' })).toBeNull();
    expect(normalizeHookPayload({ event: 'Stop' })).toBeNull();
    expect(normalizeHookPayload([1, 2])).toBeNull();
  });

  it('tapa secretos comunes', () => {
    const s = redactSecrets('a sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa b AKIAABCDEFGHIJKLMNOP c zsf_abcdefghijklmnopqrst -----BEGIN RSA PRIVATE KEY-----\nxx\n-----END RSA PRIVATE KEY-----');
    expect(s).toBe('a [redacted] b [redacted] c [redacted] [redacted]');
    expect(baseName('/a/b/c/')).toBe('c');
    expect(clip('abcdef', 4)).toBe('abc…');
  });

  it('estado después de cada evento', () => {
    expect(statusAfter('idle', { event: 'UserPromptSubmit', detail: '' })).toBe('working');
    expect(statusAfter('working', { event: 'Notification', detail: 'permission_prompt' })).toBe('waiting');
    expect(statusAfter('done', { event: 'Notification', detail: 'idle_prompt' })).toBe('done');
    expect(statusAfter('working', { event: 'Stop', detail: '' })).toBe('done');
    expect(statusAfter('working', { event: 'StopFailure', detail: 'rate_limit' })).toBe('failed');
    expect(statusAfter('working', { event: 'SubagentStop', detail: 'Explore' })).toBe('working');
  });
});

describe('Contrato del Stop hook', () => {
  it('Stop con mensajes en cola: decision block y el mensaje como reason', () => {
    expect(hookOutput('Stop', [{ text: 'run the tests too', source: 'web' }])).toEqual({ decision: 'block', reason: 'run the tests too' });
    expect(hookOutput('Stop', [])).toEqual({});
  });

  it('varios mensajes van numerados y en orden', () => {
    expect(deliveryReason([{ text: 'a', source: 'web' }, { text: 'b', source: 'whatsapp' }])).toBe('(1) a\n\n(2) b');
  });

  it('UserPromptSubmit los suma como contexto; el resto no devuelve nada', () => {
    const out = hookOutput('UserPromptSubmit', [{ text: 'also check mobile', source: 'web' }]) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(out.hookSpecificOutput.additionalContext).toContain('also check mobile');
    expect(hookOutput('Notification', [{ text: 'x', source: 'web' }])).toEqual({});
  });
});
