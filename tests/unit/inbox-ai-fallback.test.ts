import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** Un modelo que termina sin escribir nada (lo que hacía DeepSeek por OpenRouter). */
const empty = () =>
  new MockLanguageModelV4({
    modelId: 'empty',
    doStream: async () =>
      ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE });
            c.close();
          },
        }),
      }) as never,
  });

vi.mock('@/lib/assistant/config', async (orig) => ({ ...(await orig<typeof import('@/lib/assistant/config')>()), openRouterChatModel: () => empty() }));

import { setAiModelOverride } from '@/lib/ai';
import { withoutReasoning } from '@/lib/assistant/config';
import { addMessage, createAccount, upsertThread } from '@/lib/inbox/core';
import { aiFailureLogLine, inboxAiText } from '@/lib/inbox/ai';
import { makeUser } from './helpers';

function words(text: string) {
  return new MockLanguageModelV4({
    modelId: 'gateway-mock',
    doStream: async () =>
      ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'text-start', id: 't' });
            c.enqueue({ type: 'text-delta', id: 't', delta: text });
            c.enqueue({ type: 'text-end', id: 't' });
            c.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE });
            c.close();
          },
        }),
      }) as never,
  });
}

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('INBOX_FAKE', '');
  vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
  vi.stubEnv('AI_FREE_TOKENS_PER_MONTH', 'unlimited');
});
afterEach(() => {
  setAiModelOverride(null);
  vi.unstubAllEnvs();
});

describe('Inbox IA: si un modelo no escribe nada, prueba el siguiente', () => {
  it('OpenRouter vacío → responde el Gateway', async () => {
    const owner = (await makeUser('inbox-ai-fb')).id;
    const acc = await createAccount(owner, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    const t = await upsertThread(acc, { externalId: `54911${Math.floor(Math.random() * 1e8)}@s.whatsapp.net`, kind: 'dm', title: 'Ana' });
    await addMessage(t, { externalId: 'a', fromMe: false, senderName: 'Ana', body: '¿Mañana?', sentAt: new Date(Date.UTC(2026, 10, 1, 12)).toISOString() });
    setAiModelOverride(words('dale, mañana'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await inboxAiText(owner, { action: 'draft', threadId: t.id })).toBe('dale, mañana');
    expect(err).toHaveBeenCalledWith(expect.stringContaining('EmptyResponse'));
    err.mockRestore();
  });

  it('el pedido a OpenRouter va sin razonamiento (salvo que se pida)', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (_: unknown, init?: RequestInit) => {
      seen.push(String(init?.body));
      return new Response('{}');
    });
    await withoutReasoning('https://x', { method: 'POST', body: JSON.stringify({ model: 'm' }) });
    await withoutReasoning('https://x', { method: 'POST', body: JSON.stringify({ model: 'm', reasoning: { effort: 'high' } }) });
    vi.unstubAllGlobals();
    expect(JSON.parse(seen[0]).reasoning).toEqual({ enabled: false });
    expect(JSON.parse(seen[1]).reasoning).toEqual({ effort: 'high' });
  });
});

describe('Inbox IA: el log de un fallo no lleva contenido', () => {
  it('solo nombre, estado y código; nunca el mensaje del proveedor', () => {
    const err = Object.assign(new Error('Bad request: "hola, te paso mi clave 1234"'), { name: 'AI_APICallError', statusCode: 400, code: 'invalid_request' });
    const line = aiFailureLogLine('openrouter', 'openrouter:m', err);
    expect(line).toBe('[inbox-ai] openrouter openrouter:m failed: AI_APICallError 400 invalid_request');
    expect(line).not.toContain('clave');
  });

  it('un nombre o código raro no se copia al log', () => {
    const line = aiFailureLogLine('gateway', 'g', { name: 'texto del chat con espacios', code: 'x y z', message: 'secreto' });
    expect(line).toBe('[inbox-ai] gateway g failed: Error');
    expect(aiFailureLogLine('gateway', 'g', null)).toBe('[inbox-ai] gateway g failed: Error');
  });
});
