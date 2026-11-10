import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import {
  canAccessBroadcast,
  cancelBroadcast,
  createBroadcast,
  listScheduledMessages,
  processBroadcasts,
  sendBroadcastNow,
  updateBroadcast,
} from '@/lib/groups-broadcasts';
import { localInputValue, longWhen, presetDate, SNOOZE_PRESETS } from '@/lib/when-presets';
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

const inbound = (chatId: string, id: string, body: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: false,
  fromMe: false,
  senderPhone: chatId.split('@')[0],
  senderName: 'Ana',
  providerMessageId: id,
  body,
});

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

async function twoChats(label: string) {
  const { user, row } = await setup(label);
  await ingestEvents(row, [inbound('5491155551001@c.us', `${label}-A`, '¿Me pasás el presupuesto?')]);
  await ingestEvents(row, [inbound('5491155551002@c.us', `${label}-B`, 'Hola')]);
  const chats = (await listChats(user.id, user.id)).rows;
  const a = chats.find((c) => c.phone === '5491155551001')!;
  const b = chats.find((c) => c.phone === '5491155551002')!;
  const msg = (await getDb().prepare("SELECT id FROM groups_messages WHERE chat_id = ? AND direction = 'in'").get(a.id)) as { id: string };
  return { user, a, b, inboundId: msg.id };
}

