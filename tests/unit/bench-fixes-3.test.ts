import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import type { AgentRow } from '@/lib/db';
import { setAiModelOverride } from '@/lib/ai';
import {
  BOT_MIN_SCORE,
  createCannedResponse,
  createChatConversation,
  createChatMessage,
  createChatWidget,
  findBotReply,
  getChatWidget,
  getOrCreateChatVisitor,
  getVisitorConversationWithMessages,
  scoreCandidate,
  tokenize,
  updateChatConversation,
  updateChatWidget,
} from '@/lib/chat-data';
import { GET as visitorGet, POST as visitorPost } from '@/app/api/chat/messages/route';
import { createAgent, getAgentRow, getConversationRow, sendAgentMessage, updateAgent } from '@/lib/agents';
import type { AgentUpdatePayload } from '@/lib/agents-config';
import { publicErrorCode, streamAgentReply } from '@/lib/agents-http';
import { makeUser } from './helpers';

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    void task().catch(() => {});
  },
}));

// ---------- Chat: el widget sigue mostrando la conversación resuelta ----------

async function setupChat(label: string) {
  const owner = await makeUser(label);
  const widget = await createChatWidget(owner.id, null, { name: `${label} widget` });
  const externalId = `ext-${crypto.randomUUID()}`;
  const visitor = await getOrCreateChatVisitor(widget.id, externalId);
  const conversation = await createChatConversation(widget.id, visitor.id);
  return { owner, widget, visitor, externalId, conversation };
}

type PollBody = {
  conversation: { id: string; status: string } | null;
  messages: Array<{ body: string }>;
  csat: { conversationId: string } | null;
};

async function poll(widgetId: string, externalId: string): Promise<PollBody> {
  const res = await visitorGet(new Request(`http://localhost/api/chat/messages?widgetId=${widgetId}&visitorId=${externalId}`));
  return (await res.json()) as PollBody;
}

describe('Chat: resolver con el widget abierto', () => {
  it('el visitante sigue viendo el hilo y la encuesta CSAT', async () => {
    const { owner, widget, externalId, conversation } = await setupChat('resolve-keep');
    await createChatMessage(conversation.id, 'visitor', { body: 'Hola, tengo una duda' });
    await createChatMessage(conversation.id, 'user', { body: 'Ya está resuelto', userId: owner.id });
    await updateChatConversation(conversation.id, { status: 'resolved' });

    const body = await poll(widget.id, externalId);
    expect(body.conversation).toMatchObject({ id: conversation.id, status: 'resolved' });
    expect(body.messages.map((m) => m.body)).toEqual(['Hola, tengo una duda', 'Ya está resuelto']);
    expect(body.csat?.conversationId).toBe(conversation.id);

    // Al escribir (POST) solo cuenta la abierta: la resuelta no se reutiliza.
    const forPost = await getVisitorConversationWithMessages(widget.id, externalId);
    expect(forPost?.conversation).toBeNull();
  });

  it('un mensaje nuevo después de resolver abre una conversación nueva y el poll pasa a esa', async () => {
    const { owner, widget, externalId, conversation } = await setupChat('resolve-new');
    await createChatMessage(conversation.id, 'visitor', { body: 'Primera' });
    await createChatMessage(conversation.id, 'user', { body: 'Listo', userId: owner.id });
    await updateChatConversation(conversation.id, { status: 'resolved' });

    const res = await visitorPost(
      new Request('http://localhost/api/chat/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ widgetId: widget.id, visitorId: externalId, body: 'Otra consulta' }),
      }),
    );
    expect(res.status).toBe(201);
    const posted = (await res.json()) as { conversation: { id: string; status: string } };
    expect(posted.conversation.id).not.toBe(conversation.id);

    const body = await poll(widget.id, externalId);
    expect(body.conversation?.id).toBe(posted.conversation.id);
    expect(body.messages.map((m) => m.body)).toEqual(['Otra consulta']);
    // La encuesta de la anterior sigue pendiente hasta que la contesten.
    expect(body.csat?.conversationId).toBe(conversation.id);
  });

  it('si el equipo responde una resuelta, se reabre y el visitante la sigue viendo', async () => {
    const { owner, widget, externalId, conversation } = await setupChat('resolve-reopen');
    await createChatMessage(conversation.id, 'visitor', { body: 'Hola' });
    await updateChatConversation(conversation.id, { status: 'resolved' });
    await updateChatConversation(conversation.id, { status: 'open' });
    await createChatMessage(conversation.id, 'user', { body: 'Una cosa más', userId: owner.id });
    const body = await poll(widget.id, externalId);
    expect(body.conversation).toMatchObject({ id: conversation.id, status: 'open' });
    expect(body.messages.map((m) => m.body)).toEqual(['Hola', 'Una cosa más']);
  });
});

