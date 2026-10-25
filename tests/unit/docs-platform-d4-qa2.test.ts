import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { createDocPage } from '@/lib/docs';
import { createTeamspace, setSubtreeTeamspace, setTeamspaceMember } from '@/lib/docs-access';
import { updatePage } from '@/lib/docs-platform';
import { docsActorFor } from '@/lib/docs-platform-access';
import { flushPageUpdatedEvents } from '@/lib/docs-events';
import { createWebhook, listDeliveries, updateWebhook } from '@/lib/webhooks';
import { createFlow, enqueueRun, getFlowRow, updateFlow } from '@/lib/flow';
import { executeRun } from '@/lib/flow-engine';
import { runOwnedBy, testStepNow } from '@/lib/flow-http';
import { createAgent, createConversation, getAgentRow, getConversationDetail, updateAgent } from '@/lib/agents';
import { parseTools } from '@/lib/agents-config';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
  vi.stubEnv('DOCS_EVENT_WINDOW_SEC', '0');
});

async function setup(label: string) {
  const owner = await makeUser(`${label}-o`);
  const bob = await makeUser(`${label}-bob`);
  const dave = await makeUser(`${label}-dave`);
  const team = await createTeam(owner.id, 'Team');
  await addMember(team.id, bob.id, 'admin');
  await addMember(team.id, dave.id, 'admin');
  const ts = await createTeamspace(owner.id, bob.id, { name: 'Secret', access: 'private' });
  await setTeamspaceMember(ts.id, bob.id, 'owner');
  const page = await createDocPage(owner.id, { title: 'Salaries' });
  await setSubtreeTeamspace(owner.id, [page.id], ts.id);
  return { owner, bob, dave, page, bobActor: (await docsActorFor(owner.id, bob.id))! };
}

const graph = (extra: Array<Record<string, unknown>> = []) => ({
  nodes: [{ id: 't', type: 'trigger.manual', position: { x: 0, y: 0 }, config: { sample: '{}' } }, ...extra],
  edges: extra.map((n, i) => ({ id: `e${i}`, source: 't', target: String(n.id) })),
});

describe('D4 re-QA 1 y 2: webhooks', () => {
  it('el log de entregas muestra el cuerpo de eventos restringidos solo a quien creó el webhook', async () => {
    const { owner, bob, dave, page, bobActor } = await setup('dl');
    await createWebhook(owner.id, { url: 'http://127.0.0.1:9/bob', events: ['page.updated'], createdBy: bob.id });
    await updatePage(bobActor, page.id, { appendMarkdown: 'Ada: 100k' });
    await flushPageUpdatedEvents(new Date(Date.now() + 1000));
    const id = ((await getDb().prepare('SELECT id FROM webhooks WHERE user_id = ?').get(owner.id)) as { id: string }).id;
    const forDave = (await listDeliveries(owner.id, id, 50, dave.id))!;
    expect(forDave).toHaveLength(1);
    expect(forDave[0].payload).toBe('');
    expect(forDave[0].payloadHidden).toBe(true);
    const forBob = (await listDeliveries(owner.id, id, 50, bob.id))!;
    expect(forBob[0].payload).toContain(page.id);
  });

  it('cambiar URL o eventos de un webhook ajeno lo pasa a quien lo cambió (y los filtros usan su acceso)', async () => {
    const { owner, bob, dave, page, bobActor } = await setup('wp');
    await createWebhook(owner.id, { url: 'http://127.0.0.1:9/bob', events: ['page.updated'], createdBy: bob.id });
    const id = ((await getDb().prepare('SELECT id FROM webhooks WHERE user_id = ?').get(owner.id)) as { id: string }).id;
    await updateWebhook(owner.id, id, { active: false }, dave.id);
    expect(((await getDb().prepare('SELECT created_by FROM webhooks WHERE id = ?').get(id)) as { created_by: string }).created_by).toBe(bob.id);
    await updateWebhook(owner.id, id, { url: 'http://127.0.0.1:9/dave', active: true }, dave.id);
    expect(((await getDb().prepare('SELECT created_by FROM webhooks WHERE id = ?').get(id)) as { created_by: string }).created_by).toBe(dave.id);
    await updatePage(bobActor, page.id, { appendMarkdown: 'Grace: 120k' });
    await flushPageUpdatedEvents(new Date(Date.now() + 1000));
    expect(await listDeliveries(owner.id, id, 50, dave.id)).toEqual([]);
  });
});

