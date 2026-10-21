import { afterEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
}));
const sentEmails = vi.hoisted(() => [] as Array<{ to: string; subject: string; text: string; html?: string }>);
const emailFails = vi.hoisted(() => ({ value: false }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: async (opts: { to: string; subject: string; text: string; html?: string }) => {
    if (emailFails.value) return { ok: false, error: 'down' };
    sentEmails.push(opts);
    return { ok: true, provider: 'test' };
  },
}));

import { getDb } from '@/lib/db';
import type { AgentRow } from '@/lib/db';
import { setAiModelOverride } from '@/lib/ai';
import { createAgent, createConversation, getAgentRow, sendAgentMessage, updateAgent } from '@/lib/agents';
import { AGENT_MAX_STEPS } from '@/lib/agents-config';
import { clusterTopics, topicKeywords } from '@/lib/agents-topics';
import { getAgentAnalytics, parseAnalyticsRange } from '@/lib/agents-analytics';
import { ALERT_MIN, buildAlertEmail, checkAgentAlerts, detectSpikes } from '@/lib/agents-alerts';
import { GET as analyticsGet, PATCH as analyticsPatch } from '@/app/api/agents/[id]/analytics/route';
import { makeUser } from './helpers';
import { scriptedModel } from './ai-mock';
import { NextRequest } from 'next/server';

afterEach(() => {
  setAiModelOverride(null);
  session.user = null;
  emailFails.value = false;
});

async function setupAgent(label: string) {
  const owner = await makeUser(label);
  const created = await createAgent(owner.id, owner.id, { name: `${label} agent` });
  const agent = (await getAgentRow(owner.id, created.id)) as AgentRow;
  return { owner, agent };
}

const iso = (msAgo: number, now = Date.now()) => new Date(now - msAgo).toISOString();

async function addConversation(agent: AgentRow, title: string, opts: { channel?: 'public' | 'api' | 'playground'; handedOff?: boolean; answered?: boolean; at?: string } = {}) {
  const conv = await createConversation(agent, opts.channel ?? 'public', { title });
  const at = opts.at ?? new Date().toISOString();
  await getDb()
    .prepare('UPDATE agent_conversations SET handed_off = ?, created_at = ? WHERE id = ?')
    .run(opts.handedOff ? 1 : 0, at, conv.id);
  await getDb()
    .prepare("INSERT INTO agent_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)")
    .run(crypto.randomUUID(), conv.id, title, at);
  let reply: string | null = null;
  if (opts.answered !== false) {
    reply = crypto.randomUUID();
    await getDb()
      .prepare("INSERT INTO agent_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', 'ok', ?)")
      .run(reply, conv.id, at);
  }
  return { conv, reply };
}

async function addToolCall(agent: AgentRow, conversationId: string, tool: string, error: string | null, at = new Date().toISOString()) {
  await getDb()
    .prepare(
      "INSERT INTO agent_tool_calls (id, agent_id, user_id, conversation_id, run_id, tool, input, output, error, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, '{}', NULL, ?, 120, ?)",
    )
    .run(crypto.randomUUID(), agent.id, agent.user_id, conversationId, crypto.randomUUID(), tool, error, at);
}