// ---------- Chat: bot por palabras clave ----------

describe('Chat: bot por palabras enteras', () => {
  it('tokenize normaliza tildes y descarta palabras vacías', () => {
    expect(tokenize('¿Cuánto cuesta el plan Pro?')).toEqual(['cuanto', 'cuesta', 'plan', 'pro']);
    expect(tokenize('How much is the Pro plan?')).toEqual(['much', 'pro', 'plan']);
    expect(tokenize('Quanto custa o plano Pro? Não sei')).toEqual(['quanto', 'custa', 'plano', 'pro', 'sei']);
  });

  it('no coincide por substring (es, en, pt)', () => {
    // es: "pro" no es "problema", "plan" no es "planilla".
    expect(scoreCandidate(tokenize('¿cuánto cuesta el plan pro?'), 'problemas', 'Lamentamos el problema')).toBe(0);
    expect(scoreCandidate(tokenize('plan'), 'Planilla de horarios', 'Descargá la planilla')).toBe(0);
    // en: "art" no es "start", "use" no es "user".
    expect(scoreCandidate(tokenize('art supplies use'), 'Getting started', 'Every user can start here')).toBe(0);
    // pt: "pro" no es "produto".
    expect(scoreCandidate(tokenize('plano pro'), 'Produto', 'Problema com o produto')).toBe(0);
  });

  it('coincide por palabra entera, sin tildes y con plurales cortos', () => {
    // es: "envío" en el título, "precios" en el cuerpo.
    expect(scoreCandidate(tokenize('¿Hacen envios?'), 'Envío', 'Enviamos a todo el país')).toBe(2);
    expect(scoreCandidate(tokenize('precio del plan'), 'Planes', 'Los precios de cada plan')).toBe(3);
    // en
    expect(scoreCandidate(tokenize('refund policy'), 'Refunds', 'Our policy: 30 days')).toBe(3);
    // pt
    expect(scoreCandidate(tokenize('Qual é o preço do plano?'), 'Preços', 'Cada plano tem um preço')).toBe(3);
  });

  it('una sola palabra en el cuerpo no alcanza el mínimo', () => {
    expect(BOT_MIN_SCORE).toBe(2);
    expect(scoreCandidate(tokenize('horario'), 'Contacto', 'Atendemos en horario comercial')).toBe(1);
  });

  it('findBotReply no contesta "Lamentamos el problema" a "¿cuánto cuesta el plan pro?"', async () => {
    const owner = await makeUser('bot-words');
    const widget = await createChatWidget(owner.id, null, { name: 'bot words' });
    await updateChatWidget(widget.id, { botEnabled: true, botSource: 'canned' });
    await createCannedResponse(widget.id, { shortcut: 'problemas', title: 'problemas', body: 'Lamentamos el problema' });
    await createCannedResponse(widget.id, { shortcut: 'precios', title: 'Plan Pro', body: 'El plan Pro cuesta 10 USD' });
    const fresh = (await getChatWidget(widget.id))!;

    const reply = await findBotReply(fresh, '¿cuánto cuesta el plan pro?');
    expect(reply?.body).toBe('El plan Pro cuesta 10 USD');

    const none = await findBotReply(fresh, '¿a qué hora abren?');
    expect(none).toBeNull();
  });
});

