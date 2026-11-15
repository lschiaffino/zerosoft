import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { EVOLUTION_EVENTS, parseEvolutionWebhook, syncEvolutionWebhook } from '@/lib/groups-provider-bridge';
import { connectNumber, createGroups, createNumber, getNumberRowById, ingestEvents, listChats, type NumberRow } from '@/lib/groups';
import { addMessage, applyThreadAction, createFolder, findThread, getAccountById, listMessages, listThreadsPage, upsertThread } from '@/lib/inbox/core';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { createWhatsappGroup } from '@/lib/inbox/new-chat';
import { inboxCreatedFromInfo } from '@/lib/wa-group-system';
import { bumpsChat, decodeSysPreview, encodeSysPreview, groupEventId, groupEventMessage, participantsEvent, personLabel, type WaGroupEvent } from '@/lib/wa-group-events';
import { makeUser } from './helpers';

/**
 * Grupos nuevos en la lista aunque no tengan mensajes, y los avisos del grupo
 * ("Creaste el grupo", "Ana te agregó", "Beto salió") en Inbox y Lines.
 * Teléfonos y nombres inventados.
 */

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_PUSH_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

const ME = '15550000001';
const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);

async function inboxAccount(label: string) {
  const u = await makeUser(label);
  const { account: a } = await connectWhatsapp(u.id);
  const s = fakeState(`inbox-${a.id}`);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = ? WHERE id = ?").run(ME, a.id);
  return { u, account: (await getAccountById(a.id))! };
}

