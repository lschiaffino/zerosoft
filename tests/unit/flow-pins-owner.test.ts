import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addMember, createTeam } from '@/lib/teams';
import { createFlow, getFlow, getFlowRow, listFlows, setFlowPin } from '@/lib/flow';
import { makeUser } from './helpers';

beforeEach(() => vi.stubEnv('RATE_LIMIT_DISABLED', 'true'));

describe('Flow: datos fijados solo para quien creó el flow', () => {
  it('los ve y los fija solo esa persona; el listado no los trae', async () => {
    const owner = await makeUser('pins-o');
    const bob = await makeUser('pins-bob');
    const dave = await makeUser('pins-dave');
    const team = await createTeam(owner.id, 'T');
    await addMember(team.id, bob.id, 'admin');
    await addMember(team.id, dave.id, 'member');
    const f = await createFlow(owner.id, bob.id, {
      name: 'F',
      graph: {
        nodes: [
          { id: 't', type: 'trigger.manual', position: { x: 0, y: 0 }, config: { sample: '{}' } },
          { id: 's', type: 'data.set', position: { x: 0, y: 100 }, config: { fields: [] } },
        ],
        edges: [{ id: 'e', source: 't', target: 's' }],
      },
    });
    if (!f.ok) throw new Error('flow');
    expect((await setFlowPin(owner.id, f.flow.id, 's', { email: 'secret@acme.com' }, bob.id)).ok).toBe(true);
    expect((await getFlow(owner.id, f.flow.id, bob.id))?.pins).toEqual({ s: { email: 'secret@acme.com' } });
    expect((await getFlow(owner.id, f.flow.id, dave.id))?.pins).toEqual({});
    expect(JSON.stringify(await listFlows(owner.id))).not.toContain('secret@acme.com');
    expect(await setFlowPin(owner.id, f.flow.id, 's', { x: 1 }, dave.id)).toEqual({ ok: false, error: 'not_flow_owner' });
    expect((await getFlowRow(owner.id, f.flow.id))?.pinned_data).toContain('secret@acme.com');
  });
});
