import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { createDocPage } from '@/lib/docs';
import { createTeamspace, setSubtreeTeamspace, setTeamspaceMember } from '@/lib/docs-access';
import { updatePage } from '@/lib/docs-platform';
import { docsActorFor } from '@/lib/docs-platform-access';
import { flushPageUpdatedEvents } from '@/lib/docs-events';
import { createWebhook, listDeliveries, resendDelivery, updateWebhook } from '@/lib/webhooks';
import { createFlow, enqueueRun, getFlow, getFlowRow, getRunWithSteps, lastOutputs, listRuns, setFlowPin, updateFlow } from '@/lib/flow';
import { executeRun, rerunFromStep } from '@/lib/flow-engine';
import { replayRun } from '@/lib/flow-alerts';
import { runFlowNow, runOwnedBy } from '@/lib/flow-http';
import { AgentError, createAgent, createConversation, getAgentRow, getConversationDetail, sendAgentMessage, updateAgent } from '@/lib/agents';
import { docsActorOf } from '@/lib/agent-tools';
import { parseTools } from '@/lib/agents-config';
import type { FlowGraph } from '@/lib/flow-schema';
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

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, config }) as FlowGraph['nodes'][number];
const graph = (nodes: FlowGraph['nodes']): FlowGraph => ({
  nodes: [node('t', 'trigger.manual', { sample: '{}' }), ...nodes],
  edges: nodes.map((n, i) => ({ id: `e${i}`, source: i === 0 ? 't' : nodes[i - 1].id, target: n.id })),
});
const setNode = (value: string) => node('s', 'data.set', { fields: [{ key: 'secret', value }] });

describe('re-QA D4 #1: lo capturado en un flow sigue siendo de quien lo capturó', () => {
  it('quien toma el flow no ve corridas, últimas salidas ni re-ejecuta lo de antes; activarlo no es tomarlo', async () => {
    const { owner, bob, dave } = await setup('cap');
    const f = await createFlow(owner.id, bob.id, { name: 'F', graph: graph([setNode('{{trigger.salary}}')]) });
    if (!f.ok) throw new Error('flow');
    const run = await runFlowNow(owner.id, f.flow.id, { salary: '100k' }, { personId: bob.id, admin: true });
    if (!run.ok) throw new Error('run');
    expect(JSON.stringify(run.run)).toContain('100k');

    // Activar o pausar: sigue siendo de Bob.
    await updateFlow(owner.id, f.flow.id, { enabled: true }, dave.id);
    expect((await getFlowRow(owner.id, f.flow.id))?.created_by).toBe(bob.id);

    // Dave cambia el grafo: el flow pasa a él, lo de Bob no.
    await updateFlow(owner.id, f.flow.id, { graph: graph([setNode('{{trigger.salary}}!')]) }, dave.id);
    expect((await getFlowRow(owner.id, f.flow.id))?.created_by).toBe(dave.id);
    const daveView = { personId: dave.id, admin: true };
    expect(JSON.stringify(await listRuns(owner.id, f.flow.id, 30, daveView))).not.toContain('100k');
    expect(JSON.stringify(await getRunWithSteps(owner.id, run.run!.id, daveView))).not.toContain('100k');
    expect(await lastOutputs(owner.id, f.flow.id, daveView)).toEqual({});
    expect(await runOwnedBy(owner.id, run.run!.id, dave.id)).toBe(false);
    // Bob sigue viendo lo suyo, pero ya no lo puede re-ejecutar (el flow corre como Dave).
    expect(JSON.stringify(await lastOutputs(owner.id, f.flow.id, { personId: bob.id, admin: true }))).toContain('100k');
    expect(await runOwnedBy(owner.id, run.run!.id, bob.id)).toBe(false);
    expect(await rerunFromStep(owner.id, run.run!.id, 's')).toEqual({ ok: false, error: 'owner_changed' });
  });

  it('una corrida encolada para el dueño anterior no corre con el nuevo, ni se reproduce', async () => {
    const { owner, bob, dave } = await setup('cap2');
    const f = await createFlow(owner.id, bob.id, { name: 'F', graph: graph([setNode('x')]) });
    if (!f.ok) throw new Error('flow');
    const runId = (await enqueueRun((await getFlowRow(owner.id, f.flow.id))!, 'manual', { salary: '100k' }))!;
    await updateFlow(owner.id, f.flow.id, { graph: graph([setNode('y')]) }, dave.id);
    expect(await executeRun(runId)).toBe('failed');
    expect(((await getDb().prepare('SELECT error FROM flow_runs WHERE id = ?').get(runId)) as { error: string }).error).toBe('owner_changed');
    expect(await replayRun(owner.id, runId)).toEqual({ ok: false, error: 'owner_changed' });
  });
});

