import { describe, expect, it } from 'vitest';
import type { DbAutomation, DbProperty, DbRow, DocsBlock, DocsDatabase } from '@/lib/docs-types';
import {
  addProperty,
  addRow,
  addView,
  changePropertyType,
  effectiveType,
  filterOpsFor,
  formatValue,
  matchesFilter,
  removeProperty,
  sortRows,
  viewRows,
} from '@/lib/docs-database';
import { evaluateFormula, parseFormula, FormulaError } from '@/lib/docs-formula';
import { computeDatabase, computeRollup, dbKey, previewFormula, relatedSources, rollupFns } from '@/lib/docs-db-compute';
import { applyButtonActions, applyDbOps, diffDatabase, fillTemplate, remoteActions, runAutomations } from '@/lib/docs-db-ops';
import { prepareDatabaseSave, stampRows } from '@/lib/docs-db-save';
import { databaseFromCsv, exportCsv, guessColumnType, importCsvRows, parseCsv, planCsvImport, toCsv } from '@/lib/docs-db-csv';
import { sanitizeBlocks } from '@/lib/docs-sanitize';
import { docPageUpdateSchema, docsDbOpsSchema } from '@/lib/docs-schema';
import { fakeAutofill } from '@/lib/docs-db-ai';
import { findFileBlock, stripFileUrls } from '@/lib/docs-files';

const T = '2026-01-01T10:00:00.000Z';
const row = (id: string, values: DbRow['values'], extra: Partial<DbRow> = {}): DbRow => ({ id, values, created_at: T, updated_at: T, ...extra });

function tasks(): DocsDatabase {
  return {
    title: 'Tasks',
    properties: [
      { id: 'name', name: 'Name', type: 'title' },
      { id: 'pts', name: 'Points', type: 'number' },
      { id: 'done', name: 'Done', type: 'checkbox' },
      { id: 'due', name: 'Due', type: 'date' },
      { id: 'proj', name: 'Project', type: 'relation', relation: { page_id: 'pP', block_id: 'bP' } },
    ],
    rows: [
      row('t1', { name: 'Write', pts: 3, done: true, due: '2026-03-01', proj: ['p1'] }),
      row('t2', { name: 'Review', pts: 5, done: false, due: '2026-03-10', proj: ['p1'] }),
      row('t3', { name: 'Ship', pts: 8, done: true, proj: ['p2'] }),
    ],
    views: [{ id: 'v', name: '', type: 'table' }],
  };
}

function projects(): DocsDatabase {
  return {
    title: 'Projects',
    properties: [
      { id: 'pname', name: 'Name', type: 'title' },
      { id: 'tasks', name: 'Tasks', type: 'relation', relation: { page_id: 'pT', block_id: 'bT', mirror_of: 'proj' } },
      { id: 'sum', name: 'Points', type: 'rollup', rollup: { relation: 'tasks', property: 'pts', fn: 'sum' } },
      { id: 'pct', name: 'Progress', type: 'rollup', rollup: { relation: 'tasks', property: 'done', fn: 'percent_checked' } },
      { id: 'last', name: 'Last due', type: 'rollup', rollup: { relation: 'tasks', property: 'due', fn: 'latest' } },
      { id: 'f', name: 'Label', type: 'formula', formula: 'prop("Name") + ": " + format(prop("Points")) + " pts"' },
    ],
    rows: [row('p1', { pname: 'Alpha' }), row('p2', { pname: 'Beta' })],
    views: [{ id: 'v', name: '', type: 'table' }],
  };
}

