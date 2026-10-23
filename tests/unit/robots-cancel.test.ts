import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { cancelQueuedRobotRun, createRobot, drainRobotQueue, getRobotRun, startRobotRun } from '@/lib/robots';
import { setRobotBackendForTests } from '@/lib/robots-runner';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const cancelRoute = await import('@/app/api/robots/runs/[id]/cancel/route');

afterEach(() => setRobotBackendForTests(undefined));

async function robotFor(userId: string): Promise<string> {
  const res = await createRobot(userId, userId, { name: 'Cancelable' });
  if (!res.ok) throw new Error(res.error);
  return res.robot.id;
}

/** Deja una corrida corriendo (retenida) y otra en cola. */
async function queueBehindRunning(userId: string, id: string) {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  setRobotBackendForTests({
    name: 'local',
    async run() {
      await gate;
      return { status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 0 };
    },
  });
  const first = startRobotRun(userId, id, {}, { trigger: 'manual' });
  await new Promise((r) => setTimeout(r, 50));
  const second = await startRobotRun(userId, id, {}, { trigger: 'manual' });
  if (!second.ok) throw new Error(second.error);
  return { first, queuedId: second.run.id, release };
}

describe('cancel queued robot runs', () => {
  it('fails a queued run with "cancelled" and the queue skips it', async () => {
    const user = await makeUser('rbc');
    const id = await robotFor(user.id);
    const { first, queuedId, release } = await queueBehindRunning(user.id, id);
    const res = await cancelQueuedRobotRun(user.id, queuedId);
    expect(res).toMatchObject({ ok: true, run: { id: queuedId, status: 'failed', error: 'cancelled' } });
    release();
    await first;
    expect(await drainRobotQueue({ workspaceId: user.id })).toBe(0);
    expect((await getRobotRun(user.id, queuedId))?.error).toBe('cancelled');
  });

  it('refuses runs that are not queued and runs from other workspaces', async () => {
    const user = await makeUser('rbc2');
    const other = await makeUser('rbc3');
    const id = await robotFor(user.id);
    const { first, queuedId, release } = await queueBehindRunning(user.id, id);
    expect(await cancelQueuedRobotRun(other.id, queuedId)).toEqual({ ok: false, error: 'not_found' });
    release();
    const done = await first;
    const runId = done.ok ? done.run.id : '';
    expect(await cancelQueuedRobotRun(user.id, runId)).toEqual({ ok: false, error: 'not_queued' });
    expect(await cancelQueuedRobotRun(user.id, queuedId)).toMatchObject({ ok: true });
    expect(await cancelQueuedRobotRun(user.id, queuedId)).toEqual({ ok: false, error: 'not_queued' });
  });

  it('requires a session', async () => {
    session.user = null;
    const res = await cancelRoute.POST(new NextRequest('http://localhost/api/robots/runs/x/cancel', { method: 'POST' }), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(res.status).toBe(401);
  });
});
