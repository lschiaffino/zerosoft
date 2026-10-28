import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { createFlow, updateFlow } from '@/lib/flow';
import { createVariable } from '@/lib/flow-variables';
import { runFlowNow } from '@/lib/flow-http';
import { makeUser } from './helpers';

beforeEach(() => vi.stubEnv('RATE_LIMIT_DISABLED', 'true'));

describe('Flow: una corrida manual no corre con el acceso de otra persona', () => {
  it('si la lanza otra persona, corre con el acceso (y las variables) de esa persona, no del dueño', async () => {
    const owner = await makeUser('mro-o');
    const ana = await makeUser('mro-ana');
    const bob = await makeUser('mro-bob');
    const team = await createTeam(owner.id, 'T');
    await addMember(team.id, ana.id, 'admin');
    await addMember(team.id, bob.id, 'admin');
    const f = await createFlow(owner.id, ana.id, {
      name: 'F',
      graph: {
        nodes: [
          { id: 't', type: 'trigger.manual', position: { x: 0, y: 0 }, config: { sample: '{}' } },
          { id: 's', type: 'data.set', position: { x: 0, y: 100 }, config: { fields: [{ key: 'v', value: '{{trigger.x}}' }] } },
        ],
        edges: [{ id: 'e', source: 't', target: 's' }],
      },
    });
    if (!f.ok) throw new Error('flow');
    await createVariable(owner.id, ana.id, 'who', 'ana');
    await createVariable(owner.id, bob.id, 'who', 'bob');
    await updateFlow(owner.id, f.flow.id, {
      graph: {
        nodes: [
          { id: 't', type: 'trigger.manual', position: { x: 0, y: 0 }, config: { sample: '{}' } },
          { id: 's', type: 'data.set', position: { x: 0, y: 100 }, config: { fields: [{ key: 'v', value: '{{trigger.x}} {{vars.who}}' }] } },
        ],
        edges: [{ id: 'e', source: 't', target: 's' }],
      },
    }, ana.id);
    const bobRun = await runFlowNow(owner.id, f.flow.id, { x: 'bob-picked' }, { personId: bob.id, admin: true });
    expect(bobRun.ok && bobRun.run?.steps.find((s) => s.nodeId === 's')?.output).toEqual({ v: 'bob-picked bob' });
    const cap = (await getDb().prepare('SELECT captured_by FROM flow_runs WHERE id = ?').get(bobRun.ok ? bobRun.run!.id : '')) as { captured_by: string };
    expect(cap.captured_by).toBe(bob.id);
    const own = await runFlowNow(owner.id, f.flow.id, { x: 'ana' }, { personId: ana.id, admin: true });
    expect(own.ok && own.run?.status).toBe('success');
  });
});