describe('fórmulas', () => {
  const props: Record<string, unknown> = { Price: 12.5, Qty: 4, Name: 'Ana', Done: true, Start: '2026-02-01', Tags: ['a', 'b'] };
  const get = (n: string) => {
    if (!(n in props)) throw new FormulaError(`unknown_property:${n}`);
    const v = props[n];
    return v as never;
  };
  const ev = (src: string) => evaluateFormula(src, Object.keys(props), get, new Date(2026, 1, 10, 12).getTime());

  it('aritmética, precedencia y propiedades por nombre', () => {
    expect(ev('prop("Price") * prop("Qty")').value).toBe(50);
    expect(ev('1 + 2 * 3 ^ 2').value).toBe(19);
    expect(ev('(1 + 2) * 3').value).toBe(9);
    expect(ev('Price * Qty - 10').value).toBe(40);
    expect(ev('10 / 0').value).toBe(null);
    expect(ev('-Qty + 1').value).toBe(-3);
  });

  it('lógica, if/ifs, ternario y comparación', () => {
    expect(ev('if(prop("Done"), "✓", "")').value).toBe('✓');
    expect(ev('prop("Qty") > 3 ? "many" : "few"').value).toBe('many');
    expect(ev('ifs(Qty > 10, "a", Qty > 3, "b", "c")').value).toBe('b');
    expect(ev('and(Done, Qty == 4)').value).toBe(true);
    expect(ev('not Done or false').value).toBe(false);
    expect(ev('empty("")').value).toBe(true);
  });

  it('texto y métodos con punto', () => {
    expect(ev('concat("Hola ", Name)').value).toBe('Hola Ana');
    expect(ev('Name.length()').value).toBe(3);
    expect(ev('upper(Name) + "!"').value).toBe('ANA!');
    expect(ev('replaceAll("a-b-c", "-", "/")').value).toBe('a/b/c');
    expect(ev('contains(Tags, "b")').value).toBe(true);
    expect(ev('join(Tags, "|")').value).toBe('a|b');
    expect(ev('round(Price / 3, 2)').value).toBe(4.17);
  });

  it('fechas', () => {
    const r = ev('formatDate(dateAdd(prop("Start"), 10, "days"), "YYYY-MM-DD")');
    expect(r.value).toBe('2026-02-11');
    expect(ev('dateBetween(dateAdd(Start, 1, "months"), Start, "days")').value).toBe(28);
    expect(ev('year(Start)').value).toBe(2026);
    expect(ev('formatDate(today(), "D MMM")').value).toBe('10 Feb');
    expect(ev('dateBetween(today(), Start, "days")').value).toBe(9);
  });

  it('errores claros: sintaxis, función o propiedad desconocida', () => {
    expect(ev('1 +').error).toBeTruthy();
    expect(ev('nope(1)').error).toBe('unknown_function:nope');
    expect(ev('prop("Missing") + 1').error).toBe('unknown_property:Missing');
    expect(() => parseFormula('"abc')).toThrow(FormulaError);
    expect(ev('').value).toBe(null);
  });
});

