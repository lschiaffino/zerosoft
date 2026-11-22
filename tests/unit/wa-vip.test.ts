/**
 * División VIP (el split de Superhuman) en Lines y en Inbox: VIP es la persona,
 * no el chat. En Lines, su teléfono en todo el workspace (sus chats 1:1 de
 * cualquier línea, la pestaña y el filtro vip); en Inbox, su teléfono o su
 * correo (la vista vip, en cualquier cuenta). Los grupos no se marcan.
 * Números, nombres y correos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getChat, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { activeTabs, applyTab } from '@/lib/groups-filters';
import { setChatVip } from '@/lib/groups-vip';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import type { InboundEvent } from '@/lib/groups-provider';
import { addMessage, applyThreadAction, getAccountById, getThread, listThreads, upsertThread, type AccountRow } from '@/lib/inbox/core';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

const ANA = '5491177750011';
const BETO = '5491177750012';
const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);
const msg = (chatId: string, isGroup: boolean, sender: string): InboundEvent =>
  ({
    type: 'message',
    chatId,
    isGroup,
    ...(isGroup ? { chatName: 'Club de prueba' } : {}),
    fromMe: false,
    senderPhone: sender,
    senderName: 'Prueba',
    providerMessageId: `vip-${Math.random().toString(36).slice(2)}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
  }) as InboundEvent;

async function line(ws: string) {
  const n = await createNumber(ws, ws, { provider: 'fake' });
  await connectNumber(ws, n.id);
  const s = fakeState(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return (await getNumberRowById(n.id))!;
}

describe('Lines: VIP', () => {
  it('la pestaña VIP es el filtro vip', () => {
    expect(applyTab({ favorite: 'yes' }, 'vip')).toEqual({ vip: 'yes' });
    expect(activeTabs({ vip: 'yes' })).toEqual(['vip']);
  });

  it('marcar a una persona trae sus chats 1:1 de todas las líneas; un grupo no se marca', async () => {
    const u = await makeUser('lines-vip');
    const one = await line(u.id);
    const two = await line(u.id);
    await ingestEvents(one, [msg(`${ANA}@s.whatsapp.net`, false, ANA), msg(`${BETO}@s.whatsapp.net`, false, BETO), msg('120363000000000971@g.us', true, ANA)]);
    await ingestEvents(two, [msg(`${ANA}@s.whatsapp.net`, false, ANA)]);
    const rows = (await listChats(u.id, u.id)).rows;
    const anaOne = rows.find((c) => c.kind === 'dm' && c.phone === ANA && c.numberId === one.id) ?? rows.find((c) => c.kind === 'dm' && c.phone === ANA)!;
    const group = rows.find((c) => c.kind === 'group')!;

    await setChatVip(u.id, u.id, anaOne.id, true);
    expect((await getChat(u.id, anaOne.id))?.vip).toBe(true);
    const vip = (await listChats(u.id, u.id, { filters: { vip: 'yes' } })).rows;
    expect(vip.length).toBeGreaterThanOrEqual(1);
    expect(vip.every((c) => c.kind === 'dm' && c.phone === ANA && c.vip === true)).toBe(true);
    // El mismo teléfono en la otra línea también es VIP.
    const anaChats = (await getDb().prepare("SELECT id FROM groups_chats WHERE user_id = ? AND phone = ? AND kind = 'dm'").all(u.id, ANA)) as Array<{ id: string }>;
    expect(anaChats).toHaveLength(2);
    for (const c of anaChats) expect((await getChat(u.id, c.id))?.vip).toBe(true);
    expect((await listChats(u.id, u.id, { filters: { vip: 'no' } })).rows.some((c) => c.phone === ANA && c.kind === 'dm')).toBe(false);

    await expect(setChatVip(u.id, u.id, group.id, true)).rejects.toMatchObject({ code: 'unsupported' });
    const other = await makeUser('lines-vip-other');
    await expect(setChatVip(other.id, other.id, anaOne.id, false)).rejects.toMatchObject({ code: 'not_found' });

    await setChatVip(u.id, u.id, anaOne.id, false);
    expect((await listChats(u.id, u.id, { filters: { vip: 'yes' } })).rows).toEqual([]);
  });
});

async function inboxAccount(label: string): Promise<{ owner: string; account: AccountRow }> {
  const u = await makeUser(label);
  const { account: a } = await connectWhatsapp(u.id);
  const s = fakeState(`inbox-${a.id}`);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
  return { owner: u.id, account: (await getAccountById(a.id))! };
}

describe('Inbox: VIP', () => {
  it('marcar a una persona la trae a la vista VIP con sus correos; un grupo no se marca', async () => {
    const { owner, account } = await inboxAccount('ib-vip');
    const wa = await upsertThread(account, { externalId: `${ANA}@s.whatsapp.net`, kind: 'dm', title: 'Ana Prueba', handle: ANA });
    const group = await upsertThread(account, { externalId: '120363000000000981@g.us', kind: 'group', title: 'Club de prueba' });
    const beto = await upsertThread(account, { externalId: `${BETO}@s.whatsapp.net`, kind: 'dm', title: 'Beto Prueba', handle: BETO });
    // Un correo de la misma persona: VIP por dirección, sin importar mayúsculas.
    const mailAccountId = `ibacc-mail-${Math.random().toString(36).slice(2, 8)}`;
    await getDb()
      .prepare("INSERT INTO inbox_accounts (id, owner_id, kind, label, address, status, created_at, updated_at) VALUES (?, ?, 'gmail', 'Correo', 'yo@example.com', 'connected', ?, ?)")
      .run(mailAccountId, owner, new Date().toISOString(), new Date().toISOString());
    const mailAccount = (await getAccountById(mailAccountId))!;
    const mail1 = await upsertThread(mailAccount, { externalId: 'thread-1', kind: 'email', title: 'Ana', handle: 'Ana@Example.com' });
    const mail2 = await upsertThread(mailAccount, { externalId: 'thread-2', kind: 'email', title: 'Ana', handle: 'ana@example.com' });
    for (const t of [wa, group, beto, mail1, mail2]) await addMessage(t, { externalId: `m-${t.id}`, fromMe: false, body: 'hola', senderName: 'Ana', sentAt: new Date(Date.now() - 60_000).toISOString() });

    expect(await listThreads(owner, { view: 'vip' })).toEqual([]);
    expect(await applyThreadAction(owner, [wa.id, mail1.id, group.id], { action: 'vip' })).toEqual(expect.arrayContaining([wa.id, mail1.id]));
    const vip = (await listThreads(owner, { view: 'vip' })).map((t) => t.id).sort();
    expect(vip).toEqual([wa.id, mail1.id, mail2.id].sort());
    expect((await getThread(owner, mail2.id)).vip).toBe(true);
    expect((await getThread(owner, group.id)).vip).toBeUndefined();
    expect((await getThread(owner, beto.id)).vip).toBeUndefined();

    // Otra persona no marca chats ajenos.
    const other = await makeUser('ib-vip-other');
    expect(await applyThreadAction(other.id, [beto.id], { action: 'vip' })).toEqual([]);

    await applyThreadAction(owner, [mail2.id], { action: 'unvip' });
    expect((await listThreads(owner, { view: 'vip' })).map((t) => t.id)).toEqual([wa.id]);
  });
});
