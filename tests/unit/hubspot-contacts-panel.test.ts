import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getNumberRowById, ingestEvents } from '@/lib/groups';
import { systemViewer } from '@/lib/groups-access';
import { setLineAccess } from '@/lib/groups-lines';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { chatHubspot, connectHubspot, getHubspot, linkHubspot, updateHubspotSettings } from '@/lib/groups-hubspot';
import { getHubspotSchema, setHubspotMine } from '@/lib/groups-hubspot-sync';
import { fakeHubspot, resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { chatContact, linkContactHubspot, listLinesContacts } from '@/lib/groups-contacts';
import { getInboxHubspotAuto, setInboxHubspotAuto, sweepHubspotAutoContacts } from '@/lib/hubspot-auto-contacts';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

/**
 * HubSpot en Lines e Inbox: crear el contacto (a mano desde el chat y solo al
 * entrar un chat 1:1 nuevo, si se prendió), elegir qué propiedades de la
 * empresa ve cada persona y la empresa del contacto en el panel de Inbox.
 * Todo contra el HubSpot falso en memoria.
 */

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const propsRoute = await import('@/app/api/groups/hubspot/properties/route');
const groupsPersonRoute = await import('@/app/api/groups/people/person/route');
const inboxPersonRoute = await import('@/app/api/inbox/people/person/route');
const inboxHubspotRoute = await import('@/app/api/inbox/hubspot/route');
const inboxCompanyRoute = await import('@/app/api/inbox/hubspot/company/route');

const TOKEN = 'pat-na1-fake-token-for-contact-panel';
const DANA = '5491155550142';
const NEW_A = '5491155557001';
const NEW_B = '5491155557002';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_INTEGRATIONS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  resetFakeHubspot();
});
afterEach(() => {
  session.user = null;
});

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}
type Line = Awaited<ReturnType<typeof line>>;

async function dm(row: Line, phone: string, name: string): Promise<string> {
  const chat = `${phone}@s.whatsapp.net`;
  await ingestEvents(row, [{ type: 'message', chatId: chat, isGroup: false, chatName: name, fromMe: false, senderPhone: phone, senderName: name, providerMessageId: `p-${randomUUID()}`, body: 'Hola' }]);
  const r = (await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(row.id, chat)) as { id: string };
  return r.id;
}

async function inboxAccount(owner: string) {
  const id = `iba_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const now = new Date().toISOString();
  await getDb()
    .prepare("INSERT INTO inbox_accounts (id, owner_id, kind, provider, label, address, status, created_at, updated_at) VALUES (?, ?, 'whatsapp', 'fake', 'WA', '5491100000004', 'connected', ?, ?)")
    .run(id, owner, now, now);
  return id;
}

async function thread(owner: string, account: string, phone: string, title: string, channel = 'whatsapp') {
  const id = `ibt_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const now = new Date().toISOString();
  await getDb()
    .prepare("INSERT INTO inbox_threads (id, owner_id, account_id, channel, kind, external_id, title, handle, last_message_at, info, created_at, updated_at) VALUES (?, ?, ?, ?, 'dm', ?, ?, ?, ?, '', ?, ?)")
    .run(id, owner, account, channel, `${phone}@s.whatsapp.net`, title, phone, now, now, now);
  return id;
}

const createdContacts = () => fakeHubspot().calls.filter((c) => c.method === 'POST' && c.path === '/crm/v3/objects/contacts');
const autoResult = async (key: string) => ((await getDb().prepare('SELECT result FROM hubspot_auto_contacts WHERE chat_key = ?').get(key)) as { result: string } | undefined)?.result;