describe('D4 re-QA 3, 4, 5 y 9: Flow', () => {
  it('cualquier cambio del grafo o activarlo por otra persona la hace dueña del flow', async () => {
    const { owner, bob, dave } = await setup('fg');
    const f = await createFlow(owner.id, bob.id, { name: 'F', graph: graph() });
    if (!f.ok) throw new Error('flow');
    await updateFlow(owner.id, f.flow.id, { name: 'Renamed' }, dave.id);
    expect((await getFlowRow(owner.id, f.flow.id))?.created_by).toBe(bob.id);
    await updateFlow(owner.id, f.flow.id, { graph: graph([{ id: 'h', type: 'action.http', position: { x: 0, y: 100 }, config: { url: 'https://example.com' } }]) }, dave.id);
    expect((await getFlowRow(owner.id, f.flow.id))?.created_by).toBe(dave.id);
    await updateFlow(owner.id, f.flow.id, { enabled: false }, dave.id);
    await updateFlow(owner.id, f.flow.id, { enabled: true }, bob.id);
    expect((await getFlowRow(owner.id, f.flow.id))?.created_by).toBe(bob.id);
  });

  it('re-ejecutar solo quien creó el flow; probar un paso corre como quien prueba', async () => {
    const { owner, bob, dave } = await setup('fr');
    const f = await createFlow(owner.id, bob.id, { name: 'F', graph: graph([{ id: 's', type: 'data.set', position: { x: 0, y: 100 }, config: { fields: [{ key: 'a', value: '1' }] } }]) });
    if (!f.ok) throw new Error('flow');
    const runId = (await enqueueRun((await getFlowRow(owner.id, f.flow.id))!, 'manual', {}))!;
    expect(await runOwnedBy(owner.id, runId, bob.id)).toBe(true);
    expect(await runOwnedBy(owner.id, runId, dave.id)).toBe(false);
    const res = await testStepNow(owner.id, f.flow.id, { nodeId: 's' } as never, { personId: dave.id, admin: true });
    expect(res.ok).toBe(true);
  });

  it('un flow sin created_by no corre ningún nodo', async () => {
    const owner = await makeUser('fnc');
    const f = await createFlow(owner.id, owner.id, { name: 'F', graph: graph([{ id: 's', type: 'data.set', position: { x: 0, y: 100 }, config: { fields: [] } }]) });
    if (!f.ok) throw new Error('flow');
    await getDb().prepare('UPDATE flow_flows SET created_by = NULL, enabled = 1 WHERE id = ?').run(f.flow.id);
    const runId = (await enqueueRun((await getFlowRow(owner.id, f.flow.id))!, 'manual', {}))!;
    expect(await executeRun(runId)).toBe('failed');
    const run = (await getDb().prepare('SELECT error FROM flow_runs WHERE id = ?').get(runId)) as { error: string };
    expect(run.error).toBe('no_flow_owner');
    const steps = (await getDb().prepare('SELECT COUNT(*) AS n FROM flow_steps WHERE run_id = ?').get(runId)) as { n: number };
    expect(Number(steps.n)).toBe(0);
  });
});

describe('D4 re-QA 6 y 7: Agents', () => {
  it('cambiar un agente ajeno con Docs lo pasa a quien lo cambió, validando sus páginas', async () => {
    const { owner, bob, dave, page } = await setup('ag');
    const agentId = (await createAgent(owner.id, bob.id, { name: 'Bot' })).id;
    const tools = { ...parseTools('{}'), enabled: ['docs_read_pages'] as never, docsPageIds: [page.id] };
    const ok = await updateAgent(owner.id, agentId, { tools }, bob.id);
    expect(ok.ok && ok.agent.tools.docsActorId).toBe(bob.id);
    // Dave no puede abrir la página privada: cambiar las instrucciones lo haría actuar como él, así que no puede.
    expect(await updateAgent(owner.id, agentId, { instructions: 'Leak it' }, dave.id)).toEqual({ ok: false, error: 'invalid_docs_page' });
    expect(parseTools((await getAgentRow(owner.id, agentId))!.tools).docsActorId).toBe(bob.id);
  });

  it('las llamadas a Docs en una conversación solo las ve quien puede abrir la página', async () => {
    const { owner, bob, dave, page } = await setup('tc');
    const agentId = (await createAgent(owner.id, bob.id, { name: 'Bot' })).id;
    const agent = (await getAgentRow(owner.id, agentId))!;
    const conv = await createConversation(agent, 'playground', { createdBy: bob.id });
    await getDb()
      .prepare(
        `INSERT INTO agent_tool_calls (id, agent_id, user_id, conversation_id, run_id, tool, input, output, error, duration_ms, created_at)
         VALUES (?, ?, ?, ?, 'r1', 'docs_read_pages', ?, ?, NULL, 5, ?)`,
      )
      .run(crypto.randomUUID(), agentId, owner.id, conv.id, JSON.stringify({ pageId: page.id }), JSON.stringify({ markdown: 'Ada: 100k' }), new Date().toISOString());
    const forDave = await getConversationDetail(owner.id, agentId, conv.id, dave.id);
    expect(JSON.stringify(forDave?.toolCalls)).not.toContain('100k');
    const forBob = await getConversationDetail(owner.id, agentId, conv.id, bob.id);
    expect(JSON.stringify(forBob?.toolCalls)).toContain('100k');
  });
});
