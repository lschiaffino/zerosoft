import { describe, expect, it } from 'vitest';
import { mentionDigits, mentionsMe } from '@/lib/wa-unread-mentions';

/** El "@" de la lista de chats (Lines e Inbox): qué menciones cuentan como "a vos". Números inventados. */
describe('wa-unread-mentions', () => {
  it('lee las menciones guardadas: teléfonos y lids, sin "all" ni basura', () => {
    expect(mentionDigits(JSON.stringify({ mentions: ['15550000001', '118571178918100@lid', 'all', 'x', 12] }))).toEqual(['15550000001', '118571178918100']);
    expect(mentionDigits('')).toEqual([]);
    expect(mentionDigits(null)).toEqual([]);
    expect(mentionDigits('{"media":{}}')).toEqual([]);
    expect(mentionDigits('{"mentions": no es json')).toEqual([]);
  });

  it('cuenta el teléfono de la cuenta y un lid que la libreta une a ese teléfono', () => {
    const me = '15550000001';
    expect(mentionsMe(['15550000001'], me, new Map())).toBe(true);
    expect(mentionsMe(['118571178918100'], me, new Map([['118571178918100', me]]))).toBe(true);
    expect(mentionsMe(['118571178918100'], me, new Map([['118571178918100', '15550000002']]))).toBe(false);
    expect(mentionsMe(['15550000002'], me, new Map())).toBe(false);
    expect(mentionsMe([], me, new Map())).toBe(false);
  });

  it('sin teléfono de la cuenta no marca nada', () => {
    expect(mentionsMe(['15550000001'], '', new Map())).toBe(false);
    expect(mentionsMe([''], '', new Map([['', '']]))).toBe(false);
  });
});
