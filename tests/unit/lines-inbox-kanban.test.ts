import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { groupsViewer } from '@/lib/groups-access';
import { createFolder, moveChatsToFolder, setLineAccess } from '@/lib/groups-lines';
import { connectHubspot, linkHubspot } from '@/lib/groups-hubspot';
import { fakeHubspot, resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { createStage, deleteStage, getKanbanPrefs, kanbanBoard, listStages, moveKanbanCard, reorderStages, setKanbanPrefs, updateStage } from '@/lib/groups-kanban';
import { KANBAN_NONE } from '@/lib/groups-kanban-shared';
import { makeUser } from './helpers';

/**
 * Lines: la bandeja como kanban. Permisos y aislamiento (líneas que no ve,
 * etapas personales de otra persona, otro workspace), mover en cada fuente,
 * HubSpot por el portal falso con y sin permiso de escritura, y conteos que
 * respetan los filtros. Proveedor falso; nombres y números inventados.
 */

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const boardRoute = await import('@/app/api/groups/kanban/route');
const moveRoute = await import('@/app/api/groups/kanban/move/route');
const stagesRoute = await import('@/app/api/groups/kanban/stages/route');

const TOKEN = 'pat-na1-fake-token-for-kanban-tests';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_INTEGRATIONS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  resetFakeHubspot();
});
afterEach(() => {
  session.user = null;
  vi.unstubAllEnvs();
});