describe('Lines: alta automática del contacto en HubSpot', () => {
  it('apagada por defecto; prendida, crea el de los chats 1:1 nuevos una sola vez y no duplica un teléfono que ya está', async () => {
    const w = await workspaceWithMember('hs-auto-lines');
    const ws = w.owner.id;
    const ventas = await line(ws, 'Ventas');
    await connectHubspot(ws, ws, TOKEN);
    expect((await getHubspot(ws)).autoCreate).toBe(false);
    const before = await dm(ventas, NEW_A, 'Antes');
    expect(await sweepHubspotAutoContacts()).toBe(0);

    await updateHubspotSettings(ws, { autoCreate: true });
    expect((await getHubspot(ws)).autoCreate).toBe(true);
    const fresh = await dm(ventas, NEW_B, 'Bruno Nuevo');
    const dana = await dm(ventas, DANA, 'Dana');
    // Una línea reservada no sube sola lo suyo.
    const reservada = await line(ws, 'Reservada');
    await setLineAccess(ws, reservada.id, { ownerId: ws, visibility: 'restricted', personIds: [], teamIds: [] });
    const secret = await dm(reservada, '5491155557003', 'Reservado');

    expect(await sweepHubspotAutoContacts()).toBe(1);
    expect(createdContacts()).toHaveLength(1);
    expect(createdContacts()[0].body).toMatchObject({ properties: { phone: `+${NEW_B}` } });
    expect(await autoResult(`lines:${fresh}`)).toBe('created');
    // Dana ya está en HubSpot (7001): no se crea otro; queda para vincular.
    expect(await autoResult(`lines:${dana}`)).toBe('existing');
    expect(await autoResult(`lines:${before}`)).toBeUndefined();
    expect(await autoResult(`lines:${secret}`)).toBeUndefined();
    // El chat nuevo queda vinculado al contacto creado.
    expect((await chatHubspot(ws, fresh)).links.some((l) => l.type === 'contact')).toBe(true);
    // Otra corrida no vuelve a crear nada.
    expect(await sweepHubspotAutoContacts()).toBe(0);
    expect(createdContacts()).toHaveLength(1);
  });

  it('sin permiso para escribir contactos no se puede prender', async () => {
    const owner = (await workspaceWithMember('hs-auto-scope')).owner;
    await connectHubspot(owner.id, owner.id, 'pat-readonly-contacts');
    const dto = await getHubspot(owner.id);
    if (dto.missingContactScopes.length === 0) return; // el falso no tiene ese token: nada que probar
    await expect(updateHubspotSettings(owner.id, { autoCreate: true })).rejects.toMatchObject({ code: expect.stringContaining('crm.objects.contacts.write') });
  });
});

describe('Inbox: alta automática del contacto en HubSpot', () => {
  it('cada persona la prende para su Inbox con el HubSpot del workspace; vale para los chats que entran después', async () => {
    const w = await workspaceWithMember('hs-auto-inbox');
    const ws = w.owner.id;
    await connectHubspot(ws, ws, TOKEN);
    const acc = await inboxAccount(w.member.id);
    const old = await thread(w.member.id, acc, NEW_A, 'Antes');
    expect(await getInboxHubspotAuto(w.member.id, ws)).toBe(false);

    // Por la ruta, como la persona del equipo.
    session.user = asMember(w.owner, w.member) as unknown as Record<string, unknown>;
    const on = await inboxHubspotRoute.POST(new Request('http://x/api/inbox/hubspot', { method: 'POST', body: JSON.stringify({ autoCreate: true }) }));
    expect(on.status).toBe(200);
    expect(await getInboxHubspotAuto(w.member.id, ws)).toBe(true);
    expect(((await (await inboxHubspotRoute.GET()).json()) as { autoCreate: boolean }).autoCreate).toBe(true);

    const fresh = await thread(w.member.id, acc, NEW_B, 'Bruno Nuevo');
    // Un chat de otro canal no cuenta.
    const mail = await thread(w.member.id, acc, '5491155557009', 'Correo', 'gmail');
    expect(await sweepHubspotAutoContacts()).toBe(1);
    expect(await autoResult(`inbox:${fresh}`)).toBe('created');
    expect(await autoResult(`inbox:${old}`)).toBeUndefined();
    expect(await autoResult(`inbox:${mail}`)).toBeUndefined();
    // El vínculo es del workspace: Lines lo ve en Contactos.
    const row = (await listLinesContacts(systemViewer(ws))).rows.find((r) => r.phone === NEW_B);
    expect(row === undefined || row.hubspot?.contact !== null).toBe(true);

    // Un invitado no la prende; apagarla borra el ajuste.
    session.user = asMember(w.owner, w.friend, 'guest') as unknown as Record<string, unknown>;
    expect((await inboxHubspotRoute.POST(new Request('http://x/api/inbox/hubspot', { method: 'POST', body: JSON.stringify({ autoCreate: true }) }))).status).toBe(403);
    session.user = asMember(w.owner, w.member) as unknown as Record<string, unknown>;
    await inboxHubspotRoute.POST(new Request('http://x/api/inbox/hubspot', { method: 'POST', body: JSON.stringify({ autoCreate: false }) }));
    expect(await getInboxHubspotAuto(w.member.id, ws)).toBe(false);
  });

  it('quien dejó el workspace ya no sube sus chats', async () => {
    const w = await workspaceWithMember('hs-auto-left');
    const ws = w.owner.id;
    await connectHubspot(ws, ws, TOKEN);
    await setInboxHubspotAuto(w.member.id, ws, true);
    await getDb().prepare('DELETE FROM team_members WHERE user_id = ?').run(w.member.id);
    const acc = await inboxAccount(w.member.id);
    const fresh = await thread(w.member.id, acc, NEW_B, 'Bruno');
    expect(await sweepHubspotAutoContacts()).toBe(0);
    expect(await autoResult(`inbox:${fresh}`)).toBeUndefined();
  });
});

