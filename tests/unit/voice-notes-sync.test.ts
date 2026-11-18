import { describe, expect, it } from 'vitest';
import { incomingReplacesNote, rememberSent } from '@/lib/voice-notes-sync';

describe('incomingReplacesNote', () => {
  it('la misma nota que se ve no reemplaza nada', () => {
    expect(incomingReplacesNote('a', 'a', new Set(), false)).toBe(false);
  });

  it('una nota regenerada (otra firma) reemplaza el documento', () => {
    expect(incomingReplacesNote('nueva', 'vieja', new Set(['vieja']), false)).toBe(true);
  });

  it('un eco de lo que este editor mandó a guardar no pisa lo escrito después', () => {
    expect(incomingReplacesNote('v1', 'v2', new Set(['v1']), false)).toBe(false);
  });

  it('con cambios escritos sin mandar, nada de afuera los pisa', () => {
    expect(incomingReplacesNote('otra', 'local', new Set(), true)).toBe(false);
  });
});

describe('rememberSent', () => {
  it('guarda las últimas firmas, sin pasar el tope', () => {
    const mine = new Set<string>();
    for (let i = 0; i < 5; i++) rememberSent(mine, `v${i}`, 3);
    expect([...mine]).toEqual(['v2', 'v3', 'v4']);
  });

  it('una firma que se repite pasa al final y no se pierde por el tope', () => {
    const mine = new Set<string>(['v1', 'v2', 'v3']);
    rememberSent(mine, 'v1', 3);
    rememberSent(mine, 'v4', 3);
    expect([...mine]).toEqual(['v3', 'v1', 'v4']);
  });
});
