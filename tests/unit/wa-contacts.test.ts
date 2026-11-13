/**
 * Nombres de WhatsApp en Inbox y Lines: la libreta de contactos por cuenta
 * (teléfono, lid, nombre), los chats y miembros que dejan de mostrar el
 * número, las menciones "@<lid>" o "@<teléfono>" con el nombre y el repaso
 * diario que trae los cambios. Números y nombres inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { mentionCandidates, mentionDigits, mentionLabel, replaceMentions, splitMentions } from '@/lib/wa-mentions';
import { lookupContacts, mentionTargets, mergeInputs, rememberContacts, resolveTextMentions, type ContactScope } from '@/lib/wa-contacts';
import { evolutionContactEvents, evolutionMessageEvents, mentionIds } from '@/lib/groups-provider-bridge';
import { createAccount, findThread, getAccountById, getThread, listMessages as listInboxMessages, listThreads, upsertThread } from '@/lib/inbox/core';
import { ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { groupParticipants } from '@/lib/inbox/wa-meta';
import { connectNumber, createNumber, getChatRow, getNumberRowById, ingestEvents, listChats, listMembers, listMessages as listLinesMessages } from '@/lib/groups';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { pictureKey, refreshInboxDaily, refreshLinesDaily } from '@/lib/wa-contacts-refresh';
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

const LID = '118571178918100';

describe('menciones (puro)', () => {
  it('saca los "@<dígitos>" del texto, sin mails ni números cortos', () => {
    expect(mentionDigits(`Hola @${LID} y @5491155550000, escribí a ana@x.com o @123`)).toEqual([LID, '5491155550000']);
    expect(mentionDigits('sin menciones')).toEqual([]);
  });

  it('candidatos: los guardados (también "<lid>@lid") y los del texto', () => {
    expect(mentionCandidates([{ body: `hola @${LID}`, mentions: [`${LID}@lid`, '5491155550000'] }, { body: '@5491166660000 ok' }])).toEqual([LID, '5491155550000', '5491166660000']);
  });

  it('parte el texto en texto y menciones conocidas; las desconocidas quedan como texto', () => {
    const parts = splitMentions(`Avisale a @${LID} y a @5491166660000.`, { [LID]: 'Ana Ejemplo' });
    expect(parts).toEqual(['Avisale a ', { mention: LID, label: 'Ana Ejemplo' }, ' y a @5491166660000.']);
    expect(replaceMentions(`@${LID}: listo`, new Map([[LID, 'Ana Ejemplo']]))).toBe('@Ana Ejemplo: listo');
    expect(splitMentions('hola', {})).toEqual(['hola']);
  });

  it('etiqueta: el nombre o, si no, el teléfono con formato', () => {
    const fmt = (d: string) => `+${d}`;
    expect(mentionLabel({ name: 'Beto', phone: '5491155550000' }, fmt)).toBe('Beto');
    expect(mentionLabel({ name: '', phone: '5491155550000' }, fmt)).toBe('+5491155550000');
    expect(mentionLabel({ name: '', phone: '' }, fmt)).toBe('');
    expect(mentionLabel(undefined, fmt)).toBe('');
  });
});

describe('Evolution: lids y menciones', () => {
  it('un mensaje de grupo con lid trae quién manda (teléfono y lid) y a quién menciona', () => {
    const [e] = evolutionMessageEvents({
      key: { remoteJid: '120363000000000077@g.us', id: 'M1', fromMe: false, participant: '200000000000001@lid', participantAlt: '5491177770001@s.whatsapp.net' },
      pushName: 'Carla Ejemplo',
      message: { extendedTextMessage: { text: `Hola @${LID}`, contextInfo: { mentionedJid: [`${LID}@lid`, '5491177770002@s.whatsapp.net'] } } },
      messageTimestamp: 1_760_000_000,
    });
    expect(e.type).toBe('message');
    if (e.type !== 'message') return;
    expect(e.senderPhone).toBe('5491177770001');
    expect(e.senderLid).toBe('200000000000001');
    expect(e.mentions).toEqual([`${LID}@lid`, '5491177770002']);
  });

  it('mentionedJid en el contextInfo de afuera (Evolution convierte el texto en conversation)', () => {
    const [e] = evolutionMessageEvents({
      key: { remoteJid: '120363000000000077@g.us', id: 'M2', fromMe: false, participant: '5491177770001@s.whatsapp.net' },
      message: { conversation: `@${LID} hola` },
      contextInfo: { mentionedJid: [`${LID}@lid`] },
    });
    expect(e.type === 'message' && e.mentions).toEqual([`${LID}@lid`]);
    expect(mentionIds(['x', '', 'abc@lid', '5491100000000@s.whatsapp.net', '5491100000000@s.whatsapp.net'])).toEqual(['5491100000000']);
  });

  it('contactos: un lid con su teléfono aparte, y uno con teléfono y su lid', () => {
    const ev = evolutionContactEvents([
      { remoteJid: `${LID}@lid`, pushName: 'Ana Ejemplo', phoneNumber: '5491155550000@s.whatsapp.net' },
      { remoteJid: '5491166660000@s.whatsapp.net', pushName: 'Beto Ejemplo', lid: '300000000000003@lid' },
      { remoteJid: '400000000000004@lid', pushName: '', phoneNumber: '5491188880000@s.whatsapp.net' },
      { remoteJid: '500000000000005@lid' },
    ]);
    expect(ev).toEqual([
      { type: 'contact', chatId: `${LID}@lid`, name: 'Ana Ejemplo', lid: LID, phone: '5491155550000' },
      { type: 'contact', chatId: '5491166660000@s.whatsapp.net', name: 'Beto Ejemplo', lid: '300000000000003', phone: '5491166660000' },
      { type: 'contact', chatId: '400000000000004@lid', lid: '400000000000004', phone: '5491188880000' },
    ]);
  });
});

describe('libreta de contactos', () => {
  async function scope(label: string): Promise<ContactScope> {
    const u = await makeUser(label);
    return { app: 'inbox', accountId: `acc-${label}-${Math.random().toString(36).slice(2, 8)}`, userId: u.id };
  }

  it('junta lid y teléfono de la misma persona y avisa cuando cambia el nombre', async () => {
    const s = await scope('wac1');
    expect(await rememberContacts(s, [{ lid: LID, push: 'Ana' }])).toEqual([{ phone: '', lid: LID, before: '', after: 'Ana' }]);
    await rememberContacts(s, [{ phone: '5491155550000', push: 'Ana' }]);
    // Llega la equivalencia: las dos filas quedan en una.
    await rememberContacts(s, [{ phone: '5491155550000', lid: LID }]);
    const rows = (await getDb().prepare('SELECT phone, lid, push_name FROM wa_contacts WHERE account_id = ?').all(s.accountId)) as Array<{ phone: string; lid: string; push_name: string }>;
    expect(rows).toEqual([{ phone: '5491155550000', lid: LID, push_name: 'Ana' }]);
    const found = await lookupContacts(s, [LID, '5491155550000']);
    expect(found.get(LID)?.phone).toBe('5491155550000');
    // El nombre de la libreta gana al de perfil; un vacío no borra nada.
    expect(await rememberContacts(s, [{ phone: '5491155550000', saved: 'Ana Ejemplo' }])).toEqual([{ phone: '5491155550000', lid: LID, before: 'Ana', after: 'Ana Ejemplo' }]);
    expect(await rememberContacts(s, [{ phone: '5491155550000', push: '' }])).toEqual([]);
    // Un "nombre" que es un número no nombra a nadie.
    expect(mergeInputs([{ phone: '5491100000000', push: '+54 9 11 0000-0000' }])).toEqual([{ phone: '5491100000000' }]);
  });

  it('textos cortos (vista previa, avisos, búsqueda): "@<lid>" y "@<teléfono>" con el nombre de la libreta de cada cuenta', async () => {
    const s = await scope('wac3');
    const other = await scope('wac4');
    await rememberContacts(s, [{ phone: '5491155550000', lid: LID }, { phone: '5491166660000', push: 'Beto Ejemplo' }]);
    await rememberContacts(other, [{ lid: LID, push: 'Otra Cuenta' }]);
    const out = await resolveTextMentions('inbox', [
      { accountId: s.accountId, text: `Eva: @${LID} y @5491166660000 vengan` },
      { accountId: other.accountId, text: `@${LID} hola` },
      { accountId: s.accountId, text: 'sin menciones' },
      { accountId: '', text: `@${LID} sin cuenta` },
    ]);
    expect(out).toEqual(['Eva: @+5491155550000 y @Beto Ejemplo vengan', '@Otra Cuenta hola', 'sin menciones', `@${LID} sin cuenta`]);
  });

  it('menciones: lid con nombre, teléfono mencionado sin nombre y lid desconocido', async () => {
    const s = await scope('wac2');
    await rememberContacts(s, [{ phone: '5491155550000', lid: LID, push: 'Ana Ejemplo' }]);
    const map = await mentionTargets(s, [{ body: `@${LID} y @5491199990000 y @900000000000009`, mentions: [`${LID}@lid`, '5491199990000', '900000000000009@lid'] }]);
    // El lid que nadie conoce queda como mención sin nombre ni teléfono: se muestra "@alguien", nunca sus dígitos.
    expect(map).toEqual({
      [LID]: { name: 'Ana Ejemplo', phone: '5491155550000' },
      '5491199990000': { name: '', phone: '5491199990000' },
      '900000000000009': { name: '', phone: '' },
    });
  });
});

const PHONE_A = '5491177710001';
const PHONE_B = '5491177710002';
const LID_B = '700000000000007';

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

describe('Inbox: nombres en lugar de números', () => {
  async function account(label: string) {
    const u = await makeUser(label);
    const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = '15550000001' WHERE id = ?").run(a.id);
    const g = (globalThis as unknown as { __groupsFake?: Map<string, { connectedAt: number | null }> }).__groupsFake;
    return { u, account: (await getAccountById(a.id))!, fake: () => g?.get(`inbox-${a.id}`) };
  }

  it('el chat que abrí yo toma el nombre de la libreta; participantes y menciones con nombre', async () => {
    const { u, account: acc } = await account('wacib1');
    const gid = '120363000000000501@g.us';
    // B escribe en un grupo con su lid y su teléfono: la libreta lo aprende.
    await ingestWhatsappEvents(acc, [msg({ chatId: gid, isGroup: true, chatName: 'Asado', senderPhone: PHONE_B, senderLid: LID_B, senderName: 'Beto Ejemplo', body: 'llego tarde' })]);
    // Un chat 1:1 con B que abrí yo (sin nombre): sale con el nombre.
    const dm = await upsertThread(acc, { externalId: `${PHONE_B}@s.whatsapp.net`, kind: 'dm', handle: PHONE_B });
    await ingestWhatsappEvents(acc, [msg({ chatId: `${PHONE_B}@s.whatsapp.net`, fromMe: true, senderPhone: '', senderName: '', body: 'hola' })]);
    expect((await findThread(acc.id, dm.external_id))!.title).toBe('Beto Ejemplo');
    // A menciona a B por su lid.
    await ingestWhatsappEvents(acc, [msg({ chatId: gid, isGroup: true, senderPhone: PHONE_A, body: `@${LID_B} traé hielo`, mentions: [`${LID_B}@lid`] })]);
    const group = (await findThread(acc.id, gid))!;
    const page = await listInboxMessages(u.id, group.id);
    const m = page.messages.find((x) => x.body.startsWith('@'))!;
    expect(m.meta?.mentions).toEqual([`${LID_B}@lid`]);
    expect(m.mentionNames).toEqual({ [LID_B]: { name: 'Beto Ejemplo', phone: PHONE_B } });
    // La fila de la lista tampoco muestra el lid.
    expect((await getThread(u.id, group.id)).preview).toBe('@Beto Ejemplo traé hielo');
    expect((await listThreads(u.id, { view: 'groups' })).find((t) => t.id === group.id)?.preview).toBe('@Beto Ejemplo traé hielo');
    // Participante que nunca escribió en el grupo y no tiene chat 1:1: el nombre sale de la libreta.
    await rememberContacts({ app: 'inbox', accountId: acc.id, userId: u.id }, [{ phone: '5491177710003', push: 'Carla Ejemplo' }]);
    await getDb()
      .prepare('UPDATE inbox_threads SET info = ? WHERE id = ?')
      .run(JSON.stringify({ participants: [{ phone: PHONE_A, role: 'member' }, { phone: '5491177710003', role: 'member' }] }), group.id);
    const parts = await groupParticipants(u.id, (await findThread(acc.id, gid))!, '15550000001');
    expect(Object.fromEntries(parts.map((p) => [p.phone, p.name]))).toEqual({ [PHONE_A]: 'Ana Ejemplo', '5491177710003': 'Carla Ejemplo' });
  });

  it('repaso diario: el contacto que se cambió el nombre en WhatsApp; un nombre puesto a mano queda', async () => {
    const { account: acc, fake } = await account('wacib2');
    await ingestWhatsappEvents(acc, [msg({ senderName: 'Ana Ejemplo' }), msg({ chatId: `${PHONE_B}@s.whatsapp.net`, senderPhone: PHONE_B, senderName: 'Beto Ejemplo' })]);
    await getDb().prepare("UPDATE inbox_threads SET title = 'Mi Beto' WHERE account_id = ? AND handle = ?").run(acc.id, PHONE_B);
    // En el teléfono cambian los dos nombres (la app no se entera hasta el repaso).
    const provider = (await import('@/lib/inbox/whatsapp')).waProviderFor(acc);
    provider.parseWebhook({ events: [{ type: 'fake_contacts', contacts: [{ phone: PHONE_A, name: 'Ana Renombrada', about: 'De viaje' }, { phone: PHONE_B, name: 'Beto Renombrado' }] }] });
    expect(fake()).toBeTruthy();
    await getDb()
      .prepare("INSERT OR REPLACE INTO wa_contact_sync (app, account_id, user_id, phase, cursor, updated_at) VALUES ('inbox', ?, ?, 'contacts', '', ?)")
      .run(acc.id, acc.owner_id, new Date().toISOString());
    await refreshInboxDaily(new Date(), Date.now() + 15_000, 0, [acc.id]);
    expect((await findThread(acc.id, `${PHONE_A}@s.whatsapp.net`))!.title).toBe('Ana Renombrada');
    expect((await findThread(acc.id, `${PHONE_B}@s.whatsapp.net`))!.title).toBe('Mi Beto');
    const sync = (await getDb().prepare("SELECT phase, finished_at FROM wa_contact_sync WHERE app = 'inbox' AND account_id = ?").get(acc.id)) as { phase: string; finished_at: string | null };
    expect(sync.phase).toBe('idle');
    expect(sync.finished_at).toBeTruthy();
    // La "info" del contacto también quedó al día (chatInfo).
    const row = (await getDb().prepare('SELECT about FROM wa_contacts WHERE account_id = ? AND phone = ?').get(acc.id, PHONE_A)) as { about: string };
    expect(row.about).toBe('De viaje');
    // Hecho hoy: la próxima corrida no lo repite.
    await getDb().prepare("UPDATE inbox_threads SET title = 'otra cosa' WHERE account_id = ? AND handle = ?").run(acc.id, PHONE_A);
    await refreshInboxDaily(new Date(), Date.now() + 5_000, 0, [acc.id]);
    expect((await findThread(acc.id, `${PHONE_A}@s.whatsapp.net`))!.title).toBe('otra cosa');
  });
});

describe('Lines: nombres en lugar de números', () => {
  async function line(label: string) {
    const user = await makeUser(label);
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (s) s.connectedAt = Date.now() - 5000;
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
    return { user, row: (await getNumberRowById(n.id))! };
  }

  it('el lid de quien escribe se resuelve al teléfono; miembros y menciones con nombre', async () => {
    const { user, row } = await line('waclb1');
    const gid = '120363000000000601@g.us';
    // Primero llega la equivalencia lid ↔ teléfono (contactos del servidor).
    await ingestEvents(row, [{ type: 'contact', chatId: `${LID_B}@lid`, name: 'Beto Ejemplo', lid: LID_B, phone: PHONE_B }]);
    // B escribe solo con su lid: queda con su teléfono y como miembro con nombre.
    await ingestEvents(row, [msg({ chatId: gid, isGroup: true, chatName: 'Proveedores', senderPhone: '', senderLid: LID_B, senderName: 'Beto Ejemplo', body: 'hola' })]);
    // A lo menciona por el lid.
    await ingestEvents(row, [msg({ chatId: gid, isGroup: true, senderPhone: PHONE_A, senderName: 'Ana Ejemplo', body: `@${LID_B} mirá esto`, mentions: [`${LID_B}@lid`] })]);
    const chat = (await listChats(user.id, user.id, { kind: 'group' })).rows.find((c) => c.name === 'Proveedores')!;
    const msgs = await listLinesMessages(user.id, chat.id);
    expect(msgs.find((m) => m.body === 'hola')!.senderPhone).toBe(PHONE_B);
    expect(msgs.find((m) => m.body.startsWith('@'))!.mentionNames).toEqual({ [LID_B]: { name: 'Beto Ejemplo', phone: PHONE_B } });
    // La fila de la lista: "@Nombre", nunca el lid.
    expect(chat.lastMessagePreview).toBe('@Beto Ejemplo mirá esto');
    const members = await listMembers(user.id, chat.id);
    expect(members.find((m) => m.phone === PHONE_B)?.name).toBe('Beto Ejemplo');
  });

  it('repaso diario: el chat 1:1 renombrado, la info del contacto y el asunto del grupo', async () => {
    const { user, row } = await line('waclb2');
    await ingestEvents(row, [msg({ senderName: 'Ana Ejemplo' })]);
    const gid = '120363000000000000@g.us';
    const { fakeProvider } = await import('@/lib/groups-provider-fake');
    const p = fakeProvider(row.id);
    p.parseWebhook({ events: [{ type: 'fake_contacts', contacts: [{ phone: PHONE_A, name: 'Ana Renombrada', about: 'En reunión', groups: [gid] }, { lid: LID_B, name: 'Beto Lid', groups: [gid] }] }] });
    await p.updateGroup(gid, { name: 'Grupo Nuevo', description: 'Descripción nueva' });
    await ingestEvents(row, [msg({ chatId: gid, isGroup: true, chatName: 'Grupo Viejo', senderPhone: PHONE_A, body: 'hola grupo' })]);
    await getDb()
      .prepare("INSERT OR REPLACE INTO wa_contact_sync (app, account_id, user_id, phase, cursor, updated_at) VALUES ('lines', ?, ?, 'contacts', '', ?)")
      .run(row.id, user.id, new Date().toISOString());
    await refreshLinesDaily(new Date(), Date.now() + 15_000, 0, [row.id]);
    const chats = (await listChats(user.id, user.id, {})).rows;
    const dm = chats.find((c) => c.phone === PHONE_A)!;
    expect(dm.name).toBe('Ana Renombrada');
    const group = (await getChatRow(user.id, chats.find((c) => c.kind === 'group')!.id))!;
    expect(group.name).toBe('Grupo Nuevo');
    expect(group.description).toBe('Descripción nueva');
    const { getChat } = await import('@/lib/groups');
    expect((await getChat(user.id, dm.id))!.about).toBe('En reunión');
    // El lid suelto del grupo queda en la libreta: nombra la mención "@<lid>".
    const map = await mentionTargets({ app: 'lines', accountId: row.id }, [{ body: `@${LID_B}` }]);
    expect(map[LID_B]?.name).toBe('Beto Lid');
  });

  it('la clave de la foto ignora la firma que vence', () => {
    expect(pictureKey('https://pps.whatsapp.net/v/t61/abc.jpg?oh=1&oe=2')).toBe(pictureKey('https://pps.whatsapp.net/v/t61/abc.jpg?oh=3&oe=4'));
    expect(pictureKey('no es url')).toBe('');
  });
});
