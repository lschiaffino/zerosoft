/**
 * Posponer archiva el chat y al volver lo desarchiva (Inbox y Lines): queda en Archivados (y en Pospuestos en Inbox),
 * no en la lista principal, y el archivado y el desarchivado van a WhatsApp como los de mano. Vuelve cuando vence,
 * cuando llega un mensaje, cuando se cancela o cuando se manda algo. Con el WhatsApp falso; nombres y números
 * inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient, getDb } from '@/lib/db';
import { addMessage, applyThreadAction, getThreadRow, inboxCounts, listThreads, type AccountRow } from '@/lib/inbox/core';
import { fireFollowUps, wakeSnoozed } from '@/lib/inbox/cron';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { sendToThread } from '@/lib/inbox/send';
import { fakeArchives, resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getChat, getChatRow, getNumberRowById, ingestEvents, listChats, sendMessage, updateChat, type NumberRow } from '@/lib/groups';
import { wakeSnoozedChats } from '@/lib/groups-cron';
import { UNARCHIVED_BY_SEND, getArchivePush, runArchivePushes } from '@/lib/wa-archive-sync';
import migration from '@/lib/schema/migration-files/20261115_1900_snooze_archives';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);
const HOUR = 3600_000;
const inAnHour = () => new Date(Date.now() + HOUR).toISOString();
const later = (ms = 2 * HOUR) => new Date(Date.now() + ms);

function inbound(chatId: string, over: Record<string, unknown> = {}) {
  return {
    type: 'message' as const,
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: chatId.replace(/@.*/, ''),
    senderName: 'Persona Prueba',
    providerMessageId: `m-${Math.random().toString(36).slice(2)}`,
    body: 'hola',
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    ...over,
  };
}
const fresh = (chatId: string) => inbound(chatId, { timestamp: new Date().toISOString(), body: 'sigo acá' });

async function inboxChat(label: string, phone: string) {
  const u = await makeUser(label);
  const { account: acc } = await connectWhatsapp(u.id);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(acc.id);
  const s = fakeState(`inbox-${acc.id}`);
  if (s) s.connectedAt = Date.now() - 5000;
  const account: AccountRow = { ...acc, status: 'connected' };
  const jid = `${phone}@s.whatsapp.net`;
  await ingestWhatsappEvents(account, [inbound(jid)]);
  const [t] = await listThreads(u.id);
  const act = async (action: 'archive' | 'done' | 'unarchive' | 'undone' | 'unsnooze') => void (await applyThreadAction(u.id, [t.id], { action }));
  const snooze = async (until = inAnHour()) => void (await applyThreadAction(u.id, [t.id], { action: 'snooze', until }));
  const state = async () => {
    const r = await getThreadRow(u.id, t.id);
    return { archived: !!r.archived_at || !!r.done_at, snoozed: !!r.snoozed_until };
  };
  const inView = async (view: 'inbox' | 'archived' | 'snoozed', now?: Date) => (await listThreads(u.id, { view, now })).some((x) => x.id === t.id);
  return { owner: u.id, account, jid, id: t.id, act, snooze, state, inView, calls: () => fakeArchives(`inbox-${account.id}`).map((a) => a.archive) };
}

