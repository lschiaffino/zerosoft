/**
 * El cuadro de quién reaccionó (Inbox y Lines): pestañas por emoji, orden de
 * la lista, nombre de la libreta o de perfil ("~"), teléfono enmascarado para
 * quien no ve teléfonos (del lado del servidor) y una sola reacción propia por
 * número en Lines. Números y nombres inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { filterReactors, reactionTabs, reactorName, reactorPhone, sortReactors } from '@/lib/wa-reactions';
import { rememberContacts } from '@/lib/wa-contacts';
import { addMessage, createAccount, getAccountById, upsertThread } from '@/lib/inbox/core';
import { reactionDetails as inboxReactions, storeReaction } from '@/lib/inbox/wa-meta';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listMessages, reactToMessage } from '@/lib/groups';
import { reactionDetails as linesReactions } from '@/lib/groups-person';
import { systemViewer, viewerFrom, DEFAULT_PLATFORM } from '@/lib/groups-access';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import type { InboundEvent } from '@/lib/groups-provider';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const ME = '15550000001';
const ANA = '5491177730011';
const BETO = '5491177730022';

describe('cuadro de reacciones (puro)', () => {
  it('una pestaña por emoji, la más usada primero y con empate la que llegó antes', () => {
    const list = [{ emoji: '👍' }, { emoji: '❤️' }, { emoji: '❤️' }, { emoji: '😂' }, { emoji: '' }];
    expect(reactionTabs(list)).toEqual([
      { emoji: '❤️', count: 2 },
      { emoji: '👍', count: 1 },
      { emoji: '😂', count: 1 },
    ]);
    expect(reactionTabs([])).toEqual([]);
  });

  it('la propia primero; después la más nueva arriba (sin hora, la guardada después)', () => {
    const list = [
      { id: 'a', me: false, at: '2026-11-15T10:00:00Z' },
      { id: 'b', me: false, at: '2026-11-15T12:00:00Z' },
      { id: 'me', me: true, at: '2026-11-15T09:00:00Z' },
      { id: 'c', me: false },
      { id: 'd', me: false },
    ];
    const ids = sortReactors(list).map((r) => r.id);
    expect(ids[0]).toBe('me');
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('a'));
    expect(ids.indexOf('d')).toBeLessThan(ids.indexOf('c'));
  });

  it('una pestaña filtra la lista; "Todas" la muestra entera', () => {
    const list = [{ emoji: '👍' }, { emoji: '❤️' }, { emoji: '👍' }];
    expect(filterReactors(list, '👍')).toHaveLength(2);
    expect(filterReactors(list, null)).toHaveLength(3);
  });

  it('nombre: el de la libreta tal cual; si no, el de perfil marcado; un número no es un nombre', () => {
    expect(reactorName({ saved: ['Ana Libreta'], push: ['Anita'] })).toEqual({ name: 'Ana Libreta', pushName: false });
    expect(reactorName({ saved: ['', undefined], push: ['Anita'] })).toEqual({ name: 'Anita', pushName: true });
    expect(reactorName({ saved: ['+54 9 11 7773-0011'], push: ['5491177730011'] })).toEqual({ name: '', pushName: false });
  });

  it('teléfono: los dígitos, enmascarado si no se ven teléfonos, nada si no es un teléfono', () => {
    expect(reactorPhone(ANA, false)).toEqual({ phone: ANA });
    const masked = reactorPhone(ANA, true);
    expect(masked.masked).toBe(true);
    expect(masked.phone).not.toContain('77730011');
    expect(reactorPhone('123', false)).toEqual({ phone: '' });
  });
});

describe('Inbox: quién reaccionó', () => {
  it('nombre de la libreta o de perfil, foto, teléfono y la propia como "me"', async () => {
    const u = await makeUser('warx-i');
    const other = await makeUser('warx-i2');
    const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = ? WHERE id = ?").run(ME, a.id);
    const acc = (await getAccountById(a.id))!;
    const group = await upsertThread(acc, { externalId: '120363000000000901@g.us', kind: 'group', title: 'Asado' });
    await addMessage(group, { externalId: 'rx1', fromMe: false, body: 'hola', senderHandle: BETO, senderName: 'Beto Perfil' });
    await rememberContacts({ app: 'inbox', accountId: acc.id, userId: u.id }, [{ phone: ANA, saved: 'Ana Libreta', push: 'Anita' }]);
    await getDb().prepare("UPDATE wa_contacts SET picture = '/uploads/chat/ana.jpg' WHERE account_id = ? AND phone = ?").run(acc.id, ANA);
    await storeReaction(acc, group.external_id, 'rx1', { emoji: '❤️', by: ANA, name: 'Anita', at: '2026-11-15T10:00:00Z' });
    await storeReaction(acc, group.external_id, 'rx1', { emoji: '👍', by: BETO, name: 'Beto Perfil', at: '2026-11-15T11:00:00Z' });
    await storeReaction(acc, group.external_id, 'rx1', { emoji: '❤️', by: 'me', name: '', at: '2026-11-15T12:00:00Z' });
    const id = String(((await getDb().prepare("SELECT id FROM inbox_messages WHERE thread_id = ? AND external_id = 'rx1'").get(group.id)) as { id: string }).id);

    const list = await inboxReactions(u.id, group.id, [id]);
    expect(list).toHaveLength(3);
    expect(list.find((r) => r.me)).toMatchObject({ emoji: '❤️', name: '', phone: '' });
    expect(list.find((r) => r.phone === ANA)).toMatchObject({ emoji: '❤️', name: 'Ana Libreta', pushName: false, picture: '/uploads/chat/ana.jpg', at: '2026-11-15T10:00:00Z' });
    expect(list.find((r) => r.phone === BETO)).toMatchObject({ emoji: '👍', name: 'Beto Perfil', pushName: true });

    // De otra persona: no existe.
    await expect(inboxReactions(other.id, group.id, [id])).rejects.toMatchObject({ code: 'not_found' });
    // Un mensaje de otro chat no se lee por este.
    const dm = await upsertThread(acc, { externalId: `${ANA}@s.whatsapp.net`, kind: 'dm', handle: ANA });
    expect(await inboxReactions(u.id, dm.id, [id])).toEqual([]);
  });
});

describe('Lines: quién reaccionó', () => {
  function ev(over: Record<string, unknown>): InboundEvent {
    return {
      type: 'message',
      chatId: '120363000000000902@g.us',
      isGroup: true,
      chatName: 'Proveedores',
      fromMe: false,
      senderPhone: ANA,
      senderName: 'Ana Perfil',
      providerMessageId: `m-${Math.random().toString(36).slice(2)}`,
      body: 'hola',
      timestamp: new Date().toISOString(),
      ...over,
    } as InboundEvent;
  }

  it('lista la de otra persona y la propia; con teléfonos ocultos el número no sale del servidor', async () => {
    const user = await makeUser('warx-l');
    const other = await makeUser('warx-l2');
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    const fake = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (fake) fake.connectedAt = Date.now() - 5000;
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected', phone = ? WHERE id = ?").run(ME, n.id);
    const row = (await getNumberRowById(n.id))!;
    await ingestEvents(row, [ev({ providerMessageId: 'rx-target', body: 'precios' })]);
    await ingestEvents(row, [{ type: 'reaction', chatId: '120363000000000902@g.us', targetProviderMessageId: 'rx-target', emoji: '👍', senderPhone: ANA, senderName: 'Ana Perfil', fromMe: false }]);
    const chat = (await listChats(user.id, user.id, { kind: 'group' })).rows.find((c) => c.name === 'Proveedores')!;
    const m = (await listMessages(user.id, chat.id)).find((x) => x.body === 'precios')!;
    await reactToMessage(user.id, user.id, m.id, '❤️');

    const viewer = systemViewer(user.id);
    let list = await linesReactions(viewer, chat.id, [m.id]);
    expect(list).toHaveLength(2);
    expect(list.find((r) => r.me)).toMatchObject({ emoji: '❤️', phone: '', name: '' });
    expect(list.find((r) => !r.me)).toMatchObject({ emoji: '👍', phone: ANA, name: 'Ana Perfil', pushName: true });

    // Quien no ve teléfonos: enmascarado, sin los dígitos en ningún campo.
    const masked = { ...viewerFrom(user.id, user.id, 'member', { ...DEFAULT_PLATFORM, maskRoles: ['member'] }), linesScoped: false };
    list = await linesReactions(masked, chat.id, [m.id]);
    const ana = list.find((r) => !r.me)!;
    expect(ana.masked).toBe(true);
    expect(JSON.stringify(list)).not.toContain('77730011');

    // Otro workspace: no existe.
    await expect(linesReactions(systemViewer(other.id), chat.id, [m.id])).rejects.toMatchObject({ code: 'not_found' });

    // El número reacciona una sola vez: la del teléfono pisa a la de la app, y sacarla deja solo la de Ana.
    await ingestEvents(row, [{ type: 'reaction', chatId: '120363000000000902@g.us', targetProviderMessageId: 'rx-target', emoji: '😂', senderPhone: '', senderName: '', fromMe: true }]);
    list = await linesReactions(viewer, chat.id, [m.id]);
    expect(list.filter((r) => r.me).map((r) => r.emoji)).toEqual(['😂']);
    await reactToMessage(user.id, user.id, m.id, '');
    list = await linesReactions(viewer, chat.id, [m.id]);
    expect(list.map((r) => r.emoji)).toEqual(['👍']);
  });
});
