/**
 * "Mantener archivado" también en el teléfono (Inbox y Lines): WhatsApp saca el chat de Archivados con cada mensaje,
 * y zerosoft lo vuelve a archivar después de guardarlo, con el mensaje nuevo de referencia, una vez por chat cada 20 s.
 * El desarchivado que el gateway deriva del mensaje no apaga nada; el que hace la persona en el teléfono apaga la marca.
 * Con el WhatsApp falso; números y textos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { applyThreadAction, getThreadRow, listThreads, type AccountRow } from '@/lib/inbox/core';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { sendToThread } from '@/lib/inbox/send';
import { fakeArchives, resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getChat, getNumberRowById, ingestEvents, listChats, sendMessage, updateChat, type NumberRow } from '@/lib/groups';
import { getArchivePush, KEEP_REARCHIVE_DEBOUNCE_MS, runArchivePushes } from '@/lib/wa-archive-sync';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type FakeState = { connectedAt: number | null; failArchives?: number; failArchivesCode?: string };
const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, FakeState> }).__groupsFake.get(id);

let seq = 0;
function inbound(chatId: string, over: Record<string, unknown> = {}) {
  seq++;
  return {
    type: 'message' as const,
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: chatId.replace(/@.*/, ''),
    senderName: 'Persona Prueba',
    providerMessageId: `rk-${seq}-${Math.random().toString(36).slice(2)}`,
    body: 'texto de prueba',
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    ...over,
  };
}
/** Un mensaje nuevo, con hora creciente (el último de una tanda es el más nuevo). */
const fresh = (chatId: string, over: Record<string, unknown> = {}) => inbound(chatId, { timestamp: new Date(Date.now() + seq * 1000).toISOString(), ...over });

/** Pasado el tiempo de espera: lo que manda el cron del minuto. */
const afterDebounce = () => runArchivePushes({}, new Date(Date.now() + KEEP_REARCHIVE_DEBOUNCE_MS + 1000));

/** El pedido y el último mensaje quedan viejos: un desarchivado ahora no puede ser por un mensaje. */
async function ageEverything(app: 'inbox' | 'lines', id: string) {
  const old = new Date(Date.now() - 10 * 60_000).toISOString();
  await getDb().prepare('UPDATE wa_archive_push SET requested_at = ?, done_at = ? WHERE app = ? AND chat_id = ?').run(old, old, app, id);
  await getDb().prepare(`UPDATE ${app === 'inbox' ? 'inbox_threads' : 'groups_chats'} SET last_message_at = ? WHERE id = ?`).run(old, id);
}

async function inboxChat(label: string, phone: string) {
  const u = await makeUser(label);
  const { account: acc } = await connectWhatsapp(u.id);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(acc.id);
  const key = `inbox-${acc.id}`;
  const s = fakeState(key);
  if (s) s.connectedAt = Date.now() - 5000;
  const account: AccountRow = { ...acc, status: 'connected' };
  const jid = `${phone}@s.whatsapp.net`;
  await ingestWhatsappEvents(account, [inbound(jid)]);
  const [t] = await listThreads(u.id);
  return {
    app: 'inbox' as const,
    jid,
    id: t.id,
    fake: () => fakeState(key)!,
    ingest: (evs: Parameters<typeof ingestWhatsappEvents>[1]) => ingestWhatsappEvents(account, evs),
    keep: async (on = true) => void (await applyThreadAction(u.id, [t.id], { action: 'keepArchived', on })),
    archive: async () => void (await applyThreadAction(u.id, [t.id], { action: 'archive' })),
    send: (body: string) => sendToThread(u.id, t.id, body),
    state: async () => {
      const r = await getThreadRow(u.id, t.id);
      return { archived: !!r.archived_at || !!r.done_at, keep: r.keep_archived === 1 };
    },
    calls: () => fakeArchives(key),
  };
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
  return {
    app: 'lines' as const,
    jid,
    id: c.id,
    fake: () => fakeState(n.id)!,
    ingest: (evs: Parameters<typeof ingestEvents>[1]) => ingestEvents(number, evs),
    keep: async (on = true) => void (await updateChat(u.id, c.id, { keepArchived: on })),
    archive: async () => void (await updateChat(u.id, c.id, { archived: true })),
    send: (body: string) => sendMessage(u.id, u.id, c.id, { body }),
    state: async () => {
      const dto = (await getChat(u.id, c.id))!;
      return { archived: dto.archived, keep: dto.keepArchived };
    },
    calls: () => fakeArchives(n.id),
  };
}

const KEPT = { archived: true, keep: true };

