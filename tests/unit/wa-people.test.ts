import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getNumberRowById, ingestEvents } from '@/lib/groups';
import { groupsViewer, systemViewer, updatePlatformSettings } from '@/lib/groups-access';
import { setLineAccess } from '@/lib/groups-lines';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { chatHubspot, connectHubspot } from '@/lib/groups-hubspot';
import { fakeHubspot, resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { contactHubspotMatches, createContactHubspot, linesContact, linkContactHubspot, listLinesContacts, unlinkContactHubspot } from '@/lib/groups-contacts';
import { inboxContact, inboxContactHubspot, inboxContactHubspotMatches, listInboxContacts } from '@/lib/inbox/contacts';
import { mergePeople, personId, personMatches, type PersonSighting } from '@/lib/wa-people';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));
const listRoute = await import('@/app/api/groups/people/route');
const personRoute = await import('@/app/api/groups/people/person/route');
const inboxListRoute = await import('@/app/api/inbox/people/route');
const inboxPersonRoute = await import('@/app/api/inbox/people/person/route');

const TOKEN = 'pat-na1-fake-token-for-contacts-tests';
// Datos inventados: el teléfono de Dana coincide con un contacto del HubSpot falso.
const DANA = '5491155550142';
const OTTO = '5491155550999';
const OTTO_LID = '204060801234567';

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

// ---------------------------------------------------------------------
// Puro
// ---------------------------------------------------------------------

const see = (over: Partial<PersonSighting>): PersonSighting => ({
  phone: '',
  lid: '',
  accountId: 'n1',
  kind: 'member',
  chatId: 'c1',
  groupKey: 'g1@g.us',
  chatName: 'Grupo',
  name: '',
  at: null,
  ...over,
});

describe('mergePeople', () => {
  it('teléfono y lid de la misma persona (por la libreta) son una sola, con sus líneas, grupos y chats', () => {
    const people = mergePeople(
      [
        see({ phone: OTTO, accountId: 'n1', kind: 'dm', chatId: 'dm1', groupKey: 'dm1', name: OTTO, at: '2026-11-01T00:00:00.000Z' }),
        see({ lid: OTTO_LID, accountId: 'n2', kind: 'dm', chatId: 'dm2', groupKey: 'dm2', name: 'Contacto de WhatsApp', at: '2026-11-03T00:00:00.000Z' }),
        see({ phone: OTTO, accountId: 'n1', chatId: 'g-a', groupKey: 'g@g.us', chatName: 'Acme', name: 'Otto M', at: '2026-11-02T00:00:00.000Z' }),
        see({ phone: OTTO, accountId: 'n2', chatId: 'g-b', groupKey: 'g@g.us', chatName: 'Acme', at: '2026-11-04T00:00:00.000Z' }),
        see({ phone: '5491100000001', accountId: 'n1', chatId: 'g-a', groupKey: 'g@g.us' }),
      ],
      [{ phone: OTTO, lid: OTTO_LID, saved: '', push: 'Otto' }],
      ['5491100000001'],
      ['Contacto de WhatsApp'],
    );
    expect(people).toHaveLength(1);
    const p = people[0];
    expect(p.identity).toBe(OTTO);
    expect(p.lid).toBe(OTTO_LID);
    expect(p.accountIds).toEqual(['n1', 'n2']);
    expect(p.dms.map((d) => d.chatId)).toEqual(['dm2', 'dm1']);
    // Un grupo en dos líneas es uno; se abre el chat con lo más reciente.
    expect(p.groups).toEqual([{ key: 'g@g.us', chatId: 'g-b', name: 'Acme', accountIds: ['n1', 'n2'] }]);
    // El nombre de miembro gana al de perfil; un número o el genérico del lid no son nombres.
    expect(p.name).toBe('Otto M');
    expect(p.lastAt).toBe('2026-11-04T00:00:00.000Z');
  });

  it('el nombre guardado en la libreta gana; un lid sin teléfono queda como persona propia', () => {
    const people = mergePeople(
      [see({ phone: DANA, kind: 'dm', chatId: 'd', groupKey: 'd', name: 'Dani' }), see({ lid: '99887766554433' })],
      [{ phone: DANA, lid: '', saved: 'Dana Rivers', push: '' }],
    );
    expect(people.map((p) => p.identity).sort()).toEqual([DANA, 'lid:99887766554433'].sort());
    expect(people.find((p) => p.phone === DANA)?.name).toBe('Dana Rivers');
  });

  it('búsqueda por nombre sin acentos y por dígitos solo si se ve el teléfono; el id no deja leer el teléfono', () => {
    const p = { name: 'José Pérez', phone: DANA };
    expect(personMatches(p, 'jose', false)).toBe(true);
    expect(personMatches(p, '5555', true)).toBe(true);
    expect(personMatches(p, '5555', false)).toBe(false);
    const id = personId('ws1', DANA);
    expect(id).toMatch(/^[a-f0-9]{24}$/);
    expect(id).not.toContain('5555');
    expect(personId('ws2', DANA)).not.toBe(id);
  });
});

