import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient, getDb } from '@/lib/db';
import { createDocPage, getDocPageRow, searchDocPagesContent, updateDocPage } from '@/lib/docs';
import { saveDocVersion, listDocVersions, restoreDocVersion } from '@/lib/docs-versions';
import { createTeamspace, hiddenTeamspaceIds, updateTeamspace } from '@/lib/docs-access';
import { getHelpArticle, listHelpCollections, searchHelpArticles, withHelpExcerpts } from '@/lib/docs-help';
import { getSyncedBlock } from '@/lib/docs-synced';
import { createChatWidget, findBotReply } from '@/lib/chat-data';
import { retrieveKnowledge } from '@/lib/chat-bot-ai';
import { searchAgentKnowledge } from '@/lib/agent-tools';
import { MIGRATIONS } from '@/lib/schema/migrations';
import { addMember, createTeam } from '@/lib/teams';
import type { DocsBlock } from '@/lib/docs-types';
import { makeUser } from './helpers';

/**
 * Bloques sincronizados: lo de un bloque cuya página de origen no se puede
 * abrir no aparece por ningún camino (la página que lo pega guarda solo la
 * referencia). Dos personas reales del workspace (dueña y Bob, sin acceso al
 * teamspace privado del origen) y el público sin sesión.
 */

type FakeUser = { id: string; email: string; name?: string | null; actingUser?: { id: string; email: string; name?: string | null }; role?: string; team?: { id: string } | null };
const session = vi.hoisted(() => ({ user: null as null | FakeUser }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: FakeUser) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: FakeUser) => !u.actingUser || u.role === 'owner' || u.role === 'admin',
}));
vi.mock('@/lib/user-tz', () => ({ getUserTimeZone: async () => 'UTC' }));

const pageRoute = await import('@/app/api/docs/pages/[id]/route');
const liveRoute = await import('@/app/api/docs/pages/[id]/live/route');
const exportRoute = await import('@/app/api/docs/pages/[id]/export/route');
const versionRoute = await import('@/app/api/docs/pages/[id]/versions/[versionId]/route');
const searchRoute = await import('@/app/api/docs/search/route');
const helpRoute = await import('@/app/api/chat/help/route');

function req(url: string, method = 'GET', body?: unknown) {
  const r = new Request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return Object.assign(r, { cookies: { get: () => undefined }, nextUrl: new URL(url) }) as never;
}
const para = (id: string, content: string, indent = 0): DocsBlock => ({ id, type: 'paragraph', content, ...(indent ? { indent } : {}) });
const SECRET = 'zafirocuota';

/** Dueña, Bob (miembro sin acceso al teamspace privado), origen privado y una página pública que lo pega. */
async function setup() {
  const owner = await makeUser('own');
  const bob = await makeUser('bob');
  const team = await createTeam(owner.id, 'Equipo');
  await addMember(team.id, bob.id, 'member');
  const asOwner: FakeUser = { id: owner.id, email: owner.email, name: owner.name };
  const asBob: FakeUser = { id: owner.id, email: owner.email, actingUser: { id: bob.id, email: bob.email, name: bob.name }, role: 'member', team };
  const priv = await createTeamspace(owner.id, owner.id, { name: 'Dirección', access: 'private' });
  const syncedId = `sync-${crypto.randomUUID().slice(0, 12)}`;
  const synced: DocsBlock[] = [{ id: 's', type: 'synced', content: '', synced_id: syncedId }, para('c', `Sueldos ${SECRET} 2027`, 1)];
  const src = await createDocPage(owner.id, { title: 'Origen', teamspace_id: priv.id });
  await updateDocPage(owner.id, src.id, { content: synced }, { actorId: owner.id });
  // La dueña pega el sincronizado en una página de todos, publicada y legible por la IA (como el editor: con los hijos).
  const host = await createDocPage(owner.id, { title: 'Manual de bienvenida' });
  await updateDocPage(owner.id, host.id, { content: [para('a', 'Hola equipo'), ...synced], published: true, is_public: true }, { actorId: owner.id });
  const hideBob = await hiddenTeamspaceIds(owner.id, bob.id);
  return { owner, bob, asOwner, asBob, priv, src, host, syncedId, hideBob };
}

