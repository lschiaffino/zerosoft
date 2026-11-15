import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createAgent } from '@/lib/agents';
import { toolCtx } from '@/lib/assistant/registry';
import { ALL_TOOLS } from '@/lib/assistant/tools';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const tool = (name: string) => {
  const t = ALL_TOOLS.find((x) => x.name === name);
  if (!t || t.kind !== 'read') throw new Error(`no read tool ${name}`);
  return t;
};

async function listed(user: Parameters<typeof toolCtx>[0]): Promise<string[]> {
  const out = (await tool('agents_list').run(toolCtx(user, 'en'), {})) as { agents: Array<{ id: string }> };
  return out.agents.map((a) => a.id);
}

describe('asistente: agents_list respeta el acceso por agente', () => {
  it('un member no ve los agentes cerrados para él; el owner y quien tiene acceso, sí', async () => {
    const { owner, member, friend } = await workspaceWithMember();
    const open = await createAgent(owner.id, owner.id, { name: 'open agent' });
    const closed = await createAgent(owner.id, owner.id, { name: 'closed agent' });
    await getDb().prepare('UPDATE agents SET access = ? WHERE id = ?').run(JSON.stringify({ members: 'none', people: { [friend.id]: 'viewer' } }), closed.id);

    const own = await listed(asOwner(owner));
    expect(own).toEqual(expect.arrayContaining([open.id, closed.id]));

    const asPlain = await listed(asMember(owner, member, 'member', ['agents']));
    expect(asPlain).toContain(open.id);
    expect(asPlain).not.toContain(closed.id);

    const asFriend = await listed(asMember(owner, friend, 'member', ['agents']));
    expect(asFriend).toEqual(expect.arrayContaining([open.id, closed.id]));
  });
});