// ---------------------------------------------------------------------
// Lines (con base)
// ---------------------------------------------------------------------

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

type Line = Awaited<ReturnType<typeof line>>;
const pid = () => `id-${Math.random().toString(36).slice(2)}`;

async function chatId(numberId: string, provider: string): Promise<string> {
  const r = (await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(numberId, provider)) as { id: string } | undefined;
  if (!r) throw new Error('chat');
  return r.id;
}

async function dm(row: Line, chat: string, sender: string, name: string) {
  await ingestEvents(row, [{ type: 'message', chatId: chat, isGroup: false, chatName: name, fromMe: false, senderPhone: sender, senderName: name, providerMessageId: pid(), body: 'Hola' }]);
  return chatId(row.id, chat);
}

async function group(row: Line, jid: string, name: string, members: Array<{ phone: string; name?: string }>) {
  await ingestEvents(row, [{ type: 'message', chatId: jid, isGroup: true, chatName: name, fromMe: false, senderPhone: members[0].phone, senderName: members[0].name ?? '', providerMessageId: pid(), body: 'Buen día' }]);
  const id = await chatId(row.id, jid);
  for (const m of members) await getDb().prepare('INSERT OR IGNORE INTO groups_members (chat_id, phone, name, role, created_at) VALUES (?, ?, ?, ?, ?)').run(id, m.phone, m.name ?? '', 'member', new Date().toISOString());
  return id;
}

async function book(ws: string, accountId: string, phone: string, lid: string, push = '') {
  const had = await getDb().prepare("UPDATE wa_contacts SET lid = ?, push_name = ? WHERE app = 'lines' AND account_id = ? AND phone = ?").run(lid, push, accountId, phone);
  if (had.changes > 0) return;
  await getDb()
    .prepare("INSERT INTO wa_contacts (id, app, account_id, user_id, phone, lid, saved_name, push_name, about, picture_url, updated_at) VALUES (?, 'lines', ?, ?, ?, ?, '', ?, '', '', ?)")
    .run(randomUUID(), accountId, ws, phone, lid, push, new Date().toISOString());
}

let jseq = 0;
const jid = () => `1203639${String(Date.now()).slice(-6)}${String(++jseq).padStart(4, '0')}@g.us`;

async function world(label: string) {
  const w = await workspaceWithMember(`people-${label}`);
  const ws = w.owner.id;
  const ventas = await line(ws, 'Ventas');
  const soporte = await line(ws, 'Soporte');
  const g = jid();
  const ga = await group(ventas, g, `Acme ${label}`, [{ phone: OTTO, name: 'Otto M' }, { phone: DANA }]);
  const gb = await group(soporte, g, `Acme ${label}`, [{ phone: OTTO }]);
  const danaDm = await dm(ventas, `${DANA}@s.whatsapp.net`, DANA, 'Dana');
  // Otto escribe por lid en Soporte (sin teléfono a la vista); la libreta de Ventas sabe de quién es.
  const ottoLidDm = await dm(soporte, `${OTTO_LID}@lid`, '', 'Contacto de WhatsApp');
  await book(ws, ventas.id, OTTO, OTTO_LID, 'Otto');
  return { ...w, ws, ventas, soporte, g, ga, gb, danaDm, ottoLidDm };
}

