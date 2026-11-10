import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listMessages, listNumbers, droppedNumbers, countUnreadChats, updateChat, chatsForCrmRecord } from '@/lib/groups';
import { createTeam as createLinesTeam } from '@/lib/groups-inbox';
import { canSeeChat, canSeeNumber, chatAccessSql, groupsViewer, visibleChatIds } from '@/lib/groups-access';
import { createFolder, deleteFolder, getSelectedLine, listFolders, moveChatsToFolder, setLineAccess, setSelectedLine, updateFolder } from '@/lib/groups-lines';
import { handleRpc } from '@/lib/groups-mcp';
import { searchApps } from '@/lib/app-search';
import { fakePushes, notifyPerson, saveSubscription } from '@/lib/groups-push';
import { personCanSeeChat } from '@/lib/groups-access';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_PUSH_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

const msg = (chatId: string, id: string, body: string, senderName: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: false,
  fromMe: false,
  senderPhone: chatId.split('@')[0],
  senderName,
  providerMessageId: id,
  body,
});

async function line(ws: string, label: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name: label });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

/** Dos líneas: "Pública" (todo el workspace) y "Privada" (restringida: dueño Olga, persona Pablo y equipo Ventas). */
async function world(label: string) {
  const owner = await makeUser(`${label}-ws`);
  const olga = await makeUser(`${label}-olga`);
  const pablo = await makeUser(`${label}-pablo`);
  const vera = await makeUser(`${label}-vera`);
  const ruth = await makeUser(`${label}-ruth`);
  const intruder = await makeUser(`${label}-no`);
  const team = await createTeamFor(owner.id);
  for (const u of [olga, pablo, vera, ruth, intruder]) await addMember(team, u.id, 'member');
  const pub = await line(owner.id, 'Pública');
  const priv = await line(owner.id, 'Privada');
  await ingestEvents(pub, [msg('5491100000001@c.us', 'P-1', 'hola publico', 'Cliente Pub')]);
  await ingestEvents(priv, [msg('5491100000002@c.us', 'S-1', 'secreto del cliente', 'Cliente Priv')]);
  const sales = await createLinesTeam(owner.id, { name: 'Ventas', memberIds: [vera.id] });
  await setLineAccess(owner.id, priv.id, { ownerId: olga.id, visibility: 'restricted', personIds: [pablo.id], teamIds: [sales.id] });
  const chats = (await listChats(owner.id, owner.id)).rows;
  return { owner, olga, pablo, vera, ruth, intruder, pub, priv, pubChat: chats.find((c) => c.name === 'Cliente Pub')!, privChat: chats.find((c) => c.name === 'Cliente Priv')!, sales };
}

async function createTeamFor(ws: string): Promise<string> {
  const { createTeam } = await import('@/lib/teams');
  return (await createTeam(ws, 'Workspace')).id;
}

