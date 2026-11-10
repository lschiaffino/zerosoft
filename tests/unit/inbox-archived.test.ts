import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { applyThreadAction, inboxCounts, listThreads } from '@/lib/inbox/core';
import { importPart, parseImport } from '@/lib/inbox/import';
import { connectWhatsapp, ingestHistoryChats, ingestWhatsappEvents, pushWhatsappArchive } from '@/lib/inbox/whatsapp';
import { actionSchema } from '@/lib/inbox/schemas';
import { parseEvolutionWebhook } from '@/lib/groups-provider-bridge';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

const DM = '5491100000801@s.whatsapp.net';
const DM2 = '5491100000802@s.whatsapp.net';

function msg(chatId: string, over: Record<string, unknown> = {}) {
  return {
    type: 'message' as const,
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: chatId.replace(/@.*/, ''),
    senderName: 'Vero',
    providerMessageId: `m-${Math.random().toString(36).slice(2)}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  };
}

async function setup(prefix: string) {
  const u = await makeUser(prefix);
  const { account } = await connectWhatsapp(u.id);
  return { u, account };
}

describe('Chats archivados de WhatsApp en Inbox', () => {
  it('archivar saca el chat de la bandeja y de los contadores; aparece en Archivados; desarchivar lo devuelve', async () => {
    const { u, account } = await setup('arch-a');
    await ingestWhatsappEvents(account, [msg(DM), msg(DM2, { senderName: 'Beto' })]);
    const [a] = (await listThreads(u.id)).filter((t) => t.handle === '5491100000801');
    await applyThreadAction(u.id, [a.id], { action: 'pin' });
    await applyThreadAction(u.id, [a.id], { action: 'archive' });
    expect((await listThreads(u.id)).map((t) => t.handle)).toEqual(['5491100000802']);
    expect((await listThreads(u.id, { view: 'whatsapp' })).map((t) => t.handle)).toEqual(['5491100000802']);
    expect((await listThreads(u.id, { view: 'pinned' }))).toHaveLength(0);
    const archived = await listThreads(u.id, { view: 'archived' });
    expect(archived.map((t) => t.handle)).toEqual(['5491100000801']);
    // Archivar suelta el fijado, como WhatsApp.
    expect(archived[0]).toMatchObject({ archived: true, pinned: false });
    const counts = await inboxCounts(u.id);
    expect(counts.archived).toBe(1);
    expect(counts.inbox).toBe(1);
    // La búsqueda mira también en Archivados.
    expect((await listThreads(u.id, { q: 'Vero' })).map((t) => t.handle)).toContain('5491100000801');
    await applyThreadAction(u.id, [a.id], { action: 'unarchive' });
    expect((await listThreads(u.id, { view: 'archived' }))).toHaveLength(0);
    expect((await listThreads(u.id)).map((t) => t.handle).sort()).toEqual(['5491100000801', '5491100000802']);
  });

  it('un mensaje nuevo saca el chat de Archivados, salvo que esté silenciado o venga del historial', async () => {
    const { u, account } = await setup('arch-b');
    await ingestWhatsappEvents(account, [msg(DM), msg(DM2, { senderName: 'Beto' })]);
    const all = await listThreads(u.id);
    const [a, b] = ['5491100000801', '5491100000802'].map((h) => all.find((t) => t.handle === h)!);
    await applyThreadAction(u.id, [a.id, b.id], { action: 'archive' });
    await applyThreadAction(u.id, [b.id], { action: 'mute', until: new Date(Date.now() + 3600_000).toISOString() });
    // Del historial: no desarchiva.
    await ingestWhatsappEvents(account, [msg(DM, { history: true, timestamp: new Date(Date.now() + 1000).toISOString() })], { history: true });
    expect((await listThreads(u.id, { view: 'archived' })).map((t) => t.handle).sort()).toEqual(['5491100000801', '5491100000802']);
    // En vivo: el normal vuelve a la bandeja, el silenciado sigue archivado.
    await ingestWhatsappEvents(account, [msg(DM, { timestamp: new Date(Date.now() + 2000).toISOString() }), msg(DM2, { timestamp: new Date(Date.now() + 2000).toISOString() })]);
    expect((await listThreads(u.id, { view: 'archived' })).map((t) => t.handle)).toEqual(['5491100000802']);
    expect((await listThreads(u.id)).map((t) => t.handle)).toEqual(['5491100000801']);
  });

  it('el historial de WhatsApp (CHATS_SET y findChats) trae los archivados marcados', async () => {
    const { u, account } = await setup('arch-c');
    const n = await ingestHistoryChats(account, [
      { remoteJid: DM, name: 'Vero', archived: true },
      { remoteJid: DM2, name: 'Beto' },
      { remoteJid: '120363041234567890@g.us', name: 'Familia', archive: true },
    ]);
    expect(n).toBe(3);
    expect((await listThreads(u.id, { view: 'archived' })).map((t) => t.title).sort()).toEqual(['Familia', 'Vero']);
    expect((await listThreads(u.id)).map((t) => t.title)).toEqual(['Beto']);
  });

  it('archivar o desarchivar desde el teléfono llega por CHATS_UPDATE y CHATS_UPSERT, en las dos direcciones', async () => {
    const { u, account } = await setup('arch-d');
    await ingestWhatsappEvents(account, [msg(DM)]);
    const upd = (event: string, row: Record<string, unknown>) => parseEvolutionWebhook({ event, instance: 'x', data: [row] });
    expect(upd('chats.update', { remoteJid: DM, archived: true })).toEqual([{ type: 'archive', chatId: DM, archived: true }]);
    expect(upd('chats.update', { remoteJid: 'status@broadcast', archived: true })).toEqual([]);
    expect(upd('chats.update', { remoteJid: DM, unreadCount: 3 })).toEqual([]);
    expect(upd('chats.upsert', { remoteJid: DM, archived: false })).toEqual(expect.arrayContaining([{ type: 'archive', chatId: DM, archived: false }]));
    await ingestWhatsappEvents(account, upd('chats.update', { remoteJid: DM, archived: true }));
    expect((await listThreads(u.id, { view: 'archived' })).map((t) => t.handle)).toEqual(['5491100000801']);
    await ingestWhatsappEvents(account, upd('chats.update', { remoteJid: DM, archived: false }));
    expect((await listThreads(u.id, { view: 'archived' }))).toHaveLength(0);
    // Un chat que Inbox no conoce no se crea por esto.
    await ingestWhatsappEvents(account, upd('chats.update', { remoteJid: '5491100000999@s.whatsapp.net', archived: true }));
    expect((await listThreads(u.id, { view: 'archived' }))).toHaveLength(0);
  });

  it('archivar en Inbox se manda a WhatsApp (y desarchivar también)', async () => {
    const { u, account } = await setup('arch-e');
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
    // El proveedor falso tarda un momento en dar la sesión por conectada.
    await new Promise((r) => setTimeout(r, 1600));
    await ingestWhatsappEvents(account, [msg(DM)]);
    const [t] = await listThreads(u.id);
    await applyThreadAction(u.id, [t.id], { action: 'archive' });
    await applyThreadAction(u.id, [t.id], { action: 'unarchive' });
    expect(fakeSent(`inbox-${account.id}`).filter((s) => s.kind === 'archive').map((s) => s.text)).toEqual(['archive', 'unarchive']);
    expect(await pushWhatsappArchive(u.id, t.id, true)).toBe(true);
  });

  it('el archivo de inbox-zero trae los archivados y la importación los deja archivados sin que los mensajes los desarchiven', async () => {
    const meta = parseImport({
      part: 'meta',
      format: 'inbox-zero-export',
      version: 2,
      chats: [
        { chatId: '5491100000801@c.us', name: 'Vero', archived: true },
        { chatId: '5491100000802@c.us', name: 'Beto' },
      ],
    });
    const messages = parseImport({
      part: 'messages',
      messages: [{ id: 'desk:1', chatId: '5491100000801@c.us', ts: Math.floor(Date.now() / 1000) - 60, fromMe: false, sender: 'Vero', type: 'chat', text: 'viejo' }],
    });
    const u = await makeUser('arch-f');
    const first = await importPart(u.id, meta);
    expect(first.archived).toBe(1);
    await importPart(u.id, messages);
    expect((await listThreads(u.id, { view: 'archived' })).map((t) => t.title)).toEqual(['Vero']);
    expect((await listThreads(u.id)).map((t) => t.title)).toEqual(['Beto']);
    // Importar de nuevo no duplica ni desarchiva.
    expect((await importPart(u.id, meta)).archived).toBe(0);
    expect((await listThreads(u.id, { view: 'archived' }))).toHaveLength(1);
  });

  it('el esquema acepta archive y unarchive', () => {
    expect(actionSchema.safeParse({ action: 'archive' }).success).toBe(true);
    expect(actionSchema.safeParse({ action: 'unarchive' }).success).toBe(true);
  });
});

function sqliteFile(file: string, sql: string) {
  const setup = `import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec(process.argv[2]); db.close();`;
  execFileSync(process.execPath, ['--input-type=module', '-e', setup, file, sql], { stdio: 'pipe' });
}

describe('Exportación de WhatsApp Desktop: chats archivados', () => {
  it('marca archived en los chats con ZARCHIVED = 1 (aunque no tengan mensajes) y no falla en una versión sin esa columna', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'zs-iz-arch-'));
    sqliteFile(path.join(dir, 'inbox.db'), 'CREATE TABLE wa_saved (msg_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, ts INTEGER NOT NULL, from_me INTEGER NOT NULL, sender TEXT, type TEXT, text TEXT, mime TEXT, fname TEXT, saved_at INTEGER NOT NULL);');
    const sec = Math.floor(Date.now() / 1000);
    const APPLE = 978307200;
    const withCol = path.join(dir, 'ChatStorage.sqlite');
    sqliteFile(
      withCol,
      `CREATE TABLE ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, ZCONTACTJID TEXT, ZPARTNERNAME TEXT, ZARCHIVED INTEGER);
       CREATE TABLE ZWAGROUPMEMBER (Z_PK INTEGER PRIMARY KEY, ZCONTACTNAME TEXT, ZFIRSTNAME TEXT, ZMEMBERJID TEXT);
       CREATE TABLE ZWAMEDIAITEM (Z_PK INTEGER PRIMARY KEY, ZMEDIALOCALPATH TEXT, ZMOVIEDURATION INTEGER, ZTITLE TEXT, ZVCARDSTRING TEXT, ZVCARDNAME TEXT);
       CREATE TABLE ZWAMESSAGE (Z_PK INTEGER PRIMARY KEY, ZSTANZAID TEXT, ZISFROMME INTEGER, ZMESSAGEDATE REAL, ZMESSAGETYPE INTEGER, ZTEXT TEXT, ZPUSHNAME TEXT, ZSTARRED INTEGER, ZCHATSESSION INTEGER, ZGROUPMEMBER INTEGER, ZMEDIAITEM INTEGER);
       INSERT INTO ZWACHATSESSION VALUES (1, '5491100000801@s.whatsapp.net', 'Vero', 1), (2, '5491100000802@s.whatsapp.net', 'Beto', 0), (3, '120363000000000555@g.us', 'Viejo grupo', 1);
       INSERT INTO ZWAMESSAGE VALUES (1, 'AAA1', 0, ${sec - 100 - APPLE}, 0, 'hola archivado', 'Vero', 0, 1, NULL, NULL), (2, 'AAA2', 0, ${sec - 90 - APPLE}, 0, 'hola normal', 'Beto', 0, 2, NULL, NULL);`,
    );
    const out = path.join(dir, 'out.ndjson');
    execFileSync(process.execPath, [path.resolve('scripts/inbox-zero-export.mjs'), dir, '--desktop=' + withCol, '--out', out], { stdio: 'pipe' });
    const meta = JSON.parse(readFileSync(out, 'utf8').split('\n')[0]) as { chats: Array<{ chatId: string; archived?: boolean }> };
    const by = new Map(meta.chats.map((c) => [c.chatId, c.archived === true]));
    expect(by.get('5491100000801@c.us')).toBe(true);
    expect(by.get('120363000000000555@g.us')).toBe(true);
    expect(by.get('5491100000802@c.us')).toBe(false);

    const without = path.join(dir, 'Old.sqlite');
    sqliteFile(
      without,
      `CREATE TABLE ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, ZCONTACTJID TEXT, ZPARTNERNAME TEXT);
       CREATE TABLE ZWAGROUPMEMBER (Z_PK INTEGER PRIMARY KEY, ZCONTACTNAME TEXT, ZFIRSTNAME TEXT, ZMEMBERJID TEXT);
       CREATE TABLE ZWAMEDIAITEM (Z_PK INTEGER PRIMARY KEY, ZMEDIALOCALPATH TEXT, ZMOVIEDURATION INTEGER, ZTITLE TEXT, ZVCARDSTRING TEXT, ZVCARDNAME TEXT);
       CREATE TABLE ZWAMESSAGE (Z_PK INTEGER PRIMARY KEY, ZSTANZAID TEXT, ZISFROMME INTEGER, ZMESSAGEDATE REAL, ZMESSAGETYPE INTEGER, ZTEXT TEXT, ZPUSHNAME TEXT, ZSTARRED INTEGER, ZCHATSESSION INTEGER, ZGROUPMEMBER INTEGER, ZMEDIAITEM INTEGER);
       INSERT INTO ZWACHATSESSION VALUES (1, '5491100000801@s.whatsapp.net', 'Vero');`,
    );
    const out2 = path.join(dir, 'out2.ndjson');
    execFileSync(process.execPath, [path.resolve('scripts/inbox-zero-export.mjs'), dir, '--desktop=' + without, '--out', out2], { stdio: 'pipe' });
    const meta2 = JSON.parse(readFileSync(out2, 'utf8').split('\n')[0]) as { chats: Array<{ archived?: boolean }> };
    expect(meta2.chats.some((c) => c.archived)).toBe(false);
  });
});