describe('Lines › Contactos', () => {
  it('cada persona una vez: teléfono y lid unidos, con líneas, grupos y chats', async () => {
    const w = await world('merge');
    const dto = await listLinesContacts(systemViewer(w.ws));
    const otto = dto.rows.filter((r) => r.phone === OTTO);
    expect(otto).toHaveLength(1);
    expect(otto[0].name).toBe('Otto M');
    expect(otto[0].lines.sort()).toEqual([w.ventas.id, w.soporte.id].sort());
    expect(otto[0].groupCount).toBe(1);
    expect(otto[0].dms.map((d) => d.chatId)).toEqual([w.ottoLidDm]);
    expect(otto[0].lastMessageAt).not.toBeNull();
    const dana = dto.rows.find((r) => r.phone === DANA)!;
    expect(dana.lines).toEqual([w.ventas.id]);
    expect(dana.dms).toEqual([{ chatId: w.danaDm, numberId: w.ventas.id }]);
    expect(dto.hubspot).toBe(false);
    expect(dana.hubspot).toBeNull();
    // Filtros: línea, solo con chat, búsqueda.
    const soporte = (await listLinesContacts(systemViewer(w.ws), { lines: [w.soporte.id] })).rows.map((r) => r.phone);
    expect(soporte).toContain(OTTO);
    expect(soporte).not.toContain(DANA);
    expect((await listLinesContacts(systemViewer(w.ws), { chat: 'dm' })).rows.map((r) => r.phone).sort()).toEqual([DANA, OTTO].sort());
    expect((await listLinesContacts(systemViewer(w.ws), { q: 'otto' })).rows.map((r) => r.phone)).toEqual([OTTO]);
    // La ficha trae el grupo y el chat 1:1.
    const detail = await linesContact(systemViewer(w.ws), otto[0].id);
    expect(detail.row.groups.map((g) => g.chatId)).toContain(w.gb);
    expect(detail.row.dms.map((d) => d.chatId)).toEqual([w.ottoLidDm]);
  });

  it('quien no ve una línea no ve a quien solo está ahí, ni esa línea; con teléfonos ocultos no ve el número', async () => {
    const w = await world('access');
    const reservada = await line(w.ws, 'Reservada');
    const secret = '5491166660000';
    await dm(reservada, `${secret}@s.whatsapp.net`, secret, 'Reservado');
    await setLineAccess(w.ws, reservada.id, { ownerId: w.ws, visibility: 'restricted', personIds: [], teamIds: [] });
    const viewer = await groupsViewer(w.ws, w.member.id, 'member');
    const seen = await listLinesContacts(viewer);
    expect(seen.rows.some((r) => r.phone === secret)).toBe(false);
    const ownerView = await listLinesContacts(systemViewer(w.ws));
    const hidden = ownerView.rows.find((r) => r.phone === secret)!;
    await expect(linesContact(viewer, hidden.id)).rejects.toMatchObject({ status: 404 });
    // Con acceso por etiqueta y sin etiquetas, nadie.
    await updatePlatformSettings(w.ws, { labelAccess: true });
    expect((await listLinesContacts(await groupsViewer(w.ws, w.member.id, 'member'))).rows).toEqual([]);
    await updatePlatformSettings(w.ws, { labelAccess: false, maskRoles: ['member'] });
    const masked = await listLinesContacts(await groupsViewer(w.ws, w.member.id, 'member'));
    expect(masked.rows.every((r) => !r.phone || (r.masked && r.phone.includes('•••')))).toBe(true);
    expect((await listLinesContacts(await groupsViewer(w.ws, w.member.id, 'member'), { q: '5555' })).rows).toEqual([]);
  });

  it('HubSpot: busca por teléfono, vincula contacto y empresa (también en el chat 1:1), quita y crea sin duplicar', async () => {
    const w = await world('hubspot');
    await connectHubspot(w.ws, w.ws, TOKEN);
    const v = systemViewer(w.ws);
    const rows = (await listLinesContacts(v)).rows;
    const dana = rows.find((r) => r.phone === DANA)!;
    const otto = rows.find((r) => r.phone === OTTO)!;
    expect(dana.hubspot).toEqual({ contact: null, company: null });
    const matches = await contactHubspotMatches(v, dana.id);
    expect(matches.map((m) => m.contact.id)).toEqual(['7001']);

    const linked = await linkContactHubspot(v, w.ws, dana.id, '7001');
    expect(linked.hubspot?.contact).toMatchObject({ id: '7001', name: 'Dana Rivers', broken: false });
    expect(linked.hubspot?.company).toMatchObject({ id: '9001', name: 'Acme Logistics' });
    // El chat 1:1 lo ve en su panel.
    expect((await chatHubspot(w.ws, w.danaDm)).links.map((l) => `${l.type}:${l.id}`).sort()).toEqual(['company:9001', 'contact:7001']);
    expect((await listLinesContacts(v, { hubspot: 'linked' })).rows.map((r) => r.phone)).toEqual([DANA]);
    const notLinked = (await listLinesContacts(v, { hubspot: 'unlinked' })).rows.map((r) => r.phone);
    expect(notLinked).toContain(OTTO);
    expect(notLinked).not.toContain(DANA);

    const unlinked = await unlinkContactHubspot(v, dana.id);
    expect(unlinked.hubspot?.contact).toBeNull();
    expect((await chatHubspot(w.ws, w.danaDm)).links.some((l) => l.type === 'contact')).toBe(false);

    // Crear: con un contacto que ya tiene ese teléfono, no crea y lo devuelve.
    const before = fakeHubspot().contacts.size;
    const again = await createContactHubspot(v, w.ws, dana.id);
    expect(again.row).toBeNull();
    expect(again.existing.map((m) => m.contact.id)).toEqual(['7001']);
    expect(fakeHubspot().contacts.size).toBe(before);
    // Sin coincidencias: lo crea con el teléfono, asociado a la empresa de su grupo (sin crear empresa), y queda vinculado.
    const now = new Date().toISOString();
    await getDb()
      .prepare("INSERT INTO groups_identities (user_id, jid, company_id, created_at, updated_at) VALUES (?, ?, '9002', ?, ?) ON CONFLICT(user_id, jid) DO UPDATE SET company_id = '9002'")
      .run(w.ws, w.g, now, now);
    const companies = fakeHubspot().companies.size;
    const created = await createContactHubspot(v, w.ws, otto.id);
    expect(fakeHubspot().contacts.size).toBe(before + 1);
    expect(fakeHubspot().companies.size).toBe(companies);
    expect(created.row?.hubspot?.contact?.name).toBe('Otto M');
    expect(created.row?.hubspot?.company).toMatchObject({ id: '9002' });
    const post = fakeHubspot().calls.filter((c) => c.method === 'POST' && c.path === '/crm/v3/objects/contacts');
    expect(post).toHaveLength(1);
    expect(post[0].body).toMatchObject({ properties: { phone: `+${OTTO}` }, associations: [{ to: { id: '9002' } }] });
    // Crear otra vez encuentra el que se acaba de crear.
    expect((await createContactHubspot(v, w.ws, otto.id)).row).toBeNull();
  });
});

