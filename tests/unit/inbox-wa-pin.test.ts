/**
 * Inbox: fijar mensajes de un chat de WhatsApp (hasta 3, como WhatsApp).
 * Con el WhatsApp falso (que fija también en el "teléfono"); datos inventados.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { listMessages, listPinnedMessages, listThreads, type AccountRow } from '@/lib/inbox/core';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { hideMessage, pinMessage } from '@/lib/inbox/wa-actions';
import { fakeSent } from '@/lib/groups-provider-fake';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

let owner = '';
let account: AccountRow;

beforeAll(async () => {
  vi.stubEnv('GROUPS_FAKE', '1');
  const u = await makeUser('ibwa-pin');
  owner = u.id;
  account = (await connectWhatsapp(u.id)).account;
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
  account = { ...account, status: 'connected' };
  // El proveedor falso tarda 1,5 s en "escanear".
  await new Promise((r) => setTimeout(r, 1600));
});

async function chatWith(phone: string, bodies: string[]) {
  await ingestWhatsappEvents(
    account,
    bodies.map((body) => ({
      type: 'message' as const,
      chatId: `${phone}@s.whatsapp.net`,
      isGroup: false,
      fromMe: false,
      senderPhone: phone,
      senderName: 'Ana Prueba',
      providerMessageId: `pin-${Math.random().toString(36).slice(2)}`,
      body,
      timestamp: new Date().toISOString(),
    })),
  );
  const th = (await listThreads(owner, { view: 'whatsapp' })).find((t) => t.handle === phone)!;
  const msgs = (await listMessages(owner, th.id)).messages;
  return { th, msgs: bodies.map((b) => msgs.find((m) => m.body === b)!) };
}

const sent = () => fakeSent(`inbox-${account.id}`);

describe('fijar mensajes', () => {
  it('fija y desfija: queda en el mensaje, en la franja del chat y sale a WhatsApp', async () => {
    const { th, msgs } = await chatWith('15550003001', ['uno', 'dos']);
    const out = await pinMessage(owner, msgs[0].id, true);
    expect(out.inWhatsApp).toBe(true);
    expect(sent().at(-1)).toMatchObject({ kind: 'pin' });
    const m = (await listMessages(owner, th.id)).messages.find((x) => x.id === msgs[0].id)!;
    expect(m.pinnedAt).toMatch(/^\d{4}-/);
    expect((await listPinnedMessages(owner, th.id)).map((x) => x.id)).toEqual([msgs[0].id]);

    await pinMessage(owner, msgs[0].id, false);
    expect(sent().at(-1)).toMatchObject({ kind: 'unpin' });
    expect(await listPinnedMessages(owner, th.id)).toEqual([]);
    expect((await listMessages(owner, th.id)).messages.find((x) => x.id === msgs[0].id)!.pinnedAt).toBeUndefined();
  });

  it('hasta 3 por chat; uno borrado para mí deja de contar', async () => {
    const { th, msgs } = await chatWith('15550003002', ['a', 'b', 'c', 'd']);
    for (const m of msgs.slice(0, 3)) await pinMessage(owner, m.id, true);
    await expect(pinMessage(owner, msgs[3].id, true)).rejects.toMatchObject({ code: 'too_many_pins' });
    // Volver a fijar uno ya fijado no cuenta como otro.
    await expect(pinMessage(owner, msgs[0].id, true)).resolves.toBeTruthy();
    await hideMessage(owner, msgs[0].id);
    expect((await listPinnedMessages(owner, th.id)).length).toBe(2);
    await expect(pinMessage(owner, msgs[3].id, true)).resolves.toBeTruthy();
  });

  it('el mensaje de otra persona no se encuentra', async () => {
    const { msgs } = await chatWith('15550003003', ['privado']);
    const other = await makeUser('ibwa-pin-other');
    await expect(pinMessage(other.id, msgs[0].id, true)).rejects.toMatchObject({ code: 'not_found' });
  });
});
