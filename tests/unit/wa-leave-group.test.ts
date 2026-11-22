import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { addMessage, getAccountById, getThread, listMessages, upsertThread } from '@/lib/inbox/core';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { leaveGroupThread } from '@/lib/inbox/wa-group-members';
import { sendWaMessage } from '@/lib/inbox/wa-actions';
import { selfMembershipChange } from '@/lib/wa-group-events';
import { makeUser } from './helpers';

/**
 * Salir de un grupo en Inbox (como en WhatsApp): el chat queda de solo
 * lectura con el aviso "Saliste"; que te saquen hace lo mismo y que te
 * vuelvan a agregar lo abre. Teléfonos y nombres inventados.
 */

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

const ME = '15550000001';
const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);

async function inboxGroup(label: string, gid: string) {
  const u = await makeUser(label);
  const { account: a } = await connectWhatsapp(u.id);
  const s = fakeState(`inbox-${a.id}`);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = ? WHERE id = ?").run(ME, a.id);
  const account = (await getAccountById(a.id))!;
  const t = await upsertThread(account, { externalId: gid, kind: 'group', title: 'Club de prueba' });
  await addMessage(t, { externalId: `m-${gid}`, fromMe: false, body: 'hola', senderName: 'Ana', sentAt: new Date(Date.now() - 60_000).toISOString() });
  return { owner: u.id, account, thread: t };
}

describe('selfMembershipChange', () => {
  it('salir o que te saquen: left; crear, que te agreguen o entrar por link: joined; lo demás no', () => {
    expect(selfMembershipChange({ t: 'leave', by: { p: 'me' } })).toBe('left');
    expect(selfMembershipChange({ t: 'leave', by: { p: '5491100000002' } })).toBeNull();
    expect(selfMembershipChange({ t: 'remove', by: { p: '5491100000002' }, who: [{ p: 'me' }] })).toBe('left');
    expect(selfMembershipChange({ t: 'remove', by: { p: 'me' }, who: [{ p: '5491100000003' }] })).toBeNull();
    expect(selfMembershipChange({ t: 'add', by: { p: '5491100000002' }, who: [{ p: 'me' }] })).toBe('joined');
    expect(selfMembershipChange({ t: 'join', by: { p: 'me' } })).toBe('joined');
    expect(selfMembershipChange({ t: 'create', by: { p: 'me' } })).toBe('joined');
    expect(selfMembershipChange({ t: 'promote', by: { p: '5491100000002' }, who: [{ p: 'me' }] })).toBeNull();
  });
});

describe('Inbox: salir de un grupo', () => {
  it('deja el chat de solo lectura con el aviso, no deja mandar ni salir dos veces', async () => {
    const { owner, thread } = await inboxGroup('wlg-leave', '120363000777@g.us');
    expect((await getThread(owner, thread.id)).leftAt).toBeUndefined();
    const { leftAt } = await leaveGroupThread(owner, thread.id);
    expect(leftAt).toBeTruthy();
    expect((await getThread(owner, thread.id)).leftAt).toBe(leftAt);
    const sys = (await listMessages(owner, thread.id)).messages.filter((m) => m.mediaType === 'system');
    expect(sys.map((m) => m.meta?.sys)).toEqual([{ t: 'leave', by: { p: 'me' } }]);
    await expect(sendWaMessage(owner, thread.id, 'hola')).rejects.toMatchObject({ code: 'group_left', status: 409 });
    await expect(leaveGroupThread(owner, thread.id)).rejects.toMatchObject({ code: 'group_left', status: 409 });
  });

  it('otra persona no puede salir por mí: el chat no es suyo', async () => {
    const { thread } = await inboxGroup('wlg-owner', '120363000778@g.us');
    const other = await makeUser('wlg-other');
    await expect(leaveGroupThread(other.id, thread.id)).rejects.toMatchObject({ status: 404 });
  });

  it('que te saquen desde el teléfono lo deja de solo lectura; que te agreguen lo abre', async () => {
    const { owner, account, thread } = await inboxGroup('wlg-removed', '120363000779@g.us');
    await ingestWhatsappEvents(account, [{ type: 'participants', chatId: '120363000779@g.us', action: 'remove', phones: [ME], author: '5491100000002' }]);
    expect((await getThread(owner, thread.id)).leftAt).toBeTruthy();
    await ingestWhatsappEvents(account, [{ type: 'participants', chatId: '120363000779@g.us', action: 'add', phones: [ME], author: '5491100000002' }]);
    expect((await getThread(owner, thread.id)).leftAt).toBeUndefined();
  });
});
