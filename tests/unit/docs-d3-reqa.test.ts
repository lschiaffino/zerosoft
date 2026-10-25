import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createDocPage, deleteDocPage, getDocAccess, getDocPageRow, updateDocPage } from '@/lib/docs';
import { createTeamspace, deleteTeamspace, hiddenTeamspaceIds, listTeamspaces, setTeamspaceMember } from '@/lib/docs-access';
import { getHelpArticle } from '@/lib/docs-help';
import { getSyncedBlock } from '@/lib/docs-synced';
import { listWorkspaceDatabases } from '@/lib/docs-db-server';
import { buildNewItems } from '@/components/app/sidebar-nav';
import { addMember, createTeam } from '@/lib/teams';
import type { DocsBlock, DocsDatabase } from '@/lib/docs-types';
import { makeUser } from './helpers';

/** Re-QA de D3: fallar cerrado sin origen, IDOR de plantillas, bases, guardados viejos, teamspaces borrados y mover. */

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
const templatesRoute = await import('@/app/api/docs/templates/route');
const syncedRoute = await import('@/app/api/docs/synced/[id]/route');

function req(url: string, method = 'GET', body?: unknown) {
  const r = new Request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return Object.assign(r, { cookies: { get: () => undefined }, nextUrl: new URL(url) }) as never;
}
const para = (id: string, content: string, indent = 0): DocsBlock => ({ id, type: 'paragraph', content, ...(indent ? { indent } : {}) });
const SECRET = 'granatecuota';

async function setup() {
  const owner = await makeUser('own');
  const bob = await makeUser('bob');
  const team = await createTeam(owner.id, 'Equipo');
  await addMember(team.id, bob.id, 'member');
  const asOwner: FakeUser = { id: owner.id, email: owner.email, name: owner.name };
  const asBob: FakeUser = { id: owner.id, email: owner.email, actingUser: { id: bob.id, email: bob.email, name: bob.name }, role: 'member', team };
  const priv = await createTeamspace(owner.id, owner.id, { name: 'Dirección', access: 'private' });
  const syncedId = `sync-${crypto.randomUUID().slice(0, 12)}`;
  const synced: DocsBlock[] = [{ id: 's', type: 'synced', content: '', synced_id: syncedId }, para('c', `Sueldos ${SECRET}`, 1)];
  const src = await createDocPage(owner.id, { title: 'Origen', teamspace_id: priv.id });
  await updateDocPage(owner.id, src.id, { content: synced }, { actorId: owner.id });
  const host = await createDocPage(owner.id, { title: 'Pública' });
  await updateDocPage(owner.id, host.id, { content: [para('a', 'Hola'), ...synced], published: true }, { actorId: owner.id });
  return { owner, bob, asOwner, asBob, priv, src, host, syncedId, synced };
}
const load = async (id: string) =>
  (await (await pageRoute.GET(req(`http://x/api/docs/pages/${id}`), { params: Promise.resolve({ id }) })).json()) as { content: DocsBlock[]; updated_at: string };

beforeEach(() => {
  session.user = null;
});

describe('Sin página de origen: falla cerrado', () => {
  it('borrar para siempre el origen no deja el contenido a la vista (Bob, público y copiar)', async () => {
    const { owner, asOwner, asBob, src, host, syncedId } = await setup();
    await updateDocPage(owner.id, src.id, { archived: true });
    expect(await deleteDocPage(owner.id, src.id)).toBe(true);
    // Ninguna otra página del teamspace privado lo usa: queda sin origen.
    expect(((await getDb().prepare('SELECT source_page_id FROM docs_synced_blocks WHERE id = ?').get(syncedId)) as { source_page_id: string | null }).source_page_id).toBeNull();
    session.user = asBob;
    const seen = await load(host.id);
    expect(JSON.stringify(seen)).not.toContain(SECRET);
    expect(seen.content.find((b) => b.type === 'synced')?.no_access).toBe(true);
    expect((await syncedRoute.GET(req(`http://x/api/docs/synced/${syncedId}`), { params: Promise.resolve({ id: syncedId }) })).status).toBe(404);
    const article = await getHelpArticle(owner.id, (await getDocPageRow(host.id))!.slug!);
    expect(JSON.stringify(article)).not.toContain(SECRET);
    // El dueño del workspace sí.
    session.user = asOwner;
    expect(JSON.stringify(await load(host.id))).toContain(SECRET);
  });

  it('aunque otra página del mismo teamspace lo use, no se reasigna: queda sin origen', async () => {
    const { owner, asBob, priv, src, host, synced, syncedId } = await setup();
    const sibling = await createDocPage(owner.id, { title: 'Otra privada', teamspace_id: priv.id });
    await updateDocPage(owner.id, sibling.id, { content: synced }, { actorId: owner.id });
    await updateDocPage(owner.id, src.id, { archived: true });
    await deleteDocPage(owner.id, src.id);
    expect(((await getDb().prepare('SELECT source_page_id FROM docs_synced_blocks WHERE id = ?').get(syncedId)) as { source_page_id: string | null }).source_page_id).toBeNull();
    session.user = asBob;
    expect(JSON.stringify(await load(host.id))).not.toContain(SECRET);
    // Ni el centro de ayuda (la página que lo pega está publicada).
    expect(JSON.stringify(await getHelpArticle(owner.id, (await getDocPageRow(host.id))!.slug!))).not.toContain(SECRET);
  });
});

