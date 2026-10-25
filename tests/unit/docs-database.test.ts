import { describe, expect, it } from 'vitest';
import type { DbProperty, DbRow, DocsBlock, DocsDatabase } from '@/lib/docs-types';
import {
  addRow,
  addView,
  changePropertyType,
  databaseRowEntries,
  databaseSearchText,
  databaseTable,
  dbValueHref,
  defaultDatabase,
  filterDefaults,
  groupRows,
  matchesFilter,
  moveRow,
  normalizeDatabase,
  parseDateText,
  parseNumber,
  removeOption,
  removeProperty,
  removeView,
  rowTitle,
  setCell,
  sortRows,
  valueForGroup,
  viewRows,
  visibleProperties,
} from '@/lib/docs-database';
import { sanitizeBlocks } from '@/lib/docs-sanitize';
import { docsBlockSchema, docsPatchTooLong } from '@/lib/docs-schema';
import { pageLinkHtml, resolveBlocksPageLinks, resolvePageLinks } from '@/lib/docs-page-links';
import { findFileBlock, stripFileUrls } from '@/lib/docs-files';
import { blockSearchText } from '@/lib/docs-search';
import { blocksToMarkdown } from '@/lib/docs-markdown';

const T = '2026-01-01T10:00:00.000Z';
const row = (id: string, values: DbRow['values'], extra: Partial<DbRow> = {}): DbRow => ({ id, values, created_at: T, updated_at: T, ...extra });

function sample(): DocsDatabase {
  const props: DbProperty[] = [
    { id: 'name', name: 'Name', type: 'title' },
    {
      id: 'st',
      name: 'Status',
      type: 'status',
      options: [
        { id: 'done', name: 'Done', group: 'done' },
        { id: 'todo', name: 'Todo', group: 'todo' },
        { id: 'doing', name: 'Doing', group: 'in_progress' },
      ],
    },
    { id: 'pts', name: 'Points', type: 'number' },
    { id: 'tags', name: 'Tags', type: 'multi_select', options: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }] },
    { id: 'who', name: 'Owner', type: 'person' },
    { id: 'due', name: 'Due', type: 'date' },
    { id: 'ok', name: 'OK', type: 'checkbox' },
    { id: 'url', name: 'Link', type: 'url' },
  ];
  return {
    properties: props,
    rows: [
      row('r1', { name: 'Write spec', st: 'doing', pts: 3, tags: ['a'], who: ['u1'], due: '2026-03-10', ok: true }),
      row('r2', { name: 'Ship', st: 'todo', pts: 8, tags: ['a', 'b'], who: ['u1', 'u2'], due: '2026-02-01' }),
      row('r3', { name: 'Áreas', st: 'done', who: [] }),
      row('r4', { pts: 1 }),
    ],
    views: [{ id: 'v1', name: '', type: 'table' }],
    active_view: 'v1',
  };
}

const people = { u1: 'Ana', u2: 'Beto' };

describe('normalizeDatabase (formato viejo)', () => {
  const legacy: DocsBlock = {
    id: 'blk',
    type: 'database',
    content: '',
    columns: [
      { id: 'c1', name: 'Name', type: 'text' },
      { id: 'c2', name: 'Status', type: 'select', options: ['Todo', 'Done'] },
      { id: 'c3', name: 'Due', type: 'date' },
      { id: 'c4', name: 'Pts', type: 'number' },
    ],
    rows: [
      ['Uno', 'Done', '2026-01-05', '4'],
      ['Dos', 'Otro', '', 'x'],
    ],
    view: 'gallery',
  };

  it('migra columnas, filas y vista de forma determinística', () => {
    const a = normalizeDatabase(legacy);
    const b = normalizeDatabase({ ...legacy });
    expect(a).toEqual(b);
    expect(a.properties.map((p) => p.type)).toEqual(['title', 'select', 'date', 'number']);
    expect(a.rows.map((r) => r.id)).toEqual(['blk-r0', 'blk-r1']);
    expect(rowTitle(a, a.rows[0])).toBe('Uno');
    // Valor usado que no era opción: pasa a ser opción.
    expect(a.properties[1].options?.map((o) => o.name)).toEqual(['Todo', 'Done', 'Otro']);
    expect(a.rows[0].values.c4).toBe(4);
    expect(a.rows[1].values.c4).toBeUndefined();
    expect(a.views.map((v) => v.type)).toEqual(['table', 'gallery']);
    expect(a.active_view).toBe(a.views[1].id);
  });

  it('sin columna de texto agrega un título', () => {
    const db = normalizeDatabase({ id: 'x', type: 'database', content: '', columns: [{ id: 'n', name: 'N', type: 'number' }], rows: [['2']] });
    expect(db.properties[0].type).toBe('title');
    expect(db.rows[0].values.n).toBe(2);
  });

  it('cachea por bloque (mismo objeto, mismo resultado)', () => {
    expect(normalizeDatabase(legacy)).toBe(normalizeDatabase(legacy));
  });
});

