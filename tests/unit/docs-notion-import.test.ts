import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtemp, rm, stat } from 'fs/promises';
import { createImportJob, getImportJob, getImportJobRow, type ImportJobView } from '@/lib/import-jobs';
import { runImportJob, startImportJob } from '@/lib/import-runner';
import {
  appendLocalChunk,
  csvToDatabaseBlock,
  localZipRef,
  notionName,
  planNotionPages,
  attachRowBodies,
  rewriteNotionMarkdown,
  splitIcon,
  stripRowProperties,
} from '@/lib/docs-notion-import';
import { bufferSource, buildZip, listZipEntries, readZipEntry } from '@/lib/zip-reader';
import { getDb } from '@/lib/db';
import { deleteUploads } from '@/lib/uploads';
import { makeUser } from './helpers';

const HOME = 'Home 0123456789abcdef0123456789abcdef';
const CHILD = 'Child page 11111111111111111111111111111111';
const DB = 'Tasks 22222222222222222222222222222222';
const ROW = 'Write spec 33333333333333333333333333333333';
// PNG de 1x1.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function notionZip(): Buffer {
  const enc = (s: string) => encodeURIComponent(s);
  return buildZip([
    {
      name: `Export/${HOME}.md`,
      deflate: true,
      data: [
        '# 🚀 Home',
        '',
        `See [Child page](${enc(HOME)}/${enc(CHILD)}.md) and the [tasks](${enc(HOME)}/${enc(DB)}.csv).`,
        '',
        `![diagram](${enc(HOME)}/diagram.png)`,
        '',
        `[spec.pdf](${enc(HOME)}/spec.pdf)`,
        '',
        '<aside>',
        '💡 Remember the deadline',
        '</aside>',
        '',
        `Also on the web: [child](https://www.notion.so/Child-page-11111111111111111111111111111111)`,
      ].join('\n'),
    },
    { name: `Export/${HOME}/${CHILD}.md`, data: '# Child page\n\n- one\n- two\n' },
    { name: `Export/${HOME}/diagram.png`, data: PNG },
    { name: `Export/${HOME}/spec.pdf`, data: '%PDF-1.4 fake' },
    { name: `Export/${HOME}/${DB}.csv`, data: 'Name,Status,Due,Points\nWrite spec,Done,"January 5, 2024",3\n' },
    { name: `Export/${HOME}/${DB}_all.csv`, data: 'Name,Status,Due,Points\nWrite spec,Done,"January 5, 2024",3\nReview,Todo,"February 1, 2024",5\nShip,Todo,,8\n' },
    {
      name: `Export/${HOME}/${DB}/${ROW}.md`,
      data: `# Write spec\n\nStatus: Done\nDue: January 5, 2024\n\nDraft it with the [child](../${enc(CHILD)}.md).\n\n- [ ] Outline\n`,
    },
    { name: '__MACOSX/._junk', data: 'x' },
  ]);
}

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'zs-notion-'));
  process.env.IMPORTS_DIR = dir;
});
afterAll(async () => {
  delete process.env.IMPORTS_DIR;
  await rm(dir, { recursive: true, force: true });
});

async function runToEnd(id: string): Promise<ImportJobView> {
  for (let i = 0; i < 30; i++) {
    const v = (await runImportJob(id, 5_000))!;
    if (!['fetching', 'importing'].includes(v.status)) return v;
  }
  throw new Error('stuck');
}

describe('zip por rangos', () => {
  it('lee stored y deflate', async () => {
    const zip = buildZip([
      { name: 'a.txt', data: 'hello' },
      { name: 'dir/b.txt', data: 'world '.repeat(100), deflate: true },
    ]);
    const src = bufferSource(zip);
    const entries = await listZipEntries(src);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'dir/b.txt']);
    expect((await readZipEntry(src, entries[1], 10_000)).toString()).toBe('world '.repeat(100));
    await expect(readZipEntry(src, entries[1], 10)).rejects.toThrow('zip_entry_too_large');
    await expect(listZipEntries(bufferSource(Buffer.from('not a zip at all, sorry')))).rejects.toThrow('invalid_zip');
  });
});

