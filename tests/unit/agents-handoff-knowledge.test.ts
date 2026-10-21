import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import type { AgentRow } from '@/lib/db';
import { setAiModelOverride } from '@/lib/ai';
import {
  addTeammateReply,
  createAgent,
  getAgentRow,
  getConversationDetail,
  listKnowledgeUrls,
  listVisitorMessages,
  refreshKnowledgeUrls,
  resyncStaleKnowledgeUrls,
  sendAgentMessage,
  updateAgent,
} from '@/lib/agents';
import type { AgentUpdatePayload } from '@/lib/agents-config';
import { GET as publicGet } from '@/app/api/agents/public/[handle]/route';
import { NextRequest } from 'next/server';
import { makeUser } from './helpers';
import { scriptedModel } from './ai-mock';

const ENV_KEYS = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'VERCEL', 'AI_ENABLED', 'ALLOW_PRIVATE_WEBHOOKS', 'RATE_LIMIT_DISABLED'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  setAiModelOverride(null);
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function setupAgent(label: string, patch: AgentUpdatePayload = {}) {
  const owner = await makeUser(label);
  const created = await createAgent(owner.id, owner.id, { name: `${label} agent` });
  if (Object.keys(patch).length) {
    const res = await updateAgent(owner.id, created.id, patch);
    if (!res.ok) throw new Error(res.error);
  }
  return { owner, agent: (await getAgentRow(owner.id, created.id)) as AgentRow };
}

const HANDOFF_TOOLS: AgentUpdatePayload = {
  tools: { enabled: ['handoff_to_human'], calEventTypeId: null, calDays: 7, trackProjectId: null, flowIds: [], robotIds: [], httpAllowedDomains: [], requireApproval: [] },
};

describe('Agents: después de derivar, el agente no responde y el equipo sí', () => {
  it('página pública: guarda el mensaje sin correr el modelo, el equipo responde y el visitante lo ve', async () => {
    const { owner, agent } = await setupAgent('ho-pub', { ...HANDOFF_TOOLS, publicHandle: `ho-${crypto.randomUUID().slice(0, 8)}` });
    const key = 'k'.repeat(24);
    setAiModelOverride(scriptedModel([{ tool: 'handoff_to_human', input: { reason: 'wants a person' } }, { text: 'A teammate will follow up.' }]));
    const first = await sendAgentMessage({ agent, channel: 'public', visitorKey: key, text: 'I want a human' });
    expect(first.conversation.handed_off).toBe(1);

    const model = scriptedModel([{ text: 'should not run' }]);
    setAiModelOverride(model);
    const second = await sendAgentMessage({ agent, channel: 'public', visitorKey: key, conversationId: first.conversation.id, text: 'Still there?' });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(second.reply).toBeNull();
    expect(second.result).toMatchObject({ status: 'handed_off', handoff: true, text: '' });
    // El equipo recibe aviso de que el visitante espera.
    const notes = (await getDb()
      .prepare("SELECT title FROM notifications WHERE user_id = ? AND source_id = ?")
      .all(owner.id, first.conversation.id)) as Array<{ title: string }>;
    expect(notes.some((n) => n.title.includes('waiting'))).toBe(true);

    const reply = await addTeammateReply(owner.id, agent.id, first.conversation.id, 'Hi, Ana here. How can I help?', owner.id);
    expect(reply.ok).toBe(true);

    const history = await listVisitorMessages(agent, first.conversation.id, key);
    expect(history?.handedOff).toBe(true);
    expect(history?.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'I want a human'],
      ['assistant', 'A teammate will follow up.'],
      ['user', 'Still there?'],
      ['teammate', 'Hi, Ana here. How can I help?'],
    ]);
    // Otro visitante (otra key) no la ve.
    expect(await listVisitorMessages(agent, first.conversation.id, 'x'.repeat(24))).toBeNull();

    // La ruta de polling devuelve lo mismo.
    const res = await publicGet(
      new NextRequest(
        `http://localhost/api/agents/public/${agent.public_handle}?conversationId=${first.conversation.id}&visitorKey=${key}`,
      ),
      { params: Promise.resolve({ handle: agent.public_handle! }) },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { messages: unknown[] }).messages).toHaveLength(4);

    // En el detalle (pestaña Conversaciones) la respuesta figura como del equipo.
    const detail = await getConversationDetail(owner.id, agent.id, first.conversation.id);
    expect(detail?.messages.at(-1)).toMatchObject({ role: 'assistant', teammate: true });
  });

  it('API: tampoco responde después de derivar, aunque no haya AI configurada', async () => {
    const { agent } = await setupAgent('ho-api', HANDOFF_TOOLS);
    setAiModelOverride(scriptedModel([{ tool: 'handoff_to_human', input: { reason: 'x' } }, { text: 'Passing you on.' }]));
    const first = await sendAgentMessage({ agent, channel: 'api', text: 'human please' });
    setAiModelOverride(null);
    process.env.AI_ENABLED = 'false';
    const second = await sendAgentMessage({ agent, channel: 'api', conversationId: first.conversation.id, text: 'hello?' });
    expect(second.result.status).toBe('handed_off');
    expect(second.reply).toBeNull();
  });

  it('el equipo no responde por acá conversaciones de Chat ni de otro workspace', async () => {
    const { owner, agent } = await setupAgent('ho-chan');
    const other = await makeUser('ho-other');
    setAiModelOverride(scriptedModel([{ text: 'ok' }]));
    const res = await sendAgentMessage({ agent, channel: 'public', visitorKey: 'p'.repeat(20), text: 'hi' });
    expect(await addTeammateReply(other.id, agent.id, res.conversation.id, 'x', other.id)).toEqual({ ok: false, error: 'not_found' });
    expect(await addTeammateReply(owner.id, agent.id, res.conversation.id, '   ', owner.id)).toEqual({ ok: false, error: 'empty_message' });
    await getDb().prepare("UPDATE agent_conversations SET channel = 'chat' WHERE id = ?").run(res.conversation.id);
    expect(await addTeammateReply(owner.id, agent.id, res.conversation.id, 'hi', owner.id)).toEqual({
      ok: false,
      error: 'unsupported_channel',
    });
  });
});

