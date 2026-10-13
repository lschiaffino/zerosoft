import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import type { ChatWidgetRow } from '@/lib/db';
import { getAiUsage, setAiModelOverride } from '@/lib/ai';
import {
  createCannedResponse,
  createChatConversation,
  createChatMessage,
  createChatWidget,
  getChatConversation,
  getOrCreateChatVisitor,
  getVisitorConversationWithMessages,
  listChatMessages,
} from '@/lib/chat-data';
import {
  HANDOFF_MARKER,
  HANDOFF_SYSTEM_PREFIX,
  dispatchChatBot,
  retrieveKnowledge,
  runAiBotReply,
  toModelMessages,
} from '@/lib/chat-bot-ai';
import { makeUser } from './helpers';
import { failingModel, mockModel } from './ai-mock';

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

async function addDocsPage(userId: string, title: string, text: string): Promise<void> {
  const content = JSON.stringify([{ id: crypto.randomUUID(), type: 'paragraph', content: text }]);
  await getDb()
    .prepare('INSERT INTO docs_pages (id, user_id, title, content) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), userId, title, content);
}

async function setup(label: string, botSource: 'ai' | 'canned' | 'docs' = 'ai') {
  const owner = await makeUser(label);
  const widget = await createChatWidget(owner.id, null, { name: `${label} widget`, botEnabled: true, botSource });
  const visitor = await getOrCreateChatVisitor(widget.id, `ext-${crypto.randomUUID()}`);
  const conversation = await createChatConversation(widget.id, visitor.id);
  return { owner, widget, visitor, conversation };
}

async function visitorSays(conversationId: string, body: string) {
  return createChatMessage(conversationId, 'visitor', { body });
}

describe('migración bot_source = ai', () => {
  it('chat_widgets acepta bot_source "ai"', async () => {
    const { widget } = await setup('mig');
    expect(widget.bot_source).toBe('ai');
  });
});

describe('retrieveKnowledge', () => {
  it('trae solo docs del workspace dueño del widget (aislamiento)', async () => {
    const a = await setup('iso-a');
    const b = await makeUser('iso-b');
    await addDocsPage(a.owner.id, 'Shipping policy', 'We ship worldwide in 5 business days. Shipping is free over 50 USD.');
    await addDocsPage(b.id, 'Shipping secrets', 'SECRET-B: internal shipping costs and margins for workspace B.');

    const chunks = await retrieveKnowledge(a.widget, 'how long does shipping take?');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].title).toBe('Shipping policy');
    expect(chunks.some((c) => c.text.includes('SECRET-B'))).toBe(false);
  });

  it('ignora páginas archivadas e incluye canned responses del widget', async () => {
    const { owner, widget } = await setup('ret');
    await addDocsPage(owner.id, 'Refunds', 'Refunds are processed within 10 days.');
    await getDb().prepare("UPDATE docs_pages SET archived = 1 WHERE user_id = ? AND title = 'Refunds'").run(owner.id);
    await createCannedResponse(widget.id, { shortcut: 'refund', title: 'Refund policy', body: 'Full refund within 30 days.' });
    const chunks = await retrieveKnowledge(widget, 'refund please');
    expect(chunks.map((c) => c.kind)).toEqual(['canned']);
    expect(chunks[0].text).toBe('Full refund within 30 days.');
  });

  it('rankea por relevancia (BM25) y tolera acentos', async () => {
    const { owner, widget } = await setup('rank');
    await addDocsPage(owner.id, 'Horarios', 'Atención de lunes a viernes de 9 a 18. Envíos a todo el país.');
    await addDocsPage(owner.id, 'Precios', 'El plan básico cuesta 10 USD por mes.');
    const chunks = await retrieveKnowledge(widget, '¿Cuál es el horario de atencion?');
    expect(chunks[0].title).toBe('Horarios');
  });
});

describe('toModelMessages', () => {
  it('mapea visitante/bot, une mensajes seguidos y descarta sistema y bot inicial', () => {
    const base = { conversation_id: 'c', user_id: null, attachments: '[]', read_at: null, created_at: '' };
    const msgs = toModelMessages([
      { ...base, id: '1', sender_type: 'bot', body: 'Hi!' },
      { ...base, id: '2', sender_type: 'visitor', body: 'hello' },
      { ...base, id: '3', sender_type: 'visitor', body: 'anyone?' },
      { ...base, id: '4', sender_type: 'system', body: 'x' },
      { ...base, id: '5', sender_type: 'bot', body: 'Yes' },
    ]);
    expect(msgs).toEqual([
      { role: 'user', content: 'hello\n\nanyone?' },
      { role: 'assistant', content: 'Yes' },
    ]);
  });
});