describe('Lines: enviar más tarde', () => {
  it('lista los programados pendientes de un chat y de todos, del más próximo al más lejano', async () => {
    const { user, a, b } = await twoChats('later-list');
    const other = await makeUser('later-list-other');
    const late = await createBroadcast(user.id, user.id, { body: 'El lunes te confirmo', chatIds: [a.id], kind: 'scheduled', scheduledAt: inHours(48) });
    const soon = await createBroadcast(user.id, user.id, { body: 'Mañana te llamo', chatIds: [a.id], kind: 'scheduled', scheduledAt: inHours(2) });
    const theirs = await createBroadcast(user.id, other.id, { body: 'Recordatorio', chatIds: [b.id], kind: 'scheduled', scheduledAt: inHours(5) });
    // Un envío masivo no es un mensaje programado del chat.
    await createBroadcast(user.id, user.id, { body: 'Newsletter', chatIds: [a.id, b.id], scheduledAt: inHours(3) });

    const ofChat = await listScheduledMessages(user.id, user.id, { chatId: a.id });
    expect(ofChat.map((s) => s.id)).toEqual([soon.id, late.id]);
    expect(ofChat[0].chat).toMatchObject({ id: a.id, kind: 'dm' });
    expect(ofChat[0].otherChats).toBe(0);
    expect(ofChat.every((s) => s.mine)).toBe(true);

    const all = await listScheduledMessages(user.id, user.id);
    expect(all.map((s) => s.id)).toEqual([soon.id, theirs.id, late.id]);
    expect(all.find((s) => s.id === theirs.id)).toMatchObject({ mine: false, createdBy: other.id });
    expect((await listScheduledMessages(user.id, user.id, { mine: true })).map((s) => s.id)).toEqual([soon.id, late.id]);
    // Otro workspace no ve nada.
    expect(await listScheduledMessages(other.id, other.id)).toEqual([]);
  });

  it('con acceso restringido solo aparecen (y se tocan) los de chats que la persona ve', async () => {
    const { user, a, b } = await twoChats('later-access');
    const mine = await createBroadcast(user.id, user.id, { body: 'Para A', chatIds: [a.id], kind: 'scheduled', scheduledAt: inHours(2) });
    const hidden = await createBroadcast(user.id, user.id, { body: 'Para B', chatIds: [b.id], kind: 'scheduled', scheduledAt: inHours(2) });
    const both = await createBroadcast(user.id, user.id, { body: 'Para los dos', chatIds: [a.id, b.id], kind: 'scheduled', scheduledAt: inHours(2) });
    const visible = new Set([a.id]);
    expect((await listScheduledMessages(user.id, user.id, { visible })).map((s) => s.id)).toEqual([mine.id]);
    expect(await canAccessBroadcast(user.id, mine.id, visible)).toBe(true);
    expect(await canAccessBroadcast(user.id, hidden.id, visible)).toBe(false);
    expect(await canAccessBroadcast(user.id, both.id, visible)).toBe(false);
    expect(await canAccessBroadcast(user.id, both.id, null)).toBe(true);
    expect(await canAccessBroadcast('otro-workspace', mine.id, null)).toBe(false);
    // El que va a dos chats cuenta el otro.
    const forA = await listScheduledMessages(user.id, user.id, { chatId: a.id });
    expect(forA.find((s) => s.id === both.id)).toMatchObject({ otherChats: 1, chat: { id: a.id } });
  });

  it('cambiar la hora, editar el texto y cancelar', async () => {
    const { user, a } = await twoChats('later-edit');
    const s = await createBroadcast(user.id, user.id, { body: 'Borrador', chatIds: [a.id], kind: 'scheduled', scheduledAt: inHours(2) });
    const at = inHours(30);
    const moved = await updateBroadcast(user.id, s.id, { scheduledAt: at, body: 'Texto final' });
    expect(moved.scheduledAt).toBe(at);
    expect(moved.body).toBe('Texto final');
    // Todavía no es la hora: el cron no lo manda.
    expect((await processBroadcasts({ gapMs: 0, broadcastId: s.id })).sent).toBe(0);
    expect((await cancelBroadcast(user.id, s.id)).status).toBe('cancelled');
    expect(await listScheduledMessages(user.id, user.id, { chatId: a.id })).toEqual([]);
    await expect(updateBroadcast(user.id, s.id, { body: 'Tarde' })).rejects.toMatchObject({ code: 'not_editable' });
    await expect(sendBroadcastNow(user.id, s.id)).rejects.toMatchObject({ code: 'not_editable' });
  });

  it('"enviar ahora" lo adelanta y sale con la cita al mensaje', async () => {
    const { user, a, b, inboundId } = await twoChats('later-now');
    const s = await createBroadcast(user.id, user.id, {
      body: 'Acá va el presupuesto',
      chatIds: [a.id],
      kind: 'scheduled',
      scheduledAt: inHours(24),
      replyToId: inboundId,
    });
    expect(s.replyToId).toBe(inboundId);
    const now = await sendBroadcastNow(user.id, s.id);
    expect(Date.parse(now.scheduledAt)).toBeLessThanOrEqual(Date.now());
    expect((await processBroadcasts({ gapMs: 0, broadcastId: s.id })).sent).toBe(1);
    const sent = (await getDb()
      .prepare("SELECT body, reply_to_id, author_kind FROM groups_messages WHERE chat_id = ? AND direction = 'out'")
      .get(a.id)) as { body: string; reply_to_id: string | null; author_kind: string };
    expect(sent).toMatchObject({ body: 'Acá va el presupuesto', reply_to_id: inboundId, author_kind: 'scheduled' });
    expect(await listScheduledMessages(user.id, user.id)).toEqual([]);
    await expect(sendBroadcastNow(user.id, 'no-existe')).rejects.toMatchObject({ code: 'not_found' });

    // La cita tiene que ser de ese chat, y de un solo chat.
    await expect(
      createBroadcast(user.id, user.id, { body: 'x', chatIds: [b.id], kind: 'scheduled', scheduledAt: inHours(1), replyToId: inboundId }),
    ).rejects.toMatchObject({ code: 'invalid_reply' });
    await expect(
      createBroadcast(user.id, user.id, { body: 'x', chatIds: [a.id, b.id], kind: 'scheduled', scheduledAt: inHours(1), replyToId: inboundId }),
    ).rejects.toMatchObject({ code: 'invalid_reply' });
  });

  it('si el mensaje citado ya no está, sale igual, sin la cita', async () => {
    const { user, a, inboundId } = await twoChats('later-gone');
    const s = await createBroadcast(user.id, user.id, { body: 'Respuesta', chatIds: [a.id], kind: 'scheduled', replyToId: inboundId });
    await getDb().prepare('DELETE FROM groups_messages WHERE id = ?').run(inboundId);
    expect((await processBroadcasts({ gapMs: 0, broadcastId: s.id })).sent).toBe(1);
    const sent = (await getDb().prepare("SELECT reply_to_id FROM groups_messages WHERE chat_id = ? AND direction = 'out'").get(a.id)) as {
      reply_to_id: string | null;
    };
    expect(sent.reply_to_id).toBeNull();
  });
});

describe('presets de "cuándo" (compartidos por Inbox y Lines)', () => {
  it('son seis, en el orden de los atajos 1 a 6, y todos caen en el futuro', () => {
    expect(SNOOZE_PRESETS).toEqual(['later', 'tonight', 'tomorrow', 'weekend', 'nextWeek', 'inWeek']);
    const now = new Date(2026, 10, 10, 15, 30); // martes
    for (const p of SNOOZE_PRESETS) expect(presetDate(p, now).getTime()).toBeGreaterThan(now.getTime());
    expect(presetDate('tomorrow', now).getHours()).toBe(8);
    expect(presetDate('weekend', now).getDay()).toBe(6);
    expect(presetDate('nextWeek', now).getDay()).toBe(1);
  });

  it('el valor del campo de fecha y la fecha larga', () => {
    expect(localInputValue(new Date(2026, 10, 9, 8, 5))).toBe('2026-11-09T08:05');
    expect(longWhen(null, 'en')).toBe('');
    expect(longWhen('no es fecha', 'en')).toBe('');
    expect(longWhen(new Date(2026, 10, 9, 8, 5).toISOString(), 'en')).toMatch(/Nov/);
  });
});
