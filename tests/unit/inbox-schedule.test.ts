import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { listScheduled, upsertThread } from '@/lib/inbox/core';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { cancelBatch, cleanParts, createBatch, isInboxMediaUrl, plannedTimes, replaceBatch } from '@/lib/inbox/schedule';
import { sendDueScheduled, sendScheduledNow } from '@/lib/inbox/send';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { saveUpload } from '@/lib/uploads';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('UPLOADS_DIR', mkdtempSync(path.join(os.tmpdir(), 'inbox-up-')));
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

async function chat() {
  const owner = (await makeUser('inbox-sched')).id;
  const { account } = await connectWhatsapp(owner);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
  // El proveedor falso tarda 1,5 s en "escanear".
  await new Promise((r) => setTimeout(r, 1600));
  const t = await upsertThread(account, { externalId: `54911${Math.floor(1e7 + Math.random() * 8e7)}@s.whatsapp.net`, kind: 'dm', title: 'Caro' });
  const sent = () => fakeSent(`inbox-${account.id}`).filter((m) => m.chatId === t.external_id);
  return { owner, thread: t, sent };
}

const at = (base: Date, s: number) => new Date(base.getTime() + s * 1000);

describe('Programados de varios mensajes: funciones puras', () => {
  it('las horas previstas suman las esperas', () => {
    const base = new Date('2026-11-09T12:00:00.000Z');
    expect(plannedTimes(base, [0, 5, 60])).toEqual(['2026-11-09T12:00:00.000Z', '2026-11-09T12:00:05.000Z', '2026-11-09T12:01:05.000Z']);
  });

  it('cada parte necesita texto o archivo; los archivos solo por WhatsApp y de Inbox', () => {
    expect(() => cleanParts([], 'whatsapp')).toThrow();
    expect(() => cleanParts([{ body: '  ' }], 'whatsapp')).toThrow();
    expect(cleanParts([{ body: 'a', delaySec: 99 }, { body: 'b', delaySec: -3 }], 'whatsapp').map((p) => p.delaySec)).toEqual([0, 0]);
    const media = { url: '/uploads/inbox/abc-foto.jpg', name: 'foto.jpg', type: 'image/jpeg' };
    expect(cleanParts([{ body: '', media }], 'whatsapp')[0].media?.name).toBe('foto.jpg');
    expect(() => cleanParts([{ body: '', media }], 'gmail')).toThrow(/media_unsupported/);
    expect(() => cleanParts([{ body: '', media: { ...media, url: 'https://evil.example/x.jpg' } }], 'whatsapp')).toThrow();
    expect(isInboxMediaUrl('https://abc.public.blob.vercel-storage.com/inbox/foto-x1Y.jpg')).toBe(true);
    expect(isInboxMediaUrl('https://abc.public.blob.vercel-storage.com/docs/foto.jpg')).toBe(false);
    expect(isInboxMediaUrl('/uploads/chat/foto.jpg')).toBe(false);
  });
});

