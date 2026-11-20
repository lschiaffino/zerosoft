import { beforeAll, describe, expect, it } from 'vitest';
import { upsertUser } from '@/lib/db';
import { priceChangeError, repriceVariant } from '@/lib/shop-money';
import { bulkPrices, createProduct, ensureStore, getProduct, updateStore } from '@/lib/shop';
import type { ShopActor } from '@/lib/shop-schema';

describe('repriceVariant', () => {
  const v = (priceCents: number, compareAtCents: number | null = null) => ({ priceCents, compareAtCents });

  it('oferta: descuenta del precio de lista y lo deja tachado, sin descontar dos veces', () => {
    expect(repriceVariant(v(1000), { mode: 'sale', percent: 20 }, 'USD')).toEqual({ priceCents: 800, compareAtCents: 1000 });
    // Ya en oferta: parte del tachado.
    expect(repriceVariant(v(800, 1000), { mode: 'sale', percent: 30 }, 'USD')).toEqual({ priceCents: 700, compareAtCents: 1000 });
    expect(repriceVariant(v(800, 1000), { mode: 'sale', percent: 20 }, 'USD')).toBeNull();
    // Un tachado menor que el precio no cuenta como oferta.
    expect(repriceVariant(v(1000, 900), { mode: 'sale', percent: 10 }, 'USD')).toEqual({ priceCents: 900, compareAtCents: 1000 });
    expect(repriceVariant(v(0), { mode: 'sale', percent: 10 }, 'USD')).toBeNull();
  });

  it('terminar oferta: vuelve al tachado; sin oferta no cambia', () => {
    expect(repriceVariant(v(700, 1000), { mode: 'end-sale' }, 'USD')).toEqual({ priceCents: 1000, compareAtCents: null });
    expect(repriceVariant(v(1000), { mode: 'end-sale' }, 'USD')).toBeNull();
    expect(repriceVariant(v(1000, 900), { mode: 'end-sale' }, 'USD')).toBeNull();
  });

  it('subir o bajar: precio y tachado, redondeado a la moneda', () => {
    expect(repriceVariant(v(1000, 1500), { mode: 'adjust', percent: 10 }, 'USD')).toEqual({ priceCents: 1100, compareAtCents: 1650 });
    expect(repriceVariant(v(999), { mode: 'adjust', percent: -10 }, 'USD')).toEqual({ priceCents: 899, compareAtCents: null });
    // CLP no tiene decimales: 12.345 + 7,5% = 13.270,875 → 13.271.
    expect(repriceVariant(v(1_234_500), { mode: 'adjust', percent: 7.5 }, 'CLP')).toEqual({ priceCents: 1_327_100, compareAtCents: null });
    expect(repriceVariant(v(1_234_500), { mode: 'sale', percent: 15 }, 'clp')).toEqual({ priceCents: 1_049_300, compareAtCents: 1_234_500 });
  });

  it('valida el cambio', () => {
    expect(priceChangeError({ mode: 'sale', percent: 20 })).toBeNull();
    expect(priceChangeError({ mode: 'adjust', percent: -12.5 })).toBeNull();
    expect(priceChangeError({ mode: 'end-sale' })).toBeNull();
    for (const bad of [null, {}, { mode: 'sale', percent: 0 }, { mode: 'sale', percent: 95 }, { mode: 'sale', percent: '20' }, { mode: 'adjust', percent: 0 }, { mode: 'adjust', percent: -91 }, { mode: 'adjust', percent: 1.234 }, { mode: 'x', percent: 5 }]) {
      expect(priceChangeError(bad)).toBe('invalid_input');
    }
  });
});

describe('bulkPrices', () => {
  const ws = `shop-bulk-prices-${Date.now()}`;
  const actor: ShopActor = { ws, person: ws, admin: true };
  const member: ShopActor = { ws, person: `${ws}-m`, admin: false };
  const uid = () => Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    await upsertUser({ id: ws, email: `${ws}@example.com`, name: 'Bulk' });
    await ensureStore(ws);
    await updateStore(actor, { handle: `bulk-${uid()}${uid()}` });
  });

  const product = (prices: Array<[number, number | null]>) =>
    createProduct(actor, {
      title: `P ${uid()}`,
      status: 'active',
      options: [{ name: 'Size', values: prices.map((_, i) => `S${i}`) }],
      variants: prices.map(([priceCents, compareAtCents], i) => ({ options: [`S${i}`], priceCents, compareAtCents, initialStock: 1 })),
    });
  const prices = async (id: string) => (await getProduct(ws, id))!.variants.map((x) => [x.priceCents, x.compareAtCents]);

  it('cambia todas las variantes de los productos elegidos, y solo de este workspace', async () => {
    const a = await product([
      [1000, null],
      [2000, null],
    ]);
    const b = await product([[500, 800]]);
    const untouched = await product([[3000, null]]);

    const foreign: ShopActor = { ws: `${ws}-otro`, person: 'x', admin: true };
    await expect(bulkPrices(foreign, [a.id], { mode: 'sale', percent: 10 })).rejects.toMatchObject({ code: 'not_found' });

    // Cualquiera con Shop puede cambiar precios (como editar un producto).
    expect(await bulkPrices(member, [a.id, b.id], { mode: 'sale', percent: 25 })).toEqual({ products: 2, variants: 3 });
    expect(await prices(a.id)).toEqual([
      [750, 1000],
      [1500, 2000],
    ]);
    expect(await prices(b.id)).toEqual([[600, 800]]);
    expect(await prices(untouched.id)).toEqual([[3000, null]]);

    expect(await bulkPrices(actor, [a.id, b.id], { mode: 'end-sale' })).toEqual({ products: 2, variants: 3 });
    expect(await prices(a.id)).toEqual([
      [1000, null],
      [2000, null],
    ]);
    expect(await bulkPrices(actor, [a.id], { mode: 'end-sale' })).toEqual({ products: 0, variants: 0 });

    expect(await bulkPrices(actor, [a.id], { mode: 'adjust', percent: 12 })).toEqual({ products: 1, variants: 2 });
    expect(await prices(a.id)).toEqual([
      [1120, null],
      [2240, null],
    ]);
  });

  it('rechaza entradas inválidas', async () => {
    const a = await product([[1000, null]]);
    await expect(bulkPrices(actor, [], { mode: 'sale', percent: 10 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(bulkPrices(actor, [a.id], { mode: 'sale', percent: 0 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(bulkPrices(actor, [a.id], { mode: 'nope' } as never)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await prices(a.id)).toEqual([[1000, null]]);
  });
});
