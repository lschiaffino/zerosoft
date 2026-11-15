/**
 * La ficha "Info del contacto" de una persona de un grupo (Inbox y Lines) y la
 * regla de "Responder en privado". Números y nombres inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { canReplyPrivately, privateQuoteAllowed, sharedTotal } from '@/lib/wa-person';
import { rememberContacts } from '@/lib/wa-contacts';
import { addMessage, createAccount, findThread, getAccountById, upsertThread } from '@/lib/inbox/core';
import { personCard as inboxCard } from '@/lib/inbox/wa-meta';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listMessages } from '@/lib/groups';
import { personCard as linesCard, personPhone, sharedContent } from '@/lib/groups-person';
import { startChat } from '@/lib/groups-new-chat';
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
const ANA = '5491177720011';
const BETO = '5491177720022';

describe('responder en privado (puro)', () => {
  it('solo a un mensaje de otra persona en un grupo, con su teléfono', () => {
    const base = { group: true, fromMe: false, deleted: false, senderPhone: ANA, myPhone: ME };
    expect(canReplyPrivately(base)).toBe(true);
    expect(canReplyPrivately({ ...base, group: false })).toBe(false);
    expect(canReplyPrivately({ ...base, fromMe: true })).toBe(false);
    expect(canReplyPrivately({ ...base, deleted: true })).toBe(false);
    expect(canReplyPrivately({ ...base, note: true })).toBe(false);
    // Un remitente que solo vino con su lid (sin teléfono) no tiene a dónde escribirle.
    expect(canReplyPrivately({ ...base, senderPhone: '' })).toBe(false);
    expect(canReplyPrivately({ ...base, senderPhone: ME })).toBe(false);
  });

  it('el servidor solo cita en el 1:1 de quien escribió, en la misma cuenta', () => {
    const quoted = { accountId: 'a1', groupKind: 'group' as const, fromMe: false, senderPhone: ANA, deleted: false };
    const target = { accountId: 'a1', kind: 'dm' as const, phone: ANA };
    expect(privateQuoteAllowed(quoted, target)).toBe(true);
    expect(privateQuoteAllowed(quoted, { ...target, phone: BETO })).toBe(false);
    expect(privateQuoteAllowed(quoted, { ...target, accountId: 'a2' })).toBe(false);
    expect(privateQuoteAllowed(quoted, { ...target, kind: 'group' })).toBe(false);
    expect(privateQuoteAllowed({ ...quoted, groupKind: 'dm' }, target)).toBe(false);
    expect(privateQuoteAllowed({ ...quoted, fromMe: true }, target)).toBe(false);
    expect(privateQuoteAllowed({ ...quoted, deleted: true }, target)).toBe(false);
  });

  it('archivos, enlaces y documentos suman como en WhatsApp', () => {
    expect(sharedTotal({ shared: { media: 2, docs: 1, links: 3, starred: 9 } })).toBe(6);
  });
});

describe('Inbox: ficha de una persona del grupo', () => {
  it('nombre, foto, info, rol, chat 1:1 con lo compartido y grupos en común', async () => {
    const u = await makeUser('waperson-i');
    const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = ? WHERE id = ?").run(ME, a.id);
    const acc = (await getAccountById(a.id))!;
    const info = (phones: Array<[string, string]>) => JSON.stringify({ participants: phones.map(([phone, role]) => ({ phone, role })) });
    const group = await upsertThread(acc, { externalId: '120363000000000701@g.us', kind: 'group', title: 'Asado' });
    const other = await upsertThread(acc, { externalId: '120363000000000702@g.us', kind: 'group', title: 'Fútbol' });
    await getDb().prepare('UPDATE inbox_threads SET info = ? WHERE id = ?').run(info([[ME, 'superadmin'], [ANA, 'admin'], [BETO, 'member']]), group.id);
    await getDb().prepare('UPDATE inbox_threads SET info = ? WHERE id = ?').run(info([[ANA, 'member']]), other.id);
    await rememberContacts({ app: 'inbox', accountId: acc.id, userId: u.id }, [{ phone: ANA, push: 'Ana Prueba', about: 'En el trabajo' }]);
    await getDb().prepare("UPDATE wa_contacts SET picture = '/uploads/chat/ana.jpg' WHERE account_id = ? AND phone = ?").run(acc.id, ANA);

    // Sin chat 1:1: nada compartido, no se puede silenciar ni bloquear.
    let card = await inboxCard(u.id, group.id, ANA);
    expect(card).toMatchObject({ phone: ANA, name: 'Ana Prueba', about: 'En el trabajo', picture: '/uploads/chat/ana.jpg', role: 'admin', me: false, dm: null, canBlock: false });
    expect(card.shared).toEqual({ media: 0, docs: 0, links: 0, starred: 0 });
    expect(card.commonGroups.map((g) => g.name)).toEqual(['Fútbol']);

    // Con chat 1:1: foto, link y destacado cuentan.
    const dm = await upsertThread(acc, { externalId: `${ANA}@s.whatsapp.net`, kind: 'dm', handle: ANA });
    await addMessage(dm, { externalId: 'x1', fromMe: false, body: '', mediaType: 'image', mediaRef: 'ref1', senderHandle: ANA });
    await addMessage(dm, { externalId: 'x2', fromMe: true, body: 'mirá https://example.com/a', senderHandle: '' });
    await getDb().prepare("UPDATE inbox_messages SET starred_at = ? WHERE thread_id = ? AND external_id = 'x2'").run(new Date().toISOString(), dm.id);
    card = await inboxCard(u.id, group.id, ANA);
    expect(card.dm).toEqual({ id: dm.id, muted: false, blocked: false });
    expect(card.shared).toEqual({ media: 1, docs: 0, links: 1, starred: 1 });
    expect(card.canBlock).toBe(true);

    // Quien no tiene nombre ni chat: el nombre con el que escribió en el grupo.
    await addMessage((await findThread(acc.id, group.external_id))!, { externalId: 'g1', fromMe: false, body: 'hola', senderHandle: BETO, senderName: 'Beto Prueba' });
    expect((await inboxCard(u.id, group.id, BETO)).name).toBe('Beto Prueba');
    expect((await inboxCard(u.id, group.id, ME)).me).toBe(true);
  });

  it('otra persona no ve la ficha; un teléfono inválido o un chat 1:1 no sirven', async () => {
    const u = await makeUser('waperson-i2');
    const other = await makeUser('waperson-i3');
    const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    const acc = (await getAccountById(a.id))!;
    const group = await upsertThread(acc, { externalId: '120363000000000703@g.us', kind: 'group', title: 'Grupo' });
    const dm = await upsertThread(acc, { externalId: `${ANA}@s.whatsapp.net`, kind: 'dm', handle: ANA });
    await expect(inboxCard(other.id, group.id, ANA)).rejects.toMatchObject({ code: 'not_found' });
    await expect(inboxCard(u.id, group.id, '12')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(inboxCard(u.id, dm.id, ANA)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('Lines: ficha de una persona del grupo', () => {
  function msg(over: Partial<Extract<InboundEvent, { type: 'message' }>>): InboundEvent {
    return {
      type: 'message',
      chatId: '120363000000000801@g.us',
      isGroup: true,
      chatName: 'Proveedores',
      fromMe: false,
      senderPhone: ANA,
      senderName: 'Ana Prueba',
      providerMessageId: `m-${Math.random().toString(36).slice(2)}`,
      body: 'hola',
      timestamp: new Date().toISOString(),
      ...over,
    } as InboundEvent;
  }

  it('por mensaje o por teléfono; Mensaje abre su chat 1:1; con teléfonos ocultos no se ve el número', async () => {
    const user = await makeUser('waperson-l');
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    const fake = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (fake) fake.connectedAt = Date.now() - 5000;
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected', phone = ? WHERE id = ?").run(ME, n.id);
    const row = (await getNumberRowById(n.id))!;
    await ingestEvents(row, [msg({})]);
    const chat = (await listChats(user.id, user.id, { kind: 'group' })).rows.find((c) => c.name === 'Proveedores')!;
    const m = (await listMessages(user.id, chat.id)).find((x) => x.body === 'hola')!;

    const viewer = systemViewer(user.id);
    expect(await personPhone(user.id, chat.id, { messageId: m.id })).toBe(ANA);
    await expect(personPhone(user.id, 'otro-chat', { messageId: m.id })).rejects.toMatchObject({ code: 'not_found' });
    let card = await linesCard(viewer, chat.id, ANA);
    expect(card).toMatchObject({ phone: ANA, name: 'Ana Prueba', dm: null, canBlock: false, me: false });

    // "Mensaje": el chat 1:1 en la misma línea, y la ficha lo encuentra.
    const started = await startChat(viewer, { numberId: n.id, phone: ANA });
    card = await linesCard(viewer, chat.id, ANA);
    expect(card.dm?.id).toBe(started.id);
    expect(await sharedContent(viewer, started.id, 'media')).toEqual([]);
    expect((await linesCard(viewer, chat.id, ME)).me).toBe(true);

    // Con los teléfonos ocultos: la ficha sale con el número enmascarado.
    const masked = viewerFrom(user.id, user.id, 'member', { ...DEFAULT_PLATFORM, maskRoles: ['member'] });
    const hidden = await linesCard({ ...masked, linesScoped: false }, chat.id, ANA);
    expect(hidden.masked).toBe(true);
    expect(hidden.phone).not.toContain('77720011');
  });
});
