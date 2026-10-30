'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { onCartChange, readCart } from './cart-store';

/** Ícono del carrito con la cantidad (se actualiza al agregar desde cualquier página). */
export default function CartBadge({ handle, label }: { handle: string; label: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const sync = () => setCount(readCart(handle).reduce((s, l) => s + l.quantity, 0));
    sync();
    return onCartChange(sync);
  }, [handle]);
  return (
    <Link href={`/store/${handle}/cart`} className="sf-tool sf-cart-link" aria-label={`${label} (${count})`} data-testid="sf-cart-link">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M5 7h14l-1.5 12h-11z" />
        <path d="M9 7a3 3 0 0 1 6 0" />
      </svg>
      {count > 0 && <span className="sf-badge">{count}</span>}
    </Link>
  );
}
