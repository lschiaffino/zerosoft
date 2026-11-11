/**
 * Menciones de WhatsApp en Lines e Inbox: nunca un número suelto cuando se
 * sabe quién es. Con nombre, "@Nombre"; solo el teléfono, "@+teléfono"
 * (oculto para quien tiene los teléfonos ocultos); un lid que nadie conoce,
 * "@alguien". Lo que alguien escribió a mano ("@12345") queda como está.
 * Números y nombres inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { hiddenMentions, mentionLabel, mentionLabels, mentionSomeone, ownMentions, replaceMentions } from '@/lib/wa-mentions';
import { mentionTargets, rememberContacts, resolveTextMentions, type ContactScope } from '@/lib/wa-contacts';
import { evolutionProvider } from '@/lib/groups-provider-bridge';
import { connectNumber, createNumber, getChat, getNumberRowById, ingestEvents, listChats, listMessages, syncMembers } from '@/lib/groups';
import { listPinned } from '@/lib/groups-inbox';
import { maskMessage, type GroupsViewer } from '@/lib/groups-access';
import { linesMentionTexts, linesRowTexts } from '@/lib/groups-wa-names';
import { fakeGroupState, resetFakeProvider } from '@/lib/groups-provider-fake';
import { createAccount, getAccountById, getThread, findThread, listMessages as listInboxMessages } from '@/lib/inbox/core';
import { ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import type { InboundEvent } from '@/lib/groups-provider';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const LID_KNOWN = '700000000000021';
const LID_PHONE_ONLY = '700000000000022';
const LID_UNKNOWN = '700000000000023';
const PHONE_A = '5491177720001';
const PHONE_B = '5491177720002';
const PHONE_C = '5491177720003';
const fmt = (d: string) => `+${d}`;

describe('menciones sin resolver (puro)', () => {
  it('ocultas: los lids de la lista guardada; sin lista, los "@<dígitos>" con forma de lid', () => {
    expect(hiddenMentions({ body: `@${LID_UNKNOWN} y @${PHONE_A}`, mentions: [`${LID_UNKNOWN}@lid`, PHONE_A] })).toEqual([LID_UNKNOWN]);
    // Con lista guardada, un número largo que la lista no trae es texto escrito a mano.
    expect(hiddenMentions({ body: `@${LID_UNKNOWN} pedido @900000000000031`, mentions: [`${LID_UNKNOWN}@lid`] })).toEqual([LID_UNKNOWN]);
    // Sin lista (mensaje viejo, vista previa): solo lo que tiene forma de lid; "@12345" y un teléfono quedan.
    expect(hiddenMentions({ body: `@${LID_UNKNOWN} mirá el pedido @12345 de @${PHONE_A}` })).toEqual([LID_UNKNOWN]);
    expect(hiddenMentions({ body: 'sin menciones', mentions: [] })).toEqual([]);
  });

  it('etiqueta: nombre, teléfono o "alguien"; nunca los dígitos del lid', () => {
    expect(mentionLabel({ name: 'Beto Ejemplo', phone: PHONE_B }, fmt, 'alguien')).toBe('Beto Ejemplo');
    expect(mentionLabel({ name: '', phone: PHONE_B }, fmt, 'alguien')).toBe(`+${PHONE_B}`);
    expect(mentionLabel({ name: '', phone: '' }, fmt, 'alguien')).toBe('alguien');
    expect(mentionLabel(undefined, fmt, 'alguien')).toBe('');
    expect(mentionSomeone('es-AR')).toBe('alguien');
    expect(mentionSomeone('pt')).toBe('alguém');
    expect(mentionSomeone(null)).toBe('someone');
  });

  it('etiquetas de un mensaje: participantes por teléfono, lo del servidor y "alguien"', () => {
    const base = { [PHONE_A]: 'Ana Ejemplo' };
    const labels = mentionLabels(
      base,
      { [LID_KNOWN]: { name: 'Beto Ejemplo', phone: PHONE_B }, [LID_PHONE_ONLY]: { name: '', phone: PHONE_A }, [PHONE_C]: { name: '', phone: PHONE_C }, [LID_UNKNOWN]: { name: '', phone: '' } },
      fmt,
      'alguien',
    );
    // El lid del que solo se sabe el teléfono toma el nombre del participante con ese teléfono.
    expect(labels).toEqual({ [PHONE_A]: 'Ana Ejemplo', [LID_KNOWN]: 'Beto Ejemplo', [LID_PHONE_ONLY]: 'Ana Ejemplo', [PHONE_C]: `+${PHONE_C}`, [LID_UNKNOWN]: 'alguien' });
    const text = `Hola @${LID_UNKNOWN} Sí, quedó. @${LID_KNOWN} y @${PHONE_C}, ver pedido @12345`;
    expect(replaceMentions(text, labels)).toBe(`Hola @alguien Sí, quedó. @Beto Ejemplo y @+${PHONE_C}, ver pedido @12345`);
    // Un teléfono enmascarado no identifica a ningún participante.
    expect(mentionLabels({ '54 ••• 01': 'Otra Persona' }, { [LID_PHONE_ONLY]: { name: '', phone: '54 ••• 01' } }, fmt, 'alguien')[LID_PHONE_ONLY]).toBe('+54 ••• 01');
    expect(mentionLabels(base, undefined, fmt, 'alguien')).toBe(base);
  });

  it('una mención sin resolver solo vale para el mensaje que la trae como mención', () => {
    const map = { [LID_UNKNOWN]: { name: '', phone: '' }, [LID_KNOWN]: { name: 'Beto Ejemplo', phone: PHONE_B } };
    expect(ownMentions(map, { body: `@${LID_UNKNOWN} hola`, mentions: [`${LID_UNKNOWN}@lid`] })).toEqual({ [LID_UNKNOWN]: { name: '', phone: '' } });
    // Otro mensaje de la misma página lo escribió a mano (su lista guardada no lo trae): queda como texto.
    expect(ownMentions(map, { body: `código @${LID_UNKNOWN} para @${LID_KNOWN}`, mentions: [`${LID_KNOWN}@lid`] })).toEqual({ [LID_KNOWN]: { name: 'Beto Ejemplo', phone: PHONE_B } });
  });
});

describe('textos que arma el servidor', () => {
  async function scope(label: string): Promise<ContactScope> {
    const u = await makeUser(label);
    return { app: 'lines', accountId: `num-${label}-${Math.random().toString(36).slice(2, 8)}`, userId: u.id };
  }

  it('"@Nombre", "@+teléfono" o "@alguien"; lo escrito a mano queda', async () => {
    const s = await scope('wmn1');
    await rememberContacts(s, [{ phone: PHONE_B, lid: LID_KNOWN, push: 'Beto Ejemplo' }, { phone: PHONE_A, lid: LID_PHONE_ONLY }]);
    const text = `@${LID_KNOWN} @${LID_PHONE_ONLY} @${LID_UNKNOWN} @${PHONE_C} pedido @12345`;
    const mentions = [`${LID_KNOWN}@lid`, `${LID_PHONE_ONLY}@lid`, `${LID_UNKNOWN}@lid`, PHONE_C];
    const [withList, textOnly, untouched] = await resolveTextMentions(
      'lines',
      [
        { accountId: s.accountId, text, mentions },
        { accountId: s.accountId, text },
        { accountId: s.accountId, text: `ver @${LID_UNKNOWN}`, mentions: [PHONE_C] },
      ],
      { someone: 'alguien' },
    );
    expect(withList).toBe(`@Beto Ejemplo @+${PHONE_A} @alguien @+${PHONE_C} pedido @12345`);
    // Sin la lista guardada no se sabe que el teléfono suelto es una mención: queda; el lid, no.
    expect(textOnly).toBe(`@Beto Ejemplo @+${PHONE_A} @alguien @${PHONE_C} pedido @12345`);
    // La lista guardada no trae ese número: alguien lo escribió, queda como está.
    expect(untouched).toBe(`ver @${LID_UNKNOWN}`);
    // Sin "alguien" (quien llama no lo pidió) el texto no cambia donde no se sabe nada.
    expect(await resolveTextMentions('lines', [{ accountId: s.accountId, text: `@${LID_UNKNOWN} hola` }])).toEqual([`@${LID_UNKNOWN} hola`]);
  });

  it('Lines: teléfonos ocultos y textos que salen del producto', async () => {
    const s = await scope('wmn2');
    await rememberContacts(s, [{ phone: PHONE_A, lid: LID_PHONE_ONLY }]);
    const item = { numberId: s.accountId, text: `@${LID_PHONE_ONLY} y @${LID_UNKNOWN}`, mentions: [`${LID_PHONE_ONLY}@lid`, `${LID_UNKNOWN}@lid`] };
    expect(await linesMentionTexts(s.userId, [item])).toEqual([`@+${PHONE_A} y @someone`]);
    // A quien se le ocultan los teléfonos: enmascarado.
    expect(await linesMentionTexts(s.userId, [item], { mask: true })).toEqual(['@+54 ••• 01 y @someone']);
    // Título de ticket, tarea, nota en otra herramienta: el teléfono que el texto no traía no aparece.
    expect(await linesMentionTexts(s.userId, [item], { shared: true })).toEqual(['@someone y @someone']);
    expect(await linesRowTexts(s.userId, [{ body: `@${PHONE_C} ok`, meta: JSON.stringify({ mentions: [PHONE_C] }), number_id: s.accountId }], { shared: true })).toEqual([`@+${PHONE_C} ok`]);
  });
});

function msg(over: Partial<Extract<InboundEvent, { type: 'message' }>>): InboundEvent {
  return {
    type: 'message',
    chatId: `${PHONE_A}@s.whatsapp.net`,
    isGroup: false,
    fromMe: false,
    senderPhone: PHONE_A,
    senderName: 'Ana Ejemplo',
    providerMessageId: `m-${Math.random().toString(36).slice(2)}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  } as InboundEvent;
}

describe('Lines: menciones en la conversación, la lista, los fijados y el grupo', () => {
  async function line(label: string) {
    const user = await makeUser(label);
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (s) s.connectedAt = Date.now() - 5000;
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
    return { user, row: (await getNumberRowById(n.id))! };
  }

  it('un lid que nadie conoce es "alguien"; el de un participante toma su nombre; el de la línea, el nombre de la línea', async () => {
    const { user, row } = await line('wmnl1');
    const gid = '120363000000000701@g.us';
    await getDb().prepare("UPDATE groups_numbers SET name = 'Ventas', phone = ? WHERE id = ?").run(PHONE_C, row.id);
    // B escribe con su teléfono y su nombre: queda como miembro. La libreta sabe el lid de B, pero sin nombre.
    await ingestEvents(row, [msg({ chatId: gid, isGroup: true, chatName: 'Obra', senderPhone: PHONE_B, senderName: 'Beto Ejemplo', body: 'buenas' })]);
    await getDb().prepare("UPDATE wa_contacts SET push_name = '', saved_name = '' WHERE account_id = ? AND phone = ?").run(row.id, PHONE_B);
    await rememberContacts({ app: 'lines', accountId: row.id, userId: user.id }, [{ phone: PHONE_B, lid: LID_KNOWN }, { phone: PHONE_C, lid: LID_PHONE_ONLY }]);
    const body = `Hola @${LID_UNKNOWN} Sí, quedó. @${LID_KNOWN} avisale a @${LID_PHONE_ONLY}, pedido @12345`;
    await ingestEvents(row, [msg({ chatId: gid, isGroup: true, body, mentions: [`${LID_UNKNOWN}@lid`, `${LID_KNOWN}@lid`, `${LID_PHONE_ONLY}@lid`] })]);
    const chat = (await listChats(user.id, user.id, { kind: 'group' })).rows.find((c) => c.name === 'Obra')!;
    const m = (await listMessages(user.id, chat.id)).find((x) => x.body === body)!;
    expect(m.mentionNames).toEqual({
      [LID_UNKNOWN]: { name: '', phone: '' },
      [LID_KNOWN]: { name: 'Beto Ejemplo', phone: PHONE_B },
      [LID_PHONE_ONLY]: { name: 'Ventas', phone: PHONE_C },
    });
    // Lo que muestra la página del grupo y la conversación: sin ningún lid a la vista.
    const shown = replaceMentions(m.body, mentionLabels({}, m.mentionNames, fmt, 'alguien'));
    expect(shown).toBe('Hola @alguien Sí, quedó. @Beto Ejemplo avisale a @Ventas, pedido @12345');
    // La lista de chats (solo tiene el texto de la vista previa) tampoco muestra el lid.
    expect(chat.lastMessagePreview.startsWith('Hola @someone Sí, quedó.')).toBe(true);
    expect((await getChat(user.id, chat.id))!.lastMessagePreview).not.toContain(LID_UNKNOWN);
    // Fijados: llevan las mismas menciones resueltas.
    await getDb().prepare('UPDATE groups_messages SET pinned_at = ? WHERE id = ?').run(new Date().toISOString(), m.id);
    expect((await listPinned(user.id, chat.id))[0].mentionNames).toEqual(m.mentionNames);
    // A quien se le ocultan los teléfonos, el de la persona mencionada va enmascarado.
    const masked = maskMessage({ mask: true } as GroupsViewer, m);
    expect(masked.mentionNames![LID_KNOWN]).toEqual({ name: 'Beto Ejemplo', phone: '54 ••• 02' });
    expect(masked.mentionNames![LID_UNKNOWN]).toEqual({ name: '', phone: '' });
  });

  it('sincronizar los miembros de un grupo guarda el lid de cada uno: la mención "@<lid>" deja de ser "alguien"', async () => {
    const { user, row } = await line('wmnl2');
    const gid = '120363000000000702@g.us';
    await ingestEvents(row, [msg({ chatId: gid, isGroup: true, chatName: 'Equipo', senderPhone: PHONE_A, body: `@${LID_KNOWN} ¿venís?`, mentions: [`${LID_KNOWN}@lid`] })]);
    const chat = (await listChats(user.id, user.id, { kind: 'group' })).rows.find((c) => c.name === 'Equipo')!;
    expect((await mentionTargets({ app: 'lines', accountId: row.id }, [{ body: `@${LID_KNOWN}`, mentions: [`${LID_KNOWN}@lid`] }]))[LID_KNOWN]).toEqual({ name: '', phone: '' });
    await syncMembers(user.id, chat.id).catch(() => null);
    const g = fakeGroupState(row.id, gid)!;
    g.participants.push({ phone: PHONE_B, role: 'member', name: 'Beto Ejemplo', lid: LID_KNOWN });
    await syncMembers(user.id, chat.id);
    const m = (await listMessages(user.id, chat.id)).find((x) => x.body.startsWith('@'))!;
    expect(m.mentionNames).toEqual({ [LID_KNOWN]: { name: 'Beto Ejemplo', phone: PHONE_B } });
  });

  it('Evolution: los participantes traen su lid además del teléfono', async () => {
    const fetch = async (input: string | URL | Request) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const out = url.pathname.startsWith('/group/participants/')
        ? {
            participants: [
              { id: `${LID_KNOWN}@lid`, phoneNumber: `${PHONE_B}@s.whatsapp.net`, admin: 'admin' },
              { id: `${PHONE_A}@s.whatsapp.net`, lid: `${LID_PHONE_ONLY}@lid`, admin: null },
              { id: `${LID_UNKNOWN}@lid`, admin: null },
            ],
          }
        : {};
      return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const p = evolutionProvider({ baseUrl: 'https://evo.example.test', apiKey: 'k', session: 'inst' }, { fetch });
    expect(await p.participants('120363000000000703@g.us')).toEqual([
      { phone: PHONE_B, role: 'admin', name: undefined, lid: LID_KNOWN },
      { phone: PHONE_A, role: 'member', name: undefined, lid: LID_PHONE_ONLY },
    ]);
  });
});

describe('Inbox: menciones sin resolver y citas', () => {
  it('"alguien" en la conversación y en la vista previa; la cita lleva sus menciones', async () => {
    const u = await makeUser('wmni1');
    const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = '15550000001' WHERE id = ?").run(a.id);
    const acc = (await getAccountById(a.id))!;
    const gid = '120363000000000704@g.us';
    await rememberContacts({ app: 'inbox', accountId: acc.id, userId: u.id }, [{ phone: PHONE_B, lid: LID_KNOWN, push: 'Beto Ejemplo' }]);
    const body = `@${LID_UNKNOWN} y @${LID_KNOWN}: pedido @12345`;
    await ingestWhatsappEvents(acc, [
      msg({ chatId: gid, isGroup: true, chatName: 'Asado', providerMessageId: 'q-1', body, mentions: [`${LID_UNKNOWN}@lid`, `${LID_KNOWN}@lid`] }),
    ]);
    const group = (await findThread(acc.id, gid))!;
    const page = await listInboxMessages(u.id, group.id);
    const m = page.messages.find((x) => x.body === body)!;
    expect(m.mentionNames).toEqual({ [LID_UNKNOWN]: { name: '', phone: '' }, [LID_KNOWN]: { name: 'Beto Ejemplo', phone: PHONE_B } });
    expect(replaceMentions(m.body, mentionLabels({}, m.mentionNames, fmt, 'alguien'))).toBe('@alguien y @Beto Ejemplo: pedido @12345');
    expect((await getThread(u.id, group.id)).preview).toBe('@someone y @Beto Ejemplo: pedido @12345');
  });
});
