import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { createImportJob, getImportJob, type ImportJobView } from '@/lib/import-jobs';
import { runImportJob, startImportJob } from '@/lib/import-runner';
import { appendLocalChunk, csvToDatabaseBlock, localZipRef, notionIdIn } from '@/lib/docs-notion-import';
import { markdownToBlocks } from '@/lib/docs-import';
import { sanitizeDocsHtml } from '@/lib/docs-sanitize';
import { buildZip } from '@/lib/zip-reader';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

/**
 * Un export de Notion como los de verdad ("Markdown & CSV" de un workspace):
 * carpeta envoltorio, ids de 32 hex en cada nombre, bases con CSV y _all.csv
 * (con BOM), filas con sus propiedades repetidas, relaciones entre bases,
 * rangos de fechas, personas, toggles como <details> y títulos ##/###.
 */

const hex = (c: string) => c.repeat(32);
const enc = (s: string) => encodeURIComponent(s);
const WIKI = `Wiki ${hex('a')}`;
const TASKS = `Tasks ${hex('b')}`;
const PROJ = `Projects ${hex('c')}`;
const ROW_SHIP = `Ship importer ${hex('d')}`;
const ROW_FIX = `Fix lists ${hex('e')}`;
const P_MIG = `Docs Migration ${hex('f')}`;
const P_WEB = `Website ${'1'.repeat(32)}`;

function zip(personName: string): Buffer {
  const root = 'Private & Shared';
  const rel = (p: string) => `${p.split(' ').slice(0, -1).join(' ')} (../${enc(PROJ)}/${enc(p)}.md)`;
  const tasksCsv = [
    'Name,Status,Assignee,Due,Project,Done',
    `Ship importer,In progress,${personName},"November 10, 2026","${rel(P_MIG)}",No`,
    `Fix lists,Done,${personName},"November 3, 2026 → November 5, 2026","${rel(P_MIG)}, ${rel(P_WEB)}",Yes`,
    'Write docs,Not started,,,,No',
  ].join('\n');
  return buildZip([
    {
      name: `${root}/${WIKI}.md`,
      deflate: true,
      data: [
        '# Wiki',
        '',
        '## Section',
        '',
        '### Sub section',
        '',
        '<details>',
        '<summary>Toggle title</summary>',
        '',
        'Inside the toggle.',
        '',
        '</details>',
        '',
        `See [Tasks](${enc(WIKI)}/${enc(TASKS)}.csv).`,
      ].join('\n'),
    },
    { name: `${root}/${WIKI}/${TASKS}.csv`, data: `﻿${tasksCsv.split('\n').slice(0, 2).join('\n')}\n` },
    { name: `${root}/${WIKI}/${TASKS}_all.csv`, data: `﻿${tasksCsv}\n` },
    { name: `${root}/${WIKI}/${TASKS}/${ROW_SHIP}.md`, data: `# Ship importer\n\nStatus: In progress\nAssignee: ${personName}\n\nBody of the task.\n` },
    { name: `${root}/${WIKI}/${TASKS}/${ROW_FIX}.md`, data: '# Fix lists\n\nStatus: Done\n' },
    { name: `${root}/${WIKI}/${PROJ}.csv`, data: '﻿Name,Lead\nDocs Migration,Ana\nWebsite,Leo\n' },
    { name: `${root}/${WIKI}/${PROJ}_all.csv`, data: '﻿Name,Lead\nDocs Migration,Ana\nWebsite,Leo\n' },
    { name: `${root}/${WIKI}/${PROJ}/${P_MIG}.md`, data: '# Docs Migration\n\nLead: Ana\n' },
    { name: `${root}/${WIKI}/${PROJ}/${P_WEB}.md`, data: '# Website\n\nLead: Leo\n' },
    { name: `${root}/.DS_Store`, data: 'x' },
  ]);
}

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'zs-notion-real-'));
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

describe('Notion: piezas del export real', () => {
  it('id de Notion en paths y URLs', () => {
    expect(notionIdIn(`../${enc(PROJ)}/${enc(P_MIG)}.md`)).toBe(hex('f'));
    expect(notionIdIn('https://www.notion.so/Docs-Migration-ffffffffffffffffffffffffffffffff')).toBe(hex('f'));
    expect(notionIdIn('plain text')).toBeNull();
  });

  it('CSV: rango de fechas con su fin, relación sin destino como texto, persona por nombre', () => {
    const csv = 'Name,Due,Project,Owner\nA,"November 3, 2026 → November 5, 2026",X (x%20' + hex('9') + '.md),Ana Gómez\nB,"December 1, 2026",,Ana Gómez\n';
    const block = csvToDatabaseBlock(csv, undefined, 'T', { person: (k) => (k === 'ana gómez' ? 'user-ana' : null) });
    const props = block.db!.properties;
    expect(props.map((p) => `${p.name}:${p.type}`)).toEqual(['Name:title', 'Due:date', 'Due (end):date', 'Project:text', 'Owner:person']);
    const [a, b] = block.db!.rows;
    expect(a.values[props[1].id]).toBe('2026-11-03');
    expect(a.values[props[2].id]).toBe('2026-11-05');
    expect(b.values[props[1].id]).toBe('2026-12-01');
    expect(b.values[props[2].id]).toBeUndefined();
    expect(a.values[props[3].id]).toBe('X');
    expect(a.values[props[4].id]).toEqual(['user-ana']);
  });

  it('Markdown de Notion: ## es H2, ### es H3 y <details> es un toggle con su contenido adentro', () => {
    let n = 0;
    const blocks = markdownToBlocks('## A\n\n### B\n\n<details>\n<summary>T</summary>\n\nInside\n\n- item\n\n</details>\n\nAfter\n', {
      sanitize: sanitizeDocsHtml,
      newId: () => `b${++n}`,
      headings: 'direct',
    });
    expect(blocks.map((b) => [b.type, b.level ?? null, b.content, b.indent ?? 0])).toEqual([
      ['heading', 2, 'A', 0],
      ['heading', 3, 'B', 0],
      ['toggle', null, 'T', 0],
      ['paragraph', null, 'Inside', 1],
      ['bulleted_list_item', null, 'item', 1],
      ['paragraph', null, 'After', 0],
    ]);
  });
});

