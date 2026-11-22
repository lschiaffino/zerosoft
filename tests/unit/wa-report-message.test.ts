/**
 * "Reportar" en el menú de un mensaje recibido, en Lines y en Inbox: el
 * mensaje queda marcado (meta.reported), en Lines también en el log del chat,
 * y en el mismo paso se puede bloquear al contacto (1:1) o salir del grupo.
 * Ningún proveedor manda el reporte a WhatsApp. Números y nombres inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getChat, getNumberRowById, ingestEvents, listChats, listMessages as linesMessages } from '@/lib/groups';
import { reportMessage as linesReport } from '@/lib/groups-inbox';
import { listAudit } from '@/lib/groups-audit';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import type { InboundEvent } from '@/lib/groups-provider';
import { addMessage, getAccountById, getThread, listMessages, upsertThread } from '@/lib/inbox/core';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { reportMessage } from '@/lib/inbox/wa-actions';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

const ME = '15550000001';
const ANA = '5491177730021';
const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);

async function linesSetup(label: string) {
  const user = await makeUser(label);
  const n = await createNumber(user.id, user.id, { provider: 'fake' });
  await connectNumber(user.id, n.id);
  const s = fakeState(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected', phone = ? WHERE id = ?").run(ME, n.id);
  const row = (await getNumberRowById(n.id))!;
  const dmIn = (body: string): InboundEvent =>
    ({
      type: 'message',
      chatId: `${ANA}@s.whatsapp.net`,
      isGroup: false,
      fromMe: false,
      senderPhone: ANA,
      senderName: 'Ana Prueba',
      providerMessageId: `r-${Math.random().toString(36).slice(2)}`,
      body,
      timestamp: new Date().toISOString(),
    }) as InboundEvent;
  return { user, row, dmIn };
}

describe('Lines: reportar un mensaje', () => {
  it('lo marca, queda en el log y, si se pide, bloquea al contacto', async () => {
    const { user, row, dmIn } = await linesSetup('lines-report');
    await ingestEvents(row, [dmIn('mensaje molesto'), dmIn('otro')]);
    const chat = (await listChats(user.id, user.id, { kind: 'dm' })).rows[0];
    const msgs = await linesMessages(user.id, chat.id);
    const target = msgs.find((m) => m.body === 'mensaje molesto')!;

    const plain = await linesReport(user.id, user.id, target.id);
    expect(plain).toMatchObject({ blocked: false, left: false });
    expect((plain.message.meta as Record<string, unknown>).reported).toMatchObject({ by: user.id });
    expect(fakeSent(row.id).filter((s) => s.kind === 'block')).toEqual([]);

    const other = msgs.find((m) => m.body === 'otro')!;
    const withBlock = await linesReport(user.id, user.id, other.id, { block: true });
    expect(withBlock).toMatchObject({ blocked: true, left: false });
    expect(withBlock.error).toBeUndefined();
    expect(fakeSent(row.id).filter((s) => s.kind === 'block').at(-1)).toMatchObject({ text: 'block' });
    expect((await getChat(user.id, chat.id))?.blocked).toBe(true);

    const log = await listAudit(user.id, { chatId: chat.id, action: 'reported' });
    expect(log.map((e) => e.detail)).toEqual(expect.arrayContaining([expect.objectContaining({ messageId: target.id, blocked: false }), expect.objectContaining({ messageId: other.id, blocked: true })]));
  });

  it('lo propio no se reporta, ni un mensaje de otro workspace', async () => {
    const { user, row, dmIn } = await linesSetup('lines-report-no');
    await ingestEvents(row, [dmIn('hola'), { ...dmIn('mío'), fromMe: true } as InboundEvent]);
    const chat = (await listChats(user.id, user.id, { kind: 'dm' })).rows[0];
    const msgs = await linesMessages(user.id, chat.id);
    await expect(linesReport(user.id, user.id, msgs.find((m) => m.body === 'mío')!.id)).rejects.toMatchObject({ code: 'not_reportable' });
    const other = await makeUser('lines-report-other');
    await expect(linesReport(other.id, other.id, msgs.find((m) => m.body === 'hola')!.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

async function inboxSetup(label: string) {
  const u = await makeUser(label);
  const { account: a } = await connectWhatsapp(u.id);
  const s = fakeState(`inbox-${a.id}`);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = ? WHERE id = ?").run(ME, a.id);
  return { owner: u.id, account: (await getAccountById(a.id))! };
}

describe('Inbox: reportar un mensaje', () => {
  it('lo marca y, si se pide, bloquea al contacto del chat 1:1', async () => {
    const { owner, account } = await inboxSetup('ib-report');
    const t = await upsertThread(account, { externalId: `${ANA}@s.whatsapp.net`, kind: 'dm', title: 'Ana Prueba', handle: ANA });
    await addMessage(t, { externalId: 'rp-1', fromMe: false, body: 'mensaje molesto', senderName: 'Ana', sentAt: new Date(Date.now() - 60_000).toISOString() });
    await addMessage(t, { externalId: 'rp-2', fromMe: true, body: 'mío', senderName: '', sentAt: new Date(Date.now() - 30_000).toISOString() });
    const msgs = (await listMessages(owner, t.id)).messages;
    const target = msgs.find((m) => m.body === 'mensaje molesto')!;

    expect(await reportMessage(owner, target.id, { block: true })).toEqual({ blocked: true, left: false });
    expect((await listMessages(owner, t.id)).messages.find((m) => m.id === target.id)?.meta?.reported?.at).toMatch(/^\d{4}-/);
    expect(fakeSent(`inbox-${account.id}`).filter((s) => s.kind === 'block').at(-1)).toMatchObject({ text: 'block' });

    await expect(reportMessage(owner, msgs.find((m) => m.body === 'mío')!.id)).rejects.toMatchObject({ code: 'not_reportable' });
    const other = await makeUser('ib-report-other');
    await expect(reportMessage(other.id, target.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('en un grupo, si se pide, sale del grupo', async () => {
    const { owner, account } = await inboxSetup('ib-report-group');
    const t = await upsertThread(account, { externalId: '120363000881@g.us', kind: 'group', title: 'Club de prueba' });
    await addMessage(t, { externalId: 'rpg-1', fromMe: false, body: 'spam', senderName: 'Ana', senderHandle: ANA, sentAt: new Date(Date.now() - 60_000).toISOString() });
    const target = (await listMessages(owner, t.id)).messages.find((m) => m.body === 'spam')!;
    const out = await reportMessage(owner, target.id, { leave: true });
    expect(out).toEqual({ blocked: false, left: true });
    expect((await getThread(owner, t.id)).leftAt).toBeTruthy();
  });
});
