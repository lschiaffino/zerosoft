import { describe, expect, it } from 'vitest';
import { apply, diff, htmlIndexOf, isNoop, textHash, textOffsetOf, tokens, transform, transformIndex, transformTextOffset, type TextOp } from '@/lib/docs-ot';

/** Generador pseudoaleatorio con semilla (los casos se repiten igual). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const ALPHABET = ['a', 'b', 'c', ' ', '<strong>x</strong>', '&amp;', '😀', 'é'];

function randomEdit(text: string, r: () => number): string {
  const tk = tokens(text);
  const at = Math.floor(r() * (tk.length + 1));
  const del = r() < 0.4 ? Math.floor(r() * 3) : 0;
  const ins = r() < 0.8 ? Array.from({ length: 1 + Math.floor(r() * 3) }, () => ALPHABET[Math.floor(r() * ALPHABET.length)]).join('') : '';
  return [...tk.slice(0, at), ins, ...tk.slice(at + del)].join('');
}

describe('docs-ot', () => {
  it('diff + apply reproduce el texto y no cortan tags ni entidades', () => {
    const a = 'Hola <strong>mundo</strong> &amp; 😀 fin';
    const b = 'Hola <em>mundo</em> &lt; 😀😀 fin!';
    const op = diff(a, b);
    expect(apply(a, op)).toBe(b);
    expect(isNoop(diff(a, a))).toBe(true);
    // Cada paso cae entre tokens de `a`.
    let pos = 0;
    const bounds = new Set<number>([0]);
    for (const t of tokens(a)) bounds.add((pos += t.length));
    pos = 0;
    for (const c of op) {
      expect(bounds.has(pos)).toBe(true);
      if (typeof c === 'number') pos += Math.abs(c);
    }
  });

  it('dos personas en el mismo punto: quedan las dos y convergen', () => {
    const base = 'centro';
    const a = diff(base, 'centro izq');
    const b = diff(base, 'centro der');
    const [a2, b2] = transform(a, b);
    const left = apply(apply(base, a), b2);
    const right = apply(apply(base, b), a2);
    expect(left).toBe(right);
    expect(left).toContain('izq');
    expect(left).toContain('der');
  });

  it('borrado de un lado e inserción adentro del otro: no se pierde lo escrito', () => {
    const base = 'uno dos tres';
    const a = diff(base, 'uno tres');
    const b = diff(base, 'uno doXs tres');
    const [a2, b2] = transform(a, b);
    expect(apply(apply(base, a), b2)).toBe(apply(apply(base, b), a2));
    expect(apply(apply(base, a), b2)).toContain('X');
  });

  it('fuzz: transformar siempre converge (TP1)', () => {
    const r = rng(42);
    for (let i = 0; i < 2000; i++) {
      let base = '';
      for (let k = 0; k < 4; k++) base = randomEdit(base, r);
      const ta = randomEdit(randomEdit(base, r), r);
      const tb = randomEdit(base, r);
      const a = diff(base, ta);
      const b = diff(base, tb);
      const [a2, b2] = transform(a, b);
      expect(apply(apply(base, a), b2)).toBe(apply(apply(base, b), a2));
    }
  });

  it('fuzz: cliente y servidor (una en vuelo + pendientes) terminan iguales', () => {
    const r = rng(7);
    for (let i = 0; i < 400; i++) {
      // Servidor con el texto; el cliente tiene una op en vuelo y más escritas; llega una remota.
      const S = randomEdit(randomEdit('', r), r);
      const inflight = diff(S, randomEdit(S, r));
      const known = apply(S, inflight);
      const V = randomEdit(known, r);
      const remote = diff(S, randomEdit(S, r));
      // Cliente
      const [inf2, R1] = transform(inflight, remote);
      const B = diff(known, V);
      const [B2, R2] = transform(B, R1);
      const V2 = apply(V, R2);
      // Servidor: aplica la remota, después la en vuelo transformada y después lo pendiente.
      const serverText = apply(apply(apply(S, remote), inf2), B2);
      expect(V2).toBe(serverText);
    }
  });

  it('índices y offsets de texto plano', () => {
    const html = 'ab<strong>cd</strong>&amp;e';
    expect(textOffsetOf(html, html.length)).toBe(6);
    expect(htmlIndexOf(html, 2)).toBe('ab<strong>'.length);
    expect(htmlIndexOf(html, 5)).toBe(html.length - 1);
    const op: TextOp = ['XY', html.length];
    expect(transformIndex(0, op)).toBe(0);
    expect(transformIndex(0, op, true)).toBe(2);
    expect(transformTextOffset(html, 3, op)).toBe(5);
  });

  it('huella distinta para textos distintos', () => {
    expect(textHash('abc')).toBe(textHash('abc'));
    expect(textHash('abc')).not.toBe(textHash('abd'));
  });
});
