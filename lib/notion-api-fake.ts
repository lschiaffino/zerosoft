/**
 * Notion por API — fake para tests y la demo (NOTION_IMPORT_FAKE=1 con
 * NODE_ENV=test o DEMO_MODE; en producción normal nunca). Responde como la
 * API real (mismas rutas y formas) con un workspace chico: una página con
 * todos los tipos de bloque, una subpágina, una base con propiedades de
 * todos los tipos y dos filas, y un archivo alojado por Notion.
 *
 * Token "fake-notion". Cualquier otro: 401, como la API real.
 */
import type { NotionFetch } from './notion-api';

export const NOTION_FAKE_TOKEN = 'fake-notion';

export function notionFakeAllowed(): boolean {
  if (process.env.NOTION_IMPORT_FAKE !== '1') return false;
  return process.env.NODE_ENV === 'test' || process.env.DEMO_MODE === 'true';
}

export function isNotionFakeToken(token: string): boolean {
  return token === NOTION_FAKE_TOKEN;
}

const T = (content: string, extra: Record<string, unknown> = {}) => ({
  type: 'text',
  text: { content, link: (extra.link as { url: string } | undefined) ?? null },
  annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default', ...((extra.annotations as object) ?? {}) },
  plain_text: content,
  href: (extra.link as { url: string } | undefined)?.url ?? null,
});

export const FAKE_IDS = {
  handbook: '1a2b3c4d-0000-4000-8000-000000000001',
  onboarding: '1a2b3c4d-0000-4000-8000-000000000002',
  projects: '1a2b3c4d-0000-4000-8000-000000000003',
  rowWebsite: '1a2b3c4d-0000-4000-8000-000000000004',
  rowMobile: '1a2b3c4d-0000-4000-8000-000000000005',
  ana: 'aaaaaaaa-0000-4000-8000-00000000000a',
  bo: 'bbbbbbbb-0000-4000-8000-00000000000b',
};

const FILE_URL = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/fake/diagram.png?X-Amz-Signature=fake';
// PNG de 1x1.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

function page(id: string, title: string, parent: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    object: 'page',
    id,
    created_time: '2025-03-01T10:00:00.000Z',
    last_edited_time: '2025-03-02T10:00:00.000Z',
    archived: false,
    in_trash: false,
    icon: extra.icon ?? null,
    parent,
    properties: extra.properties ?? { title: { id: 'title', type: 'title', title: [T(title)] } },
    url: `https://www.notion.so/${title.replace(/\s+/g, '-')}-${id.replace(/-/g, '')}`,
  };
}

function block(id: string, type: string, data: Record<string, unknown>, hasChildren = false) {
  return { object: 'block', id, type, has_children: hasChildren, [type]: data };
}

const handbook = page(FAKE_IDS.handbook, 'Handbook', { type: 'workspace', workspace: true }, { icon: { type: 'emoji', emoji: '📘' } });
const onboarding = page(FAKE_IDS.onboarding, 'Onboarding', { type: 'page_id', page_id: FAKE_IDS.handbook });

const projects = {
  object: 'database',
  id: FAKE_IDS.projects,
  created_time: '2025-03-01T10:00:00.000Z',
  last_edited_time: '2025-03-02T10:00:00.000Z',
  archived: false,
  in_trash: false,
  is_inline: false,
  title: [T('Projects')],
  description: [],
  icon: { type: 'emoji', emoji: '🗂️' },
  parent: { type: 'page_id', page_id: FAKE_IDS.handbook },
  properties: {
    Name: { id: 'title', name: 'Name', type: 'title', title: {} },
    Status: {
      id: 'st',
      name: 'Status',
      type: 'status',
      status: {
        options: [
          { id: 's1', name: 'Not started' },
          { id: 's2', name: 'In progress' },
          { id: 's3', name: 'Done' },
        ],
        groups: [
          { name: 'To-do', option_ids: ['s1'] },
          { name: 'In progress', option_ids: ['s2'] },
          { name: 'Complete', option_ids: ['s3'] },
        ],
      },
    },
    Tags: { id: 'tg', name: 'Tags', type: 'multi_select', multi_select: { options: [{ name: 'web' }, { name: 'mobile' }, { name: 'q3' }] } },
    Owner: { id: 'ow', name: 'Owner', type: 'people', people: {} },
    Due: { id: 'du', name: 'Due', type: 'date', date: {} },
    Budget: { id: 'bu', name: 'Budget', type: 'number', number: { format: 'dollar' } },
    Shipped: { id: 'sh', name: 'Shipped', type: 'checkbox', checkbox: {} },
    Link: { id: 'li', name: 'Link', type: 'url', url: {} },
    Score: { id: 'sc', name: 'Score', type: 'formula', formula: { expression: 'prop("Budget") / 1000' } },
    Related: { id: 're', name: 'Related', type: 'relation', relation: { database_id: FAKE_IDS.projects } },
    Brief: { id: 'br', name: 'Brief', type: 'files', files: {} },
  },
};