describe('bot AI', () => {
  it('responde con el modelo, con el conocimiento del workspace en el prompt, y registra uso', async () => {
    const { owner, widget, conversation } = await setup('reply');
    await addDocsPage(owner.id, 'Opening hours', 'We are open Monday to Friday from 9am to 6pm.');
    const model = mockModel('We are open Mon-Fri, 9am to 6pm.', 300, 20);
    setAiModelOverride(model);

    const m1 = await visitorSays(conversation.id, 'What are your opening hours?');
    const out = await runAiBotReply(widget, conversation.id, m1.id);
    expect(out.status).toBe('replied');
    expect(out.message?.sender_type).toBe('bot');
    expect(out.message?.body).toBe('We are open Mon-Fri, 9am to 6pm.');

    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain('Monday to Friday from 9am to 6pm');
    expect(prompt).toContain('What are your opening hours?');

    const usage = await getAiUsage(owner.id);
    expect(usage.totalTokens).toBe(320);
    expect(usage.byFeature).toEqual([{ feature: 'chat_bot', tokens: 320 }]);
  });

  it('responde cada mensaje mientras no conteste un humano, y después se calla', async () => {
    const { widget, conversation } = await setup('multi');
    let n = 0;
    setAiModelOverride(mockModel(() => `answer ${++n}`));

    const m1 = await visitorSays(conversation.id, 'first question');
    expect((await runAiBotReply(widget, conversation.id, m1.id)).status).toBe('replied');
    const m2 = await visitorSays(conversation.id, 'second question');
    expect((await runAiBotReply(widget, conversation.id, m2.id)).status).toBe('replied');

    await createChatMessage(conversation.id, 'user', { body: 'Human here', userId: widget.user_id });
    const m3 = await visitorSays(conversation.id, 'third question');
    expect((await runAiBotReply(widget, conversation.id, m3.id)).status).toBe('skipped');

    const bots = (await listChatMessages(conversation.id)).filter((m) => m.sender_type === 'bot');
    expect(bots.map((m) => m.body)).toEqual(['answer 1', 'answer 2']);
  });

  it('no contesta un mensaje viejo si ya llegó otro más nuevo del visitante', async () => {
    const { widget, conversation } = await setup('stale');
    setAiModelOverride(mockModel('ok'));
    const m1 = await visitorSays(conversation.id, 'hello');
    await visitorSays(conversation.id, 'are you there?');
    expect((await runAiBotReply(widget, conversation.id, m1.id)).status).toBe('skipped');
  });

  it('handoff: publica el mensaje, marca la conversación y deja de responder', async () => {
    const { widget, conversation } = await setup('handoff');
    setAiModelOverride(mockModel(`${HANDOFF_MARKER} Te comunico con una persona del equipo.`));

    const m1 = await visitorSays(conversation.id, 'Quiero hablar con un humano');
    const out = await runAiBotReply(widget, conversation.id, m1.id);
    expect(out.status).toBe('handoff');
    expect(out.message?.body).toBe('Te comunico con una persona del equipo.');

    const conv = await getChatConversation(conversation.id);
    expect(conv?.priority).toBe('high');
    const messages = await listChatMessages(conversation.id);
    expect(messages.some((m) => m.sender_type === 'system' && m.body.startsWith(HANDOFF_SYSTEM_PREFIX))).toBe(true);

    // El visitante no ve el mensaje interno de sistema.
    const visitorView = await getVisitorConversationWithMessages(
      widget.id,
      (await getDb().prepare('SELECT external_id FROM chat_visitors WHERE id = ?').get(conversation.visitor_id) as {
        external_id: string;
      }).external_id,
    );
    expect(visitorView?.messages.some((m) => m.sender_type === 'system')).toBe(false);
    expect(visitorView?.messages.some((m) => m.body === 'Te comunico con una persona del equipo.')).toBe(true);

    const notif = await getDb()
      .prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND source_id = ? AND type = 'chat_message'")
      .get(widget.user_id, conversation.id);
    expect(Number((notif as { c: number }).c)).toBe(1);

    // Tras la derivación el bot no vuelve a hablar.
    const m2 = await visitorSays(conversation.id, 'hola?');
    expect((await runAiBotReply(widget, conversation.id, m2.id)).status).toBe('skipped');
  });

  it('si el modelo falla, cae al bot por keywords', async () => {
    const { widget, conversation } = await setup('fail');
    await createCannedResponse(widget.id, { shortcut: 'price', title: 'Pricing', body: 'Plans start at 10 USD.' });
    setAiModelOverride(failingModel());
    const m1 = await visitorSays(conversation.id, 'what is the pricing?');
    const out = await runAiBotReply(widget, conversation.id, m1.id);
    expect(out.status).toBe('fallback');
    expect(out.message?.body).toBe('Plans start at 10 USD.');
  });

  it('si se agotó la cuota, cae al bot por keywords sin llamar al modelo', async () => {
    const { owner, widget, conversation } = await setup('quota');
    process.env.AI_FREE_TOKENS_PER_MONTH = '10';
    await getDb()
      .prepare(
        'INSERT INTO ai_usage (id, user_id, feature, model, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(crypto.randomUUID(), owner.id, 'chat_bot', 'm', 10, 0, new Date().toISOString());
    await createCannedResponse(widget.id, { shortcut: 'hours', title: 'Hours', body: 'Open 9-18.' });
    const model = mockModel('should not be used');
    setAiModelOverride(model);
    const m1 = await visitorSays(conversation.id, 'opening hours?');
    const out = await runAiBotReply(widget, conversation.id, m1.id);
    expect(out.status).toBe('fallback');
    expect(out.message?.body).toBe('Open 9-18.');
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe('dispatchChatBot', () => {
  it('sin AI configurada usa el bot por keywords al instante', async () => {
    const { widget, conversation } = await setup('dispatch-off');
    await createCannedResponse(widget.id, { shortcut: 'ship', title: 'Shipping', body: 'We ship in 5 days.' });
    const m1 = await visitorSays(conversation.id, 'shipping time?');
    let scheduled = 0;
    const reply = await dispatchChatBot(widget, conversation, m1, () => {
      scheduled += 1;
    });
    expect(scheduled).toBe(0);
    expect(reply?.body).toBe('We ship in 5 days.');
  });

  it('con AI agenda la respuesta (no bloquea) y la publica al correr la tarea', async () => {
    const { widget, conversation } = await setup('dispatch-ai');
    setAiModelOverride(mockModel('Scheduled answer'));
    const m1 = await visitorSays(conversation.id, 'hello there');
    const tasks: Array<() => Promise<void>> = [];
    const reply = await dispatchChatBot(widget, conversation, m1, (task) => tasks.push(task));
    expect(reply).toBeNull();
    expect(tasks).toHaveLength(1);
    // Mientras tanto el widget ve "escribiendo".
    const typing = await getDb()
      .prepare("SELECT COUNT(*) AS c FROM chat_typing WHERE conversation_id = ? AND sender_type = 'user'")
      .get(conversation.id);
    expect(Number((typing as { c: number }).c)).toBe(1);

    await tasks[0]();
    const bots = (await listChatMessages(conversation.id)).filter((m) => m.sender_type === 'bot');
    expect(bots.map((m) => m.body)).toEqual(['Scheduled answer']);
    const after = await getDb()
      .prepare("SELECT COUNT(*) AS c FROM chat_typing WHERE conversation_id = ? AND sender_type = 'user'")
      .get(conversation.id);
    expect(Number((after as { c: number }).c)).toBe(0);
  });

  it('no hace nada con el bot apagado', async () => {
    const { widget, conversation } = await setup('dispatch-disabled');
    const disabled: ChatWidgetRow = { ...widget, bot_enabled: 0 };
    setAiModelOverride(mockModel('nope'));
    const m1 = await visitorSays(conversation.id, 'hello');
    const tasks: Array<() => Promise<void>> = [];
    expect(await dispatchChatBot(disabled, conversation, m1, (t) => tasks.push(t))).toBeNull();
    expect(tasks).toHaveLength(0);
  });
});
