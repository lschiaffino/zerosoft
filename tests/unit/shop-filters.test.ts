import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  activeFilterCount,
  collectionFacets,
  facetKey,
  filterProducts,
  filtersFromSearch,
  filtersToSearch,
  toggleOption,
  type FilterableProduct,
} from '@/lib/shop-filters';

const v = (options: string[], priceCents = 1000, available = true) => ({ options, priceCents, available });

// Remera: talle M solo en rojo; S en azul y rojo. Buzo: "talle " escrito distinto, M sin stock.
const remera: FilterableProduct & { id: string } = {
  id: 'remera',
  optionNames: ['Talle', 'Color'],
  variants: [v(['S', 'Azul']), v(['S', 'Rojo']), v(['M', 'Rojo'], 1500)],
};
const buzo: FilterableProduct & { id: string } = {
  id: 'buzo',
  optionNames: ['talle '],
  variants: [v(['m'], 3000, false), v(['L'], 3000)],
};
const gorra: FilterableProduct & { id: string } = { id: 'gorra', optionNames: [], variants: [v([], 500)] };
const all = [remera, buzo, gorra];
const ids = (list: Array<{ id: string }>) => list.map((p) => p.id);

describe('collectionFacets', () => {
  it('agrupa opciones escritas distinto y respeta el orden de los valores', () => {
    const facets = collectionFacets(all);
    expect(facets.map((f) => f.key)).toEqual(['talle', 'color']);
    expect(facets[0].label).toBe('Talle');
    expect(facets[0].values.map((x) => x.label)).toEqual(['S', 'M', 'L']);
    expect(facets[0].values.map((x) => x.count)).toEqual([1, 2, 1]);
  });

  it('no muestra una opción con un solo valor', () => {
    const solo = { optionNames: ['Material'], variants: [v(['Algodón']), v(['algodón '])] };
    expect(collectionFacets([solo])).toEqual([]);
  });

  it('cuenta cada valor con los otros filtros aplicados', () => {
    const f = { ...EMPTY_FILTERS, inStock: true, options: { color: ['rojo'] } };
    const talle = collectionFacets(all, f).find((x) => x.key === 'talle')!;
    // Con rojo y stock: S y M de la remera; el buzo no tiene color.
    expect(talle.values.map((x) => [x.key, x.count])).toEqual([
      ['s', 1],
      ['m', 1],
      ['l', 0],
    ]);
  });
});

describe('filterProducts', () => {
  it('sin filtros devuelve todo, también un producto sin opciones', () => {
    expect(ids(filterProducts(all, EMPTY_FILTERS))).toEqual(['remera', 'buzo', 'gorra']);
  });

  it('OR dentro de una opción y AND entre opciones, sobre la misma variante', () => {
    expect(ids(filterProducts(all, { ...EMPTY_FILTERS, options: { talle: ['m'] } }))).toEqual(['remera', 'buzo']);
    expect(ids(filterProducts(all, { ...EMPTY_FILTERS, options: { talle: ['s', 'l'] } }))).toEqual(['remera', 'buzo']);
    // M azul no existe aunque la remera tenga M y tenga azul.
    expect(ids(filterProducts(all, { ...EMPTY_FILTERS, options: { talle: ['m'], color: ['azul'] } }))).toEqual([]);
  });

  it('el stock y el precio se miran en la variante elegida', () => {
    expect(ids(filterProducts(all, { ...EMPTY_FILTERS, inStock: true, options: { talle: ['m'] } }))).toEqual(['remera']);
    expect(ids(filterProducts(all, { ...EMPTY_FILTERS, maxCents: 1200, options: { talle: ['m'] } }))).toEqual([]);
    expect(ids(filterProducts(all, { ...EMPTY_FILTERS, maxCents: 1200 }))).toEqual(['remera', 'gorra']);
  });
});

describe('toggleOption y conteo', () => {
  it('marca, desmarca y borra el filtro vacío', () => {
    let f = toggleOption(EMPTY_FILTERS, 'talle', 'm');
    f = toggleOption(f, 'talle', 'l');
    expect(f.options).toEqual({ talle: ['m', 'l'] });
    expect(activeFilterCount({ ...f, inStock: true })).toBe(3);
    f = toggleOption(toggleOption(f, 'talle', 'm'), 'talle', 'l');
    expect(f.options).toEqual({});
  });
});

describe('filtros en la URL', () => {
  it('ida y vuelta', () => {
    const f = { inStock: true, maxCents: 5000, options: { talle: ['m', 'l'], color: ['rojo'] } };
    const qs = filtersToSearch(f, 'price-asc');
    expect(filtersFromSearch(qs)).toEqual({ filters: f, sort: 'price-asc' });
    expect(filtersToSearch(EMPTY_FILTERS, 'manual')).toBe('');
  });

  it('normaliza y descarta lo que no sirve', () => {
    const { filters } = filtersFromSearch('?o.Talle=%20M%20&o.talle=m&o.=x&max=-3&stock=yes&utm_source=ig');
    expect(filters).toEqual({ inStock: false, maxCents: null, options: { talle: ['m'] } });
    expect(facetKey('  Azul   Marino ')).toBe('azul marino');
  });
});

describe('proveedor y tipo', () => {
  const a = { id: 'a', optionNames: [], variants: [v([])], vendor: 'Acme', productType: 'Remera' };
  const b = { id: 'b', optionNames: [], variants: [v([])], vendor: 'acme ', productType: 'Buzo' };
  const c = { id: 'c', optionNames: [], variants: [v([])], vendor: 'Zeta', productType: '' };
  // Una opción que se llama "Type" no se mezcla con el tipo de producto.
  const d = { id: 'd', optionNames: ['Type'], variants: [v(['Remera']), v(['Buzo'])], vendor: '', productType: '' };

  it('se ofrecen con dos valores distintos o más, ordenados por nombre', () => {
    const facets = collectionFacets([a, b, c, d]);
    expect(facets.map((f) => f.key)).toEqual(['type', 'p.vendor', 'p.type']);
    expect(facets[1].values.map((x) => [x.label, x.count])).toEqual([
      ['Acme', 2],
      ['Zeta', 1],
    ]);
    expect(facets[2].values.map((x) => x.key)).toEqual(['buzo', 'remera']);
  });

  it('filtran el producto, aparte de las opciones', () => {
    expect(ids(filterProducts([a, b, c, d], { ...EMPTY_FILTERS, options: { 'p.type': ['remera'] } }))).toEqual(['a']);
    expect(ids(filterProducts([a, b, c, d], { ...EMPTY_FILTERS, options: { type: ['remera'] } }))).toEqual(['d']);
    expect(ids(filterProducts([a, b, c, d], { ...EMPTY_FILTERS, options: { 'p.vendor': ['acme'], 'p.type': ['buzo'] } }))).toEqual(['b']);
  });
});
