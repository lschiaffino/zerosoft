/**
 * Favoritos, como la lista de WhatsApp, en Lines y en Inbox: sumar y sacar un
 * chat (1:1 o grupo), la pestaña Favoritos (Lines: filtro favorite; Inbox: la
 * vista favorites) y que otra persona no toque los chats ajenos. Números y
 * nombres inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getChat, getNumberRowById, ingestEvents, listChats, updateChat } from '@/lib/groups';
import { activeTabs, applyTab, linesFiltersSql, parseLinesFilters } from '@/lib/groups-filters';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import type { InboundEvent } from '@/lib/groups-provider';
import { addMessage, applyThreadAction, getAccountById, listThreads, upsertThread } from '@/lib/inbox/core';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);
const msg = (chatId: string, isGroup: boolean, body: string): InboundEvent =>
  ({
    type: 'message',
    chatId,
    isGroup,
    ...(isGroup ? { chatName: 'Club de prueba' } : {}),
    fromMe: false,
    senderPhone: '5491177740011',
    senderName: 'Ana Prueba',
    providerMessageId: `fv-${Math.random().toString(36).slice(2)}`,
    body,
    timestamp: new Date().toISOString(),
  }) as InboundEvent;

describe('Lines: Favoritos', () => {
  it('la pestaña Favoritos es el filtro favorite, como las demás', () => {
    expect(applyTab({ unread: 'yes' }, 'favorites')).toEqual({ favorite: 'yes' });
    expect(activeTabs({ favorite: 'yes' })).toEqual(['favorites']);
    expect(parseLinesFilters({ favorite: 'no' })).toEqual({ favorite: 'no' });
    expect(linesFiltersSql({ favorite: 'yes' }, { me: 'u' }).where).toContain('c.favorite_at IS NOT NULL');
  });

  it('suma y saca un chat y un grupo; la lista con el filtro trae solo los favoritos', async () => {
    const u = await makeUser('lines-fav');
    const n = await createNumber(u.id, u.id, { provider: 'fake' });
    await connectNumber(u.id, n.id);
    const s = fakeState(n.id);
    if (s) s.connectedAt = Date.now() - 5000;
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
    const number = (await getNumberRowById(n.id))!;
    await ingestEvents(number, [msg('5491177740011@s.whatsapp.net', false, 'hola'), msg('120363000000000951@g.us', true, 'hola grupo'), msg('5491177740012@s.whatsapp.net', false, 'otro')]);
    const rows = (await listChats(u.id, u.id)).rows;
    expect(rows).toHaveLength(3);
    const dm = rows.find((c) => c.kind === 'dm' && c.phone.endsWith('0011'))!;
    const group = rows.find((c) => c.kind === 'group')!;
    expect(dm.favorite).toBeUndefined();

    expect((await updateChat(u.id, dm.id, { favorite: true })).favorite).toBe(true);
    await updateChat(u.id, group.id, { favorite: true });
    const favs = (await listChats(u.id, u.id, { filters: { favorite: 'yes' } })).rows.map((c) => c.id).sort();
    expect(favs).toEqual([dm.id, group.id].sort());

    await updateChat(u.id, dm.id, { favorite: false });
    expect((await getChat(u.id, dm.id))?.favorite).toBeUndefined();
    expect((await listChats(u.id, u.id, { filters: { favorite: 'yes' } })).rows.map((c) => c.id)).toEqual([group.id]);
    expect((await listChats(u.id, u.id, { filters: { favorite: 'no' } })).rows.map((c) => c.id)).not.toContain(group.id);

    // Otro workspace no lo encuentra.
    const other = await makeUser('lines-fav-other');
    await expect(updateChat(other.id, group.id, { favorite: false })).rejects.toMatchObject({ code: 'not_found' });
    expect((await getChat(u.id, group.id))?.favorite).toBe(true);
  });
});

describe('Inbox: Favoritos', () => {
  it('sumar y sacar; la vista Favoritos lista solo los de la bandeja', async () => {
    const u = await makeUser('ib-fav');
    const { account: a } = await connectWhatsapp(u.id);
    const s = fakeState(`inbox-${a.id}`);
    if (s) s.connectedAt = Date.now() - 5000;
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
    const account = (await getAccountById(a.id))!;
    const one = await upsertThread(account, { externalId: '5491177740021@s.whatsapp.net', kind: 'dm', title: 'Ana Prueba', handle: '5491177740021' });
    const two = await upsertThread(account, { externalId: '120363000000000961@g.us', kind: 'group', title: 'Club de prueba' });
    const three = await upsertThread(account, { externalId: '5491177740022@s.whatsapp.net', kind: 'dm', title: 'Beto Prueba', handle: '5491177740022' });
    for (const t of [one, two, three]) await addMessage(t, { externalId: `m-${t.id}`, fromMe: false, body: 'hola', senderName: 'Ana', sentAt: new Date(Date.now() - 60_000).toISOString() });

    expect(await listThreads(u.id, { view: 'favorites' })).toEqual([]);
    await applyThreadAction(u.id, [one.id, two.id], { action: 'favorite' });
    const favs = await listThreads(u.id, { view: 'favorites' });
    expect(favs.map((t) => t.id).sort()).toEqual([one.id, two.id].sort());
    expect(favs.every((t) => t.favorite === true)).toBe(true);
    expect((await listThreads(u.id, { view: 'inbox' })).find((t) => t.id === three.id)?.favorite).toBeUndefined();

    // Archivado sale de la vista (como la bandeja); desarchivado vuelve con su favorito.
    await applyThreadAction(u.id, [two.id], { action: 'archive' });
    expect((await listThreads(u.id, { view: 'favorites' })).map((t) => t.id)).toEqual([one.id]);
    await applyThreadAction(u.id, [two.id], { action: 'unarchive' });
    await applyThreadAction(u.id, [one.id], { action: 'unfavorite' });
    expect((await listThreads(u.id, { view: 'favorites' })).map((t) => t.id)).toEqual([two.id]);

    // Los chats de otra persona se ignoran.
    const other = await makeUser('ib-fav-other');
    expect(await applyThreadAction(other.id, [three.id], { action: 'favorite' })).toEqual([]);
    expect((await listThreads(u.id, { view: 'favorites' })).map((t) => t.id)).toEqual([two.id]);
  });
});