function row(id: string, title: string, props: Record<string, unknown>) {
  return page(id, title, { type: 'database_id', database_id: FAKE_IDS.projects }, {
    properties: {
      Name: { id: 'title', type: 'title', title: [T(title)] },
      ...props,
    },
  });
}

const rowWebsite = row(FAKE_IDS.rowWebsite, 'Website relaunch', {
  Status: { id: 'st', type: 'status', status: { id: 's2', name: 'In progress' } },
  Tags: { id: 'tg', type: 'multi_select', multi_select: [{ name: 'web' }, { name: 'q3' }] },
  Owner: { id: 'ow', type: 'people', people: [{ object: 'user', id: FAKE_IDS.ana, name: 'Ana Ruiz', person: { email: 'demo@zerosoft.ai' } }] },
  Due: { id: 'du', type: 'date', date: { start: '2025-09-30', end: null } },
  Budget: { id: 'bu', type: 'number', number: 12000 },
  Shipped: { id: 'sh', type: 'checkbox', checkbox: false },
  Link: { id: 'li', type: 'url', url: 'https://example.com/site' },
  Score: { id: 'sc', type: 'formula', formula: { type: 'number', number: 12 } },
  Related: { id: 're', type: 'relation', relation: [{ id: FAKE_IDS.rowMobile }], has_more: false },
  Brief: { id: 'br', type: 'files', files: [{ name: 'brief.png', type: 'file', file: { url: FILE_URL, expiry_time: '2099-01-01T00:00:00.000Z' } }] },
});

const rowMobile = row(FAKE_IDS.rowMobile, 'Mobile app', {
  Status: { id: 'st', type: 'status', status: { id: 's3', name: 'Done' } },
  Tags: { id: 'tg', type: 'multi_select', multi_select: [{ name: 'mobile' }] },
  Owner: { id: 'ow', type: 'people', people: [{ object: 'user', id: FAKE_IDS.ana, name: 'Ana Ruiz', person: { email: 'demo@zerosoft.ai' } }] },
  Due: { id: 'du', type: 'date', date: null },
  Budget: { id: 'bu', type: 'number', number: 8000 },
  Shipped: { id: 'sh', type: 'checkbox', checkbox: true },
  Link: { id: 'li', type: 'url', url: null },
  Score: { id: 'sc', type: 'formula', formula: { type: 'number', number: 8 } },
  Related: { id: 're', type: 'relation', relation: [], has_more: false },
  Brief: { id: 'br', type: 'files', files: [] },
});

const mention = (pageId: string, label: string) => ({
  type: 'mention',
  mention: { type: 'page', page: { id: pageId } },
  annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
  plain_text: label,
  href: `https://www.notion.so/${pageId.replace(/-/g, '')}`,
});

