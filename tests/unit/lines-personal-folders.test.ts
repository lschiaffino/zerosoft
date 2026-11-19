import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { groupsViewer } from '@/lib/groups-access';
import { chatFoldersFor, createFolder, deleteFolder, folderScope, listFolders, moveChatsToFolder, setLineAccess, updateFolder } from '@/lib/groups-lines';
import {
  addMessage,
  applyThreadAction,
  createAccount,
  createFolder as createInboxFolder,
  deleteFolder as deleteInboxFolder,
  folderOverview,
  listFolders as listInboxFolders,
  listThreads,
  listThreadsPage,
  moveFolder as moveInboxFolder,
  reorderFolders,
  updateFolder as updateInboxFolder,
  upsertThread,
  type AccountRow,
} from '@/lib/inbox/core';
import { addThreadsToFolder } from '@/lib/inbox/import';
import { getOperation, type Operation } from '@/lib/mcp/catalog';
import { invokeOperation } from '@/lib/mcp/invoke';
import type { McpCaller } from '@/lib/mcp/caller';
import migration from '@/lib/schema/migration-files/20261119_1737_lines_personal_folders';
import { asMember, asOwner } from './access-helpers';
import { makeUser } from './helpers';

/**
 * Las carpetas de chats son de cada persona, en Lines y en Inbox: nadie ve las
 * de otra, ni dónde puso un chat, por ninguna vía (funciones, rutas, MCP).
 * Nombres, teléfonos y textos inventados.
 */

// `real: true` deja pasar a la sesión de verdad (la identidad delegada del MCP); si no, la sesión es `user`.
const session = vi.hoisted(() => ({ user: null as SessionUser | null, real: false }));
vi.mock('@/lib/session', async (orig) => {
  const mod = (await orig()) as { getCurrentUser: () => Promise<SessionUser | null> };
  return { ...mod, getCurrentUser: async () => (session.real ? mod.getCurrentUser() : session.user) };
});
vi.mock('next-auth', async (orig) => ({ ...(await orig<object>()), getServerSession: async () => null }));

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_PUSH_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  session.user = null;
  session.real = false;
});

const msg = (chatId: string, id: string, senderName: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: false,
  fromMe: false,
  senderPhone: chatId.split('@')[0],
  senderName,
  providerMessageId: id,
  body: 'hola',
});

async function line(ws: string, label: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name: label });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

/** Un workspace con Ana y Beto (members), Carla (admin) y dos líneas: "Pública" y "Privada" (restringida a Ana y Beto). */
async function world(label: string) {
  const owner = await makeUser(`${label}-ws`);
  const ana = await makeUser(`${label}-ana`);
  const beto = await makeUser(`${label}-beto`);
  const carla = await makeUser(`${label}-carla`);
  const team = await createTeam(owner.id, 'Workspace');
  for (const u of [ana, beto]) await addMember(team.id, u.id, 'member');
  await addMember(team.id, carla.id, 'admin');
  const pub = await line(owner.id, 'Pública');
  const priv = await line(owner.id, 'Privada');
  await ingestEvents(pub, [msg('5491100000301@c.us', `${label}-P1`, 'Cliente Uno'), msg('5491100000302@c.us', `${label}-P2`, 'Cliente Dos')]);
  await ingestEvents(priv, [msg('5491100000303@c.us', `${label}-S1`, 'Cliente Tres')]);
  await setLineAccess(owner.id, priv.id, { ownerId: null, visibility: 'restricted', personIds: [ana.id, beto.id], teamIds: [] });
  const chats = (await listChats(owner.id, owner.id)).rows;
  const by = (name: string) => chats.find((c) => c.name === name)!;
  return {
    owner,
    ana,
    beto,
    carla,
    team,
    pub,
    priv,
    uno: by('Cliente Uno'),
    dos: by('Cliente Dos'),
    tres: by('Cliente Tres'),
    vAna: await groupsViewer(owner.id, ana.id, 'member'),
    vBeto: await groupsViewer(owner.id, beto.id, 'member'),
    vCarla: await groupsViewer(owner.id, carla.id, 'admin'),
    vOwner: await groupsViewer(owner.id, owner.id, 'owner'),
  };
}

