import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRICE_MULTIPLIER, USAGE_RATES, usageCost, usagePrice } from '@/lib/pricing';

const root = join(__dirname, '..', '..');

describe('precios de zerosoft Cloud', () => {
  it('el precio es el costo × 3 en cada recurso', () => {
    for (const rate of USAGE_RATES) {
      expect(usagePrice(rate), rate.key).toBeCloseTo(rate.cost * PRICE_MULTIPLIER, 2);
      expect(usagePrice(rate), rate.key).toBeGreaterThan(usageCost(rate));
    }
  });

  it('publica los precios decididos por bloque', () => {
    const price = Object.fromEntries(USAGE_RATES.map((r) => [r.key, usagePrice(r)]));
    expect(price).toEqual({ clicks: 2.5, bookings: 12, emails: 3, storage: 0.5 });
  });

  it('cada recurso tiene nombre, bloque y unidad en los tres idiomas', () => {
    for (const locale of ['es', 'en', 'pt']) {
      const json = JSON.parse(readFileSync(join(root, 'messages', locale, 'common.json'), 'utf8')) as {
        pricing: { usage: Record<string, { name: string; free: string; block: string }> };
      };
      for (const rate of USAGE_RATES) {
        const row = json.pricing.usage[rate.key];
        expect(row?.name, `${locale} ${rate.key}`).toBeTruthy();
        expect(row?.free, `${locale} ${rate.key}`).toBeTruthy();
        expect(row?.block, `${locale} ${rate.key}`).toBeTruthy();
      }
    }
  });
});
