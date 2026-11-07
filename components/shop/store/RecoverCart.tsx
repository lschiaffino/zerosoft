'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { StorefrontStrings } from '@/lib/shop-i18n';
import { writeCart } from './cart-store';

/** Link del recordatorio: repone el carrito guardado en este navegador y sigue al checkout. */
export default function RecoverCart({ handle, token, t }: { handle: string; token: string; t: StorefrontStrings }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/shop/public/${handle}/recover?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
        const data = (await res.json().catch(() => ({}))) as { lines?: Array<{ variantId: string; quantity: number }> };
        if (cancelled) return;
        if (!res.ok || !data.lines?.length) return setGone(true);
        writeCart(handle, data.lines);
        window.location.replace(`/store/${handle}/checkout`);
      } catch {
        if (!cancelled) setGone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, token]);
  return (
    <section className="sf-section sf-narrow sf-empty">
      <p role="status">{gone ? t.recoverGone : t.recovering}</p>
      {gone && (
        <Link className="sf-btn sf-btn-primary" href={`/store/${handle}`}>
          {t.continueShopping}
        </Link>
      )}
    </section>
  );
}