describe('relaciones, espejos, rollups y fórmulas en una base', () => {
  const env = { pageId: 'pP', blockId: 'bP', foreign: { [dbKey('pT', 'bT')]: tasks() } };

  it('el espejo se calcula desde la otra base y los rollups suman, promedian y fechan', () => {
    const out = computeDatabase(projects(), env);
    const p1 = out.rows.find((r) => r.id === 'p1')!;
    const p2 = out.rows.find((r) => r.id === 'p2')!;
    expect(p1.values.tasks).toEqual(['t1', 't2']);
    expect(p2.values.tasks).toEqual(['t3']);
    expect(p1.values.sum).toBe(8);
    expect(p1.values.pct).toBe(0.5);
    expect(p1.values.last).toBe('2026-03-10');
    expect(out.properties.find((p) => p.id === 'sum')!.kind).toBe('number');
    expect(formatValue(out.properties.find((p) => p.id === 'pct')!, p1)).toBe('50%');
    // Una fórmula que lee un rollup.
    expect(p1.values.f).toBe('Alpha: 8 pts');
  });

  it('sin la otra base cargada el rollup queda vacío (sin romper)', () => {
    const out = computeDatabase(projects(), { pageId: 'pP', blockId: 'bP' });
    expect(out.rows[0].values.sum).toBeUndefined();
    expect(out.rows[0].values.f).toBe('Alpha:  pts');
  });

  it('relatedSources pide las bases de afuera y no la propia', () => {
    const self = { ...tasks(), properties: [...tasks().properties, { id: 'parent', name: 'Parent', type: 'relation', relation: { page_id: 'pT', block_id: 'bT' } } as DbProperty] };
    expect(relatedSources(self, { pageId: 'pT', blockId: 'bT' })).toEqual([{ page_id: 'pP', block_id: 'bP' }]);
  });

  it('autorrelación: los títulos salen de la misma base', () => {
    const db: DocsDatabase = {
      properties: [
        { id: 'n', name: 'Name', type: 'title' },
        { id: 'parent', name: 'Parent', type: 'relation', relation: { page_id: 'pT', block_id: 'bT' } },
        { id: 'subs', name: 'Sub-items', type: 'relation', relation: { page_id: 'pT', block_id: 'bT', mirror_of: 'parent' } },
        { id: 'cnt', name: 'Count', type: 'rollup', rollup: { relation: 'subs', property: 'n', fn: 'count_all' } },
      ],
      rows: [row('a', { n: 'Epic' }), row('b', { n: 'Child 1', parent: ['a'] }), row('c', { n: 'Child 2', parent: ['a'] })],
      views: [{ id: 'v', name: '', type: 'table' }],
    };
    const out = computeDatabase(db, { pageId: 'pT', blockId: 'bT' });
    expect(out.rows[0].values.subs).toEqual(['b', 'c']);
    expect(out.rows[0].values.cnt).toBe(2);
    expect(formatValue(out.properties[1], out.rows[1], { rowTitles: { a: 'Epic' } })).toBe('Epic');
  });

  it('una fórmula en ciclo da error y no cuelga', () => {
    const db: DocsDatabase = {
      properties: [
        { id: 'n', name: 'Name', type: 'title' },
        { id: 'a', name: 'A', type: 'formula', formula: 'prop("B") + 1' },
        { id: 'b', name: 'B', type: 'formula', formula: 'prop("A") + 1' },
      ],
      rows: [row('r', { n: 'x' })],
      views: [{ id: 'v', name: '', type: 'table' }],
    };
    const out = computeDatabase(db);
    expect(out.properties[1].error).toBeTruthy();
  });

  it('filtrar y ordenar por fórmula (según su tipo calculado) y por relación', () => {
    const db = { ...tasks(), properties: [...tasks().properties, { id: 'dbl', name: 'Double', type: 'formula', formula: 'prop("Points") * 2' } as DbProperty] };
    const out = computeDatabase(db);
    const dbl = out.properties.find((p) => p.id === 'dbl')!;
    expect(effectiveType(dbl)).toBe('number');
    expect(filterOpsFor(dbl)).toContain('gt');
    const rows = viewRows(out, { id: 'v', name: '', type: 'table', filters: [{ id: 'f', property: 'dbl', op: 'gt', value: 7 }] });
    expect(rows.map((r) => r.id)).toEqual(['t2', 't3']);
    expect(sortRows(out, out.rows, [{ property: 'dbl', direction: 'desc' }]).map((r) => r.id)).toEqual(['t3', 't2', 't1']);
    const titles = { p1: 'Alpha', p2: 'Beta' };
    expect(matchesFilter(out, out.rows[2], { id: 'x', property: 'proj', op: 'contains', value: 'bet' }, { rowTitles: titles })).toBe(true);
  });

  it('rollupFns según el tipo y computeRollup con vacíos', () => {
    expect(rollupFns({ id: 'x', name: 'x', type: 'number' })).toContain('median');
    expect(rollupFns({ id: 'x', name: 'x', type: 'checkbox' })).toContain('percent_checked');
    expect(rollupFns({ id: 'x', name: 'x', type: 'text' })).not.toContain('sum');
    const p: DbProperty = { id: 'pts', name: 'P', type: 'number' };
    expect(computeRollup('median', p, [row('a', { pts: 1 }), row('b', { pts: 9 }), row('c', {})], {}).value).toBe(5);
    expect(computeRollup('count_empty', p, [row('a', { pts: 1 }), row('c', {})], {}).value).toBe(1);
  });

  it('vista previa de fórmula con la primera fila', () => {
    expect(previewFormula(tasks(), 'prop("Points") + 1')).toEqual({ value: '4' });
    expect(previewFormula(tasks(), 'prop("Nope")').error).toBe('unknown_property:Nope');
  });
});

