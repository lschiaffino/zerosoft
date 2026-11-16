/**
 * Mandar un mensaje desarchiva el chat (Inbox y Lines), como WhatsApp: cualquier tipo de mensaje, reenvíos,
 * programados cuando salen, envíos masivos, la API y lo mandado desde el teléfono. Las reacciones no. A WhatsApp no
 * se le manda nada (lo hace solo) y el aviso que devuelve se reconoce como eco. Con el WhatsApp falso; nombres y
 * números inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMessage, applyThreadAction, createScheduled, getThreadRow, listThreads, type AccountRow } from '@/lib/inbox/core';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { sendScheduledNow, sendToThread } from '@/lib/inbox/send';
import { forwardMessage as forwardInbox, reactToMessage as reactInbox, sendWaCard, sendWaReply } from '@/lib/inbox/wa-actions';
import { sendWhatsappMedia } from '@/lib/inbox/wa-media';
import { fakeArchives, fakeFailArchives, fakePng, resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getChat, getNumberRowById, ingestEvents, listChats, reactToMessage, sendMessage, touchChat, updateChat, type NumberRow } from '@/lib/groups';
import { forwardMessage as forwardLines } from '@/lib/groups-inbox';
import { createBroadcast, processBroadcasts } from '@/lib/groups-broadcasts';
import { UNARCHIVED_BY_SEND, getArchivePush, runArchivePushes } from '@/lib/wa-archive-sync';
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

/** Lo mandado desde el teléfono: el eco fromMe del webhook. */
const fromPhone = (chatId: string, over: Record<string, unknown> = {}) => inbound(chatId, { fromMe: true, body: 'desde el teléfono', timestamp: new Date().toISOString(), ...over });

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
  const archive = async (action: 'archive' | 'done' = 'archive') => void (await applyThreadAction(u.id, [t.id], { action }));
  const state = async () => {
    const r = await getThreadRow(u.id, t.id);
    return { archived: !!r.archived_at, done: !!r.done_at };
  };
  return { owner: u.id, account, jid, id: t.id, archive, state, calls: () => fakeArchives(`inbox-${account.id}`) };
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
  const archive = async () => void (await updateChat(u.id, c.id, { archived: true }));
  const archived = async () => (await getChat(u.id, c.id))!.archived;
  return { ws: u.id, number, jid, id: c.id, archive, archived, calls: () => fakeArchives(number.id) };
}

const NONE = { archived: false, done: false };

