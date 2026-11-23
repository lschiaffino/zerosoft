'use client';

/**
 * Anterior / siguiente en la ficha: la vista de la que se abrió el registro.
 * Cada tabla (contactos, empresas, negocios) guarda en la pestaña la query de
 * su listado (vista guardada, filtros, orden; sin página) y la ficha la usa
 * para pedir los ids de esa vista en ese orden (/api/crm/view-nav).
 * sessionStorage: es de esta pestaña, como la vista que se está mirando.
 */
export type NavEntity = 'contacts' | 'companies' | 'deals';

const KEY = (entity: NavEntity) => `zs-crm-view:${entity}`;
/** Cuánto vale la lista de ids de una vista antes de volver a pedirla. */
const TTL_MS = 30_000;

export function rememberCrmView(entity: NavEntity, query: string) {
  try {
    sessionStorage.setItem(KEY(entity), query);
  } catch {
    /* sin storage (modo privado estricto): sin anterior/siguiente */
  }
}

/** El tablero no tiene un orden de tabla: lo que se abre desde ahí no muestra anterior/siguiente. */
export function forgetCrmView(entity: NavEntity) {
  try {
    sessionStorage.removeItem(KEY(entity));
  } catch {
    /* sin storage */
  }
}

export function readCrmView(entity: NavEntity): string | null {
  try {
    return sessionStorage.getItem(KEY(entity));
  } catch {
    return null;
  }
}

/** `/app/crm/<entidad>/<id>` → la entidad y el id, si la ficha tiene anterior/siguiente. */
export function navTarget(base: string): { entity: NavEntity; id: string } | null {
  const m = /^\/app\/crm\/(contacts|companies|deals)\/([^/?#]+)$/.exec(base);
  return m ? { entity: m[1] as NavEntity, id: m[2] } : null;
}

export interface NavPosition {
  index: number;
  total: number;
  prev: string | null;
  next: string | null;
}

/** Dónde está `id` en la vista, o null si no está (se abrió de otro lado). Pura. */
export function navPosition(ids: readonly string[], total: number, id: string): NavPosition | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return {
    index: i + 1,
    total: Math.max(total, ids.length),
    prev: i > 0 ? ids[i - 1] : null,
    next: i < ids.length - 1 ? ids[i + 1] : null,
  };
}

const cache = new Map<string, { at: number; ids: string[]; total: number }>();

/** Ids de la vista (con caché corta: recorrer con anterior/siguiente no vuelve a preguntar). */
export async function loadViewIds(entity: NavEntity, query: string, force = false): Promise<{ ids: string[]; total: number } | null> {
  const key = `${entity}?${query}`;
  const hit = cache.get(key);
  if (hit && !force && Date.now() - hit.at < TTL_MS) return hit;
  const res = await fetch(`/api/crm/view-nav?${new URLSearchParams({ entity, q: query })}`, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as { ids: string[]; total: number } | null;
  if (!data || !Array.isArray(data.ids)) return null;
  cache.set(key, { at: Date.now(), ids: data.ids, total: Number(data.total) || data.ids.length });
  return cache.get(key)!;
}
