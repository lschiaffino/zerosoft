import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { listMessages, listThreads, upsertThread } from '@/lib/inbox/core';
import { importPart, parseImport, stanzaIdOf } from '@/lib/inbox/import';
import { isInboxImportUrl, listImports, runInboxImports, setImportState, startFileImport, startWhatsappImport, stepOwnImport } from '@/lib/inbox/import-jobs';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  resetFakeProvider();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Arma una base SQLite con node:sqlite en otro proceso (como la tendría el dueño en su computadora). */
function sqliteFile(file: string, sql: string) {
  const setup = `import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec(process.argv[2]); db.close();`;
  execFileSync(process.execPath, ['--input-type=module', '-e', setup, file, sql], { stdio: 'pipe' });
}

const APPLE = 978307200;

function exportFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zs-iz-'));
  const sec = Math.floor(Date.now() / 1000);
  // inbox.db con el esquema real de inbox-zero (wa_tags sin icon ni parent_id, como una base vieja).
  sqliteFile(
    path.join(dir, 'inbox.db'),
    `
    CREATE TABLE wa_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL DEFAULT '#00a884', position INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE wa_chat_tags (chat_id TEXT NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (chat_id, tag_id));
    CREATE TABLE wa_saved (msg_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, ts INTEGER NOT NULL, from_me INTEGER NOT NULL, sender TEXT, type TEXT, text TEXT, mime TEXT, fname TEXT, saved_at INTEGER NOT NULL);
    CREATE TABLE wa_hist (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, ts INTEGER NOT NULL, from_me INTEGER NOT NULL, sender TEXT, type TEXT, text TEXT, dur INTEGER, title TEXT);
    CREATE TABLE wa_transcripts (msg_id TEXT PRIMARY KEY, text TEXT NOT NULL, lang TEXT, seconds INTEGER, model TEXT, translation TEXT, created_at INTEGER NOT NULL);
    INSERT INTO wa_tags (id, name, color, position) VALUES (1, 'Trabajo', '#3b82f6', 0);
    INSERT INTO wa_chat_tags VALUES ('5491100000501@c.us', 1);
    INSERT INTO wa_saved VALUES ('false_5491100000501@c.us_3A00000000000000AAA1', '5491100000501@c.us', ${sec - 600}, 0, 'Vero', 'chat', 'Hola, te llamo?', NULL, NULL, ${sec});
    INSERT INTO wa_hist VALUES ('false_5491100000501@c.us_3A00000000000000AAA2', '5491100000501@c.us', ${sec - 500}, 0, 'Vero', 'ptt', '', 12, NULL);
    INSERT INTO wa_transcripts VALUES ('false_5491100000501@c.us_3A00000000000000AAA2', 'dale, en cinco', 'es', 12, 'x', NULL, ${sec});
    `,
  );
  // ChatStorage.sqlite de WhatsApp Desktop (Core Data), con un mensaje que también está en wa_saved.
  const desk = path.join(dir, 'ChatStorage.sqlite');
  sqliteFile(
    desk,
    `
    CREATE TABLE ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, ZCONTACTJID TEXT, ZPARTNERNAME TEXT);
    CREATE TABLE ZWAGROUPMEMBER (Z_PK INTEGER PRIMARY KEY, ZCONTACTNAME TEXT, ZFIRSTNAME TEXT, ZMEMBERJID TEXT);
    CREATE TABLE ZWAMEDIAITEM (Z_PK INTEGER PRIMARY KEY, ZMEDIALOCALPATH TEXT, ZMOVIEDURATION INTEGER, ZTITLE TEXT, ZVCARDSTRING TEXT, ZVCARDNAME TEXT);
    CREATE TABLE ZWAMESSAGE (Z_PK INTEGER PRIMARY KEY, ZSTANZAID TEXT, ZISFROMME INTEGER, ZMESSAGEDATE REAL, ZMESSAGETYPE INTEGER, ZTEXT TEXT, ZPUSHNAME TEXT, ZSTARRED INTEGER, ZCHATSESSION INTEGER, ZGROUPMEMBER INTEGER, ZMEDIAITEM INTEGER);
    INSERT INTO ZWACHATSESSION VALUES (1, '5491100000501@s.whatsapp.net', 'Vero Trabajo'), (2, '120363000000000777@g.us', 'Equipo'), (3, 'status@broadcast', NULL);
    INSERT INTO ZWAGROUPMEMBER VALUES (1, 'Lucho', NULL, '5491100000600@s.whatsapp.net');
    INSERT INTO ZWAMEDIAITEM VALUES (1, NULL, NULL, 'contrato.pdf', NULL, NULL);
    INSERT INTO ZWAMESSAGE VALUES
      (1, '3A00000000000000AAA1', 0, ${sec - 600 - APPLE}, 0, 'Hola, te llamo?', 'Vero', 0, 1, NULL, NULL),
      (2, '3A00000000000000OLD1', 1, ${sec - 400 * 86400 - APPLE}, 0, 'Mensaje de hace más de un año', NULL, 0, 1, NULL, NULL),
      (3, '3A00000000000000GRP1', 0, ${sec - 300 - APPLE}, 0, 'Reunión a las 10', NULL, 0, 2, 1, NULL),
      (4, '3A00000000000000DOC1', 1, ${sec - 200 - APPLE}, 8, NULL, NULL, 0, 1, NULL, 1),
      (5, '3A00000000000000SYS1', 0, ${sec - 100 - APPLE}, 6, NULL, NULL, 0, 1, NULL, NULL),
      (6, '3A00000000000000STA1', 0, ${sec - 50 - APPLE}, 0, 'estado', NULL, 0, 3, NULL, NULL);
    `,
  );
  return { dir, desk };
}