beforeEach(() => {
  session.user = null;
});

describe('Docs: el content de la página guarda solo la referencia del sincronizado', () => {
  it('ni la página, ni sus revisiones, ni sus versiones tienen copia de los hijos', async () => {
    const { owner, host, syncedId } = await setup();
    const row = (await getDocPageRow(host.id))!;
    expect(row.content).not.toContain(SECRET);
    expect(row.content).toContain(syncedId);
    const revs = (await getDb().prepare('SELECT content FROM docs_page_revisions WHERE page_id = ?').all(host.id)) as Array<{ content: string }>;
    expect(revs.length).toBeGreaterThan(0);
    for (const r of revs) expect(r.content).not.toContain(SECRET);
    await saveDocVersion(owner.id, host.id, owner.id, 'manual');
    const vers = (await getDb().prepare('SELECT content FROM docs_versions WHERE page_id = ?').all(host.id)) as Array<{ content: string }>;
    for (const v of vers) expect(v.content).not.toContain(SECRET);
    // El contenido compartido sigue en su tabla.
    expect((await getSyncedBlock(owner.id, syncedId))?.[0]?.content).toContain(SECRET);
  });

  it('editar adentro del sincronizado desde la página que lo pega lo actualiza en todos lados', async () => {
    const { owner, asOwner, host, src, syncedId } = await setup();
    session.user = asOwner;
    const load = async (id: string) =>
      (await (await pageRoute.GET(req(`http://x/api/docs/pages/${id}`), { params: Promise.resolve({ id }) })).json()) as { content: DocsBlock[]; updated_at: string };
    const save = (id: string, content: DocsBlock[], base: string) =>
      pageRoute.PATCH(req(`http://x/api/docs/pages/${id}`, 'PATCH', { content, base_updated_at: base }), { params: Promise.resolve({ id }) });
    // El origen abierto en otra pestaña antes del cambio.
    const srcSeen = await load(src.id);
    const seen = await load(host.id);
    expect(seen.content.map((b) => b.content)).toEqual(['Hola equipo', '', `Sueldos ${SECRET} 2027`]);
    const res = await save(host.id, seen.content.map((b) => (b.id === 'c' ? { ...b, content: 'Sueldos 2028' } : b)), seen.updated_at);
    expect(res.status).toBe(200);
    expect((await getSyncedBlock(owner.id, syncedId))?.map((b) => b.content)).toEqual(['Sueldos 2028']);
    expect((await load(src.id)).content.map((b) => b.content)).toEqual(['', 'Sueldos 2028']);
    // La pestaña vieja del origen guarda con la copia de antes: no pisa lo editado.
    const stale = [...srcSeen.content, para('z', 'Nota nueva')];
    expect((await save(src.id, stale, srcSeen.updated_at)).status).toBe(200);
    expect((await getSyncedBlock(owner.id, syncedId))?.map((b) => b.content)).toEqual(['Sueldos 2028']);
  });
});