describe('filtros', () => {
  const db = sample();
  const f = (property: string, op: Parameters<typeof matchesFilter>[2]['op'], value?: unknown) =>
    db.rows.filter((r) => matchesFilter(db, r, { id: 'f', property, op, value: value as never })).map((r) => r.id);

  it('texto sin tildes ni mayúsculas', () => {
    expect(f('name', 'contains', 'area')).toEqual(['r3']);
    expect(f('name', 'starts_with', 'ship')).toEqual(['r2']);
    expect(f('name', 'empty')).toEqual(['r4']);
    expect(f('name', 'not_contains', 'i')).toEqual(['r3', 'r4']);
  });
  it('número, status, multi, persona, fecha, checkbox', () => {
    expect(f('pts', 'gt', 2)).toEqual(['r1', 'r2']);
    expect(f('pts', 'lte', 3)).toEqual(['r1', 'r4']);
    expect(f('st', 'is', 'todo')).toEqual(['r2']);
    expect(f('st', 'is_not', 'todo')).toEqual(['r1', 'r3', 'r4']);
    expect(f('tags', 'contains', 'b')).toEqual(['r2']);
    expect(f('who', 'contains', 'u1')).toEqual(['r1', 'r2']);
    expect(f('who', 'empty')).toEqual(['r3', 'r4']);
    expect(f('due', 'before', '2026-03-01')).toEqual(['r2']);
    expect(f('due', 'on_or_after', '2026-03-10')).toEqual(['r1']);
    expect(f('ok', 'checked')).toEqual(['r1']);
    expect(f('ok', 'unchecked')).toEqual(['r2', 'r3', 'r4']);
  });
  it('una condición sin valor no filtra', () => {
    expect(f('name', 'contains', '')).toHaveLength(4);
    expect(f('gone', 'contains', 'x')).toHaveLength(4);
  });
  it('viewRows: filtros en AND', () => {
    const v = { id: 'v', name: '', type: 'table' as const, filters: [
      { id: '1', property: 'tags', op: 'contains' as const, value: 'a' },
      { id: '2', property: 'pts', op: 'gt' as const, value: 5 },
    ] };
    expect(viewRows(db, v).map((r) => r.id)).toEqual(['r2']);
  });
});

describe('orden', () => {
  const db = sample();
  it('multi-clave, vacíos al final en las dos direcciones, estable', () => {
    expect(sortRows(db, db.rows, [{ property: 'pts', direction: 'asc' }]).map((r) => r.id)).toEqual(['r4', 'r1', 'r2', 'r3']);
    expect(sortRows(db, db.rows, [{ property: 'pts', direction: 'desc' }]).map((r) => r.id)).toEqual(['r2', 'r1', 'r4', 'r3']);
    // Status por grupo: to-do, en curso, hecho.
    expect(sortRows(db, db.rows, [{ property: 'st', direction: 'asc' }]).map((r) => r.id)).toEqual(['r2', 'r1', 'r3', 'r4']);
    const two = sortRows(db, db.rows, [{ property: 'ok', direction: 'asc' }, { property: 'pts', direction: 'desc' }]);
    expect(two.map((r) => r.id)).toEqual(['r2', 'r4', 'r3', 'r1']);
  });
  it('rinde con 1.000 filas', () => {
    const big: DocsDatabase = { ...db, rows: Array.from({ length: 1000 }, (_, i) => row(`x${i}`, { name: `Row ${1000 - i}`, pts: i % 7 })) };
    const t0 = performance.now();
    const out = viewRows(big, { id: 'v', name: '', type: 'table', sorts: [{ property: 'pts', direction: 'desc' }, { property: 'name', direction: 'asc' }], filters: [{ id: 'f', property: 'name', op: 'contains', value: 'row' }] });
    expect(out).toHaveLength(1000);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(out[0].values.pts).toBe(6);
  });
});