function runExport(dir: string, extra: string[]): string {
  const out = path.join(dir, `export-${Math.random().toString(36).slice(2)}${extra.includes('--json') ? '.json' : '.ndjson'}`);
  execFileSync(process.execPath, [path.resolve('scripts/inbox-zero-export.mjs'), dir, '--out', out, ...extra.filter((x) => x !== '--json')], { stdio: 'pipe' });
  return readFileSync(out, 'utf8');
}

describe('Exportación de inbox-zero (NDJSON y WhatsApp Desktop)', () => {
  it('ids de WhatsApp sin el formato de whatsapp-web.js ni el prefijo de Desktop', () => {
    expect(stanzaIdOf('false_5491100000501@c.us_3A00000000000000AAA1')).toBe('3A00000000000000AAA1');
    expect(stanzaIdOf('true_120363@g.us_3EB0ABC_5491100000600@c.us')).toBe('3EB0ABC');
    expect(stanzaIdOf('desk:42')).toBe('42');
    expect(stanzaIdOf('3EB0XYZ')).toBe('3EB0XYZ');
  });

  it('una línea por parte, con Desktop y sin duplicar; importar dos veces no duplica y respeta lo que ya trajo el servidor', async () => {
    const { dir, desk } = exportFixture();
    const raw = runExport(dir, [`--desktop=${desk}`]);
    const lines = raw.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({ part: 'meta', format: 'inbox-zero-export', version: 2 });
    const msgs = lines.slice(1).flatMap((l) => l.messages as Array<{ id: string; text: string; chatId: string }>);
    // AAA1 está en wa_saved y en Desktop: una sola vez. Mensajes de sistema y estados afuera; el año pasado adentro (sin --days).
    expect(msgs.filter((m) => m.text === 'Hola, te llamo?')).toHaveLength(1);
    expect(msgs.map((m) => m.text)).toEqual(expect.arrayContaining(['Mensaje de hace más de un año', 'Reunión a las 10', 'contrato.pdf', '🎤 dale, en cinco']));
    expect(msgs.some((m) => m.text === 'estado' || m.chatId.includes('broadcast'))).toBe(false);
    const chats = (lines[0].chats as Array<{ chatId: string; name: string }>).map((c) => [c.chatId, c.name]);
    expect(chats).toEqual(expect.arrayContaining([['5491100000501@c.us', 'Vero Trabajo']]));

    const recent = runExport(dir, [`--desktop=${desk}`, '--days', '30']);
    expect(recent).not.toContain('hace más de un año');

    const u = await makeUser('iz');
    // Lo que ya trajo el servidor de WhatsApp (mismo id de mensaje): no se duplica.
    const { account } = await connectWhatsapp(u.id);
    await ingestWhatsappEvents(account, [
      { type: 'message', chatId: '5491100000501@s.whatsapp.net', isGroup: false, fromMe: false, senderPhone: '5491100000501', senderName: 'Vero', providerMessageId: '3A00000000000000AAA1', body: 'Hola, te llamo?', timestamp: new Date().toISOString(), history: true },
    ]);
    const importAll = async () => {
      let n = 0;
      for (const l of lines) n += (await importPart(u.id, parseImport(l))).messages;
      return n;
    };
    expect(await importAll()).toBe(msgs.length - 1);
    expect(await importAll()).toBe(0);
    const vero = (await listThreads(u.id, { view: 'whatsapp' })).find((t) => t.handle === '5491100000501')!;
    // El nombre que ya tenía el chat (del servidor) se respeta.
    expect(vero.title).toBe('Vero');
    const team = (await listThreads(u.id, { view: 'groups' })).find((t) => t.title === 'Equipo');
    expect(team).toBeTruthy();
    const bodies = (await listMessages(u.id, vero.id, { limit: 50 })).messages.map((m) => m.body);
    expect(bodies.filter((b) => b === 'Hola, te llamo?')).toHaveLength(1);
  });

  it('el formato viejo (.json) sigue saliendo igual', () => {
    const { dir } = exportFixture();
    const file = JSON.parse(runExport(dir, ['--json'])) as { version: number; messages: unknown[]; folders: Array<{ parentId: unknown; icon: string }> };
    expect(file.version).toBe(1);
    expect(file.messages).toHaveLength(2);
    expect(file.folders[0]).toMatchObject({ parentId: null, icon: '' });
  });
});

