/**
 * Modelo falso para la IA del CRM en e2e (CRM_AI_FAKE=1, ver
 * playwright.config.ts). Implementa la interfaz de modelo del AI SDK (v4) sin
 * llamar a ningún proveedor: cada función de lib/crm-ai*.ts le pasa qué
 * responder. Así el flujo completo (cuota, rate limit, ai_usage, tool calling
 * del asistente, caché) corre igual que con el Gateway.
 *
 * Nunca se activa en producción: además del env hace falta que no sea un
 * deploy de producción de Vercel. Con la cookie `crm_ai_fake=off` el request
 * se comporta como sin IA (para probar el error ai_disabled en e2e).
 */
import type { LanguageModel } from 'ai';

export interface FakeToolCall {
  tool: string;
  input: Record<string, unknown>;
}

/** Lo que el modelo falso devuelve en una llamada: texto o una tool call. */
export type FakeStep = { text: string } | FakeToolCall;

export interface FakeCallInfo {
  /** Instrucciones de sistema. */
  system: string;
  /** Texto de los mensajes del usuario (el último al final). */
  userTexts: string[];
  /** Resultados de herramientas ya ejecutadas en esta corrida (en orden). */
  toolResults: Array<{ tool: string; output: unknown }>;
}

let cookieDisabled: (() => Promise<boolean>) | null = null;

/** Para tests: cómo saber si el request pidió apagar el fake. */
export function setFakeCookieReader(fn: (() => Promise<boolean>) | null): void {
  cookieDisabled = fn;
}

async function requestDisabledFake(): Promise<boolean> {
  if (cookieDisabled) return cookieDisabled();
  try {
    const { cookies } = await import('next/headers');
    const jar = await cookies();
    return jar.get('crm_ai_fake')?.value === 'off';
  } catch {
    // Fuera de un request (cron, workflows en segundo plano): sin cookie.
    return false;
  }
}

/** true si la IA del CRM corre contra el modelo falso en este request. */
export async function crmAiFakeActive(): Promise<boolean> {
  if (process.env.CRM_AI_FAKE !== '1') return false;
  if (process.env.VERCEL_ENV === 'production') return false;
  return !(await requestDisabledFake());
}

/** true si el request pidió explícitamente comportarse como sin IA (solo con CRM_AI_FAKE). */
export async function crmAiForcedOff(): Promise<boolean> {
  if (process.env.CRM_AI_FAKE !== '1') return false;
  return requestDisabledFake();
}

const USAGE = {
  inputTokens: { total: 40, noCache: 40, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => (p && typeof p === 'object' && (p as { type?: string }).type === 'text' ? String((p as { text?: unknown }).text ?? '') : ''))
    .join('');
}

function callInfo(prompt: unknown): FakeCallInfo {
  const userTexts: string[] = [];
  const toolResults: Array<{ tool: string; output: unknown }> = [];
  let system = '';
  if (!Array.isArray(prompt)) return { system, userTexts, toolResults };
  for (const m of prompt as Array<{ role: string; content: unknown }>) {
    if (m.role === 'system') system += textOf(m.content);
    if (m.role === 'user') userTexts.push(textOf(m.content));
    if (m.role === 'tool' && Array.isArray(m.content)) {
      for (const part of m.content as Array<{ type?: string; toolName?: string; output?: { type?: string; value?: unknown } }>) {
        if (part.type !== 'tool-result') continue;
        toolResults.push({ tool: String(part.toolName ?? ''), output: part.output?.value ?? part.output });
      }
    }
  }
  return { system, userTexts, toolResults };
}

function contentFor(step: FakeStep, i: number) {
  if ('text' in step) return { type: 'text' as const, text: step.text };
  return {
    type: 'tool-call' as const,
    toolCallId: `fake-${i}-${crypto.randomUUID().slice(0, 8)}`,
    toolName: step.tool,
    input: JSON.stringify(step.input),
  };
}

/**
 * Modelo falso. `respond` recibe lo que vio el modelo (mensajes del usuario y
 * resultados de herramientas) y devuelve el siguiente paso.
 */
export function fakeModel(respond: (info: FakeCallInfo) => FakeStep): LanguageModel {
  let calls = 0;
  const generate = async (options: { prompt: unknown }) => {
    const step = respond(callInfo(options.prompt));
    const content = contentFor(step, calls++);
    return {
      content: [content],
      finishReason: { unified: content.type === 'text' ? ('stop' as const) : ('tool-calls' as const), raw: undefined },
      usage: USAGE,
      warnings: [],
    };
  };
  const model = {
    specificationVersion: 'v4',
    provider: 'zerosoft-fake',
    modelId: 'crm-fake',
    supportedUrls: {},
    doGenerate: generate,
    doStream: async (options: { prompt: unknown }) => {
      const res = await generate(options);
      const c = res.content[0];
      const chunks: unknown[] =
        c.type === 'text'
          ? [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: c.text }, { type: 'text-end', id: 't' }]
          : [c];
      chunks.push({ type: 'finish', finishReason: res.finishReason, usage: USAGE });
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
      };
    },
  };
  return model as unknown as LanguageModel;
}