async function line(label: string): Promise<{ ws: string; n: NumberRow }> {
  const u = await makeUser(label);
  const n = await createNumber(u.id, u.id, { provider: 'fake', name: 'Ventas' });
  await connectNumber(u.id, n.id);
  const s = fakeState(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected', phone = ? WHERE id = ?").run(ME, n.id);
  return { ws: u.id, n: (await getNumberRowById(n.id))! };
}

/** Un chat 1:1 con un mensaje de hace `minutes` minutos. */
async function dmWithMessage(account: Awaited<ReturnType<typeof inboxAccount>>['account'], phone: string, minutes: number) {
  const t = await upsertThread(account, { externalId: `${phone}@s.whatsapp.net`, kind: 'dm', title: `Chat ${phone.slice(-4)}`, handle: phone });
  await addMessage(t, { externalId: `m-${phone}`, fromMe: false, body: 'hola', sentAt: new Date(Date.now() - minutes * 60_000).toISOString() });
  return t;
}

describe('avisos del grupo (puro)', () => {
  it('salir, entrar con el link, agregar y sacar', () => {
    expect(participantsEvent('remove', ['5491100000002'], '5491100000002', ME)).toEqual({ t: 'leave', by: { p: '5491100000002' } });
    expect(participantsEvent('remove', [ME], ME, ME)).toEqual({ t: 'leave', by: { p: 'me' } });
    expect(participantsEvent('add', ['5491100000003'], '', ME)).toEqual({ t: 'join', by: { p: '5491100000003' } });
    expect(participantsEvent('add', [ME], '5491100000002', ME)).toEqual({ t: 'add', by: { p: '5491100000002' }, who: [{ p: 'me' }] });
    expect(participantsEvent('remove', ['5491100000003'], ME, ME)).toEqual({ t: 'remove', by: { p: 'me' }, who: [{ p: '5491100000003' }] });
    expect(participantsEvent('promote', ['123456789012345@lid'], '', ME)).toEqual({ t: 'promote', who: [{ p: '123456789012345@lid' }] });
    expect(participantsEvent('add', [], ME, ME)).toBeNull();
  });

  it('solo crear y que me agreguen suben el chat', () => {
    expect(bumpsChat({ t: 'create' })).toBe(true);
    expect(bumpsChat({ t: 'add', by: { p: '1' }, who: [{ p: 'me' }] })).toBe(true);
    expect(bumpsChat({ t: 'join', by: { p: 'me' } })).toBe(true);
    expect(bumpsChat({ t: 'add', by: { p: 'me' }, who: [{ p: '5491100000002' }] })).toBe(false);
    expect(bumpsChat({ t: 'leave', by: { p: '5491100000002' } })).toBe(false);
    expect(bumpsChat({ t: 'subject', by: { p: 'me' }, subject: 'x' })).toBe(false);
  });

  it('la vista previa guardada ida y vuelta, y no confunde un texto común', () => {
    const e: WaGroupEvent = { t: 'create', by: { p: 'me' }, subject: 'Asado' };
    expect(decodeSysPreview(encodeSysPreview(e))).toEqual(e);
    expect(decodeSysPreview('hola')).toBeNull();
    expect(decodeSysPreview('[sys]{roto')).toBeNull();
    expect(decodeSysPreview('[sys]{"t":"otra"}')).toBeNull();
  });

  it('el texto: mío, de otro, sin saber quién', () => {
    const name = (p: { p: string; n?: string }) => personLabel(p, 'Alguien');
    expect(groupEventMessage({ t: 'create', by: { p: 'me' }, subject: 'Asado' }, name)).toEqual({ key: 'createdMe', values: { by: '', subject: 'Asado' } });
    expect(groupEventMessage({ t: 'create', by: { p: '5491100000002', n: 'Ana' }, subject: 'Asado' }, name)).toMatchObject({ key: 'created', values: { by: 'Ana' } });
    expect(groupEventMessage({ t: 'create', subject: 'Asado' }, name).key).toBe('createdUnknown');
    expect(groupEventMessage({ t: 'add', by: { p: '5491100000002', n: 'Ana' }, who: [{ p: 'me' }] }, name)).toEqual({ key: 'addedYou', values: { by: 'Ana' } });
    expect(groupEventMessage({ t: 'add', by: { p: 'me' }, who: [{ p: '5491100000003' }] }, name)).toMatchObject({ key: 'addedMe', values: { who: '+5491100000003' } });
    expect(groupEventMessage({ t: 'leave', by: { p: '999@lid' } }, name)).toEqual({ key: 'left', values: { who: 'Alguien' } });
    expect(groupEventMessage({ t: 'leave', by: { p: 'me' } }, name).key).toBe('leftMe');
    expect(groupEventMessage({ t: 'promote', who: [{ p: 'me' }] }, name).key).toBe('promotedYou');
  });

  it('el id del aviso es estable por grupo y minuto (un reintento no lo repite)', () => {
    const at = '2026-11-15T12:00:10.000Z';
    const e: WaGroupEvent = { t: 'leave', by: { p: '5491100000002' } };
    expect(groupEventId(e, at, '120363000@g.us')).toBe(groupEventId(e, '2026-11-15T12:00:50.000Z', '120363000@g.us'));
    expect(groupEventId(e, at, '120363000@g.us')).not.toBe(groupEventId(e, at, '120363001@g.us'));
    expect(groupEventId({ t: 'create' }, at, '120363000@g.us')).toBe('sys:create:120363000');
  });
});

describe('Evolution: lo que llega del servidor', () => {
  it('GROUPS_UPSERT es un grupo nuevo con quién lo creó y cuándo', () => {
    const ev = parseEvolutionWebhook({
      event: 'groups.upsert',
      data: [{ id: '120363000111@g.us', subject: '  Asado   del sábado ', owner: '987654321012345@lid', ownerPn: '5491100000002@s.whatsapp.net', creation: 1763200000, participants: [{ id: '5491100000002@s.whatsapp.net' }, { id: `${ME}@s.whatsapp.net` }] }],
    });
    expect(ev).toEqual([
      { type: 'group', chatId: '120363000111@g.us', event: 'create', subject: 'Asado del sábado', owner: '5491100000002', creation: 1763200000, phones: ['5491100000002', ME] },
    ]);
  });

  it('participantes: usa los teléfonos resueltos y quién lo hizo', () => {
    const ev = parseEvolutionWebhook({
      event: 'group-participants.update',
      data: { id: '120363000111@g.us', action: 'add', author: '5491100000002@s.whatsapp.net', participants: ['111111111111111@lid'], participantsData: [{ jid: '111111111111111@lid', phoneNumber: `${ME}@s.whatsapp.net` }] },
    });
    expect(ev).toEqual([{ type: 'participants', chatId: '120363000111@g.us', action: 'add', phones: [ME], author: '5491100000002' }]);
    // Sin participantsData ni autor, como antes.
    expect(parseEvolutionWebhook({ event: 'GROUP_PARTICIPANTS_UPDATE', data: { id: '1@g.us', action: 'remove', participants: ['5491100000002@s.whatsapp.net'] } })).toEqual([
      { type: 'participants', chatId: '1@g.us', action: 'remove', phones: ['5491100000002'] },
    ]);
  });

  it('groups.update: solo los cambios con autor (la metadata completa al conectar no es un aviso)', () => {
    expect(parseEvolutionWebhook({ event: 'groups.update', data: [{ id: '1@g.us', subject: 'Nuevo', author: '5491100000002@s.whatsapp.net' }] })).toEqual([
      { type: 'group', chatId: '1@g.us', event: 'subject', subject: 'Nuevo', author: '5491100000002' },
    ]);
    expect(parseEvolutionWebhook({ event: 'groups.update', data: [{ id: '1@g.us', subject: 'Todo', participants: [] }] })).toEqual([]);
    expect(parseEvolutionWebhook({ event: 'groups.update', data: [{ id: '1@g.us', subject: 'Sin autor' }] })).toEqual([]);
  });

  it('suma los eventos que le faltan al webhook con la misma URL', async () => {
    const calls: Array<{ path: string; method: string; body?: unknown }> = [];
    const call = async (path: string, method: string, body?: unknown) => {
      calls.push({ path, method, body });
      return path.startsWith('/webhook/find') ? { url: 'https://example.test/hook/x/y', enabled: true, events: ['MESSAGES_UPSERT'] } : {};
    };
    expect(await syncEvolutionWebhook(call, 'inst')).toBe(true);
    expect(calls[1]).toMatchObject({ path: '/webhook/set/inst', method: 'POST', body: { webhook: { url: 'https://example.test/hook/x/y', events: EVOLUTION_EVENTS } } });
    expect(EVOLUTION_EVENTS).toContain('GROUPS_UPSERT');
    // Ya los tiene, o no hay webhook: no toca nada.
    expect(await syncEvolutionWebhook(async () => ({ url: 'https://example.test/h', events: EVOLUTION_EVENTS }), 'inst')).toBe(false);
    expect(await syncEvolutionWebhook(async () => null, 'inst')).toBe(false);
  });
});

describe('Inbox', () => {
  it('un grupo creado desde zerosoft queda arriba con "Creaste el grupo", sin no leídos, y respeta vistas, carpetas, búsqueda y archivo', async () => {
    const { u, account: a } = await inboxAccount('wge-inbox-create');
    for (let i = 0; i < 3; i++) await dmWithMessage(a, `549110000010${i}`, 5 + i);
    const g = await createWhatsappGroup(u.id, { name: 'Asado del sábado', phones: ['5491100000002', '5491100000003'] });
    expect(g.last_message_at).not.toBeNull();
    const page = await listThreadsPage(u.id);
    expect(page.threads[page.pinned].id).toBe(g.id);
    const row = page.threads[page.pinned];
    expect(row).toMatchObject({ kind: 'group', unread: 0, lastKind: 'system' });
    expect(decodeSysPreview(row.preview)).toEqual({ t: 'create', by: { p: 'me' }, subject: 'Asado del sábado' });
    expect((await listThreadsPage(u.id, { view: 'groups' })).threads.map((t) => t.id)).toContain(g.id);
    expect((await listThreadsPage(u.id, { view: 'unread' })).threads.map((t) => t.id)).not.toContain(g.id);
    expect((await listThreadsPage(u.id, { q: 'Asado del' })).threads.map((t) => t.id)).toContain(g.id);
    const f = await createFolder(u.id, { name: 'Amigos' });
    await applyThreadAction(u.id, [g.id], { action: 'addFolder', folderId: f.id });
    expect((await listThreadsPage(u.id, { folderId: f.id })).threads.map((t) => t.id)).toEqual([g.id]);
    await applyThreadAction(u.id, [g.id], { action: 'archive' });
    expect((await listThreadsPage(u.id)).threads.map((t) => t.id)).not.toContain(g.id);
    expect((await listThreadsPage(u.id, { view: 'archived' })).threads.map((t) => t.id)).toContain(g.id);
    // En el chat: la fila de sistema (sin mensajes reales).
    const msgs = (await listMessages(u.id, g.id)).messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ mediaType: 'system', fromMe: true, meta: { sys: { t: 'create' } } });
  });

  it('creado en el teléfono (GROUPS_UPSERT) o al agregarme: aparece sin mensajes; el eco no duplica', async () => {
    const { u, account: a } = await inboxAccount('wge-inbox-phone');
    await dmWithMessage(a, '5491100000101', 3);
    const created = parseEvolutionWebhook({ event: 'groups.upsert', data: [{ id: '120363000222@g.us', subject: 'Trabajo', owner: `${ME}@s.whatsapp.net`, creation: Math.floor(Date.now() / 1000) }] });
    await ingestWhatsappEvents(a, created);
    await ingestWhatsappEvents(a, created);
    const t = (await findThread(a.id, '120363000222@g.us'))!;
    expect(t).toMatchObject({ kind: 'group', title: 'Trabajo', unread: 0 });
    expect((await listMessages(u.id, t.id)).messages).toHaveLength(1);
    expect((await listThreadsPage(u.id)).threads[0].id).toBe(t.id);

    // Otra persona me agrega a un grupo que no estaba.
    await ingestWhatsappEvents(a, [{ type: 'participants', chatId: '120363000333@g.us', action: 'add', phones: [ME], author: '5491100000002' }]);
    const added = (await findThread(a.id, '120363000333@g.us'))!;
    expect(added).toMatchObject({ kind: 'group', unread: 0 });
    expect(decodeSysPreview(added.preview)).toEqual({ t: 'add', by: { p: '5491100000002' }, who: [{ p: 'me' }] });
    // Un cambio en un grupo que no tengo (y que no me incluye) no crea nada.
    await ingestWhatsappEvents(a, [{ type: 'participants', chatId: '120363000444@g.us', action: 'add', phones: ['5491100000009'], author: '5491100000002' }]);
    expect(await findThread(a.id, '120363000444@g.us')).toBeNull();
  });

  it('alguien sale: la vista previa cambia, el chat no sube ni suma no leídos', async () => {
    const { u, account: a } = await inboxAccount('wge-inbox-leave');
    const g = await upsertThread(a, { externalId: '120363000555@g.us', kind: 'group', title: 'Club' });
    const at = new Date(Date.now() - 3600_000).toISOString();
    await addMessage(g, { externalId: 'g-1', fromMe: false, body: 'buenas', senderName: 'Ana', sentAt: at });
    await dmWithMessage(a, '5491100000201', 1);
    await ingestWhatsappEvents(a, [{ type: 'participants', chatId: '120363000555@g.us', action: 'remove', phones: ['5491100000002'], author: '5491100000002' }]);
    const t = (await findThread(a.id, '120363000555@g.us'))!;
    expect(t.last_message_at).toBe(at);
    expect(t.unread).toBe(1);
    expect(decodeSysPreview(t.preview)).toEqual({ t: 'leave', by: { p: '5491100000002' } });
    expect((await listThreadsPage(u.id)).threads[0].id).not.toBe(g.id);
    const msgs = (await listMessages(u.id, g.id)).messages;
    expect(msgs.map((m) => m.mediaType)).toEqual(['', 'system']);
  });

  it('un grupo vacío que ya estaba: va al lugar de su creación en WhatsApp (los viejos quedan abajo)', async () => {
    const { u, account: a } = await inboxAccount('wge-inbox-info');
    await dmWithMessage(a, '5491100000301', 60);
    const recent = await upsertThread(a, { externalId: '120363000666@g.us', kind: 'group', title: 'Nuevo' });
    const old = await upsertThread(a, { externalId: '120363000777@g.us', kind: 'group', title: 'Viejo' });
    const now = Math.floor(Date.now() / 1000);
    expect(await inboxCreatedFromInfo(a, { ...recent, last_message_at: null }, { name: 'Nuevo', createdAt: now - 60, owner: ME })).toBe(true);
    expect(await inboxCreatedFromInfo(a, { ...old, last_message_at: null }, { name: 'Viejo', createdAt: now - 400 * 86_400, owner: '5491100000002' })).toBe(true);
    const ids = (await listThreadsPage(u.id)).threads.map((t) => t.id);
    expect(ids.indexOf(recent.id)).toBe(0);
    expect(ids.indexOf(old.id)).toBe(ids.length - 1);
    // Con mensajes no se toca.
    expect(await inboxCreatedFromInfo(a, { ...recent, last_message_at: new Date().toISOString() }, { name: 'Nuevo', createdAt: now })).toBe(false);
  });
});

