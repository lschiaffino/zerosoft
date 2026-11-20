/**
 * Inbox y Lines: lo que llega con el id de la cuenta propia y no es del chat
 * con uno mismo (Meta AI, un lid cuyo alternativo es el teléfono propio, un
 * remitente que Evolution dejó sin su lid) va a su chat; lo que uno se manda
 * sigue en el chat con uno mismo. Números, lids, nombres y textos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createAccount, getAccountById } from '@/lib/inbox/core';
import { ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { connectNumber, createNumber, getNumberRowById, ingestEvents } from '@/lib/groups';
import { evolutionMessageEvents, parseEvolutionWebhook } from '@/lib/groups-provider-bridge';
import { META_AI_JID, phoneDigits, type HistorySource, type InboundEvent } from '@/lib/groups-provider';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { isOwnChat, routeSelfChat, unknownSenderJid } from '@/lib/wa-self-chat';
import { planSelfChatMoves, repairBotSelfChat } from '@/lib/wa-bot-self-repair';
import { phoneForLid } from '@/lib/wa-contacts';
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
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`.toUpperCase();
function ownPhone() {
  return `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
}
const CONTACT_LID = '70000000000001';
const BOT_PERSONA = { botMetadata: { personaId: 'persona-x' } };

type Json = Record<string, unknown>;
/** Un messages.upsert de Evolution (lo que manda el webhook). */
function upsert(key: Json, message: Json, extra: Json = {}): Json {
  return { event: 'messages.upsert', data: { key: { id: `ID${uniq()}`, ...key }, message, messageTimestamp: Math.floor(Date.now() / 1000), ...extra } };
}
const one = (body: Json) => {
  const out = parseEvolutionWebhook(body);
  expect(out).toHaveLength(1);
  return out[0] as Extract<InboundEvent, { type: 'message' }>;
};