const msg = (chatId: string, id: string, senderName: string, isGroup = false) => ({
  type: 'message' as const,
  chatId,
  isGroup,
  ...(isGroup ? { chatName: senderName } : {}),
  fromMe: false,
  senderPhone: isGroup ? '5491100000099' : chatId.split('@')[0],
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

let seq = 0;
/** Workspace con dos líneas: "Pública" (todos) y "Privada" (solo Pablo). Ruth es member y solo ve la pública. */
async function world(label: string) {
  seq += 1;
  const owner = await makeUser(`${label}-ws`);
  const pablo = await makeUser(`${label}-pablo`);
  const ruth = await makeUser(`${label}-ruth`);
  const team = await createTeam(owner.id, 'Workspace');
  for (const u of [pablo, ruth]) await addMember(team.id, u.id, 'member');
  const pub = await line(owner.id, 'Pública');
  const priv = await line(owner.id, 'Privada');
  const p = String(seq).padStart(3, '0');
  await ingestEvents(pub, [msg(`5491100${p}011@c.us`, `KB-${p}-1`, 'Cliente Uno')]);
  await ingestEvents(pub, [msg(`5491100${p}013@c.us`, `KB-${p}-3`, 'Cliente Tres')]);
  await ingestEvents(priv, [msg(`5491100${p}012@c.us`, `KB-${p}-2`, 'Cliente Dos')]);
  await ingestEvents(pub, [msg(`1203630${p}0001@g.us`, `KB-${p}-4`, 'Grupo Acme', true)]);
  await setLineAccess(owner.id, priv.id, { ownerId: pablo.id, visibility: 'restricted', personIds: [], teamIds: [] });
  const chats = (await listChats(owner.id, owner.id, { limit: 50 })).rows;
  const chat = (name: string) => chats.find((c) => c.name === name)!;
  return {
    owner,
    pablo,
    ruth,
    pub,
    priv,
    uno: chat('Cliente Uno'),
    dos: chat('Cliente Dos'),
    tres: chat('Cliente Tres'),
    acme: chat('Grupo Acme'),
    vAdmin: await groupsViewer(owner.id, owner.id, 'owner'),
    vPablo: await groupsViewer(owner.id, pablo.id, 'member'),
    vRuth: await groupsViewer(owner.id, ruth.id, 'member'),
  };
}

const ids = (board: Awaited<ReturnType<typeof kanbanBoard>>, column: string) => board.columns.find((c) => c.id === column)?.cards.map((c) => c.id) ?? [];
const counts = (board: Awaited<ReturnType<typeof kanbanBoard>>) => Object.fromEntries(board.columns.map((c) => [c.id, c.count]));

describe('Kanban: etapas del equipo', () => {
  it('solo un admin las define; cualquiera que ve el chat lo mueve y el equipo lo ve en esa columna', async () => {
    const w = await world('kb-team');
    await expect(createStage(w.vRuth, 'team', { name: 'Onboarding' })).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    const onb = await createStage(w.vAdmin, 'team', { name: 'Onboarding', color: 'blue' });
    const live = await createStage(w.vAdmin, 'team', { name: 'Live', color: 'nope' });
    expect(live.color).toBe('gray');
    await expect(updateStage(w.vRuth, 'team', onb.id, { name: 'X' })).rejects.toMatchObject({ status: 403 });
    await expect(deleteStage(w.vPablo, 'team', onb.id)).rejects.toMatchObject({ status: 403 });
    expect((await listStages(w.vRuth, 'team')).map((s) => s.name)).toEqual(['Onboarding', 'Live']);

    // Ruth mueve un chat de la línea pública; todos lo ven ahí.
    await moveKanbanCard(w.vRuth, 'team', w.uno.id, onb.id);
    for (const v of [w.vAdmin, w.vPablo, w.vRuth]) expect(ids(await kanbanBoard(v, 'team', {}), onb.id)).toEqual([w.uno.id]);

    // El chat de la línea privada: Ruth no lo ve en el tablero ni lo puede mover (como si no existiera).
    const ruthBoard = await kanbanBoard(w.vRuth, 'team', {});
    expect(ruthBoard.columns.flatMap((c) => c.cards.map((x) => x.id))).not.toContain(w.dos.id);
    expect(ruthBoard.columns.reduce((s, c) => s + c.count, 0)).toBe(3);
    await expect(moveKanbanCard(w.vRuth, 'team', w.dos.id, onb.id)).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await moveKanbanCard(w.vPablo, 'team', w.dos.id, live.id);
    expect(counts(await kanbanBoard(w.vRuth, 'team', {}))).toEqual({ [KANBAN_NONE]: 2, [onb.id]: 1, [live.id]: 0 });
    expect(counts(await kanbanBoard(w.vAdmin, 'team', {}))).toEqual({ [KANBAN_NONE]: 2, [onb.id]: 1, [live.id]: 1 });
    expect(ruthBoard.canEditStages).toBe(false);
    expect((await kanbanBoard(w.vAdmin, 'team', {})).canEditStages).toBe(true);

    // Orden, renombre y borrar: los chats de la etapa borrada vuelven a "Sin etapa".
    expect((await reorderStages(w.vAdmin, 'team', [live.id, onb.id])).map((s) => s.name)).toEqual(['Live', 'Onboarding']);
    expect((await updateStage(w.vAdmin, 'team', onb.id, { name: '  En marcha ' })).name).toBe('En marcha');
    expect(await deleteStage(w.vAdmin, 'team', onb.id)).toBe(true);
    expect(ids(await kanbanBoard(w.vAdmin, 'team', {}), KANBAN_NONE)).toContain(w.uno.id);
    // "Sin etapa" saca el chat de la etapa.
    await moveKanbanCard(w.vAdmin, 'team', w.dos.id, KANBAN_NONE);
    expect(ids(await kanbanBoard(w.vAdmin, 'team', {}), live.id)).toEqual([]);
  });

  it('los conteos respetan filtros, búsqueda, línea y carpeta', async () => {
    const w = await world('kb-filters');
    const s = await createStage(w.vAdmin, 'team', { name: 'Live' });
    await moveKanbanCard(w.vAdmin, 'team', w.uno.id, s.id);
    await moveKanbanCard(w.vAdmin, 'team', w.acme.id, s.id);
    expect(counts(await kanbanBoard(w.vAdmin, 'team', {}))).toEqual({ [KANBAN_NONE]: 2, [s.id]: 2 });
    // Solo grupos (la pestaña "Grupos").
    expect(counts(await kanbanBoard(w.vAdmin, 'team', { filters: { kinds: ['group'] } }))).toEqual({ [KANBAN_NONE]: 0, [s.id]: 1 });
    // Búsqueda por nombre.
    expect(counts(await kanbanBoard(w.vAdmin, 'team', { q: 'Tres' }))).toEqual({ [KANBAN_NONE]: 1, [s.id]: 0 });
    // Una línea.
    expect(counts(await kanbanBoard(w.vAdmin, 'team', { numberId: w.priv.id }))).toEqual({ [KANBAN_NONE]: 1, [s.id]: 0 });
    // Una carpeta personal.
    const f = await createFolder(w.owner.id, w.owner.id, { name: 'Clientes' });
    await moveChatsToFolder(w.owner.id, w.vAdmin, [w.uno.id, w.tres.id], f.id);
    expect(counts(await kanbanBoard(w.vAdmin, 'team', { folderId: f.id }))).toEqual({ [KANBAN_NONE]: 1, [s.id]: 1 });
    // La carpeta de otra persona no le muestra nada a Ruth.
    expect((await kanbanBoard(w.vRuth, 'team', { folderId: f.id })).columns.every((c) => c.count === 0)).toBe(true);
  });
});

describe('Kanban: mis etapas', () => {
  it('son de cada persona: otra persona (ni un admin) no las ve, ni sabe dónde puse cada chat, ni las toca', async () => {
    const w = await world('kb-mine');
    const mine = await createStage(w.vRuth, 'me', { name: 'Llamar', color: 'red' });
    await moveKanbanCard(w.vRuth, 'me', w.uno.id, mine.id);
    expect(ids(await kanbanBoard(w.vRuth, 'me', {}), mine.id)).toEqual([w.uno.id]);
    expect((await kanbanBoard(w.vRuth, 'me', {})).canEditStages).toBe(true);

    for (const v of [w.vPablo, w.vAdmin]) {
      expect(await listStages(v, 'me')).toEqual([]);
      const b = await kanbanBoard(v, 'me', {});
      expect(b.columns.map((c) => c.id)).toEqual([KANBAN_NONE]);
      expect(ids(b, KANBAN_NONE)).toContain(w.uno.id);
      // El id de la etapa de Ruth es desconocido para los demás.
      await expect(moveKanbanCard(v, 'me', w.uno.id, mine.id)).rejects.toMatchObject({ code: 'not_found', status: 404 });
      await expect(updateStage(v, 'me', mine.id, { name: 'Otra' })).rejects.toMatchObject({ code: 'not_found', status: 404 });
      expect(await deleteStage(v, 'me', mine.id)).toBe(false);
      // Tampoco como etapa del equipo.
      await expect(moveKanbanCard(v, 'team', w.uno.id, mine.id)).rejects.toMatchObject({ status: 404 });
      expect(await reorderStages(v, 'me', [mine.id])).toEqual([]);
    }
    // Nada cambió para Ruth.
    expect((await listStages(w.vRuth, 'me')).map((s) => s.name)).toEqual(['Llamar']);
    expect(ids(await kanbanBoard(w.vRuth, 'me', {}), mine.id)).toEqual([w.uno.id]);
    // Una etapa propia no sirve en el tablero del equipo (aunque sea de quien mueve).
    await expect(moveKanbanCard(w.vRuth, 'team', w.uno.id, mine.id)).rejects.toMatchObject({ status: 404 });
    // Un chat que Ruth no ve no entra a su tablero.
    await expect(moveKanbanCard(w.vRuth, 'me', w.dos.id, mine.id)).rejects.toMatchObject({ status: 404 });
  });

  it('otro workspace: sus etapas y sus chats son ids desconocidos', async () => {
    const a = await world('kb-ws-a');
    const b = await world('kb-ws-b');
    const teamA = await createStage(a.vAdmin, 'team', { name: 'A' });
    const mineA = await createStage(a.vAdmin, 'me', { name: 'A mía' });
    await expect(moveKanbanCard(b.vAdmin, 'team', b.uno.id, teamA.id)).rejects.toMatchObject({ status: 404 });
    await expect(moveKanbanCard(b.vAdmin, 'me', b.uno.id, mineA.id)).rejects.toMatchObject({ status: 404 });
    await expect(moveKanbanCard(b.vAdmin, 'team', a.uno.id, KANBAN_NONE)).rejects.toMatchObject({ status: 404 });
    await expect(updateStage(b.vAdmin, 'team', teamA.id, { name: 'x' })).rejects.toMatchObject({ status: 404 });
    expect(await deleteStage(b.vAdmin, 'team', teamA.id)).toBe(false);
    expect(await listStages(b.vAdmin, 'team')).toEqual([]);
  });

  it('la vista, el tablero y las columnas plegadas se recuerdan por persona', async () => {
    const w = await world('kb-prefs');
    expect(await getKanbanPrefs(w.vRuth)).toEqual({ on: false, board: 'team' });
    await setKanbanPrefs(w.vRuth, { on: true, board: 'me', collapsed: { board: 'me', columns: [KANBAN_NONE] } });
    expect(await getKanbanPrefs(w.vRuth)).toEqual({ on: true, board: 'me' });
    expect(await getKanbanPrefs(w.vPablo)).toEqual({ on: false, board: 'team' });
    // Sin ?board= abre el último elegido, con lo que plegó.
    const b = await kanbanBoard(w.vRuth, null, {});
    expect(b.board).toBe('me');
    expect(b.collapsed).toEqual([KANBAN_NONE]);
    expect((await kanbanBoard(w.vPablo, 'me', {})).collapsed).toEqual([]);
    await expect(setKanbanPrefs(w.vRuth, { board: 'nada' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('Kanban: propiedad de HubSpot', () => {
  async function hubspotWorld(label: string, token = TOKEN) {
    const w = await world(label);
    await connectHubspot(w.owner.id, w.owner.id, TOKEN);
    await linkHubspot(w.owner.id, w.owner.id, w.acme.id, 'company', '9001');
    await linkHubspot(w.owner.id, w.owner.id, w.uno.id, 'company', '9002');
    if (token !== TOKEN) await connectHubspot(w.owner.id, w.owner.id, token);
    return w;
  }
  const patches = () => fakeHubspot().calls.filter((c) => c.method === 'PATCH' && /^\/crm\/v3\/objects\/companies\/\d+$/.test(c.path));

  it('las opciones son las columnas; sin empresa o sin valor, "Sin valor"; mover escribe en HubSpot', async () => {
    const w = await hubspotWorld('kb-hs');
    const board = await kanbanBoard(w.vAdmin, 'hs:plan_tier', {});
    expect(board.source).toBe('hs');
    expect(board.readOnly).toBeNull();
    expect(board.canEditStages).toBe(false);
    expect(board.columns.map((c) => c.id)).toEqual([KANBAN_NONE, 'starter', 'growth', 'scale']);
    expect(board.columns.map((c) => c.name).slice(1)).toEqual(['Starter', 'Growth', 'Scale']);
    expect(ids(board, 'growth')).toEqual([w.acme.id]);
    expect(ids(board, 'starter')).toEqual([w.uno.id]);
    expect(ids(board, KANBAN_NONE).sort()).toEqual([w.dos.id, w.tres.id].sort());
    expect(board.unlinked?.sort()).toEqual([w.dos.id, w.tres.id].sort());
    expect(board.hubspot.props.some((p) => p.name === 'plan_tier')).toBe(true);
    // Las de texto o varias opciones no son tableros.
    expect(board.hubspot.props.some((p) => p.name === 'city' || p.name === 'products_used')).toBe(false);

    fakeHubspot().calls.length = 0;
    await moveKanbanCard(w.vRuth, 'hs:plan_tier', w.acme.id, 'scale');
    expect(patches()).toHaveLength(1);
    expect(patches()[0]).toMatchObject({ path: '/crm/v3/objects/companies/9001', body: { properties: { plan_tier: 'scale' } } });
    expect(fakeHubspot().companies.get('9001')?.properties.plan_tier).toBe('scale');
    expect(ids(await kanbanBoard(w.vAdmin, 'hs:plan_tier', {}), 'scale')).toEqual([w.acme.id]);
    // A "Sin valor": vacía la propiedad.
    await moveKanbanCard(w.vAdmin, 'hs:plan_tier', w.uno.id, KANBAN_NONE);
    expect(fakeHubspot().companies.get('9002')?.properties.plan_tier ?? '').toBe('');
    // Un valor que no es una opción, un chat sin empresa o que no ve: no llega a HubSpot.
    fakeHubspot().calls.length = 0;
    await expect(moveKanbanCard(w.vAdmin, 'hs:plan_tier', w.acme.id, 'enterprise')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(moveKanbanCard(w.vAdmin, 'hs:plan_tier', w.tres.id, 'growth')).rejects.toMatchObject({ code: 'hubspot_not_linked' });
    await expect(moveKanbanCard(w.vRuth, 'hs:plan_tier', w.dos.id, 'growth')).rejects.toMatchObject({ status: 404 });
    await expect(moveKanbanCard(w.vAdmin, 'hs:no_such_prop', w.acme.id, 'growth')).rejects.toMatchObject({ status: 404 });
    expect(patches()).toHaveLength(0);
    // Una propiedad que ya no está: el tablero vuelve al del equipo.
    expect((await kanbanBoard(w.vAdmin, 'hs:no_such_prop', {})).board).toBe('team');
  });

  it('sin permiso de escritura de la clave el tablero es de solo lectura y mover no escribe', async () => {
    const w = await hubspotWorld('kb-hs-ro', 'pat-readonly-edit');
    const board = await kanbanBoard(w.vAdmin, 'hs:plan_tier', {});
    expect(board.readOnly).toBe('hubspot_scope');
    expect(ids(board, 'growth')).toEqual([w.acme.id]);
    fakeHubspot().calls.length = 0;
    await expect(moveKanbanCard(w.vAdmin, 'hs:plan_tier', w.acme.id, 'scale')).rejects.toMatchObject({ code: 'hubspot_missing_scopes:crm.objects.companies.write', status: 403 });
    expect(patches()).toHaveLength(0);
    // Un invitado tampoco mueve, con la clave que sea.
    const w2 = await hubspotWorld('kb-hs-guest');
    const guest = await groupsViewer(w2.owner.id, w2.ruth.id, 'guest');
    expect((await kanbanBoard(guest, 'hs:plan_tier', {})).readOnly).toBe('hubspot_role');
    await expect(moveKanbanCard(guest, 'hs:plan_tier', w2.acme.id, 'scale')).rejects.toMatchObject({ status: expect.any(Number) });
    expect(patches()).toHaveLength(0);
  });
});

describe('Kanban: rutas', () => {
  const asMember = (ws: { id: string }, person: { id: string }) => ({ ...ws, role: 'member', actingUser: { id: person.id } });
  const json = (url: string, method: string, body?: unknown) => new Request(`http://x${url}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });

  it('la etapa de otra persona es 404 en todas las rutas; un member no define las del equipo', async () => {
    const w = await world('kb-routes');
    session.user = asMember(w.owner, w.ruth);
    const made = await stagesRoute.POST(json('/api/groups/kanban/stages', 'POST', { scope: 'me', name: 'Seguir' }));
    expect(made.status).toBe(201);
    const stage = (await made.json()) as { id: string };
    expect((await stagesRoute.POST(json('/api/groups/kanban/stages', 'POST', { scope: 'team', name: 'X' }))).status).toBe(403);
    expect((await moveRoute.POST(json('/api/groups/kanban/move', 'POST', { chatId: w.uno.id, board: 'me', column: stage.id }))).status).toBe(200);

    session.user = asMember(w.owner, w.pablo);
    expect((await stagesRoute.PATCH(json('/api/groups/kanban/stages', 'PATCH', { scope: 'me', id: stage.id, name: 'Mío' }))).status).toBe(404);
    expect((await stagesRoute.DELETE(json(`/api/groups/kanban/stages?scope=me&id=${stage.id}`, 'DELETE'))).status).toBe(404);
    expect((await moveRoute.POST(json('/api/groups/kanban/move', 'POST', { chatId: w.uno.id, board: 'me', column: stage.id }))).status).toBe(404);
    const list = (await (await stagesRoute.GET(json('/api/groups/kanban/stages?scope=me', 'GET'))).json()) as { stages: unknown[] };
    expect(list.stages).toEqual([]);
    const board = (await (await boardRoute.GET(json('/api/groups/kanban?board=me', 'GET'))).json()) as { columns: Array<{ id: string; cards: Array<{ id: string }> }> };
    expect(board.columns.map((c) => c.id)).toEqual([KANBAN_NONE]);

    // El tablero de la ruta usa los mismos parámetros que la lista.
    session.user = { ...w.owner, role: 'owner' };
    const byLine = (await (await boardRoute.GET(json(`/api/groups/kanban?board=team&number=${w.priv.id}`, 'GET'))).json()) as { columns: Array<{ count: number }> };
    expect(byLine.columns.reduce((s, c) => s + c.count, 0)).toBe(1);
    const f = encodeURIComponent(JSON.stringify({ kinds: ['group'] }));
    const groups = (await (await boardRoute.GET(json(`/api/groups/kanban?board=team&f=${f}`, 'GET'))).json()) as { columns: Array<{ count: number }> };
    expect(groups.columns.reduce((s, c) => s + c.count, 0)).toBe(1);
    // Preferencias.
    expect((await boardRoute.PUT(json('/api/groups/kanban', 'PUT', { on: true }))).status).toBe(200);
    expect(await (await boardRoute.GET(json('/api/groups/kanban?prefs=1', 'GET'))).json()).toEqual({ on: true, board: 'team' });
    session.user = null;
    expect((await boardRoute.GET(json('/api/groups/kanban', 'GET'))).status).toBe(401);
  });

  it('lee los mismos parámetros que la lista de la bandeja', () => {
    const root = path.resolve(__dirname, '../..');
    const params = (file: string) => new Set([...fs.readFileSync(path.join(root, file), 'utf8').matchAll(/p\.(?:get|has)\('([a-z]+)'\)/g)].map((m) => m[1]));
    const list = params('app/api/groups/chats/route.ts');
    const kanban = params('lib/groups-chat-query.ts');
    // Lo que es solo de la lista: el paginado y lo que acompaña a la lista.
    for (const own of ['cursor', 'limit', 'offset', 'meta']) list.delete(own);
    expect([...list].filter((k) => !kanban.has(k))).toEqual([]);
  });
});