describe('Notion: mapeo', () => {
  it('nombres, íconos y árbol', () => {
    expect(notionName(`x/${HOME}.md`)).toEqual({ title: 'Home', notionId: '0123456789abcdef0123456789abcdef' });
    expect(notionName(`x/${DB}_all.csv`).title).toBe('Tasks');
    expect(splitIcon('🚀 Home')).toEqual({ icon: '🚀', title: 'Home' });
    expect(splitIcon('Plain')).toEqual({ icon: null, title: 'Plain' });
    let n = 0;
    const plan = planNotionPages(
      [`E/${HOME}.md`, `E/${HOME}/${CHILD}.md`, `E/${HOME}/${DB}.csv`, `E/${HOME}/${DB}_all.csv`, `E/${HOME}/${DB}/${ROW}.md`].map((p) => ({ path: p, part: 0 })),
      new Map(),
      () => `id${++n}`,
    );
    expect(plan.map((p) => [p.title, p.kind, p.parentPath?.split('/').pop() ?? null])).toEqual([
      ['Home', 'page', null],
      ['Child page', 'page', `${HOME}.md`],
      ['Tasks', 'database', `${HOME}.md`],
      ['Write spec', 'page', `${DB}_all.csv`],
    ]);
    // El .md de la carpeta de la base es una fila, no una subpágina.
    expect(plan.find((p) => p.title === 'Write spec')?.rowOf).toBe(`E/${HOME}/${DB}_all.csv`);
    expect(plan.find((p) => p.title === 'Child page')?.rowOf).toBeUndefined();
  });

  it('links internos y adjuntos', () => {
    const ctx = {
      path: `E/${HOME}.md`,
      pageByPath: new Map([[`E/${HOME}/${CHILD}.md`, 'child-id']]),
      pageByNotionId: new Map([['11111111111111111111111111111111', 'child-id']]),
      hasFile: (p: string) => p === `E/${HOME}/pic.png`,
    };
    const { md, attachments } = rewriteNotionMarkdown(
      `Go [there](${encodeURIComponent(HOME)}/${encodeURIComponent(CHILD)}.md)\n![x](${encodeURIComponent(HOME)}/pic.png)\n[web](https://notion.so/Child-11111111111111111111111111111111)`,
      ctx,
    );
    expect(md.split('\n')[0]).toBe('Go [there](zspage:child-id)');
    expect(attachments).toHaveLength(1);
    expect(md.split('\n')[1]).toBe(attachments[0].marker);
    expect(md.split('\n')[2]).toBe('[web](zspage:child-id)');
  });

  it('CSV a base con tipos de columna', () => {
    let n = 0;
    const block = csvToDatabaseBlock('Name,Status,Due,Points\nA,Done,"January 5, 2024",3\nB,Todo,,5\nC,Todo,"Feb 1, 2024",8\n', () => `c${++n}`);
    const db = block.db!;
    // Status con nombre de status: propiedad status con grupos.
    expect(db.properties.map((c) => c.type)).toEqual(['title', 'status', 'date', 'number']);
    expect(db.properties[1].options?.map((o) => [o.name, o.group])).toEqual([['Done', 'done'], ['Todo', 'todo']]);
    const [name, status, due, points] = db.properties.map((p) => p.id);
    const r0 = db.rows[0].values;
    expect([r0[name], db.properties[1].options?.find((o) => o.id === r0[status])?.name, r0[due], r0[points]]).toEqual(['A', 'Done', '2024-01-05', 3]);
    expect(db.rows[1].values[due]).toBeUndefined();
    expect(db.views).toHaveLength(1);
  });

  it('Estado/Status con un valor distinto por fila sigue siendo status; la base toma el nombre del CSV', () => {
    for (const col of ['Status', 'Estado', 'Situação']) {
      const block = csvToDatabaseBlock(`Nombre,${col}\nA,Sin empezar\nB,En curso\nC,Listo\n`, undefined, 'Tareas');
      expect(block.db!.title).toBe('Tareas');
      expect(block.db!.properties[1].type).toBe('status');
      expect(block.db!.properties[1].options?.map((o) => o.group)).toEqual(['todo', 'in_progress', 'done']);
    }
    // Con una sola fila también.
    expect(csvToDatabaseBlock('Name,Status\nA,Done\n').db!.properties[1].type).toBe('status');
    // Otra columna con valores todos distintos queda como texto.
    expect(csvToDatabaseBlock('Name,Notes\nA,x\nB,y\n').db!.properties[1].type).toBe('text');
  });

  it('el .md de una fila pasa a ser su cuerpo (por título), sin las propiedades repetidas', () => {
    expect(stripRowProperties('\nStatus: Done\nDue: January 5, 2024\n\nBody: here\n', ['Name', 'Status', 'Due'])).toBe('Body: here\n');
    expect(stripRowProperties('Just text', ['Name'])).toBe('Just text');
    let n = 0;
    const block = csvToDatabaseBlock('Name,Status\nWrite spec,Done\nReview,Todo\n', () => `r${++n}`);
    const p = (content: string) => ({ id: `b${++n}`, type: 'paragraph' as const, content });
    const attached = attachRowBodies(block, [
      { title: 'Review', blocks: [p('Check it')] },
      { title: 'Orphan', blocks: [p('Not in the CSV')] },
      { title: 'Write spec', blocks: [p('')] },
    ]);
    const [title] = block.db!.properties;
    const rows = block.db!.rows;
    expect(attached).toBe(2);
    expect(rows.find((r) => r.values[title.id] === 'Review')?.body?.map((b) => b.content)).toEqual(['Check it']);
    // Sin cuerpo real (solo párrafos vacíos) la fila queda como estaba.
    expect(rows.find((r) => r.values[title.id] === 'Write spec')?.body).toBeUndefined();
    // Una fila que no está en el CSV se suma con su cuerpo.
    expect(rows).toHaveLength(3);
    expect(rows[2].values[title.id]).toBe('Orphan');
  });
});

