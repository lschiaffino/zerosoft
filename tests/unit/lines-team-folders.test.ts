import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { addMember, createTeam } from '@/lib/teams';
import { createApiKey } from '@/lib/api-auth';
import { latestLiveId, livePoll } from '@/lib/wa-live';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { groupsViewer, linesLiveViewer } from '@/lib/groups-access';
import { chatFoldersFor, createFolder, deleteFolder, listFolders, moveChatsToFolder, setLineAccess, teamFoldersFor, updateFolder } from '@/lib/groups-lines';
import { getOperation, type Operation } from '@/lib/mcp/catalog';
import { invokeOperation } from '@/lib/mcp/invoke';
import type { McpCaller } from '@/lib/mcp/caller';
import migration from '@/lib/schema/migration-files/20261120_0036_lines_team_folders';
import { asMember, asOwner } from './access-helpers';
import { makeUser } from './helpers';

/**
 * Lines: carpetas del equipo junto a las de cada persona. Las del equipo las
 * ve todo el workspace y las administran los admins; poner un chat en una es
 * para todos y lo puede hacer cualquiera que edita el chat; nunca muestran ni
 * cuentan chats de una línea que la persona no ve. Las personales siguen
 * siendo privadas. Nombres, teléfonos y textos inventados.
 */

const session = vi.hoisted(() => ({ user: null as SessionUser | null, real: false }));
vi.mock('@/lib/session', async (orig) => {
  const mod = (await orig()) as { getCurrentUser: () => Promise<SessionUser | null> };
  return { ...mod, getCurrentUser: async () => (session.real ? mod.getCurrentUser() : session.user) };
});
vi.mock('next-auth', async (orig) => ({ ...(await orig<object>()), getServerSession: async () => null }));

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_PUSH_FAKE', '1');
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

/**
 * Un workspace con Ana, Beto y Dani (members), Carla (admin) y dos líneas: "Pública" y "Privada" (restringida a
 * Ana y Beto: Dani no la ve).
 */
async function world(label: string) {
  const owner = await makeUser(`${label}-ws`);
  const ana = await makeUser(`${label}-ana`);
  const beto = await makeUser(`${label}-beto`);
  const carla = await makeUser(`${label}-carla`);
  const dani = await makeUser(`${label}-dani`);
  const team = await createTeam(owner.id, 'Workspace');
  for (const u of [ana, beto, dani]) await addMember(team.id, u.id, 'member');
  await addMember(team.id, carla.id, 'admin');
  const pub = await line(owner.id, 'Pública');
  const priv = await line(owner.id, 'Privada');
  await ingestEvents(pub, [msg('5491100000401@c.us', `${label}-P1`, 'Cliente Uno'), msg('5491100000402@c.us', `${label}-P2`, 'Cliente Dos')]);
  await ingestEvents(priv, [msg('5491100000403@c.us', `${label}-S1`, 'Cliente Tres')]);
  await setLineAccess(owner.id, priv.id, { ownerId: null, visibility: 'restricted', personIds: [ana.id, beto.id], teamIds: [] });
  const chats = (await listChats(owner.id, owner.id)).rows;
  const by = (name: string) => chats.find((c) => c.name === name)!;
  return {
    ws: owner.id,
    owner,
    ana,
    beto,
    carla,
    dani,
    team,
    uno: by('Cliente Uno'),
    dos: by('Cliente Dos'),
    tres: by('Cliente Tres'),
    vAna: await groupsViewer(owner.id, ana.id, 'member'),
    vBeto: await groupsViewer(owner.id, beto.id, 'member'),
    vDani: await groupsViewer(owner.id, dani.id, 'member'),
    vCarla: await groupsViewer(owner.id, carla.id, 'admin'),
    vOwner: await groupsViewer(owner.id, owner.id, 'owner'),
  };
}

const admin = { admin: true };
const member = { admin: false };
const names = (rows: Array<{ name: string }>) => rows.map((f) => f.name).sort();

