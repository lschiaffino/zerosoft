/**
 * Inbox y Lines: desvincular y volver a vincular el mismo número no duplica
 * chats, contactos ni mensajes. La misma persona puede llegar por su lid
 * ("<lid>@lid") y por su teléfono: los dos chats se juntan en el del teléfono
 * cuando se sabe que son la misma persona (la libreta o un mensaje recibido
 * repetido), y un mensaje repetido se borra una sola vez (nunca uno sin
 * repetido). Números, lids y nombres inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient, getDb } from '@/lib/db';
import { twinPairs, uniqueLidPhones, type MessageSighting } from '@/lib/wa-dedupe';
import { contactsFromMessage, phoneForLid, rememberContacts, resolveLidChats } from '@/lib/wa-contacts';
import { createAccount, createFolder, findThread, getAccountById, saveNotes } from '@/lib/inbox/core';
import { connectWhatsapp, disconnectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { connectNumber, createLabel, createNumber, disconnectNumber, getNumberRowById, ingestEvents, setChatLabels } from '@/lib/groups';
import { evolutionMessageEvents, parseEvolutionWebhook } from '@/lib/groups-provider-bridge';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import type { InboundEvent } from '@/lib/groups-provider';
import migration from '@/lib/schema/migration-files/20261114_1943_wa_relink_dedupe';
import check from '@/lib/schema/migration-files/20261114_2116_wa_relink_dedupe_check';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
/** Teléfono y lid nuevos por prueba (la base se comparte entre pruebas). */
function person() {
  const n = Math.floor(10_000_000 + Math.random() * 89_999_999);
  return { phone: `54911${n}`, lid: `7${n}${Math.floor(100_000 + Math.random() * 899_999)}` };
}

