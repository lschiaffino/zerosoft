import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { createDocPage } from '@/lib/docs';
import { createTeamspace, setSubtreeTeamspace, setTeamspaceMember } from '@/lib/docs-access';
import { getPage } from '@/lib/docs-platform';
import { docsActorFor } from '@/lib/docs-platform-access';
import { createFlow, getFlowRow, updateFlow } from '@/lib/flow';
import { resumeRun } from '@/lib/flow-engine';
import { runFlowNow } from '@/lib/flow-http';
import { createAgent, createConversation, getAgentRow, toAgentDto, updateAgent } from '@/lib/agents';
import { decideAgentAction, listAgentActions, queueAgentAction } from '@/lib/agents-approvals';
import { parseTools } from '@/lib/agents-config';
import { MIGRATIONS } from '@/lib/schema/migrations';
import type { FlowGraph } from '@/lib/flow-schema';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});

async function setup(label: string) {
  const owner = await makeUser(`${label}-o`);
  const carol = await makeUser(`${label}-carol`);
  const bob = await makeUser(`${label}-bob`);
  const team = await createTeam(owner.id, 'Team');
  await addMember(team.id, carol.id, 'admin');
  await addMember(team.id, bob.id, 'admin');
  const ts = await createTeamspace(owner.id, carol.id, { name: 'Finance', access: 'private', ai_knowledge: true });
  await setTeamspaceMember(ts.id, carol.id, 'owner');
  const page = await createDocPage(owner.id, { title: 'FINAI' });
  await setSubtreeTeamspace(owner.id, [page.id], ts.id);
  return { owner, carol, bob, page };
}

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, config }) as FlowGraph['nodes'][number];

describe('re-QA 3 (ALTA): aprobaciones de Docs', () => {
  it('solo quien puede editar la página ve el detalle y decide, y la escritura corre con su acceso', async () => {
    const { owner, carol, bob, page } = await setup('apd');
    const agentId = (await createAgent(owner.id, carol.id, { name: 'Bot' })).id;
    await updateAgent(owner.id, agentId, { tools: { ...parseTools('{}'), enabled: ['docs_read_pages', 'docs_write_page'] as never, docsPageIds: [page.id] } }, carol.id);
    const agentRow = (await getAgentRow(owner.id, agentId))!;
    const agent = toAgentDto(agentRow);
    const conv = await createConversation(agentRow, 'chat', {});
    const actionId = await queueAgentAction({ agent, workspaceId: owner.id, conversationId: conv.id }, 'docs_write_page', {
      operation: 'append',
      pageId: page.id,
      markdown: 'Bonus pool: 2M',
    });

    const [forBob] = await listAgentActions(owner.id, agentId, { viewerId: bob.id });
    expect(forBob.locked).toBe(true);
    expect(JSON.stringify(forBob)).not.toContain('2M');
    expect(await decideAgentAction(owner.id, agentId, actionId, 'approve', 'bob@x.com', bob.id)).toEqual({ ok: false, error: 'not_allowed' });

    const [forCarol] = await listAgentActions(owner.id, agentId, { viewerId: carol.id });
    expect(forCarol.locked).toBeUndefined();
    expect(JSON.stringify(forCarol.input)).toContain('2M');
    const res = await decideAgentAction(owner.id, agentId, actionId, 'approve', 'carol@x.com', carol.id);
    expect(res.ok && res.action.status).toBe('approved');
    const read = await getPage((await docsActorFor(owner.id, carol.id))!, page.id);
    expect(JSON.stringify(read)).toContain('Bonus pool: 2M');
  });
});

