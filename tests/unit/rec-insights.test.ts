import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildInsights,
  cleanHeat,
  cleanRefHost,
  daysStart,
  EMPTY_CONTEXT,
  fillDays,
  flagEmoji,
  HEAT_BUCKETS,
  mergeHeat,
  playsOf,
  rewatchPeaks,
  type RecViewInput,
} from '@/lib/rec-insights';
import { recViewContext } from '@/lib/rec-view-context';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('lugar y dispositivo de una vista', () => {
  it('en Vercel lee país, región y ciudad (URL-encoded) de los headers de la plataforma', () => {
    vi.stubEnv('VERCEL', '1');
    const h = new Headers({
      'user-agent': IPHONE,
      'x-vercel-ip-country': 'br',
      'x-vercel-ip-country-region': 'SP',
      'x-vercel-ip-city': 'S%C3%A3o%20Paulo',
    });
    expect(recViewContext(h, '203.0.113.9', 'https://www.Mail.Example.com/inbox?id=secret')).toEqual({
      country: 'BR',
      region: 'SP',
      city: 'São Paulo',
      device: 'mobile',
      browser: 'Mobile Safari',
      os: 'iOS',
      referrer: 'mail.example.com',
    });
  });

  it('fuera de Vercel ignora los headers de geo y x-forwarded-for que manda el cliente', () => {
    vi.stubEnv('VERCEL', '');
    const h = new Headers({
      'user-agent': MAC_CHROME,
      'x-vercel-ip-country': 'US',
      'x-vercel-ip-city': 'Fake%20City',
      'x-forwarded-for': '8.8.8.8',
    });
    const c = recViewContext(h, 'unknown', undefined);
    expect([c.country, c.city, c.region]).toEqual(['', '', '']);
    expect([c.device, c.browser, c.os, c.referrer]).toEqual(['desktop', 'Chrome', 'Mac OS', '']);
  });

  it('sin user agent no inventa un dispositivo, y la ciudad sin país no se guarda', () => {
    vi.stubEnv('VERCEL', '1');
    const c = recViewContext(new Headers({ 'x-vercel-ip-city': 'Rosario' }), null, '');
    expect(c).toEqual(EMPTY_CONTEXT);
  });

  it('el origen es solo un dominio válido', () => {
    expect(cleanRefHost('news.example.org')).toBe('news.example.org');
    expect(cleanRefHost('WWW.example.com.')).toBe('example.com');
    expect(cleanRefHost('https://example.com/path?q=1')).toBe('example.com');
    expect(cleanRefHost('localhost')).toBe('');
    expect(cleanRefHost('<script>.com')).toBe('');
    expect(cleanRefHost('javascript:alert(1)')).toBe('');
    expect(cleanRefHost(`${'a'.repeat(120)}.com`)).toBe('');
    expect(cleanRefHost(42)).toBe('');
  });

  it('bandera desde el código de país', () => {
    expect(flagEmoji('ar')).toBe('🇦🇷');
    expect(flagEmoji('US')).toBe('🇺🇸');
    expect(flagEmoji('XX')).toBe('');
    expect(flagEmoji('')).toBe('');
    expect(flagEmoji('ARG')).toBe('');
  });
});

describe('re-vistas por tramo', () => {
  it('sanea, topa y se queda con el mayor de cada tramo', () => {
    expect(cleanHeat([1, 2], 100)).toBeNull();
    expect(cleanHeat('x', 100)).toBeNull();
    const raw = Array.from({ length: HEAT_BUCKETS }, (_, i) => (i === 0 ? 1e6 : i === 1 ? -3 : i === 2 ? Number.NaN : 1.04));
    const h = cleanHeat(raw, 100)!;
    expect(h[0]).toBe(40); // 2 s por tramo × 20 reproducciones
    expect([h[1], h[2], h[3]]).toEqual([0, 0, 1]);
    expect(mergeHeat(h, h.map(() => 2))![0]).toBe(40);
    expect(mergeHeat(h, h.map(() => 2))![3]).toBe(2);
    expect(mergeHeat(null, null)).toBeNull();
  });

  it('reproducciones de una vista: con heat, o 1 por tramo visto', () => {
    const fromHeat = playsOf(Array.from({ length: HEAT_BUCKETS }, (_, i) => (i === 0 ? 4 : 0)), [], 100);
    expect(fromHeat[0]).toBe(2);
    const fromRanges = playsOf(null, [[0, 50]], 100);
    expect(fromRanges.filter((x) => x === 1).length).toBe(25);
  });
});