function msg(chatId: string, over: Partial<Extract<InboundEvent, { type: 'message' }>> = {}): InboundEvent {
  return {
    type: 'message',
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: chatId.endsWith('@s.whatsapp.net') ? chatId.replace(/@.*/, '') : '',
    senderName: 'Ana Ejemplo',
    providerMessageId: `m-${uniq()}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  } as InboundEvent;
}

describe('pares lid ↔ teléfono (puro)', () => {
  const s = (key: string, chatId: string, jid: string, over: Partial<MessageSighting> = {}): MessageSighting => ({ key, chatId, jid, dm: true, inbound: true, ...over });

  it('un mensaje recibido en el chat del lid y en el del teléfono: el del lid pasa al del teléfono', () => {
    expect(twinPairs([s('A', 'c-lid', '700000000000123@lid'), s('A', 'c-pn', '5491100000001@s.whatsapp.net')])).toEqual([
      { loser: 'c-lid', survivor: 'c-pn', lid: '700000000000123', phone: '5491100000001' },
    ]);
  });

  it('los propios, los de grupo y los que están en un solo chat no cuentan', () => {
    expect(twinPairs([s('A', 'c-lid', '700000000000123@lid', { inbound: false }), s('A', 'c-pn', '5491100000001@s.whatsapp.net', { inbound: false })])).toEqual([]);
    expect(twinPairs([s('A', 'g1', '120363@g.us', { dm: false }), s('A', 'c-pn', '5491100000001@s.whatsapp.net')])).toEqual([]);
    expect(twinPairs([s('A', 'c-lid', '700000000000123@lid')])).toEqual([]);
    // Dos chats por teléfono (no hay lid): no son gemelos.
    expect(twinPairs([s('A', 'c1', '5491100000001@s.whatsapp.net'), s('A', 'c2', '5491100000002@s.whatsapp.net')])).toEqual([]);
  });

  it('un chat del lid que aparece con dos teléfonos distintos no se toca', () => {
    expect(
      twinPairs([
        s('A', 'c-lid', '700000000000123@lid'),
        s('A', 'c-1', '5491100000001@s.whatsapp.net'),
        s('B', 'c-lid', '700000000000123@lid'),
        s('B', 'c-2', '5491100000002@s.whatsapp.net'),
      ]),
    ).toEqual([]);
  });

  it('pares únicos de la libreta', () => {
    expect(uniqueLidPhones([{ lid: '700', phone: '5491100000001' }, { lid: '700', phone: '5491100000001' }, { lid: '800', phone: '' }])).toEqual([{ lid: '700', phone: '5491100000001' }]);
    expect(uniqueLidPhones([{ lid: '700', phone: '5491100000001' }, { lid: '700', phone: '5491100000002' }])).toEqual([]);
  });

  it('lo que mando yo en un chat por lid con el teléfono al lado también enseña el par', () => {
    const [e] = evolutionMessageEvents({
      key: { remoteJid: '5491100000009@s.whatsapp.net', remoteJidAlt: '700000000000123@lid', fromMe: true, id: 'X1' },
      message: { conversation: 'hola' },
      messageTimestamp: 1_731_600_000,
    }) as Array<Extract<InboundEvent, { type: 'message' }>>;
    expect(e.chatId).toBe('5491100000009@s.whatsapp.net');
    expect(contactsFromMessage(e)).toEqual([{ phone: '5491100000009', lid: '700000000000123' }]);
  });

  it('borrar para todos en un chat por lid: el teléfono sale de senderPn', () => {
    expect(parseEvolutionWebhook({ event: 'messages.delete', data: { key: { id: 'X2', remoteJid: '700000000000123@lid', senderPn: '5491100000009@s.whatsapp.net' } } })).toEqual([
      { type: 'revoke', chatId: '5491100000009@s.whatsapp.net', providerMessageId: 'X2' },
    ]);
  });
});

describe('Inbox: re-vincular no duplica', () => {
  async function account(label: string) {
    const u = await makeUser(label);
    const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
    return { u, acc: (await getAccountById(a.id))! };
  }
  const threads = async (accId: string) =>
    (await getDb().prepare("SELECT id, external_id, title, handle, notes FROM inbox_threads WHERE account_id = ? AND kind = 'dm' ORDER BY external_id").all(accId)) as Array<{
      id: string;
      external_id: string;
      title: string;
      handle: string;
      notes: string;
    }>;
  const messages = async (threadId: string) =>
    ((await getDb().prepare('SELECT external_id FROM inbox_messages WHERE thread_id = ? ORDER BY external_id').all(threadId)) as Array<{ external_id: string }>).map((r) => r.external_id);

  it('webhook por lid, historial por teléfono: un solo chat, sin mensajes repetidos, y la libreta aprende el par', async () => {
    const { u, acc } = await account('wdi1');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    const a = msg(`${p.lid}@lid`, { senderLid: p.lid, chatLid: p.lid, providerMessageId: `A-${uniq()}`, body: 'uno' });
    const b = msg(`${p.lid}@lid`, { senderLid: p.lid, chatLid: p.lid, providerMessageId: `B-${uniq()}`, body: 'solo por lid' });
    await ingestWhatsappEvents(acc, [a, b]);
    const lidThread = (await findThread(acc.id, `${p.lid}@lid`))!;
    await saveNotes(u.id, lidThread.id, 'nota del lid');
    const folder = await createFolder(u.id, { name: `Clientes ${uniq()}` });
    await getDb().prepare('INSERT INTO inbox_thread_folders (thread_id, folder_id) VALUES (?, ?)').run(lidThread.id, folder.id);
    // Historial con el teléfono: el mismo "uno" (mismo id) y uno nuevo.
    const a2 = { ...(a as object), chatId: pn, senderPhone: p.phone, senderLid: undefined, chatLid: undefined, history: true } as InboundEvent;
    const c = msg(pn, { providerMessageId: `C-${uniq()}`, body: 'dos', history: true });
    await ingestWhatsappEvents(acc, [a2, c], { history: true });
    const list = await threads(acc.id);
    expect(list.map((t) => t.external_id)).toEqual([pn]);
    const ids = await messages(list[0].id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    // Lo del chat del lid pasó al del teléfono.
    expect(list[0].notes).toBe('nota del lid');
    const inFolder = await getDb().prepare('SELECT 1 FROM inbox_thread_folders WHERE thread_id = ? AND folder_id = ?').get(list[0].id, folder.id);
    expect(inFolder).toBeTruthy();
    expect(await phoneForLid({ app: 'inbox', accountId: acc.id }, p.lid)).toBe(p.phone);
    // Después: lo que llega por lid va directo al chat del teléfono.
    await ingestWhatsappEvents(acc, [msg(`${p.lid}@lid`, { senderLid: p.lid, providerMessageId: `D-${uniq()}`, body: 'tres' })]);
    expect((await threads(acc.id)).map((t) => t.external_id)).toEqual([pn]);
    expect(await messages(list[0].id)).toHaveLength(4);
  });

  it('la libreta sabe el par: el chat del lid se junta con el del teléfono (o pasa a tenerlo como id)', async () => {
    const { acc } = await account('wdi2');
    const p = person();
    const q = person();
    await ingestWhatsappEvents(acc, [
      msg(`${p.lid}@lid`, { senderLid: p.lid, providerMessageId: `E-${uniq()}`, fromMe: true, senderPhone: '', senderName: '' }),
      msg(`${p.phone}@s.whatsapp.net`, { providerMessageId: `F-${uniq()}` }),
      msg(`${q.lid}@lid`, { senderLid: q.lid, providerMessageId: `G-${uniq()}`, senderName: 'Beto Ejemplo' }),
    ]);
    expect(await threads(acc.id)).toHaveLength(3);
    // Llegan los contactos del servidor con los dos pares.
    await ingestWhatsappEvents(acc, [
      { type: 'contact', chatId: `${p.lid}@lid`, lid: p.lid, phone: p.phone },
      { type: 'contact', chatId: `${q.lid}@lid`, lid: q.lid, phone: q.phone, name: 'Beto Ejemplo' },
    ]);
    const list = await threads(acc.id);
    expect(list.map((t) => t.external_id).sort()).toEqual([`${p.phone}@s.whatsapp.net`, `${q.phone}@s.whatsapp.net`].sort());
    const pt = list.find((t) => t.external_id.startsWith(p.phone))!;
    expect(await messages(pt.id)).toHaveLength(2);
    const qt = list.find((t) => t.external_id.startsWith(q.phone))!;
    expect(qt.handle).toBe(q.phone);
    expect(await messages(qt.id)).toHaveLength(1);
  });

  it('desvincular y volver a vincular: la misma cuenta, y el historial que vuelve a llegar no duplica', async () => {
    const { u, acc } = await account('wdi3');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    const old = [msg(pn, { providerMessageId: `H-${uniq()}`, history: true }), msg(pn, { providerMessageId: `I-${uniq()}`, fromMe: true, senderPhone: '', history: true })];
    await ingestWhatsappEvents(acc, old, { history: true });
    await disconnectWhatsapp(acc);
    const { account: again } = await connectWhatsapp(u.id);
    expect(again.id).toBe(acc.id);
    // Vuelve el historial: el recibido llega por lid (con el teléfono al lado), el propio igual que antes.
    const back = [
      { ...(old[0] as object), chatId: `${p.lid}@lid`, senderPhone: '', senderLid: p.lid } as InboundEvent,
      old[1],
      msg(pn, { providerMessageId: `J-${uniq()}`, history: true }),
    ];
    await ingestWhatsappEvents(again, back, { history: true });
    await ingestWhatsappEvents(again, back, { history: true });
    const list = await threads(acc.id);
    expect(list.map((t) => t.external_id)).toEqual([pn]);
    expect(await messages(list[0].id)).toHaveLength(3);
    const contacts = (await getDb().prepare("SELECT COUNT(*) AS n FROM wa_contacts WHERE app = 'inbox' AND account_id = ? AND (phone = ? OR lid = ?)").get(acc.id, p.phone, p.lid)) as { n: number };
    expect(Number(contacts.n)).toBe(1);
  });
});

describe('Lines: re-vincular no duplica', () => {
  async function line(label: string) {
    const user = await makeUser(label);
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
    return { user, row: (await getNumberRowById(n.id))! };
  }
  const chats = async (numberId: string) =>
    (await getDb().prepare("SELECT id, provider_chat_id, phone, name FROM groups_chats WHERE number_id = ? AND kind = 'dm' ORDER BY provider_chat_id").all(numberId)) as Array<{
      id: string;
      provider_chat_id: string;
      phone: string;
      name: string;
    }>;
  const count = async (chatId: string) => Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM groups_messages WHERE chat_id = ?').get(chatId)) as { n: number }).n);

  it('webhook por lid, historial por teléfono: un solo chat con sus etiquetas, y lo que sigue llega al mismo', async () => {
    const { user, row } = await line('wdl1');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    const a = msg(`${p.lid}@lid`, { senderLid: p.lid, chatLid: p.lid, providerMessageId: `A-${uniq()}` });
    await ingestEvents(row, [a, msg(`${p.lid}@lid`, { senderLid: p.lid, providerMessageId: `B-${uniq()}` })]);
    const lidChat = (await chats(row.id)).find((c) => c.provider_chat_id.endsWith('@lid'))!;
    const label = await createLabel(user.id, { name: `VIP ${uniq()}` });
    await setChatLabels(user.id, lidChat.id, [label.id]);
    await ingestEvents(row, [{ ...(a as object), chatId: pn, senderPhone: p.phone, senderLid: undefined, chatLid: undefined, history: true } as InboundEvent, msg(pn, { providerMessageId: `C-${uniq()}`, history: true })], {
      history: true,
    });
    const list = await chats(row.id);
    expect(list.map((c) => c.provider_chat_id)).toEqual([pn]);
    expect(await count(list[0].id)).toBe(3);
    const labelled = await getDb().prepare('SELECT 1 FROM groups_chat_labels WHERE chat_id = ? AND label_id = ?').get(list[0].id, label.id);
    expect(labelled).toBeTruthy();
    await ingestEvents(row, [msg(`${p.lid}@lid`, { senderLid: p.lid, providerMessageId: `D-${uniq()}` })]);
    expect((await chats(row.id)).map((c) => c.provider_chat_id)).toEqual([pn]);
    expect(await count(list[0].id)).toBe(4);
  });

  it('desconectar y volver a conectar la misma línea: el mismo número y sin repetidos', async () => {
    const { user, row } = await line('wdl2');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    const first = [msg(pn, { providerMessageId: `H-${uniq()}`, history: true }), msg(pn, { providerMessageId: `I-${uniq()}`, fromMe: true, senderPhone: '', history: true })];
    await ingestEvents(row, first, { history: true });
    await disconnectNumber(user.id, row.id);
    await connectNumber(user.id, row.id);
    const again = (await getNumberRowById(row.id))!;
    await ingestEvents(again, [...first, msg(pn, { providerMessageId: `J-${uniq()}`, history: true })], { history: true });
    const list = await chats(row.id);
    expect(list).toHaveLength(1);
    expect(await count(list[0].id)).toBe(3);
  });

  it('la libreta sabe el par: el chat del lid pasa a tener el teléfono como id', async () => {
    const { row } = await line('wdl3');
    const p = person();
    await ingestEvents(row, [msg(`${p.lid}@lid`, { senderLid: p.lid, providerMessageId: `K-${uniq()}`, senderName: '' })]);
    await ingestEvents(row, [{ type: 'contact', chatId: `${p.lid}@lid`, lid: p.lid, phone: p.phone, name: 'Carla Ejemplo' }]);
    const list = await chats(row.id);
    expect(list.map((c) => c.provider_chat_id)).toEqual([`${p.phone}@s.whatsapp.net`]);
    expect(list[0].phone).toBe(p.phone);
    expect(list[0].name).toBe('Carla Ejemplo');
  });
});

describe('migración: junta los duplicados que ya quedaron', () => {
  it('chats por lid con teléfono conocido o mensajes repetidos; segura de correr dos veces', async () => {
    const u = await makeUser('wdm');
    const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    const p = person();
    const q = person();
    const now = new Date().toISOString();
    const db = getDb();
    const thread = async (ext: string) => {
      const id = `ibt_${uniq()}`;
      await db
        .prepare("INSERT INTO inbox_threads (id, owner_id, account_id, channel, kind, external_id, title, handle, created_at, updated_at) VALUES (?, ?, ?, 'whatsapp', 'dm', ?, '', ?, ?, ?)")
        .run(id, u.id, a.id, ext, ext.endsWith('@lid') ? '' : ext.replace(/@.*/, ''), now, now);
      return id;
    };
    const message = async (threadId: string, ext: string, fromMe = 0) =>
      db
        .prepare('INSERT INTO inbox_messages (id, owner_id, thread_id, external_id, from_me, body, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(`ibm_${uniq()}`, u.id, threadId, ext, fromMe, 'x', now, now);
    // p: duplicado por un mensaje recibido repetido (sin libreta). q: por la libreta.
    const pLid = await thread(`${p.lid}@lid`);
    const pPn = await thread(`${p.phone}@s.whatsapp.net`);
    await message(pLid, 'P1');
    await message(pPn, 'P1');
    await message(pLid, 'P2');
    await message(pPn, 'P3', 1);
    const qLid = await thread(`${q.lid}@lid`);
    const qPn = await thread(`${q.phone}@s.whatsapp.net`);
    await message(qLid, 'Q1', 1);
    await message(qPn, 'Q1', 1);
    await message(qLid, 'Q2');
    await rememberContacts({ app: 'inbox', accountId: a.id, userId: u.id }, [{ lid: q.lid, phone: q.phone }]);
    await migration.up(getClient());
    const left = (await db.prepare('SELECT id FROM inbox_threads WHERE account_id = ? ORDER BY external_id').all(a.id)) as Array<{ id: string }>;
    expect(left.map((t) => t.id).sort()).toEqual([pPn, qPn].sort());
    const ids = async (t: string) => ((await db.prepare('SELECT external_id FROM inbox_messages WHERE thread_id = ? ORDER BY external_id').all(t)) as Array<{ external_id: string }>).map((r) => r.external_id);
    expect(await ids(pPn)).toEqual(['P1', 'P2', 'P3']);
    expect(await ids(qPn)).toEqual(['Q1', 'Q2']);
    // Otra vez (y la segunda pasada): nada cambia.
    await migration.up(getClient());
    await check.up(getClient());
    expect(await ids(pPn)).toEqual(['P1', 'P2', 'P3']);
    expect(await ids(qPn)).toEqual(['Q1', 'Q2']);
  });
});

describe('resolveLidChats', () => {
  it('un evento de un chat por lid conocido pasa al chat del teléfono; uno desconocido queda', async () => {
    const u = await makeUser('wdr');
    const scope = { app: 'lines' as const, accountId: `n-${uniq()}`, userId: u.id };
    const p = person();
    await rememberContacts(scope, [{ lid: p.lid, phone: p.phone }]);
    const out = await resolveLidChats(scope, [
      msg(`${p.lid}@lid`, { senderLid: p.lid }),
      msg('700000000000999@lid', { senderLid: '700000000000999' }),
      { type: 'presence', chatId: `${p.lid}@lid`, who: '', state: 'composing' } as InboundEvent,
    ]);
    expect(out[0]).toMatchObject({ chatId: `${p.phone}@s.whatsapp.net`, senderPhone: p.phone, chatLid: p.lid });
    expect(out[1]).toMatchObject({ chatId: '700000000000999@lid' });
    expect(out[2]).toMatchObject({ chatId: `${p.phone}@s.whatsapp.net` });
  });
});