describe('Lines: carpetas del equipo', () => {
  it('solo admins y el dueño crean, renombran, mueven y borran las del equipo; todos las ven', async () => {
    const w = await world('tf-crud');
    const ventas = await createFolder(w.ws, w.carla.id, { name: 'Ventas', team: true }, admin);
    expect(ventas.kind).toBe('team');
    const norte = await createFolder(w.ws, w.owner.id, { name: 'Norte', parentId: ventas.id, team: true }, admin);
    // Hasta MAX_FOLDER_DEPTH niveles, como las personales.
    const n3 = await createFolder(w.ws, w.carla.id, { name: 'Nivel 3', parentId: norte.id, team: true }, admin);
    await expect(createFolder(w.ws, w.carla.id, { name: 'Nivel 4', parentId: n3.id, team: true }, admin)).rejects.toMatchObject({ code: 'too_deep' });
    await expect(createFolder(w.ws, w.carla.id, { name: 'ventas', team: true }, admin)).rejects.toMatchObject({ code: 'duplicate_folder' });

    for (const v of [w.vAna, w.vBeto, w.vDani, w.vCarla, w.vOwner]) {
      const res = await listFolders(w.ws, v.me, v);
      expect(names(res.team)).toEqual(['Nivel 3', 'Norte', 'Ventas']);
      // Ninguna aparece entre las personales de nadie.
      expect(res.folders).toEqual([]);
    }

    // Un member no las administra: 403 (las ve, así que no es 404).
    await expect(createFolder(w.ws, w.ana.id, { name: 'Mía del equipo', team: true }, member)).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    await expect(createFolder(w.ws, w.ana.id, { name: 'Sub', parentId: ventas.id, team: true }, member)).rejects.toMatchObject({ status: 403 });
    // Tampoco cuelga una carpeta suya de una del equipo.
    await expect(createFolder(w.ws, w.ana.id, { name: 'Sub', parentId: ventas.id }, member)).rejects.toMatchObject({ code: 'invalid_parent' });
    await expect(updateFolder(w.ws, w.ana.id, ventas.id, { name: 'Robada' }, member)).rejects.toMatchObject({ status: 403 });
    await expect(updateFolder(w.ws, w.ana.id, norte.id, { parentId: null }, member)).rejects.toMatchObject({ status: 403 });
    await expect(deleteFolder(w.ws, w.ana.id, ventas.id, member)).rejects.toMatchObject({ status: 403 });
    // Sin decir quién es (las funciones viejas sin actor) tampoco.
    await expect(updateFolder(w.ws, w.ana.id, ventas.id, { name: 'Robada' })).rejects.toMatchObject({ status: 403 });

    // Un admin sí: renombra y mueve dentro de las del equipo.
    await updateFolder(w.ws, w.carla.id, ventas.id, { name: 'Ventas AR' }, admin);
    await updateFolder(w.ws, w.carla.id, n3.id, { parentId: ventas.id }, admin);
    const after = (await listFolders(w.ws, w.dani.id, w.vDani)).team;
    expect(after.find((f) => f.id === ventas.id)?.name).toBe('Ventas AR');
    expect(after.find((f) => f.id === n3.id)?.parentId).toBe(ventas.id);
    // Una personal no se puede meter en una del equipo (ni al revés).
    const personal = await createFolder(w.ws, w.carla.id, { name: 'Personal de Carla' }, admin);
    await expect(updateFolder(w.ws, w.carla.id, personal.id, { parentId: ventas.id }, admin)).rejects.toMatchObject({ status: 400 });
    await expect(updateFolder(w.ws, w.carla.id, norte.id, { parentId: personal.id }, admin)).rejects.toMatchObject({ status: 400 });
    expect(await deleteFolder(w.ws, w.owner.id, ventas.id, admin)).toBe(true);
    expect((await listFolders(w.ws, w.ana.id, w.vAna)).team).toEqual([]);
    // La personal de Carla sigue y nadie más la ve.
    expect(names((await listFolders(w.ws, w.carla.id, w.vCarla)).folders)).toEqual(['Personal de Carla']);
    expect((await listFolders(w.ws, w.ana.id, w.vAna)).folders).toEqual([]);
  });

  it('cualquiera que edita el chat lo pone en una del equipo, y lo ven todos; además puede estar en una personal', async () => {
    const w = await world('tf-file');
    const ventas = await createFolder(w.ws, w.carla.id, { name: 'Ventas', team: true }, admin);
    const norte = await createFolder(w.ws, w.carla.id, { name: 'Norte', parentId: ventas.id, team: true }, admin);
    expect(await moveChatsToFolder(w.ws, w.vAna, [w.uno.id], ventas.id)).toEqual({ updated: 1, failed: 0 });
    expect(await moveChatsToFolder(w.ws, w.vDani, [w.dos.id], norte.id)).toEqual({ updated: 1, failed: 0 });
    // La personal de Ana, a la vez.
    const mia = await createFolder(w.ws, w.ana.id, { name: 'Seguir' });
    await moveChatsToFolder(w.ws, w.vAna, [w.uno.id], mia.id);

    for (const v of [w.vAna, w.vBeto, w.vDani, w.vCarla, w.vOwner]) {
      const rows = (await listChats(w.ws, v.me, { viewer: v })).rows;
      expect(rows.find((c) => c.id === w.uno.id)?.teamFolderId).toBe(ventas.id);
      expect(rows.find((c) => c.id === w.dos.id)?.teamFolderId).toBe(norte.id);
      // La carpeta del equipo incluye sus subcarpetas.
      expect((await listChats(w.ws, v.me, { viewer: v, folderId: ventas.id })).rows.map((c) => c.id).sort()).toEqual([w.uno.id, w.dos.id].sort());
      expect((await listChats(w.ws, v.me, { viewer: v, folderId: norte.id })).rows.map((c) => c.id)).toEqual([w.dos.id]);
      const team = (await listFolders(w.ws, v.me, v)).team;
      expect(team.find((f) => f.id === ventas.id)).toMatchObject({ chats: 1, unread: 2 });
      expect(team.find((f) => f.id === norte.id)).toMatchObject({ chats: 1, unread: 1 });
      // La personal de Ana: solo para ella.
      expect(rows.find((c) => c.id === w.uno.id)?.folderId).toBe(v.me === w.ana.id ? mia.id : null);
    }
    // "Sin carpeta": los que no están en ninguna (ni suya ni del equipo).
    expect((await listChats(w.ws, w.beto.id, { viewer: w.vBeto, folderId: 'none' })).rows.map((c) => c.id)).toEqual([w.tres.id]);
    expect((await listFolders(w.ws, w.beto.id, w.vBeto)).unfiled.chats).toBe(1);
    expect((await listFolders(w.ws, w.owner.id, w.vOwner)).unfiled.chats).toBe(1);
    // Sacarlo de la del equipo no lo saca de la personal, y al revés.
    await moveChatsToFolder(w.ws, w.vBeto, [w.uno.id], null, { kind: 'team' });
    expect(await teamFoldersFor(w.ws, [w.uno.id])).toEqual(new Map());
    expect(await chatFoldersFor(w.ws, w.ana.id, [w.uno.id])).toEqual(new Map([[w.uno.id, mia.id]]));
    await moveChatsToFolder(w.ws, w.vAna, [w.uno.id], ventas.id);
    await moveChatsToFolder(w.ws, w.vAna, [w.uno.id], null);
    expect(await teamFoldersFor(w.ws, [w.uno.id])).toEqual(new Map([[w.uno.id, ventas.id]]));
    expect(await chatFoldersFor(w.ws, w.ana.id, [w.uno.id])).toEqual(new Map());
    // "all" (soltar en "Sin carpeta") saca de las dos.
    await moveChatsToFolder(w.ws, w.vAna, [w.uno.id], mia.id);
    await moveChatsToFolder(w.ws, w.vAna, [w.uno.id], null, { kind: 'all' });
    expect(await teamFoldersFor(w.ws, [w.uno.id])).toEqual(new Map());
    expect(await chatFoldersFor(w.ws, w.ana.id, [w.uno.id])).toEqual(new Map());
    // Nada de esto escribió la columna de antes.
    expect(((await getDb().prepare('SELECT COUNT(*) AS n FROM groups_chats WHERE user_id = ? AND folder_id IS NOT NULL').get(w.ws)) as { n: number }).n).toBe(0);
  });

  it('quien no ve una línea no ve ni cuenta sus chats en una carpeta del equipo, ni los puede poner ahí', async () => {
    const w = await world('tf-access');
    const ventas = await createFolder(w.ws, w.carla.id, { name: 'Ventas', team: true }, admin);
    expect(await moveChatsToFolder(w.ws, w.vAna, [w.uno.id, w.tres.id], ventas.id)).toEqual({ updated: 2, failed: 0 });
    expect((await listFolders(w.ws, w.ana.id, w.vAna)).team[0]).toMatchObject({ chats: 2, unread: 2 });
    expect((await listFolders(w.ws, w.dani.id, w.vDani)).team[0]).toMatchObject({ chats: 1, unread: 1 });
    expect((await listChats(w.ws, w.dani.id, { viewer: w.vDani, folderId: ventas.id })).rows.map((c) => c.id)).toEqual([w.uno.id]);
    expect((await listChats(w.ws, w.dani.id, { viewer: w.vDani })).rows.map((c) => c.id)).not.toContain(w.tres.id);
    // "Sin carpeta" de Dani tampoco cuenta lo que no ve.
    expect((await listFolders(w.ws, w.dani.id, w.vDani)).unfiled).toMatchObject({ chats: 1 });
    // Ni sacarlo ni ponerlo: cuenta como fallido y no se toca.
    expect(await moveChatsToFolder(w.ws, w.vDani, [w.tres.id], null, { kind: 'team' })).toEqual({ updated: 0, failed: 1 });
    expect(await teamFoldersFor(w.ws, [w.tres.id])).toEqual(new Map([[w.tres.id, ventas.id]]));
  });

  it('borrar una del equipo la saca para todos y deja las carpetas personales como estaban', async () => {
    const w = await world('tf-delete');
    const ventas = await createFolder(w.ws, w.carla.id, { name: 'Ventas', team: true }, admin);
    const norte = await createFolder(w.ws, w.carla.id, { name: 'Norte', parentId: ventas.id, team: true }, admin);
    const mia = await createFolder(w.ws, w.beto.id, { name: 'Mía' });
    await moveChatsToFolder(w.ws, w.vBeto, [w.uno.id], ventas.id);
    await moveChatsToFolder(w.ws, w.vBeto, [w.dos.id], norte.id);
    await moveChatsToFolder(w.ws, w.vBeto, [w.uno.id, w.dos.id], mia.id);
    await expect(deleteFolder(w.ws, w.beto.id, ventas.id, member)).rejects.toMatchObject({ status: 403 });
    expect(await deleteFolder(w.ws, w.carla.id, ventas.id, admin)).toBe(true);
    expect(await teamFoldersFor(w.ws, [w.uno.id, w.dos.id])).toEqual(new Map());
    expect((await listFolders(w.ws, w.beto.id, w.vBeto)).team).toEqual([]);
    expect((await listFolders(w.ws, w.beto.id, w.vBeto)).folders).toMatchObject([{ id: mia.id, chats: 2 }]);
    expect(await chatFoldersFor(w.ws, w.beto.id, [w.uno.id, w.dos.id])).toEqual(
      new Map([
        [w.uno.id, mia.id],
        [w.dos.id, mia.id],
      ]),
    );
    // Los chats siguen ahí.
    expect((await listChats(w.ws, w.beto.id, { viewer: w.vBeto })).rows).toHaveLength(3);
  });

  it('las personales siguen siendo privadas: una del equipo no abre las de nadie', async () => {
    const w = await world('tf-private');
    await createFolder(w.ws, w.carla.id, { name: 'Ventas', team: true }, admin);
    const deAna = await createFolder(w.ws, w.ana.id, { name: 'De Ana' });
    await moveChatsToFolder(w.ws, w.vAna, [w.uno.id], deAna.id);
    for (const v of [w.vBeto, w.vCarla, w.vOwner]) {
      expect((await listFolders(w.ws, v.me, v)).folders).toEqual([]);
      expect((await listChats(w.ws, v.me, { viewer: v, folderId: deAna.id })).rows).toEqual([]);
      await expect(moveChatsToFolder(w.ws, v, [w.dos.id], deAna.id)).rejects.toMatchObject({ status: 404 });
      await expect(updateFolder(w.ws, v.me, deAna.id, { name: 'X' }, admin)).rejects.toMatchObject({ status: 404 });
      expect(await deleteFolder(w.ws, v.me, deAna.id, admin)).toBe(false);
    }
  });

  it('otro workspace no recibe nada', async () => {
    const w = await world('tf-ws');
    const ventas = await createFolder(w.ws, w.carla.id, { name: 'Ventas', team: true }, admin);
    await moveChatsToFolder(w.ws, w.vAna, [w.uno.id], ventas.id);
    const stranger = await makeUser('tf-ws-stranger');
    const vStranger = await groupsViewer(stranger.id, stranger.id, 'owner');
    expect(await listFolders(stranger.id, stranger.id, vStranger)).toEqual({ folders: [], team: [], unfiled: { unread: 0, chats: 0 } });
    await expect(updateFolder(stranger.id, stranger.id, ventas.id, { name: 'X' }, admin)).rejects.toMatchObject({ status: 404 });
    await expect(moveChatsToFolder(stranger.id, vStranger, [w.uno.id], ventas.id)).rejects.toMatchObject({ status: 404 });
    expect(await deleteFolder(stranger.id, stranger.id, ventas.id, admin)).toBe(false);
    expect((await listChats(stranger.id, stranger.id, { viewer: vStranger, folderId: ventas.id })).rows).toEqual([]);
    expect(await teamFoldersFor(stranger.id, [w.uno.id])).toEqual(new Map());
  });

  it('el aviso en vivo de la carpeta del equipo llega a todos los que ven el chat; el de una personal, solo a esa persona', async () => {
    const w = await world('tf-live');
    const ventas = await createFolder(w.ws, w.carla.id, { name: 'Ventas', team: true }, admin);
    const viewers = { ana: linesLiveViewer(w.vAna), beto: linesLiveViewer(w.vBeto), dani: linesLiveViewer(w.vDani), owner: linesLiveViewer(w.vOwner) };
    const chatsSince = async (who: keyof typeof viewers, cursor: number) => (await livePoll(viewers[who], cursor)).events.map((e) => e.chatId);
    let cursor = await latestLiveId(viewers.owner);
    await moveChatsToFolder(w.ws, w.vAna, [w.uno.id], ventas.id);
    for (const who of ['ana', 'beto', 'dani', 'owner'] as const) expect(await chatsSince(who, cursor)).toEqual([w.uno.id]);
    // Un chat de la línea privada: Dani no se entera.
    cursor = await latestLiveId(viewers.owner);
    await moveChatsToFolder(w.ws, w.vAna, [w.tres.id], ventas.id);
    for (const who of ['ana', 'beto', 'owner'] as const) expect(await chatsSince(who, cursor)).toEqual([w.tres.id]);
    expect(await chatsSince('dani', cursor)).toEqual([]);
    // Borrarla avisa a todos los que ven sus chats.
    cursor = await latestLiveId(viewers.owner);
    await deleteFolder(w.ws, w.carla.id, ventas.id, admin);
    expect((await chatsSince('beto', cursor)).sort()).toEqual([w.uno.id, w.tres.id].sort());
    expect(await chatsSince('dani', cursor)).toEqual([w.uno.id]);
    // Una personal: solo a esa persona.
    const mia = await createFolder(w.ws, w.ana.id, { name: 'Mía' });
    cursor = await latestLiveId(viewers.owner);
    await moveChatsToFolder(w.ws, w.vAna, [w.dos.id], mia.id);
    expect(await chatsSince('ana', cursor)).toEqual([w.dos.id]);
    for (const who of ['beto', 'dani', 'owner'] as const) expect(await chatsSince(who, cursor)).toEqual([]);
  });

  it('por las rutas: un member ve las del equipo y pone chats, pero crear, renombrar o borrar es 403', async () => {
    const w = await world('tf-routes');
    const folders = await import('@/app/api/groups/folders/route');
    const bulk = await import('@/app/api/groups/chats/bulk/route');
    const chats = await import('@/app/api/groups/chats/route');
    const chat = await import('@/lib/routes/groups/chats/[id]/route');
    const req = (method: string, body?: unknown, query = '') =>
      new Request(`http://localhost/api/groups/folders${query}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const move = (ids: string[], folderId: string | null, scope?: string) =>
      bulk.POST(new Request('http://localhost/api/groups/chats/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids, action: 'folder', folderId, scope }) }));
    const list = async (query: string) =>
      (await (await chats.GET(new Request(`http://localhost/api/groups/chats${query}`))).json()) as { rows: Array<{ id: string; folderId: string | null; teamFolderId?: string | null }> };
    type Folders = { folders: Array<{ id: string }>; team: Array<{ id: string; name: string; chats: number }>; canManageTeam: boolean };
    const get = async () => (await (await folders.GET(req('GET'))).json()) as Folders;

    session.user = asMember(w.owner, w.carla, 'admin');
    const made = await folders.POST(req('POST', { name: 'Ventas', team: true }));
    expect(made.status).toBe(201);
    const ventas = ((await made.json()) as { id: string; kind: string }).id;
    expect((await folders.POST(req('POST', { name: 'Norte', team: true, parentId: ventas }))).status).toBe(201);
    expect((await get()).canManageTeam).toBe(true);

    session.user = asMember(w.owner, w.ana);
    const forAna = await get();
    expect(forAna.canManageTeam).toBe(false);
    expect(forAna.team.map((f) => f.name).sort()).toEqual(['Norte', 'Ventas']);
    expect(forAna.folders).toEqual([]);
    expect((await folders.POST(req('POST', { name: 'Otra', team: true }))).status).toBe(403);
    expect((await folders.PATCH(req('PATCH', { id: ventas, name: 'Robada' }))).status).toBe(403);
    expect((await folders.DELETE(req('DELETE', undefined, `?id=${ventas}`))).status).toBe(403);
    // Poner chats sí (como cambiar las etiquetas del chat).
    expect((await move([w.uno.id], ventas)).status).toBe(200);
    expect((await list(`?folder=${ventas}`)).rows.map((c) => c.id)).toEqual([w.uno.id]);
    const patched = await chat.PATCH(
      new Request(`http://localhost/api/groups/chats/${w.dos.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamFolderId: ventas }) }),
      { params: Promise.resolve({ id: w.dos.id }) },
    );
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { teamFolderId: string | null }).teamFolderId).toBe(ventas);

    // Beto lo ve igual; Dani no ve el chat de la línea privada aunque Ana lo ponga ahí.
    await moveChatsToFolder(w.ws, w.vAna, [w.tres.id], ventas);
    session.user = asMember(w.owner, w.beto);
    expect((await get()).team.find((f) => f.id === ventas)?.chats).toBe(3);
    expect((await list('')).rows.find((c) => c.id === w.uno.id)?.teamFolderId).toBe(ventas);
    session.user = asMember(w.owner, w.dani);
    expect((await get()).team.find((f) => f.id === ventas)?.chats).toBe(2);
    expect((await list(`?folder=${ventas}`)).rows.map((c) => c.id).sort()).toEqual([w.uno.id, w.dos.id].sort());
    expect((await move([w.tres.id], null, 'team')).status).toBe(200);
    expect(await teamFoldersFor(w.ws, [w.tres.id])).toEqual(new Map([[w.tres.id, ventas]]));
    // teamFolderId con una carpeta personal (o de otra persona) es 404.
    session.user = asMember(w.owner, w.ana);
    const personal = ((await (await folders.POST(req('POST', { name: 'Mía' }))).json()) as { id: string }).id;
    const wrong = await chat.PATCH(
      new Request(`http://localhost/api/groups/chats/${w.dos.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamFolderId: personal }) }),
      { params: Promise.resolve({ id: w.dos.id }) },
    );
    expect(wrong.status).toBe(404);

    // El dueño borra: los chats salen de ella y la personal de Ana sigue.
    await move([w.uno.id], personal);
    session.user = asOwner(w.owner);
    expect((await folders.DELETE(req('DELETE', undefined, `?id=${ventas}`))).status).toBe(200);
    session.user = asMember(w.owner, w.ana);
    expect((await get()).team).toEqual([]);
    expect((await list('')).rows.find((c) => c.id === w.uno.id)).toMatchObject({ folderId: personal, teamFolderId: null });
    // Otro workspace.
    session.user = asOwner(await makeUser('tf-routes-stranger'));
    expect((await get()).team).toEqual([]);
  });

  it('por el MCP: la identidad delegada ve las del equipo; sin ser admin no las administra', async () => {
    const w = await world('tf-mcp');
    const ventas = await createFolder(w.ws, w.carla.id, { name: 'Ventas', team: true }, admin);
    session.real = true;
    const outer = new Request('http://localhost/api/mcp');
    const caller = (personId: string): McpCaller =>
      ({ kind: 'oauth', personId, teamId: w.team.id, canWrite: true, clientId: 'c', clientName: 'Test', grantId: `g-${personId}`, apiKeyId: null, rateKey: `mcp:${personId}` }) as McpCaller;
    const run = async (personId: string, id: string, args: Record<string, unknown>) => {
      const r = await invokeOperation(outer, caller(personId), getOperation(id) as Operation, args, { confirm: true });
      return { ok: r.ok, status: r.status, data: r.data as Record<string, unknown> };
    };
    const forBeto = await run(w.beto.id, 'groups.folders.list', {});
    expect((forBeto.data.team as Array<{ name: string }>).map((f) => f.name)).toEqual(['Ventas']);
    expect(forBeto.data.canManageTeam).toBe(false);
    expect(await run(w.beto.id, 'groups.folders.update', { body: { id: ventas.id, name: 'Robada' } })).toMatchObject({ ok: false, status: 403 });
    expect(await run(w.beto.id, 'groups.folders.delete', { query: { id: ventas.id } })).toMatchObject({ ok: false, status: 403 });
    expect(await run(w.beto.id, 'groups.folders.create', { body: { name: 'Otra', team: true } })).toMatchObject({ ok: false, status: 403 });
    expect(await run(w.beto.id, 'groups.chats.bulk', { body: { ids: [w.uno.id], action: 'folder', folderId: ventas.id } })).toMatchObject({ ok: true });
    const inFolder = await run(w.dani.id, 'groups.chats.list', { query: { folder: ventas.id } });
    expect((inFolder.data.rows as Array<{ id: string }>).map((c) => c.id)).toEqual([w.uno.id]);
    expect(await run(w.carla.id, 'groups.folders.update', { body: { id: ventas.id, name: 'Ventas AR' } })).toMatchObject({ ok: true });
    session.real = false;
    expect((await listFolders(w.ws, w.ana.id, w.vAna)).team[0]).toMatchObject({ name: 'Ventas AR', chats: 1 });
  });

  it('API v1: cada key trae la carpeta del equipo de los chats que ve', async () => {
    const w = await world('tf-v1');
    const ventas = await createFolder(w.ws, w.carla.id, { name: 'Ventas', team: true }, admin);
    await moveChatsToFolder(w.ws, w.vAna, [w.uno.id, w.tres.id], ventas.id);
    const route = await import('@/app/api/v1/groups/chats/route');
    const rows = async (ws: string, personId: string) => {
      const { key } = await createApiKey(ws, `k-${personId}`, personId);
      const res = await route.GET(new Request('http://localhost/api/v1/groups/chats', { headers: { authorization: `Bearer ${key}` } }));
      expect(res.status).toBe(200);
      return ((await res.json()) as { data: Array<{ id: string; teamFolderId?: string | null }> }).data;
    };
    for (const person of [w.ana.id, w.beto.id, w.ws]) {
      const list = await rows(w.ws, person);
      expect(list.find((c) => c.id === w.uno.id)?.teamFolderId).toBe(ventas.id);
      expect(list.find((c) => c.id === w.tres.id)?.teamFolderId).toBe(ventas.id);
    }
    const forDani = await rows(w.ws, w.dani.id);
    expect(forDani.find((c) => c.id === w.uno.id)?.teamFolderId).toBe(ventas.id);
    expect(forDani.map((c) => c.id)).not.toContain(w.tres.id);
    const stranger = await makeUser('tf-v1-stranger');
    expect(await rows(stranger.id, stranger.id)).toEqual([]);
  });
});

describe('Lines: la migración de carpetas del equipo', () => {
  it('solo agrega: las carpetas que había quedan personales, con sus chats; repetirla no cambia nada', async () => {
    const w = await world('tf-mig');
    const mia = await createFolder(w.ws, w.ana.id, { name: 'Mía' });
    await moveChatsToFolder(w.ws, w.vAna, [w.uno.id], mia.id);
    const ventas = await createFolder(w.ws, w.carla.id, { name: 'Ventas', team: true }, admin);
    await moveChatsToFolder(w.ws, w.vAna, [w.dos.id], ventas.id);
    const snapshot = async () => ({
      folders: await getDb().prepare('SELECT id, owner_id, scope, name FROM groups_folders WHERE user_id = ? ORDER BY id').all(w.ws),
      personal: await getDb().prepare('SELECT person_id, chat_id, folder_id FROM groups_chat_folders WHERE user_id = ? ORDER BY chat_id').all(w.ws),
      team: await getDb().prepare('SELECT chat_id, folder_id FROM groups_chat_team_folders WHERE user_id = ? ORDER BY chat_id').all(w.ws),
    });
    const before = await snapshot();
    expect(before.folders).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: mia.id, owner_id: w.ana.id, scope: 'personal' }), expect.objectContaining({ id: ventas.id, owner_id: '', scope: 'team' })]),
    );
    const db = getDb();
    const client = { execute: async (sql: string) => void (await db.prepare(sql).run()) } as unknown as Parameters<typeof migration.up>[0];
    await migration.up(client);
    await migration.up(client);
    expect(await snapshot()).toEqual(before);
  });
});
