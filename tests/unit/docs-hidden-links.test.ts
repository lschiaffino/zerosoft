import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { createDocPage, getDocPageRow, updateDocPage } from '@/lib/docs';
import { createTeamspace } from '@/lib/docs-access';
import { getHelpArticle, listHelpCollections } from '@/lib/docs-help';
import { addMember, createTeam } from '@/lib/teams';
import type { DocsBlock } from '@/lib/docs-types';
import { makeUser } from './helpers';

/**
 * Hotfix: un link `[[` a una página que quien lee no puede abrir muestra
 * "Private page" (editor, export, centro de ayuda) en vez del título que
 * puso quien la linkeó, y guardar no pisa ese título. Y un archivo adentro
 * de un bloque sincronizado se sirve en la página que lo pega.
 */

type FakeUser = { id: string; email: string; name?: string | null; actingUser?: { id: string; email: string; name?: string | null }; role?: string; team?: { id: string } | null };
const session = vi.hoisted(() => ({ user: null as null | FakeUser }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: FakeUser) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: FakeUser) => !u.actingUser || u.role === 'owner' || u.role === 'admin',
}));
vi.mock('@/lib/user-tz', () => ({ getUserTimeZone: async () => 'UTC' }));

const pageRoute = await import('@/lib/routes/docs/pages/[id]/route');
const exportRoute = await import('@/lib/routes/docs/pages/[id]/export/route');
const fileRoute = await import('@/lib/routes/docs/files/[pageId]/[blockId]/route');

function req(url: string, method = 'GET', body?: unknown) {
  const r = new Request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return Object.assign(r, { cookies: { get: () => undefined }, nextUrl: new URL(url) }) as never;
}
const para = (id: string, content: string, indent = 0): DocsBlock => ({ id, type: 'paragraph', content, ...(indent ? { indent } : {}) });
const TITLE = 'ZQORIGTITLE';

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'zs-hidden-'));
  process.env.UPLOADS_DIR = dir;
});
afterAll(async () => {
  delete process.env.UPLOADS_DIR;
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  session.user = null;
});

async function setup() {
  const owner = await makeUser('hlown');
  const bob = await makeUser('hlbob');
  const team = await createTeam(owner.id, 'Equipo');
  await addMember(team.id, bob.id, 'member');
  const asOwner: FakeUser = { id: owner.id, email: owner.email, name: owner.name };
  const asBob: FakeUser = { id: owner.id, email: owner.email, actingUser: { id: bob.id, email: bob.email, name: bob.name }, role: 'member', team };
  const priv = await createTeamspace(owner.id, owner.id, { name: 'Dirección', access: 'private' });
  const origin = await createDocPage(owner.id, { title: `${TITLE} Origin`, teamspace_id: priv.id });
  // Un PDF adentro de un sincronizado del origen.
  const name = `${crypto.randomUUID()}-plan.pdf`;
  await mkdir(path.join(dir, 'docs'), { recursive: true });
  await writeFile(path.join(dir, 'docs', name), '%PDF-1.4 ZQFILE');
  const syncedId = `sync-${crypto.randomUUID().slice(0, 12)}`;
  const synced: DocsBlock[] = [
    { id: 's', type: 'synced', content: '', synced_id: syncedId },
    { id: 'f1', type: 'pdf', content: '', url: `/uploads/docs/${name}`, name: 'plan.pdf', size: 15, mime: 'application/pdf', indent: 1 },
  ];
  await updateDocPage(owner.id, origin.id, { content: synced }, { actorId: owner.id });
  const host = await createDocPage(owner.id, { title: 'Manual' });
  const link = `Ver <a href="/app/docs/${origin.id}" data-page="${origin.id}">${TITLE} Origin</a>`;
  await updateDocPage(owner.id, host.id, { content: [para('a', link), ...synced], published: true }, { actorId: owner.id });
  return { owner, asOwner, asBob, origin, host };
}

describe('Links a páginas que quien lee no puede abrir', () => {
  it('editor y export de Bob: "Private page"; guardar no pisa el título; la dueña lo ve', async () => {
    const { asOwner, asBob, host } = await setup();
    const ctx = { params: Promise.resolve({ id: host.id }) };
    session.user = asBob;
    const seen = (await (await pageRoute.GET(req(`http://x/api/docs/pages/${host.id}`), ctx)).json()) as { content: DocsBlock[]; updated_at: string };
    const text = JSON.stringify(seen.content);
    expect(text).not.toContain(TITLE);
    expect(text).toContain('Private page');
    // Bob edita otro bloque y guarda con lo que vio.
    const edited = seen.content.map((b) => (b.id === 'a' ? { ...b, content: `${b.content} y más` } : b));
    expect((await pageRoute.PATCH(req(`http://x/api/docs/pages/${host.id}`, 'PATCH', { content: edited, base_updated_at: seen.updated_at }), ctx)).status).toBe(200);
    const stored = (await getDocPageRow(host.id))!.content;
    expect(stored).toContain(`${TITLE} Origin`);
    expect(stored).toContain('y más');
    expect(stored).not.toContain('Private page');
    const md = await (await exportRoute.GET(req(`http://x/api/docs/pages/${host.id}/export?format=md`), ctx)).text();
    expect(md).not.toContain(TITLE);
    expect(md).toContain('Private page');
    session.user = asOwner;
    expect(JSON.stringify(((await (await pageRoute.GET(req(`http://x/api/docs/pages/${host.id}`), ctx)).json()) as { content: unknown }).content)).toContain(TITLE);
  });

  it('centro de ayuda: ni el artículo ni el excerpt muestran el título de una página sin publicar', async () => {
    const { owner, host } = await setup();
    const row = (await getDocPageRow(host.id))!;
    const article = (await getHelpArticle(owner.id, row.slug!))!;
    const text = JSON.stringify(article.content);
    expect(text).not.toContain(TITLE);
    expect(text).toContain('Private page');
    const collections = await listHelpCollections(owner.id);
    expect(JSON.stringify(collections)).not.toContain(TITLE);
  });
});

describe('Archivo adentro de un bloque sincronizado', () => {
  it('la página que lo pega lo sirve a quien ve el origen; a Bob y al público no', async () => {
    const { asOwner, asBob, host } = await setup();
    const ctx = { params: Promise.resolve({ pageId: host.id, blockId: 'f1' }) };
    session.user = asOwner;
    const ok = await fileRoute.GET(req(`http://x/api/docs/files/${host.id}/f1`), ctx);
    expect(ok.status).toBe(200);
    expect(Buffer.from(await ok.arrayBuffer()).toString()).toContain('ZQFILE');
    session.user = asBob;
    expect((await fileRoute.GET(req(`http://x/api/docs/files/${host.id}/f1`), ctx)).status).toBe(404);
    session.user = null;
    expect((await fileRoute.GET(req(`http://x/api/docs/files/${host.id}/f1`), ctx)).status).toBe(404);
  });
});
