import { describe, expect, it } from 'vitest';
import { isStreamSettled, PENDING_SEGMENT } from '@/lib/stream-settled';

const doc = (readyState: DocumentReadyState, pending: boolean) => ({
  readyState,
  querySelector: (sel: string) => (pending && sel === PENDING_SEGMENT ? {} : null),
});

describe('isStreamSettled', () => {
  it('espera a que el documento cargue entero', () => {
    expect(isStreamSettled(doc('loading', false))).toBe(false);
    expect(isStreamSettled(doc('interactive', false))).toBe(false);
  });

  it('espera a que no quede un segmento de Suspense oculto sin revelar', () => {
    expect(isStreamSettled(doc('complete', true))).toBe(false);
  });

  it('listo con la carga completa y sin segmentos pendientes', () => {
    expect(isStreamSettled(doc('complete', false))).toBe(true);
  });
});