describe('Lines', () => {
  it('crear un grupo deja "Creaste el grupo" como vista previa y primera línea', async () => {
    const { ws, n } = await line('wge-lines-create');
    const [r] = await createGroups(ws, n.id, [{ name: 'Clientes VIP', phones: ['5491100000002'] }]);
    expect(r.ok).toBe(true);
    const { rows } = await listChats(ws, ws, {});
    expect(rows[0].id).toBe(r.chatId);
    expect(rows[0].unread).toBe(0);
    expect(decodeSysPreview(rows[0].lastMessagePreview)).toEqual({ t: 'create', by: { p: 'me' }, subject: 'Clientes VIP' });
    const sys = (await getDb().prepare("SELECT author_kind, direction FROM groups_messages WHERE chat_id = ? AND direction = 'system'").all(r.chatId!)) as Array<{ author_kind: string }>;
    expect(sys).toEqual([{ author_kind: 'wa', direction: 'system' }]);
  });

  it('me agregan a un grupo nuevo: el chat aparece; alguien sale después: aviso sin no leídos', async () => {
    const { ws, n } = await line('wge-lines-add');
    await ingestEvents(n, [{ type: 'participants', chatId: '120363000888@g.us', action: 'add', phones: [ME], author: '5491100000002' }]);
    const chat = (await getDb().prepare('SELECT * FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(n.id, '120363000888@g.us')) as {
      id: string;
      name: string;
      unread_count: number;
      last_message_at: string;
    };
    expect(chat).toBeTruthy();
    expect(chat.unread_count).toBe(0);
    expect(chat.name).not.toBe('');
    const before = chat.last_message_at;
    await ingestEvents(n, [{ type: 'participants', chatId: '120363000888@g.us', action: 'remove', phones: ['5491100000003'], author: '5491100000003' }]);
    const { rows } = await listChats(ws, ws, {});
    const row = rows.find((c) => c.id === chat.id)!;
    expect(row.unread).toBe(0);
    expect(row.lastMessageAt).toBe(before);
    expect(decodeSysPreview(row.lastMessagePreview)).toEqual({ t: 'leave', by: { p: '5491100000003' } });
  });
});