describe('Docs: lo de un sincronizado sin acceso no se filtra (dueña vs Bob)', () => {
  it('editor, polling en vivo y export', async () => {
    const { asOwner, asBob, host } = await setup();
    const ctx = { params: Promise.resolve({ id: host.id }) };
    session.user = asBob;
    const page = await (await pageRoute.GET(req(`http://x/api/docs/pages/${host.id}`), ctx)).text();
    expect(page).not.toContain(SECRET);
    const live = await (await liveRoute.POST(req(`http://x/api/docs/pages/${host.id}/live`, 'POST', { session: 'sess-bob-1', since: '2000-01-01T00:00:00.000Z' }), ctx)).text();
    expect(live).toContain('Hola equipo');
    expect(live).not.toContain(SECRET);
    const md = await (await exportRoute.GET(req(`http://x/api/docs/pages/${host.id}/export?format=md`), ctx)).text();
    expect(md).toContain('Hola equipo');
    expect(md).not.toContain(SECRET);
    session.user = asOwner;
    expect(await (await exportRoute.GET(req(`http://x/api/docs/pages/${host.id}/export?format=md`), ctx)).text()).toContain(SECRET);
  });

  it('historial de versiones: ver una versión (y restaurarla) no muestra ni pisa el sincronizado', async () => {
    const { owner, asOwner, asBob, host, syncedId } = await setup();
    await saveDocVersion(owner.id, host.id, owner.id, 'manual');
    const [v] = await listDocVersions(owner.id, host.id);
    const ctx = { params: Promise.resolve({ id: host.id, versionId: v.id }) };
    session.user = asBob;
    const res = await versionRoute.GET(req(`http://x/api/docs/pages/${host.id}/versions/${v.id}`), ctx);
    expect(res.status).toBe(200);
    const asBobVersion = (await res.json()) as { content: DocsBlock[] };
    expect(JSON.stringify(asBobVersion)).not.toContain(SECRET);
    expect(asBobVersion.content.find((b) => b.type === 'synced')?.no_access).toBe(true);
    session.user = asOwner;
    expect(await (await versionRoute.GET(req(`http://x/api/docs/pages/${host.id}/versions/${v.id}`), ctx)).text()).toContain(SECRET);
    // Restaurar no vacía el contenido compartido.
    expect(await restoreDocVersion(owner.id, host.id, v.id, owner.id)).toBe(true);
    expect((await getSyncedBlock(owner.id, syncedId))?.[0]?.content).toContain(SECRET);
  });

  it('búsqueda de Docs (⌘P y ⌘K): el texto del sincronizado no hace aparecer la página que lo pega', async () => {
    const { owner, asBob, host, src, hideBob } = await setup();
    expect(await searchDocPagesContent(owner.id, SECRET, 20, hideBob)).toEqual([]);
    // La dueña lo encuentra en su origen, no en la copia.
    const mine = await searchDocPagesContent(owner.id, SECRET, 20, []);
    expect(mine.map((h) => h.id)).toEqual([src.id]);
    expect(mine.map((h) => h.id)).not.toContain(host.id);
    session.user = asBob;
    const res = await searchRoute.GET(req(`http://x/api/docs/search?content=1&q=${SECRET}`));
    expect(JSON.stringify(await res.json())).not.toContain(host.id);
  });
});

