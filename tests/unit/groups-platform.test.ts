import { createPublicKey, verify } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createTeam, addMember } from '@/lib/teams';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createLabel, createNumber, getNumberRowById, ingestEvents, listChats, listMessages, sendMessage, updateChat } from '@/lib/groups';
import { nextRun, normalizeRule, parseCron, upcomingRuns } from '@/lib/groups-recurrence';
import { normalizePoll, tallyPoll, voteOptions } from '@/lib/groups-polls';
import { maskPhone, maskPhoneText } from '@/lib/groups-mask';
import { canSeeChat, setLabelAccess, updatePlatformSettings, viewerFrom, groupsViewer, maskChat } from '@/lib/groups-access';
import { chatChanges, listAudit } from '@/lib/groups-audit';
import { patchChatAs } from '@/lib/groups-chat-ops';
import { createRecurring, runDueRecurring, updateRecurring } from '@/lib/groups-recurring';
import { processBroadcasts } from '@/lib/groups-broadcasts';
import { parseEvolutionWebhook, parseWahaWebhook } from '@/lib/groups-provider-bridge';
import {
  cleanIntegrationConfig,
  dispatchGroupsEvent,
  fakeIntegrationCalls,
  fromFreshdeskStatus,
  listIntegrations,
  saveIntegration,
  setFakeRemoteStatus,
  slackText,
  syncRemoteTickets,
  ticketLinks,
} from '@/lib/groups-integrations';
import { createTicket, getTicket, updateTicket } from '@/lib/groups-tickets';
import { handleRpc } from '@/lib/groups-mcp';
import { notifyPerson, saveSubscription, takePending, vapidJwt, vapidKeys, fakePushes } from '@/lib/groups-push';
import { reportRange, groupsAnalytics } from '@/lib/groups-analytics';
import { searchApps } from '@/lib/app-search';
import { createWebhook, listDeliveries, resendDelivery, retryDueWebhooks } from '@/lib/webhooks';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
  resetFakeProvider();
});

