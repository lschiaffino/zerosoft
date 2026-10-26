import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, type AgentRow } from '@/lib/db';
import { seal } from '@/lib/secret-box';
import { createApiKey } from '@/lib/api-auth';
import { API_SCOPES, hasScope, parseScopes } from '@/lib/api-scopes';
import { endpointScope, API_ENDPOINTS } from '@/lib/api-docs';
import {
  createChatConversation,
  createChatMessage,
  createChatWidget,
  getOrCreateChatVisitor,
  updateChatConversation,
} from '@/lib/chat-data';
import { setAiModelOverride } from '@/lib/ai';
import { buildAgentInstructions, createAgent, getAgentRow, sendAgentMessage, toAgentDto, updateAgent } from '@/lib/agents';
import { decideAgentAction, listAgentActions } from '@/lib/agents-approvals';
import { agentUpdateSchema, isApprovableTool, type AgentToolKey } from '@/lib/agents-config';
import { createProject } from '@/lib/track-data';
import { makeUser } from './helpers';
import { scriptedModel } from './ai-mock';

const listRoute = await import('@/app/api/v1/chat/conversations/route');
const getRoute = await import('@/lib/routes/v1/chat/conversations/[id]/route');
const replyRoute = await import('@/lib/routes/v1/chat/conversations/[id]/messages/route');
const assignRoute = await import('@/lib/routes/v1/chat/conversations/[id]/assign/route');
const resolveRoute = await import('@/lib/routes/v1/chat/conversations/[id]/resolve/route');
const reopenRoute = await import('@/lib/routes/v1/chat/conversations/[id]/reopen/route');