describe('ID único, archivos, persona automática', () => {
  it('addRow numera y nunca reusa; agregar la propiedad numera lo que hay', () => {
    let db = tasks();
    const added = addProperty(db, 'unique_id', 'ID');
    db = added.db;
    expect(db.rows.map((r) => r.values[added.property.id])).toEqual([1, 2, 3]);
    db = { ...db, rows: db.rows.slice(0, 2) };
    const { db: next, row: r } = addRow(db, {});
    expect(r.values[added.property.id]).toBe(4);
    expect(next.properties.find((p) => p.id === added.property.id)!.next_id).toBe(5);
    expect(formatValue({ ...added.property, prefix: 'TASK' }, r)).toBe('TASK-4');
  });

  it('el servidor repara IDs duplicados o faltantes', () => {
    const db: DocsDatabase = {
      properties: [{ id: 'n', name: 'Name', type: 'title' }, { id: 'id', name: 'ID', type: 'unique_id', prefix: 'T-1', next_id: 3 }],
      rows: [row('a', { id: 1 }), row('b', { id: 1 }), row('c', {})],
      views: [{ id: 'v', name: '', type: 'table' }],
    };
    const [b] = sanitizeBlocks([{ id: 'db', type: 'database', content: '', db }]);
    expect(b.db!.rows.map((r) => r.values.id)).toEqual([1, 3, 4]);
    expect(b.db!.properties[1].next_id).toBe(5);
    expect(b.db!.properties[1].prefix).toBe('T1');
  });

  it('archivos: solo URLs del storage, se encuentran por id y la lectura no ve la URL', () => {
    const db: DocsDatabase = {
      properties: [{ id: 'n', name: 'Name', type: 'title' }, { id: 'f', name: 'Files', type: 'files' }],
      rows: [
        row('a', { n: 'A' }, { files: { f: [{ id: 'file1', url: '/uploads/docs/a.pdf', name: 'a.pdf', mime: 'application/pdf' }, { id: 'bad', url: 'https://evil.example/x', name: 'x' }] } }),
      ],
      views: [{ id: 'v', name: '', type: 'table' }],
    };
    const blocks = sanitizeBlocks([{ id: 'db', type: 'database', content: '', db }]);
    expect(blocks[0].db!.rows[0].files!.f.map((x) => x.id)).toEqual(['file1']);
    expect(findFileBlock(blocks, 'file1')?.url).toBe('/uploads/docs/a.pdf');
    expect(findFileBlock(blocks, 'bad')).toBeNull();
    expect(stripFileUrls(blocks)[0].db!.rows[0].files!.f[0].url).toBe('');
    expect(formatValue(db.properties[1], blocks[0].db!.rows[0])).toBe('a.pdf');
  });

  it('creado por / editado por los pone el servidor, no el cliente', () => {
    const prev = tasks();
    const next = { ...prev, rows: [{ ...prev.rows[0], created_by: 'hacker', updated_at: '2026-02-01T00:00:00.000Z', values: { ...prev.rows[0].values, pts: 99 } }, prev.rows[1], row('new', { name: 'New' }, { created_by: 'hacker' })] };
    const out = stampRows({ ...prev, rows: prev.rows.map((r) => ({ ...r, created_by: 'ana' })) }, next, 'bob');
    expect(out.rows[0].created_by).toBe('ana');
    expect(out.rows[0].updated_by).toBe('bob');
    expect(out.rows[1].updated_by).toBeUndefined();
    expect(out.rows[2].created_by).toBe('bob');
  });

  it('cambiar a ID único numera; borrar una propiedad files saca los archivos', () => {
    const db = changePropertyType(tasks(), 'pts', 'unique_id');
    expect(db.rows.map((r) => r.values.pts)).toEqual([1, 2, 3]);
    const withFiles: DocsDatabase = { ...tasks(), properties: [...tasks().properties, { id: 'f', name: 'F', type: 'files' }], rows: [row('a', {}, { files: { f: [{ id: 'x', url: '/uploads/docs/x', name: 'x' }] } })] };
    expect(removeProperty(withFiles, 'f').rows[0].files).toBeUndefined();
  });
});

