import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient, getDb } from '@/lib/db';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { createBroadcast, processBroadcasts } from '@/lib/groups-broadcasts';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { upsertThread } from '@/lib/inbox/core';
import { createBatch } from '@/lib/inbox/schedule';
import { sendDueScheduled } from '@/lib/inbox/send';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { migratePrivateFiles, SCHEDULED_TABLES } from '@/lib/files/migrate';
import * as store from '@/lib/files/store';
import { saveUpload } from '@/lib/uploads';
import { makeUser } from './helpers';

/**
 * Archivos de mensajes programados (Inbox y Lines): privados mientras
 * esperan, leídos del storage privado al salir (nunca una URL pública), y la
 * migración de los que quedaron en el Blob público.
 */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const HOST = 'sched123.public.blob.vercel-storage.com';
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('FILES_BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
  vi.stubEnv('UPLOADS_DIR', mkdtempSync(path.join(os.tmpdir(), 'sched-media-')));
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

async function lines(label: string) {
  const user = await makeUser(label);
  const n = await createNumber(user.id, user.id, { provider: 'fake' });
  await connectNumber(user.id, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  const row = (await getNumberRowById(n.id))!;
  await ingestEvents(row, [{ type: 'message', chatId: '5491155552001@c.us', isGroup: false, fromMe: false, senderPhone: '5491155552001', senderName: 'Ana', providerMessageId: `${label}-1`, body: 'Hola' }]);
  const chat = (await listChats(user.id, user.id)).rows[0];
  return { user, number: row, chat };
}

describe('Lines: archivo de un programado', () => {
  it('queda privado para quienes ven la línea y sale del storage privado', async () => {
    const { user, number, chat } = await lines('sched-lines-media');
    const url = await saveUpload('chat', 'plan.png', 'image/png', PNG, { workspaceId: user.id, userId: user.id, app: 'groups', access: 'user' });
    const b = await createBroadcast(user.id, user.id, {
      body: 'El plan',
      media: { url, mimetype: 'image/png', filename: 'plan.png' },
      chatIds: [chat.id],
      kind: 'scheduled',
      scheduledAt: inHours(1),
    });
    expect(b.media?.url).toBe(url);
    const row = (await store.fileRowForUrl(url))!;
    expect(row).toMatchObject({ workspace_id: user.id, access: 'workspace', app: 'groups', scope: `groups-number:${number.id}` });

    await getDb().prepare('UPDATE groups_broadcasts SET scheduled_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), b.id);
    expect((await processBroadcasts({ gapMs: 0, broadcastId: b.id })).sent).toBe(1);
    const out = (await getDb().prepare("SELECT media_url FROM groups_messages WHERE chat_id = ? AND direction = 'out'").get(chat.id)) as { media_url: string };
    expect(out.media_url).toBe(url);
    expect(out.media_url).not.toContain('blob.vercel-storage.com');
    expect(fakeSent(number.id).some((m) => m.text === 'El plan')).toBe(true);
  });

  it('un archivo de otro workspace no se acepta', async () => {
    const { user, chat } = await lines('sched-lines-foreign');
    const other = await makeUser('sched-lines-other');
    const url = await saveUpload('chat', 'ajeno.png', 'image/png', PNG, { workspaceId: other.id, userId: other.id, app: 'groups', access: 'user' });
    await expect(
      createBroadcast(user.id, user.id, { body: '', media: { url, mimetype: 'image/png', filename: 'ajeno.png' }, chatIds: [chat.id], kind: 'scheduled', scheduledAt: inHours(1) }),
    ).rejects.toMatchObject({ code: 'invalid_media' });
    expect((await store.fileRowForUrl(url))!.access).toBe('user');
  });
});

async function inbox(label: string) {
  const owner = (await makeUser(label)).id;
  const { account } = await connectWhatsapp(owner);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
  await new Promise((r) => setTimeout(r, 1600));
  const thread = await upsertThread(account, { externalId: `54911${Math.floor(1e7 + Math.random() * 8e7)}@s.whatsapp.net`, kind: 'dm', title: 'Caro' });
  const sent = () => fakeSent(`inbox-${account.id}`).filter((m) => m.chatId === thread.external_id);
  return { owner, thread, sent };
}

describe('Inbox: archivo de un programado', () => {
  it('sale en base64 desde el storage privado (sin URL) y se borra al salir', async () => {
    const { owner, thread, sent } = await inbox('sched-inbox-media');
    const url = await saveUpload('inbox', 'foto.png', 'image/png', PNG, { workspaceId: owner, userId: owner, app: 'inbox', access: 'user' });
    const now = new Date();
    await createBatch(owner, { threadId: thread.id, sendAt: new Date(now.getTime() + 60_000).toISOString(), parts: [{ body: 'mirá', media: { url, name: 'foto.png', type: 'image/png' } }], key: 'k-sched-media-1' }, now);
    await sendDueScheduled(new Date(now.getTime() + 61_000));
    const m = sent().find((x) => x.text === 'mirá')!;
    expect(m.media).toMatchObject({ base64: true });
    expect(await store.fileRowForUrl(url)).toBeNull();
  }, 15_000);

  it('el archivo de otra persona no sale', async () => {
    const { owner, thread, sent } = await inbox('sched-inbox-foreign');
    const other = (await makeUser('sched-inbox-other')).id;
    const url = await saveUpload('inbox', 'ajena.png', 'image/png', PNG, { workspaceId: other, userId: other, app: 'inbox', access: 'user' });
    const now = new Date();
    await createBatch(owner, { threadId: thread.id, sendAt: new Date(now.getTime() + 60_000).toISOString(), parts: [{ body: 'no', media: { url, name: 'ajena.png', type: 'image/png' } }], key: 'k-sched-media-2' }, now);
    await sendDueScheduled(new Date(now.getTime() + 61_000));
    expect(sent().some((x) => x.text === 'no')).toBe(false);
    const row = (await getDb().prepare('SELECT status, error FROM inbox_scheduled WHERE owner_id = ? AND thread_id = ?').get(owner, thread.id)) as { status: string; error: string };
    expect(row).toMatchObject({ status: 'failed', error: 'media_unavailable' });
    expect(await store.fileRowForUrl(url)).not.toBeNull();
  }, 15_000);
});

describe('migración de los programados que quedaron en el Blob público', () => {
  it('--scheduled: en seco cuenta; con apply pasa Inbox (de la persona) y Lines (de la línea) al storage privado', async () => {
    vi.stubEnv('FILES_LEGACY_BLOB_HOST', HOST);
    const originals = new Map<string, Buffer>();
    const io = {
      sizeOf: async (u: string) => originals.get(u)?.length ?? null,
      readOriginal: async (u: string) => {
        const b = originals.get(u);
        return b ? (async function* () { yield new Uint8Array(b); })() : null;
      },
      deleteOriginal: async (u: string) => void originals.delete(u),
    };
    const { owner, thread } = await inbox('sched-migrate-inbox');
    const inboxUrl = `https://${HOST}/inbox/foto-sched-Ab12.png`;
    originals.set(inboxUrl, PNG);
    const now = new Date();
    await createBatch(owner, { threadId: thread.id, sendAt: new Date(now.getTime() + 3600_000).toISOString(), parts: [{ body: '', media: { url: inboxUrl, name: 'foto.png', type: 'image/png' } }], key: 'k-sched-migrate' }, now);
    const { user, number, chat } = await lines('sched-migrate-lines');
    const linesUrl = `https://${HOST}/chat/77777777-2222-4333-8444-555555555555-plan.png`;
    originals.set(linesUrl, PNG);
    const b = await createBroadcast(user.id, user.id, { body: '', media: { url: linesUrl, mimetype: 'image/png', filename: 'plan.png' }, chatIds: [chat.id], kind: 'scheduled', scheduledAt: inHours(2) });

    const dry = await migratePrivateFiles(getClient(), { ...io, tables: SCHEDULED_TABLES });
    expect(dry.byFolder.inbox?.files).toBeGreaterThanOrEqual(1);
    expect(dry.byFolder.chat?.files).toBeGreaterThanOrEqual(1);
    expect(((await getDb().prepare('SELECT media_url FROM inbox_scheduled WHERE owner_id = ?').get(owner)) as { media_url: string }).media_url).toBe(inboxUrl);

    await migratePrivateFiles(getClient(), { ...io, tables: SCHEDULED_TABLES, apply: true });
    const sched = (await getDb().prepare('SELECT media_url FROM inbox_scheduled WHERE owner_id = ?').get(owner)) as { media_url: string };
    expect(sched.media_url).toMatch(/^\/api\/files\//);
    expect(await store.fileRowForUrl(sched.media_url)).toMatchObject({ access: 'user', user_id: owner, app: 'inbox' });
    const bc = (await getDb().prepare('SELECT media_url FROM groups_broadcasts WHERE id = ?').get(b.id)) as { media_url: string };
    expect(bc.media_url).toMatch(/^\/api\/files\//);
    expect(await store.fileRowForUrl(bc.media_url)).toMatchObject({ access: 'workspace', workspace_id: user.id, scope: `groups-number:${number.id}` });
  }, 20_000);
});
