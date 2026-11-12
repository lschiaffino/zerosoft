import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { evolutionProvider } from '@/lib/groups-provider-bridge';
import { connectNumber, createNumber, getChatRow, getNumberRowById, ingestEvents, listChats, sendMessage, type NumberRow } from '@/lib/groups';
import { groupsViewer, updatePlatformSettings } from '@/lib/groups-access';
import { setLineAccess } from '@/lib/groups-lines';
import { dmChatId, searchNewChat, startChat } from '@/lib/groups-new-chat';
import { looksLikePhone, parseNewChatPhone } from '@/lib/groups-new-chat-shared';
import { rememberContacts } from '@/lib/wa-contacts';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_PUSH_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

const msg = (chatId: string, id: string, body: string, senderName: string, extra: Record<string, unknown> = {}) => ({
  type: 'message' as const,
  chatId,
  isGroup: false,
  fromMe: false,
  senderPhone: /@lid$/.test(chatId) ? '' : chatId.split('@')[0],
  senderName,
  providerMessageId: id,
  body,
  ...extra,
});

async function line(ws: string, label: string): Promise<NumberRow> {
  const n = await createNumber(ws, ws, { provider: 'fake', name: label });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  // El estado guardado lo actualiza la pantalla de conexión al consultar: acá, a mano.
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return (await getNumberRowById(n.id))!;
}

const chatCount = async (numberId: string) => Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM groups_chats WHERE number_id = ?').get(numberId)) as { n: number }).n);

describe('el teléfono escrito a mano', () => {
  it('acepta espacios, guiones, paréntesis, puntos, "+" y el prefijo 00', () => {
    expect(parseNewChatPhone('+54 9 (11) 5555-0000')).toEqual({ ok: true, phone: '5491155550000' });
    expect(parseNewChatPhone('54.911.5555.0000')).toEqual({ ok: true, phone: '5491155550000' });
    expect(parseNewChatPhone('  5491155550000  ')).toEqual({ ok: true, phone: '5491155550000' });
    expect(parseNewChatPhone('0054 911 5555 0000')).toEqual({ ok: true, phone: '5491155550000' });
  });

  it('rechaza lo que no es un teléfono y los largos imposibles', () => {
    expect(parseNewChatPhone('1234567')).toEqual({ ok: false, error: 'too_short' });
    expect(parseNewChatPhone('+1234567890123456')).toEqual({ ok: false, error: 'too_long' });
    expect(parseNewChatPhone('Ana 5491155550000')).toEqual({ ok: false, error: 'not_a_phone' });
    expect(parseNewChatPhone('54911#5555')).toEqual({ ok: false, error: 'not_a_phone' });
    expect(parseNewChatPhone('')).toEqual({ ok: false, error: 'not_a_phone' });
    expect(parseNewChatPhone('+')).toEqual({ ok: false, error: 'not_a_phone' });
    expect(looksLikePhone('(011) 5555')).toBe(true);
    expect(looksLikePhone('Ana')).toBe(false);
  });

  it('el id del chat sigue al proveedor de la línea', () => {
    expect(dmChatId('cloud', '5491155550000')).toBe('5491155550000');
    expect(dmChatId('waha', '5491155550000')).toBe('5491155550000@c.us');
    expect(dmChatId('evolution', '5491155550000')).toBe('5491155550000@s.whatsapp.net');
    expect(dmChatId('managed', '5491155550000')).toBe('5491155550000@s.whatsapp.net');
  });
});

