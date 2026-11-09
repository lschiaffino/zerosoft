import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import { createHmac } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { getDb, upsertUser } from '@/lib/db';
import { convertBlocks, normalizeNotionId, type NBlockNode } from '@/lib/notion-api';
import { blockHash, docsBlockToNotion, htmlToRichText, parseDateValue, type NotionBlockReq } from '@/lib/notion-sync-convert';
import { mergeBlocks, planPush, type PageSyncState } from '@/lib/notion-sync-merge';
import {
  connectNotion,
  exchangeNotionCode,
  getNotionSyncStatus,
  handleNotionWebhook,
  notionSyncLocalChange,
  syncNotionNow,
  updateNotionSync,
  verifyNotionSignature,
} from '@/lib/notion-sync';
import { notionSyncFakeCall, notionSyncFakeLog, resetNotionSyncFake, SYNC_FAKE_IDS, T } from '@/lib/notion-sync-fake';
import { createDocComment, createDocPage, listDocComments, parseBlocks, updateDocPage } from '@/lib/docs';
import type { DocsBlock } from '@/lib/docs-types';
import { makeUser } from './helpers';

const noLinks = { notionIdFor: () => null };

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'zs-notion-sync-'));
  process.env.UPLOADS_DIR = dir;
  process.env.NOTION_IMPORT_FAKE = '1';
});
afterAll(async () => {
  delete process.env.UPLOADS_DIR;
  delete process.env.NOTION_IMPORT_FAKE;
  await rm(dir, { recursive: true, force: true });
});

// ---------- Conversión ----------

