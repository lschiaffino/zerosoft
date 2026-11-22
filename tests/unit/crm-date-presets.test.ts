import { describe, expect, it } from 'vitest';
import { isDay, presetRange, resolveDateFilter, todayIn } from '@/lib/crm-date-presets';
import { parsePageSize } from '@/lib/crm-page-size';

// 2026-03-15 02:30 UTC: todavía 14 de marzo en Buenos Aires (UTC-3).
const NOW = new Date('2026-03-15T02:30:00Z');

describe('crm date presets', () => {
  it('computes today in the person time zone', () => {
    expect(todayIn(NOW, 'UTC')).toBe('2026-03-15');
    expect(todayIn(NOW, 'America/Argentina/Buenos_Aires')).toBe('2026-03-14');
    expect(todayIn(NOW, 'Not/AZone')).toBe('2026-03-15');
  });

  it('resolves each relative range', () => {
    const r = (p: Parameters<typeof presetRange>[0]) => presetRange(p, NOW, 'UTC');
    expect(r('today')).toEqual({ from: '2026-03-15', to: '2026-03-15' });
    expect(r('yesterday')).toEqual({ from: '2026-03-14', to: '2026-03-14' });
    expect(r('last7')).toEqual({ from: '2026-03-09', to: '2026-03-15' });
    expect(r('last30')).toEqual({ from: '2026-02-14', to: '2026-03-15' });
    expect(r('thisMonth')).toEqual({ from: '2026-03-01', to: '2026-03-15' });
    expect(r('lastMonth')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(r('thisQuarter')).toEqual({ from: '2026-01-01', to: '2026-03-15' });
    expect(r('thisYear')).toEqual({ from: '2026-01-01', to: '2026-03-15' });
    expect(presetRange('lastMonth', new Date('2026-01-10T12:00:00Z'), 'UTC')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('resolves the URL params: preset, custom, none and junk', () => {
    const opts = { now: NOW, timeZone: 'UTC' };
    expect(resolveDateFilter('last7', '2020-01-01', '', opts)).toEqual({ from: '2026-03-09', to: '2026-03-15' });
    expect(resolveDateFilter('custom', '2026-01-02', '2026-01-05', opts)).toEqual({ from: '2026-01-02', to: '2026-01-05' });
    // Links viejos: solo createdFrom / createdTo.
    expect(resolveDateFilter(undefined, '2026-01-02', undefined, opts)).toEqual({ from: '2026-01-02' });
    expect(resolveDateFilter('custom', '2026-02-30', 'nope', opts)).toEqual({});
    expect(resolveDateFilter('none', '', '', opts)).toEqual({});
    expect(resolveDateFilter('none', '', '', { ...opts, allowNone: true })).toEqual({ none: true });
    expect(resolveDateFilter('drop table', '2026-01-02', '', opts)).toEqual({});
    expect(isDay('2026-02-28')).toBe(true);
    expect(isDay('2026-2-28')).toBe(false);
  });

  it('page size accepts only the offered sizes', () => {
    expect(parsePageSize('50')).toBe(50);
    expect(parsePageSize('100')).toBe(100);
    expect(parsePageSize('1000')).toBe(25);
    expect(parsePageSize(undefined)).toBe(25);
  });
});