describe('abrir o crear el chat', () => {
  it('reusa el chat que ya existe (con cualquier sufijo) y no duplica al repetir', async () => {
    const ws = await makeUser('nc-reuse');
    const n = await line(ws.id, 'Ventas');
    const v = await groupsViewer(ws.id, ws.id, 'owner');
    await ingestEvents(n, [msg('5491122220001@c.us', 'R-1', 'hola', 'Ana Prueba')]);
    const existing = (await listChats(ws.id, ws.id)).rows[0];
    const before = await chatCount(n.id);

    expect(await startChat(v, { numberId: n.id, phone: '+54 9 11 2222-0001' })).toEqual({ id: existing.id, created: false });
    expect(await chatCount(n.id)).toBe(before);

    const a = await startChat(v, { numberId: n.id, phone: '5491122220002' });
    expect(a.created).toBe(true);
    const b = await startChat(v, { numberId: n.id, phone: '+54 (911) 2222 0002' });
    expect(b).toEqual({ id: a.id, created: false });
    expect(await chatCount(n.id)).toBe(before + 1);
  });

  it('el chat nuevo queda fuera de la bandeja y sin asignar hasta el primer mensaje, y no manda nada', async () => {
    const ws = await makeUser('nc-hidden');
    const n = await line(ws.id, 'Ventas');
    const v = await groupsViewer(ws.id, ws.id, 'owner');
    const { id } = await startChat(v, { numberId: n.id, phone: '5491122220003' });
    const row = (await getChatRow(ws.id, id))!;
    expect(row).toMatchObject({ kind: 'dm', phone: '5491122220003', provider_chat_id: '5491122220003@s.whatsapp.net', assigned_to: null, last_message_at: null });
    expect(row.hidden_at).toBeTruthy();
    expect((await listChats(ws.id, ws.id)).rows).toHaveLength(0);
    const fake = (globalThis as unknown as { __groupsFake: Map<string, { sent: unknown[] }> }).__groupsFake.get(n.id)!;
    expect(fake.sent).toHaveLength(0);

    await sendMessage(ws.id, ws.id, id, { body: 'Hola, te escribo de Ventas' });
    expect((await listChats(ws.id, ws.id)).rows.map((c) => c.id)).toEqual([id]);
    expect(fake.sent).toHaveLength(1);
  });

  it('con el chat guardado por lid, lo encuentra por el teléfono de la libreta', async () => {
    const ws = await makeUser('nc-lid');
    const n = await line(ws.id, 'Ventas');
    const v = await groupsViewer(ws.id, ws.id, 'owner');
    await ingestEvents(n, [msg('270000000000011@lid', 'L-1', 'hola desde lid', 'Lía Prueba', { senderLid: '270000000000011' })]);
    const lidChat = (await listChats(ws.id, ws.id)).rows[0];
    await rememberContacts({ app: 'lines', accountId: n.id, userId: ws.id }, [{ phone: '5491122220004', lid: '270000000000011' }]);
    expect(await startChat(v, { numberId: n.id, phone: '5491122220004' })).toEqual({ id: lidChat.id, created: false });
    expect(await chatCount(n.id)).toBe(1);
  });

  it('número inválido, el de la propia línea, línea desconectada y número sin WhatsApp', async () => {
    const ws = await makeUser('nc-bad');
    const n = await line(ws.id, 'Ventas');
    const v = await groupsViewer(ws.id, ws.id, 'owner');
    await expect(startChat(v, { numberId: n.id, phone: '12345' })).rejects.toMatchObject({ code: 'invalid_phone' });
    await expect(startChat(v, { numberId: n.id, phone: 'no soy un número' })).rejects.toMatchObject({ code: 'invalid_phone' });
    await expect(startChat(v, { numberId: 'no-existe', phone: '5491122220005' })).rejects.toMatchObject({ code: 'not_found' });
    // El proveedor falso dice que un número terminado en 0000000 no tiene WhatsApp: no se crea nada.
    await expect(startChat(v, { numberId: n.id, phone: '5491120000000' })).rejects.toMatchObject({ code: 'not_on_whatsapp', status: 422 });
    await getDb().prepare("UPDATE groups_numbers SET phone = '5491199990000' WHERE id = ?").run(n.id);
    await expect(startChat(v, { numberId: n.id, phone: '5491199990000' })).rejects.toMatchObject({ code: 'own_number' });
    await getDb().prepare("UPDATE groups_numbers SET status = 'disconnected' WHERE id = ?").run(n.id);
    await expect(startChat(v, { numberId: n.id, phone: '5491122220005' })).rejects.toMatchObject({ code: 'not_connected', status: 409 });
    expect(await chatCount(n.id)).toBe(0);
  });

  it('si el proveedor no puede decir si tiene WhatsApp, el chat se abre igual', async () => {
    const ws = await makeUser('nc-nocheck');
    const n = await line(ws.id, 'Ventas');
    const v = await groupsViewer(ws.id, ws.id, 'owner');
    (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id)!.connectedAt = null;
    const r = await startChat(v, { numberId: n.id, phone: '5491122220006' });
    expect(r.created).toBe(true);
  });

  it('Evolution: /chat/whatsappNumbers dice si existe y con qué id', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const answer = { current: [{ exists: true, jid: '5511988887777@s.whatsapp.net', number: '551188887777' }] as unknown };
    const p = evolutionProvider(
      { baseUrl: 'https://evolution.example.test', apiKey: 'k', session: 'ventas' },
      {
        fetch: async (url, init) => {
          calls.push({ url, body: JSON.parse(String(init?.body ?? 'null')) });
          return new Response(JSON.stringify(answer.current), { status: 200, headers: { 'content-type': 'application/json' } });
        },
      },
    );
    expect(await p.checkNumber!('+55 11 8888-7777')).toEqual({ exists: true, jid: '5511988887777@s.whatsapp.net' });
    expect(calls[0].url).toBe('https://evolution.example.test/chat/whatsappNumbers/ventas');
    expect(calls[0].body).toEqual({ numbers: ['551188887777'] });
    answer.current = [{ exists: false, jid: '551188887777@s.whatsapp.net' }];
    expect(await p.checkNumber!('551188887777')).toMatchObject({ exists: false });
    answer.current = { unexpected: true };
    expect(await p.checkNumber!('551188887777')).toBeNull();
  });
});