describe('Plantillas del workspace (IDOR)', () => {
  it('no se guarda como plantilla una página que no se puede abrir', async () => {
    const { owner, asBob, src } = await setup();
    session.user = asBob;
    const res = await templatesRoute.POST(req('http://x/api/docs/templates', 'POST', { page_id: src.id }));
    expect(res.status).toBe(404);
    const n = (await getDb().prepare('SELECT COUNT(*) AS c FROM docs_templates WHERE workspace_id = ?').get(owner.id)) as { c: number };
    expect(Number(n.c)).toBe(0);
  });

  it('la plantilla guarda los sincronizados como referencia', async () => {
    const { owner, asOwner, host } = await setup();
    session.user = asOwner;
    expect((await templatesRoute.POST(req('http://x/api/docs/templates', 'POST', { page_id: host.id }))).status).toBe(201);
    const row = (await getDb().prepare('SELECT content FROM docs_templates WHERE workspace_id = ?').get(owner.id)) as { content: string };
    expect(row.content).not.toContain(SECRET);
  });
});

describe('Bases del workspace', () => {
  it('el selector no lista bases de teamspaces ocultos', async () => {
    const { owner, bob, priv, team } = { ...(await setup()), team: null };
    void team;
    const db: DocsDatabase = { title: 'Sueldos base', properties: [{ id: 'n', name: 'Name', type: 'title' }], rows: [], views: [{ id: 'v', name: '', type: 'table' }] };
    await createDocPage(owner.id, { title: 'Privada con base', teamspace_id: priv.id, content: [{ id: 'db1', type: 'database', content: '', db } as DocsBlock] });
    await createDocPage(owner.id, { title: 'Pública con base', content: [{ id: 'db2', type: 'database', content: '', db: { ...db, title: 'Tareas base' } } as DocsBlock] });
    const asBob = { id: owner.id, actingUser: { id: bob.id, email: bob.email } as never, role: 'member' as const };
    const titles = (await listWorkspaceDatabases(asBob)).map((d) => d.title);
    expect(titles).toContain('Tareas base');
    expect(titles).not.toContain('Sueldos base');
    expect((await listWorkspaceDatabases({ id: owner.id })).map((d) => d.title)).toContain('Sueldos base');
  });
});

