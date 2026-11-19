import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { chatsForCrmRecord, connectNumber, countUnreadChats, createNumber, droppedNumbers, getNumberRowById, ingestEvents, listChats, listNumbers } from '@/lib/groups';
import { createTeam as createLinesTeam } from '@/lib/groups-inbox';
import { canSeeChat, canSeeNumber, chatFilterFor, groupsViewer, personCanSeeChat, visibleChatIds, visibleNumberIds } from '@/lib/groups-access';
import { getSelectedLine, listFolders, setLineAccess, setSelectedLine } from '@/lib/groups-lines';
import {
  createLineGroup,
  deleteLineGroup,
  getPersonLineAccess,
  listLineGroups,
  reorderLineGroups,
  setNumberLineGroup,
  setPersonLineAccess,
  updateLineGroup,
} from '@/lib/groups-line-groups';
import { handleRpc } from '@/lib/groups-mcp';
import { searchApps } from '@/lib/app-search';
import { fakePushes, notifyPerson, saveSubscription } from '@/lib/groups-push';
import { asMember, asOwner } from './access-helpers';
import { makeUser } from './helpers';

/**
 * Lines: grupos de líneas y acceso por grupo. Ventas y Operaciones en el mismo
 * workspace: quien tiene Ventas no se entera de nada de Operaciones (chats,
 * mensajes, búsqueda, conteos, avisos, eventos en vivo, API), por ninguna vía.
 * Nombres, teléfonos y textos inventados.
 */

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_PUSH_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  session.user = null;
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
  const n = await createNumber(ws, ws, { provider: 'fake', name: label, visibility: 'restricted' });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

/**
 * Líneas restringidas: Ventas 1 y Ventas 2 (grupo Ventas, Ventas 2 todavía afuera), Operaciones 1 (grupo
 * Operaciones) y una suelta. Ana tiene el grupo Ventas a su nombre; Omar, Operaciones por su equipo; Nora, nada.
 */
async function world(label: string) {
  const owner = await makeUser(`${label}-ws`);
  const ana = await makeUser(`${label}-ana`);
  const omar = await makeUser(`${label}-omar`);
  const nora = await makeUser(`${label}-nora`);
  const boss = await makeUser(`${label}-boss`);
  const team = await createTeam(owner.id, 'Workspace');
  for (const u of [ana, omar, nora]) await addMember(team.id, u.id, 'member');
  await addMember(team.id, boss.id, 'admin');
  const s1 = await line(owner.id, 'Ventas 1');
  const s2 = await line(owner.id, 'Ventas 2');
  const o1 = await line(owner.id, 'Operaciones 1');
  const loose = await line(owner.id, 'Suelta');
  await ingestEvents(s1, [msg('5491100000011@c.us', `${label}-S1`, 'presupuesto de ventas', 'Cliente Ventas Uno')]);
  await ingestEvents(s2, [msg('5491100000012@c.us', `${label}-S2`, 'otro presupuesto', 'Cliente Ventas Dos')]);
  await ingestEvents(o1, [msg('5491100000021@c.us', `${label}-O1`, 'reclamo de entrega secreto', 'Cliente Operaciones')]);
  await ingestEvents(loose, [msg('5491100000031@c.us', `${label}-L1`, 'consulta suelta', 'Cliente Suelto')]);
  const sales = await createLineGroup(owner.id, owner.id, { name: 'Ventas' });
  const ops = await createLineGroup(owner.id, owner.id, { name: 'Operaciones' });
  const opsTeam = await createLinesTeam(owner.id, { name: 'Equipo Operaciones', memberIds: [omar.id] });
  await updateLineGroup(owner.id, sales.id, { numberIds: [s1.id], personIds: [ana.id] });
  await updateLineGroup(owner.id, ops.id, { numberIds: [o1.id], teamIds: [opsTeam.id] });
  const chats = (await listChats(owner.id, owner.id)).rows;
  const chat = (name: string) => chats.find((c) => c.name === name)!;
  const as = (u: { id: string }, role: 'member' | 'admin' = 'member') => groupsViewer(owner.id, u.id, role);
  return { owner, ana, omar, nora, boss, s1, s2, o1, loose, sales, ops, opsTeam, as, c: { s1: chat('Cliente Ventas Uno'), s2: chat('Cliente Ventas Dos'), o1: chat('Cliente Operaciones'), loose: chat('Cliente Suelto') } };
}

