import { describe, expect, it } from 'vitest';
import { DEFAULT_RECENT, recentWithDefaults } from '@/components/groups/wa/emoji-recent';

describe('Recientes del selector de emojis (Lines e Inbox)', () => {
  it('sin recientes, se llena con los más usados de WhatsApp', () => {
    expect(recentWithDefaults([])).toEqual(DEFAULT_RECENT.slice(0, 32));
  });
  it('los usados van primero, sin repetirse, y completa hasta 32', () => {
    const out = recentWithDefaults(['🤣', '✅']);
    expect(out.slice(0, 2)).toEqual(['🤣', '✅']);
    expect(out).toHaveLength(32);
    expect(new Set(out).size).toBe(out.length);
  });
});