const view = (over: Partial<RecViewInput>): RecViewInput => ({
  viewerKey: 'a:x',
  viewerNo: 0,
  signedIn: false,
  name: '',
  email: '',
  watchedSec: 0,
  maxPosition: 0,
  durationSec: 100,
  ctaClicks: 0,
  ranges: [],
  heat: null,
  startedAt: '2026-11-10 10:00:00',
  context: EMPTY_CONTEXT,
  ...over,
});

describe('armado de la analítica', () => {
  it('agrupa por espectador, completa el lugar de vistas viejas y numera a quien no tiene número', () => {
    const rows = [
      view({ viewerKey: 'a:1', viewerNo: 1, startedAt: '2026-11-11 09:00:00', ranges: [[0, 100]], watchedSec: 100, context: { ...EMPTY_CONTEXT, device: 'desktop', browser: 'Chrome', os: 'macOS' } }),
      view({ viewerKey: 'a:1', viewerNo: 1, startedAt: '2026-11-10 09:00:00', ranges: [[0, 10]], watchedSec: 10, context: { ...EMPTY_CONTEXT, country: 'AR', city: 'Córdoba', region: 'X' } }),
      view({ viewerKey: 'a:old', startedAt: '2026-11-01 09:00:00', ranges: [[0, 50]], watchedSec: 50 }),
      view({ viewerKey: 'a:older', startedAt: '2026-10-01 09:00:00', ranges: [[0, 20]], watchedSec: 20 }),
    ];
    const a = buildInsights(rows, 100);
    expect([a.views, a.unique, a.avgPct, a.completed, a.watchSec]).toEqual([4, 3, 57, 1, 180]);
    const one = a.viewers.find((x) => x.viewerKey === 'a:1')!;
    expect([one.views, one.pct, one.country, one.city, one.device, one.firstAt, one.lastAt]).toEqual([2, 100, 'AR', 'Córdoba', 'desktop', '2026-11-10 09:00:00', '2026-11-11 09:00:00']);
    expect(a.viewers.find((x) => x.viewerKey === 'a:older')?.viewerNo).toBe(2);
    expect(a.viewers.find((x) => x.viewerKey === 'a:old')?.viewerNo).toBe(3);
    // La tabla va de la vista más nueva a la más vieja.
    expect(a.viewers.map((x) => x.viewerKey)).toEqual(['a:1', 'a:old', 'a:older']);
    expect(a.retention).toHaveLength(HEAT_BUCKETS);
    expect(a.retention[0]).toBe(100);
    expect(a.retention[HEAT_BUCKETS - 1]).toBe(33);
    expect(a.devices).toEqual([
      { name: 'unknown', count: 2 },
      { name: 'desktop', count: 1 },
    ]);
  });

  it('los desgloses juntan el resto en "other" y la curva marca re-vistas', () => {
    const rows = 'ABCDEFGHIJ'.split('').map((c, i) =>
      view({ viewerKey: `a:${i}`, viewerNo: i + 1, ranges: [[0, 100]], context: { ...EMPTY_CONTEXT, country: `A${c}` }, heat: Array.from({ length: HEAT_BUCKETS }, (_, b) => (b === 10 ? 8 : 2)) }),
    );
    const a = buildInsights(rows, 100);
    expect(a.countries).toHaveLength(8);
    expect(a.countries[7]).toEqual({ name: 'other', count: 3 });
    expect(a.plays[10]).toBe(40);
    expect(a.plays[0]).toBe(10);
    expect(rewatchPeaks(a.retention, a.plays, a.unique)).toEqual([10]);
  });

  it('usa los totales de la base cuando vienen (más vistas que la muestra)', () => {
    const a = buildInsights([view({ ranges: [[0, 100]] })], 100, { totals: { views: 9000, unique: 4000, ctaClicks: 3, watchSec: 12.6 }, sampled: 5000 });
    expect([a.views, a.unique, a.ctaClicks, a.watchSec, a.sampled]).toEqual([9000, 4000, 3, 13, 5000]);
  });

  it('días del gráfico: desde la primera vista, entre 7 y 90, con ceros', () => {
    expect(daysStart(null, '2026-11-12')).toBe('2026-11-06');
    expect(daysStart('2026-11-11 10:00:00', '2026-11-12')).toBe('2026-11-06');
    expect(daysStart('2026-10-01 10:00:00', '2026-11-12')).toBe('2026-10-01');
    expect(daysStart('2025-01-01 10:00:00', '2026-11-12')).toBe('2026-08-15');
    const days = fillDays([{ name: '2026-11-08', count: 3 }], '2026-11-06', '2026-11-12');
    expect(days).toHaveLength(7);
    expect(days[2]).toEqual({ date: '2026-11-08', count: 3 });
    expect(days[6]).toEqual({ date: '2026-11-12', count: 0 });
  });
});
