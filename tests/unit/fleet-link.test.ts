import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createAccount, setAccountState, getAccountById } from '@/lib/inbox/core';
import { ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { fakeSent } from '@/lib/groups-provider-fake';
import { createToken, ingestEvent, ownerOfToken, listMessages } from '@/lib/fleet/sessions';
import { setPrefs } from '@/lib/fleet/core';
import { normalizeHookPayload } from '@/lib/fleet/types';
import { checkNotifyAccount, mirrorSummary } from '@/lib/fleet/link';
import { makeUser } from './helpers';

/**
 * Fleet ↔ WhatsApp de Inbox: el aviso va solo al chat propio de la cuenta ("Mensaje a mí mismo") y la respuesta que
 * lo cita vuelve a la cola de ese agente. Con el WhatsApp falso (GROUPS_FAKE).
 */
beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

/** Id del aviso mandado por WhatsApp (la fila oculta que lo une a la sesión). */
async function linkRef(sessionId: string): Promise<string> {
  const row = (await getDb().prepare("SELECT external_ref FROM fleet_messages WHERE role = 'link' AND session_id = ? ORDER BY created_at DESC LIMIT 1").get(sessionId)) as { external_ref: string };
  return row.external_ref;
}

async function setup(label: string) {
  const u = await makeUser(label);
  const actor = { ws: u.id, person: u.id, email: u.email, name: label };
  const acc = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
  const phone = `549110000${Math.floor(1000 + Math.random() * 8999)}`;
  await setAccountState(acc.id, { status: 'connected', address: phone });
  const { token } = await createToken(actor, 'Mac');
  const owner = (await ownerOfToken(`Bearer ${token}`))!;
  return { u, actor, acc: (await getAccountById(acc.id))!, phone, owner };
}

describe('Fleet: aviso por WhatsApp a tu propio chat', () => {
  it('apagado no manda nada; prendido manda al chat propio y la respuesta citada va a la cola del agente', async () => {
    const { actor, acc, phone, owner } = await setup('fleet-wa');
    const sent = () => fakeSent(`inbox-${acc.id}`);
    await ingestEvent(owner, normalizeHookPayload({ event: 'UserPromptSubmit', session: 'wa-1', project: 'web', text: 'Deploy it' })!);
    await ingestEvent(owner, normalizeHookPayload({ event: 'Stop', session: 'wa-1', text: 'Ready to deploy. Go?' })!);
    expect(sent()).toHaveLength(0);

    await setPrefs(actor, { notify: 'both', notifyAccountId: acc.id });
    const res = await ingestEvent(owner, normalizeHookPayload({ event: 'Stop', session: 'wa-1', text: 'Ready to deploy. Go?' })!);
    expect(sent()).toHaveLength(1);
    const msg = { ...sent()[0], id: await linkRef(res.sessionId) };
    // Solo al chat propio: nunca a otra persona.
    expect(msg.chatId).toBe(`${phone}@s.whatsapp.net`);
    expect(msg.text).toContain('Ready to deploy. Go?');

    // La persona contesta en su chat citando el aviso (WhatsApp lo manda como propio).
    await ingestWhatsappEvents(acc, [
      { type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: true, senderPhone: phone, senderName: '', providerMessageId: 'me-1', body: 'Yes, go', replyToProviderId: msg.id, timestamp: new Date().toISOString() },
    ]);
    const list = await listMessages(actor, res.sessionId);
    const reply = list.find((m) => m.role === 'reply');
    expect(reply).toMatchObject({ text: 'Yes, go', status: 'pending', source: 'whatsapp' });
    // El reintento del mismo mensaje no se encola dos veces.
    await ingestWhatsappEvents(acc, [
      { type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: true, senderPhone: phone, senderName: '', providerMessageId: 'me-1', body: 'Yes, go', replyToProviderId: msg.id, timestamp: new Date().toISOString() },
    ]);
    expect((await listMessages(actor, res.sessionId)).filter((m) => m.role === 'reply')).toHaveLength(1);

    // El próximo Stop la entrega.
    const stop = await ingestEvent(owner, normalizeHookPayload({ event: 'Stop', session: 'wa-1', text: 'Deploying' })!);
    expect(stop.output).toEqual({ decision: 'block', reason: 'Yes, go' });
  });

  it('un mensaje sin citar, de otra persona o en otro chat no llega a ningún agente', async () => {
    const { actor, acc, phone, owner } = await setup('fleet-wa-2');
    await setPrefs(actor, { notify: 'done', notifyAccountId: acc.id });
    const res = await ingestEvent(owner, normalizeHookPayload({ event: 'Stop', session: 'wa-2', project: 'api', text: 'Done.' })!);
    const notice = { id: await linkRef(res.sessionId) };
    await ingestWhatsappEvents(acc, [
      { type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: true, senderPhone: phone, senderName: '', providerMessageId: 'x-1', body: 'not quoting', timestamp: new Date().toISOString() },
      { type: 'message', chatId: '5491199999999@s.whatsapp.net', isGroup: false, fromMe: false, senderPhone: '5491199999999', senderName: 'Other', providerMessageId: 'x-2', body: 'quoting from someone else', replyToProviderId: notice.id, timestamp: new Date().toISOString() },
      { type: 'message', chatId: '5491199999999@s.whatsapp.net', isGroup: false, fromMe: true, senderPhone: phone, senderName: '', providerMessageId: 'x-3', body: 'me in another chat', replyToProviderId: notice.id, timestamp: new Date().toISOString() },
    ]);
    expect((await listMessages(actor, res.sessionId)).filter((m) => m.role === 'reply')).toHaveLength(0);
    // "waiting" con notify=done: no avisa.
    await ingestEvent(owner, normalizeHookPayload({ event: 'Notification', session: 'wa-2', text: 'Needs permission', detail: 'permission_prompt' })!);
    expect(fakeSent(`inbox-${acc.id}`)).toHaveLength(1);
  });

  it('la cuenta de los avisos tiene que ser de la persona', async () => {
    const a = await setup('fleet-wa-a');
    const b = await setup('fleet-wa-b');
    await expect(checkNotifyAccount(a.actor, b.acc.id)).rejects.toThrow('account_not_found');
    await expect(checkNotifyAccount(a.actor, a.acc.id)).resolves.toBeUndefined();
  });

  it('la fila Agentes de Inbox y Lines aparece solo con el espejo prendido', async () => {
    const { u, actor, owner } = await setup('fleet-mirror');
    const user = { id: u.id, email: u.email, role: 'owner', apps: '*', actingUser: undefined } as never;
    expect(await mirrorSummary(user, 'inbox')).toBeNull();
    await setPrefs(actor, { mirrorInbox: true });
    await ingestEvent(owner, normalizeHookPayload({ event: 'Notification', session: 'm-1', project: 'web', text: 'Needs you', detail: 'permission_prompt' })!);
    expect(await mirrorSummary(user, 'inbox')).toEqual({ unread: 1, waiting: 1 });
    expect(await mirrorSummary(user, 'lines')).toBeNull();
    const rows = await getDb().prepare("SELECT COUNT(*) AS n FROM fleet_messages WHERE role = 'link'").get();
    expect(rows).toBeTruthy();
  });
});