describe('visibilidad por línea', () => {
  it('el dueño, la persona y el equipo ven la línea; los demás miembros no ven chats ni mensajes por ninguna vía', async () => {
    const w = await world('ln-vis');
    const as = async (u: { id: string }, role: 'member' | 'admin' = 'member') => groupsViewer(w.owner.id, u.id, role);
    // Con acceso: dueño de la línea, persona elegida, miembro del equipo elegido.
    for (const u of [w.olga, w.pablo, w.vera]) {
      const v = await as(u);
      expect(await canSeeChat(v, w.privChat.id)).toBe(true);
      expect((await listChats(w.owner.id, u.id, { viewer: v })).rows.map((c) => c.name).sort()).toEqual(['Cliente Priv', 'Cliente Pub']);
    }
    // Admin y dueño del workspace siempre.
    expect(await canSeeChat(await groupsViewer(w.owner.id, w.ruth.id, 'admin'), w.privChat.id)).toBe(true);
    expect(await canSeeChat(await groupsViewer(w.owner.id, w.owner.id, 'owner'), w.privChat.id)).toBe(true);

    // Sin acceso: Ruth e intruso.
    const v = await as(w.ruth);
    expect(await canSeeChat(v, w.privChat.id)).toBe(false);
    expect(await canSeeChat(v, w.pubChat.id)).toBe(true);
    // Lista, búsqueda en mensajes, filtro por línea y conteos.
    expect((await listChats(w.owner.id, w.ruth.id, { viewer: v })).rows.map((c) => c.name)).toEqual(['Cliente Pub']);
    expect((await listChats(w.owner.id, w.ruth.id, { viewer: v, q: 'secreto' })).rows).toHaveLength(0);
    expect((await listChats(w.owner.id, w.ruth.id, { viewer: v, numberId: w.priv.id })).rows).toHaveLength(0);
    expect((await listChats(w.owner.id, w.ruth.id, { viewer: v, numberId: w.priv.id })).total).toBe(0);
    expect(await countUnreadChats(w.owner.id, v)).toBe(1);
    const visible = await visibleChatIds(v);
    expect(visible?.has(w.privChat.id)).toBe(false);
    expect(visible?.has(w.pubChat.id)).toBe(true);
    // Mensajes: la ruta pide canSeeChat antes de listMessages; el chat sigue siendo legible para el dueño.
    expect((await listMessages(w.owner.id, w.privChat.id)).length).toBeGreaterThan(0);
    // Líneas: ni la lista, ni canSeeNumber, ni el aviso de línea caída, ni la fila directa.
    expect((await listNumbers(w.owner.id, v)).map((n) => n.name)).toEqual(['Pública']);
    expect(await canSeeNumber(v, w.priv.id)).toBe(false);
    expect(await canSeeNumber(await as(w.pablo), w.priv.id)).toBe(true);
    await getDb().prepare("UPDATE groups_numbers SET status = 'disconnected' WHERE id = ?").run(w.priv.id);
    expect((await droppedNumbers(w.owner.id, v)).map((n) => n.name)).not.toContain('Privada');
    expect((await droppedNumbers(w.owner.id, await as(w.pablo))).map((n) => n.name)).toContain('Privada');
    // Cmd+K.
    const found = await searchApps({ id: w.owner.id, actingUser: { id: w.ruth.id }, role: 'member' }, 'Priv');
    expect(found.filter((f) => f.group === 'groupsChats')).toHaveLength(0);
    const okFound = await searchApps({ id: w.owner.id, actingUser: { id: w.pablo.id }, role: 'member' }, 'Priv');
    expect(okFound.filter((f) => f.group === 'groupsChats')).toHaveLength(1);
    // CRM: la ficha vinculada tampoco los muestra.
    await getDb().prepare('UPDATE groups_chats SET crm_company_id = ? WHERE id = ?').run('co-1', w.privChat.id);
    expect(await chatsForCrmRecord(w.owner.id, 'company', 'co-1', 5, v)).toHaveLength(0);
    expect(await chatsForCrmRecord(w.owner.id, 'company', 'co-1', 5, await as(w.pablo))).toHaveLength(1);
  });

  it('la API/MCP respeta la visibilidad (list_chats y get_messages)', async () => {
    const w = await world('ln-mcp');
    const ctx = (u: { id: string }) => groupsViewer(w.owner.id, u.id, 'member').then((viewer) => ({ ws: w.owner.id, personId: u.id, scopes: ['groups:read' as const], viewer }));
    const call = async (u: { id: string }, name: string, args: Record<string, unknown>) =>
      (await handleRpc(await ctx(u), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }))?.result as { isError?: boolean; structuredContent?: { chats?: Array<{ name: string }> } };
    const listed = await call(w.ruth, 'list_chats', { q: 'secreto' });
    expect(listed.structuredContent?.chats ?? []).toHaveLength(0);
    const blocked = await call(w.ruth, 'get_messages', { chatId: w.privChat.id });
    expect(blocked.isError).toBe(true);
    const allowed = await call(w.pablo, 'get_messages', { chatId: w.privChat.id });
    expect(allowed.isError).toBeFalsy();
  });

  it('los avisos no nombran chats de líneas que la persona no ve', async () => {
    const w = await world('ln-push');
    await saveSubscription(w.owner.id, w.ruth.id, { endpoint: 'https://push.example/ruth', keys: { p256dh: 'x', auth: 'y' } }, 'test');
    await saveSubscription(w.owner.id, w.pablo.id, { endpoint: 'https://push.example/pablo', keys: { p256dh: 'x', auth: 'y' } }, 'test');
    const before = fakePushes().length;
    expect(await notifyPerson(w.owner.id, w.ruth.id, { chatId: w.privChat.id, title: 'Cliente Priv', body: 'secreto' })).toBe(0);
    expect(fakePushes().length).toBe(before);
    expect(await notifyPerson(w.owner.id, w.pablo.id, { chatId: w.privChat.id, title: 'Cliente Priv', body: 'secreto' })).toBe(1);
    expect(await personCanSeeChat(w.owner.id, w.ruth.id, w.privChat.id)).toBe(false);
    expect(await personCanSeeChat(w.owner.id, w.vera.id, w.privChat.id)).toBe(true);
  });

  it('el dueño y la visibilidad se validan; "todo el workspace" es el valor por defecto', async () => {
    const w = await world('ln-own');
    const nums = await listNumbers(w.owner.id);
    expect(nums.find((n) => n.id === w.pub.id)).toMatchObject({ visibility: 'all', ownerId: null });
    expect(nums.find((n) => n.id === w.priv.id)).toMatchObject({ visibility: 'restricted', ownerId: w.olga.id, ownerName: expect.any(String) });
    expect(nums.find((n) => n.id === w.priv.id)?.access).toEqual({ personIds: [w.pablo.id], teamIds: [w.sales.id] });
    const outsider = await makeUser('ln-own-out');
    await expect(setLineAccess(w.owner.id, w.pub.id, { ownerId: outsider.id })).rejects.toMatchObject({ code: 'invalid_owner' });
    await expect(setLineAccess(w.owner.id, w.pub.id, { visibility: 'nope' as 'all' })).rejects.toMatchObject({ code: 'invalid_visibility' });
    // Los miembros no reciben quién la ve.
    expect((await listNumbers(w.owner.id, await groupsViewer(w.owner.id, w.olga.id, 'member')))[0].access).toBeUndefined();
    // Sin restricción vuelve a verla todo el mundo.
    await setLineAccess(w.owner.id, w.priv.id, { visibility: 'all' });
    expect(await canSeeChat(await groupsViewer(w.owner.id, w.ruth.id, 'member'), w.privChat.id)).toBe(true);
    // El acceso por línea y el SQL: admins sin condición.
    expect(chatAccessSql(await groupsViewer(w.owner.id, w.owner.id, 'admin'))).toBeNull();
  });

  it('la línea elegida se recuerda por persona y no puede ser una que no ve', async () => {
    const w = await world('ln-pref');
    const vOlga = await groupsViewer(w.owner.id, w.olga.id, 'member');
    const vRuth = await groupsViewer(w.owner.id, w.ruth.id, 'member');
    expect(await getSelectedLine(vOlga)).toBe('all');
    expect(await setSelectedLine(vOlga, w.priv.id)).toBe(w.priv.id);
    expect(await getSelectedLine(vOlga)).toBe(w.priv.id);
    expect(await getSelectedLine(vRuth)).toBe('all');
    await expect(setSelectedLine(vRuth, w.priv.id)).rejects.toMatchObject({ status: 404 });
    // Si pierde el acceso, vuelve a "todas".
    await setLineAccess(w.owner.id, w.priv.id, { ownerId: null, personIds: [] , teamIds: [] });
    expect(await getSelectedLine(vOlga)).toBe('all');
    expect(await setSelectedLine(vOlga, 'all')).toBe('all');
  });

  it('la vista de todas las líneas pagina y filtra por línea y dueño en una sola consulta', async () => {
    const w = await world('ln-all');
    for (let i = 0; i < 12; i++) await ingestEvents(w.pub, [msg(`54911000100${String(i).padStart(2, '0')}@c.us`, `B-${i}`, `m ${i}`, `Bulk ${i}`)]);
    const v = await groupsViewer(w.owner.id, w.pablo.id, 'member');
    const page1 = await listChats(w.owner.id, w.pablo.id, { viewer: v, limit: 5, offset: 0 });
    const page2 = await listChats(w.owner.id, w.pablo.id, { viewer: v, limit: 5, offset: 5 });
    expect(page1.total).toBe(14);
    expect(page1.rows).toHaveLength(5);
    expect(page1.rows.map((c) => c.id)).not.toEqual(page2.rows.map((c) => c.id));
    expect((await listChats(w.owner.id, w.pablo.id, { viewer: v, numberId: w.priv.id })).rows.map((c) => c.name)).toEqual(['Cliente Priv']);
    expect((await listChats(w.owner.id, w.pablo.id, { viewer: v, ownerId: w.olga.id })).rows.map((c) => c.name)).toEqual(['Cliente Priv']);
    // Los índices existen para el listado por línea.
    const idx = (await getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_groups_chats_number_recent', 'idx_groups_chats_folder_list', 'idx_groups_chats_list', 'idx_groups_chats_line_list')").all()) as Array<{ name: string }>;
    expect(idx).toHaveLength(4);
  });
});