const ENV_KEYS = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'VERCEL', 'AI_ENABLED', 'AI_FREE_TOKENS_PER_MONTH'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  setAiModelOverride(null);
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, key: string, body?: unknown) =>
  new Request(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Webhook directo en la base (sin validar la URL): las entregas quedan registradas. */
async function hook(userId: string, events: string[]): Promise<string> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare('INSERT INTO webhooks (id, user_id, url, events, secret) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, 'https://127.0.0.1/hook', JSON.stringify(events), seal('whsec_test'));
  return id;
}
async function deliveries(hookId: string) {
  const rows = (await getDb()
    .prepare('SELECT event, payload FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at, rowid')
    .all(hookId)) as Array<{ event: string; payload: string }>;
  return rows.map((r) => ({ event: r.event, data: (JSON.parse(r.payload) as { data: Record<string, unknown> }).data }));
}

async function inbox(label: string) {
  const owner = await makeUser(label);
  const widget = await createChatWidget(owner.id, null, { name: `${label} widget` });
  const visitor = await getOrCreateChatVisitor(widget.id, `ext-${label}`, { name: 'Ana', email: 'ana@example.com' } as never);
  const conversation = await createChatConversation(widget.id, visitor.id);
  return { owner, widget, visitor, conversation };
}

describe('Chat: API v1', () => {
  it('scopes chat:read y chat:write (write incluye read) y la doc los deduce del path', () => {
    expect(API_SCOPES).toContain('chat:read');
    expect(API_SCOPES).toContain('chat:write');
    expect(hasScope(['chat:write'], 'chat:read')).toBe(true);
    expect(hasScope(['crm:write'], 'chat:read')).toBe(false);
    expect(parseScopes('*')).toContain('chat:write');
    const scopes = API_ENDPOINTS.filter((e) => e.sectionId === 'chat').map((e) => endpointScope(e));
    expect(scopes).toEqual(['chat:read', 'chat:read', 'chat:write', 'chat:write', 'chat:write', 'chat:write']);
  });

  it('listar, leer, responder, asignar, resolver y reabrir; solo conversaciones del workspace', async () => {
    const { owner, conversation } = await inbox('chatapi');
    const other = await inbox('chatapi-other');
    await createChatMessage(conversation.id, 'visitor', { body: 'Where is my order?' });
    await createChatMessage(conversation.id, 'user', { body: 'internal', userId: owner.id, isNote: true });
    const { key } = await createApiKey(owner.id, 'helpdesk', owner.id, ['chat:write']);
    const { key: readOnly } = await createApiKey(owner.id, 'ro', owner.id, ['chat:read']);
    const { key: crmOnly } = await createApiKey(owner.id, 'crm', owner.id, ['crm:read']);

    expect((await listRoute.GET(req('http://x/api/v1/chat/conversations', crmOnly))).status).toBe(403);
    const list = await listRoute.GET(req('http://x/api/v1/chat/conversations?status=open', readOnly));
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { conversations: Array<{ id: string; visitor: { email: string } }>; total: number };
    expect(listed.conversations.map((c) => c.id)).toEqual([conversation.id]);
    expect(listed.conversations[0].visitor.email).toBe('ana@example.com');
    expect((await listRoute.GET(req('http://x/api/v1/chat/conversations?status=nope', readOnly))).status).toBe(400);

    const detail = (await (await getRoute.GET(req(`http://x/api/v1/chat/conversations/${conversation.id}`, readOnly), ctx(conversation.id))).json()) as {
      messages: Array<{ body: string; isNote: boolean }>;
    };
    expect(detail.messages.map((m) => [m.body, m.isNote])).toEqual([
      ['Where is my order?', false],
      ['internal', true],
    ]);
    expect((await getRoute.GET(req(`http://x/api/v1/chat/conversations/${other.conversation.id}`, readOnly), ctx(other.conversation.id))).status).toBe(404);

    // Leer no alcanza para escribir.
    expect((await replyRoute.POST(req('http://x', readOnly, { body: 'hi' }), ctx(conversation.id))).status).toBe(403);
    const reply = await replyRoute.POST(req('http://x', key, { body: 'Ships tomorrow.' }), ctx(conversation.id));
    expect(reply.status).toBe(201);
    expect(await reply.json()).toMatchObject({ senderType: 'user', userId: owner.id, body: 'Ships tomorrow.', isNote: false });
    const after = (await getDb().prepare('SELECT first_response_at FROM chat_conversations WHERE id = ?').get(conversation.id)) as {
      first_response_at: string | null;
    };
    expect(after.first_response_at).toBeTruthy();
    expect((await replyRoute.POST(req('http://x', key, { body: '' }), ctx(conversation.id))).status).toBe(400);

    expect((await assignRoute.POST(req('http://x', key, { assignedTo: 'someone-else' }), ctx(conversation.id))).status).toBe(400);
    const assigned = await assignRoute.POST(req('http://x', key, { assignedTo: owner.id }), ctx(conversation.id));
    expect(await assigned.json()).toMatchObject({ assignedTo: owner.id });

    const resolved = await resolveRoute.POST(req('http://x', key, {}), ctx(conversation.id));
    expect(await resolved.json()).toMatchObject({ status: 'resolved' });
    const reopened = await reopenRoute.POST(req('http://x', key, {}), ctx(conversation.id));
    expect(await reopened.json()).toMatchObject({ status: 'open', resolvedAt: null });
    expect((await resolveRoute.POST(req('http://x', key, {}), ctx(other.conversation.id))).status).toBe(404);
  });

  it('webhooks: mensajes (sin notas), asignación y resolución, vengan del inbox o de la API', async () => {
    const { owner, conversation } = await inbox('chathooks');
    const hookId = await hook(owner.id, ['chat.message.created', 'chat.conversation.assigned', 'chat.conversation.resolved']);
    await createChatMessage(conversation.id, 'visitor', { body: 'Hello' });
    await createChatMessage(conversation.id, 'user', { body: 'secret note', userId: owner.id, isNote: true });
    await createChatMessage(conversation.id, 'system', { body: 'merged' });
    await updateChatConversation(conversation.id, { assignedTo: owner.id });
    await updateChatConversation(conversation.id, { assignedTo: owner.id }); // sin cambio: no avisa
    await updateChatConversation(conversation.id, { status: 'resolved' });
    await updateChatConversation(conversation.id, { status: 'resolved' }); // ya resuelta: no avisa
    const got = await deliveries(hookId);
    expect(got.map((d) => d.event)).toEqual(['chat.message.created', 'chat.conversation.assigned', 'chat.conversation.resolved']);
    expect(got[0].data).toMatchObject({ conversation: { id: conversation.id }, message: { body: 'Hello', senderType: 'visitor' } });
    expect(got[1].data).toMatchObject({ conversation: { assignedTo: owner.id }, previousAssignedTo: null });
    expect(got[2].data).toMatchObject({ conversation: { status: 'resolved' } });
  });
});

describe('Agents: aprobación antes de acciones que escriben', () => {
  async function agentWith(label: string, enabled: AgentToolKey[], requireApproval: string[], extra: Record<string, unknown> = {}) {
    const owner = await makeUser(label);
    const created = await createAgent(owner.id, owner.id, { name: `${label} agent` });
    const parsed = agentUpdateSchema.parse({
      tools: { enabled, calEventTypeId: null, calDays: 7, trackProjectId: null, flowIds: [], httpAllowedDomains: [], requireApproval, ...extra },
    });
    const res = await updateAgent(owner.id, created.id, parsed);
    if (!res.ok) throw new Error(res.error);
    return { owner, agent: (await getAgentRow(owner.id, created.id)) as AgentRow };
  }

  it('solo se pueden marcar herramientas que escriben', () => {
    expect(isApprovableTool('track_create_issue')).toBe(true);
    expect(isApprovableTool('search_knowledge')).toBe(false);
    expect(agentUpdateSchema.safeParse({ tools: { requireApproval: ['search_knowledge'] } }).success).toBe(false);
  });

  it('la acción queda pendiente, el agente lo sabe, y al aprobarla corre', async () => {
    const { owner, agent } = await agentWith('appr', ['track_create_issue'], ['track_create_issue']);
    const project = await createProject(owner.id, null, { name: 'Support' } as Parameters<typeof createProject>[2]);
    await updateAgent(owner.id, agent.id, agentUpdateSchema.parse({ tools: { ...toAgentDto(agent).tools, trackProjectId: project.id } }));
    const row = (await getAgentRow(owner.id, agent.id)) as AgentRow;
    expect(buildAgentInstructions(toAgentDto(row), 'api', ['track_create_issue'])).toContain("need a teammate's approval");

    setAiModelOverride(scriptedModel([{ tool: 'track_create_issue', input: { title: 'Refund order 42' } }, { text: 'Pending.' }]));
    const res = await sendAgentMessage({ agent: row, channel: 'api', text: 'please refund' });
    expect(res.result.toolCalls[0].output).toMatchObject({ pending: true });
    // Nada se ejecutó todavía.
    expect(await getDb().prepare('SELECT id FROM track_issues WHERE project_id = ?').all(project.id)).toHaveLength(0);
    const [pending] = await listAgentActions(owner.id, agent.id, { status: 'pending' });
    expect(pending).toMatchObject({ tool: 'track_create_issue', conversationId: res.conversation.id, input: { title: 'Refund order 42' } });
    const notif = await getDb().prepare("SELECT title FROM notifications WHERE user_id = ? AND source_id = ?").get(owner.id, res.conversation.id);
    expect(notif).toBeTruthy();

    // Otro workspace no la puede decidir; la primera decisión gana.
    const stranger = await makeUser('appr-x');
    expect(await decideAgentAction(stranger.id, agent.id, pending.id, 'approve', 'x@x')).toEqual({ ok: false, error: 'not_found' });
    const ok = await decideAgentAction(owner.id, agent.id, pending.id, 'approve', 'boss@acme.io');
    expect(ok).toMatchObject({ ok: true, action: { status: 'approved', decidedBy: 'boss@acme.io' } });
    expect(await decideAgentAction(owner.id, agent.id, pending.id, 'reject', 'boss@acme.io')).toEqual({ ok: false, error: 'already_decided' });
    expect(await getDb().prepare('SELECT id FROM track_issues WHERE project_id = ?').all(project.id)).toHaveLength(1);
    // La decisión queda en el historial que el agente lee en su próximo turno.
    const logged = (await getDb()
      .prepare("SELECT output FROM agent_tool_calls WHERE conversation_id = ? AND run_id = ?")
      .get(res.conversation.id, `approval:${pending.id}`)) as { output: string };
    expect(JSON.parse(logged.output)).toMatchObject({ approval: 'approved', decidedBy: 'boss@acme.io' });
  });

  it('rechazar no ejecuta; sin la marca, la herramienta corre directo', async () => {
    const { owner, agent } = await agentWith('appr-rej', ['crm_upsert_contact'], ['crm_upsert_contact']);
    setAiModelOverride(scriptedModel([{ tool: 'crm_upsert_contact', input: { email: 'ana@x.com', name: 'Ana' } }, { text: 'Ok.' }]));
    await sendAgentMessage({ agent, channel: 'api', text: 'I am ana@x.com' });
    const [pending] = await listAgentActions(owner.id, agent.id);
    expect((await decideAgentAction(owner.id, agent.id, pending.id, 'reject', 'boss@acme.io')).ok).toBe(true);
    expect(await getDb().prepare('SELECT id FROM crm_contacts WHERE user_id = ? AND email = ?').get(owner.id, 'ana@x.com')).toBeUndefined();

    const { owner: o2, agent: a2 } = await agentWith('appr-free', ['crm_upsert_contact'], []);
    setAiModelOverride(scriptedModel([{ tool: 'crm_upsert_contact', input: { email: 'bo@x.com' } }, { text: 'Saved.' }]));
    await sendAgentMessage({ agent: a2, channel: 'api', text: 'I am bo@x.com' });
    expect(await getDb().prepare('SELECT id FROM crm_contacts WHERE user_id = ? AND email = ?').get(o2.id, 'bo@x.com')).toBeTruthy();
    expect(await listAgentActions(o2.id, a2.id)).toHaveLength(0);
  });
});