describe('Guardado viejo en la página que pega el sincronizado', () => {
  it('NEW1/NEW2: una pestaña vieja de la página que lo pega no pisa lo editado en el origen', async () => {
    const { owner, asOwner, host, src, syncedId } = await setup();
    session.user = asOwner;
    const save = (id: string, content: DocsBlock[], base: string) =>
      pageRoute.PATCH(req(`http://x/api/docs/pages/${id}`, 'PATCH', { content, base_updated_at: base }), { params: Promise.resolve({ id }) });
    const old = await load(host.id);
    // NEW1: desde la página que lo pega.
    const r1 = await save(host.id, old.content.map((b) => (b.id === 'c' ? { ...b, content: 'NEW1' } : b)), old.updated_at);
    expect(r1.status).toBe(200);
    // NEW2: desde el origen.
    const s = await load(src.id);
    await save(src.id, s.content.map((b) => (b.content === 'NEW1' ? { ...b, content: 'NEW2' } : b)), s.updated_at);
    expect((await getSyncedBlock(owner.id, syncedId))?.[0]?.content).toBe('NEW2');
    expect((await load(host.id)).content.find((b) => b.id === 'c')?.content).toBe('NEW2');
    // La versión que vio el editor no queda guardada en la página.
    expect((await getDocPageRow(host.id))!.content).not.toContain('synced_at');
    // La pestaña vieja (antes de NEW1) agrega un párrafo y guarda sobre su base.
    await save(host.id, [...old.content, para('late', 'tarde')], old.updated_at);
    expect((await getSyncedBlock(owner.id, syncedId))?.[0]?.content).toBe('NEW2');
    expect((await load(host.id)).content.map((b) => b.content)).toContain('tarde');
    // Y si la pestaña vieja sí cambió el sincronizado (otro bloque), se fusiona.
    const tab = await load(host.id);
    await save(src.id, (await load(src.id)).content.concat([para('d', 'del origen', 1)]), (await load(src.id)).updated_at);
    const at = tab.content.findIndex((b) => b.content === 'NEW2');
    await save(host.id, [...tab.content.slice(0, at + 1), para('e', 'de la host', 1), ...tab.content.slice(at + 1)], tab.updated_at);
    const final = (await getSyncedBlock(owner.id, syncedId))!.map((b) => b.content);
    expect(final).toEqual(expect.arrayContaining(['NEW2', 'del origen', 'de la host']));
  });

  it('el pulso en vivo trae la página si cambió un sincronizado que contiene', async () => {
    const { owner, asOwner, host, src } = await setup();
    session.user = asOwner;
    const ctx = { params: Promise.resolve({ id: host.id }) };
    const pulse = async (syncedAt: string | null) =>
      (await (await liveRoute.POST(req(`http://x/api/docs/pages/${host.id}/live`, 'POST', { session: 'tab-host-1', since: (await getDocPageRow(host.id))!.updated_at, synced_at: syncedAt }), ctx)).json()) as {
        synced_at: string;
        page: unknown;
      };
    const first = await pulse(null);
    expect(first.page).toBeNull();
    expect((await pulse(first.synced_at)).page).toBeNull();
    const s = await load(src.id);
    await updateDocPage(owner.id, src.id, { content: s.content.map((b) => (b.id === 'c' ? { ...b, content: 'Cambiado en origen' } : b)), base_updated_at: s.updated_at }, { actorId: owner.id });
    const after = await pulse(first.synced_at);
    expect(after.synced_at).not.toBe(first.synced_at);
    expect(JSON.stringify(after.page)).toContain('Cambiado en origen');
  });
});

describe('Borrar un teamspace privado', () => {
  it('sus páginas van a la papelera y no quedan visibles para el workspace', async () => {
    const { owner, bob, priv, src } = await setup();
    await setTeamspaceMember(priv.id, owner.id, 'owner');
    expect(await deleteTeamspace(priv.id)).toBe('trash');
    const row = (await getDocPageRow(src.id))!;
    expect(row.archived).toBe(1);
    expect(row.teamspace_id).toBe(priv.id);
    const asBob = { id: owner.id, actingUser: { id: bob.id, email: bob.email } as never, role: 'member' as const };
    expect(await getDocAccess(row, asBob)).toBeNull();
    expect(await hiddenTeamspaceIds(owner.id, bob.id)).toContain(priv.id);
    expect((await listTeamspaces(owner.id, owner.id)).map((t) => t.id)).not.toContain(priv.id);
  });

  it('uno abierto: sus páginas quedan en el workspace', async () => {
    const owner = await makeUser('own');
    const open = await createTeamspace(owner.id, owner.id, { name: 'Abierto', access: 'open' });
    const p = await createDocPage(owner.id, { title: 'En abierto', teamspace_id: open.id });
    expect(await deleteTeamspace(open.id)).toBe('workspace');
    const row = (await getDocPageRow(p.id))!;
    expect(row.archived).toBe(0);
    expect(row.teamspace_id).toBeNull();
  });
});