describe('carpetas de Lines', () => {
  it('son del workspace, con subcarpetas, y los no leídos son por persona', async () => {
    const w = await world('ln-fold');
    const vPablo = await groupsViewer(w.owner.id, w.pablo.id, 'member');
    const vRuth = await groupsViewer(w.owner.id, w.ruth.id, 'member');
    const clientes = await createFolder(w.owner.id, w.olga.id, { name: 'Clientes' });
    const vip = await createFolder(w.owner.id, w.olga.id, { name: 'VIP', parentId: clientes.id });
    await expect(createFolder(w.owner.id, w.olga.id, { name: 'clientes' })).rejects.toMatchObject({ code: 'duplicate_folder' });
    await expect(createFolder(w.owner.id, w.olga.id, { name: '   ' })).rejects.toMatchObject({ code: 'invalid_name' });
    // Mover: Pablo ve ambos chats; Ruth solo el público.
    expect(await moveChatsToFolder(w.owner.id, vPablo, [w.pubChat.id, w.privChat.id], vip.id)).toEqual({ updated: 2, failed: 0 });
    expect(await moveChatsToFolder(w.owner.id, vRuth, [w.privChat.id], clientes.id)).toEqual({ updated: 0, failed: 1 });
    await expect(moveChatsToFolder(w.owner.id, vPablo, [w.pubChat.id], 'nope')).rejects.toMatchObject({ status: 404 });
    // Cada uno ve las mismas carpetas con sus propios no leídos (los de abajo suben al padre).
    const forPablo = await listFolders(w.owner.id, vPablo);
    const forRuth = await listFolders(w.owner.id, vRuth);
    expect(forPablo.folders.map((f) => f.name)).toEqual(forRuth.folders.map((f) => f.name));
    expect(forPablo.folders.find((f) => f.id === clientes.id)?.unread).toBe(2);
    expect(forRuth.folders.find((f) => f.id === clientes.id)?.unread).toBe(1);
    expect(forRuth.folders.find((f) => f.id === vip.id)?.chats).toBe(1);
    // Filtrar por carpeta incluye subcarpetas; 'none' = sin carpeta.
    expect((await listChats(w.owner.id, w.pablo.id, { viewer: vPablo, folderId: clientes.id })).rows).toHaveLength(2);
    expect((await listChats(w.owner.id, w.ruth.id, { viewer: vRuth, folderId: clientes.id })).rows.map((c) => c.name)).toEqual(['Cliente Pub']);
    expect((await listChats(w.owner.id, w.pablo.id, { viewer: vPablo, folderId: 'none' })).rows).toHaveLength(0);
    // Leer baja el conteo.
    await updateChat(w.owner.id, w.pubChat.id, { read: true });
    expect((await listFolders(w.owner.id, vRuth)).folders.find((f) => f.id === clientes.id)?.unread).toBe(0);
    // Renombrar, mover y límite de profundidad.
    await updateFolder(w.owner.id, vip.id, { name: 'Muy VIP' });
    const a = await createFolder(w.owner.id, w.olga.id, { name: 'A', parentId: vip.id });
    const b = await createFolder(w.owner.id, w.olga.id, { name: 'B', parentId: a.id });
    await expect(createFolder(w.owner.id, w.olga.id, { name: 'C', parentId: b.id })).rejects.toMatchObject({ code: 'too_deep' });
    await expect(updateFolder(w.owner.id, clientes.id, { parentId: b.id })).rejects.toBeTruthy();
    // Borrar la carpeta deja los chats sin carpeta.
    expect(await deleteFolder(w.owner.id, clientes.id)).toBe(true);
    expect((await listChats(w.owner.id, w.pablo.id, { viewer: vPablo, folderId: 'none' })).rows).toHaveLength(2);
    expect((await listFolders(w.owner.id, vPablo)).folders).toHaveLength(0);
    expect(await deleteFolder(w.owner.id, clientes.id)).toBe(false);
  });
});