describe('automatizaciones y botones', () => {
  const auto = (a: Partial<DbAutomation>): DbAutomation => ({ id: 'a1', name: 'Auto', enabled: true, trigger: { type: 'row_added' }, actions: [], ...a });

  it('fila nueva: pone valores; cambio "a Hecho": marca otra propiedad; respeta la vista', () => {
    const base: DocsDatabase = {
      ...tasks(),
      views: [{ id: 'v', name: '', type: 'table' }, { id: 'big', name: 'Big', type: 'table', filters: [{ id: 'f', property: 'pts', op: 'gt', value: 4 }] }],
      automations: [
        auto({ id: 'new', actions: [{ id: 'x', type: 'set_prop', prop: 'due', value: '@today' }] }),
        auto({ id: 'chg', trigger: { type: 'prop_changed', prop: 'done', to: true }, view: 'big', actions: [{ id: 'y', type: 'set_prop', prop: 'pts', value: 100 }] }),
      ],
    };
    const added = addRow(base, { name: 'Fresh' }).db;
    const r1 = runAutomations(base, added, { now: '2026-04-02T12:00:00.000Z' });
    const fresh = r1.db.rows[r1.db.rows.length - 1];
    expect(fresh.values.due).toBe('2026-04-02');
    expect(r1.fired.map((f) => f.automation.id)).toEqual(['new']);

    // Review (5 pts) entra en la vista "Big"; Write (3 pts) no.
    let edited = { ...base, rows: base.rows.map((r) => (r.id === 't2' || r.id === 't1' ? { ...r, values: { ...r.values, done: true } } : r)) };
    edited = { ...edited, rows: edited.rows.map((r) => (r.id === 't1' ? { ...r, values: { ...r.values, done: false } } : r)) };
    edited = { ...edited, rows: edited.rows.map((r) => (r.id === 't1' ? { ...r, values: { ...r.values, done: true } } : r)) };
    const prevT1False = { ...base, rows: base.rows.map((r) => (r.id === 't1' ? { ...r, values: { ...r.values, done: false } } : r)) };
    const r2 = runAutomations(prevT1False, edited);
    expect(r2.db.rows.find((r) => r.id === 't2')!.values.pts).toBe(100);
    expect(r2.db.rows.find((r) => r.id === 't1')!.values.pts).toBe(3);
  });

  it('cadena: lo que cambia una acción puede disparar otra (y da igual en el servidor)', () => {
    const base: DocsDatabase = {
      ...tasks(),
      automations: [
        auto({ id: 'one', actions: [{ id: 'x', type: 'set_prop', prop: 'done', value: true }] }),
        auto({ id: 'two', trigger: { type: 'prop_changed', prop: 'done', to: true }, actions: [{ id: 'y', type: 'set_prop', prop: 'pts', value: 1 }, { id: 'z', type: 'notify', people: ['u1'] }] }),
      ],
    };
    const added = addRow(base, { name: 'N' }).db;
    const client = runAutomations(base, added);
    const last = client.db.rows[client.db.rows.length - 1];
    expect(last.values.done).toBe(true);
    expect(last.values.pts).toBe(1);
    // El servidor ve el resultado del cliente: mismas acciones, sin cambios nuevos.
    const server = runAutomations(base, client.db);
    expect(server.db.rows[server.db.rows.length - 1].values).toEqual(last.values);
    expect(server.fired.map((f) => f.automation.id).sort()).toEqual(['one', 'two']);
  });

  it('prepareDatabaseSave devuelve los efectos de afuera y sella autores', () => {
    const base: DocsDatabase = { ...tasks(), automations: [auto({ actions: [{ id: 'n', type: 'notify', people: ['u1'], message: 'Hi {{title}}' }, { id: 'w', type: 'webhook', url: 'https://example.com/h' }] })] };
    const block = (db: DocsDatabase): DocsBlock => ({ id: 'b', type: 'database', content: '', db });
    const next = addRow(base, { name: 'Z' }).db;
    const res = prepareDatabaseSave('page', [block(base)], [block(next)], 'u2');
    expect(res.effects).toHaveLength(1);
    expect(res.effects[0].actions.map((a) => a.type)).toEqual(['notify', 'webhook']);
    expect(res.blocks[0].db!.rows[res.blocks[0].db!.rows.length - 1].created_by).toBe('u2');
    expect(fillTemplate('Hi {{title}} ({{Points}})', next, next.rows[0], (p, r) => formatValue(p, r))).toBe('Hi Write (3)');
  });

  it('una automatización apagada o sin base anterior no corre', () => {
    const base: DocsDatabase = { ...tasks(), automations: [auto({ enabled: false, actions: [{ id: 'x', type: 'set_prop', prop: 'done', value: true }] })] };
    expect(runAutomations(base, addRow(base, {}).db).fired).toEqual([]);
    expect(runAutomations(null, base).fired).toEqual([]);
  });

  it('botón: edita la fila (poner, agregar a multi) y separa las acciones de afuera', () => {
    const db: DocsDatabase = { ...tasks(), properties: [...tasks().properties, { id: 'tags', name: 'Tags', type: 'multi_select', options: [{ id: 'o1', name: 'A' }, { id: 'o2', name: 'B' }] }] };
    const withTag = { ...db, rows: db.rows.map((r) => (r.id === 't1' ? { ...r, values: { ...r.values, tags: ['o1'] } } : r)) };
    const out = applyButtonActions(withTag, 't1', [
      { id: 'a', type: 'set_prop', prop: 'tags', value: ['o2'], mode: 'add' },
      { id: 'b', type: 'set_prop', prop: 'pts', value: 0 },
      { id: 'c', type: 'webhook', url: 'https://x.dev' },
    ]);
    expect(out.rows[0].values.tags).toEqual(['o1', 'o2']);
    expect(out.rows[0].values.pts).toBe(0);
    expect(remoteActions([{ id: 'a', type: 'open_url', url: '/x' }, { id: 'b', type: 'notify' }]).map((a) => a.type)).toEqual(['notify']);
  });
});

