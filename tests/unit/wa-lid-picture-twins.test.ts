/**
 * Inbox y Lines: un mensaje propio nuevo (mandado desde el teléfono) que llega
 * solo con el lid, sin par en la libreta ni mensaje repetido, abre un chat por
 * lid junto al del teléfono. Lo que dice que son la misma persona es la foto:
 * la fila del lid y la del teléfono tienen la misma foto de WhatsApp. Entonces
 * la libreta aprende el par y los chats se juntan, sin perder nada y sin cruzar
 * de cuenta o número. Números, lids, fotos y nombres inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createAccount, getAccountById } from '@/lib/inbox/core';
import { ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { createNumber, connectNumber, getNumberRowById, ingestEvents } from '@/lib/groups';
import { lookupContacts, phoneForLid, rememberContacts } from '@/lib/wa-contacts';
import { applyPicture, type PictureRow } from '@/lib/wa-contact-pictures';
import { linkPictureTwins } from '@/lib/wa-dedupe-run';
import { parseWahaWebhook } from '@/lib/groups-provider-bridge';
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
const own = (chatId: string, over: Partial<Extract<InboundEvent, { type: 'message' }>> = {}) =>
  msg(chatId, { fromMe: true, senderPhone: '', senderName: '', providerMessageId: `own-${uniq()}`, body: 'te escribo desde el teléfono', ...over });

const photo = () => `https://pps.example.test/v/t61/${uniq()}_n.jpg`;
const store = async (url: string) => `stored:${url.length}`;

/** La foto de una fila de la libreta, como la deja applyPicture (con la firma de la URL que vence). */
async function givePicture(scope: { app: 'inbox' | 'lines'; accountId: string; userId: string }, key: { phone?: string; lid?: string }, url: string) {
  const d = (key.phone ?? key.lid)!;
  const row = (await lookupContacts(scope, [d])).get(d) as PictureRow;
  return applyPicture(row, `${url}?oe=${uniq()}&oh=${uniq()}`, store, scope);
}

describe('Inbox: la misma foto junta el chat del lid con el del teléfono', () => {
  async function account(label: string) {
    const u = await makeUser(label);
    const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
    return { u, acc: (await getAccountById(a.id))! };
  }
  const threads = async (accId: string) =>
    ((await getDb().prepare("SELECT id, external_id, unread FROM inbox_threads WHERE account_id = ? AND kind = 'dm' ORDER BY external_id").all(accId)) as Array<{ id: string; external_id: string; unread: number }>);
  const count = async (threadId: string) => Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM inbox_messages WHERE thread_id = ?').get(threadId)) as { n: number }).n);

  it('chat por teléfono + mensaje propio nuevo por lid: dos chats hasta que las dos filas tienen la misma foto; después uno, con todos los mensajes', async () => {
    const { acc } = await account('pic1');
    const scope = { app: 'inbox' as const, accountId: acc.id, userId: acc.owner_id };
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    await ingestWhatsappEvents(acc, [msg(pn), msg(pn)]);
    await ingestWhatsappEvents(acc, [own(`${p.lid}@lid`)]);
    expect((await threads(acc.id)).map((t) => t.external_id).sort()).toEqual([pn, `${p.lid}@lid`].sort());
    // Cada uno con su fila en la libreta (la del lid sin teléfono): sin foto en común no se juntan.
    await rememberContacts(scope, [{ lid: p.lid, push: 'Ana Ejemplo' }]);
    const url = photo();
    await givePicture(scope, { phone: p.phone }, url);
    expect(await phoneForLid(scope, p.lid)).toBe('');
    expect(await threads(acc.id)).toHaveLength(2);
    // La foto del lid llega: es la misma que la del teléfono.
    await givePicture(scope, { lid: p.lid }, url);
    const list = await threads(acc.id);
    expect(list.map((t) => t.external_id)).toEqual([pn]);
    expect(await count(list[0].id)).toBe(3);
    expect(await phoneForLid(scope, p.lid)).toBe(p.phone);
    // Idempotente.
    expect(await linkPictureTwins(scope)).toEqual({ merged: 0, renamed: 0, messages: 0 });
  });

  it('fotos distintas no juntan nada', async () => {
    const { acc } = await account('pic2');
    const scope = { app: 'inbox' as const, accountId: acc.id, userId: acc.owner_id };
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    await ingestWhatsappEvents(acc, [msg(pn)]);
    await ingestWhatsappEvents(acc, [own(`${p.lid}@lid`)]);
    await rememberContacts(scope, [{ lid: p.lid, push: 'Beto Ejemplo' }]);
    await givePicture(scope, { phone: p.phone }, photo());
    await givePicture(scope, { lid: p.lid }, photo());
    expect(await threads(acc.id)).toHaveLength(2);
  });

  it('la misma foto en otra cuenta no cruza: cada cuenta junta lo suyo', async () => {
    const a = await account('pic3a');
    const b = await account('pic3b');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    const url = photo();
    const sa = { app: 'inbox' as const, accountId: a.acc.id, userId: a.acc.owner_id };
    const sb = { app: 'inbox' as const, accountId: b.acc.id, userId: b.acc.owner_id };
    // En la cuenta A: el chat del teléfono y la foto del teléfono. En la B: el chat del lid y la foto del lid.
    await ingestWhatsappEvents(a.acc, [msg(pn)]);
    await ingestWhatsappEvents(b.acc, [own(`${p.lid}@lid`)]);
    await rememberContacts(sa, [{ phone: p.phone, push: 'Ana Ejemplo' }]);
    await rememberContacts(sb, [{ lid: p.lid, push: 'Ana Ejemplo' }]);
    await givePicture(sa, { phone: p.phone }, url);
    await givePicture(sb, { lid: p.lid }, url);
    expect((await threads(a.acc.id)).map((t) => t.external_id)).toEqual([pn]);
    expect((await threads(b.acc.id)).map((t) => t.external_id)).toEqual([`${p.lid}@lid`]);
  });

  it('un lid con la misma foto que dos teléfonos no se toca', async () => {
    const { acc } = await account('pic4');
    const scope = { app: 'inbox' as const, accountId: acc.id, userId: acc.owner_id };
    const p = person();
    const q = person();
    const url = photo();
    await ingestWhatsappEvents(acc, [msg(`${p.phone}@s.whatsapp.net`), msg(`${q.phone}@s.whatsapp.net`), own(`${p.lid}@lid`)]);
    await rememberContacts(scope, [{ lid: p.lid, push: 'Ana Ejemplo' }]);
    await givePicture(scope, { phone: p.phone }, url);
    await givePicture(scope, { phone: q.phone }, url);
    await givePicture(scope, { lid: p.lid }, url);
    expect(await threads(acc.id)).toHaveLength(3);
  });
});

