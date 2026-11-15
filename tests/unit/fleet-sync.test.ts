import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createConnection, deleteConnection, listConnections, listDeploys, listPulls, listReleases, listRuns, syncDueConnections, updateConnection } from '@/lib/fleet/core';
import { loadBoard } from '@/lib/fleet/board';
import { createToken, ingestEvent, ownerOfToken } from '@/lib/fleet/sessions';
import { normalizeHookPayload } from '@/lib/fleet/types';
import { makeUser } from './helpers';

/** GitHub y Vercel contra los falsos de lib/fleet/fake.ts (FLEET_FAKE=1, tokens "fake…"): nada sale a internet. */
beforeEach(() => vi.stubEnv('FLEET_FAKE', '1'));
afterEach(() => vi.unstubAllEnvs());

async function actorOf(label: string) {
  const u = await makeUser(label);
  return { ws: u.id, person: u.id, email: u.email, name: label };
}

describe('Fleet: cuentas de GitHub y Vercel', () => {
  it('conecta GitHub, sincroniza PRs con CI y auto-merge, corridas y releases; el token queda sellado', async () => {
    const actor = await actorOf('fleet-gh');
    const { connection } = await createConnection(actor, { kind: 'github', token: 'fake-gh-token-1', repos: ['acme/web', 'acme/api'] });
    expect(connection).toMatchObject({ kind: 'github', account: 'octo-fake', selected: ['acme/web', 'acme/api'] });
    expect(JSON.stringify(await listConnections(actor))).not.toContain('fake-gh-token-1');
    const raw = (await getDb().prepare('SELECT token FROM fleet_connections WHERE id = ?').get(connection.id)) as { token: string };
    expect(raw.token).not.toBe('fake-gh-token-1');

    const { syncNow } = await import('@/lib/fleet/core');
    await syncNow(actor);
    const prs = await listPulls(actor);
    expect(prs.map((p) => `${p.repo}#${p.number}`).sort()).toEqual(['acme/api#7', 'acme/web#41', 'acme/web#42']);
    expect(prs.find((p) => p.number === 42)).toMatchObject({ checks: 'pending', autoMerge: true, branch: 'agent/fix-login' });
    expect(prs.find((p) => p.number === 41)).toMatchObject({ checks: 'failure', mergeable: 'CONFLICTING' });
    expect((await listRuns(actor)).length).toBeGreaterThan(0);
    expect((await listReleases(actor)).map((r) => r.tag)).toEqual(['v1.4.0']);

    // Sacar un repo borra lo suyo sin esperar la próxima sincronización.
    await updateConnection(actor, connection.id, { selected: ['acme/web'] });
    expect((await listPulls(actor)).every((p) => p.repo === 'acme/web')).toBe(true);
  });

  it('un token rechazado no se guarda', async () => {
    const actor = await actorOf('fleet-gh-bad');
    await expect(createConnection(actor, { kind: 'github', token: 'fake-bad' })).rejects.toThrow('github_unauthorized');
    expect(await listConnections(actor)).toEqual([]);
  });

  it('Vercel: deploys con estado, rama y el que sirve producción; varias cuentas juntas', async () => {
    const actor = await actorOf('fleet-vc');
    await createConnection(actor, { kind: 'vercel', token: 'fake-vc-1', teamId: 'team_acme' });
    await createConnection(actor, { kind: 'github', token: 'fake-gh-org', repos: ['acme/web'] });
    await syncDueConnections({ now: new Date(Date.now() + 10 * 60_000) });
    const deploys = await listDeploys(actor);
    expect(deploys.find((d) => d.id && d.project === 'web' && d.state === 'building')).toMatchObject({ branch: 'agent/fix-login', prNumber: 42 });
    expect(deploys.filter((d) => d.serving).map((d) => d.project).sort()).toEqual(['docs', 'web']);
    expect(deploys.find((d) => d.state === 'error')?.branch).toBe('agent/dark-settings');

    // Una sesión de la misma rama se lleva su PR y su deploy.
    const { token } = await createToken(actor, 'Mac');
    const owner = (await ownerOfToken(token))!;
    await ingestEvent(owner, normalizeHookPayload({ event: 'UserPromptSubmit', session: 'v-1', project: 'web', branch: 'agent/fix-login', text: 'fix' })!);
    const board = await loadBoard(actor);
    expect(board.sessions[0].pr).toMatchObject({ number: 42, checks: 'pending', autoMerge: true });
    expect(board.sessions[0].deploy).toMatchObject({ state: 'building', project: 'web' });
    expect(board.summary).toMatchObject({ working: 1, prsOpen: 2, failingChecks: 1, deploying: 1 });
  });

  it('aislamiento: otra persona no ve ni borra las cuentas', async () => {
    const a = await actorOf('fleet-iso-gh-a');
    const b = await actorOf('fleet-iso-gh-b');
    const { connection } = await createConnection(a, { kind: 'github', token: 'fake-gh-a', repos: ['acme/web'] });
    expect(await listConnections(b)).toEqual([]);
    await expect(deleteConnection(b, connection.id)).rejects.toThrow('not_found');
    await expect(updateConnection(b, connection.id, { label: 'x' })).rejects.toThrow('not_found');
    expect(await listConnections(a)).toHaveLength(1);
  });
});
