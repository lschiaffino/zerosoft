import { describe, expect, it } from 'vitest';
import { DEFAULT_INK, STICKY_INK, applyDarkFilter, darkColor } from '@/lib/board-dark';
import { STICKY_COLORS } from '@/lib/board-stickies';

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('dark canvas colors', () => {
  it("Excalidraw's filter turns sticky colors dark (the bug this avoids)", () => {
    for (const c of STICKY_COLORS) expect(luminance(applyDarkFilter(c.fill))).toBeLessThan(0.35);
  });
  it('sticky fills and sticky ink stay as they are; everything else gets the dark transform', () => {
    for (const c of STICKY_COLORS) expect(darkColor(c.fill)).toBe(c.fill);
    expect(darkColor(STICKY_INK)).toBe(STICKY_INK);
    expect(luminance(darkColor(DEFAULT_INK))).toBeGreaterThan(0.7);
    expect(luminance(darkColor('#ffffff'))).toBeLessThan(0.1);
    expect(darkColor('#fff')).toBe(darkColor('#ffffff'));
  });
  it('keeps alpha and leaves unknown formats alone', () => {
    expect(darkColor('#ffffff80')).toBe(`${darkColor('#ffffff')}80`);
    expect(darkColor('rgba(255, 255, 255, 0.5)')).toMatch(/^rgba\(\d+, \d+, \d+, 0\.5\)$/);
    expect(darkColor('transparent')).toBe('transparent');
  });
});
