import { describe, expect, it } from 'vitest';
import { defaultView, hsColumnsOf, nextSort, parseView, sortRows, toggleColumn, validColumn } from '@/lib/groups-table-view';

describe('vista de la tabla de grupos', () => {
  it('por defecto: líneas, miembros, etiquetas, empresa, dos propiedades y actividad', () => {
    expect(defaultView(['plan', 'region', 'tier']).columns).toEqual(['lines', 'members', 'labels', 'company', 'prop:plan', 'prop:region', 'activity']);
  });

  it('lo guardado se valida: columnas desconocidas, propiedades borradas y orden roto se descartan', () => {
    const v = parseView(
      { columns: ['lines', 'nope', 'prop:plan', 'prop:gone', 'hs:plan_tier', 'hs:bad name', 'lines'], sort: { col: 'hs:plan_tier', dir: 'desc' }, status: ['closed'], filters: { lines: ['n1'], q: 'x', status: ['closed'] } },
      ['plan'],
    );
    expect(v.columns).toEqual(['lines', 'prop:plan', 'hs:plan_tier']);
    expect(v.sort).toEqual({ col: 'hs:plan_tier', dir: 'desc' });
    expect(v.status).toEqual(['closed']);
    // La búsqueda y el estado no viajan en los filtros.
    expect(v.filters).toEqual({ lines: ['n1'] });
    expect(parseView({ columns: [], sort: { col: 'x', dir: 'up' }, status: ['open', 'closed'] }, []).sort).toBeNull();
    expect(parseView({ columns: [], status: ['open', 'closed'] }, []).status).toEqual([]);
    expect(parseView('roto', ['plan'])).toEqual(defaultView(['plan']));
  });

  it('las columnas de propiedades de la tabla anterior se conservan', () => {
    expect(parseView(null, ['plan', 'region'], ['region', 'borrada']).columns).toEqual(['lines', 'members', 'labels', 'company', 'prop:region', 'activity']);
  });

  it('mostrar una columna la pone antes de la actividad; ocultarla la saca', () => {
    const cols = ['lines', 'activity'];
    expect(toggleColumn(cols, 'hs:domain')).toEqual(['lines', 'hs:domain', 'activity']);
    expect(toggleColumn(cols, 'created')).toEqual(['lines', 'activity', 'created']);
    expect(toggleColumn(['lines', 'hs:domain'], 'hs:domain')).toEqual(['lines']);
    expect(hsColumnsOf(['lines', 'hs:domain', 'prop:x', 'hs:plan_tier'])).toEqual(['domain', 'plan_tier']);
    expect(validColumn('company')).toBe(true);
    expect(validColumn('prop:Bad')).toBe(false);
  });

  it('el encabezado alterna ascendente, descendente y sin orden', () => {
    expect(nextSort(null, 'name')).toEqual({ col: 'name', dir: 'asc' });
    expect(nextSort({ col: 'name', dir: 'asc' }, 'name')).toEqual({ col: 'name', dir: 'desc' });
    expect(nextSort({ col: 'name', dir: 'desc' }, 'name')).toBeNull();
    expect(nextSort({ col: 'name', dir: 'desc' }, 'members')).toEqual({ col: 'members', dir: 'asc' });
  });

  it('ordenar: texto sin tildes ni mayúsculas, números, y lo vacío siempre al final', () => {
    const rows = [{ v: 'beta' }, { v: null }, { v: 'Álamo' }, { v: 'acme' }, { v: '' }];
    expect(sortRows(rows, 'asc', (r) => r.v).map((r) => r.v)).toEqual(['acme', 'Álamo', 'beta', null, '']);
    expect(sortRows(rows, 'desc', (r) => r.v).map((r) => r.v)).toEqual(['beta', 'Álamo', 'acme', null, '']);
    const nums = [{ v: 10 }, { v: 9 }, { v: null }, { v: 100 }];
    expect(sortRows(nums, 'asc', (r) => r.v).map((r) => r.v)).toEqual([9, 10, 100, null]);
    // Texto con números: "Grupo 2" antes que "Grupo 10".
    expect(sortRows([{ v: 'Grupo 10' }, { v: 'Grupo 2' }], 'asc', (r) => r.v).map((r) => r.v)).toEqual(['Grupo 2', 'Grupo 10']);
  });
});
