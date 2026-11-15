/**
 * Inbox y Lines: el eco de lo que mando llega muchas veces solo con el lid
 * ("<lid>@lid"), sin el teléfono al lado, mientras el mensaje ya está en el
 * chat del teléfono. Antes abría un segundo chat de la misma persona (y en
 * Inbox se veía con el lid formateado como un teléfono). Ahora va al chat del
 * teléfono, o los dos se juntan, una sola vez aunque dos webhooks corran a la
 * vez. Números, lids y nombres inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient, getDb } from '@/lib/db';
import { addMessage, createAccount, createFolder, createScheduled, findThread, getAccountById, listThreads, saveNotes } from '@/lib/inbox/core';
import { ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { createNumber, connectNumber, getNumberRowById, ingestEvents } from '@/lib/groups';
import { phoneForLid, rememberContacts } from '@/lib/wa-contacts';
import { mergeLidChats } from '@/lib/wa-dedupe-run';
import { repairLidDuplicates } from '@/lib/wa-dedupe-repair';
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

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
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
const own = (chatId: string, id: string, over: Partial<Extract<InboundEvent, { type: 'message' }>> = {}) =>
  msg(chatId, { fromMe: true, senderPhone: '', senderName: '', providerMessageId: id, body: 'una primera duda', ...over });

async function inboxAccount(label: string) {
  const u = await makeUser(label);
  const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
  return { u, acc: (await getAccountById(a.id))! };
}
const threads = async (accId: string) =>
  (await getDb().prepare("SELECT * FROM inbox_threads WHERE account_id = ? AND kind = 'dm' ORDER BY external_id").all(accId)) as Array<{
    id: string;
    external_id: string;
    unread: number;
    notes: string;
    pinned_at: string | null;
  }>;
const messageIds = async (threadId: string) =>
  ((await getDb().prepare('SELECT external_id FROM inbox_messages WHERE thread_id = ? ORDER BY external_id').all(threadId)) as Array<{ external_id: string }>).map((r) => r.external_id);

describe('Inbox: el eco propio por lid no abre otro chat', () => {
  it('importado por teléfono y después el eco en vivo por lid: un solo chat y la libreta aprende el par', async () => {
    const { acc } = await inboxAccount('echo1');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    const id = `E-${uniq()}`;
    await ingestWhatsappEvents(acc, [own(pn, id, { history: true }), msg(pn, { providerMessageId: `R-${uniq()}`, history: true })], { history: true });
    await ingestWhatsappEvents(acc, [own(`${p.lid}@lid`, id)]);
    const list = await threads(acc.id);
    expect(list.map((t) => t.external_id)).toEqual([pn]);
    expect(await messageIds(list[0].id)).toHaveLength(2);
    expect(await phoneForLid({ app: 'inbox', accountId: acc.id }, p.lid)).toBe(p.phone);
    // Lo que la persona manda después solo con el lid va al mismo chat.
    await ingestWhatsappEvents(acc, [msg(`${p.lid}@lid`, { senderLid: p.lid, providerMessageId: `S-${uniq()}` })]);
    expect((await threads(acc.id)).map((t) => t.external_id)).toEqual([pn]);
  });

  it('el eco llega antes que la respuesta del envío: al guardar lo mandado, los dos chats se juntan con todo lo del chat', async () => {
    const { u, acc } = await inboxAccount('echo2');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    const phoneThread = (await ingestWhatsappEvents(acc, [msg(pn, { providerMessageId: `R-${uniq()}` })]), (await findThread(acc.id, pn))!);
    const id = `E-${uniq()}`;
    // El eco por lid entra primero (abre un chat por lid) y la persona responde por lid.
    await ingestWhatsappEvents(acc, [own(`${p.lid}@lid`, id), msg(`${p.lid}@lid`, { senderLid: p.lid, providerMessageId: `L-${uniq()}`, senderName: '' })]);
    const lidThread = (await findThread(acc.id, `${p.lid}@lid`))!;
    expect(lidThread).toBeTruthy();
    await saveNotes(u.id, lidThread.id, 'nota del chat por lid');
    const folder = await createFolder(u.id, { name: `Clientes ${uniq()}` });
    await getDb().prepare('INSERT INTO inbox_thread_folders (thread_id, folder_id) VALUES (?, ?)').run(lidThread.id, folder.id);
    await getDb().prepare('UPDATE inbox_threads SET pinned_at = ? WHERE id = ?').run(new Date().toISOString(), lidThread.id);
    await createScheduled(u.id, lidThread.id, 'más tarde', new Date(Date.now() + 3_600_000).toISOString());
    // Ahora la app guarda lo que mandó (mismo id) en el chat del teléfono.
    await addMessage(phoneThread, { externalId: id, fromMe: true, body: 'una primera duda', status: 'sent' });
    const list = await threads(acc.id);
    expect(list.map((t) => t.external_id)).toEqual([pn]);
    const ids = await messageIds(list[0].id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(list[0].notes).toBe('nota del chat por lid');
    expect(list[0].pinned_at).toBeTruthy();
    // Mandar deja en cero los no leídos del chat del teléfono; queda el que entró por lid.
    expect(Number(list[0].unread)).toBe(1);
    expect(await getDb().prepare('SELECT 1 FROM inbox_thread_folders WHERE thread_id = ? AND folder_id = ?').get(list[0].id, folder.id)).toBeTruthy();
    expect(Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM inbox_scheduled WHERE thread_id = ?').get(list[0].id)) as { n: number }).n)).toBe(1);
    expect(await findThread(acc.id, `${p.lid}@lid`)).toBeNull();
  });

  it('dos webhooks a la vez (el eco por lid y el historial por teléfono): un solo chat, sin repetidos', async () => {
    const { acc } = await inboxAccount('echo3');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    const id = `E-${uniq()}`;
    const other = `R-${uniq()}`;
    await Promise.all([
      ingestWhatsappEvents(acc, [own(`${p.lid}@lid`, id)]),
      ingestWhatsappEvents(acc, [own(pn, id, { history: true }), msg(pn, { providerMessageId: other, history: true })], { history: true }),
    ]);
    // Si el eco ganó la carrera, el chat por lid quedó: la próxima tanda que vea el par lo junta.
    const left = await threads(acc.id);
    if (left.length > 1) await mergeLidChats('inbox', acc.id, { all: true });
    const list = await threads(acc.id);
    expect(list.map((t) => t.external_id)).toEqual([pn]);
    expect(await messageIds(list[0].id)).toEqual([id, other].sort());
  });

  it('mando yo por el teléfono; la tilde y la respuesta vuelven por lid (los dos con nombre): un solo chat', async () => {
    const { acc } = await inboxAccount('echo6');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    await ingestWhatsappEvents(acc, [msg(pn, { providerMessageId: `R-${uniq()}` })]);
    const phoneThread = (await findThread(acc.id, pn))!;
    const sent = `E-${uniq()}`;
    await addMessage(phoneThread, { externalId: sent, fromMe: true, body: 'te paso el precio', status: 'sent' });
    await ingestWhatsappEvents(acc, [{ type: 'status', providerMessageId: sent, status: 'read', chatId: `${p.lid}@lid` }]);
    await ingestWhatsappEvents(acc, [msg(`${p.lid}@lid`, { senderLid: p.lid, providerMessageId: `L-${uniq()}`, senderName: 'Ana Ejemplo' })]);
    const list = await threads(acc.id);
    expect(list.map((t) => t.external_id)).toEqual([pn]);
    expect(await messageIds(list[0].id)).toHaveLength(3);
  });

  it('la respuesta por lid llegó antes que la tilde: los dos chats (con nombre) se juntan cuando llega la tilde', async () => {
    const { acc } = await inboxAccount('echo7');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    await ingestWhatsappEvents(acc, [msg(pn, { providerMessageId: `R-${uniq()}` })]);
    const sent = `E-${uniq()}`;
    await addMessage((await findThread(acc.id, pn))!, { externalId: sent, fromMe: true, body: 'te paso el precio', status: 'sent' });
    await ingestWhatsappEvents(acc, [msg(`${p.lid}@lid`, { senderLid: p.lid, providerMessageId: `L-${uniq()}`, senderName: 'Ana Ejemplo' })]);
    expect(await threads(acc.id)).toHaveLength(2);
    await ingestWhatsappEvents(acc, [{ type: 'status', providerMessageId: sent, status: 'delivered', chatId: `${p.lid}@lid` }]);
    const list = await threads(acc.id);
    expect(list.map((t) => t.external_id)).toEqual([pn]);
    expect(await messageIds(list[0].id)).toHaveLength(3);
  });

  it('una respuesta por lid que cita lo que mandé al teléfono va a ese chat', async () => {
    const { acc } = await inboxAccount('echo8');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    const sent = `E-${uniq()}`;
    await ingestWhatsappEvents(acc, [own(pn, sent)]);
    await ingestWhatsappEvents(acc, [msg(`${p.lid}@lid`, { senderLid: p.lid, providerMessageId: `L-${uniq()}`, replyToProviderId: sent })]);
    expect((await threads(acc.id)).map((t) => t.external_id)).toEqual([pn]);
  });

  it('juntar es idempotente: dos corridas a la vez con el mismo par dejan un chat y suman los no leídos una vez', async () => {
    const { acc } = await inboxAccount('echo4');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    await ingestWhatsappEvents(acc, [msg(pn, { providerMessageId: `R-${uniq()}` })]);
    await ingestWhatsappEvents(acc, [msg(`${p.lid}@lid`, { senderLid: p.lid, providerMessageId: `L-${uniq()}`, senderName: '' })]);
    expect(await threads(acc.id)).toHaveLength(2);
    await rememberContacts({ app: 'inbox', accountId: acc.id, userId: acc.owner_id }, [{ lid: p.lid, phone: p.phone }]);
    const runs = await Promise.all([mergeLidChats('inbox', acc.id, { lids: [p.lid] }), mergeLidChats('inbox', acc.id, { lids: [p.lid] })]);
    expect(runs.reduce((n, r) => n + r.merged, 0)).toBe(1);
    const list = await threads(acc.id);
    expect(list.map((t) => t.external_id)).toEqual([pn]);
    expect(Number(list[0].unread)).toBe(2);
    expect(await messageIds(list[0].id)).toHaveLength(2);
    // Una tercera no hace nada.
    expect(await mergeLidChats('inbox', acc.id, { lids: [p.lid] })).toEqual({ merged: 0, renamed: 0, messages: 0 });
  });
});

describe('Inbox: un chat por lid nunca se muestra como un teléfono', () => {
  it('sin nombre: "Contacto de WhatsApp"; con nombre en la libreta: ese nombre', async () => {
    const { u, acc } = await inboxAccount('echo5');
    const p = person();
    const q = person();
    await ingestWhatsappEvents(acc, [own(`${p.lid}@lid`, `E-${uniq()}`), own(`${q.lid}@lid`, `E-${uniq()}`)]);
    // Una fila vieja con los dígitos del lid en handle y título.
    await getDb().prepare('UPDATE inbox_threads SET handle = ?, title = ? WHERE account_id = ? AND external_id = ?').run(p.lid, p.lid, acc.id, `${p.lid}@lid`);
    await rememberContacts({ app: 'inbox', accountId: acc.id, userId: u.id }, [{ lid: q.lid, push: 'Beto Ejemplo' }]);
    const list = await listThreads(u.id);
    const pid = (await findThread(acc.id, `${p.lid}@lid`))!.id;
    const qid = (await findThread(acc.id, `${q.lid}@lid`))!.id;
    const tp = list.find((t) => t.id === pid)!;
    const tq = list.find((t) => t.id === qid)!;
    for (const t of [tp, tq]) {
      expect(t.handle).toBe('');
      expect(t.title).not.toMatch(/\d{6,}/);
    }
    expect(['Contacto de WhatsApp', 'WhatsApp contact', 'Contato do WhatsApp']).toContain(tp.title);
    expect(tq.title).toBe('Beto Ejemplo');
  });
});

describe('Lines: el eco propio por lid no abre otro chat', () => {
  async function line(label: string) {
    const user = await makeUser(label);
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
    return (await getNumberRowById(n.id))!;
  }
  const chats = async (numberId: string) =>
    ((await getDb().prepare("SELECT provider_chat_id FROM groups_chats WHERE number_id = ? AND kind = 'dm' ORDER BY provider_chat_id").all(numberId)) as Array<{ provider_chat_id: string }>).map(
      (r) => r.provider_chat_id,
    );

  it('importado por teléfono y después el eco por lid: un solo chat y lo que sigue por lid llega al mismo', async () => {
    const row = await line('echol1');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    const id = `E-${uniq()}`;
    await ingestEvents(row, [own(pn, id, { history: true })], { history: true });
    await ingestEvents(row, [own(`${p.lid}@lid`, id)]);
    expect(await chats(row.id)).toEqual([pn]);
    expect(await phoneForLid({ app: 'lines', accountId: row.id }, p.lid)).toBe(p.phone);
    await ingestEvents(row, [msg(`${p.lid}@lid`, { senderLid: p.lid, providerMessageId: `S-${uniq()}` })]);
    expect(await chats(row.id)).toEqual([pn]);
  });

  it('mando yo por el teléfono y la tilde y la respuesta vuelven por lid: un solo chat', async () => {
    const row = await line('echol2');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    const sent = `E-${uniq()}`;
    await ingestEvents(row, [msg(pn, { providerMessageId: `R-${uniq()}` }), own(pn, sent)]);
    await ingestEvents(row, [{ type: 'status', providerMessageId: sent, status: 'read', chatId: `${p.lid}@lid` }]);
    await ingestEvents(row, [msg(`${p.lid}@lid`, { senderLid: p.lid, providerMessageId: `L-${uniq()}` })]);
    expect(await chats(row.id)).toEqual([pn]);
  });
});

describe('arreglo de una vez (scripts/repair-wa-lid-duplicates.ts)', () => {
  it('sin --apply informa y no cambia nada; con --apply junta; la segunda vez no encuentra nada', async () => {
    const u = await makeUser('echorep');
    const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    const p = person();
    const now = new Date().toISOString();
    const db = getDb();
    const thread = async (ext: string, handle: string) => {
      const id = `ibt_${uniq()}`;
      await db
        .prepare("INSERT INTO inbox_threads (id, owner_id, account_id, channel, kind, external_id, title, handle, created_at, updated_at) VALUES (?, ?, ?, 'whatsapp', 'dm', ?, '', ?, ?, ?)")
        .run(id, u.id, a.id, ext, handle, now, now);
      return id;
    };
    const message = async (threadId: string, ext: string, fromMe: number) =>
      db
        .prepare('INSERT INTO inbox_messages (id, owner_id, thread_id, external_id, from_me, body, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(`ibm_${uniq()}`, u.id, threadId, ext, fromMe, 'x', now, now);
    // Lo que quedó en producción: el chat por teléfono y el del lid con el mismo mensaje propio (y un dígito de más
    // en handle del chat por lid, que se mostraba como un teléfono).
    const pPn = await thread(`${p.phone}@s.whatsapp.net`, p.phone);
    const pLid = await thread(`${p.lid}@lid`, p.lid);
    const shared = `P-${uniq()}`;
    await message(pPn, shared, 1);
    await message(pLid, shared, 1);
    await message(pLid, `Q-${uniq()}`, 0);
    const dry = await repairLidDuplicates(getClient(), { apply: false });
    expect(dry.applied).toBe(false);
    expect(dry.inbox.merged).toBeGreaterThanOrEqual(1);
    expect(dry.inbox.messages).toBeGreaterThanOrEqual(1);
    expect(await db.prepare('SELECT 1 FROM inbox_threads WHERE id = ?').get(pLid)).toBeTruthy();
    const applied = await repairLidDuplicates(getClient(), { apply: true });
    expect(applied.inbox.merged).toBe(dry.inbox.merged);
    expect(await db.prepare('SELECT 1 FROM inbox_threads WHERE id = ?').get(pLid)).toBeFalsy();
    expect(await messageIds(pPn)).toHaveLength(2);
    const again = await repairLidDuplicates(getClient(), { apply: true });
    expect(again.inbox).toEqual({ merged: 0, renamed: 0, messages: 0 });
  });
});
