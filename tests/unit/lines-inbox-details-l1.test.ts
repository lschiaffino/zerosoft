/**
 * Panel del chat en Lines e Inbox (pendientes del bloque L1):
 * - Lines, pestaña Notas: junta las notas internas de todas las líneas donde está el chat, solo las que quien mira
 *   ve (acceso por línea), cada una con su línea.
 * - Inbox, pestaña Notas: ?part=notes trae solo las notas del chat (sin armar la conversación), de la dueña.
 * - Inbox, pestaña CRM: el contacto y la empresa del CRM de zerosoft vinculados al chat, con la visibilidad del CRM
 *   de quien mira (anónimo, otro workspace, compañero que no ve el registro, member, admin, sin la app CRM).
 * Teléfonos, nombres y textos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getChatRow, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { groupsViewer } from '@/lib/groups-access';
import { setLineAccess } from '@/lib/groups-lines';
import { sharedContent } from '@/lib/groups-person';
import { createAccount, findThread, getAccountById } from '@/lib/inbox/core';
import { ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { inboxCrm, linkInboxCrm, threadPhone } from '@/lib/inbox/crm';
import { setMemberVisibility } from '@/lib/crm-visibility';
import type { InboundEvent } from '@/lib/groups-provider';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const waRoute = await import('@/lib/routes/inbox/threads/[id]/wa/route');

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  session.user = null;
  vi.unstubAllEnvs();
});

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
const phone = () => `10${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string, q: string) => waRoute.GET(new Request(`http://x/api/inbox/threads/${id}/wa?${q}`), ctx(id));
const post = (id: string, body: unknown) =>
  waRoute.POST(new Request(`http://x/api/inbox/threads/${id}/wa`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), ctx(id));

function ev(chatId: string, over: Partial<Extract<InboundEvent, { type: 'message' }>> = {}): InboundEvent {
  return { type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.split('@')[0], senderName: 'Contacto Demo', providerMessageId: `m-${uniq()}`, body: 'hola', ...over } as InboundEvent;
}

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

async function note(ws: string, chatId: string, body: string, author: string) {
  const chat = (await getChatRow(ws, chatId))!;
  await getDb()
    .prepare("INSERT INTO groups_messages (id, chat_id, user_id, number_id, direction, body, author_id, created_at) VALUES (?, ?, ?, ?, 'note', ?, ?, ?)")
    .run(`gm_${uniq()}`, chatId, ws, chat.number_id, body, author, new Date().toISOString());
}

describe('Lines: la pestaña Notas junta las líneas del chat', () => {
  it('trae las notas de las dos líneas con su nombre; quien no ve una línea no ve sus notas', async () => {
    const w = await workspaceWithMember('l1-notes');
    const ws = w.owner.id;
    const ventas = await line(ws, 'Ventas demo');
    const privada = await line(ws, 'Privada demo');
    const p = phone();
    await ingestEvents(ventas, [ev(`${p}@c.us`, { body: 'por ventas' })]);
    await ingestEvents(privada, [ev(`${p}@c.us`, { body: 'por la privada' })]);
    const rows = (await getDb().prepare('SELECT id, number_id FROM groups_chats WHERE user_id = ? AND phone = ?').all(ws, p)) as Array<{ id: string; number_id: string }>;
    const onVentas = rows.find((r) => r.number_id === ventas.id)!.id;
    const onPrivada = rows.find((r) => r.number_id === privada.id)!.id;
    await note(ws, onVentas, 'Nota en ventas', ws);
    await note(ws, onPrivada, 'Nota en la privada', ws);

    // El dueño: las dos, cada una con su línea, pidiendo desde cualquiera de los dos chats.
    const owner = await groupsViewer(ws, ws, 'owner');
    for (const from of [onVentas, onPrivada]) {
      const items = await sharedContent(owner, from, 'notes');
      expect(items.map((i) => [i.body, i.line]).sort()).toEqual([
        ['Nota en la privada', 'Privada demo'],
        ['Nota en ventas', 'Ventas demo'],
      ]);
    }

    // Un member sin acceso a la línea privada: solo la de ventas, sin nombre de línea (para él está en una sola).
    await setLineAccess(ws, privada.id, { visibility: 'restricted' });
    const member = await groupsViewer(ws, w.member.id, 'member');
    const seen = await sharedContent(member, onVentas, 'notes');
    expect(seen.map((i) => i.body)).toEqual(['Nota en ventas']);
    expect(seen[0].line).toBeUndefined();
    // Y el chat de la línea que no ve no existe para él.
    await expect(sharedContent(member, onPrivada, 'notes')).rejects.toMatchObject({ status: 404 });

    // Otro workspace: ni el chat.
    const stranger = await groupsViewer(w.stranger.id, w.stranger.id, 'owner');
    await expect(sharedContent(stranger, onVentas, 'notes')).rejects.toMatchObject({ status: 404 });
    // El chat sigue listado una vez para el dueño (no se tocó nada del resto).
    expect((await listChats(ws, ws, { cursor: '', limit: 50 })).rows.filter((r) => r.kind === 'dm')).toHaveLength(1);
    expect((await getChatRow(ws, onVentas))?.id).toBe(onVentas);
  });
});

/** Una cuenta de WhatsApp de Inbox de `person` con un chat 1:1 con `p`. */
async function inboxDm(person: string, p: string) {
  const a = await createAccount(person, { kind: 'whatsapp', provider: 'fake', label: 'Personal demo' });
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
  const acc = (await getAccountById(a.id))!;
  await ingestWhatsappEvents(acc, [ev(`${p}@s.whatsapp.net`, { body: 'hola por inbox' })]);
  return (await findThread(acc.id, `${p}@s.whatsapp.net`))!;
}

