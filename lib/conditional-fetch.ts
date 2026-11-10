/**
 * GET condicional desde el navegador (ver lib/etag.ts): manda el ETag de la
 * última respuesta y distingue "igual que antes" (304) de datos nuevos. Con
 * `signal`, un pedido viejo se corta cuando ya no interesa su respuesta.
 */
export type Conditional<T> =
  | { state: 'fresh'; data: T; etag: string }
  | { state: 'same' }
  | { state: 'aborted' }
  | { state: 'error'; status: number; code: string };

export async function fetchIfChanged<T>(url: string, etag?: string | null, signal?: AbortSignal): Promise<Conditional<T>> {
  try {
    const res = await fetch(url, { signal, headers: etag ? { 'if-none-match': etag } : undefined });
    if (res.status === 304) return { state: 'same' };
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { state: 'error', status: res.status, code: body.error ?? 'generic' };
    }
    return { state: 'fresh', data: (await res.json()) as T, etag: res.headers.get('etag') ?? '' };
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return { state: 'aborted' };
    return { state: 'error', status: 0, code: 'network' };
  }
}

/**
 * Las filas nuevas de una lista, reusando el objeto anterior de cada fila que
 * no cambió: las filas memoizadas no se vuelven a dibujar. Si nada cambió,
 * devuelve la misma lista.
 */
export function reuseRows<T extends { id: string }>(prev: readonly T[], next: readonly T[]): T[] {
  if (prev.length === 0) return next as T[];
  const old = new Map(prev.map((r) => [r.id, r]));
  let same = prev.length === next.length;
  const out = next.map((r, i) => {
    const before = old.get(r.id);
    const keep = before && JSON.stringify(before) === JSON.stringify(r) ? before : r;
    if (keep !== prev[i]) same = false;
    return keep;
  });
  return same ? (prev as T[]) : out;
}

/**
 * Caché en memoria de las listas ya vistas (una entrada por carpeta, vista o
 * filtro): volver a una que se acaba de ver la muestra al instante mientras
 * se revalida. Guarda pocas (las más recientes) y vive lo que vive la pestaña.
 */
export class ListCache<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max = 30) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  delete(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}
