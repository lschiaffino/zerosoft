import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { getDb } from '@/lib/db';
import { ImportError, ImportRetryError, createImportJob, getImportJobRow, type ImportJobView } from '@/lib/import-jobs';
import { creatorCanImport, runImportJob, startImportJob } from '@/lib/import-runner';
import { getImportJob, updateImportJob } from '@/lib/import-jobs';
import {
  convertBlocks,
  convertDatabase,
  createNotionClient,
  databaseBlockId,
  normalizeNotionId,
  notionIdFromUrl,
  richTextToHtml,
  stableId,
  type DatabaseConvertContext,
  type NDatabase,
  type NotionConvertContext,
  type NotionRowInput,
  type NRichText,
} from '@/lib/notion-api';
import { FAKE_IDS, NOTION_FAKE_TOKEN, fakeNotionFetch, notionFakeAllowed } from '@/lib/notion-api-fake';
import { fetchBlockTree, isNotionFileHost, orderForWrite, setNotionClientFactory, type StagedNotion } from '@/lib/docs-notion-api-import';
import { importNeedsAdmin, importSource, IMPORT_SOURCES, importHubHref } from '@/lib/import-registry';
import { addMember, createTeam } from '@/lib/teams';
import type { DocsBlock } from '@/lib/docs-types';
import { makeUser } from './helpers';

const rt = (content: string, extra: Partial<NRichText> = {}): NRichText => ({
  type: 'text',
  plain_text: content,
  text: { content, link: null },
  annotations: {},
  ...extra,
});

const ctx = (pages: Record<string, { pageId: string; rowId?: string }> = {}): NotionConvertContext => ({
  pageFor: (id) => pages[id] ?? null,
  titleFor: () => 'Known title',
  userName: (id) => (id === 'u1' ? 'Ana Ruiz' : null),
});

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'zs-notion-api-'));
  process.env.UPLOADS_DIR = dir;
  process.env.NOTION_IMPORT_FAKE = '1';
});
afterAll(async () => {
  delete process.env.UPLOADS_DIR;
  delete process.env.NOTION_IMPORT_FAKE;
  await rm(dir, { recursive: true, force: true });
});
afterEach(() => setNotionClientFactory(null));

