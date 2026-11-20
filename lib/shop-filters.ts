/**
 * Shop: filtros de una colección en la tienda pública. Puro y sin imports del
 * servidor: lo usa el componente de la colección en el navegador.
 *
 * Las opciones (Talle, Color...) se escriben a mano en cada producto, así que
 * se agrupan por nombre sin mayúsculas ni espacios de más: "Talle" y "talle "
 * son el mismo filtro. Un producto entra si una misma variante cumple todo lo
 * marcado: el talle M en rojo tiene que existir (y tener stock si se pide
 * "solo con stock"), no un M azul y un S rojo.
 */

export interface FilterVariant {
  options: string[];
  priceCents: number;
  available: boolean;
}

export interface FilterableProduct {
  /** Nombres de las opciones del producto, en el orden de `FilterVariant.options`. */
  optionNames: string[];
  variants: FilterVariant[];
  vendor?: string;
  productType?: string;
}

/**
 * Filtros del producto (no de la variante): proveedor y tipo. Las claves
 * llevan un punto para no chocar con una opción que se llame "Tipo".
 */
export const PRODUCT_FACETS = { 'p.vendor': 'vendor', 'p.type': 'productType' } as const;
export type ProductFacetKey = keyof typeof PRODUCT_FACETS;

export function isProductFacet(key: string): key is ProductFacetKey {
  return key in PRODUCT_FACETS;
}

export interface FacetValue {
  key: string;
  label: string;
  /** Productos que quedarían al marcar este valor, con el resto de los filtros como están. */
  count: number;
}

export interface Facet {
  key: string;
  /** El nombre de la opción como lo escribió la tienda; vacío en los filtros de producto (el componente pone el texto). */
  label: string;
  values: FacetValue[];
}

export interface CollectionFilters {
  inStock: boolean;
  /** Precio máximo en centavos, o null. */
  maxCents: number | null;
  /** Por clave de filtro, las claves de los valores marcados (OR dentro del filtro, AND entre filtros). */
  options: Record<string, string[]>;
}

export const EMPTY_FILTERS: CollectionFilters = { inStock: false, maxCents: null, options: {} };

/** Hasta cuántos filtros de opción (más proveedor y tipo) y valores por filtro se muestran. */
export const MAX_FACETS = 4;
export const MAX_FACET_VALUES = 30;