describe('Notion sync: Docs → Notion', () => {
  it('rich text: marcas, color, links, menciones de página, fechas y ecuaciones', () => {
    const rt = htmlToRichText(
      '<strong>Bold</strong> and <em>it</em> <span data-color="red_bg">hot</span> <a href="https://x.test">link</a> <a href="/app/docs/p1" data-page="p1">Page</a> <span data-date="2026-11-03">Nov 3</span> <span data-tex="x^2">x^2</span>&amp;',
      { notionIdFor: (id) => (id === 'p1' ? 'n-page-1' : null) },
    );
    expect(rt[0]).toMatchObject({ type: 'text', text: { content: 'Bold' }, annotations: { bold: true } });
    expect(rt.find((r) => r.type === 'text' && r.text.content === 'hot')).toMatchObject({ annotations: { color: 'red_background' } });
    expect(rt.find((r) => r.type === 'text' && r.text.content === 'link')).toMatchObject({ text: { link: { url: 'https://x.test' } } });
    expect(rt.find((r) => r.type === 'mention' && r.mention.type === 'page')).toMatchObject({ mention: { page: { id: 'n-page-1' } } });
    expect(rt.find((r) => r.type === 'mention' && r.mention.type === 'date')).toMatchObject({ mention: { date: { start: '2026-11-03' } } });
    expect(rt.find((r) => r.type === 'equation')).toMatchObject({ equation: { expression: 'x^2' } });
    expect(rt[rt.length - 1]).toMatchObject({ type: 'text', text: { content: '&' } });
    // Página no sincronizada: queda el texto, sin link.
    const plain = htmlToRichText('<a href="/app/docs/zz" data-page="zz">Other</a>', noLinks);
    expect(plain).toEqual([{ type: 'text', text: { content: 'Other' } }]);
    // Trozos de 2000 caracteres.
    expect(htmlToRichText('a'.repeat(4500), noLinks)).toHaveLength(3);
  });

  it('ida y vuelta: cada tipo común vuelve igual (misma huella)', () => {
    const blocks: DocsBlock[] = [
      { id: 'a', type: 'heading', level: 2, content: 'Title', toggle: true },
      { id: 'b', type: 'paragraph', content: 'Hello <strong>world</strong>', color: 'blue' },
      { id: 'c', type: 'todo', content: 'Do it', checked: true },
      { id: 'd', type: 'callout', content: 'Note', icon: '🔥', color: 'yellow_bg' },
      { id: 'e', type: 'code', content: 'const a = 1 &lt; 2;', language: 'typescript' },
      { id: 'f', type: 'quote', content: 'Quote' },
      { id: 'g', type: 'divider', content: '' },
      { id: 'h', type: 'equation', content: 'e = mc^2' },
      { id: 'i', type: 'toggle', content: 'More' },
      { id: 'j', type: 'bulleted_list_item', content: 'One' },
      { id: 'k', type: 'numbered_list_item', content: 'Two' },
      { id: 'l', type: 'bookmark', content: '', link: { url: 'https://acme.test' } },
      { id: 'm', type: 'table', content: '', rows: [['A', 'B'], ['1', '2']], header_row: true },
    ];
    let n = 0;
    const nodes: NBlockNode[] = blocks.map((b) => {
      const req = docsBlockToNotion(b, noLinks) as NotionBlockReq;
      expect(req, b.type).toBeTruthy();
      const data = { ...(req[req.type] as Record<string, unknown>) };
      const kids = (data.children as NotionBlockReq[] | undefined) ?? [];
      delete data.children;
      // Lo que devolvería Notion: rich text con plain_text.
      const full = (rt: unknown) => ((rt as Array<{ type: string; text?: { content: string } }>) ?? []).map((r) => (r.type === 'text' ? { ...r, plain_text: r.text!.content } : r));
      if (data.rich_text) data.rich_text = full(data.rich_text);
      if (data.caption) data.caption = full(data.caption);
      return {
        block: { id: `n${n++}`, type: req.type, has_children: kids.length > 0, [req.type]: data },
        children: kids.map((k) => ({
          block: { id: `n${n++}`, type: 'table_row', has_children: false, table_row: { cells: ((k.table_row as { cells: unknown[] }).cells ?? []).map(full) } },
          children: [],
        })),
      } as NBlockNode;
    });
    const back = convertBlocks(nodes, { pageFor: () => null, blockId: (nid) => blocks[Number(nid.slice(1))]?.id ?? nid });
    expect(back.unsupported).toEqual([]);
    for (const b of blocks) {
      const r = back.blocks.find((x) => x.id === b.id);
      expect(r, b.type).toBeTruthy();
      expect(blockHash(r!), b.type).toBe(blockHash(b));
    }
  });

  it('fechas: un día o un rango en la misma propiedad', () => {
    expect(parseDateValue('2026-11-03')).toEqual({ start: '2026-11-03' });
    expect(parseDateValue('2026-11-03/2026-11-05')).toEqual({ start: '2026-11-03', end: '2026-11-05' });
    expect(parseDateValue('nope')).toBeNull();
  });
});

// ---------- Fusión ----------

const P = (id: string, content: string, extra: Partial<DocsBlock> = {}): DocsBlock => ({ id, type: 'paragraph', content, ...extra });

function stateOf(blocks: DocsBlock[], ro: string[] = []): PageSyncState {
  const s: PageSyncState = { blocks: {}, seq: blocks.map((b) => b.id) };
  for (const b of blocks) s.blocks[b.id] = { n: `n-${b.id}`, hn: blockHash(b), hl: blockHash(b), p: null, t: 'paragraph', ...(ro.includes(b.id) ? { ro: true } : {}) };
  return s;
}

const hashes = (blocks: DocsBlock[]) => Object.fromEntries(blocks.map((b) => [b.id, blockHash(b)]));