describe('Notion: export realista de punta a punta', () => {
  it('árbol, bases con relación entre ellas, personas, fechas con rango, toggles; reimportar no duplica', async () => {
    const u = await makeUser('notion-real');
    await getDb().prepare('UPDATE users SET name = ? WHERE id = ?').run('Ana Gómez', u.id);
    const data = zip('Ana Gómez');
    const job = await createImportJob({ workspaceId: u.id, teamId: null, userId: u.id, app: 'docs', source: 'notion', status: 'fetching', options: { size: data.length } });
    await getDb().prepare('UPDATE import_jobs SET payload = ? WHERE id = ?').run(localZipRef(job.id), job.id);
    await appendLocalChunk(job.id, 0, data);
    const prev = await runToEnd(job.id);
    expect(prev.status).toBe('preview');
    expect(prev.preview).toMatchObject({ pages: 1, databases: 2, rows: 4 });
    await startImportJob((await getImportJob(job.id))!);
    const done = await runToEnd(job.id);
    expect(done.status).toBe('done');
    expect(done.report).toMatchObject({ pages: 1, databases: 2, rows: 1 });

    const pages = (await getDb().prepare('SELECT id, parent_id, title, content FROM docs_pages WHERE user_id = ?').all(u.id)) as Array<{ id: string; parent_id: string | null; title: string; content: string }>;
    const by = (t: string) => pages.find((p) => p.title === t)!;
    // La carpeta envoltorio no es una página.
    expect(pages.map((p) => p.title).sort()).toEqual(['Projects', 'Tasks', 'Wiki']);
    expect(by('Tasks').parent_id).toBe(by('Wiki').id);
    expect(by('Projects').parent_id).toBe(by('Wiki').id);

    const wiki = JSON.parse(by('Wiki').content) as Array<{ type: string; level?: number; content: string; indent?: number }>;
    expect(wiki.map((b) => [b.type, b.level ?? null, b.indent ?? 0])).toEqual([
      ['heading', 2, 0],
      ['heading', 3, 0],
      ['toggle', null, 0],
      ['paragraph', null, 1],
      ['paragraph', null, 0],
    ]);
    expect(wiki[4].content).toContain(`data-page="${by('Tasks').id}"`);

    type Db = { properties: Array<{ id: string; name: string; type: string; relation?: { page_id: string; block_id: string } }>; rows: Array<{ id: string; values: Record<string, unknown>; body?: Array<{ content: string }> }> };
    const tasksBlock = JSON.parse(by('Tasks').content)[0] as { db: Db };
    const projBlock = JSON.parse(by('Projects').content)[0] as { id: string; db: Db };
    const tasks = tasksBlock.db;
    const prop = (n: string) => tasks.properties.find((p) => p.name === n)!;
    expect(tasks.properties.map((p) => `${p.name}:${p.type}`)).toEqual([
      'Name:title',
      'Status:status',
      'Assignee:person',
      'Due:date',
      'Due (end):date',
      'Project:relation',
      'Done:checkbox',
    ]);
    // La relación apunta al bloque y a las filas de la base Projects.
    expect(prop('Project').relation).toEqual({ page_id: by('Projects').id, block_id: projBlock.id });
    const projRow = (name: string) => projBlock.db.rows.find((r) => r.values[projBlock.db.properties[0].id] === name)!.id;
    const task = (name: string) => tasks.rows.find((r) => r.values[prop('Name').id] === name)!;
    expect(task('Ship importer').values[prop('Project').id]).toEqual([projRow('Docs Migration')]);
    expect(task('Fix lists').values[prop('Project').id]).toEqual([projRow('Docs Migration'), projRow('Website')]);
    expect(task('Fix lists').values[prop('Due').id]).toBe('2026-11-03');
    expect(task('Fix lists').values[prop('Due (end)').id]).toBe('2026-11-05');
    expect(task('Ship importer').values[prop('Assignee').id]).toEqual([u.id]);
    expect(task('Ship importer').body?.map((b) => b.content)).toEqual(['Body of the task.']);

    // Reimportar el mismo export: nada nuevo.
    const again = await createImportJob({ workspaceId: u.id, teamId: null, userId: u.id, app: 'docs', source: 'notion', status: 'fetching', options: { size: data.length } });
    await getDb().prepare('UPDATE import_jobs SET payload = ? WHERE id = ?').run(localZipRef(again.id), again.id);
    await appendLocalChunk(again.id, 0, data);
    await runToEnd(again.id);
    await startImportJob((await getImportJob(again.id))!);
    const done2 = await runToEnd(again.id);
    expect(done2.report).toMatchObject({ pages: 0, databases: 0, skipped: 3 });
    const count = (await getDb().prepare('SELECT COUNT(*) AS n FROM docs_pages WHERE user_id = ?').get(u.id)) as { n: number };
    expect(count.n).toBe(3);
  });
});
