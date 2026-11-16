/**
 * "Mantener archivado" por chat (Inbox y Lines): ni un mensaje que llega, ni uno que sale (desde acá o desde el
 * teléfono), ni el teléfono, ni el fin de un pospuesto lo sacan de Archivados. Desarchivar a mano apaga la marca.
 * Con el WhatsApp falso; nombres y números inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { applyThreadAction, getThreadRow, listThreads, type AccountRow } from '@/lib/inbox/core';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { sendToThread } from '@/lib/inbox/send';
import { wakeSnoozed } from '@/lib/inbox/cron';
import { fakeArchives, resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getChat, getNumberRowById, ingestEvents, listChats, sendMessage, updateChat, updateSettings, type NumberRow } from '@/lib/groups';
import { getArchivePush } from '@/lib/wa-archive-sync';
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
const later = (over: Record<string, unknown> = {}) => ({ timestamp: new Date().toISOString(), ...over });

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
  const keep = async (on = true) => void (await applyThreadAction(u.id, [t.id], { action: 'keepArchived', on }));
  const state = async () => {
    const r = await getThreadRow(u.id, t.id);
    return { archived: !!r.archived_at || !!r.done_at, keep: r.keep_archived === 1 };
  };
  return { owner: u.id, account, jid, id: t.id, keep, state, calls: () => fakeArchives(`inbox-${account.id}`) };
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
  const keep = async (on = true) => void (await updateChat(u.id, c.id, { keepArchived: on }));
  const state = async () => {
    const dto = (await getChat(u.id, c.id))!;
    return { archived: dto.archived, keep: dto.keepArchived };
  };
  return { ws: u.id, number, jid, id: c.id, keep, state, calls: () => fakeArchives(number.id) };
}

const KEPT = { archived: true, keep: true };

describe('Inbox: Mantener archivado', () => {
  it('prenderlo archiva el chat (también en WhatsApp) y sale en la lista con la marca', async () => {
    const c = await inboxChat('ka-in-on', '5491100008001');
    await c.keep();
    expect(await c.state()).toEqual(KEPT);
    expect(c.calls().map((a) => a.archive)).toEqual([true]);
    const [row] = await listThreads(c.owner, { view: 'archived' });
    expect(row).toMatchObject({ id: c.id, archived: true, keepArchived: true });
    // Ya archivado: prenderlo otra vez no manda nada.
    await c.keep();
    expect(c.calls()).toHaveLength(1);
  });

  it('un mensaje que llega no lo saca de Archivados (queda sin leer adentro)', async () => {
    const c = await inboxChat('ka-in-in', '5491100008002');
    await c.keep();
    await ingestWhatsappEvents(c.account, [inbound(c.jid, later())]);
    expect(await c.state()).toEqual(KEPT);
    const [row] = await listThreads(c.owner, { view: 'archived' });
    expect(row.unread).toBeGreaterThan(0);
  });

  it('mandar desde acá o desde el teléfono tampoco; no se anota un desarchivado', async () => {
    const c = await inboxChat('ka-in-out', '5491100008003');
    await c.keep();
    await sendToThread(c.owner, c.id, 'ahí va');
    await ingestWhatsappEvents(c.account, [inbound(c.jid, later({ fromMe: true, body: 'desde el teléfono' }))]);
    expect(await c.state()).toEqual(KEPT);
    expect(await getArchivePush('inbox', c.id)).toMatchObject({ archived: 1 });
  });

  it('el desarchivado que avisa el teléfono no lo saca', async () => {
    const c = await inboxChat('ka-in-phone', '5491100008004');
    await c.keep();
    await ingestWhatsappEvents(c.account, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect(await c.state()).toEqual(KEPT);
  });

  it('al terminar un pospuesto sigue archivado (cualquier cambio que lo desarchive se deshace en la base)', async () => {
    const c = await inboxChat('ka-in-snooze', '5491100008005');
    await c.keep();
    await getDb().prepare('UPDATE inbox_threads SET snoozed_until = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), c.id);
    await wakeSnoozed();
    // Lo que haga el despertar (también desarchivar), no lo saca.
    await getDb().prepare('UPDATE inbox_threads SET archived_at = NULL WHERE id = ?').run(c.id);
    expect(await c.state()).toEqual(KEPT);
  });

  it('desarchivar a mano lo saca y apaga la marca; volver a la bandeja también', async () => {
    const c = await inboxChat('ka-in-manual', '5491100008006');
    await c.keep();
    await applyThreadAction(c.owner, [c.id], { action: 'unarchive' });
    expect(await c.state()).toEqual({ archived: false, keep: false });
    await c.keep();
    await applyThreadAction(c.owner, [c.id], { action: 'undone' });
    expect(await c.state()).toEqual({ archived: false, keep: false });
    // Sin la marca, un mensaje que llega vuelve a desarchivar como siempre.
    await applyThreadAction(c.owner, [c.id], { action: 'archive' });
    await ingestWhatsappEvents(c.account, [inbound(c.jid, later())]);
    expect((await c.state()).archived).toBe(false);
  });

  it('apagarla deja el chat donde está', async () => {
    const c = await inboxChat('ka-in-off', '5491100008007');
    await c.keep();
    await c.keep(false);
    expect(await c.state()).toEqual({ archived: true, keep: false });
  });
});

describe('Lines: Mantener archivado', () => {
  it('prenderlo archiva el chat (también en WhatsApp)', async () => {
    const c = await linesChat('ka-li-on', '5491100008101');
    await c.keep();
    expect(await c.state()).toEqual(KEPT);
    expect(c.calls().map((a) => a.archive)).toEqual([true]);
  });

  it('un mensaje que llega no lo saca aunque el workspace desarchive con mensajes nuevos', async () => {
    const c = await linesChat('ka-li-in', '5491100008102');
    await updateSettings(c.ws, { keepArchived: false });
    await c.keep();
    await ingestEvents(c.number, [inbound(c.jid, later())]);
    expect(await c.state()).toEqual(KEPT);
    // Otro chat sin la marca sí vuelve (el ajuste del workspace sigue valiendo).
    const other = '5491100008199@s.whatsapp.net';
    await ingestEvents(c.number, [inbound(other)]);
    const o = (await listChats(c.ws, c.ws)).rows.find((r) => r.id !== c.id)!;
    await updateChat(c.ws, o.id, { archived: true });
    await ingestEvents(c.number, [inbound(other, later())]);
    expect((await getChat(c.ws, o.id))!.archived).toBe(false);
  });

  it('mandar desde acá o desde el teléfono, y el aviso del teléfono, no lo sacan', async () => {
    const c = await linesChat('ka-li-out', '5491100008103');
    await c.keep();
    const m = await sendMessage(c.ws, c.ws, c.id, { body: 'ahí va' });
    expect(m.status).toBe('sent');
    await ingestEvents(c.number, [inbound(c.jid, later({ fromMe: true, body: 'desde el teléfono' }))]);
    await ingestEvents(c.number, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect(await c.state()).toEqual(KEPT);
    expect(await getArchivePush('lines', c.id)).toMatchObject({ archived: 1 });
  });

  it('desarchivar a mano lo saca y apaga la marca; eliminar el chat también la apaga', async () => {
    const c = await linesChat('ka-li-manual', '5491100008104');
    await c.keep();
    await updateChat(c.ws, c.id, { archived: false });
    expect(await c.state()).toEqual({ archived: false, keep: false });
    await c.keep();
    await updateChat(c.ws, c.id, { hidden: true });
    expect(await c.state()).toEqual({ archived: false, keep: false });
  });

  it('al terminar un pospuesto sigue archivado', async () => {
    const c = await linesChat('ka-li-snooze', '5491100008105');
    await c.keep();
    await getDb().prepare('UPDATE groups_chats SET archived_at = NULL WHERE id = ?').run(c.id);
    expect(await c.state()).toEqual(KEPT);
    await c.keep(false);
    expect(await c.state()).toEqual({ archived: true, keep: false });
  });
});