describe('Mover y "+ Nuevo"', () => {
  it('PATCH parent_id exige poder editar el destino', async () => {
    const { owner, asBob } = await setup();
    const mine = await createDocPage(owner.id, { title: 'De Bob' });
    const target = await createDocPage(owner.id, { title: 'Solo lectura' });
    await updateDocPage(owner.id, target.id, { member_role: 'view' });
    session.user = asBob;
    const res = await pageRoute.PATCH(req(`http://x/api/docs/pages/${mine.id}`, 'PATCH', { parent_id: target.id }), { params: Promise.resolve({ id: mine.id }) });
    expect([403, 404]).toContain(res.status);
    expect((await getDocPageRow(mine.id))!.parent_id).toBeNull();
  });

  it('sin permiso de crear en Docs, el "+ Nuevo" no ofrece página', () => {
    const labels = new Proxy({}, { get: (_t, k) => (k === 'notes' || k === 'board' ? new Proxy({}, { get: () => 'x' }) : String(k)) }) as never;
    expect(buildNewItems('docs', labels, { docsCanCreate: false })).toEqual([]);
    expect(buildNewItems('home', labels, { docsCanCreate: false }).some((i) => i.href.startsWith('/app/docs'))).toBe(false);
    expect(buildNewItems('docs', labels).length).toBe(1);
  });
});

