import { describe, expect, it } from 'vitest';
import type { DbRow, DocsBlock, DocsDatabase } from '@/lib/docs-types';
import { addRowFromTemplate, saveRowAsTemplate } from '@/lib/docs-database';
import { computeDatabase } from '@/lib/docs-db-compute';
import { liftDatabasesOutOfSynced, normalizeStructure } from '@/lib/docs-columns';
import { sanitizeBlocks } from '@/lib/docs-sanitize';
import { createDocPage, getDocPage, updateDocPage } from '@/lib/docs';
import { hydrateSyncedBlocks } from '@/lib/docs-synced';
import { makeUser } from './helpers';

const T = '2026-01-01T10:00:00.000Z';
const row = (id: string, values: DbRow['values']): DbRow => ({ id, values, created_at: T, updated_at: T });

function withFormula(): DocsDatabase {
  return {
    properties: [
      { id: 'name', name: 'Name', type: 'title' },
      { id: 'pts', name: 'Points', type: 'number' },
      { id: 'dbl', name: 'Double', type: 'formula', formula: 'prop("Points") * 2' },
      { id: 'uid', name: 'ID', type: 'unique_id', prefix: 'T', next_id: 2 },
      { id: 'rel', name: 'Related', type: 'relation', relation: { page_id: 'pageAAAA1', block_id: 'blockBBB1' } },
    ],
    rows: [row('r1', { name: 'Base', pts: 4, uid: 1, rel: ['r1'] })],
    views: [{ id: 'v1', name: '', type: 'table' }],
    active_view: 'v1',
  };
}

describe('Docs D1 + D2: plantillas de fila en una base con fórmula y relación', () => {
  it('la plantilla guarda valores editables y la fila nueva calcula su fórmula y toma un ID nuevo', () => {
    const db = saveRowAsTemplate(withFormula(), 'r1', 'Tarea', () => 'tpl1');
    expect(db.templates?.[0].values).toEqual({ name: 'Base', pts: 4, rel: ['r1'] });
    const res = addRowFromTemplate(db, 'tpl1', {}, T, () => 'b1')!;
    expect(res.row.values.uid).toBe(2);
    expect(res.row.values.rel).toEqual(['r1']);
    const computed = computeDatabase(res.db, { pageId: 'pageAAAA1', blockId: 'blockBBB1' });
    const out = computed.rows.find((r) => r.id === res.row.id)!;
    expect(out.values.dbl).toBe(8);
  });

  it('sanear conserva plantillas y automatizaciones juntas', () => {
    const db: DocsDatabase = {
      ...saveRowAsTemplate(withFormula(), 'r1', 'Tarea', () => 'tpl1'),
      automations: [{ id: 'au1', name: 'Done', enabled: true, trigger: { type: 'row_added' }, view: null, actions: [{ id: 'ac1', type: 'set_prop', prop: 'pts', value: 1 }] }],
    };
    const [clean] = sanitizeBlocks([{ id: 'blockBBB1', type: 'database', content: '', db }]);
    expect(clean.db?.templates?.map((x) => x.name)).toEqual(['Tarea']);
    expect(clean.db?.automations?.map((x) => x.id)).toEqual(['au1']);
  });
});

describe('Docs D1 + D2: base dentro de un bloque sincronizado', () => {
  it('la base sale del sincronizado y queda debajo, al mismo nivel', () => {
    const blocks: DocsBlock[] = [
      { id: 's', type: 'synced', content: '', synced_id: 'syncedAAA1' },
      { id: 'a', type: 'paragraph', content: 'Hola', indent: 1 },
      { id: 'd', type: 'database', content: '', indent: 1, db: withFormula() },
      { id: 'z', type: 'paragraph', content: 'Afuera' },
    ];
    expect(liftDatabasesOutOfSynced(blocks).map((b) => [b.id, b.indent ?? 0])).toEqual([
      ['s', 0],
      ['a', 1],
      ['d', 0],
      ['z', 0],
    ]);
    // Si era lo único adentro, el sincronizado queda con un párrafo vacío.
    let k = 0;
    const only = normalizeStructure([blocks[0], blocks[2]], () => `n${++k}`);
    expect(only.map((b) => [b.type, b.indent ?? 0])).toEqual([
      ['synced', 0],
      ['paragraph', 1],
      ['database', 0],
    ]);
  });

  it('guardar y recargar no pierde la base', async () => {
    const owner = await makeUser('d1d2');
    const page = await createDocPage(owner.id, { title: 'Sync + base' });
    const syncedId = crypto.randomUUID();
    await updateDocPage(
      owner.id,
      page.id,
      {
        content: [
          { id: 'syn1', type: 'synced', content: '', synced_id: syncedId },
          { id: 'p1', type: 'paragraph', content: 'Compartido', indent: 1 },
          { id: 'db1', type: 'database', content: '', indent: 1, db: withFormula() },
        ],
      },
      { actorId: owner.id, locale: 'es', timezone: 'America/Argentina/Buenos_Aires', effects: [] },
    );
    const saved = (await getDocPage(owner.id, page.id))!;
    const hydrated = await hydrateSyncedBlocks(owner.id, saved.content);
    expect(hydrated.map((b) => [b.type, b.indent ?? 0])).toEqual([
      ['synced', 0],
      ['paragraph', 1],
      ['database', 0],
    ]);
    expect(hydrated[2].db?.rows[0].values.name).toBe('Base');
  });
});
