/**
 * "Chat nuevo" como el de WhatsApp Web, en Lines e Inbox: orden alfabético
 * sin tildes, búsqueda por teléfono en cualquier formato, páginas con cursor,
 * contactados con frecuencia, acceso y teléfonos ocultos, "Mandate un
 * mensaje" y el grupo nuevo de Inbox. Nombres y números inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, type NumberRow } from '@/lib/groups';
import { groupsViewer, updatePlatformSettings } from '@/lib/groups-access';
import { newChatDirectory } from '@/lib/groups-new-chat';
import { addMessage, findThread, getAccountById, upsertThread } from '@/lib/inbox/core';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { createWhatsappGroup, inboxNewChatDirectory } from '@/lib/inbox/new-chat';
import { rememberContacts } from '@/lib/wa-contacts';
import { compareNewChat, foldText, matchesNewChat, newChatLetter, pageNewChat, parseNewChatQuery } from '@/lib/wa-new-chat';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_PUSH_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);

async function line(ws: string, label: string): Promise<NumberRow> {
  const n = await createNumber(ws, ws, { provider: 'fake', name: label });
  await connectNumber(ws, n.id);
  const s = fakeState(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return (await getNumberRowById(n.id))!;
}

const msg = (phone: string, id: string, senderName: string) => ({
  type: 'message' as const,
  chatId: `${phone}@c.us`,
  isGroup: false,
  fromMe: false,
  senderPhone: phone,
  senderName,
  providerMessageId: id,
  body: 'hola',
});

const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);

describe('funciones puras', () => {
  it('ordena sin tildes ni mayúsculas, con los números al final bajo "#"', () => {
    const rows = ['zoe', 'Álvaro', 'beto', '+5491155550000', 'Ángela', 'andrés', 'Ñandú', '😀 Emo'].map((name, i) => ({ name, key: `k${i}` }));
    expect(rows.sort(compareNewChat).map((r) => r.name)).toEqual(['Álvaro', 'andrés', 'Ángela', 'beto', 'Ñandú', 'zoe', '+5491155550000', '😀 Emo']);
    expect(newChatLetter('Álvaro')).toBe('A');
    expect(newChatLetter('ñandú')).toBe('N');
    expect(newChatLetter('+54 9 11')).toBe('#');
    expect(foldText('  Ángela NÚÑEZ ')).toBe('angela nunez');
  });

  it('busca por nombre sin tildes y por teléfono escrito de cualquier forma', () => {
    const ana = { name: 'Ana Núñez', phone: '5491155550000', about: '' };
    const hit = (q: string, phone = true) => matchesNewChat(ana, parseNewChatQuery(q), { phone });
    expect(hit('nunez')).toBe(true);
    expect(hit('NÚÑ')).toBe(true);
    expect(hit('Pedro')).toBe(false);
    expect(hit('+54 9 11 5555-0000')).toBe(true);
    expect(hit('(011) 5555 0000')).toBe(true);
    expect(hit('11 5555 0000')).toBe(true);
    expect(hit('+54 11 5555 0000')).toBe(true);
    expect(hit('0054 9 11 5555 0000')).toBe(true);
    expect(hit('5555 0001')).toBe(false);
    // Con los teléfonos ocultos, el teléfono no busca.
    expect(hit('11 5555 0000', false)).toBe(false);
  });

  it('las páginas siguen desde la última fila mostrada aunque entre una nueva antes', () => {
    const all = Array.from({ length: 7 }, (_, i) => ({ name: `Nombre ${String.fromCharCode(65 + i)}`, key: `k${i}` })).sort(compareNewChat);
    const p1 = pageNewChat(all, null, 3);
    expect(names(p1.rows)).toEqual(['Nombre A', 'Nombre B', 'Nombre C']);
    // Entra "Nombre AA" (ya pasó): la página siguiente no repite ni saltea.
    const grown = [...all, { name: 'Nombre AA', key: 'k-new' }].sort(compareNewChat);
    const p2 = pageNewChat(grown, p1.next, 3);
    expect(names(p2.rows)).toEqual(['Nombre D', 'Nombre E', 'Nombre F']);
    const p3 = pageNewChat(grown, p2.next, 3);
    expect(names(p3.rows)).toEqual(['Nombre G']);
    expect(p3.next).toBeNull();
    // Un cursor roto es la primera página.
    expect(names(pageNewChat(all, 'no es json', 2).rows)).toEqual(['Nombre A', 'Nombre B']);
  });
});

describe('Lines', () => {
  it('contactados con frecuencia: los chats con más mensajes del último mes, y la libreta en orden con su info', async () => {
    const ws = await makeUser('wnc-freq');
    const n = await line(ws.id, 'Ventas');
    const v = await groupsViewer(ws.id, ws.id, 'owner');
    await ingestEvents(n, [msg('5491166660001', 'F-1', 'Zoe Uno')]);
    await ingestEvents(n, [msg('5491166660002', 'F-2', 'Beto Dos'), msg('5491166660002', 'F-3', 'Beto Dos'), msg('5491166660002', 'F-4', 'Beto Dos')]);
    await ingestEvents(n, [msg('5491166660003', 'F-5', 'Ana Tres'), msg('5491166660003', 'F-6', 'Ana Tres')]);
    await rememberContacts({ app: 'lines', accountId: n.id, userId: ws.id }, [
      { phone: '5491166660002', saved: 'Beto Dos', about: 'En la oficina' },
      { phone: '5491166660009', saved: 'Álvaro Libreta', about: 'Disponible' },
    ]);
    const dir = await newChatDirectory(v, n.id);
    expect(names(dir.frequent)).toEqual(['Beto Dos', 'Ana Tres', 'Zoe Uno']);
    expect(dir.self).toBeNull();
    // Una fila por teléfono: el chat de Beto toma la info de la libreta; Álvaro (sin chat) va con su contacto.
    expect(names(dir.contacts)).toEqual(['Álvaro Libreta', 'Ana Tres', 'Beto Dos', 'Zoe Uno']);
    expect(dir.contacts[0]).toMatchObject({ about: 'Disponible', phone: '5491166660009' });
    expect(dir.contacts[0].contactId).toBeTruthy();
    expect(dir.contacts[2]).toMatchObject({ about: 'En la oficina' });
    expect(dir.contacts[2].chatId).toBeTruthy();
    // Mensajes viejos no cuentan.
    await getDb().prepare("UPDATE groups_messages SET created_at = '2020-01-01T00:00:00.000Z' WHERE number_id = ? AND sender_phone = '5491166660002'").run(n.id);
    expect(names((await newChatDirectory(v, n.id)).frequent)).toEqual(['Ana Tres', 'Zoe Uno']);
    // Buscando no hay frecuentes; sin tildes y por teléfono.
    const found = await newChatDirectory(v, n.id, { q: 'alvaro' });
    expect(found.frequent).toEqual([]);
    expect(names(found.contacts)).toEqual(['Álvaro Libreta']);
    expect(names((await newChatDirectory(v, n.id, { q: '11 6666-0003' })).contacts)).toEqual(['Ana Tres']);
  });

  it('quien solo ve sus chats no recibe la libreta ni frecuentes ajenos; con teléfonos ocultos sale enmascarado', async () => {
    const owner = await makeUser('wnc-acc');
    const ruth = await makeUser('wnc-acc-ruth');
    const team = (await createTeam(owner.id, 'Workspace')).id;
    await addMember(team, ruth.id, 'member');
    const n = await line(owner.id, 'Ventas');
    await ingestEvents(n, [msg('5491177770001', 'A-1', 'Cliente Ajeno')]);
    await rememberContacts({ app: 'lines', accountId: n.id, userId: owner.id }, [{ phone: '5491177770002', saved: 'Cliente Libreta' }]);

    await updatePlatformSettings(owner.id, { labelAccess: true });
    const restricted = await groupsViewer(owner.id, ruth.id, 'member');
    expect(restricted.restricted).toBe(true);
    const r = await newChatDirectory(restricted, n.id);
    expect(r.contacts).toEqual([]);
    expect(r.frequent).toEqual([]);

    await updatePlatformSettings(owner.id, { labelAccess: false, maskRoles: ['member'] });
    const masked = await groupsViewer(owner.id, ruth.id, 'member');
    expect(masked.mask).toBe(true);
    const m = await newChatDirectory(masked, n.id);
    expect(names(m.contacts)).toEqual(['Cliente Ajeno', 'Cliente Libreta']);
    expect(JSON.stringify(m)).not.toMatch(/77770001|77770002/);
    expect((await newChatDirectory(masked, n.id, { q: '77770002' })).contacts).toEqual([]);
  });
});

describe('Inbox', () => {
  async function account(label: string) {
    const u = await makeUser(label);
    const { account: a } = await connectWhatsapp(u.id);
    const s = fakeState(`inbox-${a.id}`);
    if (s) s.connectedAt = Date.now() - 5000;
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = '15550000001', label = 'Lucía' WHERE id = ?").run(a.id);
    return { u, account: (await getAccountById(a.id))! };
  }

  it('"Mandate un mensaje", frecuentes y la libreta de la cuenta, solo de quien pide', async () => {
    const { u, account: a } = await account('wnc-inbox');
    const scope = { app: 'inbox' as const, accountId: a.id, userId: u.id };
    const t1 = await upsertThread(a, { externalId: '15550002001@s.whatsapp.net', kind: 'dm', title: 'Carla Chat', handle: '15550002001' });
    const t2 = await upsertThread(a, { externalId: '15550002002@s.whatsapp.net', kind: 'dm', title: '15550002002', handle: '15550002002' });
    for (let i = 0; i < 3; i++) await addMessage(t1, { externalId: `c-${i}`, fromMe: i % 2 === 0, body: 'hola' });
    await addMessage(t2, { externalId: 'd-1', fromMe: false, body: 'hola' });
    await rememberContacts(scope, [
      { phone: '15550002002', saved: 'Bruno Libreta', about: 'Hey there' },
      { phone: '15550002003', saved: 'Ésteban Sin Chat' },
      { phone: '15550000001', saved: 'Lucía Yo' },
    ]);
    const dir = await inboxNewChatDirectory(u.id);
    expect(dir.connected).toBe(true);
    expect(dir.self).toMatchObject({ key: 'self', name: 'Lucía Yo', phone: '15550000001' });
    expect(names(dir.frequent)).toEqual(['Carla Chat', 'Bruno Libreta']);
    // El chat sin nombre toma el de la libreta en la lista; uno mismo no está entre los contactos.
    expect(dir.contacts.map((c) => [c.name, Boolean(c.chatId)])).toEqual([
      ['Bruno Libreta', true],
      ['Carla Chat', true],
      ['Ésteban Sin Chat', false],
    ]);
    expect(dir.contacts[0].about).toBe('Hey there');
    expect(names((await inboxNewChatDirectory(u.id, { q: 'esteban' })).contacts)).toEqual(['Ésteban Sin Chat']);
    expect((await inboxNewChatDirectory(u.id, { q: 'esteban' })).self).toBeNull();
    // Otra persona no ve nada de esto.
    const other = await makeUser('wnc-inbox-otra');
    expect(await inboxNewChatDirectory(other.id)).toMatchObject({ connected: false, contacts: [], self: null });
  });

  it('crea un grupo de WhatsApp con los elegidos y devuelve su chat', async () => {
    const { u, account: a } = await account('wnc-group');
    const t = await createWhatsappGroup(u.id, { name: 'Viaje a Bariloche', phones: ['+1 555 000 3001', '15550003002', '15550000001'] });
    expect(t).toMatchObject({ kind: 'group', title: 'Viaje a Bariloche', account_id: a.id, owner_id: u.id });
    expect(await findThread(a.id, t.external_id)).toMatchObject({ id: t.id });
    await expect(createWhatsappGroup(u.id, { name: ' ', phones: ['15550003001'] })).rejects.toMatchObject({ code: 'invalid_input' });
    // Solo con uno mismo no hay grupo.
    await expect(createWhatsappGroup(u.id, { name: 'Solo', phones: ['15550000001'] })).rejects.toMatchObject({ code: 'invalid_input' });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'disconnected' WHERE id = ?").run(a.id);
    await expect(createWhatsappGroup(u.id, { name: 'Otro', phones: ['15550003001'] })).rejects.toMatchObject({ code: 'not_connected', status: 409 });
    const other = await makeUser('wnc-group-otra');
    await expect(createWhatsappGroup(other.id, { name: 'Otro', phones: ['15550003001'] })).rejects.toMatchObject({ code: 'not_connected' });
  });
});
