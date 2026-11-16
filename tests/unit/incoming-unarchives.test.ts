/**
 * Un mensaje que llega a un chat archivado lo desarchiva (Inbox y Lines), como WhatsApp con "Mantener chats
 * archivados" apagado: también si está silenciado. "Mantener archivado" del chat siempre gana, y en Lines el ajuste
 * del workspace (ahora apagado por defecto) sigue disponible. El aviso del teléfono no lo pisa ni genera envíos.
 * Con el WhatsApp falso; nombres y números inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { applyThreadAction, getThreadRow, listThreads, type AccountRow } from '@/lib/inbox/core';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { fakeArchives, resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getChat, getNumberRowById, getSettings, ingestEvents, listChats, updateChat, updateSettings, type NumberRow } from '@/lib/groups';
import migration from '@/lib/schema/migration-files/20261116_0545_lines_incoming_unarchives';
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
const now = (over: Record<string, unknown> = {}) => ({ timestamp: new Date().toISOString(), ...over });

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
  const archived = async () => {
    const r = await getThreadRow(u.id, t.id);
    return !!r.archived_at || !!r.done_at;
  };
  return { owner: u.id, account, jid, id: t.id, archived, calls: () => fakeArchives(`inbox-${account.id}`) };
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
  const archived = async () => (await getChat(u.id, c.id))!.archived;
  return { ws: u.id, number, jid, id: c.id, archived, calls: () => fakeArchives(number.id) };
}

describe('Inbox: un mensaje que llega desarchiva', () => {
  it('un chat archivado o "hecho" vuelve a la bandeja', async () => {
    const c = await inboxChat('iu-in-a', '5491100009001');
    for (const action of ['archive', 'done'] as const) {
      await applyThreadAction(c.owner, [c.id], { action });
      await ingestWhatsappEvents(c.account, [inbound(c.jid, now())]);
      expect(await c.archived(), action).toBe(false);
    }
  });

  it('también si está silenciado (como WhatsApp)', async () => {
    const c = await inboxChat('iu-in-muted', '5491100009002');
    await applyThreadAction(c.owner, [c.id], { action: 'mute', until: new Date(Date.now() + 86_400_000).toISOString() });
    await applyThreadAction(c.owner, [c.id], { action: 'archive' });
    await ingestWhatsappEvents(c.account, [inbound(c.jid, now())]);
    expect(await c.archived()).toBe(false);
  });

  it('"Mantener archivado" del chat gana, también silenciado', async () => {
    const c = await inboxChat('iu-in-keep', '5491100009003');
    await applyThreadAction(c.owner, [c.id], { action: 'mute', until: new Date(Date.now() + 86_400_000).toISOString() });
    await applyThreadAction(c.owner, [c.id], { action: 'keepArchived', on: true });
    await ingestWhatsappEvents(c.account, [inbound(c.jid, now())]);
    expect(await c.archived()).toBe(true);
  });

  it('el aviso del teléfono no lo pisa ni manda nada; un mensaje del historial no desarchiva', async () => {
    const c = await inboxChat('iu-in-phone', '5491100009004');
    await applyThreadAction(c.owner, [c.id], { action: 'archive' });
    await ingestWhatsappEvents(c.account, [inbound(c.jid, now({ history: true }))], { history: true });
    expect(await c.archived()).toBe(true);
    await ingestWhatsappEvents(c.account, [inbound(c.jid, now())]);
    await ingestWhatsappEvents(c.account, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect(await c.archived()).toBe(false);
    expect(c.calls().map((a) => a.archive)).toEqual([true]);
  });
});

describe('Lines: un mensaje que llega desarchiva', () => {
  it('por defecto el chat vuelve a la lista, también silenciado; el aviso del teléfono no manda nada', async () => {
    const c = await linesChat('iu-li-a', '5491100009101');
    expect((await getSettings(c.ws)).keepArchived).toBe(false);
    await updateChat(c.ws, c.id, { muted: true });
    await updateChat(c.ws, c.id, { archived: true });
    await ingestEvents(c.number, [inbound(c.jid, now())]);
    expect(await c.archived()).toBe(false);
    await ingestEvents(c.number, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect(await c.archived()).toBe(false);
    expect(c.calls().map((a) => a.archive)).toEqual([true]);
  });

  it('"Mantener archivado" del chat gana; el ajuste del workspace sigue disponible', async () => {
    const c = await linesChat('iu-li-keep', '5491100009102');
    await updateChat(c.ws, c.id, { keepArchived: true });
    await ingestEvents(c.number, [inbound(c.jid, now())]);
    expect(await c.archived()).toBe(true);
    await updateChat(c.ws, c.id, { keepArchived: false });
    await updateSettings(c.ws, { keepArchived: true });
    await ingestEvents(c.number, [inbound(c.jid, now())]);
    expect(await c.archived()).toBe(true);
  });

  it('la migración apaga el ajuste en los workspaces que lo tenían guardado prendido', async () => {
    const c = await linesChat('iu-li-mig', '5491100009103');
    const other = await makeUser('iu-li-mig-other');
    await updateSettings(c.ws, { keepArchived: true, readReceipts: true });
    await updateSettings(other.id, { keepArchived: false });
    const client = { execute: async (sql: string) => void (await getDb().prepare(sql).run()) };
    await migration.up(client as unknown as Parameters<typeof migration.up>[0]);
    await migration.up(client as unknown as Parameters<typeof migration.up>[0]);
    expect(await getSettings(c.ws)).toMatchObject({ keepArchived: false, readReceipts: true });
    expect((await getSettings(other.id)).keepArchived).toBe(false);
  });
});