describe('rutas de contactos', () => {
  it('anónimo 401, otro workspace no encuentra la persona, invitado no escribe, el owner sí', async () => {
    const w = await world('routes');
    const req = (url: string, body?: unknown) =>
      new Request(`http://localhost${url}`, body ? { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : undefined);
    session.user = null;
    expect((await listRoute.GET(req('/api/groups/people'))).status).toBe(401);

    session.user = asOwner(w.owner) as unknown as Record<string, unknown>;
    const list = (await (await listRoute.GET(req('/api/groups/people'))).json()) as { rows: Array<{ id: string; phone: string }> };
    const dana = list.rows.find((r) => r.phone === DANA)!;
    expect((await personRoute.GET(req(`/api/groups/people/person?id=${dana.id}`))).status).toBe(200);
    const msg = await personRoute.POST(req('/api/groups/people/person', { id: dana.id, action: 'message' }));
    expect(await msg.json()).toMatchObject({ id: w.danaDm });

    session.user = asOwner(w.stranger) as unknown as Record<string, unknown>;
    expect((await personRoute.GET(req(`/api/groups/people/person?id=${dana.id}`))).status).toBe(404);
    expect(((await (await listRoute.GET(req('/api/groups/people'))).json()) as { rows: unknown[] }).rows).toEqual([]);

    session.user = asMember(w.owner, w.friend, 'guest') as unknown as Record<string, unknown>;
    expect((await personRoute.POST(req('/api/groups/people/person', { id: dana.id, action: 'unlink' }))).status).toBe(403);
  });
});

// ---------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------

async function inboxAccount(owner: string, address: string) {
  const id = `iba_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const now = new Date().toISOString();
  await getDb()
    .prepare("INSERT INTO inbox_accounts (id, owner_id, kind, provider, label, address, status, created_at, updated_at) VALUES (?, ?, 'whatsapp', 'fake', 'WA', ?, 'connected', ?, ?)")
    .run(id, owner, address, now, now);
  return id;
}

async function thread(owner: string, account: string, t: { kind: 'dm' | 'group'; external: string; handle?: string; title: string; info?: unknown; at?: string }) {
  const id = `ibt_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const now = t.at ?? new Date().toISOString();
  await getDb()
    .prepare(
      "INSERT INTO inbox_threads (id, owner_id, account_id, channel, kind, external_id, title, handle, last_message_at, info, created_at, updated_at) VALUES (?, ?, ?, 'whatsapp', ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, owner, account, t.kind, t.external, t.title, t.handle ?? '', now, t.info ? JSON.stringify(t.info) : '', now, now);
  return id;
}

describe('Inbox › Contactos', () => {
  it('una persona una vez entre chat y grupos; otra persona no la encuentra', async () => {
    const me = await makeUser('people-inbox-me');
    const other = await makeUser('people-inbox-other');
    const acc = await inboxAccount(me.id, '5491100000002');
    const dmId = await thread(me.id, acc, { kind: 'dm', external: `${DANA}@s.whatsapp.net`, handle: DANA, title: 'Dana' });
    const g = await thread(me.id, acc, {
      kind: 'group',
      external: jid(),
      title: 'Familia',
      info: { about: '', participants: [{ phone: DANA, role: 'member' }, { phone: '5491100000002', role: 'admin' }], size: 2 },
    });
    const dto = await listInboxContacts(me.id, null);
    expect(dto.rows).toHaveLength(1);
    expect(dto.rows[0]).toMatchObject({ phone: DANA, name: 'Dana', lines: [acc], groupCount: 1, dms: [{ chatId: dmId, numberId: acc }], hubspot: null });
    const detail = await inboxContact(me.id, null, dto.rows[0].id);
    expect(detail.row.groups.map((x) => x.chatId)).toEqual([g]);
    await expect(inboxContact(other.id, null, dto.rows[0].id)).rejects.toMatchObject({ status: 404 });
    expect((await listInboxContacts(other.id, null)).rows).toEqual([]);

    // Rutas: anónimo 401, la persona la ve.
    session.user = null;
    expect((await inboxListRoute.GET(new Request('http://localhost/api/inbox/people'))).status).toBe(401);
    session.user = asOwner(me) as unknown as Record<string, unknown>;
    expect((await inboxPersonRoute.GET(new Request(`http://localhost/api/inbox/people/person?id=${dto.rows[0].id}`))).status).toBe(200);
    session.user = asOwner(other) as unknown as Record<string, unknown>;
    expect((await inboxPersonRoute.GET(new Request(`http://localhost/api/inbox/people/person?id=${dto.rows[0].id}`))).status).toBe(404);
  });

  it('HubSpot del workspace: vincula desde Inbox y Lines ve el mismo vínculo; crear no duplica', async () => {
    const w = await world('inbox-hs');
    await connectHubspot(w.ws, w.ws, TOKEN);
    const acc = await inboxAccount(w.ws, '5491100000003');
    await thread(w.ws, acc, { kind: 'dm', external: `${DANA}@s.whatsapp.net`, handle: DANA, title: 'Dana' });
    const scope = { ws: w.ws, me: w.ws, mask: false };
    const dana = (await listInboxContacts(w.ws, scope)).rows.find((r) => r.phone === DANA)!;
    expect(dana.hubspot).toEqual({ contact: null, company: null });
    expect((await inboxContactHubspotMatches(w.ws, scope, dana.id)).map((m) => m.contact.id)).toEqual(['7001']);
    const linked = await inboxContactHubspot(w.ws, scope, dana.id, { kind: 'link', contactId: '7001' });
    expect(linked.row?.hubspot).toMatchObject({ contact: { id: '7001' }, company: { id: '9001' } });
    // Una sola fila de vínculo por persona en el workspace: Lines la ve, y su chat 1:1 también.
    const linesDana = (await listLinesContacts(systemViewer(w.ws))).rows.find((r) => r.phone === DANA)!;
    expect(linesDana.hubspot?.contact?.id).toBe('7001');
    expect((await getDb().prepare('SELECT COUNT(*) AS n FROM groups_contact_links WHERE user_id = ? AND phone = ?').get(w.ws, DANA)) as { n: number }).toMatchObject({ n: 1 });
    expect((await chatHubspot(w.ws, w.danaDm)).links.map((l) => `${l.type}:${l.id}`).sort()).toEqual(['company:9001', 'contact:7001']);
    // Crear con un teléfono que ya está: no crea.
    const before = fakeHubspot().contacts.size;
    await inboxContactHubspot(w.ws, scope, dana.id, { kind: 'unlink' });
    const created = await inboxContactHubspot(w.ws, scope, dana.id, { kind: 'create' });
    expect(created.row).toBeNull();
    expect(created.existing.map((m) => m.contact.id)).toEqual(['7001']);
    expect(fakeHubspot().contacts.size).toBe(before);

    // Rutas: un invitado no escribe; el dueño sí.
    session.user = asMember(w.owner, w.friend, 'guest') as unknown as Record<string, unknown>;
    expect((await inboxPersonRoute.POST(new Request('http://localhost/api/inbox/people/person', { method: 'POST', body: JSON.stringify({ id: dana.id, action: 'unlink' }) }))).status).toBe(403);
  });
});