describe('Lines: la misma foto junta el chat del lid con el del teléfono', () => {
  it('chat por teléfono + mensaje propio nuevo por lid: un solo chat al llegar la foto', async () => {
    const user = await makeUser('pic5');
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
    const row = (await getNumberRowById(n.id))!;
    const scope = { app: 'lines' as const, accountId: row.id, userId: row.user_id };
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    await ingestEvents(row, [msg(pn)]);
    await ingestEvents(row, [own(`${p.lid}@lid`)]);
    const chats = async () =>
      ((await getDb().prepare("SELECT id, provider_chat_id FROM groups_chats WHERE number_id = ? AND kind = 'dm' ORDER BY provider_chat_id").all(row.id)) as Array<{ id: string; provider_chat_id: string }>);
    expect(await chats()).toHaveLength(2);
    await rememberContacts(scope, [{ lid: p.lid, push: 'Ana Ejemplo' }]);
    const url = photo();
    await givePicture(scope, { phone: p.phone }, url);
    await givePicture(scope, { lid: p.lid }, url);
    const list = await chats();
    expect(list.map((c) => c.provider_chat_id)).toEqual([pn]);
    const msgs = (await getDb().prepare('SELECT COUNT(*) AS n FROM groups_messages WHERE chat_id = ?').get(list[0].id)) as { n: number };
    expect(Number(msgs.n)).toBe(2);
  });
});

describe('WAHA: un 1:1 por lid con el teléfono al lado va al chat del teléfono', () => {
  it('fromMe y recibido: chatId con teléfono y el lid en chatLid', () => {
    const p = person();
    const out = parseWahaWebhook({ event: 'message.any', payload: { id: 'true_a', fromMe: true, to: `${p.lid}@lid`, body: 'hola', _data: { key: { remoteJidAlt: `${p.phone}@s.whatsapp.net` } } } });
    expect(out[0]).toMatchObject({ type: 'message', chatId: `${p.phone}@s.whatsapp.net`, chatLid: p.lid, fromMe: true });
    const inn = parseWahaWebhook({ event: 'message', payload: { id: 'false_b', fromMe: false, from: `${p.lid}@lid`, body: 'hola', _data: { key: { remoteJidAlt: `${p.phone}@s.whatsapp.net` } } } });
    expect(inn[0]).toMatchObject({ chatId: `${p.phone}@s.whatsapp.net`, chatLid: p.lid, senderPhone: p.phone });
    // Sin el teléfono al lado: queda el lid, sin chatLid.
    const bare = parseWahaWebhook({ event: 'message.any', payload: { id: 'true_c', fromMe: true, to: `${p.lid}@lid`, body: 'hola' } });
    expect(bare[0]).toMatchObject({ chatId: `${p.lid}@lid` });
    expect((bare[0] as { chatLid?: string }).chatLid).toBeUndefined();
  });
});