// ---------- Agents: error del modelo en la página pública ----------

const ENV_KEYS = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'VERCEL', 'AI_ENABLED', 'RATE_LIMIT_DISABLED'];
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

function noCreditsModel() {
  const fail = async (): Promise<never> => {
    throw Object.assign(new Error('Insufficient funds: please top-up your credits'), { statusCode: 402 });
  };
  return new MockLanguageModelV4({ modelId: 'broke', doGenerate: fail, doStream: fail });
}

async function setupAgent(label: string, patch: AgentUpdatePayload = {}) {
  const owner = await makeUser(label);
  const created = await createAgent(owner.id, owner.id, { name: `${label} agent` });
  const res = await updateAgent(owner.id, created.id, { publicHandle: `${label}-${crypto.randomUUID().slice(0, 8)}`, ...patch });
  if (!res.ok) throw new Error(res.error);
  return { owner, agent: (await getAgentRow(owner.id, created.id)) as AgentRow };
}

async function readStream(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const TOOLS_BASE = { calEventTypeId: null, calDays: 7, trackProjectId: null, flowIds: [], robotIds: [], docsPageIds: [], docsActorId: null, httpAllowedDomains: [], requireApproval: [] };

describe('Agents: el visitante nunca ve el error pensado para el dueño', () => {
  it('publicErrorCode deja pasar solo lo que el visitante puede entender', () => {
    expect(publicErrorCode('ai_no_credits')).toBe('unavailable');
    expect(publicErrorCode('ai_auth')).toBe('unavailable');
    expect(publicErrorCode('quota_exceeded')).toBe('unavailable');
    expect(publicErrorCode('ai_disabled')).toBe('unavailable');
    expect(publicErrorCode('generic')).toBe('unavailable');
    expect(publicErrorCode('rate_limited')).toBe('rate_limited');
    expect(publicErrorCode('conversation_not_found')).toBe('conversation_not_found');
  });

  it('sin derivación: la página pública recibe "unavailable" y el playground el detalle', async () => {
    const { agent } = await setupAgent('pub-err', { tools: { enabled: ['search_knowledge'], ...TOOLS_BASE } });
    setAiModelOverride(noCreditsModel());
    const pub = await readStream(await streamAgentReply({ agent, channel: 'public', visitorKey: 'v'.repeat(20), text: 'hola' }));
    expect(pub.at(-1)).toEqual({ type: 'error', code: 'unavailable' });

    const play = await readStream(await streamAgentReply({ agent, channel: 'playground', text: 'hola' }));
    expect(play.at(-1)).toEqual({ type: 'error', code: 'ai_no_credits' });
  });

  it('con derivación: el visitante recibe el mensaje de derivación y la conversación pasa al equipo', async () => {
    const { agent } = await setupAgent('pub-ho', {
      tools: { enabled: ['handoff_to_human'], ...TOOLS_BASE },
    });
    setAiModelOverride(noCreditsModel());
    const res = await sendAgentMessage({ agent, channel: 'public', visitorKey: 'w'.repeat(20), text: 'hola, necesito ayuda' });
    expect(res.result).toMatchObject({ status: 'handoff', handoff: true });
    expect(res.result.text).toContain('equipo');
    expect(res.reply?.content).toBe(res.result.text);
    expect((await getConversationRow(res.conversation.id))?.handed_off).toBe(1);

    // El stream termina con "done" (sin error) y handoff.
    const events = await readStream(
      await streamAgentReply({ agent, channel: 'public', visitorKey: 'x'.repeat(20), text: 'hello' }),
    );
    expect(events.at(-1)).toMatchObject({ type: 'done', handoff: true });
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('el playground sigue fallando con el código accionable aunque el agente derive', async () => {
    const { agent } = await setupAgent('play-ho', { tools: { enabled: ['handoff_to_human'], ...TOOLS_BASE } });
    setAiModelOverride(noCreditsModel());
    await expect(sendAgentMessage({ agent, channel: 'playground', text: 'hola' })).rejects.toBeTruthy();
  });
});