describe('operaciones entre bases', () => {
  it('diffDatabase + applyDbOps reproducen el cambio (filas, celdas, propiedades, orden)', () => {
    const prev = tasks();
    let next = addRow(prev, { name: 'Four' }).db;
    next = { ...next, rows: next.rows.map((r) => (r.id === 't2' ? { ...r, values: { ...r.values, pts: 13 } } : r)).filter((r) => r.id !== 't3') };
    next = { ...next, properties: [...next.properties, { id: 'np', name: 'Notes', type: 'text' }], title: 'Tasks 2' };
    const ops = diffDatabase(prev, next);
    const applied = applyDbOps(prev, ops);
    expect(applied.title).toBe('Tasks 2');
    expect(applied.rows.map((r) => r.values.name)).toEqual(['Write', 'Review', 'Four']);
    expect(applied.rows[1].values.pts).toBe(13);
    expect(applied.properties.map((p) => p.id)).toContain('np');
    expect(docsDbOpsSchema.safeParse({ ops }).success).toBe(true);
  });

  it('relation add/remove respeta el límite de una fila y no escribe en un espejo', () => {
    const db: DocsDatabase = { ...tasks(), properties: tasks().properties.map((p) => (p.id === 'proj' ? { ...p, relation: { ...p.relation!, limit: 1 as const } } : p)) };
    const out = applyDbOps(db, [{ op: 'relation', row: 't1', prop: 'proj', add: ['p9'] }]);
    expect(out.rows[0].values.proj).toEqual(['p9']);
    const mirror = applyDbOps(projects(), [{ op: 'relation', row: 'p1', prop: 'tasks', add: ['t9'] }]);
    expect(mirror.rows[0].values.tasks).toBeUndefined();
  });
});