describe('Notion: job de punta a punta (subida por partes)', () => {
  it('sube en partes, arma el árbol, sube adjuntos, linkea y no duplica', async () => {
    const u = await makeUser('notion');
    const zip = notionZip();
    const job = await createImportJob({ workspaceId: u.id, teamId: null, userId: u.id, app: 'docs', source: 'notion', status: 'uploading', options: { size: zip.length } });
    await getDb().prepare('UPDATE import_jobs SET payload = ? WHERE id = ?').run(localZipRef(job.id), job.id);
    const half = Math.floor(zip.length / 2);
    expect(await appendLocalChunk(job.id, 0, zip.subarray(0, half))).toBe(half);
    // Un reintento de la misma parte la reescribe.
    expect(await appendLocalChunk(job.id, 0, zip.subarray(0, half))).toBe(half);
    expect(await appendLocalChunk(job.id, half, zip.subarray(half))).toBe(zip.length);
    await getDb().prepare("UPDATE import_jobs SET status = 'fetching' WHERE id = ?").run(job.id);

    const prev = await runToEnd(job.id);
    expect(prev.status).toBe('preview');
    expect(prev.preview).toMatchObject({ pages: 2, databases: 1, rows: 1, attachments: 2, alreadyImported: 0 });
    await startImportJob((await getImportJob(job.id))!);
    const done = await runToEnd(job.id);
    expect(done.status).toBe('done');
    expect(done.report).toMatchObject({ pages: 2, databases: 1, rows: 1, files: 2, filesSkipped: 0 });
    // El zip se borró al terminar.
    await expect(stat(path.join(dir, `${job.id}.zip`))).rejects.toThrow();
    expect((await getImportJobRow(job.id))?.payload).toBeNull();

    const pages = (await getDb().prepare('SELECT id, parent_id, title, icon, content FROM docs_pages WHERE user_id = ?').all(u.id)) as Array<{
      id: string;
      parent_id: string | null;
      title: string;
      icon: string | null;
      content: string;
    }>;
    const by = (t: string) => pages.find((p) => p.title === t)!;
    const home = by('Home');
    expect(home).toMatchObject({ parent_id: null, icon: '🚀' });
    expect(by('Child page').parent_id).toBe(home.id);
    expect(by('Tasks').parent_id).toBe(home.id);
    // La fila no es una subpágina: su .md es el cuerpo de la fila.
    expect(pages.find((p) => p.title === 'Write spec')).toBeUndefined();

    const blocks = JSON.parse(home.content) as Array<{ type: string; content: string; url?: string; icon?: string; name?: string }>;
    const intro = blocks[0].content;
    expect(intro).toContain(`data-page="${by('Child page').id}"`);
    expect(intro).toContain(`data-page="${by('Tasks').id}"`);
    const image = blocks.find((b) => b.type === 'image')!;
    expect(image.url).toMatch(/^\/uploads\/docs\//);
    const file = blocks.find((b) => b.type === 'file')!;
    expect(file.name).toBe('spec.pdf');
    expect(blocks.find((b) => b.type === 'callout')).toMatchObject({ icon: '💡', content: 'Remember the deadline' });
    expect(blocks.at(-1)!.content).toContain(`data-page="${by('Child page').id}"`);
    const db = JSON.parse(by('Tasks').content)[0];
    expect(db.type).toBe('database');
    expect(db.db.rows).toHaveLength(3);
    expect(db.db.title).toBe('Tasks');
    expect(db.db.properties[0].type).toBe('title');
    expect(db.db.properties[1].type).toBe('status');
    const row = db.db.rows.find((r: { values: Record<string, unknown> }) => r.values[db.db.properties[0].id] === 'Write spec');
    const body = row.body as Array<{ type: string; content: string; checked?: boolean }>;
    expect(body[0].content).toContain('Draft it with the');
    expect(body[0].content).toContain(`data-page="${by('Child page').id}"`);
    expect(body.some((b) => b.content.includes('Status: Done'))).toBe(false);
    expect(body.find((b) => b.type === 'todo')?.content).toBe('Outline');

    // Reimportar: las páginas ya están.
    const again = await createImportJob({ workspaceId: u.id, teamId: null, userId: u.id, app: 'docs', source: 'notion', status: 'uploading', options: { size: zip.length } });
    await getDb().prepare("UPDATE import_jobs SET payload = ?, status = 'fetching' WHERE id = ?").run(localZipRef(again.id), again.id);
    await appendLocalChunk(again.id, 0, zip);
    const prev2 = await runToEnd(again.id);
    expect((prev2.preview as { alreadyImported: number }).alreadyImported).toBe(3);
    await startImportJob((await getImportJob(again.id))!);
    const done2 = await runToEnd(again.id);
    expect(done2.report).toMatchObject({ pages: 0, databases: 0, skipped: 3 });

    await deleteUploads([image.url!, (file as { url?: string }).url!]);
  });

  it('un zip con partes adentro (export grande de Notion)', async () => {
    const u = await makeUser('notion2');
    const inner = buildZip([{ name: `${HOME}.md`, data: '# Home\n\nHi' }]);
    const outer = buildZip([{ name: 'Export-Part-1.zip', data: inner }]);
    const job = await createImportJob({ workspaceId: u.id, teamId: null, userId: u.id, app: 'docs', source: 'notion', status: 'fetching' });
    await getDb().prepare('UPDATE import_jobs SET payload = ? WHERE id = ?').run(localZipRef(job.id), job.id);
    await appendLocalChunk(job.id, 0, outer);
    const prev = await runToEnd(job.id);
    expect(prev.preview).toMatchObject({ pages: 1, parts: 1 });
    await startImportJob((await getImportJob(job.id))!);
    const done = await runToEnd(job.id);
    expect(done.report).toMatchObject({ pages: 1 });
  });

  it('un archivo que no es zip falla con invalid_zip', async () => {
    const u = await makeUser('notion3');
    const job = await createImportJob({ workspaceId: u.id, teamId: null, userId: u.id, app: 'docs', source: 'notion', status: 'fetching' });
    await getDb().prepare('UPDATE import_jobs SET payload = ? WHERE id = ?').run(localZipRef(job.id), job.id);
    await appendLocalChunk(job.id, 0, Buffer.from('definitely not a zip file'));
    const v = await runToEnd(job.id);
    expect(v).toMatchObject({ status: 'failed', error: 'invalid_zip' });
  });
});
