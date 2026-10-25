import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { type FetchLike } from '@/lib/groups-provider';
import { parseCloudCall, parseCloudWebhook } from '@/lib/groups-provider-cloud';
import { evolutionProvider, parseEvolutionWebhook, parseWahaWebhook, wahaProvider } from '@/lib/groups-provider-bridge';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { EDIT_WINDOW_MS, formatDuration, messageActions, nextInRotation, ruleMatches } from '@/lib/groups-inbox-rules';
import { connectNumber, createLabel, createNumber, getNumberRowById, ingestEvents, listChats, listMessages, sendMessage, updateChat } from '@/lib/groups';
import {
  autoAssignChat,
  bulkChats,
  createRule,
  createTeam,
  deleteMessage,
  editMessage,
  forwardMessage,
  listPinned,
  pinMessage,
  setAvailability,
  sweepAutoAssign,
} from '@/lib/groups-inbox';
import { draftReply, translateMessages, translateText } from '@/lib/groups-ai';
import { describeItem } from '@/lib/track-notify';
import { notificationTitle } from '@/lib/notification-text';
import { makeUser } from './helpers';

function mockFetch(handler: (url: string) => unknown) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const f: FetchLike = async (url, init = {}) => {
    calls.push({ url, method: String(init.method ?? 'GET'), body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(handler(url) ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { f, calls };
}

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

async function setup(label: string) {
  const user = await makeUser(label);
  const n = await createNumber(user.id, user.id, { provider: 'fake' });
  await connectNumber(user.id, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return { user, row: (await getNumberRowById(n.id))! };
}

const inbound = (chatId: string, id: string, body: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  fromMe: false,
  senderPhone: '5491155550000',
  senderName: 'Ana',
  providerMessageId: id,
  body,
});

/** Persona extra en el workspace (miembro de un team del dueño). */
async function addTeammate(ownerId: string, label: string) {
  const mate = await makeUser(label);
  const db = getDb();
  const team = (await db.prepare('SELECT id FROM teams WHERE owner_id = ?').get(ownerId)) as { id: string } | undefined;
  const teamId = team?.id ?? crypto.randomUUID();
  if (!team) await db.prepare('INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)').run(teamId, 'T', ownerId);
  await db.prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')").run(teamId, mate.id);
  return mate;
}

describe('reglas de la bandeja', () => {
  const base = { authorId: 'me', authorKind: 'person', body: 'hola', media: null, status: 'sent', deletedAt: null };
  const caps = { edit: true, deleteForAll: true };
  it('editar solo lo propio con texto y dentro de los 15 minutos', () => {
    const now = Date.now();
    const fresh = { ...base, direction: 'out' as const, createdAt: new Date(now - 60_000).toISOString() };
    expect(messageActions(fresh, caps, { me: 'me', isAdmin: false }, now)).toEqual({ edit: true, delete: true, pin: true, forward: true });
    const old = { ...fresh, createdAt: new Date(now - EDIT_WINDOW_MS - 1000).toISOString() };
    expect(messageActions(old, caps, { me: 'me', isAdmin: false }, now).edit).toBe(false);
    expect(messageActions(fresh, { edit: false, deleteForAll: false }, { me: 'me', isAdmin: false }, now)).toMatchObject({ edit: false, delete: false });
    const incoming = { ...fresh, direction: 'in' as const };
    expect(messageActions(incoming, caps, { me: 'me', isAdmin: false }, now)).toEqual({ edit: false, delete: false, pin: true, forward: true });
    const failed = { ...fresh, status: 'failed' };
    expect(messageActions(failed, caps, { me: 'me', isAdmin: false }, now)).toMatchObject({ edit: false, delete: false, forward: false });
  });

  it('las notas las edita y borra quien las escribió o un admin', () => {
    const note = { ...base, direction: 'note' as const, createdAt: new Date().toISOString(), authorId: 'ana' };
    expect(messageActions(note, caps, { me: 'bea', isAdmin: false })).toMatchObject({ edit: false, delete: false, pin: true });
    expect(messageActions(note, caps, { me: 'bea', isAdmin: true })).toMatchObject({ edit: true, delete: true });
    expect(messageActions({ ...note, deletedAt: 'x' }, caps, { me: 'ana', isAdmin: false }).edit).toBe(false);
  });

  it('round-robin: sigue después del último y vuelve a empezar', () => {
    expect(nextInRotation(['c', 'a', 'b'], null)).toBe('a');
    expect(nextInRotation(['c', 'a', 'b'], 'a')).toBe('b');
    expect(nextInRotation(['c', 'a', 'b'], 'c')).toBe('a');
    // El último ya no está (ausente): sigue desde donde estaría.
    expect(nextInRotation(['a', 'c'], 'b')).toBe('c');
    expect(nextInRotation([], 'a')).toBeNull();
  });

  it('una regla aplica si cumple todas sus condiciones', () => {
    const chat = { numberId: 'n1', kind: 'dm' as const, labelIds: ['vip'] };
    expect(ruleMatches({ enabled: true, numberId: null, labelId: null, kind: null }, chat)).toBe(true);
    expect(ruleMatches({ enabled: true, numberId: 'n1', labelId: 'vip', kind: 'dm' }, chat)).toBe(true);
    expect(ruleMatches({ enabled: true, numberId: 'n2', labelId: null, kind: null }, chat)).toBe(false);
    expect(ruleMatches({ enabled: true, numberId: null, labelId: 'other', kind: null }, chat)).toBe(false);
    expect(ruleMatches({ enabled: false, numberId: null, labelId: null, kind: null }, chat)).toBe(false);
  });

  it('duración de una llamada', () => {
    expect(formatDuration(187)).toBe('3:07');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(0)).toBe('0:00');
  });
});

describe('proveedores: editar, borrar, fijar, reenviar y llamadas', () => {
  it('WAHA usa sus endpoints de editar, borrar, fijar y reenviar', async () => {
    const { f, calls } = mockFetch(() => ({ id: 'true_fw' }));
    const p = wahaProvider({ baseUrl: 'https://waha.example.com', apiKey: 'k', session: 'acme' }, { fetch: f });
    await p.editMessage('549@c.us', 'true_549@c.us_A', 'nuevo');
    await p.deleteMessage('549@c.us', 'true_549@c.us_A');
    await p.pinMessage('549@c.us', 'true_549@c.us_A', true);
    const fw = await p.forwardMessage('123@g.us', '549@c.us', 'true_549@c.us_A');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'PUT https://waha.example.com/api/acme/chats/549%40c.us/messages/true_549%40c.us_A',
      'DELETE https://waha.example.com/api/acme/chats/549%40c.us/messages/true_549%40c.us_A',
      'POST https://waha.example.com/api/acme/chats/549%40c.us/messages/true_549%40c.us_A/pin',
      'POST https://waha.example.com/api/forwardMessage',
    ]);
    expect(calls[0].body).toEqual({ text: 'nuevo' });
    expect(calls[3].body).toEqual({ session: 'acme', chatId: '123@g.us', messageId: 'true_549@c.us_A' });
    expect(fw.id).toBe('true_fw');
  });

  it('Evolution edita y borra para todos; no fija', async () => {
    const { f, calls } = mockFetch(() => ({}));
    const p = evolutionProvider({ baseUrl: 'https://evo.example.com', apiKey: 'k', session: 'acme' }, { fetch: f });
    await p.editMessage('549@s.whatsapp.net', 'ABC', 'nuevo');
    await p.deleteMessage('549@s.whatsapp.net', 'ABC');
    expect(calls[0]).toMatchObject({ url: 'https://evo.example.com/chat/updateMessage/acme', body: { key: { id: 'ABC', fromMe: true }, text: 'nuevo' } });
    expect(calls[1]).toMatchObject({ method: 'DELETE', url: 'https://evo.example.com/chat/deleteMessageForEveryone/acme', body: { id: 'ABC', fromMe: true } });
    await expect(p.pinMessage('549@s.whatsapp.net', 'ABC', true)).rejects.toThrow('unsupported');
  });

  it('webhooks: ediciones, borrados y llamadas de WAHA y Evolution', () => {
    expect(parseWahaWebhook({ event: 'message.edited', payload: { from: '549@c.us', fromMe: false, body: 'corregido', editedMessageId: 'false_A' } })).toEqual([
      { type: 'edit', chatId: '549@c.us', providerMessageId: 'false_A', body: 'corregido' },
    ]);
    expect(parseWahaWebhook({ event: 'message.revoked', payload: { revokedMessageId: 'false_A', after: { from: '549@c.us' } } })).toEqual([
      { type: 'revoke', chatId: '549@c.us', providerMessageId: 'false_A' },
    ]);
    expect(parseWahaWebhook({ event: 'call.received', payload: { id: 'C1', from: '549@c.us', timestamp: 1760000000 } })[0]).toMatchObject({
      type: 'call',
      callId: 'C1',
      direction: 'in',
      status: 'ringing',
    });
    const evoEdit = parseEvolutionWebhook({
      event: 'MESSAGES_UPSERT',
      data: { key: { remoteJid: '549@s.whatsapp.net', id: 'E2' }, message: { protocolMessage: { type: 'MESSAGE_EDIT', key: { id: 'E1' }, editedMessage: { conversation: 'nuevo' } } } },
    });
    expect(evoEdit).toEqual([{ type: 'edit', chatId: '549@s.whatsapp.net', providerMessageId: 'E1', body: 'nuevo' }]);
    const evoRevoke = parseEvolutionWebhook({
      event: 'MESSAGES_UPSERT',
      data: { key: { remoteJid: '549@s.whatsapp.net', id: 'E3' }, message: { protocolMessage: { type: 0, key: { id: 'E1' } } } },
    });
    expect(evoRevoke).toEqual([{ type: 'revoke', chatId: '549@s.whatsapp.net', providerMessageId: 'E1' }]);
    expect(parseEvolutionWebhook({ event: 'CALL', data: { id: 'K1', from: '549@s.whatsapp.net', status: 'timeout' } })[0]).toMatchObject({
      type: 'call',
      status: 'missed',
    });
  });

  it('Cloud API (Calling API): connect y terminate con duración', () => {
    expect(parseCloudCall({ id: 'wacid.1', from: '5491155550000', to: '1555', event: 'connect', direction: 'USER_INITIATED', timestamp: '1760000000' })).toMatchObject({
      type: 'call',
      chatId: '5491155550000',
      direction: 'in',
      status: 'ringing',
    });
    const body = {
      entry: [
        {
          changes: [
            {
              field: 'calls',
              value: { calls: [{ id: 'wacid.1', from: '5491155550000', to: '1555', event: 'terminate', direction: 'USER_INITIATED', status: ['COMPLETED'], duration: 95 }] },
            },
          ],
        },
      ],
    };
    expect(parseCloudWebhook(body)).toEqual([expect.objectContaining({ type: 'call', status: 'ended', durationSec: 95 })]);
    const missed = parseCloudCall({ id: 'wacid.2', from: '1555', to: '5491155550000', event: 'terminate', direction: 'BUSINESS_INITIATED', status: 'FAILED' });
    expect(missed).toMatchObject({ direction: 'out', chatId: '5491155550000', status: 'missed' });
  });
});

