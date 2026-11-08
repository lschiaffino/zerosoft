/**
 * Corre `fn` cuando el navegador está libre (requestIdleCallback, como mucho
 * `timeout` ms después). Para lo que el chrome de la app pide al cargar y no
 * hace falta para pintar la página (badges, novedades): así no compite con
 * los datos de la página. Devuelve la función para cancelarlo.
 */
export function whenIdle(fn: () => void, timeout = 1500): () => void {
  if (typeof window === 'undefined') return () => {};
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 200);
  return () => window.clearTimeout(id);
}