describe('re-QA 4 (baja 1): crear una página sin página madre', () => {
  it('la decide la persona con cuyo acceso trabaja el agente o quien puede crear en la raíz', async () => {
    const { owner, carol, page } = await setup('apr');
    const member = await makeUser('apr-member');
    const team = (await getDb().prepare('SELECT id FROM teams WHERE owner_id = ?').get(owner.id)) as { id: string };
    await addMember(team.id, member.id, 'member');
    await getDb().prepare("INSERT OR REPLACE INTO docs_settings (workspace_id, member_role, allow_export, allow_publish, allow_guests, updated_at) VALUES (?, 'view', 1, 1, 1, ?)").run(owner.id, new Date().toISOString());
    const agentId = (await createAgent(owner.id, carol.id, { name: 'Bot' })).id;
    await updateAgent(owner.id, agentId, { tools: { ...parseTools('{}'), enabled: ['docs_read_pages', 'docs_write_page'] as never, docsPageIds: [page.id] } }, carol.id);
    const agentRow = (await getAgentRow(owner.id, agentId))!;
    const conv = await createConversation(agentRow, 'chat', {});
    await queueAgentAction({ agent: toAgentDto(agentRow), workspaceId: owner.id, conversationId: conv.id }, 'docs_write_page', { operation: 'create', title: 'Notes' });
    expect((await listAgentActions(owner.id, agentId, { viewerId: carol.id }))[0].locked).toBeUndefined();
    expect((await listAgentActions(owner.id, agentId, { viewerId: owner.id }))[0].locked).toBeUndefined();
    expect((await listAgentActions(owner.id, agentId, { viewerId: member.id }))[0].locked).toBe(true);
  });
});

describe('re-QA 3 (baja 2): reanudar una espera tras un cambio de dueño', () => {
  it('falla con owner_changed y no corre más nodos', async () => {
    const { owner, carol, bob } = await setup('res');
    const graph = (v: string): FlowGraph => ({
      nodes: [
        node('t', 'trigger.manual', { sample: '{}' }),
        node('wait', 'logic.delay', { mode: 'until', until: '{{trigger.at}}' }),
        node('after', 'data.set', { fields: [{ key: 'v', value: v }] }),
      ],
      edges: [
        { id: 'a', source: 't', target: 'wait' },
        { id: 'b', source: 'wait', target: 'after' },
      ],
    });
    const f = await createFlow(owner.id, carol.id, { name: 'F', graph: graph('1') });
    if (!f.ok) throw new Error('flow');
    const res = await runFlowNow(owner.id, f.flow.id, { at: new Date(Date.now() + 86_400_000).toISOString() });
    if (!res.ok) throw new Error('run');
    expect(res.run?.status).toBe('waiting');
    await updateFlow(owner.id, f.flow.id, { graph: graph('2') }, bob.id);
    expect((await getFlowRow(owner.id, f.flow.id))?.created_by).toBe(bob.id);
    expect(await resumeRun(res.run!.id, 'wait', { kind: 'continue' })).toBe('failed');
    const row = (await getDb().prepare('SELECT error FROM flow_runs WHERE id = ?').get(res.run!.id)) as { error: string };
    expect(row.error).toBe('owner_changed');
    const after = (await getDb().prepare("SELECT COUNT(*) AS n FROM flow_steps WHERE run_id = ? AND node_id = 'after'").get(res.run!.id)) as { n: number };
    expect(Number(after.n)).toBe(0);
  });
});

describe('re-QA 3 (baja 1): backfill de 116', () => {
  it('las corridas de un flow que cambió de dueño quedan sin captured_by', async () => {
    const { owner, carol, bob } = await setup('bf');
    const g: FlowGraph = { nodes: [node('t', 'trigger.manual', { sample: '{}' })], edges: [] };
    const same = await createFlow(owner.id, carol.id, { name: 'Same', graph: g });
    const moved = await createFlow(owner.id, carol.id, { name: 'Moved', graph: g });
    if (!same.ok || !moved.ok) throw new Error('flow');
    await updateFlow(owner.id, moved.flow.id, { graph: { ...g, nodes: [node('t', 'trigger.manual', { sample: '{"a":1}' })] } }, bob.id);
    const ins = async (flowId: string) => {
      const id = crypto.randomUUID();
      const ts = new Date().toISOString();
      await getDb()
        .prepare(`INSERT INTO flow_runs (id, flow_id, user_id, trigger_type, status, input, created_at) VALUES (?, ?, ?, 'manual', 'success', '{}', ?)`)
        .run(id, flowId, owner.id, ts);
      return id;
    };
    const a = await ins(same.flow.id);
    const b = await ins(moved.flow.id);
    const m = MIGRATIONS.find((x) => x.id === '116_captured_by')!;
    const { getClient } = await import('@/lib/db');
    await m.up(getClient());
    const get = async (id: string) => ((await getDb().prepare('SELECT captured_by FROM flow_runs WHERE id = ?').get(id)) as { captured_by: string | null }).captured_by;
    expect(await get(a)).toBe(carol.id);
    expect(await get(b)).toBeNull();
  });
});