describe('Inbox: mandar desarchiva', () => {
  it('un texto saca el chat de Archivados sin mandarle nada a WhatsApp, y queda anotado como hecho', async () => {
    const c = await inboxChat('su-in-text', '5491100007001');
    await c.archive();
    expect(c.calls().map((a) => a.archive)).toEqual([true]);
    await sendToThread(c.owner, c.id, 'ahí va');
    expect(await c.state()).toEqual(NONE);
    expect((await listThreads(c.owner, { view: 'archived' })).map((x) => x.id)).toEqual([]);
    // Ningún desarchivado salió a WhatsApp: lo hace solo al mandar el mensaje.
    expect(c.calls().map((a) => a.archive)).toEqual([true]);
    const row = await getArchivePush('inbox', c.id);
    expect(row).toMatchObject({ archived: 0, prev_archived: 1, version: 2, last_error: UNARCHIVED_BY_SEND, sent_count: 1 });
    expect(row?.done_at).toBeTruthy();
    // El cron no tiene nada que mandar.
    expect(await runArchivePushes()).toEqual({ sent: 0, failed: 0 });
    expect(c.calls()).toHaveLength(1);
  });

  it('también si estaba "hecho" (Archivar de la barra)', async () => {
    const c = await inboxChat('su-in-done', '5491100007002');
    await c.archive('done');
    await sendToThread(c.owner, c.id, 'ahí va');
    expect(await c.state()).toEqual(NONE);
    expect(c.calls().map((a) => a.archive)).toEqual([true]);
  });

  it('encuesta, contacto, respuesta y archivo (imagen y nota de voz)', async () => {
    const c = await inboxChat('su-in-kinds', '5491100007003');
    const first = (await getDb().prepare('SELECT id FROM inbox_messages WHERE thread_id = ?').get(c.id)) as { id: string };
    const sends: Array<[string, () => Promise<unknown>]> = [
      ['poll', () => sendWaCard(c.owner, c.id, { poll: { question: '¿Cuándo?', options: ['Hoy', 'Mañana'] } })],
      ['contact', () => sendWaCard(c.owner, c.id, { contacts: [{ name: 'Contacto Prueba', phone: '5491100007099' }] })],
      ['reply', () => sendWaReply(c.owner, c.id, 'dale', first.id)],
      ['image', () => sendWhatsappMedia(c.owner, c.id, { data: fakePng(), mimetype: 'image/png', filename: 'foto.png', size: 100 })],
      ['voice', () => sendWhatsappMedia(c.owner, c.id, { data: Buffer.from('audio'), mimetype: 'audio/ogg', filename: 'nota.ogg', size: 5, kind: 'voice', duration: 2 })],
    ];
    for (const [kind, send] of sends) {
      await c.archive();
      await send();
      expect(await c.state(), kind).toEqual(NONE);
    }
    // Solo los archivados salieron a WhatsApp.
    expect(c.calls().every((a) => a.archive)).toBe(true);
  });

  it.each(['sticker', 'gif', 'location', 'video', 'document'])('donde se guarda el mensaje (%s)', async (kind) => {
    const c = await inboxChat(`su-in-${kind}`, '5491100007004');
    await c.archive('done');
    await c.archive();
    const added = await addMessage(await getThreadRow(c.owner, c.id), { externalId: `out-${kind}`, fromMe: true, body: '', kind, mediaType: kind === 'location' ? '' : kind, status: 'sent' });
    expect(added).toBe(true);
    expect(await c.state()).toEqual(NONE);
  });

  it('un reenvío desarchiva el chat de destino', async () => {
    const c = await inboxChat('su-in-fwd', '5491100007005');
    await ingestWhatsappEvents(c.account, [inbound('5491100007006@s.whatsapp.net', { body: 'para reenviar' })]);
    const other = (await listThreads(c.owner)).find((x) => x.id !== c.id)!;
    const msg = (await getDb().prepare('SELECT id FROM inbox_messages WHERE thread_id = ?').get(other.id)) as { id: string };
    await c.archive();
    await forwardInbox(c.owner, msg.id, [c.id]);
    expect(await c.state()).toEqual(NONE);
  });

  it('un programado desarchiva cuando sale, no cuando se programa', async () => {
    const c = await inboxChat('su-in-sched', '5491100007007');
    await c.archive();
    const s = await createScheduled(c.owner, c.id, 'más tarde', new Date(Date.now() + 3600_000).toISOString());
    expect((await c.state()).archived).toBe(true);
    expect((await sendScheduledNow(s.id)).sent).toBe(1);
    expect(await c.state()).toEqual(NONE);
    expect(c.calls().map((a) => a.archive)).toEqual([true]);
  });

  it('lo mandado desde el teléfono también, aunque el archivado de la cuenta esté roto', async () => {
    const c = await inboxChat('su-in-phone', '5491100007008');
    await c.archive();
    await getDb().prepare("UPDATE inbox_accounts SET archive_sync_error = 'app_state_unavailable' WHERE id = ?").run(c.account.id);
    await ingestWhatsappEvents(c.account, [fromPhone(c.jid)]);
    expect(await c.state()).toEqual(NONE);
    // El aviso de desarchivado que manda el teléfono después no cambia nada ni genera un envío.
    await ingestWhatsappEvents(c.account, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect(await c.state()).toEqual(NONE);
    expect(c.calls()).toHaveLength(1);
  });

  it('una reacción no desarchiva; tampoco un mensaje mío del historial o anterior al último', async () => {
    const c = await inboxChat('su-in-not', '5491100007009');
    const first = (await getDb().prepare('SELECT id FROM inbox_messages WHERE thread_id = ?').get(c.id)) as { id: string };
    await c.archive();
    await reactInbox(c.owner, first.id, '👍');
    await ingestWhatsappEvents(c.account, [fromPhone(c.jid, { history: true })]);
    await ingestWhatsappEvents(c.account, [fromPhone(c.jid, { timestamp: new Date(Date.now() - 3600_000).toISOString() })]);
    expect((await c.state()).archived).toBe(true);
    expect((await getArchivePush('inbox', c.id))?.archived).toBe(1);
  });

  it('un chat de email no cambia al responder', async () => {
    const c = await inboxChat('su-in-mail', '5491100007010');
    await getDb().prepare("UPDATE inbox_threads SET channel = 'gmail', done_at = ? WHERE id = ?").run(new Date().toISOString(), c.id);
    await addMessage(await getThreadRow(c.owner, c.id), { externalId: 'mail-out', fromMe: true, body: 'respuesta', status: 'sent' });
    expect((await c.state()).done).toBe(true);
  });

  it('mandar y volver a archivar (Deshacer): el desarchivado que avisa el teléfono por el mensaje es eco y no lo pisa', async () => {
    const c = await inboxChat('su-in-undo', '5491100007011');
    await c.archive();
    await sendToThread(c.owner, c.id, 'ahí va');
    await c.archive();
    await ingestWhatsappEvents(c.account, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect((await c.state()).archived).toBe(true);
    expect(c.calls().map((a) => a.archive)).toEqual([true, true]);
    expect(await getArchivePush('inbox', c.id)).toMatchObject({ archived: 1, last_error: '' });
  });

  it('un archivado que esperaba su reintento se cancela al mandar (no sale después)', async () => {
    const c = await inboxChat('su-in-pending', '5491100007012');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fakeFailArchives(`inbox-${c.account.id}`, 1);
    await c.archive();
    expect((await getArchivePush('inbox', c.id))?.done_at).toBeNull();
    await sendToThread(c.owner, c.id, 'ahí va');
    expect(await c.state()).toEqual(NONE);
    await runArchivePushes({}, new Date(Date.now() + 3600_000));
    expect(c.calls()).toHaveLength(0);
    const acc = (await getDb().prepare('SELECT archive_sync_error FROM inbox_accounts WHERE id = ?').get(c.account.id)) as { archive_sync_error: string };
    expect(acc.archive_sync_error).toBe('');
  });
});

describe('Lines: mandar desarchiva', () => {
  it('un texto saca el chat de Archivados sin mandarle nada a WhatsApp', async () => {
    const c = await linesChat('su-li-text', '5491100007101');
    await c.archive();
    await sendMessage(c.ws, c.ws, c.id, { body: 'ahí va' });
    expect(await c.archived()).toBe(false);
    expect((await listChats(c.ws, c.ws, { archived: true })).rows).toHaveLength(0);
    expect(c.calls().map((a) => a.archive)).toEqual([true]);
    const row = await getArchivePush('lines', c.id);
    expect(row).toMatchObject({ archived: 0, prev_archived: 1, last_error: UNARCHIVED_BY_SEND, scope_id: c.ws });
    expect(row?.done_at).toBeTruthy();
    expect(await runArchivePushes()).toEqual({ sent: 0, failed: 0 });
  });

  it('encuesta, contacto, respuesta, archivo, nota de voz, sticker, la API y el asistente', async () => {
    const c = await linesChat('su-li-kinds', '5491100007102');
    const first = (await getDb().prepare("SELECT id FROM groups_messages WHERE chat_id = ? AND direction = 'in'").get(c.id)) as { id: string };
    const file = (kind: 'voice' | 'sticker' | null, mimetype: string, filename: string) => ({ url: `https://files.example.com/${filename}`, mimetype, filename, kind });
    const sends: Array<[string, Parameters<typeof sendMessage>[3]]> = [
      ['poll', { body: '', poll: { question: '¿Cuándo?', options: ['Hoy', 'Mañana'], multi: false } }],
      ['contact', { body: '', contacts: [{ name: 'Contacto Prueba', phone: '5491100007199' }] }],
      ['reply', { body: 'dale', replyToId: first.id }],
      ['image', { body: '', media: file(null, 'image/png', 'foto.png') }],
      ['voice', { body: '', media: file('voice', 'audio/ogg', 'nota.ogg') }],
      ['sticker', { body: '', media: file('sticker', 'image/webp', 'sticker.webp') }],
      ['api', { body: 'por la API', authorKind: 'api' }],
      ['agent', { body: 'del asistente', authorKind: 'agent' }],
    ];
    for (const [kind, input] of sends) {
      await c.archive();
      const m = await sendMessage(c.ws, c.ws, c.id, input);
      expect(m.status, kind).toBe('sent');
      expect(await c.archived(), kind).toBe(false);
    }
    expect(c.calls().every((a) => a.archive)).toBe(true);
  });

  it('una nota interna, una reacción, un envío que falló y una llamada no desarchivan', async () => {
    const c = await linesChat('su-li-not', '5491100007103');
    const first = (await getDb().prepare("SELECT id FROM groups_messages WHERE chat_id = ? AND direction = 'in'").get(c.id)) as { id: string };
    await c.archive();
    await sendMessage(c.ws, c.ws, c.id, { body: 'solo para el equipo', note: true });
    await reactToMessage(c.ws, c.ws, first.id, '👍');
    // Lo que deja un envío fallido o una llamada: el chat se toca sin desarchivar.
    await touchChat(c.id, new Date().toISOString(), 'no salió', false, false);
    expect(await c.archived()).toBe(true);
    expect((await getArchivePush('lines', c.id))?.archived).toBe(1);
  });

  it('un reenvío desarchiva el chat de destino', async () => {
    const c = await linesChat('su-li-fwd', '5491100007104');
    await ingestEvents(c.number, [inbound('5491100007105@s.whatsapp.net', { body: 'para reenviar' })]);
    const msg = (await getDb().prepare("SELECT id FROM groups_messages WHERE user_id = ? AND chat_id <> ? AND direction = 'in'").get(c.ws, c.id)) as { id: string };
    await c.archive();
    const out = await forwardLines(c.ws, c.ws, msg.id, [c.id]);
    expect(out.map((o) => o.ok)).toEqual([true]);
    expect(await c.archived()).toBe(false);
  });

  it('un programado desarchiva cuando sale, y un envío masivo desarchiva cada chat que recibe', async () => {
    const c = await linesChat('su-li-sched', '5491100007106');
    await ingestEvents(c.number, [inbound('5491100007107@s.whatsapp.net')]);
    const other = (await listChats(c.ws, c.ws)).rows.find((r) => r.id !== c.id)!;
    await c.archive();
    const later = await createBroadcast(c.ws, c.ws, { body: 'más tarde', chatIds: [c.id], kind: 'scheduled', scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(await c.archived()).toBe(true);
    await processBroadcasts({ now: new Date(Date.now() + 2 * 3600_000), gapMs: 0, broadcastId: later.id });
    expect(await c.archived()).toBe(false);

    await c.archive();
    await updateChat(c.ws, other.id, { archived: true });
    const mass = await createBroadcast(c.ws, c.ws, { body: 'para todos', chatIds: [c.id, other.id], scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    await processBroadcasts({ now: new Date(Date.now() + 2 * 3600_000), gapMs: 0, broadcastId: mass.id });
    expect(await c.archived()).toBe(false);
    expect((await getChat(c.ws, other.id))!.archived).toBe(false);
    expect(c.calls().every((a) => a.archive)).toBe(true);
  });

  it('lo mandado desde el teléfono también, aunque el archivado del número esté roto; el historial no', async () => {
    const c = await linesChat('su-li-phone', '5491100007108');
    await c.archive();
    await getDb().prepare("UPDATE groups_numbers SET archive_sync_error = 'app_state_unavailable' WHERE id = ?").run(c.number.id);
    await ingestEvents(c.number, [fromPhone(c.jid, { history: true })]);
    await ingestEvents(c.number, [fromPhone(c.jid, { timestamp: new Date(Date.now() - 3600_000).toISOString() })]);
    expect(await c.archived()).toBe(true);
    await ingestEvents(c.number, [fromPhone(c.jid)]);
    expect(await c.archived()).toBe(false);
    await ingestEvents(c.number, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect(await c.archived()).toBe(false);
    expect(c.calls()).toHaveLength(1);
  });

  it('mandar y volver a archivar (Deshacer): el desarchivado que avisa el teléfono por el mensaje es eco y no lo pisa', async () => {
    const c = await linesChat('su-li-undo', '5491100007109');
    await c.archive();
    await sendMessage(c.ws, c.ws, c.id, { body: 'ahí va' });
    await c.archive();
    await ingestEvents(c.number, [{ type: 'archive', chatId: c.jid, archived: false }]);
    expect(await c.archived()).toBe(true);
    expect(c.calls().map((a) => a.archive)).toEqual([true, true]);
  });
});