const names = async (ws: string, me: string, q: Parameters<typeof listChats>[2]) => (await listChats(ws, me, q)).rows.map((c) => c.name).sort();

describe('grupos de líneas: aislamiento', () => {
  it('quien tiene Ventas no ve nada de Operaciones: lista, abrir, búsqueda, filtros, conteos, líneas, Cmd+K, CRM y carpetas', async () => {
    const w = await world('lg-iso');
    const ana = await w.as(w.ana);
    const omar = await w.as(w.omar);
    const nora = await w.as(w.nora);

    // Lista y abrir.
    expect(await names(w.owner.id, w.ana.id, { viewer: ana })).toEqual(['Cliente Ventas Uno']);
    expect(await names(w.owner.id, w.omar.id, { viewer: omar })).toEqual(['Cliente Operaciones']);
    expect(await names(w.owner.id, w.nora.id, { viewer: nora })).toEqual([]);
    expect(await canSeeChat(ana, w.c.s1.id)).toBe(true);
    expect(await canSeeChat(ana, w.c.o1.id)).toBe(false);
    expect(await canSeeChat(ana, w.c.loose.id)).toBe(false);
    expect(await canSeeChat(omar, w.c.o1.id)).toBe(true);
    expect(await canSeeChat(omar, w.c.s1.id)).toBe(false);
    expect(await canSeeChat(nora, w.c.s1.id)).toBe(false);
    // Admin y dueño del workspace ven todo, con o sin grupos.
    expect(await names(w.owner.id, w.boss.id, { viewer: await w.as(w.boss, 'admin') })).toHaveLength(4);
    expect(await names(w.owner.id, w.owner.id, { viewer: await groupsViewer(w.owner.id, w.owner.id, 'owner') })).toHaveLength(4);

    // Búsqueda en mensajes, filtro por línea y por grupo: nada de Operaciones, ni el total.
    expect((await listChats(w.owner.id, w.ana.id, { viewer: ana, q: 'secreto' })).rows).toHaveLength(0);
    expect((await listChats(w.owner.id, w.ana.id, { viewer: ana, q: 'Operaciones' })).rows).toHaveLength(0);
    const byLine = await listChats(w.owner.id, w.ana.id, { viewer: ana, numberId: w.o1.id });
    expect([byLine.rows.length, byLine.total]).toEqual([0, 0]);
    const byGroup = await listChats(w.owner.id, w.ana.id, { viewer: ana, lineGroupId: w.ops.id });
    expect([byGroup.rows.length, byGroup.total]).toEqual([0, 0]);
    expect(await names(w.owner.id, w.ana.id, { viewer: ana, lineGroupId: w.sales.id })).toEqual(['Cliente Ventas Uno']);
    // El filtro por grupo para un admin trae solo las líneas del grupo.
    expect(await names(w.owner.id, w.owner.id, { lineGroupId: w.ops.id })).toEqual(['Cliente Operaciones']);

    // Conteos y no leídos.
    expect(await countUnreadChats(w.owner.id, ana)).toBe(1);
    expect(await countUnreadChats(w.owner.id, nora)).toBe(0);
    const visible = await visibleChatIds(ana);
    expect([...visible!]).toEqual([w.c.s1.id]);
    const folders = await listFolders(w.owner.id, ana);
    expect(folders.unfiled).toEqual({ unread: 1, chats: 1 });

    // Líneas: ni la lista, ni el aviso de línea caída.
    expect((await listNumbers(w.owner.id, ana)).map((n) => n.name)).toEqual(['Ventas 1']);
    expect((await listNumbers(w.owner.id, nora)).map((n) => n.name)).toEqual([]);
    expect(await canSeeNumber(ana, w.o1.id)).toBe(false);
    expect(await canSeeNumber(omar, w.o1.id)).toBe(true);
    expect([...(await visibleNumberIds(ana))!]).toEqual([w.s1.id]);
    await getDb().prepare("UPDATE groups_numbers SET status = 'disconnected' WHERE id = ?").run(w.o1.id);
    expect((await droppedNumbers(w.owner.id, ana)).map((n) => n.name)).not.toContain('Operaciones 1');
    expect((await droppedNumbers(w.owner.id, omar)).map((n) => n.name)).toContain('Operaciones 1');

    // Cmd+K y la ficha de CRM.
    const found = await searchApps({ id: w.owner.id, actingUser: { id: w.ana.id }, role: 'member' }, 'Cliente');
    expect(found.filter((f) => f.group === 'groupsChats')).toHaveLength(1);
    expect(JSON.stringify(found)).not.toContain('Operaciones');
    await getDb().prepare('UPDATE groups_chats SET crm_company_id = ? WHERE id = ?').run('co-lg', w.c.o1.id);
    expect(await chatsForCrmRecord(w.owner.id, 'company', 'co-lg', 5, ana)).toHaveLength(0);
    expect(await chatsForCrmRecord(w.owner.id, 'company', 'co-lg', 5, omar)).toHaveLength(1);

    // Los grupos que ve cada uno: solo donde tiene alguna línea, y sin la lista de accesos.
    expect(await listLineGroups(w.owner.id, ana)).toEqual([{ id: w.sales.id, name: 'Ventas', position: 0, numberIds: [w.s1.id] }]);
    expect((await listLineGroups(w.owner.id, omar)).map((g) => g.name)).toEqual(['Operaciones']);
    expect(await listLineGroups(w.owner.id, nora)).toEqual([]);
    const all = await listLineGroups(w.owner.id);
    expect(all.map((g) => [g.name, g.access?.personIds, g.access?.teamIds])).toEqual([
      ['Ventas', [w.ana.id], []],
      ['Operaciones', [], [w.opsTeam.id]],
    ]);
  });

  it('la API/MCP, los avisos y los eventos en vivo siguen el acceso por grupo', async () => {
    const w = await world('lg-api');
    const ctx = (u: { id: string }) => groupsViewer(w.owner.id, u.id, 'member').then((viewer) => ({ ws: w.owner.id, personId: u.id, scopes: ['groups:read' as const], viewer }));
    const call = async (u: { id: string }, name: string, args: Record<string, unknown>) =>
      (await handleRpc(await ctx(u), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }))?.result as { isError?: boolean; structuredContent?: { chats?: Array<{ name: string }> } };
    expect((await call(w.ana, 'list_chats', {})).structuredContent?.chats?.map((c) => c.name)).toEqual(['Cliente Ventas Uno']);
    expect((await call(w.ana, 'list_chats', { q: 'secreto' })).structuredContent?.chats ?? []).toHaveLength(0);
    expect((await call(w.ana, 'get_messages', { chatId: w.c.o1.id })).isError).toBe(true);
    expect((await call(w.omar, 'get_messages', { chatId: w.c.o1.id })).isError).toBeFalsy();
    expect((await call(w.ana, 'get_messages', { chatId: w.c.s1.id })).isError).toBeFalsy();

    // Avisos: nunca de un chat que no ve.
    await saveSubscription(w.owner.id, w.ana.id, { endpoint: 'https://push.example/lg-ana', keys: { p256dh: 'x', auth: 'y' } }, 'test');
    await saveSubscription(w.owner.id, w.omar.id, { endpoint: 'https://push.example/lg-omar', keys: { p256dh: 'x', auth: 'y' } }, 'test');
    const before = fakePushes().length;
    expect(await notifyPerson(w.owner.id, w.ana.id, { chatId: w.c.o1.id, title: 'Cliente Operaciones', body: 'reclamo' })).toBe(0);
    expect(fakePushes().length).toBe(before);
    expect(await notifyPerson(w.owner.id, w.omar.id, { chatId: w.c.o1.id, title: 'Cliente Operaciones', body: 'reclamo' })).toBe(1);
    expect(await personCanSeeChat(w.owner.id, w.ana.id, w.c.o1.id)).toBe(false);
    expect(await personCanSeeChat(w.owner.id, w.omar.id, w.c.o1.id)).toBe(true);

    // Eventos en vivo (SSE): el filtro de la conexión deja pasar solo los chats que ve, y se vuelve a
    // consultar en cada evento: si le sacan el grupo con la conexión abierta, deja de recibirlos.
    const live = chatFilterFor(await w.as(w.ana))!;
    expect([...(await live([w.c.s1.id, w.c.o1.id, w.c.loose.id]))]).toEqual([w.c.s1.id]);
    await updateLineGroup(w.owner.id, w.sales.id, { personIds: [] });
    expect([...(await live([w.c.s1.id, w.c.o1.id]))]).toEqual([]);
    // Un admin no tiene filtro.
    expect(chatFilterFor(await w.as(w.boss, 'admin'))).toBeNull();
  });

  it('sumar o sacar una línea del grupo, sacar a la persona o borrar el grupo cambia el acceso en el acto', async () => {
    const w = await world('lg-move');
    const ana = await w.as(w.ana);
    const see = async () => names(w.owner.id, w.ana.id, { viewer: ana });
    expect(await see()).toEqual(['Cliente Ventas Uno']);

    // Una línea que entra al grupo después: la ve sin tocar su acceso.
    await setNumberLineGroup(w.owner.id, w.s2.id, w.sales.id);
    expect(await see()).toEqual(['Cliente Ventas Dos', 'Cliente Ventas Uno']);
    expect(await canSeeChat(ana, w.c.s2.id)).toBe(true);
    expect((await listLineGroups(w.owner.id, ana))[0].numberIds.sort()).toEqual([w.s1.id, w.s2.id].sort());

    // Una línea que sale del grupo: deja de verla.
    await setNumberLineGroup(w.owner.id, w.s1.id, null);
    expect(await see()).toEqual(['Cliente Ventas Dos']);
    expect(await canSeeChat(ana, w.c.s1.id)).toBe(false);

    // Una línea que pasa a otro grupo: la ve quien tiene ese grupo, y ya no quien tenía el anterior.
    await setNumberLineGroup(w.owner.id, w.s2.id, w.ops.id);
    expect(await see()).toEqual([]);
    expect(await canSeeChat(await w.as(w.omar), w.c.s2.id)).toBe(true);
    await updateLineGroup(w.owner.id, w.sales.id, { numberIds: [w.s1.id, w.s2.id] });
    expect(await see()).toEqual(['Cliente Ventas Dos', 'Cliente Ventas Uno']);
    expect(await canSeeChat(await w.as(w.omar), w.c.s2.id)).toBe(false);

    // Sacar a la persona del grupo.
    await updateLineGroup(w.owner.id, w.sales.id, { personIds: [] });
    expect(await see()).toEqual([]);
    expect(await countUnreadChats(w.owner.id, ana)).toBe(0);
    await setPersonLineAccess(w.owner.id, w.ana.id, { groupIds: [w.sales.id] });
    expect(await see()).toHaveLength(2);

    // Sacar a alguien del equipo que tiene el grupo.
    const omar = await w.as(w.omar);
    expect(await canSeeChat(omar, w.c.o1.id)).toBe(true);
    await getDb().prepare('DELETE FROM groups_team_members WHERE team_id = ? AND person_id = ?').run(w.opsTeam.id, w.omar.id);
    expect(await canSeeChat(omar, w.c.o1.id)).toBe(false);

    // Borrar el grupo: las líneas siguen (sin grupo) y quien las veía por el grupo deja de verlas.
    expect(await deleteLineGroup(w.owner.id, w.sales.id)).toBe(true);
    expect(await see()).toEqual([]);
    const after = await listNumbers(w.owner.id);
    expect(after.map((n) => n.name).sort()).toEqual(['Operaciones 1', 'Suelta', 'Ventas 1', 'Ventas 2']);
    expect(after.find((n) => n.id === w.s1.id)?.groupId).toBeNull();
    expect((await listChats(w.owner.id, w.owner.id)).rows).toHaveLength(4);
    expect(await getDb().prepare('SELECT 1 AS x FROM groups_line_group_access WHERE group_id = ?').get(w.sales.id)).toBeFalsy();
    expect(await deleteLineGroup(w.owner.id, w.sales.id)).toBe(false);
  });

  it('una línea suelta se da una por una; el grupo no cambia las líneas de "todo el workspace"', async () => {
    const w = await world('lg-one');
    const ana = await w.as(w.ana);
    await setPersonLineAccess(w.owner.id, w.ana.id, { numberIds: [w.loose.id] });
    expect(await names(w.owner.id, w.ana.id, { viewer: ana })).toEqual(['Cliente Suelto', 'Cliente Ventas Uno']);
    expect(await getPersonLineAccess(w.owner.id, w.ana.id)).toMatchObject({ groupIds: [w.sales.id], numberIds: [w.loose.id], teamGroupIds: [] });
    expect(await getPersonLineAccess(w.owner.id, w.omar.id)).toMatchObject({ groupIds: [], numberIds: [], teamGroupIds: [w.ops.id] });
    // Guardar solo los grupos no toca las líneas dadas una por una, y al revés.
    await setPersonLineAccess(w.owner.id, w.ana.id, { groupIds: [] });
    expect(await names(w.owner.id, w.ana.id, { viewer: ana })).toEqual(['Cliente Suelto']);
    await setPersonLineAccess(w.owner.id, w.ana.id, { numberIds: [] });
    expect(await names(w.owner.id, w.ana.id, { viewer: ana })).toEqual([]);
    // Una línea de "todo el workspace" la ven todos, esté o no en un grupo.
    await setLineAccess(w.owner.id, w.o1.id, { visibility: 'all' });
    expect(await names(w.owner.id, w.nora.id, { viewer: await w.as(w.nora) })).toEqual(['Cliente Operaciones']);
  });

  it('la línea o el grupo elegidos en la bandeja: solo entre lo que ve', async () => {
    const w = await world('lg-pref');
    const ana = await w.as(w.ana);
    expect(await setSelectedLine(ana, `g:${w.sales.id}`)).toBe(`g:${w.sales.id}`);
    expect(await getSelectedLine(ana)).toBe(`g:${w.sales.id}`);
    await expect(setSelectedLine(ana, `g:${w.ops.id}`)).rejects.toMatchObject({ status: 404 });
    await expect(setSelectedLine(ana, 'g:no-existe')).rejects.toMatchObject({ status: 404 });
    await expect(setSelectedLine(ana, w.o1.id)).rejects.toMatchObject({ status: 404 });
    // Le sacan el grupo: lo guardado vuelve a "todas".
    await updateLineGroup(w.owner.id, w.sales.id, { personIds: [] });
    expect(await getSelectedLine(ana)).toBe('all');
  });

  it('nombres, orden y datos de otro workspace', async () => {
    const w = await world('lg-edit');
    const other = await world('lg-edit-b');
    await expect(createLineGroup(w.owner.id, w.owner.id, { name: '   ' })).rejects.toMatchObject({ code: 'invalid_name' });
    await expect(createLineGroup(w.owner.id, w.owner.id, { name: 'ventas' })).rejects.toMatchObject({ code: 'duplicate_line_group' });
    await updateLineGroup(w.owner.id, w.sales.id, { name: '  Ventas   Norte ' });
    await expect(updateLineGroup(w.owner.id, w.ops.id, { name: 'ventas norte' })).rejects.toMatchObject({ code: 'duplicate_line_group' });
    const support = await createLineGroup(w.owner.id, w.owner.id, { name: 'Soporte' });
    await reorderLineGroups(w.owner.id, [support.id, w.ops.id]);
    expect((await listLineGroups(w.owner.id)).map((g) => g.name)).toEqual(['Soporte', 'Operaciones', 'Ventas Norte']);

    // Ids de otro workspace no entran: ni líneas, ni personas, ni equipos, ni el grupo mismo.
    await updateLineGroup(w.owner.id, w.sales.id, { numberIds: [w.s1.id, other.s1.id], personIds: [w.ana.id, other.ana.id], teamIds: [other.opsTeam.id] });
    const sales = (await listLineGroups(w.owner.id)).find((g) => g.id === w.sales.id)!;
    expect(sales.numberIds).toEqual([w.s1.id]);
    expect(sales.access).toEqual({ personIds: [w.ana.id], teamIds: [] });
    expect((await listNumbers(other.owner.id)).find((n) => n.id === other.s1.id)?.groupId).toBe(other.sales.id);
    await expect(updateLineGroup(w.owner.id, other.sales.id, { name: 'Robado' })).rejects.toMatchObject({ status: 404 });
    await expect(setNumberLineGroup(w.owner.id, w.s1.id, other.sales.id)).rejects.toMatchObject({ code: 'invalid_line_group' });
    await expect(setNumberLineGroup(w.owner.id, other.s1.id, w.sales.id)).rejects.toMatchObject({ status: 404 });
    expect(await deleteLineGroup(w.owner.id, other.sales.id)).toBe(false);
    await expect(setPersonLineAccess(w.owner.id, other.ana.id, { groupIds: [w.sales.id] })).rejects.toMatchObject({ code: 'invalid_person' });
    await setPersonLineAccess(w.owner.id, w.nora.id, { groupIds: [other.sales.id], numberIds: [other.s1.id] });
    expect(await getPersonLineAccess(w.owner.id, w.nora.id)).toMatchObject({ groupIds: [], numberIds: [] });
    expect(await canSeeChat(await groupsViewer(other.owner.id, w.nora.id, 'member'), other.c.s1.id)).toBe(false);
  });
});