describe('bridge: cada tipo de remitente', () => {
  const OWN = '5491100001234';
  const ownJid = `${OWN}@s.whatsapp.net`;

  it('lo que uno le escribe a Meta AI (llega con el id propio y botMetadata) → chat de Meta AI', () => {
    const e = one(upsert({ remoteJid: ownJid, fromMe: true }, { conversation: 'pregunta', messageContextInfo: BOT_PERSONA }));
    expect(e.chatId).toBe(ownJid);
    expect(e.bot).toBe(true);
    const [r] = routeSelfChat([e], OWN) as typeof e[];
    expect(r.chatId).toBe(META_AI_JID);
    expect(r.fromMe).toBe(true);
  });

  it('la respuesta de Meta AI (botInvokeMessage) se lee y va al chat de Meta AI, sin el teléfono propio', () => {
    const e = one(upsert({ remoteJid: ownJid, fromMe: false }, { botInvokeMessage: { message: { conversation: 'respuesta' } } }, { pushName: 'Persona IA' }));
    expect(e.body).toBe('respuesta');
    const [r] = routeSelfChat([e], OWN) as typeof e[];
    expect(r.chatId).toBe(META_AI_JID);
    expect(r.senderPhone).toBe('');
    expect(r.senderName).toBe('Persona IA');
  });

  it('un chat "@bot" (historial) queda con su id, y su id no se lee como teléfono', () => {
    const e = one(upsert({ remoteJid: '900000000000001@bot', fromMe: false }, { conversation: 'hola' }));
    expect(e.chatId).toBe('900000000000001@bot');
    expect(e.senderPhone).toBe('');
    expect(phoneDigits('900000000000001@bot')).toBe('');
    expect(routeSelfChat([e], OWN)[0]).toBe(e);
  });

  it('canales, difusiones y estados no entran', () => {
    for (const remoteJid of ['120363000000000001@newsletter', '1700000000@broadcast', 'status@broadcast']) {
      expect(parseEvolutionWebhook(upsert({ remoteJid, fromMe: false, participant: `${CONTACT_LID}@lid` }, { conversation: 'x' }))).toEqual([]);
    }
  });

  it('un lid sin teléfono queda en el chat del lid', () => {
    const e = one(upsert({ remoteJid: `${CONTACT_LID}@lid`, fromMe: false }, { conversation: 'hola' }, { pushName: 'Contacto Ejemplo' }));
    expect(e.chatId).toBe(`${CONTACT_LID}@lid`);
    expect(routeSelfChat([e], OWN)[0]).toBe(e);
  });

  it('un lid cuyo alternativo es el teléfono propio → al chat del lid, no al propio', () => {
    const e = one(upsert({ remoteJid: `${CONTACT_LID}@lid`, remoteJidAlt: ownJid, fromMe: false, addressingMode: 'lid' }, { conversation: 'hola' }, { pushName: 'Contacto Ejemplo' }));
    expect(e.chatId).toBe(ownJid);
    const [r] = routeSelfChat([e], OWN) as typeof e[];
    expect(r.chatId).toBe(`${CONTACT_LID}@lid`);
    expect(r.chatLid).toBe(CONTACT_LID);
    expect(r.senderPhone).toBe('');
  });

  it('el mismo, después de que Evolution cambió el lid por el alternativo (sin lid): al chat del nombre, nunca al propio', () => {
    const e = one(upsert({ remoteJid: ownJid, remoteJidAlt: ownJid, fromMe: false, addressingMode: 'lid' }, { conversation: 'hola' }, { pushName: 'Contacto Ejemplo' }));
    const [r] = routeSelfChat([e], OWN) as typeof e[];
    expect(r.chatId).toBe(unknownSenderJid('Contacto Ejemplo'));
    expect(r.chatId).toMatch(/^[a-p]{16}@unknown$/);
    expect(phoneDigits(r.chatId)).toBe('');
    expect(isOwnChat(r.chatId, OWN)).toBe(false);
    expect(r.senderPhone).toBe('');
    // Siempre el mismo chat para el mismo nombre.
    expect(unknownSenderJid('Contacto Ejemplo')).toBe(r.chatId);
  });

  it('lo que uno se manda a sí mismo sigue en el chat con uno mismo', () => {
    const e = one(upsert({ remoteJid: ownJid, fromMe: true }, { conversation: 'nota para mí' }));
    expect(e.bot).toBeUndefined();
    expect(routeSelfChat([e], OWN)[0]).toBe(e);
  });

  it('Meta AI mencionado en el chat con otra persona sigue en ese chat', () => {
    const other = '5491100005678@s.whatsapp.net';
    const e = one(upsert({ remoteJid: other, fromMe: false }, { conversation: 'respuesta', messageContextInfo: BOT_PERSONA }));
    expect(e.bot).toBe(true);
    expect(routeSelfChat([e], OWN)[0]).toBe(e);
  });

  it('sin teléfono propio conocido no cambia nada', () => {
    const e = one(upsert({ remoteJid: ownJid, fromMe: true }, { conversation: 'pregunta', messageContextInfo: BOT_PERSONA }));
    expect(routeSelfChat([e], '')[0]).toBe(e);
  });
});

async function linesNumber(label: string, phone: string) {
  const user = await makeUser(label);
  const n = await createNumber(user.id, user.id, { provider: 'fake' });
  await connectNumber(user.id, n.id);
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected', phone = ? WHERE id = ?").run(phone, n.id);
  return (await getNumberRowById(n.id))!;
}
async function inboxAccount(label: string, phone: string) {
  const u = await makeUser(label);
  const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = ? WHERE id = ?").run(phone, a.id);
  return (await getAccountById(a.id))!;
}
const linesChatOf = async (numberId: string, pid: string) =>
  ((await getDb()
    .prepare('SELECT c.provider_chat_id AS jid FROM groups_messages m JOIN groups_chats c ON c.id = m.chat_id WHERE m.number_id = ? AND m.provider_message_id = ?')
    .get(numberId, pid)) as { jid: string } | undefined)?.jid;
const inboxChatOf = async (accountId: string, pid: string) =>
  ((await getDb()
    .prepare('SELECT t.external_id AS jid FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id WHERE t.account_id = ? AND m.external_id = ?')
    .get(accountId, pid)) as { jid: string } | undefined)?.jid;

