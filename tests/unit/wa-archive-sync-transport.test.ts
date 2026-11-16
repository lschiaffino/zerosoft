/**
 * Archivado entre zerosoft y WhatsApp, con las formas que mandó y recibió
 * Evolution en producción el 15/11 (ids, números y nombres inventados):
 * - de acá al teléfono: un 1:1 va con el lid cuando la libreta lo conoce (así
 *   guarda WhatsApp el archivado), y con el número si eso falla; el 500 de
 *   Evolution sin `lastMessage` pasa a la referencia nuestra;
 * - del teléfono acá: el CHATS_UPDATE del parche 0001 (por lid y por grupo),
 *   el "no archivado" que Baileys manda con cada mensaje, y en Inbox lo
 *   "hecho" cuenta como archivado;
 * - el eco de lo nuestro no cambia nada y lo viejo no deshace lo nuevo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { applyThreadAction, listThreads, type AccountRow } from '@/lib/inbox/core';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { evolutionProvider, parseEvolutionWebhook } from '@/lib/groups-provider-bridge';
import { fakeArchives, fakeFailArchives, resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getChat, getNumberRowById, ingestEvents, listChats, updateChat, type NumberRow } from '@/lib/groups';
import { getArchivePush } from '@/lib/wa-archive-sync';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  // El host inventado de Evolution no pasa la guarda de URLs (como en groups-wa2.test.ts).
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
  resetFakeProvider();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);
const INSTANCE = '00000000-0000-4000-8000-000000000000';

/** CHATS_UPDATE de Evolution con el parche 0001: el estado que cambió en el teléfono (app-state) o con un mensaje. */
function chatsUpdate(rows: Array<Record<string, unknown>>) {
  return { event: 'chats.update', instance: 'zs-test', data: rows.map((r) => ({ instanceId: INSTANCE, ...r })) };
}

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

describe('el webhook: las formas que manda Evolution', () => {
  it('el archivado del teléfono (por lid y por grupo) y el "no archivado" de cada mensaje', () => {
    const events = parseEvolutionWebhook(
      chatsUpdate([
        { remoteJid: '204700000005101@lid', archived: true },
        { remoteJid: '120363000000005102@g.us', archived: false, unreadCount: 2 },
        // Sin `archived` (Evolution sin el parche, o un cambio de otra cosa): no es un archivado.
        { remoteJid: '5491100005103@s.whatsapp.net', pinned: 0 },
        { remoteJid: 'status@broadcast', archived: true },
      ]),
    );
    expect(events).toEqual([
      { type: 'archive', chatId: '204700000005101@lid', archived: true },
      { type: 'archive', chatId: '120363000000005102@g.us', archived: false },
    ]);
  });
});

