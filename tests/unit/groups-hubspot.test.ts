import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { setLineAccess } from '@/lib/groups-lines';
import { runGroupsCron } from '@/lib/groups-cron';
import {
  HubspotError,
  chatHubspot,
  connectHubspot,
  disconnectHubspot,
  getHubspot,
  linkHubspot,
  logChatToHubspot,
  samePhone,
  searchHubspot,
  sweepHubspotAutoLink,
  syncHubspotNotes,
  unlinkHubspot,
  updateHubspotSettings,
} from '@/lib/groups-hubspot';
import { FAKE_HUBSPOT_PORTAL, fakeHubspot, resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { makeUser } from './helpers';

/** Sesión que usan las rutas (getCurrentUser), para probar como otra persona. */
const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const linksRoute = await import('@/app/api/groups/hubspot/links/route');
const searchRoute = await import('@/app/api/groups/hubspot/search/route');
const logRoute = await import('@/app/api/groups/hubspot/log/route');
const connRoute = await import('@/app/api/groups/hubspot/route');

const TOKEN = 'pat-na1-fake-token-for-tests';

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

const msg = (chatId: string, id: string, body: string, senderName: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  chatName: chatId.endsWith('@g.us') ? senderName : undefined,
  fromMe: false,
  senderPhone: chatId.endsWith('@g.us') ? '5491100000009' : chatId.split('@')[0],
  senderName,
  providerMessageId: id,
  body,
});

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

async function chatNamed(ws: string, name: string) {
  const c = (await listChats(ws, ws)).rows.find((r) => r.name === name);
  if (!c) throw new Error(`chat ${name}`);
  return c;
}

/** Workspace conectado a HubSpot con un chat 1 a 1 (teléfono de Dana) y un grupo. */
async function world(label: string) {
  const owner = await makeUser(`${label}-ws`);
  const row = await line(owner.id, 'Ventas');
  await ingestEvents(row, [msg('5491155550142@c.us', `${label}-d1`, 'Hola, ¿llegó el pedido?', 'Dana'), msg(`1203630${label.length}@g.us`, `${label}-g1`, 'Arrancamos el piloto', 'Grupo Acme')]);
  await connectHubspot(owner.id, owner.id, TOKEN);
  return { owner, row, dm: await chatNamed(owner.id, 'Dana'), group: await chatNamed(owner.id, 'Grupo Acme') };
}

const notePosts = () => fakeHubspot().calls.filter((c) => c.method === 'POST' && c.path === '/crm/v3/objects/notes');
const notePatches = () => fakeHubspot().calls.filter((c) => c.method === 'PATCH' && c.path.startsWith('/crm/v3/objects/notes/'));