async function linesChat(label: string, phone: string) {
  const u = await makeUser(label);
  const n = await createNumber(u.id, u.id, { provider: 'fake' });
  await connectNumber(u.id, n.id);
  const s = fakeState(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  const number = (await getNumberRowById(n.id)) as NumberRow;
  const jid = `${phone}@s.whatsapp.net`;
  await ingestEvents(number, [inbound(jid)]);
  const [c] = (await listChats(u.id, u.id)).rows;
  const patch = async (p: Parameters<typeof updateChat>[2]) => void (await updateChat(u.id, c.id, p));
  const snooze = async (until = inAnHour()) => patch({ snoozedUntil: until });
  const state = async () => {
    const r = (await getChat(u.id, c.id))!;
    return { archived: r.archived, snoozed: !!r.snoozedUntil };
  };
  const inList = async (archived = false) => (await listChats(u.id, u.id, { archived })).rows.some((x) => x.id === c.id);
  return { ws: u.id, number, jid, id: c.id, patch, snooze, state, inList, calls: () => fakeArchives(number.id).map((a) => a.archive) };
}

const SNOOZED = { archived: true, snoozed: true };
const BACK = { archived: false, snoozed: false };
const ARCHIVED = { archived: true, snoozed: false };

describe('Inbox: posponer archiva', () => {
  it('posponer: queda en Archivados y en Pospuestos, no en la bandeja, y se archiva en WhatsApp', async () => {
    const c = await inboxChat('sz-in-snooze', '5491100008001');
    await c.snooze();
    expect(await c.state()).toEqual(SNOOZED);
    expect(await c.inView('archived')).toBe(true);
    expect(await c.inView('snoozed')).toBe(true);
    expect(await c.inView('inbox')).toBe(false);
    expect(await inboxCounts(c.owner)).toMatchObject({ snoozed: 1, archived: 1 });
    expect(c.calls()).toEqual([true]);
    // El aviso del teléfono por nuestro archivado no cambia nada.
    await ingestWhatsappEvents(c.account, [{ type: 'archive', chatId: c.jid, archived: true }]);
    expect(await c.state()).toEqual(SNOOZED);
  });

  it('cuando vence: vuelve a la bandeja marcado, sale de Archivados y se desarchiva en WhatsApp (una sola vez)', async () => {
    const c = await inboxChat('sz-in-wake', '5491100008002');
    await c.snooze();
    // El cron mira toda la base (otros tests dejan pospuestos): se mira este chat.
    await wakeSnoozed(new Date());
    expect(await c.state()).toEqual(SNOOZED);
    const at = later();
    await wakeSnoozed(at);
    await wakeSnoozed(at);
    expect(await c.state()).toEqual(BACK);
    expect(await c.inView('inbox', at)).toBe(true);
    expect(await c.inView('archived', at)).toBe(false);
    expect((await listThreads(c.owner, { now: at }))[0].woke).toBe('snooze');
    await runArchivePushes({}, at);
    expect(c.calls()).toEqual([true, false]);
    expect(await getArchivePush('inbox', c.id)).toMatchObject({ archived: 0, last_error: '' });
  });

  it('un mensaje nuevo lo trae de vuelta (aunque esté silenciado) y el desarchivado va al teléfono', async () => {
    const c = await inboxChat('sz-in-msg', '5491100008003');
    await applyThreadAction(c.owner, [c.id], { action: 'mute', until: new Date(Date.now() + 8 * HOUR).toISOString() });
    await c.snooze();
    // Uno viejo que llega tarde no lo despierta.
    await ingestWhatsappEvents(c.account, [inbound(c.jid, { timestamp: new Date(Date.now() - 5 * HOUR).toISOString() })]);
    expect(await c.state()).toEqual(SNOOZED);
    await ingestWhatsappEvents(c.account, [fresh(c.jid)]);
    expect(await c.state()).toEqual(BACK);
    expect(await c.inView('inbox')).toBe(true);
    // Queda pedido para el cron (el teléfono puede tener "mantener archivados").
    expect(await getArchivePush('inbox', c.id)).toMatchObject({ archived: 0, done_at: null });
    await runArchivePushes({}, later(10_000));
    expect(c.calls()).toEqual([true, false]);
    // Si el teléfono ya lo había desarchivado solo, su aviso coincide y no cambia nada.
    await ingestWhatsappEvents(c.account, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect(await c.state()).toEqual(BACK);
  });

  it('cancelar el pospuesto (o Deshacer): vuelve a la bandeja y se desarchiva en WhatsApp', async () => {
    const c = await inboxChat('sz-in-undo', '5491100008004');
    await c.snooze();
    await c.act('unsnooze');
    expect(await c.state()).toEqual(BACK);
    expect(await c.inView('inbox')).toBe(true);
    expect(c.calls()).toEqual([true, false]);
  });

  it('desarchivar a mano un chat pospuesto cancela el pospuesto', async () => {
    const c = await inboxChat('sz-in-unarch', '5491100008005');
    await c.snooze();
    await c.act('unarchive');
    expect(await c.state()).toEqual(BACK);
    expect(await c.inView('snoozed')).toBe(false);
    expect(c.calls()).toEqual([true, false]);
    // Y no vuelve a "despertar" más tarde.
    await wakeSnoozed(later());
    expect((await getThreadRow(c.owner, c.id)).woke_reason).not.toBe('snooze');
  });

  it.each(['archive', 'done'] as const)('uno que ya estaba archivado (%s): posponer no manda nada, cancelar lo deja archivado, y al vencer vuelve', async (how) => {
    const c = await inboxChat(`sz-in-pre-${how}`, '5491100008006');
    await c.act(how);
    await c.snooze();
    expect(await c.state()).toEqual(SNOOZED);
    expect(c.calls()).toEqual([true]);
    await c.act('unsnooze');
    expect(await c.state()).toEqual(ARCHIVED);
    expect(c.calls()).toEqual([true]);
    // Vencido, sí vuelve: posponer es pedir verlo de nuevo.
    await c.snooze();
    const at = later();
    await wakeSnoozed(at);
    expect(await c.state()).toEqual(BACK);
    await runArchivePushes({}, at);
    expect(c.calls()).toEqual([true, false]);
  });

  it('mandar un mensaje en un chat pospuesto lo desarchiva y termina el pospuesto, sin mandarle el desarchivado a WhatsApp', async () => {
    const c = await inboxChat('sz-in-send', '5491100008007');
    await c.snooze();
    await sendToThread(c.owner, c.id, 'ahí va');
    expect(await c.state()).toEqual(BACK);
    expect(await c.inView('inbox')).toBe(true);
    expect(c.calls()).toEqual([true]);
    expect(await getArchivePush('inbox', c.id)).toMatchObject({ archived: 0, last_error: UNARCHIVED_BY_SEND });
    await wakeSnoozed(later());
    expect((await getThreadRow(c.owner, c.id)).woke_reason).not.toBe('snooze');
  });

  it('un chat de email pospuesto sigue pospuesto y archivado al responder (responder no desarchiva email), y vuelve al vencer', async () => {
    const c = await inboxChat('sz-in-mail', '5491100008013');
    await getDb().prepare("UPDATE inbox_threads SET channel = 'gmail' WHERE id = ?").run(c.id);
    await c.snooze();
    expect(c.calls()).toEqual([]);
    await addMessage(await getThreadRow(c.owner, c.id), { externalId: 'mail-out-sz', fromMe: true, body: 'respuesta', status: 'sent' });
    expect(await c.state()).toEqual(SNOOZED);
    expect(await getArchivePush('inbox', c.id)).toBeUndefined();
    await wakeSnoozed(later());
    expect(await c.state()).toEqual(BACK);
  });

  it('desarchivar y posponer enseguida: el desarchivado que avisa el teléfono es eco viejo y no deshace el pospuesto', async () => {
    const c = await inboxChat('sz-in-echo', '5491100008008');
    await c.act('archive');
    await c.act('unarchive');
    await c.snooze();
    await ingestWhatsappEvents(c.account, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect(await c.state()).toEqual(SNOOZED);
    expect(c.calls()).toEqual([true, false, true]);
  });

  it('con el archivado de la cuenta roto, el "no archivado" del teléfono es viejo y no deshace el pospuesto', async () => {
    const c = await inboxChat('sz-in-stale', '5491100008009');
    await c.snooze();
    await getDb().prepare("UPDATE inbox_accounts SET archive_sync_error = 'app_state_unavailable' WHERE id = ?").run(c.account.id);
    await ingestWhatsappEvents(c.account, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect(await c.state()).toEqual(SNOOZED);
  });

  it('desarchivarlo desde el teléfono cancela el pospuesto, y nada vuelve a WhatsApp', async () => {
    const c = await inboxChat('sz-in-phone', '5491100008010');
    await c.snooze();
    await ingestWhatsappEvents(c.account, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect(await c.state()).toEqual(BACK);
    expect(c.calls()).toEqual([true]);
  });

  it('"recordame si no contesta" que vence en un chat pospuesto: termina el pospuesto y lo desarchiva', async () => {
    const c = await inboxChat('sz-in-follow', '5491100008011');
    await applyThreadAction(c.owner, [c.id], { action: 'followUp', at: new Date(Date.now() + HOUR / 2).toISOString() });
    await c.snooze(new Date(Date.now() + 5 * HOUR).toISOString());
    const at = later(HOUR);
    expect(await fireFollowUps(at)).toBe(1);
    expect(await c.state()).toEqual(BACK);
    await runArchivePushes({}, at);
    expect(c.calls()).toEqual([true, false]);
  });

  it('los que ya estaban pospuestos (ni en la bandeja ni en Archivados) quedan archivados con la migración, y se anotan para el teléfono', async () => {
    const c = await inboxChat('sz-in-legacy', '5491100008012');
    await getDb().prepare('UPDATE inbox_threads SET snoozed_until = ? WHERE id = ?').run(inAnHour(), c.id);
    expect(await c.inView('archived')).toBe(false);
    expect(await c.inView('inbox')).toBe(false);
    await migration.up(getClient());
    await migration.up(getClient());
    expect(await c.state()).toEqual(SNOOZED);
    expect(await c.inView('archived')).toBe(true);
    expect((await getThreadRow(c.owner, c.id)).snooze_archived).toBe(1);
    expect(await getArchivePush('inbox', c.id)).toMatchObject({ archived: 1, version: 1, done_at: null });
    await runArchivePushes({}, later(10_000));
    expect(c.calls()).toEqual([true]);
  });
});

describe('Lines: posponer archiva', () => {
  it('posponer: queda en Archivados con la hora, no en la lista, y se archiva en WhatsApp', async () => {
    const c = await linesChat('sz-li-snooze', '5491100008101');
    const until = inAnHour();
    await c.snooze(until);
    expect(await c.state()).toEqual(SNOOZED);
    expect((await getChat(c.ws, c.id))!.snoozedUntil).toBe(until);
    expect(await c.inList(true)).toBe(true);
    expect(await c.inList()).toBe(false);
    expect(c.calls()).toEqual([true]);
    await ingestEvents(c.number, [{ type: 'archive', chatId: c.jid, archived: true }]);
    expect(await c.state()).toEqual(SNOOZED);
  });

  it('una fecha pasada no pospone', async () => {
    const c = await linesChat('sz-li-past', '5491100008102');
    await expect(c.snooze(new Date(Date.now() - HOUR).toISOString())).rejects.toThrow('date_in_past');
    expect(await c.state()).toEqual(BACK);
  });

  it('cuando vence: vuelve a la lista como no leído y se desarchiva en WhatsApp (una sola vez)', async () => {
    const c = await linesChat('sz-li-wake', '5491100008103');
    await c.patch({ read: true });
    await c.snooze();
    await wakeSnoozedChats(new Date());
    expect(await c.state()).toEqual(SNOOZED);
    const at = later();
    await wakeSnoozedChats(at);
    await wakeSnoozedChats(at);
    expect(await c.state()).toEqual(BACK);
    expect(await c.inList()).toBe(true);
    expect((await getChat(c.ws, c.id))!).toMatchObject({ unread: 1, markedUnread: true });
    await runArchivePushes({}, at);
    expect(c.calls()).toEqual([true, false]);
  });

  it('un mensaje nuevo lo trae de vuelta aunque el workspace mantenga los archivados, y el desarchivado va al teléfono', async () => {
    const c = await linesChat('sz-li-msg', '5491100008104');
    await c.snooze();
    await ingestEvents(c.number, [fresh(c.jid)]);
    expect(await c.state()).toEqual(BACK);
    expect(await c.inList()).toBe(true);
    expect(await getArchivePush('lines', c.id)).toMatchObject({ archived: 0, done_at: null });
    await runArchivePushes({}, later(10_000));
    expect(c.calls()).toEqual([true, false]);
    await ingestEvents(c.number, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect(await c.state()).toEqual(BACK);
  });

  it('uno archivado a mano (sin posponer) vuelve con un mensaje nuevo, sin mandar nada a WhatsApp', async () => {
    const c = await linesChat('sz-li-keep', '5491100008105');
    await c.patch({ archived: true });
    await ingestEvents(c.number, [fresh(c.jid)]);
    expect(await c.state()).toEqual(BACK);
    expect(c.calls()).toEqual([true]);
  });

  it('cancelar el pospuesto (o Deshacer): vuelve a la lista y se desarchiva en WhatsApp', async () => {
    const c = await linesChat('sz-li-undo', '5491100008106');
    await c.snooze();
    await c.patch({ snoozedUntil: null });
    expect(await c.state()).toEqual(BACK);
    expect(c.calls()).toEqual([true, false]);
  });

  it('desarchivar a mano un chat pospuesto cancela el pospuesto', async () => {
    const c = await linesChat('sz-li-unarch', '5491100008107');
    await c.snooze();
    await c.patch({ archived: false });
    expect(await c.state()).toEqual(BACK);
    expect(c.calls()).toEqual([true, false]);
    await wakeSnoozedChats(later());
    expect(await c.state()).toEqual(BACK);
  });

  it('uno que ya estaba archivado: posponer no manda nada, cancelar lo deja archivado, y al vencer vuelve', async () => {
    const c = await linesChat('sz-li-pre', '5491100008108');
    await c.patch({ archived: true });
    await c.snooze();
    expect(await c.state()).toEqual(SNOOZED);
    expect(c.calls()).toEqual([true]);
    await c.patch({ snoozedUntil: null });
    expect(await c.state()).toEqual(ARCHIVED);
    expect(c.calls()).toEqual([true]);
    await c.snooze();
    const at = later();
    await wakeSnoozedChats(at);
    expect(await c.state()).toEqual(BACK);
    await runArchivePushes({}, at);
    expect(c.calls()).toEqual([true, false]);
  });

  it('mandar un mensaje en un chat pospuesto lo desarchiva y termina el pospuesto, sin mandarle el desarchivado a WhatsApp', async () => {
    const c = await linesChat('sz-li-send', '5491100008109');
    await c.snooze();
    await sendMessage(c.ws, c.ws, c.id, { body: 'ahí va' });
    expect(await c.state()).toEqual(BACK);
    expect(await c.inList()).toBe(true);
    expect(c.calls()).toEqual([true]);
    expect((await getChatRow(c.ws, c.id))!.snooze_archived).toBe(0);
    await wakeSnoozedChats(later());
    expect(await c.state()).toEqual(BACK);
  });

  it('desarchivar y posponer enseguida: el desarchivado que avisa el teléfono es eco viejo y no deshace el pospuesto', async () => {
    const c = await linesChat('sz-li-echo', '5491100008110');
    await c.patch({ archived: true });
    await c.patch({ archived: false });
    await c.snooze();
    await ingestEvents(c.number, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect(await c.state()).toEqual(SNOOZED);
  });

  it('con el archivado del número roto, el "no archivado" del teléfono es viejo y no deshace el pospuesto', async () => {
    const c = await linesChat('sz-li-stale', '5491100008111');
    await c.snooze();
    await getDb().prepare("UPDATE groups_numbers SET archive_sync_error = 'app_state_unavailable' WHERE id = ?").run(c.number.id);
    await ingestEvents(c.number, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect(await c.state()).toEqual(SNOOZED);
  });

  it('desarchivarlo desde el teléfono cancela el pospuesto, y nada vuelve a WhatsApp', async () => {
    const c = await linesChat('sz-li-phone', '5491100008112');
    await c.snooze();
    await ingestEvents(c.number, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect(await c.state()).toEqual(BACK);
    expect(c.calls()).toEqual([true]);
  });

  it('"Eliminar chat" de un chat pospuesto termina el pospuesto', async () => {
    const c = await linesChat('sz-li-hide', '5491100008113');
    await c.snooze();
    await c.patch({ hidden: true });
    expect(await c.state()).toEqual(BACK);
    await wakeSnoozedChats(later());
    expect(await c.state()).toEqual(BACK);
  });
});