describe('zerosoft → WhatsApp: con qué id sale', () => {
  it('Inbox: si el lid falla, el mismo intento va con el número (una sola orden que llega)', async () => {
    const { owner, account } = await inboxSetup('wa-tr-a');
    const phone = '5491100005201';
    await ingestWhatsappEvents(account, [{ type: 'contact', chatId: `${phone}@s.whatsapp.net`, name: 'Paula Ejemplo', lid: '204700000005201', phone }, inbound(`${phone}@s.whatsapp.net`)]);
    const [t] = await listThreads(owner);
    fakeFailArchives(`inbox-${account.id}`, 1);
    await applyThreadAction(owner, [t.id], { action: 'done' });
    expect(fakeArchives(`inbox-${account.id}`).map((a) => [a.chatId, a.archive])).toEqual([[`${phone}@s.whatsapp.net`, true]]);
    const row = (await getArchivePush('inbox', t.id))!;
    expect(row).toMatchObject({ sent_count: 1, last_error: '' });
    expect(JSON.parse(row.sent)).toMatchObject({ jid: `${phone}@s.whatsapp.net`, mainFailed: true });
  });

  it('Inbox: sin lid conocido sale con el número; un grupo, con su id', async () => {
    const { owner, account } = await inboxSetup('wa-tr-b');
    await ingestWhatsappEvents(account, [inbound('5491100005202@s.whatsapp.net'), inbound('120363000000005202@g.us')]);
    const ids = (await listThreads(owner)).map((x) => x.id);
    await applyThreadAction(owner, ids, { action: 'archive' });
    expect(fakeArchives(`inbox-${account.id}`).map((a) => a.chatId).sort()).toEqual(['120363000000005202@g.us', '5491100005202@s.whatsapp.net']);
  });

  it('Lines: un 1:1 con lid conocido sale con el lid', async () => {
    const { ws, number } = await linesSetup('wa-tr-c');
    const phone = '5491100005203';
    await ingestEvents(number, [{ type: 'contact', chatId: `${phone}@s.whatsapp.net`, name: 'Martín Ejemplo', lid: '204700000005203', phone }, inbound(`${phone}@s.whatsapp.net`)]);
    const [c] = (await listChats(ws, ws)).rows;
    await updateChat(ws, c.id, { archived: true });
    expect(fakeArchives(number.id).map((a) => [a.chatId, a.archive])).toEqual([['204700000005203@lid', true]]);
  });

  it('Evolution: el 500 de /chat/archiveChat sin lastMessage (2.3.7 sin el parche 0007) pasa a la referencia nuestra', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (_input: string | URL | Request, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      bodies.push(body);
      if (body && !('lastMessage' in body)) {
        return Response.json(
          { status: 500, error: 'Internal Server Error', response: { archived: false, message: ['An error occurred while archiving the chat. Open a calling.', 'PrismaClientValidationError'] } },
          { status: 500 },
        );
      }
      return Response.json({ chatId: body?.lastMessage?.key?.remoteJid, archived: true }, { status: 201 });
    });
    const p = evolutionProvider({ baseUrl: 'https://evo.example.test', apiKey: 'k', session: 'zs' });
    const lid = '204700000005204@lid';
    await p.archiveChat!(lid, false, { id: 'R1', fromMe: true, timestamp: 1_800_000_000 });
    expect(bodies).toEqual([
      { chat: lid, archive: false },
      { chat: lid, archive: false, lastMessage: { key: { remoteJid: lid, fromMe: true, id: 'R1' }, messageTimestamp: 1_800_000_000 } },
    ]);
  });
});