describe('re-QA D4 #2: entregas de webhook por quien las capturó', () => {
  it('quien toma el webhook no ve ni reenvía las entregas de antes, y un reintento viejo no sale a su URL', async () => {
    const { owner, bob, dave, page, bobActor } = await setup('wcap');
    await createWebhook(owner.id, { url: 'http://127.0.0.1:9/bob', events: ['page.updated'], createdBy: bob.id });
    const id = ((await getDb().prepare('SELECT id FROM webhooks WHERE user_id = ?').get(owner.id)) as { id: string }).id;
    await updatePage(bobActor, page.id, { appendMarkdown: 'Ada: 100k' });
    await flushPageUpdatedEvents(new Date(Date.now() + 1000));
    const [old] = (await listDeliveries(owner.id, id, 50, bob.id))!;
    expect(old.payload).toContain(page.id);

    await updateWebhook(owner.id, id, { url: 'http://127.0.0.1:9/dave' }, dave.id);
    const [forDave] = (await listDeliveries(owner.id, id, 50, dave.id))!;
    expect(forDave.payloadHidden).toBe(true);
    expect(forDave.payload).toBe('');
    expect(await resendDelivery(owner.id, old.id, dave.id)).toBe('not_owner');
    // Bob la puede pedir, pero no sale: el webhook ya no es suyo.
    const again = await resendDelivery(owner.id, old.id, bob.id);
    expect(typeof again).toBe('string');
    const row = (await getDb().prepare('SELECT status, last_error FROM webhook_deliveries WHERE id = ?').get(again as string)) as { status: string; last_error: string };
    expect(row).toEqual({ status: 'failed', last_error: 'audience_revoked' });
  });
});

describe('re-QA D4 #3: Ejecutar flow solo con flows de la misma persona', () => {
  it('un subflow de otra persona no corre', async () => {
    const { owner, bob, dave } = await setup('sub');
    const child = await createFlow(owner.id, bob.id, { name: 'Child', graph: graph([setNode('bob data')]) });
    if (!child.ok) throw new Error('child');
    const parent = await createFlow(owner.id, dave.id, { name: 'Parent', graph: graph([node('call', 'logic.run_flow', { flowId: child.flow.id })]) });
    if (!parent.ok) throw new Error('parent');
    const res = await runFlowNow(owner.id, parent.flow.id, {});
    if (!res.ok) throw new Error('run');
    expect(res.run?.steps.find((s) => s.nodeId === 'call')?.error).toBe('subflow_other_owner');
    expect(JSON.stringify(res.run)).not.toContain('bob data');
  });
});