async function setup(label: string) {
  const user = await makeUser(label);
  const n = await createNumber(user.id, user.id, { provider: 'fake' });
  await connectNumber(user.id, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return { user, row: (await getNumberRowById(n.id))! };
}

const msg = (chatId: string, id: string, body: string, senderName = 'Ana') => ({
  type: 'message' as const,
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  chatName: chatId.endsWith('@g.us') ? `Grupo ${senderName}` : undefined,
  fromMe: false,
  senderPhone: '5491155550000',
  senderName,
  providerMessageId: id,
  body,
});

describe('reglas de recurrencia', () => {
  it('diario, semanal y mensual en la zona elegida', () => {
    const after = new Date('2026-10-25T15:00:00Z'); // domingo 12:00 en Buenos Aires
    const tz = 'America/Argentina/Buenos_Aires';
    expect(nextRun(normalizeRule({ freq: 'daily', time: '09:00' }), tz, after)?.toISOString()).toBe('2026-10-26T12:00:00.000Z');
    expect(nextRun(normalizeRule({ freq: 'daily', time: '13:30' }), tz, after)?.toISOString()).toBe('2026-10-25T16:30:00.000Z');
    // Lunes y miércoles a las 09:00.
    const weekly = normalizeRule({ freq: 'weekly', time: '09:00', days: [1, 3] });
    expect(upcomingRuns(weekly, tz, after, 3).map((d) => d.toISOString())).toEqual([
      '2026-10-26T12:00:00.000Z',
      '2026-10-28T12:00:00.000Z',
      '2026-11-02T12:00:00.000Z',
    ]);
    // Día 31: en noviembre sale el 30.
    const monthly = normalizeRule({ freq: 'monthly', time: '10:00', dayOfMonth: 31 });
    expect(nextRun(monthly, 'UTC', new Date('2026-11-01T00:00:00Z'))?.toISOString()).toBe('2026-11-30T10:00:00.000Z');
  });

  it('cron de 5 campos, con fin y errores claros', () => {
    expect(parseCron('0 9 * * 1-5')).not.toBeNull();
    expect(parseCron('*/15 * * * *')?.minutes).toEqual([0, 15, 30, 45]);
    expect(parseCron('61 * * * *')).toBeNull();
    expect(parseCron('0 9 * *')).toBeNull();
    const cron = normalizeRule({ freq: 'cron', cron: '0 9 * * 1-5' });
    expect(nextRun(cron, 'UTC', new Date('2026-10-24T10:00:00Z'))?.toISOString()).toBe('2026-10-26T09:00:00.000Z'); // sábado → lunes
    expect(upcomingRuns(normalizeRule({ freq: 'daily', time: '09:00' }), 'UTC', new Date('2026-10-25T00:00:00Z'), 5, '2026-10-26T23:59:00Z')).toHaveLength(2);
    expect(() => normalizeRule({ freq: 'weekly', time: '09:00', days: [] })).toThrow('invalid_days');
    expect(() => normalizeRule({ freq: 'cron', cron: 'nope' })).toThrow('invalid_cron');
    expect(() => normalizeRule({ freq: 'daily', time: '25:00' })).toThrow('invalid_time');
  });
});

describe('encuestas', () => {
  it('valida, cuenta votos y lee los votos de WAHA y Evolution', () => {
    expect(() => normalizePoll({ question: 'x', options: ['a'] })).toThrow('poll_options');
    expect(() => normalizePoll({ question: '', options: ['a', 'b'] })).toThrow('poll_question');
    const p = normalizePoll({ question: '¿Qué día?', options: ['Lunes', 'lunes', 'Martes', ' '] });
    expect(p.options).toEqual(['Lunes', 'Martes']);
    expect(tallyPoll(p, [['Lunes'], ['Martes', 'Lunes'], [], ['Otro']])).toMatchObject({ voters: 2, results: [{ option: 'Lunes', votes: 1 }, { option: 'Martes', votes: 1 }] });
    expect(voteOptions(p, [1])).toEqual(['Martes']);
    const waha = parseWahaWebhook({
      event: 'poll.vote',
      payload: { vote: { from: '5491100000000@c.us', to: '15550000001@c.us', fromMe: false, selectedOptions: ['Martes'] }, poll: { id: 'true_5491100000000@c.us_AAA', to: '5491100000000@c.us', fromMe: true } },
    });
    expect(waha).toEqual([{ type: 'poll_vote', chatId: '5491100000000@c.us', pollProviderMessageId: 'true_5491100000000@c.us_AAA', voterPhone: '5491100000000', voterName: '', options: ['Martes'] }]);
    const evo = parseEvolutionWebhook({ event: 'messages.update', data: { keyId: 'POLL1', remoteJid: '120@g.us', pollUpdates: [{ name: 'Lunes', voters: ['5491111@s.whatsapp.net'] }, { name: 'Martes', voters: ['5491111@s.whatsapp.net', '5492222@s.whatsapp.net'] }] } });
    expect(evo.filter((e) => e.type === 'poll_vote')).toHaveLength(2);
  });

  it('manda la encuesta por el proveedor y suma los votos que llegan por webhook', async () => {
    const { user, row } = await setup('gp-poll');
    await ingestEvents(row, [msg('120363000000000001@g.us', 'P-0', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    const sent = await sendMessage(user.id, user.id, chat.id, { body: '', poll: normalizePoll({ question: '¿Qué día?', options: ['Lunes', 'Martes'], multi: false }) });
    expect(sent.poll?.question).toBe('¿Qué día?');
    expect(fakeSent(row.id).at(-1)).toMatchObject({ kind: 'poll' });
    const pid = ((await getDb().prepare('SELECT provider_message_id FROM groups_messages WHERE id = ?').get(sent.id)) as { provider_message_id: string }).provider_message_id;
    await ingestEvents(row, [
      { type: 'poll_vote', chatId: '120363000000000001@g.us', pollProviderMessageId: pid, voterPhone: '5491100000001', voterName: 'Ana', options: ['Martes'] },
      { type: 'poll_vote', chatId: '120363000000000001@g.us', pollProviderMessageId: pid, voterPhone: '5491100000002', voterName: 'Bea', options: ['Martes'] },
      // Cambia su voto: cuenta el último.
      { type: 'poll_vote', chatId: '120363000000000001@g.us', pollProviderMessageId: pid, voterPhone: '5491100000001', voterName: 'Ana', options: ['Lunes'] },
    ]);
    const m = (await listMessages(user.id, chat.id)).find((x) => x.id === sent.id)!;
    expect(m.poll).toMatchObject({ voters: 2, results: [{ option: 'Lunes', votes: 1 }, { option: 'Martes', votes: 1 }] });
  });
});

describe('teléfonos ocultos y acceso por etiqueta', () => {
  it('enmascara números sueltos y dentro de textos', () => {
    expect(maskPhone('5491155550000')).toBe('+54 ••• 00');
    expect(maskPhoneText('Llamar a +54 9 11 5555-0000 hoy')).toBe('Llamar a +54 ••• 00 hoy');
    expect(maskPhoneText('Pedido 1234')).toBe('Pedido 1234');
  });

  it('un miembro ve solo sus etiquetas y lo asignado; la búsqueda también', async () => {
    const { user, row } = await setup('gp-access');
    const member = await makeUser('gp-member');
    const team = await createTeam(user.id, 'Team');
    await addMember(team.id, member.id, 'member');
    await ingestEvents(row, [msg('5491100000011@c.us', 'A-1', 'hola', 'Visible Uno'), msg('5491100000012@c.us', 'A-2', 'hola', 'Oculto Dos'), msg('5491100000013@c.us', 'A-3', 'hola', 'Asignado Tres')]);
    const chats = (await listChats(user.id, user.id)).rows;
    const byName = (n: string) => chats.find((c) => c.name === n)!;
    const vip = await createLabel(user.id, { name: 'VIP' });
    await updateChat(user.id, byName('Visible Uno').id, { labelIds: [vip.id] });
    await updateChat(user.id, byName('Asignado Tres').id, { assignedTo: member.id });
    await setLabelAccess(user.id, vip.id, [member.id]);

    // Sin el ajuste: ve todo.
    let viewer = await groupsViewer(user.id, member.id, 'member');
    expect((await listChats(user.id, member.id, { viewer })).rows).toHaveLength(3);
    await updatePlatformSettings(user.id, { labelAccess: true, maskRoles: ['member'] });
    viewer = await groupsViewer(user.id, member.id, 'member');
    const seen = (await listChats(user.id, member.id, { viewer })).rows.map((c) => c.name).sort();
    expect(seen).toEqual(['Asignado Tres', 'Visible Uno']);
    expect(await canSeeChat(viewer, byName('Oculto Dos').id)).toBe(false);
    // El admin ve todo.
    expect((await listChats(user.id, user.id, { viewer: await groupsViewer(user.id, user.id, 'admin') })).rows).toHaveLength(3);
    // Los teléfonos llegan ocultos al miembro.
    const one = (await listChats(user.id, member.id, { viewer })).rows[0];
    expect(one.phone).toContain('•••');
    // Cmd+K con la misma regla.
    const found = await searchApps({ id: user.id, actingUser: { id: member.id }, role: 'member' }, 'Dos');
    expect(found.filter((f) => f.group === 'groupsChats')).toHaveLength(0);
    const asg = await searchApps({ id: user.id, actingUser: { id: member.id }, role: 'member' }, 'Tres');
    expect(asg.filter((f) => f.group === 'groupsChats')).toHaveLength(1);
  });

  it('el dueño nunca ve los números ocultos', () => {
    const v = viewerFrom('w', 'w', 'owner', { labelAccess: true, maskRoles: ['member', 'admin'] });
    expect(v).toMatchObject({ restricted: false, mask: false });
    expect(maskChat(viewerFrom('w', 'x', 'admin', { labelAccess: false, maskRoles: ['admin'] }), { name: '+5491155550000', phone: '5491155550000' })).toEqual({
      name: '+54 ••• 00',
      phone: '54 ••• 00',
    });
  });
});

describe('auditoría', () => {
  it('anota solo lo que cambió y queda filtrable', async () => {
    const { user, row } = await setup('gp-audit');
    await ingestEvents(row, [msg('5491100000021@c.us', 'AU-1', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    const label = await createLabel(user.id, { name: 'Soporte' });
    await patchChatAs(user.id, { id: user.id }, chat.id, { assignedTo: user.id, labelIds: [label.id] });
    await patchChatAs(user.id, { id: user.id }, chat.id, { status: 'closed' });
    await patchChatAs(user.id, { id: user.id }, chat.id, { status: 'closed' });
    const all = await listAudit(user.id, { chatId: chat.id });
    expect(all.map((e) => e.action).sort()).toEqual(['assigned', 'closed', 'labels']);
    expect(await listAudit(user.id, { chatId: chat.id, action: 'closed' })).toHaveLength(1);
    const changes = chatChanges({ ...chat, labels: [] }, { ...chat, labels: [{ id: 'l', name: 'A', color: 'red' }] });
    expect(changes).toEqual([{ action: 'labels', detail: { added: ['A'], removed: [] } }]);
  });
});

describe('mensajes recurrentes', () => {
  it('cada corrida se reclama una vez, crea un envío y sale con el ritmo de siempre', async () => {
    const { user, row } = await setup('gp-rec');
    await ingestEvents(row, [msg('120363000000000002@g.us', 'R-1', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    const rec = await createRecurring(user.id, user.id, { chatIds: [chat.id], body: 'Recordatorio semanal', rule: { freq: 'daily', time: '09:00' }, timezone: 'UTC' });
    expect(rec.nextRunAt).toBeTruthy();
    expect(rec.upcoming).toHaveLength(3);
    // Vence: dos corridas a la vez crean un solo envío.
    await getDb().prepare('UPDATE groups_recurring SET next_run_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), rec.id);
    const [a, b] = await Promise.all([runDueRecurring(), runDueRecurring()]);
    expect(a + b).toBe(1);
    const runs = (await getDb().prepare('SELECT id FROM groups_broadcasts WHERE recurring_id = ?').all(rec.id)) as Array<{ id: string }>;
    expect(runs).toHaveLength(1);
    await processBroadcasts({ gapMs: 0, broadcastId: runs[0].id });
    expect(fakeSent(row.id).some((s) => s.text === 'Recordatorio semanal')).toBe(true);
    const after = (await getDb().prepare('SELECT next_run_at, runs FROM groups_recurring WHERE id = ?').get(rec.id)) as { next_run_at: string; runs: number };
    expect(Date.parse(after.next_run_at)).toBeGreaterThan(Date.now());
    expect(after.runs).toBe(1);
    // Pausado no corre.
    await updateRecurring(user.id, rec.id, { status: 'paused' });
    await getDb().prepare('UPDATE groups_recurring SET next_run_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), rec.id);
    expect(await runDueRecurring()).toBe(0);
  });

  it('una encuesta recurrente necesita un número con encuestas', async () => {
    const user = await makeUser('gp-rec-cloud');
    const n = await createNumber(user.id, user.id, {
      provider: 'cloud',
      config: { phoneNumberId: '123456', accessToken: 'tok', appSecret: 'sec', verifyToken: 'verify-123' },
    });
    const cloud = (await getNumberRowById(n.id))!;
    await ingestEvents(cloud, [msg('5491100000031@c.us', 'RC-1', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    await expect(
      createRecurring(user.id, user.id, { chatIds: [chat.id], poll: { question: 'q', options: ['a', 'b'] }, rule: { freq: 'daily', time: '09:00' } }),
    ).rejects.toMatchObject({ code: 'polls_unsupported' });
  });
});

describe('integraciones', () => {
  it('valida las credenciales y nunca devuelve los secretos', async () => {
    expect(() => cleanIntegrationConfig('freshdesk', { domain: 'acme', apiKey: '' })).toThrow('missing_api_key');
    expect(cleanIntegrationConfig('freshdesk', { domain: 'https://acme.freshdesk.com/', apiKey: 'k' }).domain).toBe('acme.freshdesk.com');
    expect(() => cleanIntegrationConfig('zoho', { clientId: 'a', clientSecret: 'b', refreshToken: 'c', orgId: 'x', departmentId: '1' })).toThrow('invalid_org_id');
    expect(fromFreshdeskStatus(5)).toBe('closed');
    const user = await makeUser('gp-int-dto');
    await saveIntegration(user.id, user.id, 'freshdesk', { config: { domain: 'acme', apiKey: 'super-secret' } });
    const [dto] = await listIntegrations(user.id);
    expect(JSON.stringify(dto)).not.toContain('super-secret');
    expect(dto.configured.apiKey).toBe(true);
    expect(slackText('groups.ticket.created', { ticket: { id: 't', number: 3, title: 'A <b>', priority: 'high' }, chat: { name: 'Acme' } }, 'https://x.test')).toContain('A &lt;b&gt;');
  });

  it('un ticket nuevo crea uno en Freshdesk y el estado va y vuelve', async () => {
    const { user, row } = await setup('gp-int-fd');
    await ingestEvents(row, [msg('5491100000041@c.us', 'FD-1', 'No llegó la factura')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    await saveIntegration(user.id, user.id, 'freshdesk', { config: { domain: 'acme', apiKey: 'k' } });
    const { ticket } = await createTicket(user.id, user.id, { chatId: chat.id, title: 'Factura', source: 'manual' });
    // emitEventSoon corre en el momento (fuera de un request): el ticket remoto ya existe.
    const [link] = await ticketLinks(ticket.id);
    expect(link).toMatchObject({ kind: 'freshdesk', remoteStatus: 'open' });
    expect(fakeIntegrationCalls().filter((c) => c.method === 'POST' && c.url === 'https://acme.freshdesk.com/api/v2/tickets')).toHaveLength(1);
    // Un evento repetido no crea otro ticket allá.
    await dispatchGroupsEvent(user.id, 'groups.ticket.created', { ticket: { id: ticket.id } });
    expect(fakeIntegrationCalls().filter((c) => c.method === 'POST' && c.url === 'https://acme.freshdesk.com/api/v2/tickets')).toHaveLength(1);
    const create = fakeIntegrationCalls().find((c) => c.method === 'POST' && c.url === 'https://acme.freshdesk.com/api/v2/tickets');
    expect(create?.body).toMatchObject({ subject: 'Factura', phone: '+5491100000041', status: 2, source: 7 });
    // Acá → allá.
    await updateTicket(user.id, ticket.id, { status: 'in_progress' });
    expect(fakeIntegrationCalls().some((c) => c.method === 'PUT' && c.url.endsWith(`/tickets/${link.remoteId}`) && (c.body as { status: number }).status === 3)).toBe(true);
    // Allá → acá (el cron).
    setFakeRemoteStatus(link.remoteId, 4);
    await getDb().prepare('UPDATE groups_ticket_links SET synced_at = ? WHERE ticket_id = ?').run('2000-01-01T00:00:00.000Z', ticket.id);
    expect(await syncRemoteTickets()).toBe(1);
    expect((await getTicket(user.id, ticket.id))?.status).toBe('resolved');
  });
});

describe('servidor MCP', () => {
  it('initialize, tools/list y tools/call con los scopes de la key', async () => {
    const { user, row } = await setup('gp-mcp');
    await ingestEvents(row, [msg('5491100000051@c.us', 'M-1', 'necesito ayuda', 'Mara')]);
    const viewer = await groupsViewer(user.id, user.id, 'owner');
    const ctx = { ws: user.id, personId: user.id, scopes: ['groups:read' as const], viewer };
    const init = await handleRpc(ctx, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    expect(init?.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} } });
    expect(await handleRpc(ctx, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    const list = (await handleRpc(ctx, { jsonrpc: '2.0', id: 2, method: 'tools/list' }))?.result as { tools: Array<{ name: string }> };
    expect(list.tools.map((t) => t.name)).toContain('send_message');
    const chats = (await handleRpc(ctx, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_chats', arguments: { q: 'ayuda' } } }))?.result as {
      structuredContent: { chats: Array<{ id: string; name: string }> };
    };
    expect(chats.structuredContent.chats[0].name).toBe('Mara');
    // Sin groups:write no manda.
    const denied = (await handleRpc(ctx, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'send_message', arguments: { chatId: chats.structuredContent.chats[0].id, body: 'hola' } } }))?.result as { isError: boolean };
    expect(denied.isError).toBe(true);
    const ok = (await handleRpc({ ...ctx, scopes: ['groups:write'] }, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'send_message', arguments: { chatId: chats.structuredContent.chats[0].id, body: 'Ya lo vemos' } } }))?.result as { isError: boolean };
    expect(ok.isError).toBe(false);
    expect(fakeSent(row.id).at(-1)?.text).toBe('Ya lo vemos');
    expect((await handleRpc(ctx, { jsonrpc: '2.0', id: 6, method: 'nope' }))?.error?.code).toBe(-32601);
  });
});

describe('push web', () => {
  it('firma VAPID verificable y avisos pendientes que se entregan una vez', async () => {
    const keys = vapidKeys()!;
    const jwt = vapidJwt(keys, 'https://fcm.googleapis.com', 1_800_000_000);
    const [h, c, sig] = jwt.split('.');
    const pub = Buffer.from(keys.publicKey, 'base64url');
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toMatchObject({ aud: 'https://fcm.googleapis.com' });

    const { user, row } = await setup('gp-push');
    await saveSubscription(user.id, user.id, { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'x', auth: 'y' } });
    await ingestEvents(row, [msg('5491100000061@c.us', 'PU-0', 'hola', 'Pia')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    await updateChat(user.id, chat.id, { assignedTo: user.id });
    const before = fakePushes().length;
    await ingestEvents(row, [msg('5491100000061@c.us', 'PU-1', '¿Me ayudan?', 'Pia')]);
    expect(fakePushes().length).toBe(before + 1);
    const pending = await takePending(user.id, user.id);
    expect(pending[0]).toMatchObject({ title: 'Pia', url: `/app/groups/inbox/${chat.id}` });
    expect(await takePending(user.id, user.id)).toHaveLength(0);
    expect(await notifyPerson(user.id, 'nobody', { chatId: null, title: 't', body: '' })).toBe(0);
  });
});

describe('reportes con filtros', () => {
  it('rango propio y filtro por etiqueta', async () => {
    expect(reportRange(30, { from: '2026-10-01', to: '2026-10-07' })).toMatchObject({ days: 7, from: '2026-10-01', to: '2026-10-07' });
    expect(reportRange(7, {}, new Date('2026-10-25T10:00:00Z')).days).toBe(7);
    const { user, row } = await setup('gp-report');
    await ingestEvents(row, [msg('5491100000071@c.us', 'RP-1', 'uno', 'Uno'), msg('5491100000072@c.us', 'RP-2', 'dos', 'Dos'), msg('5491100000072@c.us', 'RP-3', 'tres', 'Dos')]);
    const chats = (await listChats(user.id, user.id)).rows;
    const label = await createLabel(user.id, { name: 'Clientes' });
    await updateChat(user.id, chats.find((c) => c.name === 'Dos')!.id, { labelIds: [label.id] });
    expect((await groupsAnalytics(user.id, 30)).totals.inbound).toBe(3);
    expect((await groupsAnalytics(user.id, 30, [], { labelId: label.id })).totals.inbound).toBe(2);
    expect((await groupsAnalytics(user.id, 30, [], { from: '2020-01-01', to: '2020-01-31' })).totals.inbound).toBe(0);
  });
});

describe('webhooks: eventos nuevos, claim y reenvío', () => {
  it('emite mensaje saliente y chat asignado, y el reenvío crea una entrega nueva', async () => {
    const { user, row } = await setup('gp-wh');
    const hook = await createWebhook(user.id, { url: 'http://127.0.0.1:9/hook', events: ['groups.message.sent', 'groups.chat.assigned'] });
    await ingestEvents(row, [msg('5491100000081@c.us', 'WH-1', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    await sendMessage(user.id, user.id, chat.id, { body: 'respuesta' });
    await patchChatAs(user.id, { id: user.id }, chat.id, { assignedTo: user.id });
    const log = (await listDeliveries(user.id, hook.id))!;
    expect(log.map((d) => d.event).sort()).toEqual(['groups.chat.assigned', 'groups.message.sent']);
    const againId = await resendDelivery(user.id, log[0].id);
    const again = (await listDeliveries(user.id, hook.id))!.find((d) => d.id === againId);
    expect(again?.payload).toBe(log[0].payload);
    expect(await listDeliveries(user.id, hook.id)).toHaveLength(3);
    // Dos corridas del cron a la vez: cada entrega vencida se intenta una sola vez.
    await getDb().prepare("UPDATE webhook_deliveries SET status = 'pending', next_attempt_at = ?, claimed_until = NULL WHERE webhook_id = ?").run('2000-01-01T00:00:00.000Z', hook.id);
    const before = (await listDeliveries(user.id, hook.id))!.map((d) => [d.id, d.attempts] as const);
    await Promise.all([retryDueWebhooks(500), retryDueWebhooks(500)]);
    const after = new Map((await listDeliveries(user.id, hook.id))!.map((d) => [d.id, d.attempts]));
    for (const [id, n] of before) expect(after.get(id)).toBe(n + 1);
  });
});