describe('Notion sync: fusión por bloque', () => {
  const base = [P('a', 'one'), P('b', 'two'), P('c', 'three')];

  it('cambió solo Notion → entra; cambió solo Docs → queda', () => {
    const remote = [P('a', 'ONE'), P('b', 'two'), P('c', 'three')];
    const local = [P('a', 'one'), P('b', 'two!'), P('c', 'three')];
    const m = mergeBlocks({ local, remote, remoteHash: hashes(remote), remoteEdited: {}, localEdited: '2026-01-01T00:00:00Z', state: stateOf(base) });
    expect(m.blocks.map((b) => b.content)).toEqual(['ONE', 'two!', 'three']);
    expect(m.decisions).toMatchObject({ a: 'remote', b: 'local', c: 'same' });
    expect(m.conflicts).toEqual([]);
  });

  it('choque: gana el último en editar (por bloque)', () => {
    const remote = [P('a', 'notion'), P('b', 'two'), P('c', 'three')];
    const local = [P('a', 'docs'), P('b', 'two'), P('c', 'three')];
    const newer = mergeBlocks({ local, remote, remoteHash: hashes(remote), remoteEdited: { a: '2026-01-02T00:00:00Z' }, localEdited: '2026-01-01T00:00:00Z', state: stateOf(base) });
    expect(newer.blocks[0].content).toBe('notion');
    expect(newer.conflicts).toEqual([{ blockId: 'a', winner: 'notion', lost: 'docs' }]);
    const older = mergeBlocks({ local, remote, remoteHash: hashes(remote), remoteEdited: { a: '2025-12-31T00:00:00Z' }, localEdited: '2026-01-01T00:00:00Z', state: stateOf(base) });
    expect(older.blocks[0].content).toBe('docs');
    expect(older.conflicts[0]).toMatchObject({ winner: 'docs', lost: 'notion' });
  });

  it('nuevo en Notion entra después de su anterior; borrado de un lado sin cambios del otro se borra', () => {
    const remote = [P('a', 'one'), P('x', 'new'), P('c', 'three')];
    const local = [P('a', 'one'), P('b', 'two'), P('c', 'three'), P('l', 'local only')];
    const m = mergeBlocks({ local, remote, remoteHash: hashes(remote), remoteEdited: {}, localEdited: '2026-01-01T00:00:00Z', state: stateOf(base) });
    expect(m.blocks.map((b) => b.id)).toEqual(['a', 'x', 'c', 'l']);
    expect(m.decisions).toMatchObject({ b: 'drop', x: 'new_remote', l: 'local_only' });
  });

  it('borrado de un lado y editado del otro: gana la edición', () => {
    const remote = [P('a', 'one'), P('c', 'three')]; // b borrado en Notion
    const local = [P('a', 'one'), P('b', 'two edited'), P('c', 'three')];
    const m = mergeBlocks({ local, remote, remoteHash: hashes(remote), remoteEdited: {}, localEdited: '2026-01-01T00:00:00Z', state: stateOf(base) });
    expect(m.blocks.map((b) => b.content)).toEqual(['one', 'two edited', 'three']);
    expect(m.decisions.b).toBe('local_only');
  });

  it('solo lectura (subpáginas): siempre lo de Notion', () => {
    const s = stateOf(base, ['c']);
    const remote = [P('a', 'one'), P('b', 'two'), P('c', 'Subpage')];
    const local = [P('a', 'one'), P('b', 'two'), P('c', 'edited link')];
    const m = mergeBlocks({ local, remote, remoteHash: hashes(remote), remoteEdited: {}, localEdited: '2026-01-01T00:00:00Z', state: s, readOnly: new Set(['c']) });
    expect(m.blocks[2].content).toBe('Subpage');
  });
});