describe('CSV', () => {
  it('parsea comillas, saltos y separador ; o tab', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
    expect(parseCsv('a;b\r\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n"multi\nline"\t2')).toEqual([['a', 'b'], ['multi\nline', '2']]);
  });

  it('adivina tipos por columna', () => {
    expect(guessColumnType(['1', '2.5', '-3'])).toBe('number');
    expect(guessColumnType(['2026-01-02', '2026-02-03'])).toBe('date');
    expect(guessColumnType(['yes', 'no', 'yes'])).toBe('checkbox');
    expect(guessColumnType(['a@b.co', 'c@d.io'])).toBe('email');
    expect(guessColumnType(['https://a.com', 'b.org/x'])).toBe('url');
    expect(guessColumnType(['Open', 'Closed', 'Open', 'Open', 'Closed'])).toBe('select');
    expect(guessColumnType(['red, blue', 'blue', 'green, red'])).toBe('multi_select');
    expect(guessColumnType(['a long free text here', 'another one entirely different', 'third'])).toBe('text');
  });

  it('importa a una base que existe: título, propiedad por nombre, nuevas con opciones', () => {
    const table = parseCsv('Name,Points,Stage,Tags\nOne,3,Lead,"a, b"\nTwo,5,Won,b\nThree,,Lead,\n');
    const plan = planCsvImport(table, tasks());
    expect(plan.map((c) => c.target.kind)).toEqual(['title', 'existing', 'new', 'new']);
    const res = importCsvRows(tasks(), table, plan, { now: T });
    expect(res.added).toBe(3);
    const stage = res.db.properties.find((p) => p.name === 'Stage')!;
    expect(stage.type).toBe('select');
    expect(stage.options!.map((o) => o.name)).toEqual(['Lead', 'Won']);
    const tags = res.db.properties.find((p) => p.name === 'Tags')!;
    expect(tags.type).toBe('multi_select');
    const one = res.db.rows.find((r) => r.values.name === 'One')!;
    expect(one.values.pts).toBe(3);
    expect((one.values[tags.id] as string[]).length).toBe(2);
  });

  it('base nueva desde CSV y export de la vista (filtros, orden, escape)', () => {
    const { db } = databaseFromCsv(parseCsv('Title,Amount\n=SUM(A1),10\nPlain,-5\n'), 'Import');
    expect(db.title).toBe('Import');
    expect(db.properties[0].name).toBe('Title');
    const csv = exportCsv(db, db.views[0]);
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain('Plain,-5');
    const filtered = exportCsv(computeDatabase(tasks()), { id: 'v', name: '', type: 'table', filters: [{ id: 'f', property: 'done', op: 'checked' }], hidden: ['proj'] });
    expect(filtered.trim().split('\r\n')).toEqual(['Name,Points,Done,Due', 'Write,3,Yes,2026-03-01', 'Ship,8,Yes,']);
    expect(toCsv([['a"b', 'c']])).toBe('"a""b",c\r\n');
  });
});