describe('Docs: público sin sesión (centro de ayuda, widget, bot) y agentes', () => {
  it('el sincronizado cuenta solo si su origen también está publicado', async () => {
    const { owner, host, src, priv } = await setup();
    const slug = (await getDocPageRow(host.id))!.slug!;
    let article = await getHelpArticle(owner.id, slug);
    expect(JSON.stringify(article?.content)).not.toContain(SECRET);
    expect(article?.excerpt).not.toContain(SECRET);
    expect(await searchHelpArticles(owner.id, SECRET)).toEqual([]);
    const cols = await listHelpCollections(owner.id);
    expect(JSON.stringify(await withHelpExcerpts(owner.id, cols))).not.toContain(SECRET);

    const widget = await createChatWidget(owner.id, null, { name: 'Web', botEnabled: true, botSource: 'docs', helpEnabled: true } as never);
    const helpRes = await helpRoute.GET(new Request(`http://x/api/chat/help?widgetId=${widget.id}&q=${SECRET}`));
    expect(await helpRes.text()).not.toContain(SECRET);
    const helpList = await helpRoute.GET(new Request(`http://x/api/chat/help?widgetId=${widget.id}`));
    expect(await helpList.text()).not.toContain(SECRET);
    expect(JSON.stringify(await findBotReply(widget, `sueldos ${SECRET}`))).not.toContain(SECRET);
    expect(JSON.stringify(await retrieveKnowledge(widget, SECRET))).not.toContain(SECRET);
    const agent = { id: crypto.randomUUID(), knowledge: { allPublicDocs: true, docsPageIds: [host.id], cannedFromWidgetId: null } } as never;
    expect(JSON.stringify(await searchAgentKnowledge(agent, owner.id, SECRET))).not.toContain(SECRET);

    // Origen publicado (y su teamspace abierto a la IA): ahora sí cuenta.
    await updateDocPage(owner.id, src.id, { published: true }, { actorId: owner.id });
    await updateTeamspace(priv.id, { ai_knowledge: true });
    article = await getHelpArticle(owner.id, slug);
    expect(JSON.stringify(article?.content)).toContain(SECRET);
    expect((await searchHelpArticles(owner.id, SECRET)).map((r) => r.id)).toContain(host.id);
    expect(JSON.stringify(await retrieveKnowledge(widget, SECRET))).toContain(SECRET);
    expect(JSON.stringify(await searchAgentKnowledge(agent, owner.id, SECRET))).toContain(SECRET);
  });

  it('agente con páginas elegidas a mano: el origen cuenta solo si también está elegido', async () => {
    const { owner, host, src, priv } = await setup();
    await updateDocPage(owner.id, host.id, { published: false, is_public: false }, { actorId: owner.id });
    await updateTeamspace(priv.id, { ai_knowledge: true });
    const only = { id: crypto.randomUUID(), knowledge: { allPublicDocs: false, docsPageIds: [host.id], cannedFromWidgetId: null } } as never;
    const out = await searchAgentKnowledge(only, owner.id, 'Hola equipo');
    expect(JSON.stringify(out)).toContain('Hola equipo');
    expect(JSON.stringify(out)).not.toContain(SECRET);
    const both = { id: crypto.randomUUID(), knowledge: { allPublicDocs: false, docsPageIds: [host.id, src.id], cannedFromWidgetId: null } } as never;
    expect(JSON.stringify(await searchAgentKnowledge(both, owner.id, SECRET))).toContain(SECRET);
  });
});

describe('Docs: migración 094 (copias que ya estaban guardadas)', () => {
  it('saca la copia de páginas, versiones, revisiones y plantillas, y no pierde contenido', async () => {
    const owner = await makeUser('own');
    const page = await createDocPage(owner.id, { title: 'Vieja' });
    const orphan = `sync-${crypto.randomUUID().slice(0, 12)}`;
    const legacy = JSON.stringify([para('a', 'Intro'), { id: 's', type: 'synced', content: '', synced_id: orphan }, para('c', `Copia ${SECRET}`, 1), para('d', 'Fin')]);
    const db = getDb();
    await db.prepare('UPDATE docs_pages SET content = ?, synced_base = NULL WHERE id = ?').run(legacy, page.id);
    await db
      .prepare("INSERT INTO docs_versions (id, page_id, user_id, author_id, title, icon, content, kind, created_at) VALUES (?, ?, ?, NULL, 'Vieja', NULL, ?, 'manual', ?)")
      .run(crypto.randomUUID(), page.id, owner.id, legacy, new Date().toISOString());
    await db
      .prepare("INSERT INTO docs_templates (id, workspace_id, created_by, title, icon, description, content, created_at, updated_at) VALUES (?, ?, ?, 'T', NULL, '', ?, ?, ?)")
      .run(crypto.randomUUID(), owner.id, owner.id, legacy, new Date().toISOString(), new Date().toISOString());
    await MIGRATIONS.find((m) => m.id === '094_docs_synced_refs')!.up(getClient());
    const row = (await getDocPageRow(page.id))!;
    expect(row.content).not.toContain(SECRET);
    expect(JSON.parse(row.content).map((b: DocsBlock) => b.id)).toEqual(['a', 's', 'd']);
    expect(row.synced_base).toContain(SECRET);
    for (const table of ['docs_versions', 'docs_templates']) {
      const rows = (await db.prepare(`SELECT content FROM ${table} WHERE content LIKE ?`).all(`%${orphan}%`)) as Array<{ content: string }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.content).not.toContain(SECRET);
    }
    // Sin fila en docs_synced_blocks: se crea con la copia (la página se sigue viendo igual).
    expect((await getSyncedBlock(owner.id, orphan))?.[0]?.content).toContain(SECRET);
  });
});
