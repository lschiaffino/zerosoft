import { describe, expect, it } from 'vitest';
import { emptyDefinition, shuffleChoices } from '@/lib/forms/engine';
import type { Question } from '@/lib/forms/types';

const choices = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, label: `Option ${i}` }));
const q = (id: string, randomize?: boolean): Question => ({ id, ref: id, type: 'choice', title: id, description: '', required: false, choices, randomize });

describe('shuffleChoices', () => {
  const def = { ...emptyDefinition('en'), questions: [q('a', true), q('b')] };

  it('keeps every option and leaves other questions alone', () => {
    const out = shuffleChoices(def, 7);
    expect(out.questions[0].choices!.map((c) => c.id).sort()).toEqual(choices.map((c) => c.id).sort());
    expect(out.questions[1].choices).toEqual(choices);
  });

  it('is deterministic per seed and differs across seeds', () => {
    const order = (s: number) => shuffleChoices(def, s).questions[0].choices!.map((c) => c.id).join();
    expect(order(7)).toBe(order(7));
    expect(new Set([1, 2, 3, 4, 5].map(order)).size).toBeGreaterThan(1);
  });

  it('returns the same definition when nothing is randomized', () => {
    const plain = { ...def, questions: [q('b')] };
    expect(shuffleChoices(plain, 1)).toBe(plain);
  });

  it('does not mutate the original', () => {
    shuffleChoices(def, 3);
    expect(def.questions[0].choices).toEqual(choices);
  });
});