async function crmContact(ws: string, name: string, tel: string, owner: string | null) {
  const id = `ct_${uniq()}`;
  await getDb()
    .prepare("INSERT INTO crm_contacts (id, user_id, first_name, last_name, phone, owner_id, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, datetime('now'), datetime('now'))")
    .run(id, ws, name, tel, owner);
  return id;
}

describe('Inbox: pestaña Notas liviana', () => {
  it('?part=notes trae solo las notas de la dueña; nadie más las lee', async () => {
    const w = await workspaceWithMember('l1-inbox-notes');
    const t = await inboxDm(w.member.id, phone());
    await getDb().prepare('UPDATE inbox_threads SET notes = ? WHERE id = ?').run('Prefiere la tarde', t.id);

    session.user = null;
    expect((await get(t.id, 'part=notes')).status).toBe(401);
    session.user = asMember(w.owner, w.member);
    const mine = await get(t.id, 'part=notes');
    expect(mine.status).toBe(200);
    expect(await mine.json()).toEqual({ notes: 'Prefiere la tarde' });
    // El dueño del workspace, otra persona del equipo y otro workspace: el chat no es suyo.
    for (const u of [asOwner(w.owner), asMember(w.owner, w.friend), asOwner(w.stranger)]) {
      session.user = u;
      expect((await get(t.id, 'part=notes')).status).toBe(404);
    }
  });
});