describe('agrupar y board', () => {
  const db = sample();
  it('status en orden de grupos; personas repiten fila; sin valor primero (como Notion)', () => {
    const st = groupRows(db, db.properties[1], db.rows);
    expect(st.map((g) => g.key)).toEqual(['', 'todo', 'doing', 'done']);
    expect(st[0].rows.map((r) => r.id)).toEqual(['r4']);
    const who = groupRows(db, db.properties[4], db.rows, { people });
    expect(who.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['', ['r3', 'r4']],
      ['Ana', ['r1', 'r2']],
      ['Beto', ['r2']],
    ]);
    const ok = groupRows(db, db.properties[6], db.rows);
    expect(ok.map((g) => g.rows.length)).toEqual([1, 3]);
  });
  it('mover entre columnas', () => {
    const r2 = db.rows[1];
    expect(valueForGroup(db.properties[1], r2, 'done', 'todo')).toBe('done');
    expect(valueForGroup(db.properties[1], r2, '', 'todo')).toBeNull();
    expect(valueForGroup(db.properties[4], r2, 'u3', 'u2')).toEqual(['u1', 'u3']);
    expect(valueForGroup(db.properties[6], r2, 'true', 'false')).toBe(true);
  });
  it('moveRow y addRow', () => {
    expect(moveRow(db, 'r4', 'r1').rows.map((r) => r.id)).toEqual(['r4', 'r1', 'r2', 'r3']);
    expect(moveRow(db, 'r1', null).rows.map((r) => r.id)).toEqual(['r2', 'r3', 'r4', 'r1']);
    const { db: next, row: added } = addRow(db, { name: 'Nueva' });
    expect(next.rows.at(-1)).toBe(added);
    expect(added.id).toMatch(/^[a-z0-9]{6,}$/);
  });
  it('filterDefaults: la fila nueva entra en la vista filtrada', () => {
    const v = { id: 'v', name: '', type: 'table' as const, filters: [
      { id: '1', property: 'st', op: 'is' as const, value: 'doing' },
      { id: '2', property: 'tags', op: 'contains' as const, value: 'b' },
      { id: '3', property: 'ok', op: 'checked' as const },
    ] };
    expect(filterDefaults(db, v)).toEqual({ st: 'doing', tags: ['b'], ok: true });
  });
});

describe('cambio de tipo', () => {
  const db = sample();
  it('número → texto → número', () => {
    const asText = changePropertyType(db, 'pts', 'text');
    expect(asText.rows[1].values.pts).toBe('8');
    const back = changePropertyType(asText, 'pts', 'number');
    expect(back.rows.map((r) => r.values.pts)).toEqual([3, 8, undefined, 1]);
  });
  it('texto → select crea una opción por valor distinto; select → multi conserva', () => {
    const a = changePropertyType({ ...db, rows: [row('1', { url: 'x' }), row('2', { url: 'X' }), row('3', { url: 'y' })] }, 'url', 'select');
    const prop = a.properties.find((p) => p.id === 'url')!;
    expect(prop.options?.map((o) => o.name)).toEqual(['x', 'y']);
    expect(a.rows[0].values.url).toBe(a.rows[1].values.url);
    const multi = changePropertyType(a, 'url', 'multi_select');
    expect(multi.rows[2].values.url).toEqual([prop.options![1].id]);
  });
  it('status → checkbox por grupo hecho; checkbox → status', () => {
    const c = changePropertyType(db, 'st', 'checkbox');
    expect(c.rows.map((r) => r.values.st)).toEqual([false, false, true, false]);
    const s = changePropertyType(db, 'ok', 'status');
    const prop = s.properties.find((p) => p.id === 'ok')!;
    expect(prop.options?.find((o) => o.id === s.rows[0].values.ok)?.group).toBe('done');
  });
  it('multi → texto y texto → persona por nombre o email', () => {
    const t = changePropertyType(db, 'tags', 'text');
    expect(t.rows[1].values.tags).toBe('Alpha, Beta');
    const withNames = { ...db, rows: [row('1', { url: 'ana@x.com, Beto' })] };
    const p = changePropertyType(withNames, 'url', 'person', { members: [{ id: 'u1', name: 'Ana', email: 'ana@x.com' }, { id: 'u2', name: 'Beto', email: 'b@x.com' }] });
    expect(p.rows[0].values.url).toEqual(['u1', 'u2']);
  });
  it('fecha ↔ texto, y el título no cambia de tipo', () => {
    expect(changePropertyType(db, 'due', 'text').rows[0].values.due).toBe('2026-03-10');
    expect(changePropertyType(db, 'name', 'number')).toBe(db);
  });
  it('a created time se descartan los valores y sus filtros', () => {
    const withFilter = { ...db, views: [{ id: 'v', name: '', type: 'table' as const, filters: [{ id: 'f', property: 'due', op: 'is' as const, value: '2026-03-10' }] }] };
    const c = changePropertyType(withFilter, 'due', 'created_time');
    expect(c.rows[0].values.due).toBeUndefined();
    expect(c.views[0].filters).toEqual([]);
  });
});