describe('saneado y schema de lo nuevo', () => {
  it('guarda configuración válida y descarta lo inseguro', () => {
    const db: DocsDatabase = {
      properties: [
        { id: 'n', name: 'Name', type: 'title' },
        { id: 'rel', name: 'Rel', type: 'relation', relation: { page_id: 'p1', block_id: 'b1' } },
        { id: 'mir', name: 'Mirror', type: 'relation', relation: { page_id: 'p1', block_id: 'b1', mirror_of: 'x' } },
        { id: 'btn', name: 'Btn', type: 'button', button: { label: '<b>Go</b>', actions: [{ id: 'a', type: 'webhook', url: 'javascript:alert(1)' }, { id: 'b', type: 'open_url', url: '/app/docs/x' }] } },
        { id: 'f', name: 'F', type: 'formula', formula: '1+1' },
        { id: 'ai', name: 'Sum', type: 'text', ai: { mode: 'summary', auto: true } },
      ],
      rows: [row('r', { n: 'x', rel: ['r1', 'r1', 'bad id!'], mir: ['z'], f: 2 })],
      views: [{ id: 'v', name: '', type: 'calendar', date_by: 'gone', sub_group_by: 'rel' }],
      automations: [{ id: 'au', name: 'A', enabled: true, trigger: { type: 'prop_changed', prop: 'missing' }, actions: [] }, { id: 'ok', name: 'B', enabled: true, trigger: { type: 'row_added' }, actions: [{ id: 'w', type: 'webhook', url: 'https://hooks.example.com/x' }] }],
    };
    const parsed = docPageUpdateSchema.safeParse({ content: [{ id: 'b', type: 'database', content: '', db }] });
    expect(parsed.success).toBe(true);
    const [b] = sanitizeBlocks([{ id: 'b', type: 'database', content: '', db }]);
    const out = b.db!;
    expect(out.rows[0].values).toEqual({ n: 'x', rel: ['r1'] });
    expect(out.properties.find((p) => p.id === 'btn')!.button).toEqual({ label: 'Go', actions: [{ id: 'b', type: 'open_url', url: '/app/docs/x' }] });
    expect(out.properties.find((p) => p.id === 'ai')!.ai).toEqual({ mode: 'summary', auto: true });
    expect(out.views[0].date_by).toBeNull();
    expect(out.views[0].sub_group_by).toBe('rel');
    expect(out.automations!.map((a) => a.id)).toEqual(['ok']);
  });

  it('vista vinculada: ids válidos y solo en bloques database', () => {
    const linked = { page_id: 'p1', block_id: 'b1', views: [{ id: 'v', name: 'Mine', type: 'board' as const, group_by: 'st' }] };
    const [a, b] = sanitizeBlocks([
      { id: 'x', type: 'database', content: '', linked },
      { id: 'y', type: 'paragraph', content: 'hi', linked },
    ]);
    expect(a.linked).toEqual({ ...linked, active_view: 'v', views: [{ ...linked.views[0], filters: undefined, sorts: undefined, hidden: undefined, widths: undefined }] });
    expect(b.linked).toBeUndefined();
  });
});

describe('vistas nuevas', () => {
  it('calendario y timeline toman las fechas y arrancan con solo el título', () => {
    const db: DocsDatabase = { ...tasks(), properties: [...tasks().properties, { id: 'end', name: 'End', type: 'date' }] };
    const cal = addView(db, 'calendar').view;
    expect(cal.date_by).toBe('due');
    expect(cal.hidden).toContain('pts');
    const tl = addView(db, 'timeline').view;
    expect(tl.date_by).toBe('due');
    expect(tl.end_by).toBe('end');
  });
});

describe('IA falsa (e2e)', () => {
  it('clasifica en las opciones que aparecen en la fila y traduce con marca de idioma', () => {
    const rows = [{ id: 'r1', title: 'Bug in login', properties: '', body: 'The login page crashes' }];
    expect(fakeAutofill({ mode: 'classify', propName: 'Kind', options: [{ id: 'o1', name: 'Feature' }, { id: 'o2', name: 'Bug' }], rows })[0].options).toEqual(['Bug']);
    expect(fakeAutofill({ mode: 'translate', language: 'es', propName: 'T', rows })[0].value).toBe('[es] Bug in login');
    expect(fakeAutofill({ mode: 'summary', propName: 'S', rows })[0].value).toBe('The login page crashes');
  });
});