/** Hijos de cada bloque (o página) por id. */
const CHILDREN: Record<string, unknown[]> = {
  [FAKE_IDS.handbook]: [
    block('b0000001-0000-4000-8000-000000000001', 'heading_1', { rich_text: [T('Welcome to Acme')], is_toggleable: false }),
    block('b0000001-0000-4000-8000-000000000002', 'paragraph', {
      rich_text: [T('Read this first. '), T('Important', { annotations: { bold: true } }), T(': see '), mention(FAKE_IDS.onboarding, 'Onboarding'), T(' and '), T('our site', { link: { url: 'https://acme.test' } })],
    }),
    block('b0000001-0000-4000-8000-000000000003', 'bulleted_list_item', { rich_text: [T('Values')] }, true),
    block('b0000001-0000-4000-8000-000000000004', 'to_do', { rich_text: [T('Sign the handbook')], checked: true }),
    block('b0000001-0000-4000-8000-000000000005', 'toggle', { rich_text: [T('FAQ')] }, true),
    block('b0000001-0000-4000-8000-000000000006', 'code', { rich_text: [T('npm run dev')], language: 'bash', caption: [] }),
    block('b0000001-0000-4000-8000-000000000007', 'quote', { rich_text: [T('Ship small, ship often.')] }),
    block('b0000001-0000-4000-8000-000000000008', 'callout', { rich_text: [T('Office closed on Fridays')], icon: { type: 'emoji', emoji: '💡' } }),
    block('b0000001-0000-4000-8000-000000000009', 'divider', {}),
    block('b0000001-0000-4000-8000-00000000000a', 'image', { type: 'file', file: { url: FILE_URL, expiry_time: '2099-01-01T00:00:00.000Z' }, caption: [T('Org chart')] }),
    block('b0000001-0000-4000-8000-00000000000b', 'table', { table_width: 2, has_column_header: true, has_row_header: false }, true),
    block('b0000001-0000-4000-8000-00000000000c', 'equation', { expression: 'e = mc^2' }),
    block('b0000001-0000-4000-8000-00000000000d', 'bookmark', { url: 'https://acme.test/blog', caption: [] }),
    block('b0000001-0000-4000-8000-00000000000e', 'column_list', {}, true),
    block(FAKE_IDS.onboarding, 'child_page', { title: 'Onboarding' }),
    block(FAKE_IDS.projects, 'child_database', { title: 'Projects' }),
  ],
  'b0000001-0000-4000-8000-000000000003': [block('b0000002-0000-4000-8000-000000000001', 'bulleted_list_item', { rich_text: [T('Be kind')] })],
  'b0000001-0000-4000-8000-000000000005': [block('b0000002-0000-4000-8000-000000000002', 'paragraph', { rich_text: [T('Ask in #help.')] })],
  'b0000001-0000-4000-8000-00000000000b': [
    block('b0000002-0000-4000-8000-000000000003', 'table_row', { cells: [[T('Team')], [T('Lead')]] }),
    block('b0000002-0000-4000-8000-000000000004', 'table_row', { cells: [[T('Design')], [T('Ana')]] }),
  ],
  'b0000001-0000-4000-8000-00000000000e': [
    block('b0000002-0000-4000-8000-000000000005', 'column', {}, true),
    block('b0000002-0000-4000-8000-000000000006', 'column', {}, true),
  ],
  'b0000002-0000-4000-8000-000000000005': [block('b0000003-0000-4000-8000-000000000001', 'paragraph', { rich_text: [T('Left column')] })],
  'b0000002-0000-4000-8000-000000000006': [block('b0000003-0000-4000-8000-000000000002', 'paragraph', { rich_text: [T('Right column')] })],
  [FAKE_IDS.onboarding]: [
    block('b0000004-0000-4000-8000-000000000001', 'paragraph', {
      rich_text: [
        T('Start on '),
        { type: 'mention', mention: { type: 'date', date: { start: '2025-04-01', end: null } }, plain_text: 'April 1, 2025', href: null },
        T(' with '),
        { type: 'mention', mention: { type: 'user', user: { object: 'user', id: FAKE_IDS.bo } }, plain_text: '@Bo Chen', href: null },
        T('. Back to '),
        T('the handbook', { link: { url: `/${FAKE_IDS.handbook.replace(/-/g, '')}` } }),
      ],
    }),
  ],
  [FAKE_IDS.rowWebsite]: [block('b0000005-0000-4000-8000-000000000001', 'paragraph', { rich_text: [T('Kickoff notes for the relaunch.')] })],
  [FAKE_IDS.rowMobile]: [],
};

const USERS = [
  { object: 'user', id: FAKE_IDS.ana, type: 'person', name: 'Ana Ruiz', person: { email: 'demo@zerosoft.ai' } },
  { object: 'user', id: FAKE_IDS.bo, type: 'person', name: 'Bo Chen', person: { email: 'bo@acme.test' } },
  { object: 'user', id: 'cccccccc-0000-4000-8000-00000000000c', type: 'bot', name: 'Import bot', bot: {} },
];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function list(results: unknown[]) {
  return { object: 'list', results, has_more: false, next_cursor: null };
}

/** fetch de la API de Notion contra el workspace de prueba. */
export function fakeNotionFetch(): NotionFetch {
  return async (url, init) => {
    if (url.startsWith('https://prod-files-secure.s3.us-west-2.amazonaws.com/fake/')) {
      return new Response(new Uint8Array(PNG), { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(PNG.length) } });
    }
    const auth = new Headers(init.headers).get('authorization');
    if (auth !== `Bearer ${NOTION_FAKE_TOKEN}`) return json({ object: 'error', status: 401, code: 'unauthorized' }, 401);
    const { pathname } = new URL(url);
    const path = pathname.replace(/^\/v1/, '');
    if (path === '/users/me') return json({ object: 'user', id: 'bot-1', type: 'bot', name: 'zerosoft import', bot: { workspace_name: 'Acme (fake)' } });
    if (path === '/users') return json(list(USERS));
    if (path === '/search') return json(list([handbook, onboarding, projects, rowWebsite, rowMobile]));
    // La API acepta ids con o sin guiones.
    const norm = (id: string) => decodeURIComponent(id).replace(/-/g, '').toLowerCase();
    const db = /^\/databases\/([^/]+)\/query$/.exec(path);
    if (db && norm(db[1]) === norm(FAKE_IDS.projects)) return json(list([rowWebsite, rowMobile]));
    const children = /^\/blocks\/([^/]+)\/children$/.exec(path);
    if (children) {
      const key = Object.keys(CHILDREN).find((k) => norm(k) === norm(children[1]));
      return json(list(key ? CHILDREN[key] : []));
    }
    return json({ object: 'error', status: 404, code: 'object_not_found' }, 404);
  };
}
