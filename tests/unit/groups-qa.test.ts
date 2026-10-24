import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listMembers, sendMessage, updateSettings } from '@/lib/groups';
import { createTicket, listTickets, markBreachedTickets } from '@/lib/groups-tickets';
import { createBroadcast, processBroadcasts } from '@/lib/groups-broadcasts';
import { flagUnansweredChats } from '@/lib/groups-cron';
import { searchApps } from '@/lib/app-search';
import { makeUser } from './helpers';

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

const inbound = (chatId: string, id: string, body: string, extra: Record<string, unknown> = {}) => ({
  type: 'message' as const,
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  fromMe: false,
  senderPhone: '5491155550000',
  senderName: 'Ana',
  providerMessageId: id,
  body,
  ...extra,
});

describe('QA de Groups', () => {
  it('con el reloj adelantado, el chat queda en Vencidos y el ticket vencido', async () => {
    const { user, row } = await setup('qa-overdue');
    await updateSettings(user.id, { unansweredMin: 15, firstResponseMin: 30 });
    await ingestEvents(row, [inbound('120363000000077777@g.us', 'TT-1', 'Se cayó el export')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    await createTicket(user.id, user.id, { chatId: chat.id, title: 'Export caído' });
    expect((await listChats(user.id, user.id, { filter: 'flagged' })).rows).toHaveLength(0);
    // 20 min después vence el "sin responder"; a los 40, la primera respuesta del ticket.
    await flagUnansweredChats(new Date(Date.now() + 20 * 60_000));
    expect((await listChats(user.id, user.id, { filter: 'flagged' })).rows.map((c) => c.id)).toEqual([chat.id]);
    await markBreachedTickets(new Date(Date.now() + 40 * 60_000));
    expect((await listTickets(user.id, { breached: true })).map((t) => t.title)).toEqual(['Export caído']);
    // Responder lo saca de Vencidos.
    await sendMessage(user.id, user.id, chat.id, { body: 'Lo vemos' });
    expect((await listChats(user.id, user.id, { filter: 'flagged' })).rows).toHaveLength(0);
  });

  it('un envío masivo no cuenta como respuesta; un programado a un chat sí', async () => {
    const { user, row } = await setup('qa-broadcast');
    await ingestEvents(row, [inbound('120363000000088888@g.us', 'BC-1', '¿Novedades?')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    const { ticket } = await createTicket(user.id, user.id, { chatId: chat.id, title: 'Pregunta' });
    const b = await createBroadcast(user.id, user.id, { body: 'Newsletter de octubre', chatIds: [chat.id] });
    expect((await processBroadcasts({ gapMs: 0, broadcastId: b.id })).sent).toBe(1);
    let fresh = (await listChats(user.id, user.id)).rows.find((c) => c.id === chat.id)!;
    expect(fresh.awaitingSince).toBeTruthy();
    expect((await listTickets(user.id)).find((t) => t.id === ticket.id)!.firstResponseAt).toBeNull();
    const s = await createBroadcast(user.id, user.id, { body: 'Te respondo mañana', chatIds: [chat.id], kind: 'scheduled' });
    expect((await processBroadcasts({ gapMs: 0, broadcastId: s.id })).sent).toBe(1);
    fresh = (await listChats(user.id, user.id)).rows.find((c) => c.id === chat.id)!;
    expect(fresh.awaitingSince).toBeNull();
    expect((await listTickets(user.id)).find((t) => t.id === ticket.id)!.firstResponseAt).toBeTruthy();
  });

  it('la vista previa de un adjunto es el nombre o un marcador traducible', async () => {
    const { user, row } = await setup('qa-media');
    await ingestEvents(row, [inbound('5491155554444@c.us', 'MD-1', '', { media: { url: '', type: 'text/csv', name: 'ventas.csv' } })]);
    await ingestEvents(row, [inbound('5491155554445@c.us', 'MD-2', '', { media: { url: '', type: 'audio/ogg', name: '' } })]);
    const previews = (await listChats(user.id, user.id)).rows.map((c) => c.lastMessagePreview).sort();
    expect(previews).toEqual(['[audio]', 'ventas.csv']);
  });

  it('el nombre de quien escribe en un grupo queda en sus miembros', async () => {
    const { user, row } = await setup('qa-names');
    await ingestEvents(row, [inbound('120363000000099999@g.us', 'NM-1', 'hola', { senderName: 'Ana Pérez', senderPhone: '5491155553333' })]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    expect((await listMembers(user.id, chat.id)).find((m) => m.phone === '5491155553333')?.name).toBe('Ana Pérez');
  });

  it('Cmd+K encuentra tickets por título o número y mensajes por su texto', async () => {
    const { user, row } = await setup('qa-search');
    await ingestEvents(row, [inbound('120363000000066666@g.us', 'SR-1', 'La factura zafiro no llegó', { chatName: 'Cliente Esmeralda' })]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    const { ticket } = await createTicket(user.id, user.id, { chatId: chat.id, title: 'Reenviar factura rubí' });
    const byTitle = await searchApps({ id: user.id }, 'rubí', 5, 'es');
    expect(byTitle.find((i) => i.group === 'groupsTickets')).toMatchObject({ href: `/app/groups/tickets?open=${ticket.id}` });
    const byNumber = await searchApps({ id: user.id }, `#${ticket.number}`, 5, 'es');
    expect(byNumber.some((i) => i.group === 'groupsTickets' && i.id === ticket.id)).toBe(true);
    const byText = await searchApps({ id: user.id }, 'zafiro', 5, 'es');
    const hit = byText.find((i) => i.group === 'groupsMessages')!;
    expect(hit.href).toMatch(new RegExp(`^/app/groups/inbox/${chat.id}#m-`));
    // La meta del grupo va en el idioma de la paleta.
    const chats = await searchApps({ id: user.id }, chat.name, 5, 'es');
    expect(chats.find((i) => i.group === 'groupsChats')?.meta).toBe('Grupo de WhatsApp');
  });
});
