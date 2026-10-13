import { MockLanguageModelV4 } from 'ai/test';

/** Modelo falso (sin llamadas reales) que devuelve `text` y el uso indicado. */
export function mockModel(text: string | (() => string), input = 100, output = 50) {
  return new MockLanguageModelV4({
    modelId: 'mock-model',
    doGenerate: async () => ({
      content: [{ type: 'text', text: typeof text === 'function' ? text() : text }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: output, text: output, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

export type MockStep = { text: string } | { tool: string; input: Record<string, unknown> };

function stepContent(step: MockStep, i: number) {
  if ('text' in step) return { type: 'text' as const, text: step.text };
  return {
    type: 'tool-call' as const,
    toolCallId: `call-${i}-${crypto.randomUUID().slice(0, 6)}`,
    toolName: step.tool,
    input: JSON.stringify(step.input),
  };
}

/**
 * Modelo con guion (tool calling sin llamadas reales): cada llamada devuelve
 * el siguiente paso (texto o tool call); pasado el final repite el último.
 * `steps` puede ser una función del número de llamada. Soporta generate y stream.
 */
export function scriptedModel(steps: MockStep[] | ((call: number) => MockStep)) {
  let call = 0;
  const next = () => {
    const i = call++;
    const step = typeof steps === 'function' ? steps(i) : steps[Math.min(i, steps.length - 1)];
    return { step, i };
  };
  return new MockLanguageModelV4({
    modelId: 'mock-agent',
    doGenerate: async () => {
      const { step, i } = next();
      return {
        content: [stepContent(step, i)],
        finishReason: { unified: 'text' in step ? ('stop' as const) : ('tool-calls' as const), raw: undefined },
        usage: USAGE,
        warnings: [],
      };
    },
    doStream: async () => {
      const { step, i } = next();
      const content = stepContent(step, i);
      const chunks: unknown[] =
        content.type === 'text'
          ? [
              { type: 'text-start', id: 't' },
              ...content.text.split(/(?<= )/).map((delta) => ({ type: 'text-delta', id: 't', delta })),
              { type: 'text-end', id: 't' },
            ]
          : [content];
      chunks.push({
        type: 'finish',
        finishReason: { unified: content.type === 'text' ? 'stop' : 'tool-calls', raw: undefined },
        usage: USAGE,
      });
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const c of chunks) controller.enqueue(c);
            controller.close();
          },
        }),
      } as never;
    },
  });
}

/** Modelo que siempre falla (simula caída del proveedor). */
export function failingModel() {
  return new MockLanguageModelV4({
    modelId: 'failing-model',
    doGenerate: async () => {
      throw new Error('provider down');
    },
  });
}