describe('Notion sync: plan de envío', () => {
  it('borra lo borrado (solo el de más arriba), recrea lo movido y no toca lo de solo lectura', () => {
    const blocks = [P('a', 'one'), P('b', 'child', { indent: 1 }), P('c', 'two'), P('d', 'three'), P('e', 'Subpage')];
    const s = stateOf(blocks, ['e']);
    s.blocks.b.p = 'a';
    // a (con su hijo) se borra; d pasa antes que c; e (subpágina) se borró acá pero no se toca.
    const local = [P('d', 'three'), P('c', 'two')];
    const plan = planPush(local, s);
    // d pasa a ir primero: Notion solo agrega "después de", así que los hermanos se recrean.
    expect(plan.deletes.map((d) => d.id).sort()).toEqual(['a', 'c', 'd']);
    expect([...plan.recreate].sort()).toEqual(['c', 'd']);
    // Movido en el medio: solo el movido.
    const mid = planPush([P('a', 'one'), P('b', 'child', { indent: 1 }), P('d', 'three'), P('c', 'two'), P('e', 'Subpage')], s);
    expect(mid.deletes.map((d) => d.id).sort()).toEqual([[...mid.recreate][0]]);
    expect(mid.recreate.size).toBe(1);
  });

  it('cambio de padre (indent) y bloque nuevo primero: se recrean', () => {
    const blocks = [P('a', 'one'), P('b', 'two')];
    const s = stateOf(blocks);
    const indented = planPush([P('a', 'one'), P('b', 'two', { indent: 1 })], s);
    expect(indented.recreate.has('b')).toBe(true);
    const first = planPush([P('z', 'new first'), P('a', 'one'), P('b', 'two')], s);
    expect([...first.recreate].sort()).toEqual(['a', 'b']);
    // Debajo de un bloque que en Notion no lleva hijos (código): cuelga del abuelo.
    const code = planPush([{ id: 'k', type: 'code', content: 'x' }, P('a', 'one', { indent: 1 })], { blocks: {}, seq: [] });
    expect(code.parentOf.get('a')).toBeNull();
  });
});

// ---------- Contra el Notion falso ----------

async function drain(ws: string, rounds = 30) {
  for (let i = 0; i < rounds; i++) {
    await getDb().prepare('UPDATE notion_sync_outbox SET due_at = ? WHERE workspace_id = ?').run(new Date(0).toISOString(), ws);
    await syncNotionNow(ws, 20_000);
    const s = await getNotionSyncStatus(ws);
    const out = (await getDb().prepare('SELECT COUNT(*) AS n FROM notion_sync_outbox WHERE workspace_id = ?').get(ws)) as { n: number };
    if (s.connection?.status === 'live' && s.progress.pending === 0 && Number(out.n) === 0) return s;
  }
  return getNotionSyncStatus(ws);
}

async function pageByTitle(ws: string, title: string) {
  return (await getDb().prepare('SELECT * FROM docs_pages WHERE user_id = ? AND title = ?').get(ws, title)) as { id: string; content: string; parent_id: string | null; updated_at: string } | undefined;
}

async function remoteChildren(token: string, id: string) {
  const res = await notionSyncFakeCall(token, 'GET', `/blocks/${id}/children`);
  return (res.data as { results: Array<{ id: string; type: string; [k: string]: unknown }> }).results;
}

const textOf = (b: { type: string; [k: string]: unknown }) => ((b[b.type] as { rich_text?: Array<{ plain_text: string }> }).rich_text ?? []).map((r) => r.plain_text).join('');

