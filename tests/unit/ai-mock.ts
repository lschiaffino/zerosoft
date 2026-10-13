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

/** Modelo que siempre falla (simula caída del proveedor). */
export function failingModel() {
  return new MockLanguageModelV4({
    modelId: 'failing-model',
    doGenerate: async () => {
      throw new Error('provider down');
    },
  });
}
