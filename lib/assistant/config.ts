/**
 * Motor del asistente de la plataforma: DeepSeek por OpenRouter.
 *
 * Por qué AI SDK y no el Claude Agent SDK: el Agent SDK corre su CLI como
 * subproceso y en la 0.3.x ese CLI es un binario nativo de ~280 MB por
 * plataforma (linux-x64: 294 MB descomprimido), por encima del tope de 250 MB
 * de una función de Vercel; además pide zod 4 (el repo usa zod 3) y cada
 * turno arranca un proceso nuevo. El loop de herramientas corre entonces con
 * el AI SDK que ya usa la suite, contra la API compatible con OpenAI de
 * OpenRouter y el mismo modelo de DeepSeek.
 *
 * Sin OPENROUTER_API_KEY el asistente queda "sin configurar" (la UI lo dice,
 * nada tira). ASSISTANT_FAKE=1 usa un modelo falso (e2e, nunca en un deploy
 * de producción).
 */
import type { LanguageModel } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
/** Modelo de DeepSeek vigente en OpenRouter con tool calling (octubre 2026). */
export const DEFAULT_ASSISTANT_MODEL = 'deepseek/deepseek-v4.1-flash';

let modelOverride: LanguageModel | null = null;

/** Tests: inyecta un modelo (MockLanguageModelV4). null lo quita. */
export function setAssistantModelOverride(model: LanguageModel | null): void {
  modelOverride = model;
}

export function assistantModelId(): string {
  return process.env.ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL;
}

/** Modo falso de e2e: solo con ASSISTANT_FAKE=1 y nunca en producción de Vercel. */
export function assistantFake(): boolean {
  return process.env.ASSISTANT_FAKE === '1' && process.env.VERCEL_ENV !== 'production';
}

export type AssistantState = 'ready' | 'not_configured' | 'disabled';

export function assistantState(): AssistantState {
  if (modelOverride) return 'ready';
  if (process.env.AI_ENABLED === 'false') return 'disabled';
  if (assistantFake()) return 'ready';
  return process.env.OPENROUTER_API_KEY?.trim() ? 'ready' : 'not_configured';
}

/**
 * Modelo a usar. null = sin configurar (el llamador responde not_configured).
 * `fake` arma el modelo falso cuando ASSISTANT_FAKE está prendido.
 */
export function resolveAssistantModel(fake: () => LanguageModel): { model: LanguageModel; modelId: string } | null {
  if (modelOverride) {
    const id = typeof modelOverride === 'string' ? modelOverride : modelOverride.modelId;
    return { model: modelOverride, modelId: id };
  }
  const state = assistantState();
  if (state !== 'ready') return null;
  if (assistantFake()) return { model: fake(), modelId: 'assistant-fake' };
  const key = process.env.OPENROUTER_API_KEY!.trim();
  const provider = createOpenAICompatible({
    name: 'openrouter',
    baseURL: OPENROUTER_BASE_URL,
    apiKey: key,
    includeUsage: true,
    headers: {
      // Atribución opcional de OpenRouter (ranking de apps); no es un secreto.
      'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://zerosoft.ai',
      'X-Title': 'zerosoft assistant',
    },
  });
  const modelId = assistantModelId();
  return { model: provider.chatModel(modelId), modelId: `openrouter:${modelId}` };
}
