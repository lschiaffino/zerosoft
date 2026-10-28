import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { createFlow } from '@/lib/flow';
import { runFlowNow } from '@/lib/flow-http';
import { makeUser } from './helpers';

beforeEach(() => vi.stubEnv('RATE_LIMIT_DISABLED', 'true'));

describe('Flow: una corrida manual no corre con el acceso de otra persona', () => {
  it('solo quien creó el flow lo corre a mano; otra persona recibe not_flow_owner y no se crea la corrida', async () => {
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
    expect(await runFlowNow(owner.id, f.flow.id, { x: 'bob-picked' }, { personId: bob.id, admin: true })).toEqual({ ok: false, error: 'not_flow_owner' });
    const n = (await getDb().prepare('SELECT COUNT(*) AS n FROM flow_runs WHERE flow_id = ?').get(f.flow.id)) as { n: number };
    expect(Number(n.n)).toBe(0);
    const own = await runFlowNow(owner.id, f.flow.id, { x: 'ana' }, { personId: ana.id, admin: true });
    expect(own.ok && own.run?.status).toBe('success');
  });
});
