import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AiError,
  aiEnabled,
  aiFreeTokensPerMonth,
  aiGenerateText,
  getAiUsage,
  monthStartIso,
  recordAiUsage,
  setAiModelOverride,
} from '@/lib/ai';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';
import { mockModel } from './ai-mock';

const ENV_KEYS = [
  'AI_GATEWAY_API_KEY',
  'VERCEL_OIDC_TOKEN',
  'VERCEL',
  'AI_ENABLED',
  'AI_FREE_TOKENS_PER_MONTH',
  'AI_RATE_LIMIT_PER_MINUTE',
  'AI_MODEL',
];
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

describe('configuración de AI', () => {
  it('está apagada sin key ni OIDC, y se prende con la key del Gateway', () => {
    expect(aiEnabled()).toBe(false);
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    expect(aiEnabled()).toBe(true);
    process.env.AI_ENABLED = 'false';
    expect(aiEnabled()).toBe(false);
  });

  it('cuota gratis: default, número y unlimited', () => {
    expect(aiFreeTokensPerMonth()).toBe(200_000);
    process.env.AI_FREE_TOKENS_PER_MONTH = '5000';
    expect(aiFreeTokensPerMonth()).toBe(5000);
    process.env.AI_FREE_TOKENS_PER_MONTH = 'unlimited';
    expect(aiFreeTokensPerMonth()).toBeNull();
  });

  it('sin AI configurada, aiGenerateText tira ai_disabled y no registra uso', async () => {
    const u = await makeUser('ai-off');
    await expect(aiGenerateText({ workspaceId: u.id, feature: 'test', prompt: 'hola' })).rejects.toMatchObject({
      code: 'ai_disabled',
    });
    expect((await getAiUsage(u.id)).totalTokens).toBe(0);
  });
});

describe('aiGenerateText', () => {
  it('registra el uso por workspace, feature y modelo', async () => {
    const u = await makeUser('ai-rec');
    setAiModelOverride(mockModel('Hola!', 120, 30));
    const res = await aiGenerateText({ workspaceId: u.id, feature: 'chat_bot', prompt: 'hola' });
    expect(res.text).toBe('Hola!');
    expect(res.inputTokens).toBe(120);
    expect(res.outputTokens).toBe(30);

    const rows = (await getDb().prepare('SELECT * FROM ai_usage WHERE user_id = ?').all(u.id)) as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: 'chat_bot', model: 'mock-model', input_tokens: 120, output_tokens: 30 });

    const usage = await getAiUsage(u.id);
    expect(usage.totalTokens).toBe(150);
    expect(usage.byFeature).toEqual([{ feature: 'chat_bot', tokens: 150 }]);
  });

  it('el uso de un workspace no cuenta para otro', async () => {
    const a = await makeUser('ai-a');
    const b = await makeUser('ai-b');
    await recordAiUsage({ workspaceId: a.id, feature: 'x', model: 'm', inputTokens: 10, outputTokens: 5 });
    expect((await getAiUsage(a.id)).totalTokens).toBe(15);
    expect((await getAiUsage(b.id)).totalTokens).toBe(0);
  });

  it('el uso de meses anteriores no cuenta', async () => {
    const u = await makeUser('ai-month');
    const lastMonth = new Date(Date.parse(monthStartIso()) - 24 * 3600 * 1000).toISOString();
    await getDb()
      .prepare(
        'INSERT INTO ai_usage (id, user_id, feature, model, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(crypto.randomUUID(), u.id, 'x', 'm', 999_999, 0, lastMonth);
    expect((await getAiUsage(u.id)).totalTokens).toBe(0);
  });

  it('corta al agotar la cuota mensual gratis', async () => {
    const u = await makeUser('ai-quota');
    process.env.AI_FREE_TOKENS_PER_MONTH = '1000';
    const model = mockModel('ok', 600, 100);
    setAiModelOverride(model);
    await aiGenerateText({ workspaceId: u.id, feature: 'chat_bot', prompt: 'a' }); // 700
    await aiGenerateText({ workspaceId: u.id, feature: 'chat_bot', prompt: 'b' }); // 1400 (en vuelo)
    const err = await aiGenerateText({ workspaceId: u.id, feature: 'chat_bot', prompt: 'c' }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe('quota_exceeded');
    expect(model.doGenerateCalls).toHaveLength(2);
    const usage = await getAiUsage(u.id);
    expect(usage.totalTokens).toBe(1400);
    expect(usage.overageTokens).toBe(400);

    // Sin cuota (self-host) sigue.
    process.env.AI_FREE_TOKENS_PER_MONTH = 'unlimited';
    await expect(aiGenerateText({ workspaceId: u.id, feature: 'chat_bot', prompt: 'd' })).resolves.toMatchObject({
      text: 'ok',
    });
  });

  it('aplica rate limit por workspace', async () => {
    const u = await makeUser('ai-rl');
    process.env.AI_RATE_LIMIT_PER_MINUTE = '2';
    setAiModelOverride(mockModel('ok', 1, 1));
    await aiGenerateText({ workspaceId: u.id, feature: 't', prompt: 'a' });
    await aiGenerateText({ workspaceId: u.id, feature: 't', prompt: 'b' });
    await expect(aiGenerateText({ workspaceId: u.id, feature: 't', prompt: 'c' })).rejects.toMatchObject({
      code: 'rate_limited',
    });
    // Otro workspace no se ve afectado.
    const other = await makeUser('ai-rl2');
    await expect(aiGenerateText({ workspaceId: other.id, feature: 't', prompt: 'a' })).resolves.toBeTruthy();
  });
});