describe('Agents: URLs de conocimiento', () => {
  function stubFetch(body: (url: string) => string) {
    const fn = vi.fn(async (url: string | URL) => new Response(body(String(url)), { status: 200, headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('al guardar se descargan solo las URLs nuevas (pending)', async () => {
    process.env.ALLOW_PRIVATE_WEBHOOKS = 'true';
    const { owner, agent } = await setupAgent('kn-save');
    const knowledge = { allPublicDocs: true, docsPageIds: [], cannedFromWidgetId: null, urls: ['https://a.example.com/'] };
    expect((await updateAgent(owner.id, agent.id, { knowledge })).ok).toBe(true);
    const fetchMock = stubFetch(() => '<html><title>A</title><body>Prices: $10</body></html>');
    let urls = await refreshKnowledgeUrls(owner.id, agent.id, { onlyPending: true });
    expect(urls[0]).toMatchObject({ status: 'ok', title: 'A' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Ya descargada: no se vuelve a pedir al guardar.
    await updateAgent(owner.id, agent.id, { knowledge: { ...knowledge, urls: ['https://a.example.com/', 'https://b.example.com/'] } });
    urls = await refreshKnowledgeUrls(owner.id, agent.id, { onlyPending: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://b.example.com/');
    expect(urls.every((u) => u.status === 'ok' && u.fetchedAt)).toBe(true);
  });

  it('el cron re-descarga las URLs de más de 24 h y deja las recientes', async () => {
    process.env.ALLOW_PRIVATE_WEBHOOKS = 'true';
    const { owner, agent } = await setupAgent('kn-cron');
    const knowledge = { allPublicDocs: true, docsPageIds: [], cannedFromWidgetId: null, urls: ['https://old.example.com/', 'https://new.example.com/'] };
    await updateAgent(owner.id, agent.id, { knowledge });
    stubFetch(() => 'v1');
    await refreshKnowledgeUrls(owner.id, agent.id);
    const old = new Date(Date.now() - 25 * 3_600_000).toISOString();
    await getDb()
      .prepare('UPDATE agent_knowledge_urls SET fetched_at = ? WHERE agent_id = ? AND url = ?')
      .run(old, agent.id, 'https://old.example.com/');
    const fetchMock = stubFetch(() => 'v2 new prices');
    await resyncStaleKnowledgeUrls({ limit: 500 });
    const called = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(called).toContain('https://old.example.com/');
    expect(called).not.toContain('https://new.example.com/');
    const rows = await listKnowledgeUrls(agent.id);
    expect(rows.find((r) => r.url === 'https://old.example.com/')?.chars).toBe('v2 new prices'.length);
    expect(new Date(rows.find((r) => r.url === 'https://old.example.com/')!.fetchedAt!).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});
