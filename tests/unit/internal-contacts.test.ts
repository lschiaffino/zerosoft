/**
 * Contactos internos (lib/internal-contacts.ts) en Lines e Inbox: quién es del
 * equipo o de la empresa. Su mensaje cuenta como respuesta (no espera, el
 * ticket toma su primera respuesta), no abre tickets, no entra en las
 * métricas de clientes, se marca en miembros y mensajes y se puede filtrar.
 * Las rutas: solo admins, y nunca lo de otro workspace.
 * Números, nombres y correos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getChat, getNumberRowById, ingestEvents, listChats, listMembers, listMessages, updateSettings } from '@/lib/groups';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import type { InboundEvent } from '@/lib/groups-provider';
import { cachedLinesAnalytics, clearAnalyticsCache } from '@/lib/groups-analytics';
import { systemViewer, updatePlatformSettings } from '@/lib/groups-access';
import {
  cleanDomain,
  companyDomain,
  handleForRef,
  internalHandleSql,
  internalRef,
  internalPhonesJson,
  isInternalHandle,
  lidOf,
  listInternalContacts,
  phoneTwin,
  phoneVariants,
  loadInternalSet,
  normalizeHandle,
  setInternalContact,
  updateInternalSettings,
} from '@/lib/internal-contacts';
import { addMessage, createAccount, inboxCounts, listThreadsPage, upsertThread, type AccountRow } from '@/lib/inbox/core';
import { inboxAnalytics } from '@/lib/inbox/analytics';
import { makeUser } from './helpers';
import { asMember, asOwner, roles, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const TEAMMATE = '5490000000201';
const CUSTOMER = '5490000000202';
const OTHER = '5490000000203';
const LINE2 = '5490000000204';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  clearAnalyticsCache();
});
afterEach(() => vi.unstubAllEnvs());

const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);

async function line(ws: string, phone = '') {
  const n = await createNumber(ws, ws, { provider: 'fake' });
  await connectNumber(ws, n.id);
  const s = fakeState(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected', phone = ? WHERE id = ?").run(phone, n.id);
  return (await getNumberRowById(n.id))!;
}

let seq = 0;
const at = (minutes: number) => new Date(Date.now() - 60 * 60_000 + minutes * 60_000).toISOString();
const msg = (chatId: string, sender: string, body: string, minute: number, over: Partial<InboundEvent> = {}): InboundEvent =>
  ({
    type: 'message',
    chatId,
    isGroup: chatId.endsWith('@g.us'),
    ...(chatId.endsWith('@g.us') ? { chatName: 'Grupo de prueba' } : {}),
    fromMe: false,
    senderPhone: sender,
    senderName: sender === TEAMMATE ? 'Persona Equipo' : 'Persona Cliente',
    providerMessageId: `int-${++seq}-${Math.random().toString(36).slice(2)}`,
    body,
    timestamp: at(minute),
    ...over,
  }) as InboundEvent;

describe('contactos internos: lo puro', () => {
  it('normaliza teléfonos y correos, y nada más', () => {
    expect(normalizeHandle('+54 9 11 0000-0201')).toBe('5491100000201');
    expect(normalizeHandle(`${TEAMMATE}@s.whatsapp.net`)).toBe(TEAMMATE);
    expect(normalizeHandle('Ana@Empresa.COM')).toBe('ana@empresa.com');
    expect(normalizeHandle('123')).toBeNull();
    expect(normalizeHandle('123456789012345@lid')).toBeNull();
    expect(normalizeHandle('no es nada')).toBeNull();
    // Un texto con un número adentro no es un teléfono; el 00 internacional es el +; el dispositivo del JID se va.
    expect(normalizeHandle('Juan 1155550000')).toBeNull();
    expect(normalizeHandle('00 54 9 11 0000-0201')).toBe('5491100000201');
    expect(normalizeHandle(`${TEAMMATE}:12@s.whatsapp.net`)).toBe(TEAMMATE);
    // Dominios de correo gratis no pueden ser de la empresa.
    expect(companyDomain('gmail.com')).toBeNull();
    expect(companyDomain('@Empresa.com')).toBe('empresa.com');
    expect(cleanDomain('@Empresa.com')).toBe('empresa.com');
    expect(cleanDomain('https://empresa.com/x')).toBe('empresa.com');
    expect(cleanDomain('nada')).toBeNull();
  });

  it('las marcas ganan a la regla; el dominio vale para correos; "no interno" gana a todo', () => {
    const set = { handles: new Set([TEAMMATE, 'ana@otra.com']), excluded: new Set(['jefe@empresa.com']), domains: ['empresa.com'], lids: new Set<string>() };
    expect(isInternalHandle(set, TEAMMATE)).toBe(true);
    expect(isInternalHandle(set, `+${TEAMMATE}`)).toBe(true);
    expect(isInternalHandle(set, CUSTOMER)).toBe(false);
    expect(isInternalHandle(set, 'Bea@Empresa.com')).toBe(true);
    expect(isInternalHandle(set, 'jefe@empresa.com')).toBe(false);
    expect(isInternalHandle(set, 'ana@otra.com')).toBe(true);
    expect(isInternalHandle(set, '')).toBe(false);
    const sql = internalHandleSql(set, 'h');
    expect(sql.args).toHaveLength(3);
  });
});

describe('contactos internos: el mismo número de otra forma y los lids', () => {
  // Números inventados: Argentina con y sin el 9, México con y sin el 1.
  const AR9 = '5491100000301';
  const AR = '541100000301';
  const MX1 = '5215500000302';
  const MX = '525500000302';
  const LID = '111111111111301';
  const contact = (accountId: string, userId: string, phone: string, lid: string, app = 'lines') =>
    getDb()
      .prepare('INSERT INTO wa_contacts (id, app, account_id, user_id, phone, lid, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`wac-${++seq}-${Math.random().toString(36).slice(2)}`, app, accountId, userId, phone, lid, new Date().toISOString());

  it('la otra forma de un celular: Argentina con o sin 9, México con o sin 1; nada más', () => {
    expect(phoneTwin(AR9)).toBe(AR);
    expect(phoneTwin(AR)).toBe(AR9);
    expect(phoneTwin(MX1)).toBe(MX);
    expect(phoneTwin(MX)).toBe(MX1);
    expect(phoneTwin('14155550100')).toBeNull();
    expect(phoneTwin('549110000030')).toBeNull();
    expect(phoneTwin('5491100000301000')).toBeNull();
    expect(phoneVariants('14155550100')).toEqual(['14155550100']);
    expect(lidOf(`${LID}@lid`)).toBe(LID);
    expect(lidOf(`${LID}:3@lid`)).toBe(LID);
    expect(lidOf(`${AR9}@s.whatsapp.net`)).toBeNull();
  });

  it('marcado de una forma, cuenta de la otra; la última marca manda; los lids de la libreta de la línea', async () => {
    const u = await makeUser('int-twin');
    const n = await line(u.id, OTHER);
    await setInternalContact(u.id, u.id, '+54 11 0000-0301', true);
    await setInternalContact(u.id, u.id, '+52 55 0000 0302', true);
    let set = await loadInternalSet(u.id);
    expect(isInternalHandle(set, `${AR9}@s.whatsapp.net`)).toBe(true);
    expect(isInternalHandle(set, MX1)).toBe(true);
    // La libreta de la línea une el lid con el teléfono (en la forma de WhatsApp).
    await contact(n.id, u.id, AR9, LID);
    await contact(n.id, u.id, CUSTOMER, '111111111111399');
    set = await loadInternalSet(u.id);
    expect(isInternalHandle(set, `${LID}@lid`)).toBe(true);
    expect(isInternalHandle(set, LID)).toBe(true);
    expect(isInternalHandle(set, '111111111111399@lid')).toBe(false);
    expect(JSON.parse(internalPhonesJson(set))).toEqual(expect.arrayContaining([AR, AR9, `${LID}@lid`]));
    // Marcarlo "no interno" con la otra forma: queda una sola marca (la última) y ya no es interno, ni su lid.
    await setInternalContact(u.id, u.id, AR9, false);
    expect(await getDb().prepare("SELECT handle, internal FROM internal_contacts WHERE workspace_id = ? AND handle IN (?, ?)").all(u.id, AR, AR9)).toEqual([{ handle: AR9, internal: 0 }]);
    set = await loadInternalSet(u.id);
    expect(isInternalHandle(set, AR)).toBe(false);
    expect(isInternalHandle(set, `${LID}@lid`)).toBe(false);
    // Otro workspace no ve los lids de esta línea.
    const other = await makeUser('int-twin-other');
    await setInternalContact(other.id, other.id, MX, true);
    expect((await loadInternalSet(other.id)).lids.size).toBe(0);
  });

  it('Lines: quien escribe solo con su lid es interno si la libreta lo une a un teléfono interno', async () => {
    const u = await makeUser('int-lid');
    const n = await line(u.id, OTHER);
    await setInternalContact(u.id, u.id, AR, true);
    await contact(n.id, u.id, AR9, LID);
    const gid = '120363000000000411@g.us';
    await ingestEvents(n, [msg(gid, CUSTOMER, 'hola, ¿me ayudan?', 1)]);
    const group = (await listChats(u.id, u.id)).rows.find((c) => c.kind === 'group')!;
    expect((await getChat(u.id, group.id))!.awaitingSince).not.toBeNull();
    // Responde alguien del equipo que llegó solo con su lid: cuenta como respuesta.
    await ingestEvents(n, [msg(gid, '', 'ya lo vemos', 2, { senderLid: LID, senderName: 'Persona Equipo' })]);
    expect((await getChat(u.id, group.id))!.awaitingSince).toBeNull();
    // Un lid que la libreta no une a nadie interno no cuenta: el chat espera.
    await ingestEvents(n, [msg(gid, '', 'otra consulta', 3, { senderLid: '111111111111398' })]);
    expect((await getChat(u.id, group.id))!.awaitingSince).not.toBeNull();
    // Y en la otra forma del número (con el 9) también.
    await ingestEvents(n, [msg(gid, AR9, 'listo', 4)]);
    expect((await getChat(u.id, group.id))!.awaitingSince).toBeNull();
  });

  it('Lines: marcar deja de hacer esperar a los chats 1:1 con la otra forma del número o con su lid', async () => {
    const u = await makeUser('int-twin-stop');
    const n = await line(u.id, OTHER);
    await ingestEvents(n, [msg(`${AR9}@s.whatsapp.net`, AR9, 'hola', 1), msg(`${LID}@lid`, '', 'hola', 2)]);
    const dms = (await listChats(u.id, u.id)).rows.filter((c) => c.kind === 'dm');
    expect(dms).toHaveLength(2);
    for (const dm of dms) expect((await getChat(u.id, dm.id))!.awaitingSince).not.toBeNull();
    // El lid del segundo chat es de otro número interno según la libreta.
    await contact(n.id, u.id, MX1, LID);
    await setInternalContact(u.id, u.id, AR, true);
    await setInternalContact(u.id, u.id, MX, true);
    for (const dm of dms) expect((await getChat(u.id, dm.id))!.awaitingSince).toBeNull();
    // El filtro "internos" y la marca del chat los incluyen.
    const rows = (await listChats(u.id, u.id, { filters: { internal: 'yes' } } as Parameters<typeof listChats>[2])).rows;
    expect(rows.map((r) => r.id).sort()).toEqual(dms.map((d) => d.id).sort());
    expect(rows.every((r) => r.internal)).toBe(true);
  });

  it('Inbox: un chat 1:1 que todavía es el lid (sin teléfono) sale de Por responder y se marca', async () => {
    const w = await workspaceWithMember('int-lid-inbox');
    const acc = await inboxAccount(w.member.id);
    const thread = await upsertThread(acc, { externalId: `${LID}@lid`, kind: 'dm', handle: '' });
    await addMessage(thread, { externalId: 'ib-lid-1', fromMe: false, body: 'hola', senderHandle: '', sentAt: at(1) });
    await setInternalContact(w.owner.id, w.owner.id, AR, true);
    await contact(acc.id, w.member.id, AR9, LID, 'inbox');
    let internal = await loadInternalSet(w.owner.id, { inboxOwner: w.member.id });
    expect((await listThreadsPage(w.member.id, { view: 'reply', internal })).threads.map((t) => t.id)).not.toContain(thread.id);
    const listed = (await listThreadsPage(w.member.id, { view: 'internal', internal })).threads.find((t) => t.id === thread.id);
    expect(listed?.internal).toBe(true);
    // La libreta de otra persona no cuenta: para ella el chat espera respuesta.
    internal = await loadInternalSet(w.owner.id, { inboxOwner: w.friend.id });
    expect((await listThreadsPage(w.member.id, { view: 'reply', internal })).threads.map((t) => t.id)).toContain(thread.id);
  });

  it('al guardar un mensaje, lo interno se busca por índice también con el lid', async () => {
    const { planOf } = await import('./read-probe');
    const { internalPhoneSql } = await import('@/lib/internal-contacts');
    const expr = internalPhoneSql('ws-x', AR9, { accountId: 'acc-x', lid: LID });
    const plan = (await planOf(`SELECT ${expr.sql} AS x`, expr.args)).join('\n');
    expect(plan).toMatch(/zix USING (COVERING )?INDEX [^\n]*handle=\?/);
    expect(plan).toMatch(/zii USING (COVERING )?INDEX [^\n]*handle=\?/);
    expect(plan).not.toMatch(/^SCAN (zix|zii|tw|tw2)\b/m);
  });

  it('Inbox: la otra forma y los lids de la libreta de la persona; no los de otra persona', async () => {
    const w = await workspaceWithMember('int-twin-inbox');
    const acc = await inboxAccount(w.member.id);
    const thread = await upsertThread(acc, { externalId: `${AR9}@s.whatsapp.net`, kind: 'dm', handle: AR9 });
    await addMessage(thread, { externalId: 'ib-twin-1', fromMe: false, body: 'hola', senderHandle: AR9, sentAt: at(1) });
    await setInternalContact(w.owner.id, w.owner.id, AR, true);
    const internal = await loadInternalSet(w.owner.id, { inboxOwner: w.member.id });
    expect((await listThreadsPage(w.member.id, { view: 'reply', internal })).threads.map((t) => t.id)).not.toContain(thread.id);
    await contact(acc.id, w.member.id, AR9, LID, 'inbox');
    expect(isInternalHandle(await loadInternalSet(w.owner.id, { inboxOwner: w.member.id }), `${LID}@lid`)).toBe(true);
    // Sin la persona del Inbox (u otra persona), sus lids no entran.
    expect(isInternalHandle(await loadInternalSet(w.owner.id), `${LID}@lid`)).toBe(false);
    expect(isInternalHandle(await loadInternalSet(w.owner.id, { inboxOwner: w.friend.id }), `${LID}@lid`)).toBe(false);
  });
});

describe('contactos internos: por workspace', () => {
  it('las líneas cuentan como internas (salvo excepción o regla apagada) y lo de un workspace no toca a otro', async () => {
    const u = await makeUser('int-ws');
    const other = await makeUser('int-ws-other');
    await line(u.id, OTHER);
    expect(isInternalHandle(await loadInternalSet(u.id), OTHER)).toBe(true);
    expect(isInternalHandle(await loadInternalSet(other.id), OTHER)).toBe(false);
    await setInternalContact(u.id, u.id, OTHER, false);
    expect(isInternalHandle(await loadInternalSet(u.id), OTHER)).toBe(false);
    await setInternalContact(u.id, u.id, OTHER, null);
    await updateInternalSettings(u.id, { lines: false });
    expect(isInternalHandle(await loadInternalSet(u.id), OTHER)).toBe(false);

    await setInternalContact(u.id, u.id, `+${TEAMMATE}`, true, 'Persona Equipo');
    expect(isInternalHandle(await loadInternalSet(u.id), TEAMMATE)).toBe(true);
    expect(isInternalHandle(await loadInternalSet(other.id), TEAMMATE)).toBe(false);
    const list = await listInternalContacts(u.id);
    expect(list.map((c) => [c.handle, c.internal, c.name])).toEqual([[TEAMMATE, true, 'Persona Equipo']]);
    // Con los teléfonos ocultos: el número enmascarado y la referencia sirve para sacarlo.
    const masked = await listInternalContacts(u.id, { mask: true });
    expect(masked[0].handle).not.toContain(TEAMMATE);
    expect(await handleForRef(u.id, masked[0].ref)).toBe(TEAMMATE);
    // La referencia de otro workspace no encuentra nada, aunque ese workspace tenga el mismo número marcado.
    await setInternalContact(other.id, other.id, TEAMMATE, true);
    expect(await handleForRef(other.id, internalRef(u.id, TEAMMATE))).toBeNull();
    expect(await handleForRef(other.id, internalRef(other.id, TEAMMATE))).toBe(TEAMMATE);
    await expect(setInternalContact(u.id, u.id, 'basura', true)).rejects.toMatchObject({ code: 'invalid_handle' });
  });
});

describe('Lines: lo interno no espera respuesta', () => {
  it('un mensaje interno en un grupo cuenta como respuesta; no abre ticket; se marca en miembros, mensajes y el filtro', async () => {
    const u = await makeUser('int-lines');
    const n = await line(u.id, OTHER);
    await setInternalContact(u.id, u.id, TEAMMATE, true);
    await updateSettings(u.id, { ticketKeywords: ['urgente'] });
    const gid = '120363000000000401@g.us';

    await ingestEvents(n, [msg(gid, CUSTOMER, 'hola, ¿me ayudan?', 1)]);
    const group = (await listChats(u.id, u.id)).rows.find((c) => c.kind === 'group')!;
    expect((await getChat(u.id, group.id))!.awaitingSince).not.toBeNull();
    const { createTicket } = await import('@/lib/groups-tickets');
    const { ticket } = await createTicket(u.id, u.id, { chatId: group.id, title: 'Consulta' });
    const tickets = async () => Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM groups_tickets WHERE chat_id = ?').get(group.id)) as { n: number }).n);
    expect(await tickets()).toBe(1);

    // Responde alguien del equipo desde su teléfono, dentro del grupo: el chat deja de esperar.
    await ingestEvents(n, [msg(gid, TEAMMATE, 'urgente: ya lo vemos', 3)]);
    expect((await getChat(u.id, group.id))!.awaitingSince).toBeNull();
    // La palabra clave no abre un ticket si la escribe alguien interno; el abierto toma su primera respuesta.
    expect(await tickets()).toBe(1);
    const t = (await getDb().prepare('SELECT first_response_at FROM groups_tickets WHERE id = ?').get(ticket.id)) as { first_response_at: string | null };
    expect(t.first_response_at).not.toBeNull();
    // Otra línea del workspace (regla de las líneas) que está en el mismo grupo también es el equipo.
    await line(u.id, LINE2);
    await ingestEvents(n, [msg(gid, CUSTOMER, '¿y?', 5), msg(gid, LINE2, 'acá estamos', 6)]);
    expect((await getChat(u.id, group.id))!.awaitingSince).toBeNull();
    // Un cliente que vuelve a escribir: espera otra vez.
    await ingestEvents(n, [msg(gid, CUSTOMER, 'gracias, una cosa más', 8)]);
    expect((await getChat(u.id, group.id))!.awaitingSince).not.toBeNull();

    const msgs = await listMessages(u.id, group.id);
    expect(msgs.filter((m) => m.senderInternal).map((m) => m.senderPhone).sort()).toEqual([LINE2, TEAMMATE].sort());
    expect(msgs.filter((m) => m.direction === 'in' && m.senderPhone === CUSTOMER).every((m) => !m.senderInternal)).toBe(true);
    const members = await listMembers(u.id, group.id);
    expect(members.find((m) => m.phone === TEAMMATE)?.internal).toBe(true);
    expect(members.find((m) => m.phone === CUSTOMER)?.internal).toBeUndefined();

    // Chats 1:1: el del equipo es interno y se filtra (sí y no).
    await ingestEvents(n, [msg(`${TEAMMATE}@s.whatsapp.net`, TEAMMATE, 'te paso algo', 9), msg(`${CUSTOMER}@s.whatsapp.net`, CUSTOMER, 'consulta', 10)]);
    const dms = (await listChats(u.id, u.id)).rows.filter((c) => c.kind === 'dm');
    expect(dms.find((c) => c.phone === TEAMMATE)?.internal).toBe(true);
    expect(dms.find((c) => c.phone === CUSTOMER)?.internal).toBeUndefined();
    expect((await getChat(u.id, dms.find((c) => c.phone === TEAMMATE)!.id))!.awaitingSince).toBeNull();
    const yes = (await listChats(u.id, u.id, { filters: { internal: 'yes' } })).rows;
    expect(yes.map((c) => c.phone)).toEqual([TEAMMATE]);
    const no = (await listChats(u.id, u.id, { filters: { internal: 'no' } })).rows;
    expect(no.some((c) => c.phone === TEAMMATE)).toBe(false);
    expect(no.some((c) => c.phone === CUSTOMER)).toBe(true);

    // Un chat cerrado no se reabre por lo que escribe alguien interno; un cliente sí lo reabre.
    await getDb().prepare("UPDATE groups_chats SET status = 'closed' WHERE id = ?").run(group.id);
    await ingestEvents(n, [msg(gid, TEAMMATE, 'cierro esto', 11)]);
    expect((await getChat(u.id, group.id))!.status).toBe('closed');
    await ingestEvents(n, [msg(gid, CUSTOMER, 'una más', 12)]);
    expect((await getChat(u.id, group.id))!.status).toBe('open');
  });

  it('marcar a alguien como interno deja de hacer esperar a sus chats 1:1 que ya esperaban', async () => {
    const u = await makeUser('int-stop');
    const n = await line(u.id, OTHER);
    await ingestEvents(n, [msg(`${TEAMMATE}@s.whatsapp.net`, TEAMMATE, 'hola', 1)]);
    const dm = (await listChats(u.id, u.id)).rows.find((c) => c.kind === 'dm')!;
    expect((await getChat(u.id, dm.id))!.awaitingSince).not.toBeNull();
    await setInternalContact(u.id, u.id, TEAMMATE, true);
    expect((await getChat(u.id, dm.id))!.awaitingSince).toBeNull();
  });

  it('los reportes son de clientes: sin lo que escribe alguien interno ni sus chats 1:1', async () => {
    const u = await makeUser('int-analytics');
    const n = await line(u.id, OTHER);
    const gid = '120363000000000402@g.us';
    await ingestEvents(n, [msg(gid, CUSTOMER, 'uno', 1), msg(gid, TEAMMATE, 'dos', 2), msg(`${TEAMMATE}@s.whatsapp.net`, TEAMMATE, 'tres', 3)]);
    const before = await cachedLinesAnalytics(u.id, systemViewer(u.id), 'overview', { days: 7 });
    await setInternalContact(u.id, u.id, TEAMMATE, true);
    const after = await cachedLinesAnalytics(u.id, systemViewer(u.id), 'overview', { days: 7 });
    const inbound = (d: unknown) => (d as { kpis: { inbound: { value: number } } }).kpis.inbound.value;
    expect(inbound(before)).toBe(3);
    // Marcar a alguien cambia el reporte ya (la caché lleva la versión de lo interno).
    expect(inbound(after)).toBe(1);
  });
});

async function inboxAccount(owner: string): Promise<AccountRow> {
  return createAccount(owner, { kind: 'whatsapp', provider: 'fake', address: '+54 9 11 0000-0299' });
}

describe('Inbox: lo interno no está en "Por responder" ni en las métricas', () => {
  it('vistas, contadores y la vista Internos; el dominio de la empresa vale para correos', async () => {
    const w = await workspaceWithMember('int-inbox');
    const acc = await inboxAccount(w.member.id);
    const teammate = await upsertThread(acc, { externalId: `${TEAMMATE}@s.whatsapp.net`, kind: 'dm', handle: TEAMMATE });
    const customer = await upsertThread(acc, { externalId: `${CUSTOMER}@s.whatsapp.net`, kind: 'dm', handle: CUSTOMER });
    await addMessage(teammate, { externalId: 'ib-int-1', fromMe: false, body: '¿lo viste?', senderHandle: TEAMMATE, sentAt: at(1) });
    await addMessage(customer, { externalId: 'ib-int-2', fromMe: false, body: 'consulta', senderHandle: CUSTOMER, sentAt: at(2) });

    // Sin nada marcado: los dos esperan respuesta.
    let internal = await loadInternalSet(w.owner.id);
    expect((await listThreadsPage(w.member.id, { view: 'reply', internal })).threads.map((t) => t.handle).sort()).toEqual([CUSTOMER, TEAMMATE].sort());

    await setInternalContact(w.owner.id, w.owner.id, TEAMMATE, true);
    internal = await loadInternalSet(w.owner.id);
    const reply = (await listThreadsPage(w.member.id, { view: 'reply', internal })).threads;
    expect(reply.map((t) => t.handle)).toEqual([CUSTOMER]);
    const inner = (await listThreadsPage(w.member.id, { view: 'internal', internal })).threads;
    expect(inner.map((t) => t.handle)).toEqual([TEAMMATE]);
    expect(inner[0].internal).toBe(true);
    // En la bandeja sigue estando, marcado.
    const all = (await listThreadsPage(w.member.id, { view: 'inbox', internal })).threads;
    expect(all.find((t) => t.handle === TEAMMATE)?.internal).toBe(true);
    expect(all.find((t) => t.handle === CUSTOMER)?.internal).toBeUndefined();
    expect((await inboxCounts(w.member.id, new Date(), internal)).reply).toBe(1);
    expect((await inboxCounts(w.member.id)).reply).toBe(2);
    const stats = await inboxAnalytics(w.member.id, { days: 7 }, { internal });
    expect(stats.kpis.received.value).toBe(1);
    expect(stats.kpis.toReply.value).toBe(1);

    // Correos: el dominio de la empresa (y "no interno" gana).
    await updateInternalSettings(w.owner.id, { domains: ['empresa.com'] });
    await setInternalContact(w.owner.id, w.owner.id, 'cliente@empresa.com', false);
    internal = await loadInternalSet(w.owner.id);
    const sql = (await import('@/lib/inbox/core')).internalThreadSql(internal);
    const check = async (handle: string) =>
      Boolean(
        await getDb()
          .prepare(`SELECT 1 AS x FROM (SELECT 'dm' AS kind, ? AS handle, '' AS external_id) t WHERE ${sql.sql}`)
          .get(handle, ...sql.args),
      );
    expect(await check('ana@empresa.com')).toBe(true);
    expect(await check('cliente@empresa.com')).toBe(false);
    expect(await check('alguien@otra.com')).toBe(false);
  });
});

describe('contactos internos: acceso a las rutas', () => {
  it('Lines: anónimo 401, otro workspace no ve nada, member 403, admin y owner cambian', async () => {
    const w = await workspaceWithMember('int-route-lines');
    await setInternalContact(w.owner.id, w.owner.id, TEAMMATE, true);
    const route = await import('@/app/api/groups/internal/route');
    for (const r of roles(w)) {
      session.user = r.user;
      const res = await route.GET();
      if (r.name === 'anonymous') expect(res.status).toBe(401);
      else if (r.name === 'teammate') expect(res.status).toBe(403);
      else if (r.name === 'other_workspace') {
        expect(res.status).toBe(200);
        expect((await res.json()).contacts).toEqual([]);
      } else {
        expect(res.status).toBe(200);
        expect((await res.json()).contacts.map((c: { handle: string }) => c.handle)).toEqual([TEAMMATE]);
      }
    }
    // Un member no puede marcar a nadie; un admin sí.
    session.user = asMember(w.owner, w.member);
    expect((await route.POST(new Request('http://x/api/groups/internal', { method: 'POST', body: JSON.stringify({ handle: CUSTOMER, internal: true }) }))).status).toBe(403);
    session.user = asMember(w.owner, w.friend, 'admin');
    const ok = await route.POST(new Request('http://x/api/groups/internal', { method: 'POST', body: JSON.stringify({ handle: CUSTOMER, internal: false }) }));
    expect(ok.status).toBe(200);
    expect(isInternalHandle(await loadInternalSet(w.owner.id), CUSTOMER)).toBe(false);
    expect((await listInternalContacts(w.owner.id)).find((c) => c.handle === CUSTOMER)?.internal).toBe(false);
    // Otro workspace marcando el mismo número no toca este.
    session.user = asOwner(w.stranger);
    await route.POST(new Request('http://x/api/groups/internal', { method: 'POST', body: JSON.stringify({ handle: OTHER, internal: true }) }));
    expect(isInternalHandle(await loadInternalSet(w.owner.id), OTHER)).toBe(false);
    // Basura: 400.
    session.user = asOwner(w.owner);
    expect((await route.POST(new Request('http://x/api/groups/internal', { method: 'POST', body: JSON.stringify({ handle: 'nada', internal: true }) }))).status).toBe(400);
    // Un dominio inválido o de correo gratis no se guarda (nada a medias).
    expect((await route.PATCH(new Request('http://x/api/groups/internal', { method: 'PATCH', body: JSON.stringify({ domains: ['empresa.com', 'basura'] }) }))).status).toBe(400);
    expect((await route.PATCH(new Request('http://x/api/groups/internal', { method: 'PATCH', body: JSON.stringify({ domains: ['gmail.com'] }) }))).status).toBe(400);
    expect((await route.PATCH(new Request('http://x/api/groups/internal', { method: 'PATCH', body: JSON.stringify({ domains: ['empresa.com'] }) }))).status).toBe(200);
    expect((await loadInternalSet(w.owner.id)).domains).toEqual(['empresa.com']);
  });

  it('Lines: un admin con los teléfonos ocultos ve la lista enmascarada y saca por referencia', async () => {
    const w = await workspaceWithMember('int-route-mask');
    await setInternalContact(w.owner.id, w.owner.id, TEAMMATE, true);
    await updatePlatformSettings(w.owner.id, { maskRoles: ['admin'] });
    const route = await import('@/app/api/groups/internal/route');
    session.user = asMember(w.owner, w.friend, 'admin');
    const body = (await (await route.GET()).json()) as { contacts: Array<{ handle: string; ref: string; masked?: boolean }>; masked: boolean };
    expect(body.masked).toBe(true);
    expect(body.contacts[0].handle).not.toContain(TEAMMATE);
    expect(JSON.stringify(body)).not.toContain(TEAMMATE);
    await route.POST(new Request('http://x/api/groups/internal', { method: 'POST', body: JSON.stringify({ ref: body.contacts[0].ref, internal: null }) }));
    expect(await listInternalContacts(w.owner.id)).toEqual([]);
  });

  it('Inbox: anónimo 401, member 403, admin del workspace activo cambia lo del workspace', async () => {
    const w = await workspaceWithMember('int-route-inbox');
    const route = await import('@/app/api/inbox/internal/route');
    session.user = null;
    expect((await route.GET()).status).toBe(401);
    session.user = asMember(w.owner, w.member);
    expect((await route.GET()).status).toBe(403);
    expect((await route.POST(new Request('http://x/api/inbox/internal', { method: 'POST', body: JSON.stringify({ handle: TEAMMATE, internal: true }) }))).status).toBe(403);
    session.user = asMember(w.owner, w.friend, 'admin');
    expect((await route.POST(new Request('http://x/api/inbox/internal', { method: 'POST', body: JSON.stringify({ handle: TEAMMATE, internal: true }) }))).status).toBe(200);
    // Es del workspace (el del owner), no de la persona.
    expect(isInternalHandle(await loadInternalSet(w.owner.id), TEAMMATE)).toBe(true);
    expect(isInternalHandle(await loadInternalSet(w.friend.id), TEAMMATE)).toBe(false);
    session.user = asOwner(w.stranger);
    expect((await (await route.GET()).json()).contacts).toEqual([]);
  });
});