describe('re-QA D4 #4, #5 y #7: agentes', () => {
  it('el actor de Docs es quien le habla si está identificado; una conversación de API es de quien la empezó', async () => {
    const { owner, bob, dave } = await setup('agapi');
    expect(docsActorOf('api', dave.id, { docsActorId: bob.id })).toBe(dave.id);
    expect(docsActorOf('playground', dave.id, { docsActorId: bob.id })).toBe(dave.id);
    expect(docsActorOf('api', null, { docsActorId: bob.id })).toBe(bob.id);
    expect(docsActorOf('public', null, { docsActorId: bob.id })).toBe(bob.id);
    const agentId = (await createAgent(owner.id, bob.id, { name: 'Bot' })).id;
    await updateAgent(owner.id, agentId, { enabled: true }, bob.id);
    const agent = (await getAgentRow(owner.id, agentId))!;
    const conv = await createConversation(agent, 'api', { createdBy: bob.id });
    await expect(sendAgentMessage({ agent, channel: 'api', text: 'hola', conversationId: conv.id, createdBy: dave.id })).rejects.toBeInstanceOf(AgentError);
  });

  it('las llamadas a Docs viejas las ve quien las corrió, o quien puede abrir la página nombrada', async () => {
    const { owner, bob, dave, page } = await setup('agtc');
    const agentId = (await createAgent(owner.id, bob.id, { name: 'Bot' })).id;
    const agent = (await getAgentRow(owner.id, agentId))!;
    const conv = await createConversation(agent, 'chat', {});
    const insert = (input: unknown, output: unknown, by: string | null) =>
      getDb()
        .prepare(
          `INSERT INTO agent_tool_calls (id, agent_id, user_id, conversation_id, run_id, tool, input, output, error, duration_ms, created_at, captured_by)
           VALUES (?, ?, ?, ?, 'r1', 'docs_read_pages', ?, ?, NULL, 5, ?, ?)`,
        )
        .run(crypto.randomUUID(), agentId, owner.id, conv.id, JSON.stringify(input), JSON.stringify(output), new Date().toISOString(), by);
    await insert({ query: 'salary' }, { results: [{ title: 'Ada 100k' }] }, bob.id);
    await insert({ pageId: page.id }, { markdown: 'Grace 120k' }, bob.id);
    const forDave = JSON.stringify((await getConversationDetail(owner.id, agentId, conv.id, dave.id))?.toolCalls);
    expect(forDave).not.toContain('100k');
    expect(forDave).not.toContain('120k');
    const forBob = JSON.stringify((await getConversationDetail(owner.id, agentId, conv.id, bob.id))?.toolCalls);
    expect(forBob).toContain('100k');
    expect(forBob).toContain('120k');
    expect(forBob).not.toContain('capturedBy');
  });

  it('pausar, renombrar o cambiar el handle no cambia con el acceso de quién trabaja', async () => {
    const { owner, bob, dave, page } = await setup('agpause');
    const agentId = (await createAgent(owner.id, bob.id, { name: 'Bot' })).id;
    await updateAgent(owner.id, agentId, { tools: { ...parseTools('{}'), enabled: ['docs_read_pages'] as never, docsPageIds: [page.id] } }, bob.id);
    const res = await updateAgent(owner.id, agentId, { enabled: false, name: 'Renamed' }, dave.id);
    expect(res.ok).toBe(true);
    expect(parseTools((await getAgentRow(owner.id, agentId))!.tools).docsActorId).toBe(bob.id);
  });
});

describe('re-QA D4 #6: datos fijados de un flow', () => {
  it('solo los ve y los fija quien creó el flow; si el flow pasa a otra persona se descartan', async () => {
    const { owner, bob, dave } = await setup('pins');
    const f = await createFlow(owner.id, bob.id, { name: 'F', graph: graph([setNode('x')]) });
    if (!f.ok) throw new Error('flow');
    expect((await setFlowPin(owner.id, f.flow.id, 's', { secret: '100k' }, bob.id)).ok).toBe(true);
    expect((await getFlow(owner.id, f.flow.id, bob.id))?.pins).toEqual({ s: { secret: '100k' } });
    expect((await getFlow(owner.id, f.flow.id, dave.id))?.pins).toEqual({});
    expect(await setFlowPin(owner.id, f.flow.id, 's', { secret: 'x' }, dave.id)).toEqual({ ok: false, error: 'not_flow_owner' });
    await updateFlow(owner.id, f.flow.id, { graph: graph([setNode('y')]) }, dave.id);
    expect((await getFlow(owner.id, f.flow.id, dave.id))?.pins).toEqual({});
    expect((await getFlowRow(owner.id, f.flow.id))?.pinned_data).toBe('{}');
  });
});
