import { createHmac } from 'crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * GitHub de punta a punta contra el servidor: la config del webhook (Track ›
 * Ajustes › GitHub) da una URL /api/track/github/webhook/<id> y un secreto; un
 * pull_request firmado como lo manda GitHub, con un branch al estilo Linear
 * (usuario/eng-12-…), mueve el issue a en curso y el merge a hecho. La GitHub
 * App usa /api/track/github/app/webhook (cubierta en tests unitarios).
 */

const uid = () => Math.random().toString(36).slice(2, 7);

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

function payload(action: string, branch: string, merged = false) {
  const repo = { name: 'e2e', full_name: 'acme/e2e', private: true, owner: { login: 'acme' } };
  return {
    action,
    number: 5,
    pull_request: {
      number: 5,
      html_url: 'https://github.com/acme/e2e/pull/5',
      state: action === 'closed' ? 'closed' : 'open',
      title: 'Fix login',
      body: 'Small fix.',
      draft: false,
      merged,
      head: { ref: branch, sha: '6dcb09b5b57875f334f61aebed695e2e4193db5e', repo },
      base: { ref: 'main', repo },
      user: { login: 'octocat' },
      author_association: 'MEMBER',
    },
    repository: repo,
    sender: { login: 'octocat' },
  };
}

test('un PR firmado mueve el issue: abierto → en curso, merge → hecho', async ({ request }) => {
  const team = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `GH ${uid()}` } }));
  const issue = await ok<{ id: string; identifier: string }>(request.post(`/api/track/projects/${team.id}/issues`, { data: { title: `PR ${uid()}` } }));
  const conf = await ok<{ secret: string; config: { id: string } }>(request.put('/api/track/github', { data: { repos: ['acme/e2e'], regenerateSecret: true } }));
  expect(conf.secret, 'la config devuelve el secreto al crearla o regenerarla').toBeTruthy();

  const send = async (body: unknown) => {
    const raw = JSON.stringify(body);
    return request.post(`/api/track/github/webhook/${conf.config.id}`, {
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': uid(),
        'x-hub-signature-256': `sha256=${createHmac('sha256', conf.secret).update(raw).digest('hex')}`,
      },
      data: raw,
    });
  };
  const branch = `octocat/${issue.identifier.toLowerCase()}-fix-login`;
  const status = async () => ((await (await request.get(`/api/track/issues/${issue.id}`)).json()) as { status_category: string }).status_category;

  expect((await send(payload('opened', branch))).ok()).toBeTruthy();
  await expect.poll(status).toBe('in_progress');
  expect((await send(payload('closed', branch, true))).ok()).toBeTruthy();
  await expect.poll(status).toBe('done');

  // Firma equivocada: 401.
  const bad = await request.post(`/api/track/github/webhook/${conf.config.id}`, {
    headers: { 'content-type': 'application/json', 'x-github-event': 'ping', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) },
    data: '{}',
  });
  expect(bad.status()).toBe(401);
});