describe('Notion API: texto enriquecido', () => {
  it('anotaciones, links externos y links internos reescritos', () => {
    const html = richTextToHtml(
      [
        rt('Hola ', {}),
        rt('negrita', { annotations: { bold: true, italic: true } }),
        rt(' <x> '),
        rt('code', { annotations: { code: true } }),
        rt('sitio', { text: { content: 'sitio', link: { url: 'https://acme.test' } } }),
        rt('interna', { text: { content: 'interna', link: { url: '/0123456789abcdef0123456789abcdef' } } }),
      ],
      ctx({ '0123456789abcdef0123456789abcdef': { pageId: 'local-1' } }),
    );
    expect(html).toContain('<em><strong>negrita</strong></em>');
    expect(html).toContain(' &lt;x&gt; ');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<a href="https://acme.test">sitio</a>');
    expect(html).toContain('<a href="/app/docs/local-1" data-page="local-1">interna</a>');
  });

  it('menciones de página, fila, persona y fecha, y ecuaciones', () => {
    const html = richTextToHtml(
      [
        { type: 'mention', plain_text: 'Roadmap', mention: { type: 'page', page: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } } },
        { type: 'mention', plain_text: 'Fila', mention: { type: 'page', page: { id: 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee' } } },
        { type: 'mention', plain_text: '@Ana', mention: { type: 'user', user: { id: 'u1' } } },
        { type: 'mention', plain_text: 'April 1, 2025', mention: { type: 'date', date: { start: '2025-04-01' } } },
        { type: 'equation', plain_text: 'x^2', equation: { expression: 'x^2' } },
        { type: 'mention', plain_text: 'Missing', mention: { type: 'page', page: { id: '11111111-bbbb-cccc-dddd-eeeeeeeeeeee' } } },
      ],
      ctx({ aaaaaaaabbbbccccddddeeeeeeeeeeee: { pageId: 'p1' }, ffffffffbbbbccccddddeeeeeeeeeeee: { pageId: 'db1', rowId: 'r1' } }),
    );
    expect(html).toContain('<a href="/app/docs/p1" data-page="p1">Roadmap</a>');
    expect(html).toContain('data-page="db1" data-row="r1"');
    expect(html).toContain('@Ana Ruiz');
    expect(html).toContain('<span data-date="2025-04-01">April 1, 2025</span>');
    expect(html).toContain('<span data-tex="x^2">x^2</span>');
    expect(html).toContain('Missing');
  });

  it('ids de Notion en URLs', () => {
    expect(notionIdFromUrl('https://www.notion.so/acme/Roadmap-0123456789abcdef0123456789abcdef?pvs=4')).toBe('0123456789abcdef0123456789abcdef');
    expect(notionIdFromUrl('/0123456789abcdef0123456789abcdef')).toBe('0123456789abcdef0123456789abcdef');
    expect(notionIdFromUrl('https://example.com/0123456789abcdef0123456789abcdef')).toBeNull();
    expect(normalizeNotionId('0123-ABCD')).toBe('0123abcd');
    expect(stableId('a', 'b')).toBe(stableId('a', 'b'));
    expect(stableId('a', 'b')).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});

describe('Notion API: bloques', () => {
  it('convierte el árbol de la página de prueba (todos los tipos)', async () => {
    const client = createNotionClient(NOTION_FAKE_TOKEN, { fetch: fakeNotionFetch(), noThrottle: true });
    const tree = await fetchBlockTree(client, FAKE_IDS.handbook);
    expect(tree.truncated).toBe(false);
    const onboarding = normalizeNotionId(FAKE_IDS.onboarding);
    const projects = normalizeNotionId(FAKE_IDS.projects);
    const conv = convertBlocks(tree.nodes, ctx({ [onboarding]: { pageId: 'L-onb' }, [projects]: { pageId: 'L-proj' } }));
    const types = conv.blocks.map((b) => [b.type, b.indent ?? 0]);
    expect(types).toEqual([
      ['heading', 0],
      ['paragraph', 0],
      ['bulleted_list_item', 0],
      ['bulleted_list_item', 1],
      ['todo', 0],
      ['toggle', 0],
      ['paragraph', 1],
      ['code', 0],
      ['quote', 0],
      ['callout', 0],
      ['divider', 0],
      ['paragraph', 0], // marcador de la imagen
      ['table', 0],
      ['equation', 0],
      ['bookmark', 0],
      ['columns', 0],
      ['column', 1],
      ['paragraph', 2],
      ['column', 1],
      ['paragraph', 2],
      ['paragraph', 0], // child_page → link
      ['paragraph', 0], // child_database → link
    ]);
    const by = (i: number) => conv.blocks[i];
    expect(by(1).content).toContain('<strong>Important</strong>');
    expect(by(1).content).toContain('data-page="L-onb"');
    expect(by(4).checked).toBe(true);
    expect(by(7)).toMatchObject({ content: 'npm run dev', language: 'bash' });
    expect(by(9).icon).toBe('💡');
    expect(by(12).rows).toEqual([
      ['Team', 'Lead'],
      ['Design', 'Ana'],
    ]);
    expect(by(13).content).toBe('e = mc^2');
    expect(by(14).link).toEqual({ url: 'https://acme.test/blog' });
    expect(by(20).content).toContain('data-page="L-onb"');
    expect(by(21).content).toContain('data-page="L-proj"');
    expect(conv.media).toHaveLength(1);
    expect(conv.media[0]).toMatchObject({ kind: 'image', hosted: true, name: 'diagram.png', caption: 'Org chart' });
    expect(by(11).content).toBe(conv.media[0].marker);
    expect(conv.unsupported).toEqual([]);
  });

  it('tope de pedidos por página: marca la página como cortada', async () => {
    let calls = 0;
    const client = createNotionClient('t', {
      noThrottle: true,
      fetch: async () => {
        calls++;
        return new Response(
          JSON.stringify({ results: [{ id: `b${calls}`, type: 'toggle', has_children: true, toggle: { rich_text: [] } }], has_more: false, next_cursor: null }),
          { status: 200 },
        );
      },
    });
    const res = await fetchBlockTree(client, 'p');
    expect(res.truncated).toBe(true);
    expect(calls).toBeLessThanOrEqual(150);
  });
});

describe('Notion API: bases', () => {
  const schema: NDatabase = {
    object: 'database',
    id: 'db-1',
    created_time: '',
    last_edited_time: '',
    title: [rt('Projects')],
    parent: { type: 'workspace', workspace: true },
    properties: {
      Status: { id: 'st', name: 'Status', type: 'status', status: { options: [{ id: 's1', name: 'Not started' }, { id: 's3', name: 'Done' }], groups: [{ name: 'Complete', option_ids: ['s3'] }, { name: 'To-do', option_ids: ['s1'] }] } },
      Name: { id: 'title', name: 'Name', type: 'title' },
      Tags: { id: 'tg', name: 'Tags', type: 'multi_select', multi_select: { options: [{ name: 'web' }] } },
      Owner: { id: 'ow', name: 'Owner', type: 'people' },
      Due: { id: 'du', name: 'Due', type: 'date' },
      Budget: { id: 'bu', name: 'Budget', type: 'number' },
      Done: { id: 'dn', name: 'Done', type: 'checkbox' },
      Score: { id: 'sc', name: 'Score', type: 'formula' },
      Rel: { id: 're', name: 'Rel', type: 'relation', relation: { database_id: 'db-1' } },
      Brief: { id: 'br', name: 'Brief', type: 'files' },
      Code: { id: 'id', name: 'Code', type: 'unique_id', unique_id: { prefix: 'PRJ' } },
    },
  };
  const rows: NotionRowInput[] = [
    {
      notionId: 'r1',
      rowId: 'row-1',
      created: '2025-01-01T00:00:00.000Z',
      edited: '2025-01-02T00:00:00.000Z',
      properties: {
        Name: { type: 'title', title: [rt('Website')] },
        Status: { type: 'status', status: { name: 'Done' } },
        Tags: { type: 'multi_select', multi_select: [{ name: 'web' }, { name: 'new' }] },
        Owner: { type: 'people', people: [{ id: 'u1', name: 'Ana', person: { email: 'ana@acme.test' } }] },
        Due: { type: 'date', date: { start: '2025-09-30T10:00:00.000Z' } },
        Budget: { type: 'number', number: 1200 },
        Done: { type: 'checkbox', checkbox: true },
        Score: { type: 'formula', formula: { type: 'number', number: 1.2 } },
        Rel: { type: 'relation', relation: [{ id: 'r2' }] },
        Brief: { type: 'files', files: [{ name: 'a.pdf', type: 'file', file: { url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/x/a.pdf' } }] },
        Code: { type: 'unique_id', unique_id: { prefix: 'PRJ', number: 7 } },
      },
    },
    { notionId: 'r2', rowId: 'row-2', created: '', edited: '', properties: { Name: { type: 'title', title: [rt('App')] } } },
  ];
  const dctx = (people: Record<string, string>): DatabaseConvertContext => ({
    ...ctx(),
    personFor: (email) => people[email] ?? null,
    user: () => null,
    databaseFor: (id) => (id === 'db1' ? { pageId: 'page-db', blockId: databaseBlockId('db-1') } : null),
    rowFor: (id) => (id === 'r2' ? 'row-2' : id === 'r1' ? 'row-1' : null),
  });

  it('propiedades con su tipo y valores por fila', () => {
    const { block, files } = convertDatabase(schema, rows, dctx({ 'ana@acme.test': 'user-ana' }));
    const db = block.db!;
    expect(block.id).toBe(databaseBlockId('db-1'));
    expect(db.title).toBe('Projects');
    const prop = (name: string) => db.properties.find((p) => p.name === name)!;
    expect(db.properties[0].type).toBe('title');
    expect(prop('Status').type).toBe('status');
    expect(prop('Status').options?.map((o) => [o.name, o.group])).toEqual([
      ['Not started', 'todo'],
      ['Done', 'done'],
    ]);
    expect(prop('Tags').options?.map((o) => o.name)).toEqual(['web', 'new']);
    expect(prop('Owner').type).toBe('person');
    expect(prop('Due').type).toBe('date');
    expect(prop('Score').type).toBe('number');
    expect(prop('Rel')).toMatchObject({ type: 'relation', relation: { page_id: 'page-db', block_id: databaseBlockId('db-1') } });
    expect(prop('Brief').type).toBe('files');
    const r = db.rows[0].values;
    expect(r[prop('Name').id]).toBe('Website');
    expect(r[prop('Status').id]).toBe(prop('Status').options![1].id);
    expect((r[prop('Tags').id] as string[]).length).toBe(2);
    expect(r[prop('Owner').id]).toEqual(['user-ana']);
    expect(r[prop('Due').id]).toBe('2025-09-30');
    expect(r[prop('Budget').id]).toBe(1200);
    expect(r[prop('Done').id]).toBe(true);
    expect(r[prop('Score').id]).toBe(1.2);
    expect(r[prop('Rel').id]).toEqual(['row-2']);
    expect(r[prop('Code').id]).toBe('PRJ-7');
    expect(db.rows[0].created_at).toBe('2025-01-01T00:00:00.000Z');
    expect(files).toEqual([{ rowId: 'row-1', propId: prop('Brief').id, url: expect.stringContaining('a.pdf'), name: 'a.pdf', hosted: true }]);
    // Ids estables: reimportar no cambia propiedades ni opciones.
    const again = convertDatabase(schema, rows, dctx({ 'ana@acme.test': 'user-ana' }));
    expect(again.block.db!.properties.map((p) => p.id)).toEqual(db.properties.map((p) => p.id));
  });

  it('people sin coincidencia en el workspace queda como texto', () => {
    const { block } = convertDatabase(schema, rows, dctx({}));
    const owner = block.db!.properties.find((p) => p.name === 'Owner')!;
    expect(owner.type).toBe('text');
    expect(block.db!.rows[0].values[owner.id]).toBe('Ana');
  });
});

describe('Notion API: orden de escritura', () => {
  const n = (id: string, kind: 'page' | 'database', parent: StagedNotion['parent']): StagedNotion => ({
    id,
    kind,
    title: id,
    icon: null,
    parent,
    created: '',
    edited: '',
    localId: `L${id}`,
    existing: false,
  });
  it('padres antes que hijas, bases antes que filas y las hijas de una fila después de su base', () => {
    const items = [
      n('row1', 'page', { type: 'database', id: 'db' }),
      n('sub', 'page', { type: 'page', id: 'root' }),
      n('underRow', 'page', { type: 'page', id: 'row1' }),
      n('db', 'database', { type: 'page', id: 'root' }),
      n('root', 'page', { type: 'workspace', id: null }),
      n('orphan', 'page', { type: 'page', id: 'not-shared' }),
    ];
    const ids = orderForWrite(items).map((i) => i.id);
    expect(ids.indexOf('root')).toBeLessThan(ids.indexOf('sub'));
    expect(ids.indexOf('root')).toBeLessThan(ids.indexOf('db'));
    expect(ids.indexOf('db')).toBeLessThan(ids.indexOf('row1'));
    expect(ids.indexOf('db')).toBeLessThan(ids.indexOf('underRow'));
    expect(ids[ids.length - 1]).toBe('row1');
    expect(ids).toHaveLength(6);
  });
});

describe('Notion API: cliente', () => {
  it('429 con Retry-After corto: espera y reintenta', async () => {
    let calls = 0;
    const client = createNotionClient('t', {
      noThrottle: true,
      fetch: async () => {
        calls++;
        if (calls === 1) return new Response('{}', { status: 429, headers: { 'retry-after': '1' } });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    expect(await client.get('/users/me')).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('429 con Retry-After largo: el job vuelve a la cola', async () => {
    const client = createNotionClient('t', { noThrottle: true, fetch: async () => new Response('{}', { status: 429, headers: { 'retry-after': '120' } }) });
    await expect(client.get('/search')).rejects.toBeInstanceOf(ImportRetryError);
  });

  it('401, 403 y 404 con códigos que la UI traduce; el token va solo en el header', async () => {
    const seen: Array<{ url: string; auth: string | null; version: string | null }> = [];
    const mk = (status: number) =>
      createNotionClient('secret_abc', {
        noThrottle: true,
        fetch: async (url, init) => {
          const h = new Headers(init.headers);
          seen.push({ url, auth: h.get('authorization'), version: h.get('notion-version') });
          return new Response('{}', { status });
        },
      });
    await expect(mk(401).get('/users/me')).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(mk(403).get('/users')).rejects.toMatchObject({ code: 'restricted' });
    await expect(mk(404).get('/blocks/x/children')).rejects.toMatchObject({ code: 'not_found' });
    expect(seen.every((s) => !s.url.includes('secret_abc') && s.auth === 'Bearer secret_abc' && s.version === '2022-06-28')).toBe(true);
    expect(seen[0].url).toBe('https://api.notion.com/v1/users/me');
  });

  it('solo baja archivos de hosts de Notion por https', () => {
    expect(isNotionFileHost('https://prod-files-secure.s3.us-west-2.amazonaws.com/a/b.png?sig=1')).toBe(true);
    expect(isNotionFileHost('https://file.notion.so/f/x.png')).toBe(true);
    expect(isNotionFileHost('http://prod-files-secure.s3.us-west-2.amazonaws.com/a.png')).toBe(false);
    expect(isNotionFileHost('https://evil.example.com/a.png')).toBe(false);
    expect(isNotionFileHost('https://169.254.169.254/latest')).toBe(false);
  });
});

describe('Hub: registro de fuentes', () => {
  it('ids únicos, pasos y quién puede importar', () => {
    expect(new Set(IMPORT_SOURCES.map((s) => s.id)).size).toBe(IMPORT_SOURCES.length);
    expect(importSource('crm:hubspot')?.scopes).toContain('crm.lists.read');
    expect(importSource('docs:notion_api')?.auth).toBe('token');
    expect(importSource('nope')).toBeNull();
    expect(importNeedsAdmin('docs', 'notion_api')).toBe(true);
    expect(importNeedsAdmin('docs', 'notion')).toBe(false);
    expect(importNeedsAdmin('track', 'linear')).toBe(true);
    expect(importHubHref({ app: 'crm' })).toBe('/app/settings/import?app=crm');
    expect(importHubHref({ source: 'docs:notion_api' })).toBe('/app/settings/import?source=docs%3Anotion_api');
    expect(importHubHref({ app: 'nope' })).toBe('/app/settings/import');
  });
});

async function runToEnd(id: string): Promise<ImportJobView> {
  for (let i = 0; i < 80; i++) {
    const v = (await runImportJob(id, 5_000))!;
    if (!['fetching', 'importing'].includes(v.status)) return v;
  }
  throw new Error('stuck');
}

async function pages(workspaceId: string) {
  return (await getDb().prepare('SELECT id, parent_id, title, icon, content FROM docs_pages WHERE user_id = ? ORDER BY created_at').all(workspaceId)) as Array<{
    id: string;
    parent_id: string | null;
    title: string;
    icon: string | null;
    content: string;
  }>;
}

describe('Notion API: job de punta a punta (workspace falso)', () => {
  it('solo en test/demo con NOTION_IMPORT_FAKE=1', () => {
    expect(notionFakeAllowed()).toBe(true);
    process.env.NOTION_IMPORT_FAKE = '0';
    expect(notionFakeAllowed()).toBe(false);
    process.env.NOTION_IMPORT_FAKE = '1';
  });

  it('valida, previsualiza, importa con árbol, bases, filas, archivos y links, y reimporta sin duplicar', async () => {
    const u = await makeUser('notionapi');
    const job = await createImportJob({ workspaceId: u.id, teamId: null, userId: u.id, app: 'docs', source: 'notion_api', secret: NOTION_FAKE_TOKEN });
    const preview = await runToEnd(job.id);
    expect(preview.status).toBe('preview');
    expect(preview.preview).toMatchObject({ account: 'Acme (fake)', pages: 2, databases: 1, rows: 2, people: 2, alreadyImported: 0 });
    // El token sigue (cifrado) hasta escribir: los archivos de Notion vencen en una hora.
    const row = await getImportJobRow(job.id);
    expect(row?.secret).toBeTruthy();
    expect(row?.secret).not.toContain(NOTION_FAKE_TOKEN);

    const j = (await getImportJob(job.id))!;
    expect(await startImportJob(j)).toBe(true);
    const done = await runToEnd(job.id);
    expect(done.status).toBe('done');
    expect(done.report).toMatchObject({ created: 3, updated: 0, pages: 2, databases: 1, rows: 2, failed: 0 });
    expect(done.report).toMatchObject({ files: 2, filesSkipped: 0 });
    expect((await getImportJobRow(job.id))?.secret).toBeNull();

    const all = await pages(u.id);
    expect(all.map((p) => p.title).sort()).toEqual(['Handbook', 'Onboarding', 'Projects']);
    const handbook = all.find((p) => p.title === 'Handbook')!;
    const onboarding = all.find((p) => p.title === 'Onboarding')!;
    const projects = all.find((p) => p.title === 'Projects')!;
    expect(handbook.icon).toBe('📘');
    expect(onboarding.parent_id).toBe(handbook.id);
    expect(projects.parent_id).toBe(handbook.id);
    const blocks = JSON.parse(handbook.content) as DocsBlock[];
    expect(blocks.find((b) => b.type === 'paragraph' && b.content.includes('Important'))?.content).toContain(`data-page="${onboarding.id}"`);
    const img = blocks.find((b) => b.type === 'image');
    expect(img).toMatchObject({ name: 'diagram.png', mime: 'image/png', caption: 'Org chart' });
    expect(img?.url).toMatch(/^\/uploads\/docs\//);
    const onbBlocks = JSON.parse(onboarding.content) as DocsBlock[];
    expect(onbBlocks[0].content).toContain('<span data-date="2025-04-01">');
    expect(onbBlocks[0].content).toContain('@Bo Chen');
    expect(onbBlocks[0].content).toContain(`data-page="${handbook.id}"`);
    const dbBlock = (JSON.parse(projects.content) as DocsBlock[]).find((b) => b.type === 'database')!;
    expect(dbBlock.db?.rows).toHaveLength(2);
    const website = dbBlock.db!.rows.find((r) => Object.values(r.values).includes('Website relaunch'))!;
    expect(website.body?.[0].content).toContain('Kickoff notes');
    const owner = dbBlock.db!.properties.find((p) => p.name === 'Owner')!;
    // demo@zerosoft.ai no es del workspace de prueba: queda como texto con el nombre.
    expect(website.values[owner.id]).toBe('Ana Ruiz');
    const related = dbBlock.db!.properties.find((p) => p.name === 'Related')!;
    expect(related.type).toBe('relation');
    expect(website.values[related.id]).toHaveLength(1);
    const brief = dbBlock.db!.properties.find((p) => p.name === 'Brief')!;
    expect(website.files?.[brief.id]?.[0]).toMatchObject({ name: 'brief.png' });

    // Reimportar: actualiza las mismas páginas (ids externos), sin duplicar.
    const again = await createImportJob({ workspaceId: u.id, teamId: null, userId: u.id, app: 'docs', source: 'notion_api', secret: NOTION_FAKE_TOKEN });
    const p2 = await runToEnd(again.id);
    expect(p2.preview).toMatchObject({ alreadyImported: 3 });
    await updateImportJob(again.id, { options: { ...((await getImportJob(again.id))!.options), include: { pages: true, databases: true, files: false } } });
    expect(await startImportJob((await getImportJob(again.id))!)).toBe(true);
    const d2 = await runToEnd(again.id);
    expect(d2.report).toMatchObject({ created: 0, updated: 3, rows: 2 });
    expect(await pages(u.id)).toHaveLength(3);
    const ws = (JSON.parse((await pages(u.id)).find((p) => p.title === 'Projects')!.content) as DocsBlock[]).find((b) => b.type === 'database')!;
    expect(ws.db?.rows.find((r) => r.id === website.id)?.body?.[0].content).toContain('Kickoff notes');
  });

  it('reimportar no pisa lo editado en zerosoft (salvo "Reemplazar") ni vuelve a subir archivos', async () => {
    const u = await makeUser('notionlocal');
    const importOnce = async (include: Record<string, boolean>) => {
      const job = await createImportJob({ workspaceId: u.id, teamId: null, userId: u.id, app: 'docs', source: 'notion_api', secret: NOTION_FAKE_TOKEN });
      const preview = await runToEnd(job.id);
      await updateImportJob(job.id, { options: { ...((await getImportJob(job.id))!.options), include } });
      expect(await startImportJob((await getImportJob(job.id))!)).toBe(true);
      return { preview, done: await runToEnd(job.id) };
    };
    await importOnce({ pages: true, databases: true, files: true });
    const { readdir } = await import('fs/promises');
    const filesAfterFirst = (await readdir(path.join(dir, 'docs'))).length;
    // Alguien edita Onboarding en zerosoft después del import.
    const onb = (await pages(u.id)).find((p) => p.title === 'Onboarding')!;
    await getDb().prepare('UPDATE docs_pages SET title = ?, updated_at = ? WHERE id = ?').run('Onboarding (ours)', '2999-01-01T00:00:00.000Z', onb.id);

    const second = await importOnce({ pages: true, databases: true, files: true });
    expect(second.preview.preview).toMatchObject({ alreadyImported: 3, localEdited: 1 });
    expect(second.done.report).toMatchObject({ kept: 1, updated: 2, created: 0 });
    expect((await pages(u.id)).find((p) => p.id === onb.id)?.title).toBe('Onboarding (ours)');
    // Los archivos ya copiados se reusan.
    expect((await readdir(path.join(dir, 'docs'))).length).toBe(filesAfterFirst);

    const third = await importOnce({ pages: true, databases: true, files: true, overwrite: true });
    expect(third.done.report).toMatchObject({ kept: 0, updated: 3 });
    expect((await pages(u.id)).find((p) => p.id === onb.id)?.title).toBe('Onboarding');
  });

  it('un miembro no ve los imports de otros ni links a páginas que no puede abrir', async () => {
    const owner = await makeUser('nvisowner');
    const member = await makeUser('nvismember');
    const team = await createTeam(owner.id, 'Acme');
    await addMember(team.id, member.id, 'member');
    await createImportJob({ workspaceId: owner.id, teamId: team.id, userId: owner.id, app: 'docs', source: 'notion', status: 'fetching' });
    const { listImportJobs } = await import('@/lib/import-jobs');
    expect(await listImportJobs(owner.id, 'docs', 10, member.id)).toHaveLength(0);
    expect((await listImportJobs(owner.id, 'docs', 10, null)).length).toBeGreaterThan(0);
    const { viewFor } = await import('@/lib/import-http');
    const view = {
      id: 'x', app: 'docs' as const, source: 'notion_api', status: 'done' as const, stage: '', total: 0, processed: 0, preview: null, error: null,
      options: {}, created_at: '', updated_at: '', finished_at: null,
      report: { roots: [{ id: 'no-such-page', title: 'Secret plans' }] },
    };
    const filtered = await viewFor({ ...owner, role: 'owner' } as never, view);
    expect((filtered!.report as { roots: unknown[] }).roots).toEqual([]);
  });

  it('token rechazado: falla leyendo, antes de escribir nada', async () => {
    const u = await makeUser('notionbad');
    const job = await createImportJob({ workspaceId: u.id, teamId: null, userId: u.id, app: 'docs', source: 'notion_api', secret: 'secret_wrong' });
    setNotionClientFactory((token) => createNotionClient(token, { fetch: fakeNotionFetch(), noThrottle: true }));
    const v = await runToEnd(job.id);
    expect(v.status).toBe('failed');
    expect(v.error).toBe('unauthorized');
    expect(await pages(u.id)).toHaveLength(0);
    expect((await getImportJobRow(job.id))?.secret).toBeNull();
  });

  it('corre con el acceso de quien lo creó: si deja de ser admin, se corta', async () => {
    const owner = await makeUser('nowner');
    const member = await makeUser('nmember');
    const team = await createTeam(owner.id, 'Acme');
    await addMember(team.id, member.id, 'admin');
    const base = { app: 'docs' as const, source: 'notion_api', workspace_id: owner.id, user_id: member.id };
    expect(await creatorCanImport(base)).toBe(true);
    await getDb().prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').run('member', team.id, member.id);
    expect(await creatorCanImport(base)).toBe(false);
    expect(await creatorCanImport({ ...base, source: 'notion' })).toBe(true);
    expect(ImportError).toBeTruthy();
  });
});