describe('WhatsApp → zerosoft', () => {
  it('Inbox: archivar en el teléfono (llega por lid) lo archiva; desarchivar un chat "hecho" acá lo vuelve a la bandeja', async () => {
    const { owner, account } = await inboxSetup('wa-tr-d');
    const phone = '5491100005301';
    const lid = '204700000005301';
    await ingestWhatsappEvents(account, [{ type: 'contact', chatId: `${phone}@s.whatsapp.net`, name: 'Ana Ejemplo', lid, phone }, inbound(`${phone}@s.whatsapp.net`)]);
    const [t] = await listThreads(owner);
    await ingestWhatsappEvents(account, parseEvolutionWebhook(chatsUpdate([{ remoteJid: `${lid}@lid`, archived: true }])));
    expect((await listThreads(owner, { view: 'archived' })).map((x) => x.id)).toEqual([t.id]);
    await ingestWhatsappEvents(account, parseEvolutionWebhook(chatsUpdate([{ remoteJid: `${lid}@lid`, archived: false }])));
    expect((await listThreads(owner)).map((x) => x.id)).toEqual([t.id]);

    // "Archivar" de la barra es "hecho": el teléfono que lo desarchiva lo trae de vuelta (antes no pasaba nada).
    await getDb().prepare('UPDATE inbox_threads SET done_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), t.id);
    await ingestWhatsappEvents(account, parseEvolutionWebhook(chatsUpdate([{ remoteJid: `${lid}@lid`, archived: false }])));
    expect((await listThreads(owner)).map((x) => x.id)).toEqual([t.id]);
    // Nada sale a WhatsApp por un aviso de WhatsApp.
    expect(fakeArchives(`inbox-${account.id}`)).toHaveLength(0);
  });

  it('Inbox: el eco de "hecho" no cambia nada; el eco viejo de hecho→bandeja no lo vuelve a archivar', async () => {
    const { owner, account } = await inboxSetup('wa-tr-e');
    const jid = '120363000000005302@g.us';
    await ingestWhatsappEvents(account, [inbound(jid)]);
    const [t] = await listThreads(owner);
    await applyThreadAction(owner, [t.id], { action: 'done' });
    await ingestWhatsappEvents(account, parseEvolutionWebhook(chatsUpdate([{ remoteJid: jid, archived: true }])));
    const done = await getDb().prepare('SELECT done_at, archived_at FROM inbox_threads WHERE id = ?').get(t.id) as { done_at: string | null; archived_at: string | null };
    expect(done.done_at).toBeTruthy();
    expect(done.archived_at).toBeNull();
    await applyThreadAction(owner, [t.id], { action: 'undone' });
    // Llega tarde el eco del "hecho": no lo archiva otra vez.
    await ingestWhatsappEvents(account, parseEvolutionWebhook(chatsUpdate([{ remoteJid: jid, archived: true }])));
    expect((await listThreads(owner)).map((x) => x.id)).toEqual([t.id]);
    expect(fakeArchives(`inbox-${account.id}`).map((a) => a.archive)).toEqual([true, false]);
  });

  it('Inbox: con la línea marcada sin sincronizar, el "no archivado" de un mensaje no saca lo "hecho" acá', async () => {
    const { owner, account } = await inboxSetup('wa-tr-f');
    const jid = '5491100005303@s.whatsapp.net';
    await ingestWhatsappEvents(account, [inbound(jid)]);
    const [t] = await listThreads(owner);
    await getDb().prepare("UPDATE inbox_accounts SET archive_sync_error = 'app_state_unavailable' WHERE id = ?").run(account.id);
    await getDb().prepare('UPDATE inbox_threads SET done_at = ? WHERE id = ?').run(new Date().toISOString(), t.id);
    await ingestWhatsappEvents(account, parseEvolutionWebhook(chatsUpdate([{ remoteJid: jid, archived: false, unreadCount: 1 }])));
    expect((await listThreads(owner, { view: 'archived' })).map((x) => x.id)).toEqual([t.id]);
  });

  it('Lines: archivar y desarchivar en el teléfono (por lid); el eco de lo nuestro no rebota', async () => {
    const { ws, number } = await linesSetup('wa-tr-g');
    const phone = '5491100005304';
    const lid = '204700000005304';
    await ingestEvents(number, [{ type: 'contact', chatId: `${phone}@s.whatsapp.net`, name: 'Sofía Ejemplo', lid, phone }, inbound(`${phone}@s.whatsapp.net`)]);
    const [c] = (await listChats(ws, ws)).rows;
    await ingestEvents(number, parseEvolutionWebhook(chatsUpdate([{ remoteJid: `${lid}@lid`, archived: true }])));
    expect((await getChat(ws, c.id))!.archived).toBe(true);
    await ingestEvents(number, parseEvolutionWebhook(chatsUpdate([{ remoteJid: `${lid}@lid`, archived: false }])));
    expect((await getChat(ws, c.id))!.archived).toBe(false);
    expect(fakeArchives(number.id)).toHaveLength(0);
    // Archivar acá, desarchivar enseguida y que lleguen los dos ecos (el viejo primero): queda desarchivado, dos envíos.
    await updateChat(ws, c.id, { archived: true });
    await updateChat(ws, c.id, { archived: false });
    await ingestEvents(number, parseEvolutionWebhook(chatsUpdate([{ remoteJid: `${lid}@lid`, archived: true }])));
    await ingestEvents(number, parseEvolutionWebhook(chatsUpdate([{ remoteJid: `${lid}@lid`, archived: false }])));
    expect((await getChat(ws, c.id))!.archived).toBe(false);
    expect(fakeArchives(number.id).map((a) => a.archive)).toEqual([true, false]);
  });
});
