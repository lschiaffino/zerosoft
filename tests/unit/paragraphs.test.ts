import { describe, expect, it } from 'vitest';
import { toParagraphs } from '@/lib/paragraphs';

const LONG =
  'Esto no cambia lo que hacemos con los anuncios. Los anuncios son más concretos y tienen que funcionar de forma concreta y eso está bien. Pero sí cambia la idea del website genérica. Así que eso. Pero, bueno, solo para que estén al tanto, yo voy a estar tomando esto para avanzar con velocidad. Me sirven, les voy a mandar individualmente también gustos y todo. Sepan que es muy difícil contentar a todos los gustos. Hay gente opiniones, ¿viste? Pero nada, eso. Quiero avanzar con velocidad y escucharlo.';

describe('toParagraphs', () => {
  it('splits a long transcript into a few paragraphs without breaking sentences', () => {
    const p = toParagraphs(LONG);
    expect(p.length).toBeGreaterThanOrEqual(2);
    expect(p.length).toBeLessThanOrEqual(4);
    expect(p.join(' ')).toBe(LONG);
    for (const x of p) expect(x).toMatch(/[.!?…]$/);
  });
  it('keeps short texts as one paragraph and respects line breaks', () => {
    expect(toParagraphs('Hola, ¿cómo estás?')).toEqual(['Hola, ¿cómo estás?']);
    expect(toParagraphs('Uno.\n\nDos.')).toEqual(['Uno.', 'Dos.']);
    expect(toParagraphs('  ')).toEqual([]);
  });
  it('does not split decimals', () => {
    const t = `${'Palabra '.repeat(40)}cuesta 3.5 dólares. ${'Otra frase más. '.repeat(20)}`;
    expect(toParagraphs(t).some((x) => x.includes('3.5 dólares'))).toBe(true);
  });
});