describe('acceso', () => {
  /** Línea pública y línea privada (solo Olga); Ruth es member sin acceso a la privada. */
  async function world(label: string) {
    const owner = await makeUser(`${label}-ws`);
    const olga = await makeUser(`${label}-olga`);
    const ruth = await makeUser(`${label}-ruth`);
    const team = (await createTeam(owner.id, 'Workspace')).id;
    for (const u of [olga, ruth]) await addMember(team, u.id, 'member');
    const pub = await line(owner.id, 'Pública');
    const priv = await line(owner.id, 'Privada');
    await ingestEvents(pub, [msg('5491133330001@c.us', 'P-1', 'hola', 'Cliente Abierto')]);
    await ingestEvents(priv, [msg('5491133330002@c.us', 'S-1', 'hola', 'Cliente Reservado')]);
    await setLineAccess(owner.id, priv.id, { ownerId: olga.id, visibility: 'restricted', personIds: [], teamIds: [] });
    return { owner, olga, ruth, pub, priv };
  }

  it('la búsqueda solo trae contactos y chats de la línea pedida', async () => {
    const w = await world('nc-scope');
    const v = await groupsViewer(w.owner.id, w.owner.id, 'owner');
    await rememberContacts({ app: 'lines', accountId: w.priv.id, userId: w.owner.id }, [{ phone: '5491133330009', saved: 'Cliente Agendado' }]);
    const pub = await searchNewChat(v, w.pub.id, 'Cliente');
    expect(pub.map((r) => r.name)).toEqual(['Cliente Abierto']);
    expect(pub[0]).toMatchObject({ phone: '5491133330001', phoneLabel: '+5491133330001' });
    expect(pub[0].chatId).toBeTruthy();
    const priv = await searchNewChat(v, w.priv.id, 'Cliente');
    expect(priv.map((r) => r.name).sort()).toEqual(['Cliente Agendado', 'Cliente Reservado']);
    expect(priv.find((r) => r.name === 'Cliente Agendado')).toMatchObject({ phone: '5491133330009' });
    expect(priv.find((r) => r.name === 'Cliente Agendado')!.contactId).toBeTruthy();
    // Por teléfono, y sin texto los chats recientes.
    expect((await searchNewChat(v, w.priv.id, '3333 0009')).map((r) => r.name)).toEqual(['Cliente Agendado']);
    expect((await searchNewChat(v, w.pub.id, '')).map((r) => r.name)).toEqual(['Cliente Abierto']);
    // Un comodín no es un comodín.
    expect(await searchNewChat(v, w.pub.id, '%%')).toEqual([]);
  });

  it('nunca pasa de 20 filas', async () => {
    const ws = await makeUser('nc-limit');
    const n = await line(ws.id, 'Ventas');
    const v = await groupsViewer(ws.id, ws.id, 'owner');
    await rememberContacts(
      { app: 'lines', accountId: n.id, userId: ws.id },
      Array.from({ length: 45 }, (_, i) => ({ phone: `54911444400${String(i).padStart(2, '0')}`, saved: `Contacto Prueba ${i}` })),
    );
    expect(await searchNewChat(v, n.id, 'Contacto')).toHaveLength(20);
  });

  it('quien no ve la línea no encuentra su chat por otra línea ni resuelve sus contactos', async () => {
    const w = await world('nc-line');
    const ruth = await groupsViewer(w.owner.id, w.ruth.id, 'member');
    // El mismo teléfono de la línea privada, pedido en la pública: es un chat nuevo de la pública, no el reservado.
    const r = await startChat(ruth, { numberId: w.pub.id, phone: '5491133330002' });
    expect(r.created).toBe(true);
    expect((await getChatRow(w.owner.id, r.id))!.number_id).toBe(w.pub.id);
    // Un contacto de la libreta de la privada no se resuelve desde la pública.
    await rememberContacts({ app: 'lines', accountId: w.priv.id, userId: w.owner.id }, [{ phone: '5491133330009', saved: 'Cliente Agendado' }]);
    const contact = (await getDb().prepare("SELECT id FROM wa_contacts WHERE account_id = ? AND phone = '5491133330009'").get(w.priv.id)) as { id: string };
    await expect(startChat(ruth, { numberId: w.pub.id, contactId: contact.id })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    // Ni desde otro workspace.
    const other = await makeUser('nc-line-otro');
    const otherLine = await line(other.id, 'Otra');
    await expect(startChat(await groupsViewer(other.id, other.id, 'owner'), { numberId: w.priv.id, phone: '5491133330002' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(startChat(await groupsViewer(other.id, other.id, 'owner'), { numberId: otherLine.id, contactId: contact.id })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('la ruta responde 404 a quien no ve la línea, para crear y para buscar', async () => {
    const w = await world('nc-route');
    vi.resetModules();
    vi.doMock('@/lib/session', async (orig) => ({
      ...(await orig<typeof import('@/lib/session')>()),
      getCurrentUser: async () => ({ id: w.owner.id, email: 'ruth@example.test', name: 'Ruth', role: 'member', actingUser: { id: w.ruth.id, email: 'ruth@example.test', name: 'Ruth' } }),
    }));
    const chats = await import('@/app/api/groups/chats/route');
    const contacts = await import('@/app/api/groups/contacts/route');
    const post = (body: unknown) => chats.POST(new Request('http://x/api/groups/chats', { method: 'POST', body: JSON.stringify(body) }));
    expect((await post({ numberId: w.priv.id, phone: '5491133330002' })).status).toBe(404);
    expect((await contacts.GET(new Request(`http://x/api/groups/contacts?number=${w.priv.id}&q=Cliente`))).status).toBe(404);
    expect((await contacts.GET(new Request('http://x/api/groups/contacts'))).status).toBe(400);
    // En la línea que sí ve: busca y crea.
    const found = (await (await contacts.GET(new Request(`http://x/api/groups/contacts?number=${w.pub.id}&q=Cliente`))).json()) as { rows: Array<{ name: string }> };
    expect(found.rows.map((r) => r.name)).toEqual(['Cliente Abierto']);
    expect((await post({ numberId: w.pub.id })).status).toBe(400);
    expect((await post({ numberId: w.pub.id, phone: '5491133330077', contactId: 'x' })).status).toBe(400);
    expect((await post({ numberId: w.pub.id, phone: '123' })).status).toBe(400);
    const created = await post({ numberId: w.pub.id, phone: '+54 911 3333 0077' });
    expect(created.status).toBe(201);
    expect((await post({ numberId: w.pub.id, phone: '5491133330077' })).status).toBe(200);
    vi.doUnmock('@/lib/session');
    vi.resetModules();
  });

  it('con acceso por etiqueta: busca solo entre sus chats, no ve la libreta, y el chat que abre queda a su nombre', async () => {
    const w = await world('nc-label');
    await updatePlatformSettings(w.owner.id, { labelAccess: true });
    const ruth = await groupsViewer(w.owner.id, w.ruth.id, 'member');
    expect(ruth.restricted).toBe(true);
    await rememberContacts({ app: 'lines', accountId: w.pub.id, userId: w.owner.id }, [{ phone: '5491133330010', saved: 'Cliente Libreta' }]);
    // "Cliente Abierto" no está asignado a Ruth: ni el chat ni la libreta aparecen.
    expect(await searchNewChat(ruth, w.pub.id, 'Cliente')).toEqual([]);
    expect(await searchNewChat(ruth, w.pub.id, '')).toEqual([]);
    const contact = (await getDb().prepare("SELECT id FROM wa_contacts WHERE account_id = ? AND phone = '5491133330010'").get(w.pub.id)) as { id: string };
    await expect(startChat(ruth, { numberId: w.pub.id, contactId: contact.id })).rejects.toMatchObject({ code: 'not_found' });
    // Un chat que existe y no ve: no se lo abre ni se lo asigna.
    await expect(startChat(ruth, { numberId: w.pub.id, phone: '5491133330001' })).rejects.toMatchObject({ code: 'chat_no_access', status: 403 });
    const untouched = (await getDb().prepare("SELECT assigned_to FROM groups_chats WHERE number_id = ? AND phone = '5491133330001'").get(w.pub.id)) as { assigned_to: string | null };
    expect(untouched.assigned_to).toBeNull();
    // Uno nuevo: queda asignado a ella, así lo ve; otra persona restringida no.
    const mine = await startChat(ruth, { numberId: w.pub.id, phone: '5491133330011' });
    expect(mine.created).toBe(true);
    expect((await getChatRow(w.owner.id, mine.id))!.assigned_to).toBe(w.ruth.id);
    const olga = await groupsViewer(w.owner.id, w.olga.id, 'member');
    await expect(startChat(olga, { numberId: w.pub.id, phone: '5491133330011' })).rejects.toMatchObject({ code: 'chat_no_access' });
    expect((await getChatRow(w.owner.id, mine.id))!.assigned_to).toBe(w.ruth.id);
  });

  it('con los teléfonos ocultos: sale enmascarado, no se busca por teléfono y el contacto se abre por id', async () => {
    const w = await world('nc-mask');
    await updatePlatformSettings(w.owner.id, { maskRoles: ['member'] });
    const ruth = await groupsViewer(w.owner.id, w.ruth.id, 'member');
    expect(ruth.mask).toBe(true);
    await rememberContacts({ app: 'lines', accountId: w.pub.id, userId: w.owner.id }, [{ phone: '5491133330012', saved: 'Cliente Libreta' }]);
    const rows = await searchNewChat(ruth, w.pub.id, 'Cliente');
    expect(rows.map((r) => r.name).sort()).toEqual(['Cliente Abierto', 'Cliente Libreta']);
    for (const r of rows) {
      expect(r.phone).toBe('');
      expect(r.phoneLabel).not.toMatch(/\d{5,}/);
    }
    expect(JSON.stringify(rows)).not.toContain('5491133330012');
    expect(await searchNewChat(ruth, w.pub.id, '33330012')).toEqual([]);
    expect(await searchNewChat(ruth, w.pub.id, '5491133330001')).toEqual([]);
    const book = rows.find((r) => r.name === 'Cliente Libreta')!;
    const r = await startChat(ruth, { numberId: w.pub.id, contactId: book.contactId });
    expect(r.created).toBe(true);
    expect((await getChatRow(w.owner.id, r.id))!.phone).toBe('5491133330012');
  });
});
