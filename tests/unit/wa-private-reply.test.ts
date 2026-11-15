/**
 * "Responder en privado" en Inbox y Lines: la respuesta en el chat 1:1 cita el
 * mensaje del grupo (sale a WhatsApp con su id, que arma la cita con el grupo)
 * y la cita se muestra con el nombre del grupo. Solo al chat de quien lo
 * mandó y en la misma cuenta o línea. Números y nombres inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMessage, createAccount, findThread, getAccountById, listMessages as listInbox, upsertThread } from '@/lib/inbox/core';
import { sendWaMessage } from '@/lib/inbox/wa-actions';
import { waProviderFor } from '@/lib/inbox/whatsapp';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listMessages as listLines, sendMessage } from '@/lib/groups';
import { startChat } from '@/lib/groups-new-chat';
import { systemViewer } from '@/lib/groups-access';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
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

const ANA = '5491177730011';
const BETO = '5491177730022';
type FakeState = { connectedAt: number | null };
const fakes = () => (globalThis as unknown as { __groupsFake: Map<string, FakeState> }).__groupsFake;

describe('Inbox: responder en privado', () => {
  it('el 1:1 cita el mensaje del grupo; no se cita lo de otra persona', async () => {
    const u = await makeUser('waprivate-i');
    const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = '15550000001' WHERE id = ?").run(a.id);
    const acc = (await getAccountById(a.id))!;
    await waProviderFor(acc).connect('https://example.com/hook');
    const st = fakes().get(`inbox-${acc.id}`);
    if (st) st.connectedAt = Date.now() - 5000;

    const group = await upsertThread(acc, { externalId: '120363000000000901@g.us', kind: 'group', title: 'Asado' });
    await addMessage(group, { externalId: 'GRP-ANA-1', fromMe: false, body: '¿quién trae hielo?', senderHandle: ANA, senderName: 'Ana Prueba' });
    await addMessage(group, { externalId: 'GRP-BETO-1', fromMe: false, body: 'yo no', senderHandle: BETO, senderName: 'Beto Prueba' });
    const page = await listInbox(u.id, group.id);
    const fromAna = page.messages.find((m) => m.senderHandle === ANA)!;
    const fromBeto = page.messages.find((m) => m.senderHandle === BETO)!;
    const dm = await upsertThread(acc, { externalId: `${ANA}@s.whatsapp.net`, kind: 'dm', handle: ANA });

    await sendWaMessage(u.id, dm.id, 'lo llevo yo', { replyTo: fromAna.id });
    // A WhatsApp sale con el id del mensaje del grupo (el servidor arma la cita con el grupo).
    const sent = fakeSent(`inbox-${acc.id}`).at(-1)!;
    expect(sent.chatId).toBe(`${ANA}@s.whatsapp.net`);
    const reply = (await listInbox(u.id, dm.id)).messages.find((m) => m.body === 'lo llevo yo')!;
    expect(reply.reply).toMatchObject({ id: fromAna.id, senderHandle: ANA, chat: { id: group.id, title: 'Asado' } });

    // Lo de otra persona, o un 1:1 de otra cuenta: no.
    await expect(sendWaMessage(u.id, dm.id, 'no', { replyTo: fromBeto.id })).rejects.toMatchObject({ code: 'not_found' });
    expect((await findThread(acc.id, dm.external_id))!.id).toBe(dm.id);
  });
});

describe('Lines: responder en privado', () => {
  function msg(over: Partial<Extract<InboundEvent, { type: 'message' }>>): InboundEvent {
    return {
      type: 'message',
      chatId: '120363000000000902@g.us',
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

  it('la respuesta en el 1:1 lleva la cita del grupo; otro chat o lo propio no', async () => {
    const user = await makeUser('waprivate-l');
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    const st = fakes().get(n.id);
    if (st) st.connectedAt = Date.now() - 5000;
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected', phone = '15550000001' WHERE id = ?").run(n.id);
    const row = (await getNumberRowById(n.id))!;
    await ingestEvents(row, [msg({ body: 'necesito precios' }), msg({ senderPhone: BETO, senderName: 'Beto Prueba', body: 'yo también' })]);
    const group = (await listChats(user.id, user.id, { kind: 'group' })).rows.find((c) => c.name === 'Proveedores')!;
    const msgs = await listLines(user.id, group.id);
    const fromAna = msgs.find((m) => m.body === 'necesito precios')!;
    const fromBeto = msgs.find((m) => m.body === 'yo también')!;

    const dm = await startChat(systemViewer(user.id), { numberId: n.id, phone: ANA });
    const out = await sendMessage(user.id, user.id, dm.id, { body: 'te paso la lista', replyToId: fromAna.id });
    expect(out.replyToId).toBe(fromAna.id);
    const shown = (await listLines(user.id, dm.id)).find((m) => m.body === 'te paso la lista')!;
    expect(shown.replyQuote).toMatchObject({ id: fromAna.id, chatId: group.id, chatName: 'Proveedores', senderName: 'Ana Prueba', body: 'necesito precios' });

    await expect(sendMessage(user.id, user.id, dm.id, { body: 'no', replyToId: fromBeto.id })).rejects.toMatchObject({ code: 'invalid_reply' });
    // Una respuesta común dentro del mismo chat no lleva replyQuote.
    const inGroup = await sendMessage(user.id, user.id, group.id, { body: 'ok', replyToId: fromAna.id });
    expect((await listLines(user.id, group.id)).find((m) => m.id === inGroup.id)!.replyQuote).toBeUndefined();
  });
});
