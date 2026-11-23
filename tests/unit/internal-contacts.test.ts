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
  handleForRef,
  internalHandleSql,
  internalRef,
  isInternalHandle,
  listInternalContacts,
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
    expect(cleanDomain('@Empresa.com')).toBe('empresa.com');
    expect(cleanDomain('https://empresa.com/x')).toBe('empresa.com');
    expect(cleanDomain('nada')).toBeNull();
  });

  it('las marcas ganan a la regla; el dominio vale para correos; "no interno" gana a todo', () => {
    const set = { handles: new Set([TEAMMATE, 'ana@otra.com']), excluded: new Set(['jefe@empresa.com']), domains: ['empresa.com'] };
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
    // La referencia de otro workspace no encuentra nada.
    expect(await handleForRef(other.id, internalRef(u.id, TEAMMATE))).toBeNull();
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
    // La línea misma (regla de las líneas) también es el equipo.
    await ingestEvents(n, [msg(gid, CUSTOMER, '¿y?', 5), msg(gid, OTHER, 'acá estamos', 6)]);
    expect((await getChat(u.id, group.id))!.awaitingSince).toBeNull();
    // Un cliente que vuelve a escribir: espera otra vez.
    await ingestEvents(n, [msg(gid, CUSTOMER, 'gracias, una cosa más', 8)]);
    expect((await getChat(u.id, group.id))!.awaitingSince).not.toBeNull();

    const msgs = await listMessages(u.id, group.id);
    expect(msgs.filter((m) => m.senderInternal).map((m) => m.senderPhone).sort()).toEqual([OTHER, TEAMMATE].sort());
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
          .prepare(`SELECT 1 AS x FROM (SELECT 'dm' AS kind, ? AS handle) t WHERE ${sql.sql}`)
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
    expect((await route.PATCH(new Request('http://x/api/groups/internal', { method: 'PATCH', body: JSON.stringify({ domains: ['empresa.com', 'basura'] }) }))).status).toBe(200);
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