describe('Notion sync: dos vías contra el Notion falso', () => {
  let ws = '';
  const token = `fake-notion-sync-unit-${Date.now()}`;

  beforeEach(() => undefined);

  it('import inicial: árbol, bloques, base con propiedades, rango de fechas, personas, relación, fórmula y comentarios', async () => {
    resetNotionSyncFake(token);
    const owner = await upsertUser({ id: `ns-${Date.now()}`, email: 'demo@zerosoft.ai', name: 'Demo', image: null });
    ws = owner.id;
    await connectNotion(ws, ws, { kind: 'token', token });
    const s = await drain(ws);
    expect(s.connection?.status).toBe('live');
    expect(s.roots.map((r) => r.title)).toEqual(['Team wiki']);

    const wiki = await pageByTitle(ws, 'Team wiki');
    const guide = await pageByTitle(ws, 'Style guide');
    const tasks = await pageByTitle(ws, 'Tasks');
    expect(wiki && guide && tasks).toBeTruthy();
    expect(guide!.parent_id).toBe(wiki!.id);
    expect(tasks!.parent_id).toBe(wiki!.id);
    const blocks = parseBlocks(wiki!.content);
    const types = blocks.map((b) => b.type);
    for (const t of ['heading', 'paragraph', 'toggle', 'callout', 'code', 'todo', 'table', 'columns', 'column', 'image', 'equation']) expect(types, t).toContain(t);
    expect(blocks.find((b) => b.type === 'code')?.language).toBe('bash');
    expect(blocks.find((b) => b.type === 'callout')?.color).toBe('yellow_bg');
    expect(blocks.find((b) => b.type === 'image')?.url).toBeTruthy();

    const db = parseBlocks(tasks!.content).find((b) => b.type === 'database')!.db!;
    const prop = (name: string) => db.properties.find((p) => p.name === name)!;
    const rowA = db.rows.find((r) => r.values[prop('Name').id] === 'Write the guide')!;
    expect(rowA.values[prop('When').id]).toBe('2026-11-03/2026-11-05');
    expect(prop('Owner').type).toBe('person');
    expect(rowA.values[prop('Owner').id]).toEqual([ws]);
    expect(prop('Blocked by').type).toBe('relation');
    expect((rowA.values[prop('Blocked by').id] as string[]).length).toBe(1);
    expect(rowA.values[prop('Double').id]).toBe(6);
    expect(rowA.body?.[0]?.content).toContain('Draft in Docs');

    const comments = await listDocComments(wiki!.id);
    expect(comments[0].body).toContain('Looks good to me');
  });

  it('Docs → Notion: editar un bloque manda solo ese bloque; repetir no escribe nada (sin bucle)', async () => {
    const wiki = (await pageByTitle(ws, 'Team wiki'))!;
    const blocks = parseBlocks(wiki.content);
    const para = blocks.find((b) => b.type === 'paragraph' && b.content.includes('style guide'))!;
    const next = blocks.map((b) => (b.id === para.id ? { ...b, content: 'Read the <strong>style guide</strong> twice.' } : b));
    next.push({ id: crypto.randomUUID(), type: 'paragraph', content: 'Added in Docs' });
    await updateDocPage(ws, wiki.id, { content: next, base_updated_at: wiki.updated_at }, { actorId: ws });
    const before = notionSyncFakeLog(token).length;
    await drain(ws);
    const writes = notionSyncFakeLog(token).slice(before).filter((r) => r.method !== 'GET' && r.path !== '/search' && !r.path.endsWith('/query'));
    expect(writes.length).toBeLessThanOrEqual(3);
    const kids = await remoteChildren(token, SYNC_FAKE_IDS.wiki);
    expect(kids.map(textOf)).toContain('Read the style guide twice.');
    expect(kids.map(textOf)).toContain('Added in Docs');
    // Otra vuelta sin cambios: ninguna escritura.
    const mark = notionSyncFakeLog(token).length;
    await notionSyncLocalChange(ws, wiki.id);
    await drain(ws);
    expect(notionSyncFakeLog(token).slice(mark).filter((r) => r.method === 'PATCH' || r.method === 'DELETE' || (r.method === 'POST' && r.path === '/pages'))).toEqual([]);
  });

  it('Notion → Docs: una edición en Notion llega sin pisar lo de Docs', async () => {
    const kids = await remoteChildren(token, SYNC_FAKE_IDS.wiki);
    const todo = kids.find((k) => k.type === 'to_do')!;
    await notionSyncFakeCall(token, 'PATCH', `/blocks/${todo.id}`, { to_do: { rich_text: [T('Sign the guide today')], checked: true } });
    await drain(ws);
    const wiki = (await pageByTitle(ws, 'Team wiki'))!;
    const blocks = parseBlocks(wiki.content);
    expect(blocks.find((b) => b.type === 'todo')).toMatchObject({ content: 'Sign the guide today', checked: true });
    expect(blocks.some((b) => b.content === 'Added in Docs')).toBe(true);
  });

  it('choque: los dos editan el mismo bloque; gana Notion (más nuevo) y lo de Docs queda en el historial', async () => {
    const wiki = (await pageByTitle(ws, 'Team wiki'))!;
    const blocks = parseBlocks(wiki.content);
    const code = blocks.find((b) => b.type === 'code')!;
    await updateDocPage(ws, wiki.id, { content: blocks.map((b) => (b.id === code.id ? { ...b, content: 'npm run docs' } : b)), base_updated_at: wiki.updated_at }, { actorId: ws });
    // Edición en Notion después (reloj del fake siempre más adelante).
    const remoteCode = (await remoteChildren(token, SYNC_FAKE_IDS.wiki)).find((k) => k.type === 'code')!;
    await notionSyncFakeCall(token, 'PATCH', `/blocks/${remoteCode.id}`, { code: { rich_text: [T('npm run notion')], language: 'bash' } });
    await drain(ws);
    const after = parseBlocks((await pageByTitle(ws, 'Team wiki'))!.content).find((b) => b.type === 'code')!;
    expect(after.content).toBe('npm run notion');
    const versions = (await getDb().prepare('SELECT content FROM docs_versions WHERE page_id = ?').all(wiki.id)) as Array<{ content: string }>;
    expect(versions.some((v) => v.content.includes('npm run docs'))).toBe(true);
    const s = await getNotionSyncStatus(ws);
    expect(s.log.some((l) => l.action === 'conflict_notion')).toBe(true);
  });

  it('subpágina nueva en Docs y fila nueva en la base van a Notion; comentarios también', async () => {
    const wiki = (await pageByTitle(ws, 'Team wiki'))!;
    const sub = await createDocPage(ws, { parent_id: wiki.id, title: 'Made in Docs', content: [{ id: crypto.randomUUID(), type: 'paragraph', content: 'Body from Docs' }] });
    await createDocComment(wiki.id, ws, { body: 'A comment from Docs' });
    const tasks = (await pageByTitle(ws, 'Tasks'))!;
    const blocks = parseBlocks(tasks.content);
    const dbBlock = blocks.find((b) => b.type === 'database')!;
    const title = dbBlock.db!.properties.find((p) => p.type === 'title')!;
    const status = dbBlock.db!.properties.find((p) => p.name === 'Status')!;
    const done = status.options!.find((o) => o.name === 'Done')!;
    const now = new Date().toISOString();
    const rows = [...dbBlock.db!.rows, { id: crypto.randomUUID(), values: { [title.id]: 'From Docs', [status.id]: done.id }, created_at: now, updated_at: now }];
    await updateDocPage(ws, tasks.id, { content: blocks.map((b) => (b.id === dbBlock.id ? { ...b, db: { ...b.db!, rows } } : b)), base_updated_at: tasks.updated_at }, { actorId: ws });
    await drain(ws);
    const pages = (await notionSyncFakeCall(token, 'POST', '/search', {})).data as { results: Array<{ id: string; object: string; parent: { type: string }; properties?: Record<string, { type: string; title?: Array<{ plain_text: string }>; select?: { name: string } }> }> };
    const made = pages.results.find((p) => p.properties?.title?.title?.[0]?.plain_text === 'Made in Docs');
    expect(made).toBeTruthy();
    expect((await remoteChildren(token, made!.id)).map(textOf)).toContain('Body from Docs');
    const row = pages.results.find((p) => p.parent.type === 'database_id' && p.properties?.Name?.title?.[0]?.plain_text === 'From Docs');
    expect(row?.properties?.Status?.select?.name).toBe('Done');
    const comments = (await notionSyncFakeCall(token, 'GET', `/comments?block_id=${SYNC_FAKE_IDS.wiki}`)).data as { results: Array<{ rich_text: Array<{ plain_text: string }> }> };
    expect(comments.results.some((c) => c.rich_text.map((r) => r.plain_text).join('').includes('A comment from Docs'))).toBe(true);
    expect(sub.id).toBeTruthy();
  });

  it('Notion → Docs en una base: un valor editado en Notion llega a la fila', async () => {
    await notionSyncFakeCall(token, 'PATCH', `/pages/${SYNC_FAKE_IDS.rowB}`, { properties: { Points: { number: 8 } } });
    await drain(ws);
    const tasks = (await pageByTitle(ws, 'Tasks'))!;
    const db = parseBlocks(tasks.content).find((b) => b.type === 'database')!.db!;
    const points = db.properties.find((p) => p.name === 'Points')!;
    const title = db.properties.find((p) => p.type === 'title')!;
    expect(db.rows.find((r) => r.values[title.id] === 'Review sync')?.values[points.id]).toBe(8);
  });

  it('solo importar: lo editado en Docs no sale', async () => {
    await updateNotionSync(ws, { direction: 'import' });
    const wiki = (await pageByTitle(ws, 'Team wiki'))!;
    const blocks = parseBlocks(wiki.content);
    await updateDocPage(ws, wiki.id, { content: [...blocks, { id: crypto.randomUUID(), type: 'paragraph', content: 'Local only' }], base_updated_at: wiki.updated_at }, { actorId: ws });
    const mark = notionSyncFakeLog(token).length;
    await drain(ws);
    expect(notionSyncFakeLog(token).slice(mark).filter((r) => r.method === 'PATCH' || r.method === 'DELETE')).toEqual([]);
    await updateNotionSync(ws, { direction: 'two_way' });
  });

  it('una página borrada en Notion pasa a la papelera de Docs', async () => {
    await notionSyncFakeCall(token, 'PATCH', `/pages/${SYNC_FAKE_IDS.guide}`, { archived: true });
    await getDb().prepare(`UPDATE notion_sync_items SET status = 'pending' WHERE workspace_id = ? AND notion_id = ?`).run(ws, normalizeNotionId(SYNC_FAKE_IDS.guide));
    await drain(ws);
    const guide = (await getDb().prepare('SELECT archived FROM docs_pages WHERE user_id = ? AND title = ?').get(ws, 'Style guide')) as { archived: number };
    expect(guide.archived).toBe(1);
  });

  it('permisos de la base: otro workspace no ve nada', async () => {
    const other = await makeUser('other');
    expect((await getNotionSyncStatus(other.id)).connection).toBeNull();
  });
});