/** "  Talle " → "talle". Clave estable para agrupar nombres y valores escritos a mano. */
export function facetKey(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function variantMatches(p: FilterableProduct, v: FilterVariant, f: CollectionFilters, skip: string | null): boolean {
  if (f.inStock && !v.available) return false;
  if (f.maxCents != null && v.priceCents > f.maxCents) return false;
  for (const [name, picked] of Object.entries(f.options)) {
    if (name === skip || !picked.length) continue;
    if (isProductFacet(name)) {
      if (!picked.includes(facetKey(p[PRODUCT_FACETS[name]] ?? ''))) return false;
      continue;
    }
    const i = p.optionNames.findIndex((n) => facetKey(n) === name);
    if (i < 0) return false;
    const value = v.options[i];
    if (value == null || !picked.includes(facetKey(value))) return false;
  }
  return true;
}

/** ¿Alguna variante cumple los filtros? `skip` ignora un filtro de opción (para contar sus valores). */
export function productMatches(p: FilterableProduct, f: CollectionFilters, skip: string | null = null): boolean {
  if (!p.variants.length) return activeFilterCount(f) === 0;
  return p.variants.some((v) => variantMatches(p, v, f, skip));
}

export function filterProducts<T extends FilterableProduct>(products: T[], f: CollectionFilters): T[] {
  return products.filter((p) => productMatches(p, f));
}

function facetValues(products: FilterableProduct[], f: CollectionFilters, key: string, values: Map<string, string>): FacetValue[] {
  const others = products.filter((p) => productMatches(p, f, key));
  return [...values.entries()].slice(0, MAX_FACET_VALUES).map(([vk, label]) => ({
    key: vk,
    label,
    count: others.filter((p) => productMatches(p, { ...f, options: { ...f.options, [key]: [vk] } })).length,
  }));
}

/**
 * Filtros de opción de una colección: los nombres que comparten al menos dos
 * valores distintos, ordenados por cuántos productos los tienen. Los valores
 * siguen el orden en que aparecen en los productos (S, M, L), y cada uno
 * cuenta los productos que quedarían si se marca, con los demás filtros.
 */
export function collectionFacets(products: FilterableProduct[], f: CollectionFilters = EMPTY_FILTERS): Facet[] {
  const groups = new Map<string, { label: string; products: number; values: Map<string, string> }>();
  for (const p of products) {
    p.optionNames.forEach((name, i) => {
      const key = facetKey(name);
      if (!key) return;
      let g = groups.get(key);
      if (!g) {
        g = { label: name.trim(), products: 0, values: new Map() };
        groups.set(key, g);
      }
      g.products += 1;
      for (const v of p.variants) {
        const raw = v.options[i];
        const vk = raw == null ? '' : facetKey(raw);
        if (vk && !g.values.has(vk)) g.values.set(vk, raw.trim());
      }
    });
  }
  return [...groups.entries()]
    .filter(([, g]) => g.values.size >= 2)
    .sort((a, b) => b[1].products - a[1].products)
    .slice(0, MAX_FACETS)
    .map(([key, g]) => ({ key, label: g.label, values: facetValues(products, f, key, g.values) }))
    .concat(productFacets(products, f));
}

/** Proveedor y tipo, cuando la colección tiene al menos dos distintos. Ordenados por nombre. */
function productFacets(products: FilterableProduct[], f: CollectionFilters): Facet[] {
  return (Object.keys(PRODUCT_FACETS) as ProductFacetKey[]).flatMap((key) => {
    const values = new Map<string, string>();
    for (const p of products) {
      const raw = (p[PRODUCT_FACETS[key]] ?? '').trim();
      const vk = facetKey(raw);
      if (vk && !values.has(vk)) values.set(vk, raw);
    }
    if (values.size < 2) return [];
    const sorted = new Map([...values.entries()].sort((a, b) => a[1].localeCompare(b[1])));
    return [{ key, label: '', values: facetValues(products, f, key, sorted) }];
  });
}

export function activeFilterCount(f: CollectionFilters): number {
  return (f.inStock ? 1 : 0) + (f.maxCents != null ? 1 : 0) + Object.values(f.options).reduce((n, v) => n + v.length, 0);
}

/** Marca o desmarca un valor de un filtro de opción. */
export function toggleOption(f: CollectionFilters, facet: string, value: string): CollectionFilters {
  const current = f.options[facet] ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  const options = { ...f.options };
  if (next.length) options[facet] = next;
  else delete options[facet];
  return { ...f, options };
}

/**
 * Filtros en la URL, para compartir una colección filtrada:
 * `?talle=m&talle=l&stock=1&max=5000`. Las opciones usan el prefijo `o.` para
 * no chocar con los demás parámetros.
 */
export function filtersToSearch(f: CollectionFilters, sort: string): string {
  const sp = new URLSearchParams();
  if (sort && sort !== 'manual') sp.set('sort', sort);
  if (f.inStock) sp.set('stock', '1');
  if (f.maxCents != null) sp.set('max', String(f.maxCents));
  for (const [k, vs] of Object.entries(f.options)) for (const v of vs) sp.append(`o.${k}`, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function filtersFromSearch(search: string): { filters: CollectionFilters; sort: string | null } {
  const sp = new URLSearchParams(search);
  const max = Number(sp.get('max'));
  const options: Record<string, string[]> = {};
  for (const [k, v] of sp.entries()) {
    if (!k.startsWith('o.')) continue;
    const key = facetKey(k.slice(2)).slice(0, 40);
    const value = facetKey(v).slice(0, 60);
    if (!key || !value) continue;
    const list = (options[key] ??= []);
    if (!list.includes(value) && list.length < MAX_FACET_VALUES) list.push(value);
  }
  return {
    filters: { inStock: sp.get('stock') === '1', maxCents: sp.has('max') && Number.isInteger(max) && max >= 0 ? max : null, options },
    sort: sp.get('sort'),
  };
}
