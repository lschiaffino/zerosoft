import { describe, expect, it } from 'vitest';
import { folderHue, folderInitials } from '@/lib/folder-rail';

describe('folder rail', () => {
  it('uses up to two initials', () => {
    expect(folderInitials('Test')).toBe('TE');
    expect(folderInitials('Test 2')).toBe('T2');
    expect(folderInitials('ventas norte')).toBe('VN');
    expect(folderInitials('  ')).toBe('·');
    expect(folderInitials('Ñandú')).toBe('ÑA');
  });
  it('gives each name a stable hue', () => {
    expect(folderHue('Tomi')).toBe(folderHue('Tomi'));
    expect(folderHue('Tomi')).toBeGreaterThanOrEqual(0);
    expect(folderHue('Tomi')).toBeLessThan(360);
  });
});