describe('Notion sync: OAuth y webhooks', () => {
  it('canje del código (fake) y token inválido rechazado', async () => {
    const t = await exchangeNotionCode('fake-code-oauth');
    expect(t.access_token).toBe('fake-notion-sync-oauth');
    expect(t.workspace_id).toBe(SYNC_FAKE_IDS.notionWorkspace);
    await expect(exchangeNotionCode('nope')).rejects.toThrow('oauth_failed');
    const u = await makeUser('bad');
    await expect(connectNotion(u.id, u.id, { kind: 'token', token: 'secret_wrong' })).rejects.toThrow('invalid_token');
  });

  it('webhook: guarda el token de verificación una sola vez y exige la firma', async () => {
    const first = await handleNotionWebhook(JSON.stringify({ verification_token: 'secret_v1' }), null);
    expect(first.status).toBe(200);
    // Un segundo token (de cualquiera) no pisa el primero.
    await handleNotionWebhook(JSON.stringify({ verification_token: 'secret_attacker' }), null);
    const body = JSON.stringify({ type: 'page.content_updated', workspace_id: SYNC_FAKE_IDS.notionWorkspace, entity: { id: SYNC_FAKE_IDS.wiki, type: 'page' } });
    const sig = `sha256=${createHmac('sha256', 'secret_v1').update(body).digest('hex')}`;
    expect(verifyNotionSignature(body, sig, 'secret_v1')).toBe(true);
    expect((await handleNotionWebhook(body, sig)).status).toBe(200);
    const bad = `sha256=${createHmac('sha256', 'secret_attacker').update(body).digest('hex')}`;
    expect((await handleNotionWebhook(body, bad)).status).toBe(401);
    expect((await handleNotionWebhook(body, null)).status).toBe(401);
  });
});