describe('grupos de líneas: rutas', () => {
  const json = (method: string, body?: unknown, query = '') =>
    new Request(`http://localhost/api/groups/line-groups${query}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  it('solo un admin crea, cambia, ordena, borra y da acceso; un member recibe solo sus grupos', async () => {
    const w = await world('lg-route');
    const route = await import('@/app/api/groups/line-groups/route');
    const numbers = await import('@/lib/routes/groups/numbers/[id]/route');
    const stranger = await makeUser('lg-route-stranger');

    // Anónimo: 401 en todo.
    session.user = null;
    expect((await route.GET(json('GET'))).status).toBe(401);
    expect((await route.POST(json('POST', { name: 'X' }))).status).toBe(401);
    expect((await route.PATCH(json('PATCH', { id: w.sales.id, name: 'X' }))).status).toBe(401);
    expect((await route.DELETE(json('DELETE', undefined, `?id=${w.sales.id}`))).status).toBe(401);

    // Member (aunque tenga el grupo): no edita grupos ni accesos, ni mueve líneas de grupo.
    session.user = asMember(w.owner, w.ana);
    expect((await route.POST(json('POST', { name: 'Mío' }))).status).toBe(403);
    expect((await route.PATCH(json('PATCH', { id: w.sales.id, name: 'Mío' }))).status).toBe(403);
    expect((await route.PATCH(json('PATCH', { id: w.ops.id, personIds: [w.ana.id] }))).status).toBe(403);
    expect((await route.PATCH(json('PATCH', { personId: w.ana.id, groupIds: [w.ops.id], numberIds: [w.o1.id] }))).status).toBe(403);
    expect((await route.PATCH(json('PATCH', { order: [w.ops.id, w.sales.id] }))).status).toBe(403);
    expect((await route.DELETE(json('DELETE', undefined, `?id=${w.sales.id}`))).status).toBe(403);
    expect((await route.GET(json('GET', undefined, `?person=${w.omar.id}`))).status).toBe(403);
    const patchLine = (id: string, body: unknown) => numbers.PATCH(new Request(`http://localhost/api/groups/numbers/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    expect((await patchLine(w.s1.id, { groupId: w.ops.id })).status).toBe(403);
    expect((await patchLine(w.o1.id, { groupId: w.sales.id })).status).toBe(403);
    // Nada cambió.
    expect((await listLineGroups(w.owner.id)).map((g) => [g.name, g.numberIds, g.access?.personIds])).toEqual([
      ['Ventas', [w.s1.id], [w.ana.id]],
      ['Operaciones', [w.o1.id], []],
    ]);
    // Lo que recibe: su grupo, con sus líneas, sin la lista de accesos.
    const mine = (await (await route.GET(json('GET'))).json()) as { groups: Array<Record<string, unknown>> };
    expect(mine.groups).toEqual([{ id: w.sales.id, name: 'Ventas', position: 0, numberIds: [w.s1.id] }]);
    session.user = asMember(w.owner, w.nora);
    expect(((await (await route.GET(json('GET'))).json()) as { groups: unknown[] }).groups).toEqual([]);

    // Otro workspace: no ve estos grupos ni los toca con su propia sesión de owner.
    session.user = asOwner(stranger);
    expect(((await (await route.GET(json('GET'))).json()) as { groups: unknown[] }).groups).toEqual([]);
    expect((await route.PATCH(json('PATCH', { id: w.sales.id, name: 'Ajeno' }))).status).toBe(404);
    expect((await route.DELETE(json('DELETE', undefined, `?id=${w.sales.id}`))).status).toBe(404);
    expect((await route.PATCH(json('PATCH', { personId: w.ana.id, groupIds: [] }))).status).toBe(400);
    expect((await listLineGroups(w.owner.id))[0]).toMatchObject({ name: 'Ventas', access: { personIds: [w.ana.id] } });

    // Admin del workspace: todo.
    session.user = asMember(w.owner, w.boss, 'admin');
    const made = await route.POST(json('POST', { name: 'Soporte' }));
    expect(made.status).toBe(201);
    const support = (await made.json()) as { id: string };
    expect((await route.PATCH(json('PATCH', { id: support.id, numberIds: [w.loose.id], personIds: [w.nora.id] }))).status).toBe(200);
    expect(await canSeeChat(await w.as(w.nora), w.c.loose.id)).toBe(true);
    expect((await patchLine(w.s2.id, { groupId: w.sales.id })).status).toBe(200);
    expect(await canSeeChat(await w.as(w.ana), w.c.s2.id)).toBe(true);
    expect((await patchLine(w.s2.id, { groupId: null })).status).toBe(200);
    expect(await canSeeChat(await w.as(w.ana), w.c.s2.id)).toBe(false);
    const person = (await (await route.GET(json('GET', undefined, `?person=${w.nora.id}`))).json()) as { person: { groupIds: string[] } };
    expect(person.person.groupIds).toEqual([support.id]);
    expect((await route.PATCH(json('PATCH', { order: [support.id] }))).status).toBe(200);
    expect((await listLineGroups(w.owner.id)).map((g) => g.name)).toEqual(['Soporte', 'Ventas', 'Operaciones']);
    expect((await route.PATCH(json('PATCH', {}))).status).toBe(400);
    expect((await route.DELETE(json('DELETE', undefined, `?id=${support.id}`))).status).toBe(200);
    expect(await canSeeChat(await w.as(w.nora), w.c.loose.id)).toBe(false);
  });

  it('la lista de chats de la bandeja por grupo, vía la ruta', async () => {
    const w = await world('lg-chats');
    const chats = await import('@/app/api/groups/chats/route');
    const get = async (query: string) => {
      const res = await chats.GET(new Request(`http://localhost/api/groups/chats?${query}`));
      return { status: res.status, body: (await res.json()) as { rows?: Array<{ name: string }>; total?: number; unreadChats?: number; dropped?: unknown[] } };
    };
    session.user = asMember(w.owner, w.ana);
    const all = await get('');
    expect(all.body.rows?.map((c) => c.name)).toEqual(['Cliente Ventas Uno']);
    expect(all.body.unreadChats).toBe(1);
    expect((await get(`linegroup=${w.sales.id}`)).body.rows?.map((c) => c.name)).toEqual(['Cliente Ventas Uno']);
    const ops = await get(`linegroup=${w.ops.id}`);
    expect([ops.body.rows?.length, ops.body.total]).toEqual([0, 0]);
    expect((await get(`number=${w.o1.id}`)).body.rows).toHaveLength(0);
    expect((await get('q=secreto')).body.rows).toHaveLength(0);
    session.user = asOwner(w.owner);
    expect((await get(`linegroup=${w.ops.id}`)).body.rows?.map((c) => c.name)).toEqual(['Cliente Operaciones']);
  });
});