describe('Un guardado nunca "adopta" un sincronizado ajeno', () => {
  const row = async (id: string) =>
    (await getDb().prepare('SELECT source_page_id, content FROM docs_synced_blocks WHERE id = ?').get(id)) as { source_page_id: string | null; content: string } | undefined;

  it('origen null (borrado con el código viejo): ni Bob ni la dueña lo pasan a la página que guarda', async () => {
    const { owner, asOwner, asBob, host, syncedId } = await setup();
    await getDb().prepare('UPDATE docs_synced_blocks SET source_page_id = NULL WHERE id = ?').run(syncedId);
    const save = (content: DocsBlock[], base: string) =>
      pageRoute.PATCH(req(`http://x/api/docs/pages/${host.id}`, 'PATCH', { content, base_updated_at: base }), { params: Promise.resolve({ id: host.id }) });
    session.user = asBob;
    let seen = await load(host.id);
    expect(JSON.stringify(seen)).not.toContain(SECRET);
    // Bob guarda la página (e inventa hijos adentro del sincronizado).
    const at = seen.content.findIndex((b) => b.type === 'synced');
    await save([...seen.content.slice(0, at + 1), para('x', 'Pisado por Bob', 1), ...seen.content.slice(at + 1), para('b', 'de Bob')], seen.updated_at);
    expect((await row(syncedId))!.source_page_id).toBeNull();
    expect((await row(syncedId))!.content).toContain(SECRET);
    // La dueña la guarda también: el contenido sigue sin origen.
    session.user = asOwner;
    seen = await load(host.id);
    await save([...seen.content, para('o', 'de la dueña')], seen.updated_at);
    expect((await row(syncedId))!.source_page_id).toBeNull();
    session.user = asBob;
    expect(JSON.stringify(await load(host.id))).not.toContain(SECRET);
    void owner;
  });

  it('fila inexistente: el guardado de la página que ya lo tenía no crea la fila ni escribe hijos', async () => {
    const { asOwner, asBob, host, syncedId } = await setup();
    await getDb().prepare('DELETE FROM docs_synced_blocks WHERE id = ?').run(syncedId);
    for (const who of [asBob, asOwner]) {
      session.user = who;
      const seen = await load(host.id);
      const at = seen.content.findIndex((b) => b.type === 'synced');
      await pageRoute.PATCH(
        req(`http://x/api/docs/pages/${host.id}`, 'PATCH', {
          content: [...seen.content.slice(0, at + 1), para('x', `reclamo ${SECRET}`, 1), ...seen.content.slice(at + 1)],
          base_updated_at: seen.updated_at,
        }),
        { params: Promise.resolve({ id: host.id }) },
      );
      expect(await row(syncedId)).toBeUndefined();
    }
    session.user = asBob;
    expect(JSON.stringify(await load(host.id))).not.toContain(SECRET);
  });

  it('un bloque sincronizado nuevo de la página sí crea su fila con esa página de origen', async () => {
    const owner = await makeUser('own');
    session.user = { id: owner.id, email: owner.email };
    const page = await createDocPage(owner.id, { title: 'Nueva' });
    const sid = `sync-${crypto.randomUUID().slice(0, 12)}`;
    const base = (await getDocPageRow(page.id))!.updated_at;
    await pageRoute.PATCH(req(`http://x/api/docs/pages/${page.id}`, 'PATCH', { content: [{ id: 's', type: 'synced', content: '', synced_id: sid }, para('c', 'Mío', 1)], base_updated_at: base }), {
      params: Promise.resolve({ id: page.id }),
    });
    expect((await row(sid))?.source_page_id).toBe(page.id);
  });

  it('migración 094: con origen null no cambia el origen; sin fila y varias páginas, queda sin origen', async () => {
    const { MIGRATIONS } = await import('@/lib/schema/migrations');
    const { getClient } = await import('@/lib/db');
    const owner = await makeUser('own');
    const a = await createDocPage(owner.id, { title: 'A' });
    const b = await createDocPage(owner.id, { title: 'B' });
    const nullSrc = `sync-${crypto.randomUUID().slice(0, 12)}`;
    const missing = `sync-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    await getDb().prepare("INSERT INTO docs_synced_blocks (id, workspace_id, source_page_id, content, created_at, updated_at) VALUES (?, ?, NULL, '[]', ?, ?)").run(nullSrc, owner.id, now, now);
    const legacy = (sid: string) => JSON.stringify([{ id: 's', type: 'synced', content: '', synced_id: sid }, para('c', `Copia ${SECRET}`, 1)]);
    // A tiene uno con origen null y uno sin fila; B también usa el que no tiene fila.
    const renamed = (list: DocsBlock[], suffix: string) => list.map((x) => ({ ...x, id: `${x.id}${suffix}` }));
    await getDb().prepare('UPDATE docs_pages SET content = ? WHERE id = ?').run(JSON.stringify([...JSON.parse(legacy(nullSrc)), ...renamed(JSON.parse(legacy(missing)), 'm')]), a.id);
    await getDb().prepare('UPDATE docs_pages SET content = ? WHERE id = ?').run(legacy(missing), b.id);
    await MIGRATIONS.find((m) => m.id === '094_docs_synced_refs')!.up(getClient());
    expect((await row(nullSrc))!.source_page_id).toBeNull();
    expect((await row(nullSrc))!.content).toBe('[]');
    expect((await row(missing))!.source_page_id).toBeNull();
  });
});

describe('Re-QA 2: editar sincronizados, versiones y teamspaces restaurados', () => {
  /** Origen en un teamspace abierto donde los miembros solo ven; la página que lo pega es editable. */
  async function viewOnly() {
    const owner = await makeUser('own');
    const bob = await makeUser('bob');
    const team = await createTeam(owner.id, 'Equipo');
    await addMember(team.id, bob.id, 'member');
    const asBob: FakeUser = { id: owner.id, email: owner.email, actingUser: { id: bob.id, email: bob.email, name: bob.name }, role: 'member', team };
    const asOwner: FakeUser = { id: owner.id, email: owner.email };
    const ts = await createTeamspace(owner.id, owner.id, { name: 'Lectura', access: 'open', member_role: 'view' });
    const sid = `sync-${crypto.randomUUID().slice(0, 12)}`;
    const synced: DocsBlock[] = [{ id: 's', type: 'synced', content: '', synced_id: sid }, para('c', 'Política oficial', 1)];
    const src = await createDocPage(owner.id, { title: 'Políticas', teamspace_id: ts.id });
    await updateDocPage(owner.id, src.id, { content: synced }, { actorId: owner.id });
    const host = await createDocPage(owner.id, { title: 'Editable' });
    await updateDocPage(owner.id, host.id, { content: [para('a', 'Hola'), ...synced] }, { actorId: owner.id });
    return { owner, bob, asBob, asOwner, sid, src, host };
  }
  const save = (id: string, content: DocsBlock[], base: string) =>
    pageRoute.PATCH(req(`http://x/api/docs/pages/${id}`, 'PATCH', { content, base_updated_at: base }), { params: Promise.resolve({ id }) });

  it('quien solo ve el origen no edita el sincronizado desde una página editable (y el editor lo muestra en lectura)', async () => {
    const { owner, asBob, sid, host } = await viewOnly();
    session.user = asBob;
    const seen = await load(host.id);
    const syncedBlock = seen.content.find((b) => b.type === 'synced')!;
    expect(syncedBlock.no_edit).toBe(true);
    expect(syncedBlock.no_access).toBeUndefined();
    const res = await save(host.id, seen.content.map((b) => (b.id === 'c' ? { ...b, content: 'DEFACED by bob' } : b)).concat([para('b', 'de Bob')]), seen.updated_at);
    expect(res.status).toBe(200);
    expect((await getSyncedBlock(owner.id, sid))?.[0]?.content).toBe('Política oficial');
    expect((await load(host.id)).content.map((b) => b.content)).toContain('de Bob');
    // Pegarlo en una página suya sigue siendo una referencia (en lectura), no una copia editable.
    const mine = await createDocPage(owner.id, { title: 'De Bob' });
    const m = await load(mine.id);
    await save(mine.id, [...m.content, syncedBlock, para('x', 'DEFACED', 1)], m.updated_at);
    expect((await getSyncedBlock(owner.id, sid))?.[0]?.content).toBe('Política oficial');
    expect((await getDocPageRow(mine.id))!.content).toContain(sid);
  });

  it('la dueña (puede editar el origen) sí edita desde la página que lo pega', async () => {
    const { owner, asOwner, sid, host } = await viewOnly();
    session.user = asOwner;
    const seen = await load(host.id);
    expect(seen.content.find((b) => b.type === 'synced')!.no_edit).toBeUndefined();
    await save(host.id, seen.content.map((b) => (b.id === 'c' ? { ...b, content: 'Política 2' } : b)), seen.updated_at);
    expect((await getSyncedBlock(owner.id, sid))?.[0]?.content).toBe('Política 2');
  });

  it('sin synced_at, con uno inválido o futuro, el bloque cuenta como sin cambios', async () => {
    const { owner, asOwner, sid, host } = await viewOnly();
    session.user = asOwner;
    for (const at of [undefined, 'no-es-fecha', '2999-01-01T00:00:00.000Z']) {
      const seen = await load(host.id);
      const content = seen.content.map((b) => {
        if (b.type === 'synced') {
          const { synced_at: _x, ...rest } = b;
          void _x;
          return at ? { ...rest, synced_at: at } : rest;
        }
        return b.id === 'c' ? { ...b, content: `Pisado ${at}` } : b;
      });
      await save(host.id, content, seen.updated_at);
      expect((await getSyncedBlock(owner.id, sid))?.[0]?.content).toBe('Política oficial');
    }
  });

  it('el pulso en vivo no cuenta sincronizados que quien pregunta no ve', async () => {
    const { owner, asBob, host, src } = await setup();
    session.user = asBob;
    const ctx = { params: Promise.resolve({ id: host.id }) };
    const pulse = async () =>
      (await (await liveRoute.POST(req(`http://x/api/docs/pages/${host.id}/live`, 'POST', { session: 'tab-bob-live', since: (await getDocPageRow(host.id))!.updated_at, synced_at: 'x' }), ctx)).json()) as {
        synced_at: string;
        page: unknown;
      };
    const before = await pulse();
    expect(before.synced_at).toBe('');
    const s = (await (async () => {
      session.user = { id: owner.id, email: owner.email };
      return load(src.id);
    })());
    await updateDocPage(owner.id, src.id, { content: s.content.map((b) => (b.id === 'c' ? { ...b, content: 'Cambio privado' } : b)), base_updated_at: s.updated_at }, { actorId: owner.id });
    session.user = asBob;
    expect((await pulse()).synced_at).toBe('');
  });

  it('restaurar una página de un teamspace privado borrado restaura el teamspace', async () => {
    const { owner, bob, priv, src } = await setup();
    await deleteTeamspace(priv.id);
    await updateDocPage(owner.id, src.id, { archived: false });
    expect((await listTeamspaces(owner.id, owner.id)).map((t) => t.id)).toContain(priv.id);
    const asBob = { id: owner.id, actingUser: { id: bob.id, email: bob.email } as never, role: 'member' as const };
    expect(await getDocAccess((await getDocPageRow(src.id))!, asBob)).toBeNull();
  });
});
