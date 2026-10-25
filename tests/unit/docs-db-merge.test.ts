import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { DbAction, DbRow, DocsBlock, DocsDatabase } from '@/lib/docs-types';
import { mergeBlocks, mergeDatabase } from '@/lib/docs-merge';
import { DocsConflictError, createDocPage, getDocPageRow, parseBlocks, updateDocPage } from '@/lib/docs';
import { applyRemoteOps, listAutomationRuns, runRemoteActions } from '@/lib/docs-db-server';
import { applySamePageRows, prepareDatabaseSave, type DbEffect } from '@/lib/docs-db-save';
import { actionIncomplete } from '@/lib/docs-db-ops';
import { sanitizeBlocks } from '@/lib/docs-sanitize';
import { docPageUpdateSchema } from '@/lib/docs-schema';
import { normalizeDatabase } from '@/lib/docs-database';
import { makeUser } from './helpers';

type FakeUser = { id: string; email: string; role: string };
const session = vi.hoisted(() => ({ user: null as null | FakeUser }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: FakeUser) => u.id,
  isWorkspaceAdmin: () => true,
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    void task().catch(() => {});
  },
}));

const pageRoute = await import('@/app/api/docs/pages/[id]/route');
const dbRoute = await import('@/app/api/docs/databases/[pageId]/[blockId]/route');

const T = '2026-01-01T10:00:00.000Z';
const row = (id: string, values: DbRow['values']): DbRow => ({ id, values, created_at: T, updated_at: T });
const para = (id: string, content: string): DocsBlock => ({ id, type: 'paragraph', content });