for (const [name, make] of [
  ['Inbox', inboxChat],
  ['Lines', linesChat],
] as const) {
  describe(`${name}: re-archivar en WhatsApp un chat con "Mantener archivado"`, () => {
    const p = name === 'Inbox' ? '54911000091' : '54911000092';

    it('un mensaje que llega lo re-archiva una vez, con ese mensaje de referencia', async () => {
      const c = await make(`rk-${name}-one`, `${p}01`);
      await c.keep();
      expect(c.calls()).toHaveLength(1);
      const m = fresh(c.jid);
      await c.ingest([m]);
      // Antes de la espera no sale nada.
      expect(c.calls()).toHaveLength(1);
      await afterDebounce();
      expect(c.calls()).toHaveLength(2);
      expect(c.calls()[1]).toMatchObject({ archive: true, last: { id: m.providerMessageId } });
      expect(await c.state()).toEqual(KEPT);
      // Nada más pendiente.
      await afterDebounce();
      expect(c.calls()).toHaveLength(2);
    });

    it('una ráfaga de 10 mensajes hace un solo re-archivado, con el último', async () => {
      const c = await make(`rk-${name}-burst`, `${p}02`);
      await c.keep();
      const burst = Array.from({ length: 10 }, () => fresh(c.jid));
      for (const m of burst) await c.ingest([m]);
      await afterDebounce();
      expect(c.calls()).toHaveLength(2);
      expect(c.calls()[1]).toMatchObject({ archive: true, last: { id: burst[9].providerMessageId } });
    });

    it('lo que sale desde acá también lo re-archiva', async () => {
      const c = await make(`rk-${name}-send`, `${p}03`);
      await c.keep();
      await c.send('respuesta de prueba');
      await afterDebounce();
      expect(c.calls().map((a) => a.archive)).toEqual([true, true]);
      expect(await c.state()).toEqual(KEPT);
    });

    it('un chat archivado sin la marca no se re-archiva', async () => {
      const c = await make(`rk-${name}-plain`, `${p}04`);
      await c.archive();
      const before = c.calls().length;
      await c.ingest([fresh(c.jid)]);
      await afterDebounce();
      expect(c.calls()).toHaveLength(before);
    });

    it('el desarchivado que WhatsApp hace por el mensaje no cancela el re-archivado ni apaga la marca', async () => {
      const c = await make(`rk-${name}-msgunarch`, `${p}05`);
      await c.keep();
      await ageEverything(c.app, c.id);
      await c.ingest([fresh(c.jid)]);
      await c.ingest([{ type: 'archive', chatId: c.jid, archived: false }]);
      expect(await c.state()).toEqual(KEPT);
      expect(await getArchivePush(c.app, c.id)).toMatchObject({ archived: 1, done_at: null });
      await afterDebounce();
      expect(c.calls()).toHaveLength(2);
    });

    it('desarchivarlo a mano en el teléfono apaga la marca y deja de re-archivarlo', async () => {
      const c = await make(`rk-${name}-phone`, `${p}06`);
      await c.keep();
      await ageEverything(c.app, c.id);
      await c.ingest([{ type: 'archive', chatId: c.jid, archived: false }]);
      expect(await c.state()).toEqual({ archived: false, keep: false });
      await c.ingest([fresh(c.jid)]);
      await afterDebounce();
      expect(c.calls()).toHaveLength(1);
    });

    it('si WhatsApp falla, el webhook no falla y el pedido queda para el reintento', async () => {
      const c = await make(`rk-${name}-fail`, `${p}07`);
      await c.keep();
      c.fake().failArchives = 3;
      await expect(c.ingest([fresh(c.jid)])).resolves.toBeTruthy();
      await expect(afterDebounce()).resolves.toMatchObject({ failed: 1 });
      expect(await getArchivePush(c.app, c.id)).toMatchObject({ archived: 1, attempts: 1, done_at: null });
      // Más mensajes mientras espera el reintento no lo adelantan ni suman pedidos.
      await c.ingest([fresh(c.jid)]);
      expect(await getArchivePush(c.app, c.id)).toMatchObject({ attempts: 1 });
    });

    it('una línea que no puede sincronizar el archivado no anota re-archivados', async () => {
      const c = await make(`rk-${name}-syncerr`, `${p}08`);
      await c.keep();
      const table = c.app === 'inbox' ? 'inbox_accounts' : 'groups_numbers';
      const col = c.app === 'inbox' ? 'account_id' : 'number_id';
      const parent = c.app === 'inbox' ? 'inbox_threads' : 'groups_chats';
      await getDb().prepare(`UPDATE ${table} SET archive_sync_error = 'app_state_unavailable' WHERE id = (SELECT ${col} FROM ${parent} WHERE id = ?)`).run(c.id);
      const version = (await getArchivePush(c.app, c.id))!.version;
      await c.ingest([fresh(c.jid)]);
      expect((await getArchivePush(c.app, c.id))!.version).toBe(version);
    });
  });
}
