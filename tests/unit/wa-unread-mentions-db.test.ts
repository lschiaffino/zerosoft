/**
 * El "@" de la lista de chats en Lines e Inbox, contra la base: un grupo con un
 * no leído que menciona a la línea (por teléfono o por un lid de la libreta) o
 * que responde a un mensaje nuestro lleva `mentioned`; uno que menciona a otra
 * persona o sin menciones, no; al leer, se va. Proveedor falso, base propia,
 * nombres y números inventados.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbFile = vi.hoisted(() => {
  const file = `${(process.env.TMPDIR ?? '/tmp').replace(/\/$/, '')}/zerosoft-unread-mentions-${process.pid}-${Date.now()}.db`;
  process.env.TURSO_DATABASE_URL = `file:${file}`;
  return file;
});

import fs from 'fs';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, updateChat } from '@/lib/groups';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { applyThreadAction, listThreads } from '@/lib/inbox/core';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { rememberContacts } from '@/lib/wa-contacts';
import { makeUser } from './helpers';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => undefined }));

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => {
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(`${dbFile}${ext}`, { force: true });
});

const ME = '15550000101';
const LID = '118571178918101';
let seq = 0;
const at = (s: number) => new Date(Date.now() - s * 1000).toISOString();

function groupMessage(chatId: string, over: Record<string, unknown> = {}) {
  return { type: 'message' as const, chatId, isGroup: true, groupName: 'Grupo prueba', fromMe: false, senderPhone: '15550000202', senderName: 'Beto Prueba', providerMessageId: `m-${++seq}`, body: 'hola', timestamp: at(5), ...over };
}

/** Los cuatro grupos de cada prueba: menciona por teléfono, por lid, responde a lo nuestro y menciona a otra persona. */
function events() {
  return [
    groupMessage('120363000000000101@g.us', { body: `@${ME} mirá`, mentions: [ME] }),
    groupMessage('120363000000000102@g.us', { body: `@${LID} mirá`, mentions: [`${LID}@lid`] }),
    groupMessage('120363000000000103@g.us', { fromMe: true, providerMessageId: 'ours-1', body: 'te paso el dato', timestamp: at(60) }),
    groupMessage('120363000000000103@g.us', { body: 'gracias', replyToProviderId: 'ours-1' }),
    groupMessage('120363000000000104@g.us', { body: '@15550000303 mirá', mentions: ['15550000303'] }),
  ];
}
const flags = (rows: Array<{ externalId: string; mentioned?: boolean }>) =>
  Object.fromEntries(rows.map((r) => [r.externalId.replace(/@.*/, '').slice(-3), Boolean(r.mentioned)]));

describe('Lines', () => {
  it('marca los grupos que te mencionan o responden, y lo saca al leer', async () => {
    const u = await makeUser('lines-mentions');
    const n = await createNumber(u.id, u.id, { provider: 'fake' });
    await connectNumber(u.id, n.id);
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected', phone = ? WHERE id = ?").run(ME, n.id);
    await rememberContacts({ app: 'lines', accountId: n.id, userId: u.id }, [{ phone: ME, lid: LID }]);
    await ingestEvents((await getNumberRowById(n.id))!, events());
    const jids = new Map(((await getDb().prepare('SELECT id, provider_chat_id FROM groups_chats WHERE user_id = ?').all(u.id)) as Array<{ id: string; provider_chat_id: string }>).map((r) => [r.id, r.provider_chat_id]));
    const rows = (await listChats(u.id, u.id, {})).rows.map((c) => ({ externalId: jids.get(c.id) ?? '', mentioned: c.mentioned, id: c.id }));
    expect(flags(rows)).toEqual({ '101': true, '102': true, '103': true, '104': false });

    const read = rows.find((r) => r.externalId.startsWith('120363000000000101'))!;
    await updateChat(u.id, read.id, { read: true });
    const after = (await listChats(u.id, u.id, {})).rows.map((c) => ({ externalId: jids.get(c.id) ?? '', mentioned: c.mentioned }));
    expect(flags(after)['101']).toBe(false);
    expect(flags(after)['103']).toBe(true);
  });
});

describe('Inbox', () => {
  it('marca los grupos que te mencionan o responden, y lo saca al leer', async () => {
    const u = await makeUser('inbox-mentions');
    const { account } = await connectWhatsapp(u.id);
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = ? WHERE id = ?").run(ME, account.id);
    await rememberContacts({ app: 'inbox', accountId: account.id, userId: u.id }, [{ phone: ME, lid: LID }]);
    const { POST } = await import('@/app/api/inbox/webhook/[id]/[secret]/route');
    const res = await POST(new Request('http://zerosoft.test/api/inbox/webhook/x/y', { method: 'POST', body: JSON.stringify({ events: events() }) }), {
      params: Promise.resolve({ id: account.id, secret: account.webhook_secret! }),
    });
    expect(res.ok).toBe(true);
    const external = async () =>
      new Map(((await getDb().prepare('SELECT id, external_id FROM inbox_threads WHERE owner_id = ?').all(u.id)) as Array<{ id: string; external_id: string }>).map((r) => [r.id, r.external_id]));
    const ext = await external();
    const rows = (await listThreads(u.id)).map((t) => ({ externalId: ext.get(t.id) ?? '', mentioned: t.mentioned, id: t.id }));
    expect(flags(rows)).toEqual({ '101': true, '102': true, '103': true, '104': false });

    const read = rows.find((r) => r.externalId.startsWith('120363000000000101'))!;
    await applyThreadAction(u.id, [read.id], { action: 'read' });
    const after = (await listThreads(u.id)).map((t) => ({ externalId: ext.get(t.id) ?? '', mentioned: t.mentioned }));
    expect(flags(after)['101']).toBe(false);
    expect(flags(after)['103']).toBe(true);
  });
});
