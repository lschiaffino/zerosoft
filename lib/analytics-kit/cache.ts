/**
 * Analítica, el kit: caché corta de un tablero en memoria (por proceso).
 * Recargar o volver a un período no vuelve a leer la base. La clave tiene que
 * incluir a quien mira, lo que puede ver y todo lo que cambia el resultado.
 */
export function shortCache<T>(ttlMs = 45_000, max = 200) {
  const store = new Map<string, { at: number; data: Promise<T> }>();
  return {
    get(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
      const hit = store.get(key);
      if (hit && now - hit.at < ttlMs) return hit.data;
      if (store.size >= max) {
        for (const [k, v] of store) if (now - v.at >= ttlMs || store.size >= max) store.delete(k);
      }
      const data = load();
      store.set(key, { at: now, data });
      // Un error no se guarda: el próximo pedido vuelve a intentar.
      data.catch(() => store.delete(key));
      return data;
    },
    clear(): void {
      store.clear();
    },
  };
}
