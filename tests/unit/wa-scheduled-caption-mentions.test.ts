import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { createBroadcast, processBroadcasts } from '@/lib/groups-broadcasts';
import { createRecurring, runDueRecurring } from '@/lib/groups-recurring';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { listScheduled, upsertThread } from '@/lib/inbox/core';
import { cleanParts, createBatch } from '@/lib/inbox/schedule';
import { sendScheduledNow } from '@/lib/inbox/send';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { saveUpload } from '@/lib/uploads';
import { waMentionables, waMentionPicks } from '@/lib/wa-compose-mentions';
import { makeUser } from './helpers';

/**
 * Programados y recurrentes con archivo (Lines e Inbox): el pie guarda sus
 * @menciones y la foto sale con la mención real ("@<teléfono>" y la lista),
 * igual que una mandada en el momento. Una nota de voz no lleva menciones.
 * WhatsApp falso; nombres y números inventados.
 */

const ANA = { phone: '5491100000031', name: 'Ana Prueba' };
const people = waMentionables([{ phone: ANA.phone, name: ANA.name }]);
const typed = `mirá esto @${ANA.name}`;
const wire = `mirá esto @${ANA.phone}`;
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('UPLOADS_DIR', mkdtempSync(path.join(os.tmpdir(), 'caption-later-')));
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

async function linesGroup(label: string) {
  const user = await makeUser(label);
  const n = await createNumber(user.id, user.id, { provider: 'fake' });
  await connectNumber(user.id, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  const row = (await getNumberRowById(n.id))!;
  const gid = `1203631${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  await ingestEvents(row, [{ type: 'message', chatId: gid, isGroup: true, fromMe: false, senderPhone: ANA.phone, senderName: ANA.name, providerMessageId: `${label}-in`, body: 'hola' }]);
  const chat = (await listChats(user.id, user.id)).rows.find((c) => c.kind === 'group')!;
  const file = await saveUpload('chat', 'foto.png', 'image/png', PNG, { workspaceId: user.id, userId: user.id, app: 'groups', access: 'user' });
  return { user, numberId: n.id, chat, gid, media: { url: file, mimetype: 'image/png', filename: 'foto.png' } };
}

describe('Lines: programado con archivo', () => {
  it('guarda las menciones del pie y la foto sale con la mención; el hilo muestra "@Nombre"', async () => {
    const { user, numberId, chat, gid, media } = await linesGroup('caption-later-lines');
    const b = await createBroadcast(user.id, user.id, { body: typed, chatIds: [chat.id], kind: 'scheduled', scheduledAt: inHours(1), media, mentions: waMentionPicks(typed, people) });
    expect(((await getDb().prepare('SELECT mentions FROM groups_broadcasts WHERE id = ?').get(b.id)) as { mentions: string }).mentions).toContain(ANA.phone);
    await processBroadcasts({ now: new Date(Date.now() + 3_700_000), broadcastId: b.id, gapMs: 0 });

    const out = fakeSent(numberId).filter((m) => m.kind === 'media' && m.chatId === gid);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: wire, mentions: [ANA.phone], mentioned: [`${ANA.phone}@s.whatsapp.net`] });
    const msg = (await getDb().prepare("SELECT body, meta FROM groups_messages WHERE chat_id = ? AND direction = 'out'").get(chat.id)) as { body: string; meta: string };
    expect(msg.body).toBe(wire);
    expect(JSON.parse(msg.meta).mentions).toEqual([ANA.phone]);
  });

  it('una nota de voz programada no guarda menciones', async () => {
    const { user, chat } = await linesGroup('caption-later-voice');
    const voice = await saveUpload('chat', 'voice-note.weba', 'audio/webm', Buffer.from('audio'), { workspaceId: user.id, userId: user.id, app: 'groups', access: 'user' });
    const b = await createBroadcast(user.id, user.id, {
      body: typed,
      chatIds: [chat.id],
      kind: 'scheduled',
      scheduledAt: inHours(1),
      media: { url: voice, mimetype: 'audio/webm', filename: 'voice-note.weba', kind: 'voice', duration: 3 },
      mentions: waMentionPicks(typed, people),
    });
    expect(((await getDb().prepare('SELECT mentions FROM groups_broadcasts WHERE id = ?').get(b.id)) as { mentions: string }).mentions).toBe('');
  });

  it('un recurrente con archivo también menciona en el pie', async () => {
    const { user, numberId, chat, gid, media } = await linesGroup('caption-later-recurring');
    const rec = await createRecurring(user.id, user.id, { chatIds: [chat.id], body: typed, media, rule: { freq: 'daily', time: '09:00' }, timezone: 'UTC', mentions: waMentionPicks(typed, people) });
    await getDb().prepare('UPDATE groups_recurring SET next_run_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), rec.id);
    expect(await runDueRecurring()).toBe(1);
    const run = (await getDb().prepare('SELECT id FROM groups_broadcasts WHERE recurring_id = ?').get(rec.id)) as { id: string };
    await processBroadcasts({ gapMs: 0, broadcastId: run.id });
    const out = fakeSent(numberId).filter((m) => m.kind === 'media' && m.chatId === gid);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: wire, mentions: [ANA.phone] });
  });
});

describe('Inbox: programado con archivo', () => {
  it('las menciones del pie se guardan (no las de una nota de voz)', () => {
    const picks = waMentionPicks(typed, people);
    const media = { url: '/uploads/inbox/abc-foto.png', name: 'foto.png', type: 'image/png' };
    expect(cleanParts([{ body: typed, media, mentions: picks }], 'whatsapp')[0].mentions).toEqual(picks);
    expect(cleanParts([{ body: '', media: { ...media, type: 'audio/webm', voice: true, duration: 3 }, mentions: picks }], 'whatsapp')[0].mentions).toEqual([]);
  });

  it('la foto sale con la mención en el pie y queda guardada como "@Nombre"', async () => {
    const owner = (await makeUser('caption-later-inbox')).id;
    const { account } = await connectWhatsapp(owner);
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
    // El proveedor falso tarda 1,5 s en "escanear".
    await new Promise((r) => setTimeout(r, 1600));
    const gid = `1203632${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
    const thread = await upsertThread(account, { externalId: gid, kind: 'group', title: 'Grupo de prueba' });
    const url = await saveUpload('inbox', 'foto.png', 'image/png', PNG, { workspaceId: owner, userId: owner, app: 'inbox', access: 'user' });
    const [s] = await createBatch(owner, { threadId: thread.id, sendAt: inHours(2), parts: [{ body: typed, media: { url, name: 'foto.png', type: 'image/png' }, mentions: waMentionPicks(typed, people) }], key: 'k-caption-later-1' });
    expect((await listScheduled(owner, thread.id))[0]).toMatchObject({ body: typed, mentions: [{ phone: ANA.phone, label: ANA.name }] });

    expect((await sendScheduledNow(s.id)).sent).toBe(1);
    const out = fakeSent(`inbox-${account.id}`).filter((m) => m.kind === 'media' && m.chatId === gid);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: wire, mentions: [ANA.phone], mentioned: [`${ANA.phone}@s.whatsapp.net`] });
    const msg = (await getDb().prepare('SELECT body, media_type, meta FROM inbox_messages WHERE thread_id = ? AND from_me = 1').get(thread.id)) as Record<string, string>;
    expect(msg).toMatchObject({ body: wire, media_type: 'image' });
    expect(JSON.parse(msg.meta).mentions).toEqual([ANA.phone]);
  });
});