describe('HubSpot: conexión', () => {
  it('valida el token, dice qué permisos faltan y nunca devuelve el token', async () => {
    const ws = await makeUser('hs-conn');
    await expect(connectHubspot(ws.id, ws.id, 'not-a-token')).rejects.toMatchObject({ code: 'hubspot_invalid_token' });
    await expect(connectHubspot(ws.id, ws.id, '   ')).rejects.toMatchObject({ code: 'hubspot_invalid_token' });
    await expect(connectHubspot(ws.id, ws.id, 'pat-noscope-1')).rejects.toMatchObject({ code: 'hubspot_missing_scopes:crm.objects.companies.read crm.objects.deals.read' });
    expect((await getHubspot(ws.id)).connected).toBe(false);

    const dto = await connectHubspot(ws.id, ws.id, TOKEN);
    expect(dto).toMatchObject({ connected: true, portalId: FAKE_HUBSPOT_PORTAL, autoLink: false, logNotes: false, missingLogScopes: [] });
    expect(JSON.stringify(dto)).not.toContain(TOKEN);
    const stored = (await getDb().prepare('SELECT token FROM groups_hubspot WHERE user_id = ?').get(ws.id)) as { token: string };
    expect(stored.token).not.toContain(TOKEN);
    expect(stored.token.length).toBeGreaterThan(10);
    // El registro de llamadas del servidor falso tampoco lo guarda.
    expect(JSON.stringify(fakeHubspot().calls)).not.toContain(TOKEN);
  });

  it('sin permiso de escritura no se puede prender el registro; desconectar apaga todo', async () => {
    const ws = await makeUser('hs-ro');
    const dto = await connectHubspot(ws.id, ws.id, 'pat-readonly-1');
    expect(dto.missingLogScopes).toContain('crm.objects.contacts.write');
    await expect(updateHubspotSettings(ws.id, { logNotes: true })).rejects.toMatchObject({ code: 'hubspot_missing_scopes:crm.objects.contacts.write' });
    expect((await updateHubspotSettings(ws.id, { autoLink: true })).autoLink).toBe(true);
    expect(await disconnectHubspot(ws.id)).toBe(true);
    expect(await getHubspot(ws.id)).toMatchObject({ connected: false, autoLink: false, logNotes: false, scopes: [] });
    await expect(searchHubspot(ws.id, 'company', 'acme')).rejects.toMatchObject({ code: 'hubspot_not_connected' });
    await expect(updateHubspotSettings(ws.id, { autoLink: true })).rejects.toBeInstanceOf(HubspotError);
  });

  it('la ruta: solo admins conectan y el estado no trae el token', async () => {
    const ws = await makeUser('hs-route');
    const member = await makeUser('hs-route-m');
    session.user = { ...ws, role: 'member', actingUser: { id: member.id } };
    const denied = await connRoute.POST(new Request('http://x/api/groups/hubspot', { method: 'POST', body: JSON.stringify({ token: TOKEN }) }));
    expect(denied.status).toBe(403);
    session.user = { ...ws, role: 'owner' };
    const bad = await connRoute.POST(new Request('http://x/api/groups/hubspot', { method: 'POST', body: JSON.stringify({ token: 'pat-noscope' }) }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain('hubspot_missing_scopes:');
    const ok = await connRoute.POST(new Request('http://x/api/groups/hubspot', { method: 'POST', body: JSON.stringify({ token: TOKEN, autoLink: true }) }));
    expect(ok.status).toBe(200);
    const text = await (await connRoute.GET()).text();
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text)).toMatchObject({ connected: true, autoLink: true });
    session.user = { ...ws, role: 'member', actingUser: { id: member.id } };
    expect(await (await connRoute.GET()).json()).toEqual({ connected: true });
  });
});

describe('HubSpot: buscar y vincular', () => {
  it('busca empresas y negocios por nombre y vincula un grupo a una empresa y un negocio', async () => {
    const w = await world('hs-link');
    const companies = await searchHubspot(w.owner.id, 'company', 'acme');
    expect(companies.map((c) => c.name)).toEqual(['Acme Logistics']);
    expect(companies[0]).toMatchObject({ type: 'company', id: '9001', domain: 'acme-logistics.example', owner: 'Paula Ortiz', lifecycle: 'Customer' });
    expect(companies[0].url).toBe(`https://app.hubspot.com/contacts/${FAKE_HUBSPOT_PORTAL}/record/0-2/9001`);
    const deals = await searchHubspot(w.owner.id, 'deal', 'renewal');
    expect(deals[0]).toMatchObject({ id: '8001', stage: 'Contract sent', amount: 12000, currency: 'USD', owner: 'Paula Ortiz' });
    expect(deals[0].closeDate).toBe('2026-12-15T00:00:00.000Z');
    expect(await searchHubspot(w.owner.id, 'company', 'a')).toEqual([]);

    await linkHubspot(w.owner.id, w.owner.id, w.group.id, 'company', '9001');
    const links = await linkHubspot(w.owner.id, w.owner.id, w.group.id, 'deal', '8001');
    expect(links.map((l) => `${l.type}:${l.name}`)).toEqual(['company:Acme Logistics', 'deal:Acme Logistics renewal']);
    // Otro registro del mismo tipo reemplaza al anterior.
    await linkHubspot(w.owner.id, w.owner.id, w.group.id, 'company', '9002');
    const panel = await chatHubspot(w.owner.id, w.group.id);
    expect(panel.links.map((l) => l.name)).toEqual(['Globex Retail', 'Acme Logistics renewal']);
    expect(panel.suggestions).toEqual([]);

    // Un id que no existe en esa cuenta de HubSpot, o que no es un id, no entra.
    await expect(linkHubspot(w.owner.id, w.owner.id, w.group.id, 'deal', '123456')).rejects.toMatchObject({ code: 'hubspot_not_found' });
    await expect(linkHubspot(w.owner.id, w.owner.id, w.group.id, 'deal', '8001/../x')).rejects.toMatchObject({ code: 'invalid_input' });

    expect(await unlinkHubspot(w.owner.id, w.group.id, 'deal')).toBe(true);
    expect(await unlinkHubspot(w.owner.id, w.group.id, 'deal')).toBe(false);
    expect((await chatHubspot(w.owner.id, w.group.id)).links.map((l) => l.type)).toEqual(['company']);
  });

  it('un registro borrado en HubSpot queda marcado y el filtro de la bandeja separa vinculados de no vinculados', async () => {
    const w = await world('hs-filter');
    await linkHubspot(w.owner.id, w.owner.id, w.group.id, 'company', '9003');
    const linked = await listChats(w.owner.id, w.owner.id, { hubspot: 'linked' });
    expect(linked.rows.map((c) => c.name)).toEqual(['Grupo Acme']);
    expect(linked.rows[0].hubspotName).toBe('Initech Foods');
    expect((await listChats(w.owner.id, w.owner.id, { hubspot: 'unlinked' })).rows.map((c) => c.name)).toEqual(['Dana']);

    fakeHubspot().companies.delete('9003');
    await getDb().prepare('UPDATE groups_hubspot_links SET fetched_at = ? WHERE chat_id = ?').run('2020-01-01T00:00:00.000Z', w.group.id);
    expect((await chatHubspot(w.owner.id, w.group.id)).links[0]).toMatchObject({ name: 'Initech Foods', missing: true });

    // Desconectado, el filtro y la etiqueta de la fila no muestran nada.
    await disconnectHubspot(w.owner.id);
    const off = await listChats(w.owner.id, w.owner.id, { hubspot: 'linked' });
    expect(off.rows).toEqual([]);
    expect((await listChats(w.owner.id, w.owner.id)).rows.every((c) => !c.hubspotName)).toBe(true);
  });
});