/** La tanda de siempre: una nota propia, una pregunta y una respuesta de Meta AI, y un mensaje sin lid de otra persona. */
function batch(own: string) {
  const ownJid = `${own}@s.whatsapp.net`;
  const raw = [
    upsert({ remoteJid: ownJid, fromMe: true }, { conversation: 'nota' }),
    upsert({ remoteJid: ownJid, fromMe: true }, { conversation: 'pregunta', messageContextInfo: BOT_PERSONA }),
    upsert({ remoteJid: ownJid, fromMe: false }, { botInvokeMessage: { message: { conversation: 'respuesta' } } }, { pushName: 'Persona IA' }),
    upsert({ remoteJid: ownJid, remoteJidAlt: ownJid, fromMe: false, addressingMode: 'lid' }, { conversation: 'hola' }, { pushName: 'Contacto Ejemplo' }),
  ];
  const events = raw.flatMap((b) => parseEvolutionWebhook(b)) as Array<Extract<InboundEvent, { type: 'message' }>>;
  return { ownJid, raw, events, ids: events.map((e) => e.providerMessageId) };
}

describe('Lines y Inbox en vivo', () => {
  it('Lines: cada mensaje en su chat y el teléfono propio no aprende el nombre de otro', async () => {
    const own = ownPhone();
    const n = await linesNumber('self-l', own);
    const b = batch(own);
    await ingestEvents(n, b.events);
    expect(await linesChatOf(n.id, b.ids[0])).toBe(b.ownJid);
    expect(await linesChatOf(n.id, b.ids[1])).toBe(META_AI_JID);
    expect(await linesChatOf(n.id, b.ids[2])).toBe(META_AI_JID);
    expect(await linesChatOf(n.id, b.ids[3])).toBe(unknownSenderJid('Contacto Ejemplo'));
    const self = (await getDb().prepare('SELECT name FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(n.id, b.ownJid)) as { name: string };
    expect(self.name).not.toBe('Contacto Ejemplo');
    const bot = (await getDb().prepare('SELECT name, phone FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(n.id, META_AI_JID)) as { name: string; phone: string };
    expect(bot.phone).toBe('');
    expect(bot.name).toBeTruthy();
  });

  it('Lines: un lid cuyo alternativo es el teléfono propio va al chat del lid', async () => {
    const own = ownPhone();
    const n = await linesNumber('self-l2', own);
    const e = parseEvolutionWebhook(upsert({ remoteJid: `${CONTACT_LID}@lid`, remoteJidAlt: `${own}@s.whatsapp.net`, fromMe: false }, { conversation: 'hola' }, { pushName: 'Contacto Ejemplo' }));
    await ingestEvents(n, e);
    const pid = (e[0] as { providerMessageId: string }).providerMessageId;
    expect(await linesChatOf(n.id, pid)).toBe(`${CONTACT_LID}@lid`);
    expect(await phoneForLid({ app: 'lines', accountId: n.id }, CONTACT_LID)).not.toBe(own);
  });

  it('Inbox: cada mensaje en su chat, y una edición de Meta AI con el id propio llega', async () => {
    const own = ownPhone();
    const acc = await inboxAccount('self-i', own);
    const b = batch(own);
    await ingestWhatsappEvents(acc, b.events);
    expect(await inboxChatOf(acc.id, b.ids[0])).toBe(b.ownJid);
    expect(await inboxChatOf(acc.id, b.ids[1])).toBe(META_AI_JID);
    expect(await inboxChatOf(acc.id, b.ids[2])).toBe(META_AI_JID);
    expect(await inboxChatOf(acc.id, b.ids[3])).toBe(unknownSenderJid('Contacto Ejemplo'));
    await ingestWhatsappEvents(acc, [{ type: 'edit', chatId: b.ownJid, providerMessageId: b.ids[2], body: 'respuesta completa' }]);
    const m = (await getDb().prepare('SELECT body FROM inbox_messages WHERE external_id = ?').get(b.ids[2])) as { body: string };
    expect(m.body).toBe('respuesta completa');
  });
});

describe('arreglo de lo que ya quedó en el chat propio', () => {
  /** El servidor: devuelve los mismos mensajes guardados bajo el id propio. */
  const gateway = (raw: Json[], only?: Set<string>): HistorySource => ({
    async messages() {
      return raw.flatMap((b) => evolutionMessageEvents((b as { data: Json }).data, true)).filter((e) => !only || (e.type === 'message' && only.has(e.providerMessageId)));
    },
    async chats() {
      return [];
    },
    async contacts() {
      return [];
    },
    async picture() {
      return '';
    },
  });

  it('plan: Meta AI si el servidor lo prueba, recibido al chat del nombre, lo propio sin prueba queda', () => {
    const plan = planSelfChatMoves(
      [
        { id: 'A', incoming: false, senderName: '' },
        { id: 'B', incoming: false, senderName: '' },
        { id: 'C', incoming: true, senderName: 'Persona IA' },
        { id: 'D', incoming: true, senderName: 'Contacto Ejemplo' },
      ],
      new Set(['B', 'C']),
    );
    expect(plan.get(META_AI_JID)).toEqual(['B', 'C']);
    expect(plan.get(unknownSenderJid('Contacto Ejemplo'))).toEqual(['D']);
    expect([...plan.values()].flat()).not.toContain('A');
  });

  it('Lines e Inbox: cuenta sin cambiar, después mueve solo lo comprobable, y la segunda vez no encuentra nada', async () => {
    const own = ownPhone();
    // Como antes del arreglo: sin teléfono propio conocido, todo cae en el chat propio.
    const n = await linesNumber('self-r', '');
    const acc = await inboxAccount('self-ri', '');
    const b = batch(own);
    await ingestEvents(n, b.events);
    await ingestWhatsappEvents(acc, b.events);
    for (const id of b.ids) {
      expect(await linesChatOf(n.id, id)).toBe(b.ownJid);
      expect(await inboxChatOf(acc.id, id)).toBe(b.ownJid);
    }
    // Una sola cuenta de cada app en la prueba: las demás de la base quedan afuera del arreglo.
    await getDb().prepare("UPDATE groups_numbers SET provider = 'evolution', phone = ? WHERE id = ?").run(own, n.id);
    await getDb().prepare("UPDATE inbox_accounts SET provider = 'managed', address = ? WHERE id = ?").run(own, acc.id);
    const deps = {
      linesHistory: async (id: string) => (id === n.id ? gateway(b.raw) : undefined),
      inboxHistory: async (id: string) => (id === acc.id ? gateway(b.raw) : undefined),
    };
    const dry = await repairBotSelfChat({ apply: false }, deps);
    expect(dry.lines.moved).toBe(2);
    expect(dry.lines.movedBySender).toBe(1);
    expect(dry.inbox.moved).toBe(2);
    expect(dry.inbox.movedBySender).toBe(1);
    expect(await linesChatOf(n.id, b.ids[1])).toBe(b.ownJid);

    const done = await repairBotSelfChat({ apply: true }, deps);
    expect(done.lines.moved).toBe(2);
    expect(await linesChatOf(n.id, b.ids[0])).toBe(b.ownJid);
    expect(await linesChatOf(n.id, b.ids[1])).toBe(META_AI_JID);
    expect(await linesChatOf(n.id, b.ids[2])).toBe(META_AI_JID);
    expect(await linesChatOf(n.id, b.ids[3])).toBe(unknownSenderJid('Contacto Ejemplo'));
    expect(await inboxChatOf(acc.id, b.ids[0])).toBe(b.ownJid);
    expect(await inboxChatOf(acc.id, b.ids[1])).toBe(META_AI_JID);
    expect(await inboxChatOf(acc.id, b.ids[3])).toBe(unknownSenderJid('Contacto Ejemplo'));

    const again = await repairBotSelfChat({ apply: true }, deps);
    expect(again.lines.moved + again.lines.movedBySender + again.inbox.moved + again.inbox.movedBySender).toBe(0);
  });

  it('lo propio que el servidor no tiene, o si no responde, no se toca', async () => {
    const own = ownPhone();
    const n = await linesNumber('self-r2', '');
    const b = batch(own);
    await ingestEvents(n, b.events.slice(0, 2));
    await getDb().prepare("UPDATE groups_numbers SET provider = 'evolution', phone = ? WHERE id = ?").run(own, n.id);
    const failing = await repairBotSelfChat({ apply: true }, {
      linesHistory: async (id) => (id === n.id ? { ...gateway([]), messages: async () => Promise.reject(new Error('down')) } : undefined),
      inboxHistory: async () => undefined,
    });
    expect(failing.lines.failed).toBeGreaterThanOrEqual(1);
    expect(await linesChatOf(n.id, b.ids[1])).toBe(b.ownJid);
    const missing = await repairBotSelfChat({ apply: true }, {
      linesHistory: async (id) => (id === n.id ? gateway(b.raw, new Set([b.ids[0]])) : undefined),
      inboxHistory: async () => undefined,
    });
    expect(missing.lines.moved).toBe(0);
    expect(await linesChatOf(n.id, b.ids[1])).toBe(b.ownJid);
  });
});
