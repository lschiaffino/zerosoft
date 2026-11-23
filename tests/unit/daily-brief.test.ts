/**
 * Resumen del día (lib/daily-brief.ts) en Lines e Inbox, y su email
 * (lib/daily-brief-email.ts). Lo central: nunca trae un chat que la persona no
 * ve (líneas restringidas, acceso por etiqueta, otro workspace, el Inbox de
 * otra persona), ni el texto de un mensaje o de una nota.
 * Números, nombres y textos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, updateChat } from '@/lib/groups';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import type { InboundEvent } from '@/lib/groups-provider';
import { groupsViewer, updatePlatformSettings } from '@/lib/groups-access';
import { briefDismissed, briefEmailOn, briefKey, briefName, cleanDay, cleanDayEnd, dismissBrief, inboxBrief, linesBrief, setBriefEmail, type DailyBrief } from '@/lib/daily-brief';
import { briefEmailDue, buildBriefEmail, dayEndIn, sendDailyBriefEmails } from '@/lib/daily-brief-email';
import { createNotification } from '@/lib/notifications';
import { addMessage, createAccount, upsertThread } from '@/lib/inbox/core';
import { asMember, asOwner, roles, workspaceWithMember } from './access-helpers';
import { saveWorkspaceAppRule } from '@/lib/workspace-apps';
import { createGroupTask } from '@/lib/groups-tasks';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));
const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string; text: string; html?: string }> }));
vi.mock('@/lib/email', async (orig) => ({
  ...((await orig()) as object),
  sendEmail: async (o: { to: string; subject: string; text: string; html?: string }) => {
    mail.sent.push(o);
    return { ok: true };
  },
}));

const A = '5490000000301';
const B = '5490000000302';
const C = '5490000000303';
const SECRET = 'texto privado de la nota';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  mail.sent = [];
});
afterEach(() => vi.unstubAllEnvs());

const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);

async function line(ws: string, visibility: 'all' | 'restricted' = 'all') {
  const n = await createNumber(ws, ws, { provider: 'fake', visibility });
  await connectNumber(ws, n.id);
  const s = fakeState(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return (await getNumberRowById(n.id))!;
}

let seq = 0;
const msg = (chatId: string, sender: string, body = 'hola'): InboundEvent =>
  ({
    type: 'message',
    chatId,
    isGroup: chatId.endsWith('@g.us'),
    ...(chatId.endsWith('@g.us') ? { chatName: `Grupo ${chatId.slice(-6, -5)}` } : {}),
    fromMe: false,
    senderPhone: sender,
    senderName: 'Persona',
    providerMessageId: `brief-${++seq}-${Math.random().toString(36).slice(2)}`,
    body,
    timestamp: new Date(Date.now() - 30 * 60_000).toISOString(),
  }) as InboundEvent;

const ids = (b: DailyBrief, kind: string) => b.items.find((i) => i.kind === kind)?.chats.map((c) => c.id) ?? [];
const count = (b: DailyBrief, kind: string) => b.items.find((i) => i.kind === kind)?.count ?? 0;

describe('resumen del día: lo puro', () => {
  it('el día local tiene que ser una fecha de verdad', () => {
    expect(cleanDay('2026-11-23')).toBe('2026-11-23');
    expect(cleanDay('2026-02-30')).toBeNull();
    expect(cleanDay('ayer')).toBeNull();
    expect(cleanDay(undefined)).toBeNull();
    const now = new Date('2026-11-23T12:00:00Z');
    expect(cleanDayEnd('2026-11-24T03:00:00Z', now).toISOString()).toBe('2026-11-24T03:00:00.000Z');
    // Fuera de rango (pasado o más de 26 horas): 24 horas desde ahora.
    expect(cleanDayEnd('2026-11-20T03:00:00Z', now).toISOString()).toBe('2026-11-24T12:00:00.000Z');
    expect(cleanDayEnd('basura', now).toISOString()).toBe('2026-11-24T12:00:00.000Z');
  });

  it('los nombres van limpios, cortos y con los teléfonos ocultos si corresponde', () => {
    expect(briefName('Grupo\nde prueba\u0007')).toBe('Grupo de prueba');
    expect(briefName('x'.repeat(200))).toHaveLength(80);
    expect(briefName('Cliente +54 9 11 0000-0301', true)).not.toContain('0000-0301');
  });

  it('el email sale entre las 8 y las 11 de la persona, una vez por día', () => {
    const at = new Date('2026-11-23T12:30:00Z');
    expect(briefEmailDue('America/Argentina/Buenos_Aires', null, at)).toBe('2026-11-23');
    expect(briefEmailDue('America/Argentina/Buenos_Aires', '2026-11-23', at)).toBeNull();
    expect(briefEmailDue('UTC', null, at)).toBeNull();
    expect(briefEmailDue('', null, new Date('2026-11-23T09:00:00Z'))).toBe('2026-11-23');
  });
});

describe('Lines: solo lo que la persona ve', () => {
  it('líneas restringidas, acceso por etiqueta y otro workspace no entran', async () => {
    const w = await workspaceWithMember('brief-lines');
    const open = await line(w.owner.id, 'all');
    const closed = await line(w.owner.id, 'restricted');
    const foreign = await line(w.stranger.id, 'all');
    await ingestEvents(open, [msg(`${A}@s.whatsapp.net`, A), msg('120363000000000501@g.us', B)]);
    await ingestEvents(closed, [msg(`${B}@s.whatsapp.net`, B), msg('120363000000000502@g.us', C)]);
    await ingestEvents(foreign, [msg(`${C}@s.whatsapp.net`, C)]);
    const all = (await listChats(w.owner.id, w.owner.id)).rows;
    const dmOpen = all.find((c) => c.numberId === open.id && c.kind === 'dm')!;
    const groupOpen = all.find((c) => c.numberId === open.id && c.kind === 'group')!;
    const dmClosed = all.find((c) => c.numberId === closed.id && c.kind === 'dm')!;
    const groupClosed = all.find((c) => c.numberId === closed.id && c.kind === 'group')!;
    // Las dos asignadas a la persona: la de la línea que no ve no puede entrar.
    await updateChat(w.owner.id, dmOpen.id, { assignedTo: w.member.id }, w.owner.id);
    await updateChat(w.owner.id, dmClosed.id, { assignedTo: w.member.id }, w.owner.id);

    const member = await groupsViewer(w.owner.id, w.member.id, 'member');
    const b = await linesBrief(member);
    expect(ids(b, 'waiting')).toEqual([dmOpen.id]);
    expect(count(b, 'waiting')).toBe(1);
    expect(ids(b, 'groups')).toEqual([groupOpen.id]);
    expect(JSON.stringify(b)).not.toContain(dmClosed.id);
    expect(JSON.stringify(b)).not.toContain(groupClosed.id);
    // El owner ve las dos líneas (sus grupos sin asignar), pero lo asignado es de la persona.
    const owner = await linesBrief(await groupsViewer(w.owner.id, w.owner.id, 'owner'));
    expect(count(owner, 'waiting')).toBe(0);
    expect(ids(owner, 'groups').sort()).toEqual([groupOpen.id, groupClosed.id].sort());
    // Otro workspace: nada de este.
    const stranger = await linesBrief(await groupsViewer(w.stranger.id, w.stranger.id, 'owner'));
    expect(JSON.stringify(stranger)).not.toContain(dmOpen.id);
    expect(count(stranger, 'waiting')).toBe(0);

    // Acceso por etiqueta: sin la etiqueta, solo lo asignado (que sigue en su línea).
    await updatePlatformSettings(w.owner.id, { labelAccess: true });
    const restricted = await linesBrief(await groupsViewer(w.owner.id, w.member.id, 'member'));
    expect(ids(restricted, 'waiting')).toEqual([dmOpen.id]);
    expect(count(restricted, 'groups')).toBe(0);
  });

  it('tickets, tareas y menciones de chats que ve; nunca el texto de una nota', async () => {
    const w = await workspaceWithMember('brief-more');
    const open = await line(w.owner.id, 'all');
    const closed = await line(w.owner.id, 'restricted');
    await ingestEvents(open, [msg('120363000000000511@g.us', A)]);
    await ingestEvents(closed, [msg('120363000000000512@g.us', B)]);
    const all = (await listChats(w.owner.id, w.owner.id)).rows;
    const seen = all.find((c) => c.numberId === open.id)!;
    const hidden = all.find((c) => c.numberId === closed.id)!;
    const { createTicket } = await import('@/lib/groups-tickets');
    await createTicket(w.owner.id, w.owner.id, { chatId: seen.id, title: 'Uno' });
    await createTicket(w.owner.id, w.owner.id, { chatId: hidden.id, title: 'Dos' });
    // Uno vencido en cada chat: en riesgo solo el que se ve.
    await getDb().prepare('UPDATE groups_tickets SET first_response_due_at = ? WHERE user_id = ?').run(new Date(Date.now() - 60_000).toISOString(), w.owner.id);
    for (const chatId of [seen.id, hidden.id]) {
      await createNotification({ userId: w.member.id, type: 'mention', title: 'x', body: SECRET, href: `/app/lines/inbox/${chatId}`, sourceType: 'groups_chat', sourceId: chatId });
      // Una tarea de la persona en cada chat, para hoy; y otra para la semana que viene (no cuenta).
      await createGroupTask(w.owner.id, w.owner.id, { chatId, title: SECRET, ownerId: w.member.id, dueAt: new Date(Date.now() + 60 * 60_000).toISOString() });
      await createGroupTask(w.owner.id, w.owner.id, { chatId, title: SECRET, ownerId: w.member.id, dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });
    }
    // Un aviso de mención de un chat de verdad de otro workspace tampoco entra.
    const foreign = await line(w.stranger.id);
    await ingestEvents(foreign, [msg('120363000000000513@g.us', C)]);
    const foreignChat = (await listChats(w.stranger.id, w.stranger.id)).rows[0];
    await createNotification({ userId: w.member.id, type: 'mention', title: 'x', href: '/', sourceType: 'groups_chat', sourceId: foreignChat.id });
    const b = await linesBrief(await groupsViewer(w.owner.id, w.member.id, 'member'));
    expect(count(b, 'tasks')).toBe(1);
    expect(ids(b, 'tasks')).toEqual([seen.id]);
    expect(count(b, 'tickets')).toBe(1);
    expect(ids(b, 'tickets')).toEqual([seen.id]);
    expect(count(b, 'sla')).toBe(1);
    expect(count(b, 'mentions')).toBe(1);
    expect(ids(b, 'mentions')).toEqual([seen.id]);
    expect(JSON.stringify(b)).not.toContain(SECRET);
    expect(JSON.stringify(b)).not.toContain(hidden.id);
    expect(JSON.stringify(b)).not.toContain(foreignChat.id);
    // El owner ve los dos chats: dos de cada cosa.
    const owner = await linesBrief(await groupsViewer(w.owner.id, w.owner.id, 'owner'));
    expect(count(owner, 'tickets')).toBe(2);
  });

  it('con los teléfonos ocultos, los nombres van ocultos', async () => {
    const w = await workspaceWithMember('brief-mask');
    const n = await line(w.owner.id);
    await ingestEvents(n, [{ ...msg(`${A}@s.whatsapp.net`, A), senderName: '' } as InboundEvent]);
    const chat = (await listChats(w.owner.id, w.owner.id)).rows[0];
    await getDb().prepare("UPDATE groups_chats SET name = '' WHERE id = ?").run(chat.id);
    await updateChat(w.owner.id, chat.id, { assignedTo: w.member.id }, w.owner.id);
    await updatePlatformSettings(w.owner.id, { maskRoles: ['member'] });
    const b = await linesBrief(await groupsViewer(w.owner.id, w.member.id, 'member'));
    expect(ids(b, 'waiting')).toEqual([chat.id]);
    expect(JSON.stringify(b)).not.toContain(A);
  });
});

describe('Inbox: solo el de la persona', () => {
  it('por responder, grupos sin leer, recordatorios y menciones; el Inbox de otra persona nunca', async () => {
    const w = await workspaceWithMember('brief-inbox');
    const mine = await createAccount(w.member.id, { kind: 'whatsapp', provider: 'fake', address: '+54 9 00 0000-0399' });
    const theirs = await createAccount(w.friend.id, { kind: 'whatsapp', provider: 'fake', address: '+54 9 00 0000-0398' });
    const dm = await upsertThread(mine, { externalId: `${A}@s.whatsapp.net`, kind: 'dm', handle: A });
    await addMessage(dm, { externalId: 'b-1', fromMe: false, body: 'consulta', senderHandle: A });
    const group = await upsertThread(mine, { externalId: '120363000000000521@g.us', kind: 'group', handle: '' });
    await addMessage(group, { externalId: 'b-2', fromMe: false, body: '@5490000000399 mirá', senderHandle: B, meta: JSON.stringify({ mentions: ['5490000000399'] }) });
    // Una mención a otro número no cuenta.
    await addMessage(group, { externalId: 'b-2b', fromMe: false, body: '@5490000000398 otra', senderHandle: B, meta: JSON.stringify({ mentions: ['5490000000398'] }) });
    const other = await upsertThread(theirs, { externalId: `${C}@s.whatsapp.net`, kind: 'dm', handle: C });
    await addMessage(other, { externalId: 'b-3', fromMe: false, body: 'para otra persona', senderHandle: C });
    await getDb().prepare('UPDATE inbox_threads SET follow_up_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), dm.id);

    const b = await inboxBrief(w.member.id);
    expect(ids(b, 'reply')).toEqual([dm.id]);
    expect(ids(b, 'unreadGroups')).toEqual([group.id]);
    expect(ids(b, 'reminders')).toEqual([dm.id]);
    expect(count(b, 'groupMentions')).toBe(1);
    expect(ids(b, 'groupMentions')).toEqual([group.id]);
    expect(JSON.stringify(b)).not.toContain(other.id);
    expect(JSON.stringify(b)).not.toContain('mirá');
    const friend = await inboxBrief(w.friend.id);
    expect(JSON.stringify(friend)).not.toContain(dm.id);
    expect(ids(friend, 'reply')).toEqual([other.id]);
  });
});

describe('resumen del día: rutas', () => {
  it('Lines: anónimo 401, cada uno ve lo suyo; cerrar es por persona y por día', async () => {
    const w = await workspaceWithMember('brief-route');
    const n = await line(w.owner.id);
    await ingestEvents(n, [msg(`${A}@s.whatsapp.net`, A)]);
    const chat = (await listChats(w.owner.id, w.owner.id)).rows[0];
    await updateChat(w.owner.id, chat.id, { assignedTo: w.member.id }, w.owner.id);
    const route = await import('@/app/api/groups/brief/route');
    const get = (day = '2026-11-23') => route.GET(new Request(`http://x/api/groups/brief?day=${day}`));
    for (const r of roles(w)) {
      session.user = r.user;
      const res = await get();
      if (r.name === 'anonymous') {
        expect(res.status).toBe(401);
        continue;
      }
      expect(res.status).toBe(200);
      const body = (await res.json()) as { brief: DailyBrief; dismissed: boolean };
      if (r.name === 'teammate') expect(ids(body.brief, 'waiting')).toEqual([chat.id]);
      else expect(count(body.brief, 'waiting')).toBe(0);
      if (r.name === 'other_workspace') expect(JSON.stringify(body)).not.toContain(chat.id);
    }
    session.user = asMember(w.owner, w.member);
    expect((await get('mañana')).status).toBe(400);
    expect((await route.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ action: 'dismiss', day: '2026-11-23' }) }))).status).toBe(200);
    expect(((await (await get()).json()) as { dismissed: boolean }).dismissed).toBe(true);
    expect(((await (await get('2026-11-24')).json()) as { dismissed: boolean }).dismissed).toBe(false);
    // Cerrarla una persona no la cierra para otra.
    session.user = asMember(w.owner, w.friend);
    expect(((await (await get()).json()) as { dismissed: boolean }).dismissed).toBe(false);
    expect(await briefDismissed(w.member.id, briefKey('lines', w.owner.id), '2026-11-23')).toBe(true);
    // Es por workspace: en el suyo propio no quedó cerrada; Inbox tampoco.
    expect(await briefDismissed(w.member.id, briefKey('lines', w.member.id), '2026-11-23')).toBe(false);
    expect(await briefDismissed(w.member.id, briefKey('inbox'), '2026-11-23')).toBe(false);
    // Deshacer (la persona que la cerró).
    session.user = asMember(w.owner, w.member);
    expect((await route.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ action: 'restore' }) }))).status).toBe(200);
    expect(((await (await get()).json()) as { dismissed: boolean }).dismissed).toBe(false);
  });

  it('Inbox y el email: de la persona real; anónimo 401', async () => {
    const w = await workspaceWithMember('brief-route-inbox');
    const inbox = await import('@/app/api/inbox/brief/route');
    const pref = await import('@/app/api/daily-brief/route');
    session.user = null;
    expect((await inbox.GET(new Request('http://x/api/inbox/brief?day=2026-11-23'))).status).toBe(401);
    expect((await pref.GET()).status).toBe(401);
    session.user = asMember(w.owner, w.member);
    expect((await inbox.GET(new Request('http://x/api/inbox/brief?day=2026-11-23'))).status).toBe(200);
    expect((await pref.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ email: 'yes' }) }))).status).toBe(400);
    expect((await pref.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ email: true, timeZone: 'America/Argentina/Buenos_Aires' }) }))).status).toBe(200);
    expect(((await getDb().prepare('SELECT time_zone FROM daily_brief_prefs WHERE user_id = ?').get(w.member.id)) as { time_zone: string }).time_zone).toBe('America/Argentina/Buenos_Aires');
    expect(await briefEmailOn(w.member.id)).toBe(true);
    expect(await briefEmailOn(w.owner.id)).toBe(false);
    session.user = asOwner(w.owner);
    expect(((await (await pref.GET()).json()) as { email: boolean }).email).toBe(false);
  });
});

describe('resumen del día: el email', () => {
  it('solo a quien lo pidió, una vez por día, con nombres y sin textos; no sale si no hay nada', async () => {
    const w = await workspaceWithMember('brief-email');
    const n = await line(w.owner.id);
    await ingestEvents(n, [msg(`${A}@s.whatsapp.net`, A, SECRET)]);
    const chat = (await listChats(w.owner.id, w.owner.id)).rows[0];
    await updateChat(w.owner.id, chat.id, { assignedTo: w.member.id }, w.owner.id);
    await getDb().prepare("UPDATE users SET time_zone = 'UTC', active_team_id = ? WHERE id = ?").run(w.team.id, w.member.id);
    await getDb().prepare("UPDATE users SET time_zone = 'UTC' WHERE id = ?").run(w.friend.id);
    await setBriefEmail(w.member.id, true);
    await setBriefEmail(w.friend.id, true);
    const at = new Date('2026-11-23T09:00:00Z');

    expect(await sendDailyBriefEmails({ now: at })).toBe(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(w.member.email);
    expect(mail.sent[0].text).toContain('1 chat waiting for your reply');
    expect(mail.sent[0].text).not.toContain(SECRET);
    expect(mail.sent[0].html).not.toContain(SECRET);
    // El mismo día no sale otra vez; el que no tenía nada tampoco recibió.
    expect(await sendDailyBriefEmails({ now: new Date('2026-11-23T10:00:00Z') })).toBe(0);
    // Fuera de hora, nada; al otro día, sí.
    expect(await sendDailyBriefEmails({ now: new Date('2026-11-24T20:00:00Z') })).toBe(0);
    expect(await sendDailyBriefEmails({ now: new Date('2026-11-24T08:30:00Z') })).toBe(1);
    // Apagado: no sale más.
    await setBriefEmail(w.member.id, false);
    expect(await sendDailyBriefEmails({ now: new Date('2026-11-25T08:30:00Z') })).toBe(0);
  });

  it('no sale si el workspace pide dos pasos y no los tiene, si le apagaron Lines, si ya no es parte o si es invitada', async () => {
    const mk = async (label: string) => {
      const w = await workspaceWithMember(label);
      const n = await line(w.owner.id);
      await ingestEvents(n, [msg(`${A}@s.whatsapp.net`, A)]);
      const chat = (await listChats(w.owner.id, w.owner.id)).rows[0];
      await updateChat(w.owner.id, chat.id, { assignedTo: w.member.id }, w.owner.id);
      await getDb().prepare("UPDATE users SET time_zone = 'UTC', active_team_id = ? WHERE id = ?").run(w.team.id, w.member.id);
      await setBriefEmail(w.member.id, true);
      return w;
    };
    const at = () => new Date(`2026-12-${String(++day).padStart(2, '0')}T09:00:00Z`);
    let day = 0;
    // Cada caso: primero sale (el control), después de la restricción ya no.
    const blocked = async (label: string, restrict: (w: Awaited<ReturnType<typeof mk>>) => Promise<unknown>) => {
      const w = await mk(label);
      mail.sent = [];
      expect(await sendDailyBriefEmails({ now: at() })).toBe(1);
      expect(mail.sent.map((m) => m.to)).toEqual([w.member.email]);
      await restrict(w);
      mail.sent = [];
      expect(await sendDailyBriefEmails({ now: at() })).toBe(0);
      expect(mail.sent).toEqual([]);
    };
    await blocked('brief-mfa', (w) => getDb().prepare('UPDATE teams SET require_mfa = 1 WHERE id = ?').run(w.team.id));
    await blocked('brief-off', (w) => saveWorkspaceAppRule(w.owner.id, 'groups', { mode: 'some', people: [w.friend.id], teams: [], denied: [] }, w.owner.id));
    await blocked('brief-gone', (w) => getDb().prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(w.team.id, w.member.id));
    await blocked('brief-guest', (w) => getDb().prepare("UPDATE team_members SET role = 'guest' WHERE team_id = ? AND user_id = ?").run(w.team.id, w.member.id));
  });

  it('el fin del día local también con zonas de media hora', () => {
    const now = new Date('2026-11-23T10:00:00Z');
    // India (+5:30): son las 15:30, termina a las 18:30 UTC.
    expect(dayEndIn('Asia/Kolkata', now).toISOString()).toBe('2026-11-23T18:30:00.000Z');
    expect(dayEndIn('UTC', now).toISOString()).toBe('2026-11-24T00:00:00.000Z');
    expect(dayEndIn('no/existe', now).toISOString()).toBe('2026-11-24T00:00:00.000Z');
  });

  it('el texto del email en el idioma de la persona', () => {
    const brief: DailyBrief = { app: 'inbox', items: [{ kind: 'reply', count: 2, chatTotal: 2, chats: [{ id: 'x', name: 'Uno' }] }] };
    const es = buildBriefEmail([brief], 'es');
    expect(es.subject).toBe('Tu día en zerosoft');
    expect(es.text).toContain('2 chats por responder: Uno');
    const html = buildBriefEmail([{ app: 'inbox', items: [{ kind: 'reply', count: 1, chatTotal: 1, chats: [{ id: 'x', name: '<b>x</b>' }] }] }], 'en').html;
    expect(html).not.toContain('<b>x</b>');
  });
});

it('dismissBrief y briefDismissed', async () => {
  const w = await workspaceWithMember('brief-dismiss');
  await dismissBrief(w.member.id, briefKey('inbox'), '2026-11-23');
  expect(await briefDismissed(w.member.id, briefKey('inbox'), '2026-11-23')).toBe(true);
  expect(await briefDismissed(w.member.id, briefKey('inbox'), '2026-11-24')).toBe(false);
});