describe('Inbox: pestaña CRM con el CRM de zerosoft', () => {
  it('teléfono del 1:1: por el id de WhatsApp o el handle; nada en grupos', () => {
    expect(threadPhone({ kind: 'dm', channel: 'whatsapp', handle: '', external_id: '5491100001111@s.whatsapp.net' })).toBe('5491100001111');
    expect(threadPhone({ kind: 'dm', channel: 'whatsapp', handle: '+54 9 11 0000-2222', external_id: '77@lid' })).toBe('5491100002222');
    expect(threadPhone({ kind: 'group', channel: 'whatsapp', handle: '', external_id: '1203@g.us' })).toBe('');
    expect(threadPhone({ kind: 'dm', channel: 'gmail', handle: 'a@b.c', external_id: 'x' })).toBe('');
  });

  it('sugiere por teléfono, vincula y muestra los negocios, con la visibilidad del CRM de quien mira', async () => {
    const w = await workspaceWithMember('l1-inbox-crm');
    const ws = w.owner.id;
    const p = phone();
    const t = await inboxDm(w.member.id, p);
    // Members ven solo lo suyo: un contacto de la persona (visible) y otro del dueño con el mismo teléfono (no).
    await setMemberVisibility(ws, 'mine');
    const mine = await crmContact(ws, 'Paula Demo', `+${p}`, w.member.id);
    const hidden = await crmContact(ws, 'Oculto Demo', `+${p}`, null);
    const company = `co_${uniq()}`;
    await getDb().prepare("INSERT INTO crm_companies (id, user_id, name, owner_id, created_at, updated_at) VALUES (?, ?, 'Acme Demo', ?, datetime('now'), datetime('now'))").run(company, ws, w.member.id);
    const member = asMember(w.owner, w.member);

    const first = (await inboxCrm(member, w.member.id, t.id))!;
    expect(first.contact).toBeNull();
    expect(first.suggestions.map((s) => s.id)).toEqual([mine]);

    // Vincular uno que no ve: el mismo error que uno que no existe. Uno de otro workspace, igual.
    await expect(linkInboxCrm(member, w.member.id, t.id, { crmContactId: hidden })).rejects.toMatchObject({ code: 'invalid_contact' });
    const foreign = await crmContact(w.stranger.id, 'Ajeno Demo', `+${p}`, null);
    await expect(linkInboxCrm(member, w.member.id, t.id, { crmContactId: foreign })).rejects.toMatchObject({ code: 'invalid_contact' });

    const linked = (await linkInboxCrm(member, w.member.id, t.id, { crmContactId: mine, crmCompanyId: company }))!;
    expect(linked.contact).toEqual({ id: mine, name: 'Paula Demo' });
    expect(linked.company).toEqual({ id: company, name: 'Acme Demo' });
    expect(linked.suggestions).toEqual([]);

    // Un vínculo guardado a un registro que la persona dejó de ver no se nombra.
    await getDb().prepare('UPDATE inbox_crm_links SET crm_contact_id = ? WHERE thread_id = ?').run(hidden, t.id);
    const after = (await inboxCrm(member, w.member.id, t.id))!;
    expect(after.contact).toBeNull();
    expect(after.company?.id).toBe(company);

    // El admin del workspace no lee el chat de otra persona (Inbox es personal).
    await expect(inboxCrm(asMember(w.owner, w.friend, 'admin'), w.friend.id, t.id)).rejects.toMatchObject({ status: 404 });
    // Desvincular todo borra la fila.
    await linkInboxCrm(member, w.member.id, t.id, { crmContactId: null, crmCompanyId: null });
    expect(await getDb().prepare('SELECT 1 FROM inbox_crm_links WHERE thread_id = ?').get(t.id)).toBeUndefined();
  });

  it('por la ruta: anónimo 401, otro workspace 404, sin la app CRM null y 403, invitado null; un admin ve lo del dueño', async () => {
    const w = await workspaceWithMember('l1-inbox-crm-route');
    const ws = w.owner.id;
    const p = phone();
    const t = await inboxDm(w.member.id, p);
    await setMemberVisibility(ws, 'mine');
    const ownerContact = await crmContact(ws, 'Del dueño', `+${p}`, null);

    session.user = null;
    expect((await get(t.id, 'part=crm')).status).toBe(401);
    expect((await post(t.id, { action: 'crm', crmContactId: ownerContact })).status).toBe(401);

    session.user = asOwner(w.stranger);
    expect((await get(t.id, 'part=crm')).status).toBe(404);

    // Sin la app CRM: nada del CRM (ni sugerencias) y no se vincula.
    session.user = asMember(w.owner, w.member, 'member', ['inbox', 'groups']);
    expect(await (await get(t.id, 'part=crm')).json()).toEqual({ crm: null });
    expect((await post(t.id, { action: 'crm', crmContactId: ownerContact })).status).toBe(403);
    session.user = asMember(w.owner, w.member, 'guest');
    expect(await (await get(t.id, 'part=crm')).json()).toEqual({ crm: null });

    // Member con 'mine': el contacto del dueño no aparece ni se vincula.
    session.user = asMember(w.owner, w.member);
    expect(((await (await get(t.id, 'part=crm')).json()) as { crm: { suggestions: unknown[] } }).crm.suggestions).toEqual([]);
    const denied = await post(t.id, { action: 'crm', crmContactId: ownerContact });
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({ error: 'invalid_contact' });

    // La misma persona como admin del workspace ve todo el CRM: lo sugiere y lo vincula.
    session.user = asMember(w.owner, w.member, 'admin');
    const asAdmin = (await (await get(t.id, 'part=crm')).json()) as { crm: { suggestions: Array<{ id: string }> } };
    expect(asAdmin.crm.suggestions.map((s) => s.id)).toEqual([ownerContact]);
    const ok = await post(t.id, { action: 'crm', crmContactId: ownerContact });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { crm: { contact: { id: string } } }).crm.contact.id).toBe(ownerContact);
  });

  it('un chat de otra persona del mismo workspace no se vincula', async () => {
    const w = await workspaceWithMember('l1-inbox-crm-other');
    const t = await inboxDm(w.member.id, phone());
    const c = await crmContact(w.owner.id, 'Contacto', '+100', null);
    await expect(linkInboxCrm(asOwner(w.owner), w.owner.id, t.id, { crmContactId: c })).rejects.toMatchObject({ status: 404 });
    const other = await makeUser('l1-nobody');
    await expect(inboxCrm(asOwner(other), other.id, t.id)).rejects.toMatchObject({ status: 404 });
  });
});
