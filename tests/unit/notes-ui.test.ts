import { describe, expect, it } from 'vitest';
import { emptyKind, filterQuery, listKey, sameFilter, stepIndex } from '@/components/notes/notes-ui';

describe('notes ui: filtros y lista', () => {
  it('filterQuery arma la query de /api/notes', () => {
    expect(filterQuery({ kind: 'all' }, '', 'updated')).toBe('sort=updated');
    expect(filterQuery({ kind: 'trash' }, ' wifi ', 'title')).toBe('view=trash&q=wifi&sort=title');
    expect(filterQuery({ kind: 'notebook', id: 'nb1' }, '', 'created')).toBe('notebook=nb1&sort=created');
    expect(filterQuery({ kind: 'tag', tag: 'q4' }, '', 'updated')).toBe('tag=q4&sort=updated');
  });

  it('listKey ignora la búsqueda: tipear no muestra el esqueleto, cambiar de filtro sí', () => {
    expect(listKey({ kind: 'all' }, 'updated')).toBe(listKey({ kind: 'all' }, 'updated'));
    expect(listKey({ kind: 'all' }, 'updated')).not.toBe(listKey({ kind: 'pinned' }, 'updated'));
    expect(listKey({ kind: 'all' }, 'updated')).not.toBe(listKey({ kind: 'all' }, 'title'));
  });

  it('sameFilter compara libreta y etiqueta por valor', () => {
    expect(sameFilter({ kind: 'notebook', id: 'a' }, { kind: 'notebook', id: 'a' })).toBe(true);
    expect(sameFilter({ kind: 'notebook', id: 'a' }, { kind: 'notebook', id: 'b' })).toBe(false);
    expect(sameFilter({ kind: 'tag', tag: 'x' }, { kind: 'all' })).toBe(false);
    expect(sameFilter({ kind: 'trash' }, { kind: 'trash' })).toBe(true);
  });

  it('emptyKind elige el estado vacío; la búsqueda gana', () => {
    expect(emptyKind({ kind: 'all' }, '')).toBe('all');
    expect(emptyKind({ kind: 'trash' }, '')).toBe('trash');
    expect(emptyKind({ kind: 'pinned' }, '')).toBe('pinned');
    expect(emptyKind({ kind: 'notebook', id: 'a' }, '')).toBe('notebook');
    expect(emptyKind({ kind: 'trash' }, 'x')).toBe('search');
  });

  it('stepIndex: flechas acotadas, sin dar la vuelta; Home/End', () => {
    expect(stepIndex(-1, 'ArrowDown', 3)).toBe(0);
    expect(stepIndex(-1, 'ArrowUp', 3)).toBe(2);
    expect(stepIndex(0, 'ArrowDown', 3)).toBe(1);
    expect(stepIndex(2, 'ArrowDown', 3)).toBe(2);
    expect(stepIndex(0, 'ArrowUp', 3)).toBe(0);
    expect(stepIndex(1, 'Home', 3)).toBe(0);
    expect(stepIndex(1, 'End', 3)).toBe(2);
    expect(stepIndex(1, 'Enter', 3)).toBeNull();
    expect(stepIndex(-1, 'ArrowDown', 0)).toBeNull();
  });
});

describe('notes ui: snippet de la lista', () => {
  it('las tareas van como texto plano, sin marcador', async () => {
    const { makeSnippet } = await import('@/lib/notes-types');
    expect(makeSnippet('[ ] Café\n[x] Pan')).toBe('Café, Pan');
    expect(makeSnippet('Compras\n[ ] Café\nFin')).toBe('Compras Café, Fin');
  });

  it('el snippet de búsqueda (⌘K) también saca las marcas de tarea', async () => {
    const { snippetAround } = await import('@/lib/notes-types');
    expect(snippetAround('[ ] milk\n[ ] eggs', ['eggs'])).toBe('milk, eggs');
    const long = `${'intro '.repeat(40)}\n[x] milk\n[ ] eggs`;
    const s = snippetAround(long, ['eggs']);
    expect(s).toContain('milk, eggs');
    expect(s).not.toContain('[ ]');
    expect(s).not.toContain('[x]');
  });
});