describe('Programados de varios mensajes: cron', () => {
  it('salen en orden, cada uno su burbuja, con la espera corta en la misma corrida; dos corridas no duplican', async () => {
    const { owner, thread, sent } = await chat();
    const now = new Date();
    await createBatch(owner, { threadId: thread.id, sendAt: at(now, 120).toISOString(), parts: [{ body: 'Hola!' }, { body: 'Te paso la dirección', delaySec: 1 }, { body: 'Av. Siempreviva 742', delaySec: 1 }], key: 'k-orden-1234' }, now);
    // Antes de hora no sale nada.
    expect((await sendDueScheduled(now)).sent).toBe(0);
    const later = at(now, 121);
    await Promise.all([sendDueScheduled(later, Date.now() + 25_000), sendDueScheduled(later, Date.now() + 25_000)]);
    expect(sent().map((m) => m.text)).toEqual(['Hola!', 'Te paso la dirección', 'Av. Siempreviva 742']);
    const msgs = (await getDb().prepare('SELECT body FROM inbox_messages WHERE thread_id = ? AND from_me = 1 ORDER BY sent_at').all(thread.id)) as Array<{ body: string }>;
    expect(msgs.map((m) => m.body)).toEqual(['Hola!', 'Te paso la dirección', 'Av. Siempreviva 742']);
    expect(await listScheduled(owner, thread.id)).toEqual([]);
  });

  it('la misma clave no duplica; una espera larga queda para la próxima corrida y se corre si el anterior salió tarde', async () => {
    const { owner, thread, sent } = await chat();
    const now = new Date();
    const input = { threadId: thread.id, sendAt: at(now, 60).toISOString(), parts: [{ body: 'uno' }, { body: 'dos', delaySec: 300 }], key: 'k-dup-12345' };
    await createBatch(owner, input, now);
    await createBatch(owner, input, now);
    expect(await listScheduled(owner, thread.id)).toHaveLength(2);
    // El primero sale 10 minutos tarde: el segundo pasa a 5 minutos después de eso.
    const late = at(now, 600);
    await sendDueScheduled(late);
    expect(sent().map((m) => m.text)).toEqual(['uno']);
    const [rest] = await listScheduled(owner, thread.id);
    expect(rest.body).toBe('dos');
    expect(Date.parse(rest.sendAt)).toBeGreaterThanOrEqual(late.getTime() + 299_000);
  });

  it('si uno falla, los siguientes esperan (no salen desordenados ni se marcan como pasados)', async () => {
    const { owner, thread, sent } = await chat();
    const now = new Date();
    const created = await createBatch(owner, { threadId: thread.id, sendAt: at(now, 60).toISOString(), parts: [{ body: 'primero' }, { body: 'segundo', delaySec: 0 }] }, now);
    await getDb().prepare("UPDATE inbox_scheduled SET status = 'failed', error = 'send_failed' WHERE id = ?").run(created[0].id);
    await sendDueScheduled(at(now, 13 * 3600));
    expect(sent()).toEqual([]);
    expect((await listScheduled(owner, thread.id)).map((s) => s.status)).toEqual(['failed', 'pending']);
    // Enviar ya: sale el que falló y enseguida el siguiente.
    const now2 = await sendScheduledNow(created[0].id);
    expect(now2.sent).toBe(2);
    expect(sent().map((m) => m.text)).toEqual(['primero', 'segundo']);
  });

  it('editar reemplaza lo que falta y borra archivos que ya no se usan; cancelar corta toda la secuencia', async () => {
    const { owner, thread, sent } = await chat();
    const now = new Date();
    const url = await saveUpload('inbox', 'foto.jpg', 'image/jpeg', Buffer.from('jpg'));
    const created = await createBatch(owner, { threadId: thread.id, sendAt: at(now, 600).toISOString(), parts: [{ body: 'mirá', media: { url, name: 'foto.jpg', type: 'image/jpeg' } }, { body: 'linda?' }] }, now);
    const edited = await replaceBatch(owner, created[1].id, { sendAt: at(now, 900).toISOString(), parts: [{ body: 'mirá esto', media: { url, name: 'foto.jpg', type: 'image/jpeg' } }, { body: 'linda, no?', delaySec: 5 }, { body: 'jaja', delaySec: 5 }] }, now);
    expect(edited.map((s) => s.body)).toEqual(['mirá esto', 'linda, no?', 'jaja']);
    expect(new Set(edited.map((s) => s.batchId)).size).toBe(1);
    expect(edited[0].mediaName).toBe('foto.jpg');
    // Sale con el archivo y el texto como pie.
    const out = await sendScheduledNow(edited[0].id, new Date(), Date.now() + 25_000);
    expect(out.sent).toBe(3);
    const media = sent().find((m) => m.kind === 'media');
    expect(media?.text).toBe('mirá esto');
    const row = (await getDb().prepare("SELECT media_type, media_name FROM inbox_messages WHERE thread_id = ? AND body = 'mirá esto'").get(thread.id)) as { media_type: string; media_name: string };
    expect(row).toEqual({ media_type: 'image', media_name: 'foto.jpg' });

    const again = await createBatch(owner, { threadId: thread.id, sendAt: at(now, 600).toISOString(), parts: [{ body: 'a' }, { body: 'b' }] }, now);
    await cancelBatch(owner, again[1].id);
    expect(await listScheduled(owner, thread.id)).toEqual([]);
  });

  it('no se programa en el chat de otra persona', async () => {
    const a = await chat();
    const b = await chat();
    await expect(createBatch(a.owner, { threadId: b.thread.id, sendAt: new Date(Date.now() + 3600_000).toISOString(), parts: [{ body: 'x' }] })).rejects.toMatchObject({ code: 'not_found' });
  });
});