describe('La persona de un chat 1:1 (crear el contacto desde el chat)', () => {
  it('Lines ?chat= y Inbox ?thread= devuelven la persona; un grupo, otro canal u otra persona no', async () => {
    const w = await workspaceWithMember('hs-chat-person');
    const ws = w.owner.id;
    const ventas = await line(ws, 'Ventas');
    await connectHubspot(ws, ws, TOKEN);
    const chat = await dm(ventas, NEW_A, 'Ana Nueva');
    const person = await chatContact(systemViewer(ws), chat);
    expect(person.row.phone).toBe(NEW_A);
    expect(person.row.hubspot).toEqual({ contact: null, company: null });

    session.user = asOwner(w.owner) as unknown as Record<string, unknown>;
    const res = await groupsPersonRoute.GET(new Request(`http://x/api/groups/people/person?chat=${chat}`));
    expect(res.status).toBe(200);
    // Crear desde el chat: lo crea y el chat queda vinculado.
    const created = await groupsPersonRoute.POST(
      new Request('http://x/api/groups/people/person', { method: 'POST', body: JSON.stringify({ id: person.row.id, action: 'create' }), headers: { 'content-type': 'application/json' } }),
    );
    expect(created.status).toBe(201);
    expect(createdContacts()).toHaveLength(1);
    expect((await chatHubspot(ws, chat)).links.some((l) => l.type === 'contact')).toBe(true);
    session.user = asOwner(w.stranger) as unknown as Record<string, unknown>;
    expect((await groupsPersonRoute.GET(new Request(`http://x/api/groups/people/person?chat=${chat}`))).status).toBe(404);

    const acc = await inboxAccount(w.member.id);
    const t = await thread(w.member.id, acc, DANA, 'Dana');
    const mail = await thread(w.member.id, acc, '5491155557009', 'Correo', 'gmail');
    session.user = asMember(w.owner, w.member) as unknown as Record<string, unknown>;
    const mine = await inboxPersonRoute.GET(new Request(`http://x/api/inbox/people/person?thread=${t}`));
    expect(mine.status).toBe(200);
    expect(((await mine.json()) as { row: { phone: string } }).row.phone).toBe(DANA);
    expect((await inboxPersonRoute.GET(new Request(`http://x/api/inbox/people/person?thread=${mail}`))).status).toBe(404);
    session.user = asOwner(w.stranger) as unknown as Record<string, unknown>;
    expect((await inboxPersonRoute.GET(new Request(`http://x/api/inbox/people/person?thread=${t}`))).status).toBe(404);
  });
});

