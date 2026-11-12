/**
 * Archivar en WhatsApp desde Inbox y Lines (y al revés): el cuerpo que va a
 * Evolution, los reintentos, el eco del teléfono sin ida y vuelta y el aviso en
 * vivo de las listas. Con el WhatsApp falso; nombres y números inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { applyThreadAction, listThreads, type AccountRow } from '@/lib/inbox/core';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { evolutionArchiveBody } from '@/lib/groups-provider-bridge';
import { fakeArchives, fakeFailArchives, resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getChat, getNumberRowById, ingestEvents, listChats, updateChat, type NumberRow } from '@/lib/groups';
import { ECHO_WINDOW_MS, RETRY_BACKOFF_MS, flushArchivePush, getArchivePush, isArchiveEcho, pickRef, runArchivePushes, secondsOf } from '@/lib/wa-archive-sync';
import { fetchLive, latestLiveId, liveBatch, livePoll } from '@/lib/wa-live';
import { WA_LIVE_MESSAGE_TRIGGERS, WA_LIVE_TRIGGERS } from '@/lib/schema/wa-live-triggers';
import { makeUser } from './helpers';
import { planOf } from './read-probe';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);

const T0 = Math.floor(Date.parse('2026-11-10T15:00:00.000Z') / 1000);

function inbound(chatId: string, over: Record<string, unknown> = {}) {
  return {
    type: 'message' as const,
    chatId,
    isGroup: chatId.endsWith('@g.us'),
    fromMe: false,
    senderPhone: chatId.endsWith('@g.us') ? '5491177770001' : chatId.replace(/@.*/, ''),
    senderName: 'Lucía Prueba',
    providerMessageId: `m-${Math.random().toString(36).slice(2)}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  };
}

async function inboxSetup(label: string): Promise<{ owner: string; account: AccountRow }> {
  const u = await makeUser(label);
  const { account } = await connectWhatsapp(u.id);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
  const s = fakeState(`inbox-${account.id}`);
  if (s) s.connectedAt = Date.now() - 5000;
  return { owner: u.id, account: { ...account, status: 'connected' } };
}

async function linesSetup(label: string): Promise<{ ws: string; number: NumberRow }> {
  const u = await makeUser(label);
  const n = await createNumber(u.id, u.id, { provider: 'fake' });
  await connectNumber(u.id, n.id);
  const s = fakeState(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return { ws: u.id, number: (await getNumberRowById(n.id))! };
}

describe('el cuerpo de /chat/archiveChat (Evolution)', () => {
  it('lleva la clave completa y la hora en segundos (también si llega en milisegundos)', () => {
    const jid = '5491100004001@s.whatsapp.net';
    expect(evolutionArchiveBody(jid, true, { id: 'ABC1', fromMe: false, timestamp: T0 })).toEqual({
      chat: jid,
      archive: true,
      lastMessage: { key: { remoteJid: jid, fromMe: false, id: 'ABC1' }, messageTimestamp: T0 },
    });
    const ms = evolutionArchiveBody(jid, false, { id: 'ABC2', fromMe: true, timestamp: T0 * 1000 + 512 });
    expect((ms.lastMessage as { messageTimestamp: number }).messageTimestamp).toBe(T0);
  });

  it('en un grupo, un mensaje ajeno va con quién lo mandó; sin eso (o sin mensaje) va solo el chat', () => {
    const gid = '120363000000004001@g.us';
    expect(evolutionArchiveBody(gid, true, { id: 'G1', fromMe: false, timestamp: T0, participant: '5491100004002@s.whatsapp.net' }).lastMessage).toEqual({
      key: { remoteJid: gid, fromMe: false, id: 'G1', participant: '5491100004002@s.whatsapp.net' },
      messageTimestamp: T0,
    });
    expect(evolutionArchiveBody(gid, true, { id: 'G2', fromMe: true, timestamp: T0 }).lastMessage).toEqual({ key: { remoteJid: gid, fromMe: true, id: 'G2' }, messageTimestamp: T0 });
    expect(evolutionArchiveBody(gid, true, { id: 'G3', fromMe: false, timestamp: T0 })).toEqual({ chat: gid, archive: true });
    expect(evolutionArchiveBody(gid, true)).toEqual({ chat: gid, archive: true });
    // Nunca una clave con id vacío ni una hora inválida (Evolution responde 400).
    expect(evolutionArchiveBody(gid, true, { id: '', fromMe: true, timestamp: T0 })).toEqual({ chat: gid, archive: true });
    expect(evolutionArchiveBody(gid, true, { id: 'G4', fromMe: true, timestamp: Number.NaN })).toEqual({ chat: gid, archive: true });
  });

  it('elige el mensaje más nuevo que sirve y lee las fechas de SQLite como UTC', () => {
    expect(secondsOf('2026-11-10 15:00:00')).toBe(T0);
    expect(secondsOf('2026-11-10T15:00:00.000Z')).toBe(T0);
    const rows = [
      { id: 'n1', fromMe: false, at: '2026-11-10T15:00:03.000Z', sender: '' },
      { id: 'n2', fromMe: false, at: '2026-11-10T15:00:02.000Z', sender: '5491100004003' },
    ];
    expect(pickRef(rows, true)).toEqual({ id: 'n2', fromMe: false, timestamp: T0 + 2, participant: '5491100004003@s.whatsapp.net' });
    expect(pickRef(rows, false)).toEqual({ id: 'n1', fromMe: false, timestamp: T0 + 3 });
    expect(pickRef([], false)).toBeUndefined();
  });
});

describe('Inbox → WhatsApp', () => {
  it('archivar manda el mensaje más nuevo con su hora en segundos y deja el pedido como hecho', async () => {
    const { owner, account } = await inboxSetup('wa-arch-a');
    const jid = '5491100004101@s.whatsapp.net';
    const at = '2026-11-10T15:00:00.000Z';
    await ingestWhatsappEvents(account, [inbound(jid, { providerMessageId: 'OLD1', timestamp: '2026-11-10T14:00:00.000Z' }), inbound(jid, { providerMessageId: 'NEW1', timestamp: at })]);
    const [t] = await listThreads(owner);
    await applyThreadAction(owner, [t.id], { action: 'archive' });
    expect(fakeArchives(`inbox-${account.id}`)).toEqual([expect.objectContaining({ chatId: jid, archive: true, last: { id: 'NEW1', fromMe: false, timestamp: T0 } })]);
    const row = await getArchivePush('inbox', t.id);
    expect(row).toMatchObject({ archived: 1, attempts: 0, last_error: '', sent_count: 1 });
    expect(row?.done_at).toBeTruthy();
    expect(JSON.parse(row!.sent)).toMatchObject({ jid, archive: true, ts: T0 });
  });

  it('archivar y deshacer: salen los dos en orden y queda desarchivado', async () => {
    const { owner, account } = await inboxSetup('wa-arch-b');
    await ingestWhatsappEvents(account, [inbound('5491100004102@s.whatsapp.net')]);
    const [t] = await listThreads(owner);
    await applyThreadAction(owner, [t.id], { action: 'archive' });
    await applyThreadAction(owner, [t.id], { action: 'unarchive' });
    expect(fakeArchives(`inbox-${account.id}`).map((a) => a.archive)).toEqual([true, false]);
    expect(await getArchivePush('inbox', t.id)).toMatchObject({ archived: 0, version: 2, sent_count: 2 });
  });

  it('si WhatsApp falla queda para reintentar con backoff y el cron lo manda', async () => {
    const { owner, account } = await inboxSetup('wa-arch-c');
    await ingestWhatsappEvents(account, [inbound('5491100004103@s.whatsapp.net')]);
    const [t] = await listThreads(owner);
    fakeFailArchives(`inbox-${account.id}`, 1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await applyThreadAction(owner, [t.id], { action: 'archive' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unreachable'));
    warn.mockRestore();
    const failed = (await getArchivePush('inbox', t.id))!;
    expect(failed).toMatchObject({ attempts: 1, last_error: 'unreachable', done_at: null });
    expect(Date.parse(failed.next_at) - Date.now()).toBeGreaterThan(RETRY_BACKOFF_MS[0] - 5000);
    // Antes de su hora el cron no lo toca; después, sale.
    expect((await runArchivePushes()).sent).toBe(0);
    const later = new Date(Date.now() + RETRY_BACKOFF_MS[0] + 1000);
    expect((await runArchivePushes({}, later)).sent).toBeGreaterThanOrEqual(1);
    expect(await getArchivePush('inbox', t.id)).toMatchObject({ attempts: 1, last_error: '', sent_count: 1 });
    expect(fakeArchives(`inbox-${account.id}`)).toHaveLength(1);
  });

  it('un pedido que espera se descarta si el chat cambió (llegó un mensaje que lo desarchivó)', async () => {
    const { owner, account } = await inboxSetup('wa-arch-d');
    const jid = '5491100004104@s.whatsapp.net';
    await ingestWhatsappEvents(account, [inbound(jid)]);
    const [t] = await listThreads(owner);
    fakeFailArchives(`inbox-${account.id}`, 1);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await applyThreadAction(owner, [t.id], { action: 'archive' });
    await ingestWhatsappEvents(account, [inbound(jid, { body: 'volví' })]);
    expect((await listThreads(owner)).map((x) => x.id)).toContain(t.id);
    await runArchivePushes({}, new Date(Date.now() + RETRY_BACKOFF_MS[0] + 1000));
    expect(await getArchivePush('inbox', t.id)).toMatchObject({ last_error: 'superseded', sent_count: 0 });
    expect(fakeArchives(`inbox-${account.id}`)).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('una cuenta desconectada no pierde el pedido: se reintenta', async () => {
    const { owner, account } = await inboxSetup('wa-arch-e');
    await ingestWhatsappEvents(account, [inbound('5491100004105@s.whatsapp.net')]);
    const [t] = await listThreads(owner);
    await getDb().prepare("UPDATE inbox_accounts SET status = 'disconnected' WHERE id = ?").run(account.id);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await applyThreadAction(owner, [t.id], { action: 'archive' });
    expect(await getArchivePush('inbox', t.id)).toMatchObject({ attempts: 1, last_error: 'not_connected', done_at: null });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
    await runArchivePushes({}, new Date(Date.now() + RETRY_BACKOFF_MS[0] + 1000));
    expect(fakeArchives(`inbox-${account.id}`).map((a) => a.archive)).toEqual([true]);
    vi.restoreAllMocks();
  });

  it('dos corridas a la vez no mandan dos veces (claim por fila)', async () => {
    const { owner, account } = await inboxSetup('wa-arch-f');
    await ingestWhatsappEvents(account, [inbound('5491100004106@s.whatsapp.net')]);
    const [t] = await listThreads(owner);
    fakeFailArchives(`inbox-${account.id}`, 1);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await applyThreadAction(owner, [t.id], { action: 'archive' });
    const later = () => Date.now() + RETRY_BACKOFF_MS[0] + 1000;
    const out = await Promise.all([flushArchivePush('inbox', t.id, later), flushArchivePush('inbox', t.id, later), flushArchivePush('inbox', t.id, later)]);
    expect(out.filter((o) => o === 'sent')).toHaveLength(1);
    expect(fakeArchives(`inbox-${account.id}`)).toHaveLength(1);
    vi.restoreAllMocks();
  });
});

describe('WhatsApp → Inbox, sin ida y vuelta', () => {
  it('el eco de lo que mandamos no cambia nada ni genera otro envío', async () => {
    const { owner, account } = await inboxSetup('wa-echo-a');
    const jid = '5491100004201@s.whatsapp.net';
    await ingestWhatsappEvents(account, [inbound(jid)]);
    const [t] = await listThreads(owner);
    await applyThreadAction(owner, [t.id], { action: 'archive' });
    await ingestWhatsappEvents(account, [{ type: 'archive', chatId: jid, archived: true }]);
    expect((await listThreads(owner, { view: 'archived' })).map((x) => x.id)).toEqual([t.id]);
    expect(fakeArchives(`inbox-${account.id}`)).toHaveLength(1);
    expect((await getArchivePush('inbox', t.id))?.version).toBe(1);
  });

  it('archivar y deshacer enseguida: el eco viejo ("archivado") no lo vuelve a archivar', async () => {
    const { owner, account } = await inboxSetup('wa-echo-b');
    const jid = '5491100004202@s.whatsapp.net';
    await ingestWhatsappEvents(account, [inbound(jid)]);
    const [t] = await listThreads(owner);
    await applyThreadAction(owner, [t.id], { action: 'archive' });
    await applyThreadAction(owner, [t.id], { action: 'unarchive' });
    await ingestWhatsappEvents(account, [{ type: 'archive', chatId: jid, archived: true }]);
    await ingestWhatsappEvents(account, [{ type: 'archive', chatId: jid, archived: false }]);
    expect((await listThreads(owner)).map((x) => x.id)).toContain(t.id);
    expect(fakeArchives(`inbox-${account.id}`).map((a) => a.archive)).toEqual([true, false]);
  });

  it('el eco viejo se reconoce solo en la ventana; pasada, manda el teléfono', async () => {
    const { owner, account } = await inboxSetup('wa-echo-c');
    await ingestWhatsappEvents(account, [inbound('5491100004203@s.whatsapp.net')]);
    const [t] = await listThreads(owner);
    await applyThreadAction(owner, [t.id], { action: 'archive' });
    await applyThreadAction(owner, [t.id], { action: 'unarchive' });
    expect(await isArchiveEcho('inbox', t.id, true)).toBe(true);
    expect(await isArchiveEcho('inbox', t.id, true, Date.now() + ECHO_WINDOW_MS + 1000)).toBe(false);
    expect(await isArchiveEcho('inbox', t.id, false)).toBe(false);
  });

  it('el teléfono que contradice un pedido que esperaba manda, y el pedido se cancela', async () => {
    const { owner, account } = await inboxSetup('wa-echo-e');
    const jid = '5491100004205@s.whatsapp.net';
    await ingestWhatsappEvents(account, [inbound(jid)]);
    const [t] = await listThreads(owner);
    fakeFailArchives(`inbox-${account.id}`, 1);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await applyThreadAction(owner, [t.id], { action: 'archive' });
    // Recién archivado acá, la persona lo desarchiva en el teléfono: se respeta al instante.
    await ingestWhatsappEvents(account, [{ type: 'archive', chatId: jid, archived: false }]);
    expect((await listThreads(owner)).map((x) => x.id)).toContain(t.id);
    expect(await getArchivePush('inbox', t.id)).toMatchObject({ last_error: 'superseded_by_phone' });
    await runArchivePushes({}, new Date(Date.now() + RETRY_BACKOFF_MS[0] + 1000));
    expect(fakeArchives(`inbox-${account.id}`)).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('archivar desde el teléfono con el lid del chat encuentra el chat por su teléfono', async () => {
    const { owner, account } = await inboxSetup('wa-echo-d');
    const phone = '5491100004204';
    const lid = '204700000004204';
    await ingestWhatsappEvents(account, [
      { type: 'contact', chatId: `${phone}@s.whatsapp.net`, name: 'Martín Ejemplo', lid, phone },
      inbound(`${phone}@s.whatsapp.net`),
    ]);
    const [t] = await listThreads(owner);
    await ingestWhatsappEvents(account, [{ type: 'archive', chatId: `${lid}@lid`, archived: true }]);
    expect((await listThreads(owner, { view: 'archived' })).map((x) => x.id)).toEqual([t.id]);
    // Nada sale a WhatsApp por un aviso de WhatsApp.
    expect(fakeArchives(`inbox-${account.id}`)).toHaveLength(0);
    expect(await getArchivePush('inbox', t.id)).toBeUndefined();
  });
});

describe('Lines ↔ WhatsApp', () => {
  it('archivar en Lines manda a WhatsApp con el mensaje de referencia; desarchivar también', async () => {
    const { ws, number } = await linesSetup('wa-lines-a');
    const jid = '5491100004301@s.whatsapp.net';
    await ingestEvents(number, [inbound(jid, { providerMessageId: 'L-NEW', timestamp: '2026-11-10T15:00:00.000Z' })]);
    const [c] = (await listChats(ws, ws)).rows;
    await updateChat(ws, c.id, { archived: true });
    await updateChat(ws, c.id, { archived: false });
    expect(fakeArchives(number.id)).toEqual([
      expect.objectContaining({ chatId: jid, archive: true, last: { id: 'L-NEW', fromMe: false, timestamp: T0 } }),
      expect.objectContaining({ chatId: jid, archive: false }),
    ]);
    // Sin cambio de estado no se manda nada; "Eliminar chat" no toca el teléfono.
    await updateChat(ws, c.id, { archived: false });
    await updateChat(ws, c.id, { hidden: true });
    expect(fakeArchives(number.id)).toHaveLength(2);
  });

  it('en un grupo, el mensaje ajeno de referencia va con quién lo mandó', async () => {
    const { ws, number } = await linesSetup('wa-lines-b');
    const gid = '120363000000004302@g.us';
    await ingestEvents(number, [inbound(gid, { providerMessageId: 'G-1', senderPhone: '5491100004399', timestamp: '2026-11-10T15:00:00.000Z' })]);
    const c = (await listChats(ws, ws)).rows.find((r) => r.kind === 'group')!;
    await updateChat(ws, c.id, { archived: true });
    expect(fakeArchives(number.id)[0].last).toEqual({ id: 'G-1', fromMe: false, timestamp: T0, participant: '5491100004399@s.whatsapp.net' });
  });

  it('archivar o desarchivar desde el teléfono se refleja; el eco no rebota', async () => {
    const { ws, number } = await linesSetup('wa-lines-c');
    const jid = '5491100004303@s.whatsapp.net';
    await ingestEvents(number, [inbound(jid)]);
    const [c] = (await listChats(ws, ws)).rows;
    await ingestEvents(number, [{ type: 'archive', chatId: jid, archived: true }]);
    expect((await getChat(ws, c.id))!.archived).toBe(true);
    await ingestEvents(number, [{ type: 'archive', chatId: jid, archived: false }]);
    expect((await getChat(ws, c.id))!.archived).toBe(false);
    // Un chat que no existe no se crea por esto.
    await ingestEvents(number, [{ type: 'archive', chatId: '5491100004398@s.whatsapp.net', archived: true }]);
    expect((await listChats(ws, ws, { archived: true })).rows).toHaveLength(0);
    // Archivar acá y que llegue el eco: un solo envío.
    await updateChat(ws, c.id, { archived: true });
    await ingestEvents(number, [{ type: 'archive', chatId: jid, archived: true }]);
    expect(fakeArchives(number.id)).toHaveLength(1);
    expect((await getChat(ws, c.id))!.archived).toBe(true);
  });
});

describe('aviso en vivo de las listas', () => {
  it('los triggers existen (una migración que reconstruya las tablas tiene que recrearlos)', async () => {
    const rows = (await getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'wa_live_%'").all()) as Array<{ name: string }>;
    expect(rows.map((r) => r.name).sort()).toEqual([...WA_LIVE_TRIGGERS, ...WA_LIVE_MESSAGE_TRIGGERS].map(([n]) => n).sort());
  });

  it('la consulta va por índice: sin cambios no recorre la tabla', async () => {
    const plan = (await getDb()
      .prepare('EXPLAIN QUERY PLAN SELECT id, chat_id, number_id FROM wa_live_events WHERE app = ? AND scope_id = ? AND id > ? ORDER BY id LIMIT ?')
      .all('inbox', 'x', 0, 200)) as Array<{ detail: string }>;
    expect(plan.map((p) => p.detail).join(' ')).toMatch(/USING (COVERING )?INDEX idx_wa_live_scope/);
    // El plan de una escritura, por la conexión aparte de read-probe (ver planOf).
    const prune = await planOf('DELETE FROM wa_live_events WHERE created_at < ?', ['2026-01-01']);
    expect(prune.join(' ')).toMatch(/idx_wa_live_created/);
    const due = (await getDb()
      .prepare('EXPLAIN QUERY PLAN SELECT app, chat_id FROM wa_archive_push WHERE done_at IS NULL AND next_at <= ? ORDER BY next_at LIMIT ?')
      .all('2026-01-01', 10)) as Array<{ detail: string }>;
    expect(due.map((p) => p.detail).join(' ')).toMatch(/idx_wa_archive_push_due/);
  });

  it('un mensaje que saca un chat de Archivados avisa; un cambio que no mueve la lista no', async () => {
    const { owner, account } = await inboxSetup('wa-live-a');
    const viewer = { app: 'inbox' as const, owner };
    const jid = '5491100004401@s.whatsapp.net';
    await ingestWhatsappEvents(account, [inbound(jid)]);
    const [t] = await listThreads(owner);
    await applyThreadAction(owner, [t.id], { action: 'archive' });
    const before = await latestLiveId(viewer);
    expect(before).toBeGreaterThan(0);
    await getDb().prepare("UPDATE inbox_threads SET notes = 'nota privada' WHERE id = ?").run(t.id);
    expect(await latestLiveId(viewer)).toBe(before);
    expect(await livePoll(viewer, before)).toEqual({ events: [], cursor: before });
    await ingestWhatsappEvents(account, [inbound(jid, { body: 'sigo acá' })]);
    expect((await fetchLive(viewer, before)).every((e) => e.chat_id === t.id)).toBe(true);
    expect((await listThreads(owner)).map((x) => x.id)).toContain(t.id);
    const poll = await livePoll(viewer, before);
    expect(poll.events.map((e) => e.chatId)).toEqual([t.id]);
    // Otra persona no ve nada (ni lee las filas de esta).
    expect(await livePoll({ app: 'inbox', owner: 'otra-persona' }, before)).toEqual({ events: [], cursor: before });
    // Sin cursor: solo el cursor actual.
    expect(await livePoll(viewer, 0)).toEqual({ events: [], cursor: poll.cursor });
  });

  it('Lines: avisa al workspace y solo de los chats que la persona puede abrir (el acceso se consulta solo si hay avisos)', async () => {
    const { ws, number } = await linesSetup('wa-live-b');
    const viewer = { app: 'lines' as const, ws, visible: null };
    const before = await latestLiveId(viewer);
    let asked = 0;
    const only = (set: Set<string> | null) => ({
      app: 'lines' as const,
      ws,
      visible: async (ids: string[]) => {
        asked++;
        return set ?? new Set(ids);
      },
    });
    expect((await livePoll(only(null), before || 1)).events).toEqual([]);
    expect(asked).toBe(0);
    await ingestEvents(number, [inbound('5491100004402@s.whatsapp.net')]);
    const from = before || 1;
    expect((await livePoll(viewer, from)).events).toHaveLength(1);
    expect((await livePoll(only(null), from)).events).toHaveLength(1);
    expect(asked).toBe(1);
    expect((await livePoll(only(new Set(['otro-chat'])), from)).events).toEqual([]);
    expect((await livePoll({ app: 'lines', ws: 'otro-ws', visible: null }, from)).events).toEqual([]);
    expect((await livePoll({ app: 'inbox', owner: ws }, from)).events).toEqual([]);
  });

  it('una tanda de avisos del mismo chat sale una vez, y dice si mueve la lista', async () => {
    const e = (id: number, chat: string, kind: 'chat' | 'msg' = 'chat') => ({ id, chat_id: chat, number_id: 'n1', kind });
    expect(await liveBatch([e(1, 'a'), e(2, 'b', 'msg'), e(3, 'a', 'msg')], { app: 'inbox', owner: 'p' })).toEqual([
      // 'a' tuvo un cambio de lista y uno de adentro: cuenta como de lista. 'b' solo de adentro.
      { id: 3, chatId: 'a', kind: 'chat' },
      { id: 2, chatId: 'b', kind: 'msg' },
    ]);
    expect(await liveBatch([e(1, 'a')], { app: 'lines', ws: 'w', visible: async () => new Set(['z']) })).toEqual([]);
  });
});
