'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PricedCart } from '@/lib/shop-orders';
import { onCartChange, readCart, type CartLine } from './cart-store';

export interface PriceOpts {
  address?: { country: string; region?: string } | null;
  shippingRateId?: string | null;
  discountCode?: string | null;
}

/** El carrito del navegador preciado por el servidor (se vuelve a pedir al cambiar). */
export function usePricedCart(handle: string, opts: PriceOpts) {
  const [lines, setLines] = useState<CartLine[] | null>(null);
  const [cart, setCart] = useState<PricedCart | null>(null);
  const [methods, setMethods] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const key = JSON.stringify(opts);

  useEffect(() => {
    const sync = () => setLines(readCart(handle));
    sync();
    return onCartChange(sync);
  }, [handle]);

  const load = useCallback(async () => {
    if (!lines) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/shop/public/${handle}/cart`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lines, ...JSON.parse(key) }),
      });
      const data = (await res.json().catch(() => ({}))) as { cart?: PricedCart; methods?: string[]; error?: string };
      if (n !== seq.current) return;
      if (!res.ok || !data.cart) {
        setError(data.error ?? 'error');
      } else {
        setError(null);
        setCart(data.cart);
        setMethods(data.methods ?? []);
      }
    } catch {
      if (n === seq.current) setError('network');
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [handle, lines, key]);

  useEffect(() => {
    void load();
  }, [load]);

  return { lines, cart, methods, error, loading, reload: load };
}