describe('acciones sobre mensajes (proveedor falso)', () => {
  it('edita y borra para todos un mensaje propio; reenvía y fija', async () => {
    const { user, row } = await setup('inbox-actions');
    await ingestEvents(row, [inbound('5491100000001@c.us', 'A-1', 'hola'), inbound('5491100000002@c.us', 'B-1', 'buenas')]);
    const chats = (await listChats(user.id, user.id)).rows;
    const a = chats.find((c) => c.phone === '5491100000001')!;
    const b = chats.find((c) => c.phone === '5491100000002')!;
    const sent = await sendMessage(user.id, user.id, a.id, { body: 'Te mando la factura' });
    const viewer = { me: user.id, isAdmin: true };

    const edited = await editMessage(user.id, viewer, sent.id, 'Te mando la factura de octubre');
    expect(edited.body).toBe('Te mando la factura de octubre');
    expect(edited.editedAt).toBeTruthy();
    expect(fakeSent(row.id).map((s) => s.kind)).toContain('edit');

    const pin = await pinMessage(user.id, user.id, sent.id, true);
    expect(pin.inWhatsApp).toBe(true);
    expect((await listPinned(user.id, a.id)).map((m) => m.id)).toEqual([sent.id]);

    const fw = await forwardMessage(user.id, user.id, sent.id, [b.id]);
    expect(fw).toEqual([{ chatId: b.id, name: expect.any(String), ok: true }]);
    const copy = (await listMessages(user.id, b.id)).find((m) => m.direction === 'out');
    expect(copy).toMatchObject({ forwarded: true, body: 'Te mando la factura de octubre' });

    const del = await deleteMessage(user.id, viewer, sent.id);
    expect(del.removed).toBe(false);
    expect(del.message?.deletedAt).toBeTruthy();
    expect(await listPinned(user.id, a.id)).toEqual([]);
    await expect(editMessage(user.id, viewer, sent.id, 'otra')).rejects.toThrow();
  });

  it('una edición o un borrado que llega por webhook cambia el mensaje', async () => {
    const { user, row } = await setup('inbox-webhook-edit');
    await ingestEvents(row, [inbound('5491100000003@c.us', 'W-1', 'precio 100')]);
    await ingestEvents(row, [{ type: 'edit', chatId: '5491100000003@c.us', providerMessageId: 'W-1', body: 'precio 120' }]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    let msg = (await listMessages(user.id, chat.id))[0];
    expect(msg).toMatchObject({ body: 'precio 120' });
    expect(msg.editedAt).toBeTruthy();
    await ingestEvents(row, [{ type: 'revoke', chatId: '5491100000003@c.us', providerMessageId: 'W-1' }]);
    msg = (await listMessages(user.id, chat.id))[0];
    expect(msg.deletedAt).toBeTruthy();
  });

  it('notas: menciones con aviso, editar avisa solo a los nuevos, borrar la saca', async () => {
    const { user, row } = await setup('inbox-notes');
    const mate = await addTeammate(user.id, 'Bruno');
    const other = await addTeammate(user.id, 'Carla');
    await ingestEvents(row, [inbound('120363000000055555@g.us', 'N-1', 'ayuda')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    const note = await sendMessage(user.id, user.id, chat.id, { body: '@Bruno mirá esto', note: true });
    expect(note.meta.mentions).toEqual([mate.id]);
    const notes = async (id: string) =>
      (await getDb().prepare("SELECT type, href FROM notifications WHERE user_id = ? AND source_type = 'groups_chat'").all(id)) as Array<{ type: string; href: string }>;
    expect(await notes(mate.id)).toEqual([{ type: 'mention', href: `/app/groups/inbox/${chat.id}#m-${note.id}` }]);
    await editMessage(user.id, { me: user.id, isAdmin: false }, note.id, '@Bruno y @Carla miren esto');
    expect(await notes(mate.id)).toHaveLength(1);
    expect(await notes(other.id)).toHaveLength(1);
    // Otra persona (no admin) no puede editar ni borrar la nota.
    await expect(editMessage(user.id, { me: mate.id, isAdmin: false }, note.id, 'x')).rejects.toThrow('forbidden');
    const del = await deleteMessage(user.id, { me: user.id, isAdmin: false }, note.id);
    expect(del.removed).toBe(true);
    expect((await listMessages(user.id, chat.id)).some((m) => m.id === note.id)).toBe(false);
  });
});

describe('avisos de Groups en la bandeja y el email', () => {
  it('se leen en el idioma de la persona', () => {
    const item = (type: string, meta: Record<string, string>) => ({ id: 'x', type, title: 'fallback', body: null, href: null, meta: JSON.stringify(meta), created_at: '' });
    expect(describeItem(item('mention', { actorName: 'Ana', chatName: 'Acme' }), 'es')).toBe('Ana te mencionó en Acme');
    expect(describeItem(item('assigned', { actorName: '', chatName: 'Acme', rule: 'VIP' }), 'en')).toBe('New WhatsApp chat for you: Acme');
    const labels = { someone: 'Someone', groupsMention: '{actor} mentioned you in {title}', groupsAssigned: '{actor} assigned you {title}' } as never;
    expect(notificationTitle({ type: 'assigned', title: 'x', source_type: 'groups_chat', meta: { actorName: 'Bea', chatName: 'Acme' } }, labels)).toBe('Bea assigned you Acme');
  });
});

describe('asignación, historial y acciones en masa', () => {
  it('asignar deja historial y avisa; cerrar y reabrir también quedan', async () => {
    const { user, row } = await setup('inbox-assign');
    const mate = await addTeammate(user.id, 'Dani');
    await ingestEvents(row, [inbound('5491100000004@c.us', 'S-1', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    const team = await createTeam(user.id, { name: 'Soporte', memberIds: [mate.id] });
    await updateChat(user.id, chat.id, { assignedTo: mate.id, assignedTeamId: team.id }, user.id);
    await updateChat(user.id, chat.id, { status: 'closed' }, user.id);
    await updateChat(user.id, chat.id, { status: 'open' }, mate.id);
    const events = (await listMessages(user.id, chat.id)).filter((m) => m.direction === 'system').map((m) => m.meta.event);
    expect(events).toEqual(['assigned', 'team', 'closed', 'reopened']);
    const n = (await getDb().prepare("SELECT type FROM notifications WHERE user_id = ? AND source_type = 'groups_chat'").all(mate.id)) as Array<{ type: string }>;
    expect(n).toEqual([{ type: 'assigned' }]);
    expect((await listChats(user.id, user.id, { teamId: team.id })).rows.map((c) => c.id)).toEqual([chat.id]);
  });

  it('en masa: cerrar, marcar no leído y fijar (los fijados van primero)', async () => {
    const { user, row } = await setup('inbox-bulk');
    await ingestEvents(row, [inbound('5491100000005@c.us', 'X-1', 'uno'), inbound('5491100000006@c.us', 'X-2', 'dos'), inbound('5491100000007@c.us', 'X-3', 'tres')]);
    const rows = (await listChats(user.id, user.id)).rows;
    const oldest = rows[rows.length - 1];
    await bulkChats(user.id, user.id, [oldest.id], 'pin');
    expect((await listChats(user.id, user.id)).rows[0]).toMatchObject({ id: oldest.id, pinned: true });
    await bulkChats(user.id, user.id, [oldest.id], 'read');
    await bulkChats(user.id, user.id, [oldest.id], 'unread');
    expect((await listChats(user.id, user.id, { filter: 'unread' })).rows.some((c) => c.id === oldest.id)).toBe(true);
    const res = await bulkChats(user.id, user.id, rows.map((r) => r.id), 'close');
    expect(res).toEqual({ updated: 3, failed: 0 });
    expect((await listChats(user.id, user.id)).rows).toHaveLength(0);
    expect((await listChats(user.id, user.id, { filter: 'closed' })).rows).toHaveLength(3);
  });
});

describe('asignación automática round-robin', () => {
  it('reparte por turno entre disponibles, por etiqueta, y espera si no hay nadie', async () => {
    const { user, row } = await setup('inbox-rr');
    const a = await addTeammate(user.id, 'Eva');
    const b = await addTeammate(user.id, 'Fede');
    const vip = await createLabel(user.id, { name: 'VIP' });
    await createRule(user.id, { name: 'VIP', labelId: vip.id, personIds: [a.id, b.id] });
    const team = await createTeam(user.id, { name: 'Todos', memberIds: [a.id, b.id] });
    await createRule(user.id, { name: 'Resto', teamId: team.id });

    await ingestEvents(row, [inbound('5491100000010@c.us', 'R-1', 'uno'), inbound('5491100000011@c.us', 'R-2', 'dos'), inbound('5491100000012@c.us', 'R-3', 'tres')]);
    const rows = (await listChats(user.id, user.id)).rows;
    const assignees = rows.map((r) => r.assignedTo);
    // Tres chats, dos personas: los dos reciben y nadie queda sin asignar.
    expect(new Set(assignees)).toEqual(new Set([a.id, b.id]));
    expect(rows.every((r) => r.assignedTeamId === team.id)).toBe(true);
    const history = (await listMessages(user.id, rows[0].id)).find((m) => m.meta.event === 'auto_assigned');
    expect(history?.meta).toMatchObject({ rule: 'Resto' });

    // Nadie disponible: el chat espera sin asignar; cuando vuelve alguien, se lo lleva.
    await setAvailability(user.id, a.id, false);
    await setAvailability(user.id, b.id, false);
    await ingestEvents(row, [inbound('5491100000013@c.us', 'R-4', 'cuatro')]);
    const waiting = (await listChats(user.id, user.id)).rows.find((r) => r.phone === '5491100000013')!;
    expect(waiting.assignedTo).toBeNull();
    await setAvailability(user.id, b.id, true);
    expect((await listChats(user.id, user.id)).rows.find((r) => r.id === waiting.id)?.assignedTo).toBe(b.id);

    // Con la etiqueta VIP gana la regla VIP (la primera de la lista).
    await setAvailability(user.id, b.id, false);
    await ingestEvents(row, [inbound('5491100000014@c.us', 'R-5', 'soy vip')]);
    const vipChat = (await listChats(user.id, user.id)).rows.find((r) => r.phone === '5491100000014')!;
    await updateChat(user.id, vipChat.id, { labelIds: [vip.id] }, user.id);
    expect((await listChats(user.id, user.id)).rows.find((r) => r.id === vipChat.id)?.assignedTo).toBeNull();
    await setAvailability(user.id, a.id, true);
    expect((await listChats(user.id, user.id)).rows.find((r) => r.id === vipChat.id)?.assignedTo).toBe(a.id);
    expect((await listMessages(user.id, vipChat.id)).find((m) => m.meta.event === 'auto_assigned')?.meta).toMatchObject({ rule: 'VIP' });
  });

  it('dos corridas a la vez no asignan dos veces (claim)', async () => {
    const { user, row } = await setup('inbox-rr-claim');
    const a = await addTeammate(user.id, 'Gabi');
    await setAvailability(user.id, a.id, false);
    await createRule(user.id, { name: 'Todos', personIds: [a.id] });
    await ingestEvents(row, [inbound('5491100000020@c.us', 'C-1', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    expect(chat.assignedTo).toBeNull();
    // Vuelve sin pasar por el barrido: las tres corridas compiten por el mismo chat.
    await getDb().prepare('UPDATE groups_availability SET available = 1 WHERE user_id = ?').run(user.id);
    const results = await Promise.all([autoAssignChat(user.id, chat.id), autoAssignChat(user.id, chat.id), sweepAutoAssign({ ws: user.id })]);
    expect(results.filter((r) => r === a.id).length).toBeLessThanOrEqual(1);
    const events = (await listMessages(user.id, chat.id)).filter((m) => m.meta.event === 'auto_assigned');
    expect(events).toHaveLength(1);
  });
});

describe('llamadas', () => {
  it('una llamada es una línea en el chat que se actualiza y cuenta como respuesta', async () => {
    const { user, row } = await setup('inbox-calls');
    const call = (status: 'ringing' | 'answered' | 'ended', at: number, durationSec?: number) => ({
      type: 'call' as const,
      chatId: '5491100000030@c.us',
      callId: 'CALL-1',
      direction: 'in' as const,
      status,
      senderPhone: '5491100000030',
      senderName: 'Hugo',
      durationSec,
      timestamp: new Date(at).toISOString(),
    });
    const t0 = Date.now() - 120_000;
    await ingestEvents(row, [call('ringing', t0)]);
    let chat = (await listChats(user.id, user.id)).rows[0];
    expect(chat.awaitingSince).toBeTruthy();
    await ingestEvents(row, [call('answered', t0 + 5000)]);
    await ingestEvents(row, [call('ended', t0 + 65_000)]);
    // Un ringing repetido no vuelve atrás.
    await ingestEvents(row, [call('ringing', t0 + 70_000)]);
    const lines = (await listMessages(user.id, chat.id)).filter((m) => m.authorKind === 'call');
    expect(lines).toHaveLength(1);
    expect(lines[0].meta).toMatchObject({ status: 'ended', direction: 'in', durationSec: 60 });
    chat = (await listChats(user.id, user.id)).rows[0];
    expect(chat.awaitingSince).toBeNull();
  });
});

describe('AI de la bandeja (modelo falso)', () => {
  it('traduce al idioma de quien mira, cachea y traduce la respuesta', async () => {
    vi.stubEnv('GROUPS_AI_FAKE', '1');
    const { user, row } = await setup('inbox-ai');
    await ingestEvents(row, [inbound('5491100000040@c.us', 'T-1', 'Hola, ¿cuándo llega la factura?'), inbound('5491100000040@c.us', 'T-2', 'Thanks!')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    const ids = (await listMessages(user.id, chat.id)).map((m) => m.id);
    const first = await translateMessages(user.id, chat.id, ids, 'en');
    expect(first.find((x) => x.lang === 'es')?.text).toBe('[en] Hola, ¿cuándo llega la factura?');
    expect(first.find((x) => x.lang === 'en')?.text).toBe('');
    const usage = async () => ((await getDb().prepare("SELECT COUNT(*) AS c FROM ai_usage WHERE user_id = ? AND feature = 'groups_translate'").get(user.id)) as { c: number }).c;
    const before = Number(await usage());
    await translateMessages(user.id, chat.id, ids, 'en');
    expect(Number(await usage())).toBe(before);
    expect((await translateText(user.id, 'Mañana te llega', 'pt')).text).toBe('[pt] Mañana te llega');
  });

  it('borrador con respuestas rápidas y pulido de lo escrito', async () => {
    vi.stubEnv('GROUPS_AI_FAKE', '1');
    const { user, row } = await setup('inbox-draft');
    await getDb()
      .prepare('INSERT INTO groups_quick_replies (id, user_id, shortcut, body) VALUES (?, ?, ?, ?)')
      .run(crypto.randomUUID(), user.id, 'factura', 'La factura sale el día 5 de cada mes.');
    await ingestEvents(row, [inbound('5491100000041@c.us', 'D-1', '¿Cuándo sale la factura?')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    const draft = await draftReply(user.id, chat.id, { mode: 'draft' });
    expect(draft.text).toContain('La factura sale el día 5');
    expect(draft.sources).toContainEqual({ kind: 'quick', title: '/factura' });
    expect((await draftReply(user.id, chat.id, { mode: 'polish', text: 'ya te la mando' })).text).toBe('Ya te la mando.');
  });

  it('sin AI configurada responde ai_disabled', async () => {
    vi.stubEnv('GROUPS_AI_FAKE', '');
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('VERCEL_OIDC_TOKEN', '');
    vi.stubEnv('VERCEL', '');
    const { user, row } = await setup('inbox-ai-off');
    await ingestEvents(row, [inbound('5491100000042@c.us', 'Z-1', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    await expect(translateText(user.id, 'hola', 'en')).rejects.toThrow('ai_disabled');
    await expect(draftReply(user.id, chat.id, { mode: 'draft' })).rejects.toThrow('ai_disabled');
  });
});
