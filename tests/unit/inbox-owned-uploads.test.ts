/**
 * Inbox: mandar o programar un archivo por su URL solo borra (después de
 * mandarlo, al cancelar o al reemplazar) archivos de quien manda. Un archivo
 * de otra persona (del mismo equipo o de otro workspace) no se borra ni se
 * acepta para programar. Datos inventados.
 */
import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { upsertThread } from '@/lib/inbox/core';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { createBatch } from '@/lib/inbox/schedule';
import { sendWhatsappMedia } from '@/lib/inbox/wa-media';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { fileRowForUrl } from '@/lib/files/store';
import { deleteOwnedUploads, saveUpload } from '@/lib/uploads';
import { workspaceWithMember } from './access-helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('UPLOADS_DIR', mkdtempSync(path.join(os.tmpdir(), 'inbox-own-')));
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

/** Una persona con WhatsApp conectado en Inbox y un chat. */
async function chatOf(personId: string) {
  const { account } = await connectWhatsapp(personId);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
  await new Promise((r) => setTimeout(r, 1600));
  const thread = await upsertThread(account, { externalId: `1555${Math.floor(1e6 + Math.random() * 8e6)}@s.whatsapp.net`, kind: 'dm', title: 'Client' });
  return thread;
}

const exists = async (url: string) => !!(await fileRowForUrl(url));

describe('Inbox: archivos ajenos no se borran ni se programan', () => {
  it('deleteOwnedUploads borra lo propio y deja lo de otra persona y de otro workspace', async () => {
    const w = await workspaceWithMember('own-up');
    const mine = await saveUpload('inbox', 'a.jpg', 'image/jpeg', Buffer.from('a'), { workspaceId: w.owner.id, userId: w.member.id });
    const teammate = await saveUpload('inbox', 'b.jpg', 'image/jpeg', Buffer.from('b'), { workspaceId: w.owner.id, userId: w.friend.id });
    const stranger = await saveUpload('inbox', 'c.jpg', 'image/jpeg', Buffer.from('c'), { workspaceId: w.stranger.id, userId: w.stranger.id });
    await deleteOwnedUploads({ userId: w.member.id }, [mine, teammate, stranger]);
    expect(await exists(mine)).toBe(false);
    expect(await exists(teammate)).toBe(true);
    expect(await exists(stranger)).toBe(true);
  });

  it('mandar con la URL de un archivo ajeno falla y el archivo sigue', async () => {
    const w = await workspaceWithMember('own-send');
    const thread = await chatOf(w.member.id);
    const other = await saveUpload('inbox', 'd.jpg', 'image/jpeg', Buffer.from('d'), { workspaceId: w.owner.id, userId: w.friend.id });
    await expect(
      sendWhatsappMedia(w.member.id, thread.id, { url: other, mimetype: 'image/jpeg', filename: 'd.jpg', size: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await exists(other)).toBe(true);
    // Uno propio sale y se borra después de mandarlo, como siempre.
    const own = await saveUpload('inbox', 'e.jpg', 'image/jpeg', Buffer.from('e'), { workspaceId: w.owner.id, userId: w.member.id });
    await sendWhatsappMedia(w.member.id, thread.id, { url: own, mimetype: 'image/jpeg', filename: 'e.jpg', size: 1 });
    expect(await exists(own)).toBe(false);
  });

  it('programar con la URL de un archivo ajeno no se acepta', async () => {
    const w = await workspaceWithMember('own-sched');
    const thread = await chatOf(w.member.id);
    const other = await saveUpload('inbox', 'f.jpg', 'image/jpeg', Buffer.from('f'), { workspaceId: w.stranger.id, userId: w.stranger.id });
    const sendAt = new Date(Date.now() + 600_000).toISOString();
    await expect(
      createBatch(w.member.id, { threadId: thread.id, sendAt, parts: [{ body: 'look', media: { url: other, name: 'f.jpg', type: 'image/jpeg' } }] }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await exists(other)).toBe(true);
  });
});