const names = (r: { folders: Array<{ name: string }> }) => r.folders.map((f) => f.name);
const folderName = async (id: string) => ((await getDb().prepare('SELECT name FROM groups_folders WHERE id = ?').get(id)) as { name: string } | undefined)?.name;

describe('Lines: las carpetas son de cada persona', () => {
  it('nadie ve, cuenta, renombra, mueve ni borra la carpeta de otra persona, tampoco un admin ni el dueño', async () => {
    const w = await world('pf-own');
    const ws = w.owner.id;
    const clientes = await createFolder(ws, w.ana.id, { name: 'Clientes' });
    const vip = await createFolder(ws, w.ana.id, { name: 'VIP', parentId: clientes.id });
    await moveChatsToFolder(ws, w.vAna, [w.uno.id], clientes.id);
    await moveChatsToFolder(ws, w.vAna, [w.tres.id], vip.id);

    expect(names(await listFolders(ws, w.ana.id, w.vAna))).toEqual(['Clientes', 'VIP']);
    for (const other of [w.vBeto, w.vCarla, w.vOwner]) {
      const mine = await listFolders(ws, other.me, other);
      expect(mine.folders).toEqual([]);
      // Para los demás esos chats están sin carpeta.
      expect(mine.unfiled).toEqual({ chats: 3, unread: 3 });
      expect(await folderScope(ws, other.me, clientes.id)).toEqual([]);
      // Filtrar por una carpeta ajena no trae nada (como una que no existe), y los chats van sin carpeta.
      expect((await listChats(ws, other.me, { viewer: other, folderId: clientes.id })).rows).toEqual([]);
      expect((await listChats(ws, other.me, { viewer: other, folderId: 'none' })).rows).toHaveLength(3);
      expect((await listChats(ws, other.me, { viewer: other })).rows.every((c) => c.folderId === null)).toBe(true);
      // Renombrar, mover, crear adentro, mover chats adentro y borrar: como un id que no existe.
      await expect(updateFolder(ws, other.me, clientes.id, { name: 'Robada' })).rejects.toMatchObject({ code: 'not_found', status: 404 });
      await expect(updateFolder(ws, other.me, vip.id, { parentId: null })).rejects.toMatchObject({ status: 404 });
      await expect(createFolder(ws, other.me, { name: 'Adentro', parentId: clientes.id })).rejects.toMatchObject({ code: 'invalid_parent' });
      await expect(moveChatsToFolder(ws, other, [w.dos.id], clientes.id)).rejects.toMatchObject({ code: 'not_found', status: 404 });
      expect(await deleteFolder(ws, other.me, clientes.id)).toBe(false);
      // Sacar "su" carpeta de un chat no toca la de Ana.
      await moveChatsToFolder(ws, other, [w.uno.id], null);
    }
    const forAna = await listFolders(ws, w.ana.id, w.vAna);
    expect(forAna.folders.map((f) => [f.name, f.chats, f.unread])).toEqual([
      ['Clientes', 1, 2],
      ['VIP', 1, 1],
    ]);
    expect(forAna.unfiled).toEqual({ chats: 1, unread: 1 });
    expect((await listChats(ws, w.ana.id, { viewer: w.vAna, folderId: clientes.id })).rows.map((c) => c.name).sort()).toEqual(['Cliente Tres', 'Cliente Uno']);
    expect(await folderName(clientes.id)).toBe('Clientes');
    // El mismo nombre en dos personas no choca.
    await expect(createFolder(ws, w.beto.id, { name: 'Clientes' })).resolves.toMatchObject({ name: 'Clientes' });
    await expect(createFolder(ws, w.ana.id, { name: 'clientes' })).rejects.toMatchObject({ code: 'duplicate_folder' });
  });

  it('el mismo chat va en una carpeta distinta para cada persona, o en ninguna', async () => {
    const w = await world('pf-same');
    const ws = w.owner.id;
    const deAna = await createFolder(ws, w.ana.id, { name: 'Clientes' });
    const deBeto = await createFolder(ws, w.beto.id, { name: 'Urgentes' });
    expect(await moveChatsToFolder(ws, w.vAna, [w.uno.id], deAna.id)).toEqual({ updated: 1, failed: 0 });
    expect(await moveChatsToFolder(ws, w.vBeto, [w.uno.id], deBeto.id)).toEqual({ updated: 1, failed: 0 });
    const folderOf = async (me: string, viewer: typeof w.vAna) => (await listChats(ws, me, { viewer })).rows.find((c) => c.id === w.uno.id)?.folderId;
    expect(await folderOf(w.ana.id, w.vAna)).toBe(deAna.id);
    expect(await folderOf(w.beto.id, w.vBeto)).toBe(deBeto.id);
    expect(await folderOf(w.carla.id, w.vCarla)).toBeNull();
    expect((await listFolders(ws, w.ana.id, w.vAna)).folders[0]).toMatchObject({ name: 'Clientes', chats: 1 });
    expect((await listFolders(ws, w.beto.id, w.vBeto)).folders[0]).toMatchObject({ name: 'Urgentes', chats: 1 });
    // Beto lo saca de la suya: en la de Ana sigue.
    await moveChatsToFolder(ws, w.vBeto, [w.uno.id], null);
    expect(await folderOf(w.beto.id, w.vBeto)).toBeNull();
    expect(await folderOf(w.ana.id, w.vAna)).toBe(deAna.id);
    // Beto borra su carpeta: lo de Ana no cambia.
    await moveChatsToFolder(ws, w.vBeto, [w.uno.id], deBeto.id);
    expect(await deleteFolder(ws, w.beto.id, deBeto.id)).toBe(true);
    expect(await chatFoldersFor(ws, w.ana.id, [w.uno.id])).toEqual(new Map([[w.uno.id, deAna.id]]));
    expect(await chatFoldersFor(ws, w.beto.id, [w.uno.id])).toEqual(new Map());
  });

  it('quien pierde el acceso a una línea no ve el chat ni su conteo en su propia carpeta', async () => {
    const w = await world('pf-lost');
    const ws = w.owner.id;
    const f = await createFolder(ws, w.ana.id, { name: 'Clientes' });
    await moveChatsToFolder(ws, w.vAna, [w.uno.id, w.tres.id], f.id);
    expect((await listFolders(ws, w.ana.id, w.vAna)).folders[0]).toMatchObject({ chats: 2, unread: 2 });
    // La línea privada deja de ser de Ana.
    await setLineAccess(ws, w.priv.id, { ownerId: null, visibility: 'restricted', personIds: [w.beto.id], teamIds: [] });
    const after = await listFolders(ws, w.ana.id, w.vAna);
    expect(after.folders[0]).toMatchObject({ chats: 1, unread: 1 });
    expect(after.unfiled).toEqual({ chats: 1, unread: 1 });
    expect((await listChats(ws, w.ana.id, { viewer: w.vAna, folderId: f.id })).rows.map((c) => c.name)).toEqual(['Cliente Uno']);
    // Tampoco puede mover a su carpeta un chat que ya no ve.
    await moveChatsToFolder(ws, w.vAna, [w.tres.id], null);
    expect(await moveChatsToFolder(ws, w.vAna, [w.tres.id], f.id)).toEqual({ updated: 0, failed: 1 });
    // Borrar su carpeta sigue pudiendo, aunque adentro haya quedado un chat que no ve.
    expect(await deleteFolder(ws, w.ana.id, f.id)).toBe(true);
  });

  it('otro workspace no recibe nada', async () => {
    const w = await world('pf-ws');
    const f = await createFolder(w.owner.id, w.ana.id, { name: 'Clientes' });
    await moveChatsToFolder(w.owner.id, w.vAna, [w.uno.id], f.id);
    const stranger = await makeUser('pf-ws-stranger');
    const vStranger = await groupsViewer(stranger.id, stranger.id, 'owner');
    expect(await listFolders(stranger.id, stranger.id, vStranger)).toEqual({ folders: [], unfiled: { unread: 0, chats: 0 } });
    // Ni siquiera la propia Ana desde otro workspace.
    expect((await listFolders(stranger.id, w.ana.id, await groupsViewer(stranger.id, w.ana.id, 'member'))).folders).toEqual([]);
    await expect(updateFolder(stranger.id, stranger.id, f.id, { name: 'X' })).rejects.toMatchObject({ status: 404 });
    await expect(moveChatsToFolder(stranger.id, vStranger, [w.uno.id], f.id)).rejects.toMatchObject({ status: 404 });
    expect(await deleteFolder(stranger.id, stranger.id, f.id)).toBe(false);
    expect((await listChats(stranger.id, stranger.id, { viewer: vStranger, folderId: f.id })).rows).toEqual([]);
  });

  it('por las rutas: cada sesión trabaja solo con sus carpetas', async () => {
    const w = await world('pf-routes');
    const folders = await import('@/app/api/groups/folders/route');
    const bulk = await import('@/app/api/groups/chats/bulk/route');
    const chats = await import('@/app/api/groups/chats/route');
    const chat = await import('@/lib/routes/groups/chats/[id]/route');
    const req = (method: string, body?: unknown, query = '') =>
      new Request(`http://localhost/api/groups/folders${query}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const move = (ids: string[], folderId: string | null) =>
      bulk.POST(new Request('http://localhost/api/groups/chats/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids, action: 'folder', folderId }) }));
    const list = async (query: string) => (await (await chats.GET(new Request(`http://localhost/api/groups/chats${query}`))).json()) as { rows: Array<{ id: string; folderId: string | null }> };

    session.user = asMember(w.owner, w.ana);
    const made = (await (await folders.POST(req('POST', { name: 'Clientes' }))).json()) as { id: string };
    expect((await move([w.uno.id], made.id)).status).toBe(200);
    expect((await list(`?folder=${made.id}`)).rows.map((c) => c.id)).toEqual([w.uno.id]);

    for (const user of [asMember(w.owner, w.beto), asMember(w.owner, w.carla, 'admin'), asOwner(w.owner)]) {
      session.user = user;
      expect(((await (await folders.GET(req('GET'))).json()) as { folders: unknown[] }).folders).toEqual([]);
      expect((await folders.PATCH(req('PATCH', { id: made.id, name: 'Robada' }))).status).toBe(404);
      expect((await folders.POST(req('POST', { name: 'Adentro', parentId: made.id }))).status).toBe(400);
      expect((await folders.DELETE(req('DELETE', undefined, `?id=${made.id}`))).status).toBe(404);
      expect((await move([w.dos.id], made.id)).status).toBe(404);
      expect((await list(`?folder=${made.id}`)).rows).toEqual([]);
      expect((await list('')).rows.every((c) => c.folderId === null)).toBe(true);
      const patched = await chat.PATCH(
        new Request(`http://localhost/api/groups/chats/${w.dos.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folderId: made.id }) }),
        { params: Promise.resolve({ id: w.dos.id }) },
      );
      expect(patched.status).toBe(404);
    }

    session.user = asMember(w.owner, w.ana);
    const mine = (await (await folders.GET(req('GET'))).json()) as { folders: Array<{ id: string; name: string; chats: number }> };
    expect(mine.folders).toMatchObject([{ id: made.id, name: 'Clientes', chats: 1 }]);
    expect((await list('')).rows.find((c) => c.id === w.uno.id)?.folderId).toBe(made.id);
    // Otro workspace.
    session.user = asOwner(await makeUser('pf-routes-stranger'));
    expect((await folders.PATCH(req('PATCH', { id: made.id, name: 'X' }))).status).toBe(404);
    expect((await folders.DELETE(req('DELETE', undefined, `?id=${made.id}`))).status).toBe(404);
    session.user = null;
    expect((await folders.GET(req('GET'))).status).toBe(401);
  });

  it('por el MCP: la identidad delegada trabaja solo con las carpetas de esa persona', async () => {
    const w = await world('pf-mcp');
    const ws = w.owner.id;
    const f = await createFolder(ws, w.ana.id, { name: 'Clientes' });
    await moveChatsToFolder(ws, w.vAna, [w.uno.id], f.id);
    session.real = true;
    const outer = new Request('http://localhost/api/mcp');
    const caller = (personId: string): McpCaller =>
      ({ kind: 'oauth', personId, teamId: w.team.id, canWrite: true, clientId: 'c', clientName: 'Test', grantId: `g-${personId}`, apiKeyId: null, rateKey: `mcp:${personId}` }) as McpCaller;
    const op = (id: string) => getOperation(id) as Operation;
    const run = (personId: string, id: string, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
      invokeOperation(outer, caller(personId), op(id), args).then(
        (r) => r.data as Record<string, unknown>,
        (e: { code?: string }) => ({ failed: e.code ?? 'error' }),
      );

    const own = await run(w.ana.id, 'groups.folders.list', {});
    expect((own.folders as Array<{ name: string }>).map((x) => x.name)).toEqual(['Clientes']);
    for (const person of [w.beto.id, w.carla.id]) {
      expect((await run(person, 'groups.folders.list', {})).folders).toEqual([]);
      await run(person, 'groups.folders.update', { body: { id: f.id, name: 'Robada' } });
      await run(person, 'groups.folders.delete', { query: { id: f.id } });
      await run(person, 'groups.chats.bulk', { body: { ids: [w.dos.id], action: 'folder', folderId: f.id } });
      const filtered = await run(person, 'groups.chats.list', { query: { folder: f.id } });
      expect(filtered.rows ?? []).toEqual([]);
    }
    session.real = false;
    expect(await folderName(f.id)).toBe('Clientes');
    expect((await listFolders(ws, w.ana.id, w.vAna)).folders[0]).toMatchObject({ name: 'Clientes', chats: 1 });
    expect(await chatFoldersFor(ws, w.beto.id, [w.dos.id])).toEqual(new Map());
  });
});

describe('Lines: la migración a carpetas personales', () => {
  it('cada carpeta queda para quien la creó, con sus chats; el resto empieza sin carpetas; no borra nada y repetirla no cambia nada', async () => {
    const w = await world('pf-mig');
    const ws = w.owner.id;
    const db = getDb();
    // Como estaba antes: carpetas del workspace (sin dueño) y la carpeta en la fila del chat.
    const legacy = async (id: string, name: string, createdBy: string, parent: string | null = null) =>
      db.prepare("INSERT INTO groups_folders (id, user_id, parent_id, name, position, created_by, created_at) VALUES (?, ?, ?, ?, 0, ?, datetime('now'))").run(id, ws, parent, name, createdBy);
    const ids = { ana: `${ws}-fa`, anaSub: `${ws}-fa2`, beto: `${ws}-fb`, anon: `${ws}-fx`, gone: `${ws}-fg` };
    await legacy(ids.ana, 'De Ana', w.ana.id);
    await legacy(ids.anaSub, 'Sub de Ana', w.ana.id, ids.ana);
    await legacy(ids.beto, 'De Beto', w.beto.id);
    await legacy(ids.anon, 'Sin autor', '');
    await legacy(ids.gone, 'De alguien que ya no está', 'persona-que-no-existe');
    await db.prepare('UPDATE groups_chats SET folder_id = ? WHERE id = ?').run(ids.anaSub, w.uno.id);
    await db.prepare('UPDATE groups_chats SET folder_id = ? WHERE id = ?').run(ids.beto, w.dos.id);
    await db.prepare('UPDATE groups_chats SET folder_id = ? WHERE id = ?').run(ids.anon, w.tres.id);
    // Antes de migrar nadie las ve (no tienen dueño) y la columna de antes no se lee.
    expect((await listFolders(ws, w.ana.id, w.vAna)).folders).toEqual([]);
    expect((await listChats(ws, w.ana.id, { viewer: w.vAna })).rows.every((c) => c.folderId === null)).toBe(true);

    const client = { execute: async (sql: string) => void (await db.prepare(sql).run()) };
    const up = () => migration.up(client as unknown as Parameters<typeof migration.up>[0]);
    await up();

    const forAna = await listFolders(ws, w.ana.id, w.vAna);
    expect(forAna.folders.map((f) => [f.name, f.parentId, f.chats])).toEqual([
      ['De Ana', null, 0],
      ['Sub de Ana', ids.ana, 1],
    ]);
    expect((await listChats(ws, w.ana.id, { viewer: w.vAna, folderId: ids.ana })).rows.map((c) => c.id)).toEqual([w.uno.id]);
    const forBeto = await listFolders(ws, w.beto.id, w.vBeto);
    expect(forBeto.folders.map((f) => [f.name, f.chats])).toEqual([['De Beto', 1]]);
    // Sin autor, o de una cuenta que ya no existe: para el dueño del workspace, con sus chats.
    const forOwner = await listFolders(ws, ws, w.vOwner);
    expect(forOwner.folders.map((f) => [f.name, f.chats]).sort()).toEqual([
      ['De alguien que ya no está', 0],
      ['Sin autor', 1],
    ]);
    // Quien no había creado ninguna empieza sin carpetas, admin incluida.
    expect(await listFolders(ws, w.carla.id, w.vCarla)).toEqual({ folders: [], unfiled: { chats: 3, unread: 3 } });
    // No se borró nada: las filas y la columna de antes siguen como estaban.
    const left = (await db.prepare('SELECT id, folder_id FROM groups_chats WHERE user_id = ? AND folder_id IS NOT NULL ORDER BY id').all(ws)) as Array<{ id: string; folder_id: string }>;
    expect(left).toHaveLength(3);
    expect(((await db.prepare('SELECT COUNT(*) AS n FROM groups_folders WHERE user_id = ?').get(ws)) as { n: number }).n).toBe(5);

    // Ana mueve un chat después; correr la migración otra vez (o dos a la vez) no lo pisa ni duplica.
    await moveChatsToFolder(ws, w.vAna, [w.uno.id], ids.ana);
    await moveChatsToFolder(ws, w.vBeto, [w.dos.id], null);
    await Promise.all([up(), up()]);
    expect(await chatFoldersFor(ws, w.ana.id, [w.uno.id])).toEqual(new Map([[w.uno.id, ids.ana]]));
    expect(await chatFoldersFor(ws, w.beto.id, [w.dos.id])).toEqual(new Map());
    expect(((await db.prepare('SELECT COUNT(*) AS n FROM groups_chat_folders WHERE user_id = ?').get(ws)) as { n: number }).n).toBe(2);
  });

  it('una subcarpeta creada por otra persona queda en el primer nivel de quien la creó', async () => {
    const w = await world('pf-mig-sub');
    const ws = w.owner.id;
    const db = getDb();
    await db.prepare("INSERT INTO groups_folders (id, user_id, parent_id, name, position, created_by, created_at) VALUES (?, ?, NULL, 'De Ana', 0, ?, datetime('now'))").run(`${ws}-p`, ws, w.ana.id);
    await db.prepare("INSERT INTO groups_folders (id, user_id, parent_id, name, position, created_by, created_at) VALUES (?, ?, ?, 'De Beto adentro', 0, ?, datetime('now'))").run(`${ws}-c`, ws, `${ws}-p`, w.beto.id);
    await db.prepare('UPDATE groups_chats SET folder_id = ? WHERE id = ?').run(`${ws}-c`, w.uno.id);
    const client = { execute: async (sql: string) => void (await db.prepare(sql).run()) };
    await migration.up(client as unknown as Parameters<typeof migration.up>[0]);
    expect((await listFolders(ws, w.ana.id, w.vAna)).folders.map((f) => [f.name, f.unread])).toEqual([['De Ana', 0]]);
    expect((await listFolders(ws, w.beto.id, w.vBeto)).folders.map((f) => [f.name, f.parentId, f.chats])).toEqual([['De Beto adentro', null, 1]]);
    // Ana borra la suya: la de Beto y su chat siguen.
    expect(await deleteFolder(ws, w.ana.id, `${ws}-p`)).toBe(true);
    expect((await listFolders(ws, w.beto.id, w.vBeto)).folders.map((f) => [f.name, f.chats])).toEqual([['De Beto adentro', 1]]);
  });
});

describe('Inbox: las carpetas ya eran de cada persona', () => {
  async function inboxOwner(label: string) {
    const u = await makeUser(label);
    const account = (await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WA' })) as AccountRow;
    return { u, account };
  }
  async function thread(account: AccountRow, n: number) {
    const t = await upsertThread(account, { externalId: `54911${String(n).padStart(8, '0')}@s.whatsapp.net`, kind: 'dm', title: `Chat ${n}`, handle: `54911${String(n).padStart(8, '0')}` });
    await addMessage(t, { externalId: `m-${n}`, fromMe: false, senderName: `Chat ${n}`, body: 'hola', sentAt: new Date().toISOString() });
    return t;
  }

  it('la carpeta de otra persona es como una que no existe: ni listar, ni filtrar, ni cambiar, ni mover chats adentro', async () => {
    const a = await inboxOwner('pf-ib-a');
    const b = await inboxOwner('pf-ib-b');
    const team = await createTeam(a.u.id, 'Workspace');
    await addMember(team.id, b.u.id, 'admin');
    const ta = await thread(a.account, 1);
    const tb = await thread(b.account, 2);
    const fa = await createInboxFolder(a.u.id, { name: 'Clientes' });
    await applyThreadAction(a.u.id, [ta.id], { action: 'addFolder', folderId: fa.id });

    expect((await listInboxFolders(b.u.id)).map((f) => f.name)).toEqual([]);
    expect((await folderOverview(b.u.id)).folders).toEqual([]);
    await expect(listThreadsPage(b.u.id, { folderId: fa.id, cursor: '' })).rejects.toMatchObject({ status: 404 });
    await expect(updateInboxFolder(b.u.id, fa.id, { name: 'Robada' })).rejects.toMatchObject({ status: 404 });
    await expect(moveInboxFolder(b.u.id, fa.id, null, null)).rejects.toMatchObject({ status: 404 });
    await expect(deleteInboxFolder(b.u.id, fa.id)).rejects.toMatchObject({ status: 404 });
    await expect(createInboxFolder(b.u.id, { name: 'Adentro', parentId: fa.id })).rejects.toMatchObject({ status: 404 });
    // Ni su chat ni el de A entran a la carpeta de A de la mano de B.
    await expect(applyThreadAction(b.u.id, [tb.id], { action: 'addFolder', folderId: fa.id })).rejects.toMatchObject({ status: 404 });
    await expect(applyThreadAction(b.u.id, [ta.id], { action: 'removeFolder', folderId: fa.id })).rejects.toMatchObject({ status: 404 });
    expect(await addThreadsToFolder(b.u.id, fa.id, [tb.id, ta.id])).toMatchObject({ added: 0 });
    await reorderFolders(b.u.id, [fa.id]);
    // B tiene las suyas, con el mismo nombre si quiere, y su propio orden de chats.
    const fb = await createInboxFolder(b.u.id, { name: 'Clientes' });
    await applyThreadAction(b.u.id, [tb.id], { action: 'addFolder', folderId: fb.id });
    expect((await listThreads(b.u.id, { folderId: fb.id })).map((t) => t.id)).toEqual([tb.id]);
    // Lo de A quedó como estaba.
    const mine = await listInboxFolders(a.u.id);
    expect(mine.map((f) => [f.name, f.position])).toEqual([['Clientes', 0]]);
    expect((await listThreads(a.u.id, { folderId: fa.id })).map((t) => t.id)).toEqual([ta.id]);
    const links = (await getDb().prepare('SELECT thread_id FROM inbox_thread_folders WHERE folder_id = ?').all(fa.id)) as Array<{ thread_id: string }>;
    expect(links.map((l) => l.thread_id)).toEqual([ta.id]);
  });
});