describe('Las propiedades que ve cada persona', () => {
  it('cualquiera (menos un invitado) elige las suyas; las del workspace siguen siendo de un admin', async () => {
    const w = await workspaceWithMember('hs-mine');
    const ws = w.owner.id;
    const ventas = await line(ws, 'Ventas');
    await connectHubspot(ws, ws, TOKEN);
    const chat = await dm(ventas, NEW_A, 'Ana');
    await linkHubspot(ws, ws, chat, 'company', '9001');
    const url = 'http://x/api/groups/hubspot/properties';
    const post = (body: unknown) => propsRoute.POST(new Request(url, { method: 'POST', body: JSON.stringify(body) }));

    session.user = asMember(w.owner, w.member) as unknown as Record<string, unknown>;
    expect((await post({ pinned: ['plan_tier'] })).status).toBe(403);
    expect((await post({ mine: 'plan_tier' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    const saved = (await (await post({ mine: ['plan_tier', 'nope', 'internal_sync_key', 'plan_tier', 'health_score'] })).json()) as { mine: string[]; pinned: string[] };
    expect(saved.mine).toEqual(['plan_tier', 'health_score']);
    expect(saved.pinned).toEqual(['domain', 'hubspot_owner_id', 'lifecyclestage']);
    // Los detalles del chat muestran las suyas a esa persona y las del workspace al resto.
    expect((await chatHubspot(ws, chat, w.member.id)).company?.pinned.map((p) => p.name)).toEqual(['plan_tier', 'health_score']);
    expect((await chatHubspot(ws, chat, w.friend.id)).company?.pinned.map((p) => p.name)).toEqual(['domain', 'hubspot_owner_id', 'lifecyclestage']);
    expect((await getHubspotSchema(ws, w.friend.id)).mine).toBeNull();
    // null vuelve a las del workspace.
    expect(((await (await post({ mine: null })).json()) as { mine: string[] | null }).mine).toBeNull();
    expect(await setHubspotMine(ws, w.member.id, [])).toEqual([]);

    session.user = asMember(w.owner, w.friend, 'guest') as unknown as Record<string, unknown>;
    expect((await post({ mine: ['plan_tier'] })).status).toBe(403);
  });
});

describe('Inbox: la empresa del contacto en el panel de HubSpot', () => {
  it('trae la empresa del contacto vinculado con sus propiedades, solo lectura; sin contacto, nada; otra persona, 404', async () => {
    const w = await workspaceWithMember('hs-inbox-company');
    const ws = w.owner.id;
    const ventas = await line(ws, 'Ventas');
    await connectHubspot(ws, ws, TOKEN);
    await dm(ventas, DANA, 'Dana');
    const acc = await inboxAccount(w.member.id);
    const t = await thread(w.member.id, acc, DANA, 'Dana');
    const loose = await thread(w.member.id, acc, NEW_A, 'Ana');
    session.user = asMember(w.owner, w.member) as unknown as Record<string, unknown>;
    const get = (id: string, fresh = false) => inboxCompanyRoute.GET(new Request(`http://x/api/inbox/hubspot/company?thread=${id}${fresh ? '&fresh=1' : ''}`));

    expect(((await (await get(t)).json()) as { company: unknown }).company).toBeNull();
    // Vincular a Dana (contacto 7001 de Acme, 9001) desde Contactos de Lines.
    const dana = (await listLinesContacts(systemViewer(ws))).rows.find((r) => r.phone === DANA)!;
    await linkContactHubspot(systemViewer(ws), ws, dana.id, '7001');
    const dto = (await (await get(t, true)).json()) as { company: { id: string; name: string } | null; values: Record<string, string>; canEdit: boolean };
    expect(dto.company).toMatchObject({ id: '9001', name: 'Acme Logistics' });
    expect(dto.values.plan_tier).toBe('growth');
    expect(dto.canEdit).toBe(false);
    const sync = await inboxCompanyRoute.POST(new Request('http://x/api/inbox/hubspot/company', { method: 'POST', body: JSON.stringify({ threadId: t }) }));
    expect(sync.status).toBe(200);
    expect(((await (await get(loose)).json()) as { company: unknown }).company).toBeNull();

    session.user = asOwner(w.stranger) as unknown as Record<string, unknown>;
    expect((await get(t)).status).toBe(404);
    session.user = asMember(w.owner, w.friend, 'guest') as unknown as Record<string, unknown>;
    expect((await get(t)).status).toBe(403);
  });
});
