import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAiModelOverride } from '@/lib/ai';
import { getDb } from '@/lib/db';
import { addMessage, createAccount, upsertThread } from '@/lib/inbox/core';
import { inboxAiState, inboxAiStream, inboxAiText, pickStyleSamples, STREAM_ERROR_MARK } from '@/lib/inbox/ai';
import { InboxError } from '@/lib/inbox/types';
import { makeUser } from './helpers';

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** Modelo que guarda el pedido y responde `text` de a palabras (o falla después de `failAfter` pedazos). */
function streamingModel(text: string, seen: { prompt: string }, failAfter = -1) {
  return new MockLanguageModelV4({
    modelId: 'mock-inbox',
    doStream: async (opts) => {
      seen.prompt = JSON.stringify(opts.prompt);
      const words = text.split(/(?<= )/);
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'text-start', id: 't' });
            words.forEach((delta, i) => {
              if (i === failAfter) c.enqueue({ type: 'error', error: new Error('cut') });
              else c.enqueue({ type: 'text-delta', id: 't', delta });
            });
            c.enqueue({ type: 'text-end', id: 't' });
            c.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE });
            c.close();
          },
        }),
      } as never;
    },
  });
}

function brokeModel() {
  const fail = async (): Promise<never> => {
    throw Object.assign(new Error('Insufficient funds'), { statusCode: 402 });
  };
  return new MockLanguageModelV4({ modelId: 'broke', doGenerate: fail, doStream: fail });
}

async function chat() {
  const owner = (await makeUser('inbox-ai')).id;
  const acc = await createAccount(owner, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
  const t = await upsertThread(acc, { externalId: `54911${Math.floor(Math.random() * 1e8)}@s.whatsapp.net`, kind: 'dm', title: 'Caro' });
  const at = (m: number) => new Date(Date.UTC(2026, 10, 1, 12, m)).toISOString();
  await addMessage(t, { externalId: 'a', fromMe: true, body: 'dale genio, nos vemos', sentAt: at(1) });
  await addMessage(t, { externalId: 'b', fromMe: true, body: 'jaja sii', sentAt: at(2) });
  await addMessage(t, { externalId: 'c', fromMe: false, senderName: 'Caro', body: '¿A qué hora es el asado?', sentAt: at(3) });
  return { owner, thread: t };
}

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('INBOX_FAKE', '');
  vi.stubEnv('OPENROUTER_API_KEY', '');
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
  vi.stubEnv('VERCEL_OIDC_TOKEN', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('AI_FREE_TOKENS_PER_MONTH', 'unlimited');
});
afterEach(() => {
  setAiModelOverride(null);
  vi.unstubAllEnvs();
});

describe('Inbox IA: tono de la persona', () => {
  it('usa primero lo que escribió en el chat, sin repetidos, y completa con otros chats si hay pocos', () => {
    expect(pickStyleSamples(['dale', 'Dale', ' ', 'nos vemos'], ['otro chat'])).toEqual(['dale', 'nos vemos', 'otro chat']);
    const many = Array.from({ length: 10 }, (_, i) => `mensaje ${i}`);
    expect(pickStyleSamples(many, ['otro chat'])).not.toContain('otro chat');
    expect(pickStyleSamples(['x'.repeat(500)], [])[0]).toHaveLength(300);
  });
});

describe('Inbox IA: proveedor', () => {
  it('sin OpenRouter ni Gateway dice que no está configurada, con un código claro', async () => {
    const { owner, thread } = await chat();
    expect(inboxAiState()).toBe('not_configured');
    await expect(inboxAiText(owner, { action: 'draft', threadId: thread.id })).rejects.toMatchObject({ code: 'ai_not_configured', status: 503 });
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    expect(inboxAiState()).toBe('ready');
    vi.stubEnv('AI_ENABLED', 'false');
    expect(inboxAiState()).toBe('disabled');
  });

  it('el borrador lleva la conversación, la instrucción y los ejemplos de cómo escribe la persona, y llega de a pedazos', async () => {
    const { owner, thread } = await chat();
    const seen = { prompt: '' };
    setAiModelOverride(streamingModel('a las 8 arrancamos, traé hielo', seen));
    const stream = await inboxAiStream(owner, { action: 'draft', threadId: thread.id, instruction: 'decile que a las 8' });
    const chunks: string[] = [];
    const dec = new TextDecoder();
    for await (const c of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(dec.decode(c));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe('a las 8 arrancamos, traé hielo');
    expect(seen.prompt).toContain('decile que a las 8');
    expect(seen.prompt).toContain('¿A qué hora es el asado?');
    expect(seen.prompt).toContain('Examples of how I write');
    expect(seen.prompt).toContain('dale genio, nos vemos');
    const usage = await getDb().prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND feature = 'inbox_draft'").get(owner);
    expect(Number((usage as { n: number }).n)).toBe(1);
  });

  it('refinar manda el borrador y el cambio pedido con el contexto del chat', async () => {
    const { owner, thread } = await chat();
    const seen = { prompt: '' };
    setAiModelOverride(streamingModel('a las 8', seen));
    const text = await inboxAiText(owner, { action: 'rewrite', threadId: thread.id, text: 'a las 8 arrancamos, traé hielo', mode: 'custom', instruction: 'sin el hielo' });
    expect(text).toBe('a las 8');
    expect(seen.prompt).toContain('a las 8 arrancamos, traé hielo');
    expect(seen.prompt).toContain('¿A qué hora es el asado?');
  });

  it('si el proveedor falla de entrada (sin crédito) tira ai_failed antes de abrir el stream', async () => {
    const { owner, thread } = await chat();
    setAiModelOverride(brokeModel());
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = inboxAiStream(owner, { action: 'draft', threadId: thread.id });
    await expect(r).rejects.toBeInstanceOf(InboxError);
    await expect(r).rejects.toMatchObject({ code: 'ai_failed', status: 502 });
    err.mockRestore();
  });

  it('si se corta a mitad, el stream termina con la marca de error', async () => {
    const { owner, thread } = await chat();
    setAiModelOverride(streamingModel('uno dos tres cuatro', { prompt: '' }, 2));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const text = await new Response(await inboxAiStream(owner, { action: 'draft', threadId: thread.id })).text();
    expect(text.startsWith('uno dos ')).toBe(true);
    expect(text).toContain(`${STREAM_ERROR_MARK}ai_failed`);
    await expect(inboxAiText(owner, { action: 'draft', threadId: thread.id })).rejects.toBeDefined();
    err.mockRestore();
  });

  it('modo de prueba (INBOX_FAKE) responde sin proveedor', async () => {
    vi.stubEnv('INBOX_FAKE', '1');
    const { owner, thread } = await chat();
    expect(await inboxAiText(owner, { action: 'draft', threadId: thread.id, instruction: 'decile que sí' })).toBe('Borrador: decile que sí');
    expect(await inboxAiText(owner, { action: 'rewrite', text: 'Hola. Todo bien.', mode: 'shorter' })).toBe('Hola.');
  });
});