describe('edición', () => {
  it('setCell vacío borra, removeProperty/removeOption limpian vistas y celdas', () => {
    const db = sample();
    expect(setCell(db, 'r1', 'name', '').rows[0].values.name).toBeUndefined();
    const v = { ...db, views: [{ id: 'v', name: '', type: 'board' as const, group_by: 'st', hidden: ['st'], sorts: [{ property: 'st', direction: 'asc' as const }] }] };
    const gone = removeProperty(v, 'st');
    expect(gone.views[0]).toMatchObject({ group_by: null, hidden: [], sorts: [] });
    expect(gone.rows[0].values.st).toBeUndefined();
    expect(removeProperty(db, 'name')).toBe(db);
    const noA = removeOption(db, 'tags', 'a');
    expect(noA.rows[1].values.tags).toEqual(['b']);
  });
  it('vistas: board toma el status, siempre queda una', () => {
    const db = sample();
    const { db: withBoard, view } = addView(db, 'board');
    expect(view.group_by).toBe('st');
    expect(withBoard.active_view).toBe(view.id);
    expect(removeView(db, 'v1')).toBe(db);
    expect(visibleProperties(db, { id: 'v', name: '', type: 'table', hidden: ['name', 'pts'] }).map((p) => p.id)).not.toContain('pts');
  });
  it('defaultDatabase: título, status con tres grupos, fecha', () => {
    const db = defaultDatabase();
    expect(db.properties.map((p) => p.type)).toEqual(['title', 'status', 'date']);
    expect(db.properties[1].options?.map((o) => o.group)).toEqual(['todo', 'in_progress', 'done']);
    expect(db.rows).toHaveLength(1);
  });
});

describe('parseo y links de celdas', () => {
  it('números y fechas', () => {
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('$ 30')).toBe(30);
    expect(parseNumber('abc')).toBeNull();
    expect(parseDateText('2026-3-7')).toBe('2026-03-07');
    expect(parseDateText('nope')).toBeNull();
  });
  it('dbValueHref solo deja esquemas seguros', () => {
    expect(dbValueHref('url', 'example.com/a')).toBe('https://example.com/a');
    expect(dbValueHref('url', 'javascript:alert(1)')).toBeNull();
    expect(dbValueHref('email', 'a@b.co')).toBe('mailto:a@b.co');
    expect(dbValueHref('phone', '+54 11 5555')).toBe('tel:+54115555');
  });
});