describe('HubSpot: acceso', () => {
  it('otro workspace no puede vincular, leer ni registrar un chat ajeno', async () => {
    const a = await world('hs-ws-a');
    const b = await world('hs-ws-b');
    await linkHubspot(a.owner.id, a.owner.id, a.group.id, 'company', '9001');
    await expect(linkHubspot(b.owner.id, b.owner.id, a.group.id, 'company', '9002')).rejects.toMatchObject({ code: 'not_found' });
    await expect(chatHubspot(b.owner.id, a.group.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(logChatToHubspot(b.owner.id, a.group.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(await unlinkHubspot(b.owner.id, a.group.id, 'company')).toBe(false);
    expect((await chatHubspot(a.owner.id, a.group.id)).links.map((l) => l.name)).toEqual(['Acme Logistics']);
    // Por las rutas, con la sesión de B.
    session.user = { ...b.owner, role: 'owner' };
    expect((await linksRoute.GET(new Request(`http://x/api/groups/hubspot/links?chat=${a.group.id}`))).status).toBe(404);
    const post = await linksRoute.POST(new Request('http://x/api/groups/hubspot/links', { method: 'POST', body: JSON.stringify({ chatId: a.group.id, type: 'company', objectId: '9002' }) }));
    expect(post.status).toBe(404);
    expect((await logRoute.POST(new Request('http://x/api/groups/hubspot/log', { method: 'POST', body: JSON.stringify({ chatId: a.group.id }) }))).status).toBe(404);
    expect((await searchRoute.GET(new Request(`http://x/api/groups/hubspot/search?chat=${a.group.id}&type=company&q=acme`))).status).toBe(404);
  });

  it('quien no ve la línea no lee, busca, vincula ni registra sus chats; un invitado tampoco escribe', async () => {
    const w = await world('hs-line');
    const team = await createTeam(w.owner.id, 'Workspace');
    const ruth = await makeUser('hs-line-ruth');
    const olga = await makeUser('hs-line-olga');
    await addMember(team.id, ruth.id, 'member');
    await addMember(team.id, olga.id, 'member');
    await setLineAccess(w.owner.id, w.row.id, { ownerId: olga.id, visibility: 'restricted', personIds: [], teamIds: [] });
    await linkHubspot(w.owner.id, w.owner.id, w.group.id, 'company', '9001');
    const url = 'http://x/api/groups/hubspot';
    const body = (data: unknown) => ({ method: 'POST', body: JSON.stringify(data) });

    session.user = { ...w.owner, role: 'member', actingUser: { id: ruth.id } };
    expect((await linksRoute.GET(new Request(`${url}/links?chat=${w.group.id}`))).status).toBe(404);
    expect((await searchRoute.GET(new Request(`${url}/search?chat=${w.group.id}&type=company&q=acme`))).status).toBe(404);
    expect((await linksRoute.POST(new Request(`${url}/links`, body({ chatId: w.group.id, type: 'deal', objectId: '8001' })))).status).toBe(404);
    expect((await linksRoute.DELETE(new Request(`${url}/links?chat=${w.group.id}&type=company`, { method: 'DELETE' }))).status).toBe(404);
    expect((await logRoute.POST(new Request(`${url}/log`, body({ chatId: w.group.id })))).status).toBe(404);
    expect((await chatHubspot(w.owner.id, w.group.id)).links.map((l) => l.type)).toEqual(['company']);
    expect(notePosts()).toHaveLength(0);

    // La dueña de la línea sí.
    session.user = { ...w.owner, role: 'member', actingUser: { id: olga.id } };
    const seen = await linksRoute.GET(new Request(`${url}/links?chat=${w.group.id}`));
    expect(seen.status).toBe(200);
    expect(((await seen.json()) as { links: Array<{ name: string }> }).links[0].name).toBe('Acme Logistics');
    expect((await linksRoute.POST(new Request(`${url}/links`, body({ chatId: w.group.id, type: 'deal', objectId: '8001' })))).status).toBe(200);

    // Invitado: ve lo que ve, pero no busca ni cambia vínculos.
    session.user = { ...w.owner, role: 'guest', actingUser: { id: ruth.id } };
    expect((await searchRoute.GET(new Request(`${url}/search?chat=${w.group.id}&type=company&q=acme`))).status).toBe(403);
    expect((await linksRoute.POST(new Request(`${url}/links`, body({ chatId: w.group.id, type: 'deal', objectId: '8002' })))).status).toBe(403);
    expect((await logRoute.POST(new Request(`${url}/log`, body({ chatId: w.group.id })))).status).toBe(403);
  });
});

describe('HubSpot: coincidencia por teléfono', () => {
  it('compara teléfonos por dígitos', () => {
    expect(samePhone('+54 9 11 5555-0142', '5491155550142')).toBe(true);
    expect(samePhone('+54 11 5555-0142', '5491155550142')).toBe(true);
    expect(samePhone('(415) 555-0177', '14155550177')).toBe(true);
    expect(samePhone('5491155550143', '5491155550142')).toBe(false);
    expect(samePhone('0142', '5491155550142')).toBe(false);
    expect(samePhone('', '')).toBe(false);
  });

  it('propone el contacto con ese teléfono y su empresa; no vincula sin confirmación', async () => {
    const w = await world('hs-match');
    const panel = await chatHubspot(w.owner.id, w.dm.id);
    expect(panel.links).toEqual([]);
    expect(panel.suggestions).toHaveLength(1);
    expect(panel.suggestions[0].contact).toMatchObject({ id: '7001', name: 'Dana Rivers', email: 'dana@acme-logistics.example' });
    expect(panel.suggestions[0].company).toMatchObject({ id: '9001', name: 'Acme Logistics' });
    expect(JSON.stringify(panel)).not.toContain('5555-0142');
    // Se guarda una hora: abrir de nuevo no vuelve a buscar.
    const searches = () => fakeHubspot().calls.filter((c) => c.path === '/crm/v3/objects/contacts/search').length;
    const before = searches();
    await chatHubspot(w.owner.id, w.dm.id);
    expect(searches()).toBe(before);
    expect((await chatHubspot(w.owner.id, w.dm.id)).links).toEqual([]);
    // Un grupo no tiene sugerencia.
    expect((await chatHubspot(w.owner.id, w.group.id)).suggestions).toEqual([]);

    // Aceptar: contacto y empresa principal.
    const links = await linkHubspot(w.owner.id, w.owner.id, w.dm.id, 'contact', '7001', { withCompany: true });
    expect(links.map((l) => `${l.type}:${l.id}`)).toEqual(['company:9001', 'contact:7001']);
    expect((await chatHubspot(w.owner.id, w.dm.id)).suggestions).toEqual([]);
    // Quitar el contacto a mano es "no es este": no se vuelve a proponer.
    await unlinkHubspot(w.owner.id, w.dm.id, 'contact');
    expect((await chatHubspot(w.owner.id, w.dm.id)).suggestions).toEqual([]);
  });

  it('quien tiene los teléfonos ocultos no ve el email del contacto', async () => {
    const w = await world('hs-mask');
    const team = await createTeam(w.owner.id, 'Workspace');
    const guest = await makeUser('hs-mask-g');
    await addMember(team.id, guest.id, 'guest');
    await getDb().prepare('UPDATE groups_chats SET assigned_to = ? WHERE id = ?').run(guest.id, w.dm.id);
    session.user = { ...w.owner, role: 'guest', actingUser: { id: guest.id } };
    const res = await linksRoute.GET(new Request(`http://x/api/groups/hubspot/links?chat=${w.dm.id}`));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Dana Rivers');
    expect(text).not.toContain('dana@acme-logistics.example');
  });

  it('con el ajuste prendido vincula solo cuando hay una única coincidencia (panel y cron)', async () => {
    const w = await world('hs-auto');
    await ingestEvents(w.row, [msg('525555550199@c.us', 'hs-auto-m2', 'Buenas', 'Lena'), msg('5491100009999@c.us', 'hs-auto-m3', 'Hola', 'Sin ficha')]);
    const lena = await chatNamed(w.owner.id, 'Lena');
    const nobody = await chatNamed(w.owner.id, 'Sin ficha');
    // Apagado: el cron no toca nada.
    expect(await sweepHubspotAutoLink()).toBe(0);
    expect((await listChats(w.owner.id, w.owner.id, { hubspot: 'linked' })).total).toBe(0);

    await updateHubspotSettings(w.owner.id, { autoLink: true });
    expect(await sweepHubspotAutoLink()).toBe(1);
    const dana = await chatHubspot(w.owner.id, w.dm.id);
    expect(dana.links.map((l) => `${l.type}:${l.id}`)).toEqual(['company:9001', 'contact:7001']);
    // Dos contactos con el mismo teléfono: se proponen los dos y no se vincula ninguno.
    const two = await chatHubspot(w.owner.id, lena.id);
    expect(two.links).toEqual([]);
    expect(two.suggestions.map((s) => s.contact.id).sort()).toEqual(['7003', '7004']);
    expect((await chatHubspot(w.owner.id, nobody.id)).suggestions).toEqual([]);
    // Otra corrida no repite.
    expect(await sweepHubspotAutoLink()).toBe(0);
  });
});

describe('HubSpot: registrar la conversación', () => {
  it('una nota por chat y por día, que se actualiza en vez de duplicarse', async () => {
    const w = await world('hs-log');
    await expect(logChatToHubspot(w.owner.id, w.group.id)).rejects.toMatchObject({ code: 'hubspot_not_linked' });
    await linkHubspot(w.owner.id, w.owner.id, w.group.id, 'company', '9001');
    await linkHubspot(w.owner.id, w.owner.id, w.group.id, 'deal', '8001');

    expect(await logChatToHubspot(w.owner.id, w.group.id)).toEqual({ notes: 1, days: 1 });
    expect(notePosts()).toHaveLength(1);
    const note = [...fakeHubspot().notes.values()][0];
    expect(note.associations.sort()).toEqual(['companies:9001', 'deals:8001']);
    expect(note.properties.hs_note_body).toContain('Arrancamos el piloto');
    expect(note.properties.hs_note_body).toContain('Grupo Acme');
    expect(note.properties.hs_note_body).toContain(`/app/lines/inbox/${w.group.id}`);

    // Sin cambios: ni otra nota ni otra llamada.
    expect(await logChatToHubspot(w.owner.id, w.group.id)).toEqual({ notes: 0, days: 1 });
    expect(notePosts()).toHaveLength(1);
    expect(notePatches()).toHaveLength(0);

    // Un mensaje nuevo el mismo día actualiza la misma nota; el HTML del cliente se escapa.
    await ingestEvents(w.row, [{ ...msg(w.group.id, 'hs-log-g2', '<script>alert(1)</script> ¿cuándo empezamos?', 'Grupo Acme'), chatId: await rawChatId(w.group.id) }]);
    expect(await logChatToHubspot(w.owner.id, w.group.id)).toEqual({ notes: 1, days: 1 });
    expect(notePosts()).toHaveLength(1);
    expect(notePatches()).toHaveLength(1);
    expect(fakeHubspot().notes.size).toBe(1);
    expect(note.properties.hs_note_body).toContain('&lt;script&gt;');
    expect(note.properties.hs_note_body).not.toContain('<script>');

    // Un contacto vinculado después se asocia a la nota existente.
    await linkHubspot(w.owner.id, w.owner.id, w.group.id, 'contact', '7001');
    expect(await logChatToHubspot(w.owner.id, w.group.id)).toEqual({ notes: 1, days: 1 });
    expect(notePosts()).toHaveLength(1);
    expect(note.associations.sort()).toEqual(['companies:9001', 'contacts:7001', 'deals:8001']);

    const rows = (await getDb().prepare('SELECT note_id, message_count FROM groups_hubspot_notes WHERE chat_id = ?').all(w.group.id)) as Array<{ note_id: string; message_count: number }>;
    expect(rows).toEqual([{ note_id: note.id, message_count: 2 }]);
    expect((await chatHubspot(w.owner.id, w.group.id)).lastLoggedAt).not.toBeNull();
  });

  it('dos corridas a la vez crean una sola nota', async () => {
    const w = await world('hs-race');
    await linkHubspot(w.owner.id, w.owner.id, w.group.id, 'company', '9001');
    await Promise.all([logChatToHubspot(w.owner.id, w.group.id), logChatToHubspot(w.owner.id, w.group.id), logChatToHubspot(w.owner.id, w.group.id)]);
    expect(notePosts()).toHaveLength(1);
    expect(fakeHubspot().notes.size).toBe(1);
  });

  it('el cron registra solo con el ajuste prendido, solo chats vinculados y solo líneas visibles para todos', async () => {
    const w = await world('hs-cron');
    await linkHubspot(w.owner.id, w.owner.id, w.group.id, 'company', '9001');
    // Apagado (por defecto).
    expect(await syncHubspotNotes()).toBe(0);
    await updateHubspotSettings(w.owner.id, { logNotes: true });
    // Prendido: el grupo vinculado sí, el chat sin vínculo no.
    expect(await syncHubspotNotes()).toBe(1);
    expect(notePosts()).toHaveLength(1);
    // Otra corrida, y el cron entero, no duplican.
    expect(await syncHubspotNotes()).toBe(0);
    expect((await runGroupsCron({ budgetMs: 1000, importBudgetMs: 1000 })).hubspotNotes).toBe(0);
    expect(notePosts()).toHaveLength(1);
    // Un mensaje nuevo espera 10 minutos desde la última escritura.
    await ingestEvents(w.row, [{ ...msg(w.group.id, 'hs-cron-g2', 'Otro mensaje', 'Grupo Acme'), chatId: await rawChatId(w.group.id) }]);
    expect(await syncHubspotNotes()).toBe(0);
    await getDb().prepare('UPDATE groups_hubspot_notes SET synced_at = ? WHERE chat_id = ?').run(new Date(Date.now() - 11 * 60_000).toISOString(), w.group.id);
    expect(await syncHubspotNotes()).toBe(1);
    expect(notePosts()).toHaveLength(1);
    expect(notePatches()).toHaveLength(1);

    // Línea restringida: el cron no copia sus chats a HubSpot; a mano, quien la ve, sí.
    const priv = await line(w.owner.id, 'Privada');
    await ingestEvents(priv, [msg('14155550177@c.us', 'hs-cron-p1', 'Tema reservado', 'Omar')]);
    await setLineAccess(w.owner.id, priv.id, { ownerId: w.owner.id, visibility: 'restricted', personIds: [], teamIds: [] });
    const omar = await chatNamed(w.owner.id, 'Omar');
    await linkHubspot(w.owner.id, w.owner.id, omar.id, 'company', '9002');
    expect(await syncHubspotNotes()).toBe(0);
    expect(JSON.stringify([...fakeHubspot().notes.values()])).not.toContain('Tema reservado');
    expect(await logChatToHubspot(w.owner.id, omar.id)).toEqual({ notes: 1, days: 1 });
  });

  it('sin permiso de escritura la acción manual lo dice y no llama a HubSpot', async () => {
    const ws = await makeUser('hs-log-ro');
    const row = await line(ws.id, 'Soporte');
    await ingestEvents(row, [msg('5491155550142@c.us', 'hs-log-ro-1', 'Hola', 'Dana')]);
    await connectHubspot(ws.id, ws.id, 'pat-readonly-2');
    const dm = await chatNamed(ws.id, 'Dana');
    await linkHubspot(ws.id, ws.id, dm.id, 'contact', '7001');
    expect((await chatHubspot(ws.id, dm.id)).canLog).toBe(false);
    await expect(logChatToHubspot(ws.id, dm.id)).rejects.toMatchObject({ code: 'hubspot_missing_scopes:crm.objects.contacts.write' });
    expect(notePosts()).toHaveLength(0);
  });
});

/** El id del chat en el proveedor (para mandar otro mensaje al mismo chat). */
async function rawChatId(chatId: string): Promise<string> {
  const r = (await getDb().prepare('SELECT provider_chat_id FROM groups_chats WHERE id = ?').get(chatId)) as { provider_chat_id: string };
  return r.provider_chat_id;
}
