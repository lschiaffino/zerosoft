'use client';

/**
 * Carrito de la tienda en el navegador: solo variante y cantidad (precios y
 * stock siempre los da el servidor). localStorage por tienda; un evento avisa
 * a la cabecera y a las demás vistas.
 */
export interface CartLine {
  variantId: string;
  quantity: number;
}

const EVENT = 'zs-cart-change';
const key = (handle: string) => `zs-cart:${handle}`;

export function readCart(handle: string): CartLine[] {
  try {
    const raw = window.localStorage.getItem(key(handle));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l): l is CartLine => !!l && typeof (l as CartLine).variantId === 'string' && Number.isInteger((l as CartLine).quantity))
      .map((l) => ({ variantId: l.variantId, quantity: Math.max(1, Math.min(999, l.quantity)) }))
      .slice(0, 100);
  } catch {
    return [];
  }
}

export function writeCart(handle: string, lines: CartLine[]): void {
  try {
    window.localStorage.setItem(key(handle), JSON.stringify(lines.filter((l) => l.quantity > 0)));
  } catch {
    /* modo privado: el carrito vive solo en memoria */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: handle }));
}

export function addToCart(handle: string, variantId: string, quantity: number): void {
  const lines = readCart(handle);
  const found = lines.find((l) => l.variantId === variantId);
  if (found) found.quantity = Math.min(999, found.quantity + quantity);
  else lines.push({ variantId, quantity });
  writeCart(handle, lines);
}

export function clearCart(handle: string): void {
  writeCart(handle, []);
}

export function onCartChange(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener(EVENT, h);
  window.addEventListener('storage', h);
  return () => {
    window.removeEventListener(EVENT, h);
    window.removeEventListener('storage', h);
  };
}