async function addThumb(agent: AgentRow, conversationId: string, messageId: string, rating: 1 | -1, at = new Date().toISOString()) {
  await getDb()
    .prepare('INSERT INTO agent_feedback (id, agent_id, user_id, conversation_id, message_id, rating, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), agent.id, agent.user_id, conversationId, messageId, rating, at);
}

describe('Agents: temas por keywords', () => {
  it('saca stopwords en en/es/pt, tildes y plurales simples', () => {
    expect([...topicKeywords('Hola, ¿cuáles son los precios del envío?').keys()]).toEqual(['cuale', 'precio', 'envio']);
    expect([...topicKeywords('Hi! What are your prices?').keys()]).toEqual(['price']);
  });

  it('agrupa de a un tema por vez y deja el resto como "sin tema"', () => {
    const { topics, other } = clusterTopics([
      { text: 'precios del plan pro', handedOff: false },
      { text: 'cuánto salen los precios', handedOff: true },
      { text: 'Prices for teams', handedOff: false },
      { text: 'envío a Brasil', handedOff: false },
      { text: 'el envio tarda', handedOff: true },
      { text: 'hola', handedOff: false },
      { text: 'factura', handedOff: false },
    ]);
    // Empate en cantidad: gana la raíz alfabéticamente primera.
    expect(topics.map((t) => [t.keyword, t.count, t.handoffs])).toEqual([
      ['envio', 2, 1],
      ['precios', 2, 1],
    ]);
    // "Prices for teams" no comparte palabra con otros (price ≠ precio); hola es stopword.
    expect(other).toBe(3);
    expect(topics[1].examples).toEqual(['precios del plan pro', 'cuánto salen los precios']);
  });
});

describe('Agents: analítica', () => {
  it('cuenta resolución, derivaciones, errores, topes, pulgares y temas sin el playground', async () => {
    const { agent } = await setupAgent('an1');
    const a = await addConversation(agent, 'precios del plan');
    const b = await addConversation(agent, 'precios para equipos', { handedOff: true });
    await addConversation(agent, 'necesito una persona', { handedOff: true, answered: false });
    await addConversation(agent, 'conversación vieja', { at: iso(40 * 86_400_000) });
    const play = await addConversation(agent, 'precios prueba', { channel: 'playground' });
    await addToolCall(agent, a.conv.id, 'search_knowledge', null);
    await addToolCall(agent, a.conv.id, 'http_request', 'timeout');
    await addToolCall(agent, b.conv.id, 'http_request', null);
    await addToolCall(agent, play.conv.id, 'http_request', 'ignored');
    await addThumb(agent, a.conv.id, a.reply as string, 1);
    await addThumb(agent, b.conv.id, b.reply as string, -1);
    await getDb()
      .prepare("INSERT INTO agent_runs (id, agent_id, user_id, conversation_id, channel, status, steps, created_at) VALUES (?, ?, ?, ?, 'public', 'step_limit', 5, ?)")
      .run(crypto.randomUUID(), agent.id, agent.user_id, a.conv.id, new Date().toISOString());

    const r = await getAgentAnalytics(agent.user_id, agent.id, 30);
    expect(r).toMatchObject({
      conversations: 3,
      answered: 2,
      resolved: 1,
      handedOff: 2,
      runs: 1,
      stepLimits: 1,
      toolCalls: 3,
      toolErrors: 1,
      thumbsUp: 1,
      thumbsDown: 1,
    });
    expect(r.resolutionRate).toBeCloseTo(1 / 3);
    expect(r.handoffRate).toBeCloseTo(2 / 3);
    expect(r.tools[0]).toMatchObject({ tool: 'http_request', calls: 2, errors: 1, lastError: 'timeout', avgMs: 120 });
    expect(r.topics.topics[0]).toMatchObject({ keyword: 'precios', count: 2, handoffs: 1 });
    expect((await getAgentAnalytics(agent.user_id, agent.id, 90)).conversations).toBe(4);
    expect(parseAnalyticsRange('7')).toBe(7);
    expect(parseAnalyticsRange('365')).toBe(30);
  });

  it('cada corrida queda registrada con su estado (tope de pasos)', async () => {
    const { agent } = await setupAgent('an2');
    await updateAgent(agent.user_id, agent.id, {
      tools: { enabled: ['search_knowledge'], calEventTypeId: null, calDays: 7, trackProjectId: null, flowIds: [], robotIds: [], httpAllowedDomains: [], requireApproval: [] },
    });
    const row = (await getAgentRow(agent.user_id, agent.id)) as AgentRow;
    setAiModelOverride(scriptedModel([{ tool: 'search_knowledge', input: { query: 'loop' } }]));
    const res = await sendAgentMessage({ agent: row, channel: 'playground', text: 'hello there' });
    expect(res.result.status).toBe('step_limit');
    const run = (await getDb().prepare('SELECT * FROM agent_runs WHERE id = ?').get(res.result.runId)) as
      | { status: string; steps: number; channel: string; conversation_id: string }
      | undefined;
    expect(run).toMatchObject({ status: 'step_limit', steps: AGENT_MAX_STEPS, channel: 'playground', conversation_id: res.conversation.id });
  });

  it('la ruta exige el workspace; el switch de alertas solo para quien edita', async () => {
    const { owner, agent } = await setupAgent('an3');
    const url = `http://localhost/api/agents/${agent.id}/analytics?days=7&locale=es`;
    const ctx = { params: Promise.resolve({ id: agent.id }) };
    session.user = { id: owner.id, email: owner.email, name: owner.name, team: null, role: 'owner' };
    const res = await analyticsGet(new NextRequest(url), ctx);
    const body = (await res.json()) as { analytics: { days: number }; alertsEnabled: boolean };
    expect(body.analytics.days).toBe(7);
    expect(body.alertsEnabled).toBe(true);
    expect(((await getDb().prepare('SELECT locale FROM agent_alert_state WHERE agent_id = ?').get(agent.id)) as { locale: string }).locale).toBe('es');

    const off = await analyticsPatch(new NextRequest(url, { method: 'PATCH', body: JSON.stringify({ alertsEnabled: false }) }), ctx);
    expect(await off.json()).toEqual({ alertsEnabled: false });
    expect((await getAgentRow(owner.id, agent.id))?.alerts_enabled).toBe(0);

    session.user = { id: owner.id, email: owner.email, name: owner.name, team: null, role: 'member' };
    expect((await analyticsPatch(new NextRequest(url, { method: 'PATCH', body: JSON.stringify({ alertsEnabled: true }) }), ctx)).status).toBe(403);
    const stranger = await makeUser('an3-other');
    session.user = { id: stranger.id, email: stranger.email, name: stranger.name, team: null, role: 'owner' };
    expect((await analyticsGet(new NextRequest(url), ctx)).status).toBe(404);
  });
});

describe('Agents: alertas', () => {
  it('pico = mínimo absoluto y 3 veces el promedio por hora de la semana', () => {
    const zero = { thumbs_down: 0, tool_errors: 0, step_limits: 0 };
    expect(detectSpikes({ thumbs_down: ALERT_MIN.thumbs_down - 1, tool_errors: 0, step_limits: 0 }, zero)).toEqual([]);
    expect(detectSpikes({ thumbs_down: 3, tool_errors: 5, step_limits: 3 }, zero)).toEqual(['thumbs_down', 'tool_errors', 'step_limits']);
    // 168 errores en la semana = 1 por hora: 5 supera 3x; con 2 por hora (336) no.
    expect(detectSpikes({ ...zero, tool_errors: 5 }, { ...zero, tool_errors: 168 })).toEqual(['tool_errors']);
    expect(detectSpikes({ ...zero, tool_errors: 5 }, { ...zero, tool_errors: 336 })).toEqual([]);
  });

  it('el email nombra el agente, los picos y lleva a la analítica', () => {
    const email = buildAlertEmail({ id: 'ag1', name: 'Soporte' }, ['tool_errors'], { thumbs_down: 0, tool_errors: 7, step_limits: 0 }, 'es', 'https://app.test');
    expect(email.subject).toBe('Soporte: están subiendo los problemas');
    expect(email.text).toContain('7 errores de herramientas');
    expect(email.link).toBe('https://app.test/es/app/agents/ag1?tab=analytics');
    expect(buildAlertEmail({ id: 'ag1', name: 'S' }, ['step_limits'], { thumbs_down: 0, tool_errors: 0, step_limits: 4 }, 'xx', 'https://a').link).toBe(
      'https://a/en/app/agents/ag1?tab=analytics',
    );
  });

  it('avisa al dueño una vez, respeta el throttle, reintenta si falla y se apaga por agente', async () => {
    const { owner, agent } = await setupAgent('al1');
    const now = new Date();
    const conv = await addConversation(agent, 'error');
    const quiet = await setupAgent('al1-quiet');
    const qConv = await addConversation(quiet.agent, 'x');
    for (let i = 0; i < 6; i++) await addToolCall(agent, conv.conv.id, 'http_request', 'boom', iso(10 * 60_000, now.getTime()));
    // Errores del playground no cuentan.
    const play = await addConversation(quiet.agent, 'p', { channel: 'playground' });
    for (let i = 0; i < 6; i++) await addToolCall(quiet.agent, play.conv.id, 'http_request', 'boom', iso(10 * 60_000, now.getTime()));
    await addToolCall(quiet.agent, qConv.conv.id, 'http_request', 'boom', iso(10 * 60_000, now.getTime()));

    emailFails.value = true;
    sentEmails.length = 0;
    const failed = await checkAgentAlerts({ now });
    expect(failed.failed).toBeGreaterThanOrEqual(1);
    emailFails.value = false;

    // La base es compartida con otros tests: se mira solo lo de este dueño.
    const mineCount = () => sentEmails.filter((e) => e.to === owner.email).length;
    await checkAgentAlerts({ now });
    const mine = sentEmails.filter((e) => e.to === owner.email);
    expect(mine).toHaveLength(1);
    expect(mine[0].text).toContain('6 tool errors');
    expect(sentEmails.some((e) => e.to === quiet.owner.email)).toBe(false);

    // Una hora después sigue el pico, pero no pasaron 6 h.
    await checkAgentAlerts({ now: new Date(now.getTime() + 30 * 60_000) });
    expect(mineCount()).toBe(1);

    await getDb().prepare('UPDATE agents SET alerts_enabled = 0 WHERE id = ?').run(agent.id);
    await getDb().prepare('UPDATE agent_alert_state SET last_sent_at = NULL WHERE agent_id = ?').run(agent.id);
    await checkAgentAlerts({ now });
    expect(mineCount()).toBe(1);
  });
});
