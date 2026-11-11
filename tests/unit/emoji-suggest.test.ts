import { describe, expect, it } from 'vitest';
import { emojiQueryAt, rankEmoji } from '@/components/groups/wa/emoji-suggest';

const ALL: Array<[string, string]> = [
  ['😀', 'grinning face'],
  ['🧑‍🍳', 'cook'],
  ['👨‍🍳', 'man cook chef'],
  ['🍒', 'cherries'],
  ['🧀', 'cheese wedge'],
  ['❤️', 'red heart'],
  ['🔥', 'fire'],
  ['☕', 'hot beverage coffee'],
];
const ALIASES = { corazon: 'heart', fuego: 'fire', cafe: 'coffee' };

describe('emojiQueryAt', () => {
  it('encuentra ":che" pegado al cursor', () => {
    expect(emojiQueryAt('hola :che', 9)).toEqual({ start: 5, query: 'che' });
    expect(emojiQueryAt(':ch', 3)).toEqual({ start: 0, query: 'ch' });
  });
  it('no salta con una letra, horas, links ni lejos del cursor', () => {
    expect(emojiQueryAt('hola :c', 7)).toBeNull();
    expect(emojiQueryAt('a las 10:30', 11)).toBeNull();
    expect(emojiQueryAt('https://zerosoft.ai', 19)).toBeNull();
    expect(emojiQueryAt(':che y algo', 11)).toBeNull();
    expect(emojiQueryAt('hola :che', 4)).toBeNull();
  });
});

describe('rankEmoji', () => {
  it('palabra que empieza con lo escrito primero', () => {
    const r = rankEmoji(ALL, 'che', ALIASES).map((e) => e.char);
    expect(r.slice(0, 3)).toEqual(expect.arrayContaining(['🍒', '🧀', '👨‍🍳']));
    expect(r).not.toContain('😀');
  });
  it('alias en español sin tildes', () => {
    expect(rankEmoji(ALL, 'corazón', ALIASES).map((e) => e.char)).toContain('❤️');
    expect(rankEmoji(ALL, 'fueg', ALIASES)[0].char).toBe('🔥');
  });
  it('los recientes suben y el límite se respeta', () => {
    expect(rankEmoji(ALL, 'che', ALIASES, ['🧀'])[0].char).toBe('🧀');
    expect(rankEmoji(ALL, 'co', ALIASES, [], 2)).toHaveLength(2);
  });
});