describe('Importación de un archivo subido (por rangos, se retoma)', () => {
  it('lee el archivo en pedazos, importa todo y no repite si dos corridas la toman a la vez', async () => {
    const { dir, desk } = exportFixture();
    // Muchas líneas para que haga falta más de un pedido.
    const base = runExport(dir, [`--desktop=${desk}`]);
    const extra = Array.from({ length: 40 }, (_, i) =>
      JSON.stringify({ part: 'messages', messages: Array.from({ length: 50 }, (_, j) => ({ id: `BULK${i}x${j}`, chatId: '5491100000777@c.us', ts: 1_700_000_000 + i * 100 + j, fromMe: j % 2 === 0, text: `relleno ${'x'.repeat(1500)} ${i}-${j}` })) }),
    ).join('\n');
    const body = Buffer.from(`${base}${extra}\n`);
    const url = 'https://abc123.public.blob.vercel-storage.com/inbox-import/export-Xyz.ndjson';
    expect(isInboxImportUrl(url)).toBe(true);
    expect(isInboxImportUrl('https://evil.example/inbox-import/x.ndjson')).toBe(false);
    let ranged = 0;
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      if (String(input) !== url) return new Response('no', { status: 404 });
      const range = new Headers(init?.headers).get('range');
      const m = /bytes=(\d+)-(\d+)/.exec(range ?? '');
      if (!m) return new Response(body);
      ranged++;
      const slice = body.subarray(Number(m[1]), Number(m[2]) + 1);
      return new Response(slice, { status: 206, headers: { 'content-range': `bytes ${m[1]}-${m[2]}/${body.length}` } });
    });
    const u = await makeUser('izf');
    const job = await startFileImport(u.id, { url, name: 'export.ndjson', size: body.length });
    expect((await startFileImport(u.id, { url, name: 'export.ndjson', size: body.length })).id).toBe(job.id);
    let last = job;
    for (let i = 0; i < 20 && last.status === 'running'; i++) {
      await Promise.all([runInboxImports(new Date(), Date.now() + 20_000), runInboxImports(new Date(), Date.now() + 20_000)]);
      last = (await listImports(u.id)).find((j) => j.id === job.id)!;
    }
    expect(last.status).toBe('done');
    expect(ranged).toBeGreaterThan(1);
    expect(last.progress.bytes).toBe(body.length);
    expect(last.progress.messages).toBe(2000 + 5);
    const n = await getDb().prepare("SELECT COUNT(*) AS n FROM inbox_messages WHERE owner_id = ? AND external_id LIKE 'BULK%'").get(u.id);
    expect(Number((n as { n: number }).n)).toBe(2000);
  });

  it('un archivo roto queda como fallido con el error, y se puede cancelar', async () => {
    const url = 'https://abc123.public.blob.vercel-storage.com/inbox-import/roto-Abc.ndjson';
    const body = Buffer.from('{"part":"meta","format":"otra-cosa","version":2}\n');
    vi.stubGlobal('fetch', async () => new Response(body, { status: 206 }));
    const u = await makeUser('izr');
    const job = await startFileImport(u.id, { url, name: 'roto.ndjson', size: body.length });
    const after = await stepOwnImport(u.id, job.id);
    expect(after).toMatchObject({ status: 'failed', error: 'invalid_file' });
    expect((await setImportState(u.id, job.id, 'cancel')).status).toBe('cancelled');
    const other = await makeUser('izo');
    await expect(stepOwnImport(other.id, job.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('Todo el historial de WhatsApp desde el servidor', () => {
  async function linked() {
    vi.stubEnv('INBOX_FAKE_HISTORY', '1');
    const u = await makeUser('izw');
    const { account } = await connectWhatsapp(u.id);
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
    await new Promise((r) => setTimeout(r, 1600));
    return { owner: u.id, account };
  }

  it('espera a que WhatsApp termine de mandar el historial, después pagina todos los chats y todas las páginas', async () => {
    const { owner, account } = await linked();
    // Recién vinculado: WhatsApp sigue mandando historial (la importación espera).
    await getDb().prepare('UPDATE inbox_accounts SET sync_cursor = ? WHERE id = ?').run(JSON.stringify({ phase: 'chats', page: 0, after: Date.now() + 60_000 }), account.id);
    const job = await startWhatsappImport(owner);
    expect((await stepOwnImport(owner, job.id)).status).toBe('waiting');
    await getDb().prepare('UPDATE inbox_accounts SET sync_cursor = ? WHERE id = ?').run(JSON.stringify({ phase: 'done', page: 0 }), account.id);
    // Un chat que ya estaba con un mensaje del historial: no se duplica.
    const t = await upsertThread(account, { externalId: '5491170000002@s.whatsapp.net', kind: 'dm', title: 'Beto' });
    expect(t).toBeTruthy();
    let last = await stepOwnImport(owner, job.id);
    for (let i = 0; i < 30 && last.status !== 'done'; i++) last = await stepOwnImport(owner, job.id);
    expect(last.status).toBe('done');
    expect(last.progress).toMatchObject({ chats: 3, chatsDone: 3, messages: 230 + 15 + 40 });
    expect(last.progress.pages).toBe(3 + 1 + 1);
    const ana = (await listThreads(owner, { view: 'whatsapp' })).find((x) => x.title === 'Historial Ana')!;
    const page = await listMessages(owner, ana.id, { limit: 300 });
    expect(page.messages).toHaveLength(230);
    expect(page.messages[0].body).toBe('Historial Ana mensaje 1');
    // Lo importado no cuenta como no leído.
    expect(ana.unread).toBe(0);
    // Otra vez: no duplica nada.
    const again = await startWhatsappImport(owner);
    expect(again.id).not.toBe(job.id);
    let second = await stepOwnImport(owner, again.id);
    for (let i = 0; i < 30 && second.status !== 'done'; i++) second = await stepOwnImport(owner, again.id);
    expect(second.progress.messages).toBe(0);
  });

  it('pausar frena los pasos y seguir retoma desde donde quedó', async () => {
    const { owner, account } = await linked();
    await getDb().prepare('UPDATE inbox_accounts SET sync_cursor = ? WHERE id = ?').run(JSON.stringify({ phase: 'done', page: 0 }), account.id);
    const job = await startWhatsappImport(owner);
    await setImportState(owner, job.id, 'pause');
    expect((await stepOwnImport(owner, job.id)).progress.pages ?? 0).toBe(0);
    const resumed = await startWhatsappImport(owner);
    expect(resumed).toMatchObject({ id: job.id, status: 'running' });
  });

  it('sin WhatsApp conectado no empieza', async () => {
    const u = await makeUser('izn');
    await expect(startWhatsappImport(u.id)).rejects.toMatchObject({ code: 'not_connected' });
  });
});
