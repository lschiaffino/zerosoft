import { describe, expect, it } from 'vitest';
import { mergeSaved, sameValue } from '@/lib/save-merge';

describe('mergeSaved', () => {
  const sent = { name: 'Hola', slug: 'hola', definition: { questions: [{ id: 'q1', title: 'Uno' }] } };

  it('sin cambios durante el pedido, toma lo que devolvió el servidor', () => {
    const saved = { name: 'Hola', slug: 'hola-1', definition: { questions: [{ id: 'q1', title: 'Uno' }] } };
    expect(mergeSaved({ ...sent }, sent, saved)).toBe(saved);
  });

  it('un campo cambiado durante el pedido queda como lo dejó la persona; el resto viene del servidor', () => {
    const current = { ...sent, name: 'Hola mundo' };
    const saved = { name: 'Hola', slug: 'hola-1', definition: sent.definition };
    const next = mergeSaved(current, sent, saved);
    expect(next.name).toBe('Hola mundo');
    expect(next.slug).toBe('hola-1');
    // Lo guardado sigue siendo distinto: el editor sabe que hay cambios sin guardar.
    expect(sameValue(next, saved)).toBe(false);
  });

  it('compara objetos anidados por valor, no por referencia', () => {
    const current = { ...sent, definition: { questions: [{ id: 'q1', title: 'Uno' }] } };
    const saved = { ...sent, definition: { questions: [{ id: 'q1', title: 'Uno', ref: 'r1' }] } };
    expect(mergeSaved(current, sent, saved)).toBe(saved);
  });

  it('un cambio anidado se conserva entero', () => {
    const current = { ...sent, definition: { questions: [{ id: 'q1', title: 'Uno' }, { id: 'q2', title: 'Dos' }] } };
    const saved = { ...sent, definition: { questions: [{ id: 'q1', title: 'Uno', ref: 'r1' }] } };
    expect(mergeSaved(current, sent, saved).definition).toBe(current.definition);
  });
});