function tasks(extra: Partial<DocsDatabase> = {}): DocsDatabase {
  return {
    title: 'Tasks',
    properties: [
      { id: 'name', name: 'Name', type: 'title' },
      { id: 'st', name: 'Status', type: 'select', options: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
    ],
    rows: [row('r1', { name: 'One' }), row('r2', { name: 'Two' })],
    views: [{ id: 'v', name: '', type: 'table' }],
    ...extra,
  };
}
const dbBlock = (db: DocsDatabase, id = 'db1'): DocsBlock => ({ id, type: 'database', content: '', db });
const dbOf = (blocks: DocsBlock[], id = 'db1') => normalizeDatabase(blocks.find((b) => b.id === id)!);
const wait = () => new Promise((r) => setTimeout(r, 5));

describe('Docs: fusión de tres vías', () => {
  it('suma la fila que agregó el otro lado a la base editada acá', () => {
    const base = tasks();
    const theirs = { ...base, rows: [...base.rows, row('r3', { name: 'Server' })] };
    const ours = { ...base, rows: base.rows.map((r) => (r.id === 'r1' ? { ...r, values: { ...r.values, st: 'a' } } : r)) };
    const merged = mergeDatabase(base, theirs, ours);
    expect(merged.rows.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(merged.rows[0].values.st).toBe('a');
  });

  it('celdas distintas de la misma fila se fusionan; la misma celda la gana quien guarda', () => {
    const base = tasks();
    const theirs = { ...base, rows: [row('r1', { name: 'Uno' }), base.rows[1]] };
    const ours = { ...base, rows: [row('r1', { name: 'One', st: 'b' }), base.rows[1]] };
    expect(mergeDatabase(base, theirs, ours).rows[0].values).toEqual({ name: 'Uno', st: 'b' });
    const ours2 = { ...base, rows: [row('r1', { name: 'Eins' }), base.rows[1]] };
    expect(mergeDatabase(base, theirs, ours2).rows[0].values.name).toBe('Eins');
  });

  it('el mismo tramo de un párrafo editado distinto de los dos lados es conflicto (o gana "ours"); tramos distintos se suman', () => {
    const base = [para('p1', 'hola'), para('p2', 'x')];
    const theirs = [para('p1', 'chau'), para('p2', 'x')];
    const ours = [para('p1', 'adiós'), para('p2', 'x')];
    expect(mergeBlocks(base, theirs, ours)).toBeNull();
    expect(mergeBlocks(base, theirs, ours, 'ours')?.[0].content).toBe('adiós');
    // Las dos agregaron al final: quedan las dos (primero lo ya guardado).
    expect(mergeBlocks(base, [para('p1', 'hola mundo'), para('p2', 'x')], [para('p1', 'hola gente'), para('p2', 'x')])?.[0].content).toBe('hola mundo gente');
    // Bloques distintos: sin conflicto, con el agregado del otro lado en su lugar.
    const theirs2 = [para('p1', 'hola'), para('n', 'nuevo'), para('p2', 'x')];
    const ours2 = [para('p1', 'hola'), para('p2', 'y')];
    expect(mergeBlocks(base, theirs2, ours2)?.map((b) => `${b.id}:${b.content}`)).toEqual(['p1:hola', 'n:nuevo', 'p2:y']);
  });

  it('sobrescribir no borra las filas que agregó el otro lado', () => {
    const base = [para('p1', 'a'), dbBlock(tasks())];
    const theirs = [para('p1', 'b'), dbBlock({ ...tasks(), rows: [...tasks().rows, row('r9', { name: 'Otra' })] })];
    const ours = [para('p1', 'c'), dbBlock(tasks())];
    const merged = mergeBlocks(base, theirs, ours, 'ours')!;
    expect(merged[0].content).toBe('c');
    expect(dbOf(merged).rows.map((r) => r.id)).toContain('r9');
  });
});

describe('Docs: guardar sobre una versión vieja', () => {
  it('una operación del servidor sobre la base no da conflicto al siguiente guardado del editor', async () => {
    const owner = await makeUser('dmerge');
    const page = await createDocPage(owner.id, { title: 'P', content: [para('p1', 'hola'), dbBlock(tasks())] });
    const base = page.updated_at;
    await wait();
    // Fila creada desde el selector de relación de otra base (o por un botón): escribe el servidor.
    await applyRemoteOps(owner, page.id, 'db1', [{ op: 'add_row', id: 'rS', title: 'From server' }]);
    await wait();
    const ours = [para('p1', 'hola mundo'), dbBlock({ ...tasks(), rows: [row('r1', { name: 'One', st: 'a' }), row('r2', { name: 'Two' })] })];
    const outcome: { merged?: boolean } = {};
    const saved = await updateDocPage(owner.id, page.id, { content: ours, base_updated_at: base }, { outcome });
    expect(outcome.merged).toBe(true);
    const db = dbOf(saved!.content);
    expect(db.rows.map((r) => r.id)).toEqual(['r1', 'r2', 'rS']);
    expect(db.rows[0].values.st).toBe('a');
    expect(saved!.content[0].content).toBe('hola mundo');
  });

  it('el mismo párrafo editado en dos pestañas: gana quien guarda; sin la revisión base es conflicto salvo "Sobrescribir"', async () => {
    const owner = await makeUser('dmerge2');
    const page = await createDocPage(owner.id, { title: 'P', content: [para('p1', 'hola')] });
    await wait();
    await updateDocPage(owner.id, page.id, { content: [para('p1', 'A')], base_updated_at: page.updated_at });
    await wait();
    const second = await updateDocPage(owner.id, page.id, { content: [para('p1', 'B')], base_updated_at: page.updated_at });
    expect(second?.content[0].content).toBe('B');
    await wait();
    const gone = '2000-01-01T00:00:00.000Z';
    await expect(updateDocPage(owner.id, page.id, { content: [para('p1', 'C')], base_updated_at: gone })).rejects.toBeInstanceOf(DocsConflictError);
    const forced = await updateDocPage(owner.id, page.id, { content: [para('p1', 'C')], base_updated_at: gone, merge: 'ours' });
    expect(forced?.content[0].content).toBe('C');
  });

  it('PATCH con la base vieja tras una escritura del servidor responde 200 con merged y el contenido fusionado', async () => {
    const owner = await makeUser('dmerge3');
    session.user = { id: owner.id, email: owner.email, role: 'owner' };
    const page = await createDocPage(owner.id, { title: 'P', content: [dbBlock(tasks())] });
    await wait();
    const res = await dbRoute.POST(
      new NextRequest(`http://t/api/docs/databases/${page.id}/db1`, { method: 'POST', body: JSON.stringify({ ops: [{ op: 'add_row', id: 'rX', title: 'X' }] }) }),
      { params: Promise.resolve({ pageId: page.id, blockId: 'db1' }) },
    );
    expect(res.status).toBe(200);
    await wait();
    const patch = await pageRoute.PATCH(
      new NextRequest(`http://t/api/docs/pages/${page.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'P2', content: [dbBlock(tasks())], base_updated_at: page.updated_at }),
      }),
      { params: Promise.resolve({ id: page.id }) },
    );
    expect(patch.status).toBe(200);
    const body = (await patch.json()) as { merged: boolean; title: string; content: DocsBlock[] };
    expect(body.merged).toBe(true);
    expect(body.title).toBe('P2');
    expect(dbOf(body.content).rows.map((r) => r.id)).toContain('rX');
  });

  it('dos vías: el espejo allá y el synced_prop acá en una sola request', async () => {
    const owner = await makeUser('dtwoway');
    session.user = { id: owner.id, email: owner.email, role: 'owner' };
    const projects: DocsDatabase = { title: 'Projects', properties: [{ id: 'pn', name: 'Name', type: 'title' }], rows: [], views: [{ id: 'v', name: '', type: 'table' }] };
    const pp = await createDocPage(owner.id, { title: 'Projects', content: [dbBlock(projects, 'dbP')] });
    const withRel = tasks({ properties: [...tasks().properties, { id: 'rel', name: 'Project', type: 'relation', relation: { page_id: pp.id, block_id: 'dbP' } }] });
    const tp = await createDocPage(owner.id, { title: 'Tasks', content: [dbBlock(withRel)] });
    const res = await dbRoute.POST(
      new NextRequest(`http://t/api/docs/databases/${pp.id}/dbP`, {
        method: 'POST',
        body: JSON.stringify({
          ops: [{ op: 'add_property', property: { id: 'mir', name: 'Tasks', type: 'relation', relation: { page_id: tp.id, block_id: 'db1', mirror_of: 'rel' } } }],
          also: {
            page_id: tp.id,
            block_id: 'db1',
            ops: [{ op: 'update_property', property: { id: 'rel', name: 'Project', type: 'relation', relation: { page_id: pp.id, block_id: 'dbP', synced_prop: 'mir' } } }],
          },
          undo: [{ op: 'remove_property', prop: 'mir' }],
        }),
      }),
      { params: Promise.resolve({ pageId: pp.id, blockId: 'dbP' }) },
    );
    expect(res.status).toBe(200);
    const t = dbOf(parseBlocks((await getDocPageRow(tp.id))!.content));
    expect(t.properties.find((p) => p.id === 'rel')?.relation?.synced_prop).toBe('mir');
    const p = dbOf(parseBlocks((await getDocPageRow(pp.id))!.content), 'dbP');
    expect(p.properties.some((x) => x.id === 'mir')).toBe(true);
  });
});

describe('Docs: acciones a medio armar y "agregar fila" en la misma página', () => {
  const draft: DbAction = { id: 'a1', type: 'add_row', target: { page_id: '', block_id: '' }, title: '' };

  it('una acción "agregar fila" sin base elegida no rompe el guardado y queda como borrador', () => {
    const db = tasks({
      properties: [...tasks().properties, { id: 'btn', name: 'Go', type: 'button', button: { label: 'Go', actions: [draft] } }],
      automations: [{ id: 'au', name: '', enabled: true, trigger: { type: 'row_added' }, view: null, actions: [draft] }],
    });
    const parsed = docPageUpdateSchema.safeParse({ content: [dbBlock(db)] });
    expect(parsed.success).toBe(true);
    const [clean] = sanitizeBlocks([dbBlock(db)]);
    const out = normalizeDatabase(clean);
    expect(out.automations?.[0].actions).toHaveLength(1);
    expect(out.properties.find((p) => p.id === 'btn')?.button?.actions).toHaveLength(1);
    expect(actionIncomplete(draft)).toBe(true);
    expect(actionIncomplete({ id: 'n', type: 'notify', people: [] })).toBe(true);
    expect(actionIncomplete({ id: 'w', type: 'webhook', url: '' })).toBe(true);
  });

  it('el motor saltea lo incompleto y "notificar" sin destinatarios queda como error en el registro', async () => {
    const owner = await makeUser('dincomplete');
    const page = await createDocPage(owner.id, { title: 'P', content: [dbBlock(tasks())] });
    const res = await runRemoteActions([draft, { id: 'n1', type: 'notify', people: [] }], {
      actor: owner,
      page,
      blockId: 'db1',
      db: tasks(),
      rowId: 'r1',
      source: 'au',
    });
    expect(res.map((r) => [r.ok, r.detail])).toEqual([
      [false, 'incomplete'],
      [false, 'incomplete'],
    ]);
    const runs = await listAutomationRuns(page.id, 'db1');
    expect(runs.every((r) => r.status === 'error')).toBe(true);
  });

  it('"agregar fila" de una automatización hacia esta misma página entra en el mismo guardado', async () => {
    const owner = await makeUser('dsamepage');
    const auto = { id: 'au', name: 'Log', enabled: true, trigger: { type: 'prop_changed' as const, prop: 'st' }, view: null, actions: [] as DbAction[] };
    const page = await createDocPage(owner.id, { title: 'P', content: [dbBlock(tasks())] });
    auto.actions = [{ id: 'ar', type: 'add_row', target: { page_id: page.id, block_id: 'db1' }, title: 'Changed {{title}}' }];
    const first = await updateDocPage(owner.id, page.id, { content: [dbBlock(tasks({ automations: [auto] }))], base_updated_at: page.updated_at });
    const edited = tasks({ automations: [auto], rows: [row('r1', { name: 'One', st: 'a' }), row('r2', { name: 'Two' })] });
    const outcome: { merged?: boolean } = {};
    const effects: DbEffect[] = [];
    const saved = await updateDocPage(owner.id, page.id, { content: [dbBlock(edited)], base_updated_at: first!.updated_at }, { outcome, effects, actorId: owner.id });
    expect(outcome.merged).toBe(true);
    const db = dbOf(saved!.content);
    expect(db.rows).toHaveLength(3);
    expect(db.rows[2].values.name).toBe('Changed One');
    // Queda registrada como hecha, sin volver a correr después.
    expect(effects[0].done?.ar).toMatch(/^row:/);
  });

  it('applySamePageRows no toca acciones hacia otras páginas', () => {
    const blocks = [dbBlock(tasks())];
    const effects = prepareDatabaseSave('pg', blocks, blocks, null).effects;
    expect(applySamePageRows('pg', blocks, effects).changed).toBe(false);
    const res = applySamePageRows('pg', blocks, [
      { pageId: 'pg', blockId: 'db1', automationId: 'a', automationName: '', rowId: 'r1', actions: [{ id: 'x', type: 'add_row', target: { page_id: 'other', block_id: 'b' } }] },
    ]);
    expect(res.changed).toBe(false);
    expect(res.effects[0].done).toBeUndefined();
  });
});
