import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BOARD_SHORTCUTS } from '@/lib/board-shortcuts';

describe('board shortcuts sheet', () => {
  it('has a translation for every group and item in en, es and pt', () => {
    for (const locale of ['en', 'es', 'pt']) {
      const m = JSON.parse(readFileSync(`messages/${locale}/board.json`, 'utf8')).shortcuts;
      for (const g of BOARD_SHORTCUTS) {
        expect(m.groups[g.id], `${locale} group ${g.id}`).toBeTruthy();
        for (const it of g.items) {
          expect(m.items[it.id], `${locale} item ${it.id}`).toBeTruthy();
          expect(it.keys.length).toBeGreaterThan(0);
        }
      }
    }
  });
  it('has unique item ids', () => {
    const ids = BOARD_SHORTCUTS.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