describe('saneado, schema, búsqueda y export', () => {
  const block = (db: DocsDatabase): DocsBlock => ({ id: 'b', type: 'database', content: '', db });

  it('sanitizeBlocks: valores según tipo, sin HTML, cuerpos sin bases, vistas válidas', () => {
    const db = sample();
    db.rows[0].values.name = '<img src=x onerror=alert(1)>Hola';
    db.rows[0].values.st = 'nope';
    db.rows[0].values.due = 'mañana';
    db.rows[0].body = [
      { id: 'p', type: 'paragraph', content: '<script>x</script><strong>ok</strong>' },
      { id: 'd', type: 'database', content: '' },
    ];
    db.views = [{ id: 'v', name: 'V', type: 'table', group_by: 'gone', filters: [{ id: 'f', property: 'gone', op: 'is', value: 'x' }] }];
    const [out] = sanitizeBlocks([block(db)]);
    const r = out.db!.rows[0];
    expect(r.values.name).toBe('Hola');
    expect(r.values.st).toBeUndefined();
    expect(r.values.due).toBeUndefined();
    expect(r.body).toEqual([{ id: 'p', type: 'paragraph', content: '<strong>ok</strong>' }]);
    expect(out.db!.views[0]).toMatchObject({ group_by: null, filters: [] });
    // Un bloque que no es database no lleva db.
    const [para] = sanitizeBlocks([{ id: 'x', type: 'paragraph', content: 'a', db }]);
    expect(para.db).toBeUndefined();
  });

  it('schema acepta la base y rechaza un tipo inválido', () => {
    expect(docsBlockSchema.safeParse(block(sample())).success).toBe(true);
    const bad = sample();
    (bad.properties[0] as { type: string }).type = 'hologram';
    expect(docsBlockSchema.safeParse(block(bad)).success).toBe(false);
  });

  it('docsPatchTooLong mira celdas y cuerpos', () => {
    const db = sample();
    db.rows[0].values.name = 'x'.repeat(30000);
    expect(docsPatchTooLong({ content: [block(db)] })).toBe(true);
    expect(docsPatchTooLong({ content: [block(sample())] })).toBe(false);
  });

  it('búsqueda, filas para Cmd+K y export Markdown de la vista activa', () => {
    const db = sample();
    db.views[0] = { ...db.views[0], hidden: ['url'], filters: [{ id: 'f', property: 'st', op: 'is_not', value: 'done' }], sorts: [{ property: 'pts', direction: 'desc' }] };
    const b = block(db);
    expect(blockSearchText(b)).toContain('Write spec');
    expect(databaseSearchText(b)).toContain('Alpha');
    expect(databaseRowEntries([b]).map((e) => e.rowId)).toEqual(['r1', 'r2', 'r3']);
    const table = databaseTable(b);
    expect(table.header).not.toContain('Owner');
    expect(table.header).not.toContain('Link');
    expect(table.rows.map((r) => r[0])).toEqual(['Ship', 'Write spec', '']);
    expect(blocksToMarkdown([b])).toContain('| Name |');
    expect(databaseTable(b, { people }).header).toContain('Owner');
  });

  it('archivos y links dentro del cuerpo de una fila', () => {
    const db = sample();
    db.rows[0].body = [
      { id: 'img', type: 'image', content: '', url: '/uploads/docs/a.png', name: 'a.png' },
      { id: 'lnk', type: 'paragraph', content: pageLinkHtml('p2', 'Viejo') },
    ];
    const blocks = [block(db)];
    expect(findFileBlock(blocks, 'img')?.id).toBe('img');
    expect(stripFileUrls(blocks)[0].db!.rows[0].body![0].url).toBe('');
    const resolved = resolveBlocksPageLinks(blocks, () => ({ href: '/x', title: 'Nuevo' }));
    expect(resolved[0].db!.rows[0].body![1].content).toContain('Nuevo');
  });

  it('links a una fila: data-row, href ?row= y conserva el título insertado', () => {
    const html = pageLinkHtml('page1', 'Fila <1>', 'row9');
    expect(html).toBe('<a href="/app/docs/page1?row=row9" data-page="page1" data-row="row9">Fila &lt;1&gt;</a>');
    const out = resolvePageLinks(html, () => ({ href: '/es/app/docs/page1', title: 'Título de la página' }));
    expect(out).toBe('<a href="/es/app/docs/page1?row=row9" data-page="page1" data-row="row9">Fila &lt;1&gt;</a>');
    const [s] = sanitizeBlocks([{ id: 'p', type: 'paragraph', content: html.replace('row9', 'row9" onclick="x') }]);
    expect(s.content).not.toContain('onclick');
    const [ok] = sanitizeBlocks([{ id: 'p', type: 'paragraph', content: html }]);
    expect(ok.content).toBe(html);
  });
});
