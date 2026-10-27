/**
 * Agents — acceso al modelo para el runtime del agente y para lo que corre
 * alrededor (juez de tests, cliente simulado, puntaje de conversaciones,
 * memoria, chequeo de reglas). Todo pasa por lib/ai.ts (cuota, rate limit,
 * ai_usage).
 *
 * En e2e (AGENTS_AI_FAKE=1, nunca en un deploy de producción) un request con
 * la cookie `agents_ai_fake=on` corre contra el modelo falso de
 * lib/crm-ai-fake.ts: la cuota y ai_usage se miden igual. Es opt-in (con
 * cookie) para que el resto de la suite siga viendo el agente sin AI. Fuera de
 * un request (cron) el fake no se activa.
 * Server-only.
 */
import { generateText, Output, type LanguageModel } from 'ai';
import type { z } from 'zod';
import { aiEnabled, aiGenerateObject, AiError, assertAiAvailable, assertAiQuota, recordAiUsage, resolveAiModel } from './ai';
import { fakeModel, type FakeCallInfo, type FakeStep } from './crm-ai-fake';

export const AGENTS_FEATURE = 'agents';

let cookieReader: (() => Promise<string | undefined>) | null = null;

/** Para tests: cómo se lee la cookie agents_ai_fake. */
export function setAgentsFakeCookieReader(fn: (() => Promise<string | undefined>) | null): void {
  cookieReader = fn;
}

async function fakeCookie(): Promise<string | undefined> {
  if (cookieReader) return cookieReader();
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get('agents_ai_fake')?.value;
  } catch {
    return undefined;
  }
}

/** true si este request corre los agentes contra el modelo falso. */
export async function agentsAiFakeActive(): Promise<boolean> {
  if (process.env.AGENTS_AI_FAKE !== '1' || process.env.VERCEL_ENV === 'production') return false;
  return (await fakeCookie()) === 'on';
}

/** ¿Hay modelo para los agentes en este request? (Gateway configurado o el fake de e2e). */
export async function agentsAiEnabled(): Promise<boolean> {
  return aiEnabled() || (await agentsAiFakeActive());
}

/**
 * Paso del modelo falso para el runtime del agente. Determinista:
 * - "/tool <nombre> {json}" en el mensaje llama esa herramienta (e2e de MCP);
 * - pedir una persona llama handoff_to_human si está activa;
 * - si debe buscar en el conocimiento, busca con el mensaje y responde con el
 *   primer pasaje citándolo ([n]);
 * - si no, un eco del mensaje.
 */
export function fakeAgentStep(info: FakeCallInfo): FakeStep {
  const last = info.userTexts[info.userTexts.length - 1] ?? '';
  const done = info.toolResults;
  const cmd = /\/tool\s+([A-Za-z0-9_-]+)\s*(\{[\s\S]*\})?/.exec(last);
  if (cmd && !done.some((r) => r.tool === cmd[1])) {
    let input: Record<string, unknown> = {};
    try {
      input = cmd[2] ? (JSON.parse(cmd[2]) as Record<string, unknown>) : {};
    } catch {
      input = {};
    }
    return { tool: cmd[1], input };
  }
  if (/\b(human|person|persona|humano|pessoa)\b/i.test(last) && info.system.includes('handoff_to_human') && done.length === 0) {
    return { tool: 'handoff_to_human', input: { reason: 'The visitor asked for a person' } };
  }
  if (info.system.includes('call search_knowledge') && !done.some((r) => r.tool === 'search_knowledge') && !cmd) {
    return { tool: 'search_knowledge', input: { query: last.slice(0, 300) || 'help' } };
  }
  const knowledge = done.find((r) => r.tool === 'search_knowledge')?.output as
    | { results?: Array<{ ref?: number; title?: string; text?: string }> }
    | undefined;
  const first = knowledge?.results?.[0];
  if (first) return { text: `${String(first.text ?? '').slice(0, 240)} [${first.ref ?? 1}]` };
  if (done.length) return { text: `Done: ${JSON.stringify(done[done.length - 1].output ?? null).slice(0, 200)}` };
  return { text: `Fake reply: ${last.slice(0, 160)}` };
}

/**
 * Modelo del runtime del agente: el falso en e2e, o el del Gateway (con el
 * override del agente). Chequea cuota y rate limit como siempre.
 */
export async function agentRuntimeModel(
  workspaceId: string,
  preferredId: string | null | undefined,
): Promise<{ model: LanguageModel; modelId: string }> {
  if (await agentsAiFakeActive()) {
    await assertAiQuota(workspaceId);
    return { model: fakeModel(fakeAgentStep), modelId: 'agents-fake' };
  }
  await assertAiAvailable(workspaceId);
  return resolveAiModel(preferredId);
}

/**
 * Salida estructurada para el juez, el cliente simulado, el puntaje y la
 * memoria. `fake` arma la respuesta del modelo falso en e2e.
 */
export async function agentsObject<T>(opts: {
  workspaceId: string;
  instructions: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaName: string;
  fake: () => T;
  maxOutputTokens?: number;
  temperature?: number;
}): Promise<T> {
  if (await agentsAiFakeActive()) {
    await assertAiQuota(opts.workspaceId);
    const result = await generateText({
      model: fakeModel(() => ({ text: JSON.stringify(opts.fake()) })),
      instructions: opts.instructions,
      prompt: opts.prompt,
      output: Output.object({ schema: opts.schema, name: opts.schemaName }),
    });
    await recordAiUsage({
      workspaceId: opts.workspaceId,
      feature: AGENTS_FEATURE,
      model: 'agents-fake',
      inputTokens: result.totalUsage?.inputTokens ?? 0,
      outputTokens: result.totalUsage?.outputTokens ?? 0,
    }).catch(() => {});
    return result.output as T;
  }
  if (!aiEnabled()) throw new AiError('ai_disabled');
  const { object } = await aiGenerateObject({
    workspaceId: opts.workspaceId,
    feature: AGENTS_FEATURE,
    instructions: opts.instructions,
    prompt: opts.prompt,
    schema: opts.schema,
    schemaName: opts.schemaName,
    temperature: opts.temperature ?? 0,
    maxOutputTokens: opts.maxOutputTokens ?? 600,
  });
  return object;
}
