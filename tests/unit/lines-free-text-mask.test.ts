/**
 * Lines: los textos libres (tareas, tickets, notas internas, programados,
 * envíos, recurrentes y comentarios de una tarea de un chat) no muestran los
 * teléfonos a quien se le ocultan, y guardar lo que esa persona editó no pisa
 * los números que no ve. El owner (sin máscara) los ve. Miradas: anónimo,
 * otro workspace, miembro con teléfonos ocultos y owner. Teléfonos de prueba
 * (555) y datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, sendMessage } from '@/lib/groups';
import { groupsViewer, maskMessage, updatePlatformSettings } from '@/lib/groups-access';
import { maskPhoneText, unmaskEdit } from '@/lib/groups-mask';
import { lineRefs, type SiblingRow } from '@/lib/groups-same-chat';
import { createGroupTask, fireTaskReminders, listGroupTasks } from '@/lib/groups-tasks';
import { createTicket } from '@/lib/groups-tickets';
import { createBroadcast } from '@/lib/groups-broadcasts';
import type { InboundEvent } from '@/lib/groups-provider';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const tasksRoute = await import('@/app/api/groups/tasks/route');
const taskRoute = await import('@/lib/routes/groups/tasks/[id]/route');

beforeEach(() => {
  session.user = null;
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// Un teléfono escrito a mano en un texto (con espacios, como lo tipea una persona) y sus dígitos.
const TYPED = '+1 555 010 4477';
const DIGITS = ['5550104477', '555 010 4477'];
const SENDER = '15550101888';
const json = { 'content-type': 'application/json' };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const noDigits = (text: string) => {
  for (const d of DIGITS) expect(text).not.toContain(d);
};

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  await updatePlatformSettings(ws, { maskRoles: ['member'] });
  const n = await createNumber(ws, ws, { provider: 'fake' });
  await connectNumber(ws, n.id);
  const state = (globalThis as unknown as { __groupsFake?: Map<string, { connectedAt?: number }> }).__groupsFake?.get(n.id);
  if (state) state.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected', phone = '15550000002' WHERE id = ?").run(n.id);
  const row = (await getNumberRowById(n.id))!;
  const jid = `1203631${Date.now()}${Math.floor(Math.random() * 1000)}@g.us`;
  await ingestEvents(row, [
    {
      type: 'message',
      chatId: jid,
      isGroup: true,
      chatName: `Couriers ${label}`,
      fromMe: false,
      senderPhone: SENDER,
      senderName: '',
      providerMessageId: `m-${Math.random().toString(36).slice(2)}`,
      body: 'the parcel ships monday',
      timestamp: new Date().toISOString(),
    } as InboundEvent,
  ]);
  const chat = (await listChats(ws, ws, {})).rows.find((c) => c.name === `Couriers ${label}`)!;
  return { w, ws, chat, numberId: n.id };
}

describe('unmaskEdit (puro)', () => {
  it('devuelve cada teléfono enmascarado a su número y deja lo demás como se escribió', () => {
    const original = `Call ${TYPED} or +44 7700 900123 tomorrow`;
    const masked = maskPhoneText(original);
    noDigits(masked);
    expect(unmaskEdit(original, masked)).toBe(original);
    expect(unmaskEdit(original, `${masked} (urgent)`)).toBe(`${original} (urgent)`);
    // Lo que la persona borró no vuelve; un texto nuevo sin máscara queda tal cual.
    expect(unmaskEdit(original, 'Done')).toBe('Done');
    expect(unmaskEdit('', 'Call +1 ••• 77')).toBe('Call +1 ••• 77');
  });
});

describe('Lines: tareas con un teléfono escrito en el título y las notas', () => {
  async function withTask(label: string) {
    const s = await setup(label);
    const task = await createGroupTask(s.ws, s.ws, { chatId: s.chat.id, title: `Call ${TYPED}`, notes: `Backup number ${TYPED}`, ownerId: s.w.member.id });
    return { ...s, task };
  }
  const list = (chat: string) => tasksRoute.GET(new NextRequest(`http://localhost/api/groups/tasks?chat=${chat}&status=all`));

  it('anónimo 401 y otro workspace no la encuentra', async () => {
    const s = await withTask('ftm-task-anon');
    expect((await list(s.chat.id)).status).toBe(401);
    session.user = asOwner(s.w.stranger);
    expect((await taskRoute.GET(new Request('http://localhost'), ctx(s.task.id))).status).toBe(404);
    const other = await list(s.chat.id);
    expect(((await other.json()) as { tasks?: unknown[] }).tasks ?? []).toEqual([]);
  });

  it('el miembro con teléfonos ocultos no ve los dígitos en la lista ni en el detalle; el owner sí', async () => {
    const s = await withTask('ftm-task-view');
    session.user = asMember(s.w.owner, s.w.member);
    const listed = await (await list(s.chat.id)).text();
    expect(listed).toContain(s.task.id);
    noDigits(listed);
    const one = await (await taskRoute.GET(new Request('http://localhost'), ctx(s.task.id))).text();
    expect(one).toContain('"notes"');
    noDigits(one);
    session.user = asOwner(s.w.owner);
    expect(await (await list(s.chat.id)).text()).toContain(TYPED);
  });

  it('editar con la máscara no pisa el número guardado', async () => {
    const s = await withTask('ftm-task-edit');
    session.user = asMember(s.w.owner, s.w.member);
    const shown = (await (await taskRoute.GET(new Request('http://localhost'), ctx(s.task.id))).json()) as { title: string; notes: string };
    const res = await taskRoute.PATCH(
      new Request('http://localhost', { method: 'PATCH', headers: json, body: JSON.stringify({ title: shown.title, notes: `${shown.notes}, after 5pm` }) }),
      ctx(s.task.id),
    );
    expect(res.status).toBe(200);
    noDigits(await res.text());
    const row = (await getDb().prepare('SELECT subject, body FROM crm_activities WHERE id = ?').get(s.task.activityId)) as { subject: string; body: string };
    expect(row.subject).toBe(`Call ${TYPED}`);
    expect(row.body).toBe(`Backup number ${TYPED}, after 5pm`);
  });

  it('el aviso a la hora de la tarea no trae los dígitos a quien se le ocultan', async () => {
    const s = await withTask('ftm-task-remind');
    const soon = new Date(Date.now() - 1000).toISOString().slice(0, 19).replace('T', ' ');
    await getDb().prepare('UPDATE crm_activities SET due_at = ? WHERE id = ?').run(soon, s.task.activityId);
    await fireTaskReminders({ now: new Date(Date.now() + 60_000) });
    const notes = (await getDb().prepare("SELECT title, body FROM notifications WHERE user_id = ? AND type = 'groups_reminder'").all(s.w.member.id)) as Array<{ title: string; body: string }>;
    expect(notes.length).toBe(1);
    noDigits(JSON.stringify(notes));
  });

  it('las tareas del inicio pasan por la misma máscara', async () => {
    const s = await withTask('ftm-task-home');
    const viewer = await groupsViewer(s.ws, s.w.member.id, 'member');
    const rows = await listGroupTasks(s.ws, s.w.member.id, { status: 'open', ownerId: 'me', viewer });
    expect(rows.map((r) => r.id)).toEqual([s.task.id]);
    noDigits(JSON.stringify(rows));
  });
});

describe('Lines: tickets con un teléfono en el título y en un campo de texto', () => {
  it('lista, detalle y edición enmascarada sin perder el número; el owner lo ve', async () => {
    const s = await setup('ftm-ticket');
    const { ticket } = await createTicket(s.ws, s.ws, { chatId: s.chat.id, title: `Refund for ${TYPED}`, source: 'manual' });
    const ticketsRoute = await import('@/app/api/groups/tickets/route');
    const ticketRoute = await import('@/lib/routes/groups/tickets/[id]/route');
    const listIt = () => ticketsRoute.GET(new NextRequest('http://localhost/api/groups/tickets?status=all'));
    expect((await listIt()).status).toBe(401);
    session.user = asOwner(s.w.stranger);
    expect((await ticketRoute.GET(new Request('http://localhost'), ctx(ticket.id))).status).toBe(404);
    session.user = asMember(s.w.owner, s.w.member);
    const listed = await (await listIt()).text();
    expect(listed).toContain(ticket.id);
    noDigits(listed);
    const shown = (await (await ticketRoute.GET(new Request('http://localhost'), ctx(ticket.id))).json()) as { title: string };
    noDigits(shown.title);
    const res = await ticketRoute.PATCH(
      new Request('http://localhost', { method: 'PATCH', headers: json, body: JSON.stringify({ title: `${shown.title} (paid)` }) }),
      ctx(ticket.id),
    );
    expect(res.status).toBe(200);
    noDigits(await res.text());
    const row = (await getDb().prepare('SELECT title FROM groups_tickets WHERE id = ?').get(ticket.id)) as { title: string };
    expect(row.title).toBe(`Refund for ${TYPED} (paid)`);
    session.user = asOwner(s.w.owner);
    expect(await (await listIt()).text()).toContain(TYPED);
  });
});

describe('Lines: notas internas', () => {
  it('el hilo y la edición: sin los dígitos para quien se le ocultan, y el número guardado no se pierde', async () => {
    const s = await setup('ftm-note');
    const note = await sendMessage(s.ws, s.ws, s.chat.id, { body: `Client asked to call ${TYPED}`, note: true });
    const viewer = await groupsViewer(s.ws, s.w.member.id, 'member');
    noDigits(JSON.stringify(maskMessage(viewer, note)));
    expect(maskMessage(await groupsViewer(s.ws, s.ws, 'owner'), note).body).toContain(TYPED);
    const messageRoute = await import('@/lib/routes/groups/messages/[id]/route');
    session.user = asMember(s.w.owner, s.w.member, 'admin');
    await updatePlatformSettings(s.ws, { maskRoles: ['member', 'admin'] });
    const shown = maskMessage(await groupsViewer(s.ws, s.w.member.id, 'admin'), note).body;
    const res = await messageRoute.POST(
      new Request('http://localhost', { method: 'POST', headers: json, body: JSON.stringify({ action: 'edit', body: `${shown} today` }) }),
      ctx(note.id),
    );
    expect(res.status).toBe(200);
    noDigits(await res.text());
    const row = (await getDb().prepare('SELECT body FROM groups_messages WHERE id = ?').get(note.id)) as { body: string };
    expect(row.body).toBe(`Client asked to call ${TYPED} today`);
  });
});

describe('Lines: programados, envíos y recurrentes', () => {
  it('la lista y el detalle no traen los dígitos; editar con la máscara no los pierde', async () => {
    const s = await setup('ftm-sched');
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const b = await createBroadcast(s.ws, s.ws, { chatIds: [s.chat.id], body: `Reminder: call ${TYPED}`, name: `Follow ${TYPED}`, scheduledAt: later, kind: 'scheduled' });
    const route = await import('@/app/api/groups/broadcasts/route');
    const one = await import('@/lib/routes/groups/broadcasts/[id]/route');
    expect((await route.GET(new Request('http://localhost/api/groups/broadcasts?view=scheduled'))).status).toBe(401);
    session.user = asOwner(s.w.stranger);
    expect((await one.GET(new Request('http://localhost'), ctx(b.id))).status).toBe(404);
    session.user = asMember(s.w.owner, s.w.member);
    const scheduled = await (await route.GET(new Request(`http://localhost/api/groups/broadcasts?view=scheduled&chat=${s.chat.id}`))).text();
    expect(scheduled).toContain(b.id);
    noDigits(scheduled);
    const all = await (await route.GET(new Request('http://localhost/api/groups/broadcasts'))).text();
    expect(all).toContain(b.id);
    noDigits(all);
    const detail = (await (await one.GET(new Request('http://localhost'), ctx(b.id))).json()) as { broadcast: { body: string } };
    noDigits(JSON.stringify(detail));
    const res = await one.PATCH(
      new Request('http://localhost', { method: 'PATCH', headers: json, body: JSON.stringify({ body: `${detail.broadcast.body} before noon` }) }),
      ctx(b.id),
    );
    expect(res.status).toBe(200);
    noDigits(await res.text());
    const row = (await getDb().prepare('SELECT body, name FROM groups_broadcasts WHERE id = ?').get(b.id)) as { body: string; name: string };
    expect(row.body).toBe(`Reminder: call ${TYPED} before noon`);
    expect(row.name).toBe(`Follow ${TYPED}`);
    session.user = asOwner(s.w.owner);
    expect(await (await route.GET(new Request('http://localhost/api/groups/broadcasts?view=scheduled'))).text()).toContain(TYPED);
  });

  it('recurrentes: la lista sin los dígitos para quien se le ocultan', async () => {
    const s = await setup('ftm-rec');
    const { createRecurring } = await import('@/lib/groups-recurring');
    await createRecurring(s.ws, s.ws, { numberId: s.numberId, chatIds: [s.chat.id], body: `Weekly: call ${TYPED}`, rule: { freq: 'daily', time: '09:00' }, timezone: 'UTC' });
    const route = await import('@/app/api/groups/recurring/route');
    session.user = asMember(s.w.owner, s.w.member);
    const text = await (await route.GET(new Request('http://localhost/api/groups/recurring'))).text();
    expect(text).toContain('Weekly');
    noDigits(text);
  });
});

describe('CRM: comentarios de una tarea de un chat de Lines', () => {
  it('el hilo no trae los dígitos a quien se le ocultan; el owner sí', async () => {
    const s = await setup('ftm-comments');
    const task = await createGroupTask(s.ws, s.ws, { chatId: s.chat.id, title: 'Courier follow-up', ownerId: s.w.member.id });
    const { createComment } = await import('@/lib/crm-activity-comments');
    await createComment(s.ws, task.activityId, s.ws, `Their other phone is ${TYPED}`);
    const route = await import('@/lib/routes/crm/activities/[id]/comments/route');
    const get = () => route.GET(new NextRequest(`http://localhost/api/crm/activities/${task.activityId}/comments`), ctx(task.activityId));
    expect((await get()).status).toBe(401);
    session.user = asOwner(s.w.stranger);
    expect((await get()).status).toBe(404);
    session.user = asMember(s.w.owner, s.w.member);
    const masked = await get();
    expect(masked.status).toBe(200);
    const text = await masked.text();
    expect(text).toContain('Their other phone is');
    noDigits(text);
    session.user = asOwner(s.w.owner);
    expect(await (await get()).text()).toContain(TYPED);
  });
});

describe('Lines: el mismo chat en varias líneas', () => {
  it('una línea sin nombre muestra su número enmascarado a quien se le ocultan', () => {
    const base = { unread_count: 0, marked_unread: 0, last_message_at: null, pinned_at: null, key: 'k', line_status: 'connected', left_at: null } as const;
    const sibs: SiblingRow[] = [
      { ...base, id: 'c1', number_id: 'n1', sort_key: '2', line_name: '', line_phone: '15550104477' },
      { ...base, id: 'c2', number_id: 'n2', sort_key: '1', line_name: 'Sales 15550109999', line_phone: '15550109999' },
    ];
    const masked = lineRefs(sibs, { mask: true });
    expect(masked.map((l) => l.chatId)).toEqual(['c1', 'c2']);
    expect(JSON.stringify(masked)).not.toMatch(/555010(4477|9999)/);
    expect(lineRefs(sibs, { mask: false })[0].name).toBe('+15550104477');
    expect(lineRefs(sibs)[0].name).toBe('+15550104477');
  });
});

describe('Asistente: lines_read_chats busca un chat solo por su nombre', () => {
  it('no encuentra un chat por el texto de sus mensajes, ni por teléfono a quien se le ocultan, ni de otro workspace', async () => {
    const s = await setup('ftm-resolve');
    const row = (await getNumberRowById(s.numberId))!;
    await ingestEvents(row, [
      {
        type: 'message',
        chatId: `${SENDER}@s.whatsapp.net`,
        isGroup: false,
        chatName: 'Dana Courier',
        fromMe: false,
        senderPhone: SENDER,
        senderName: 'Dana Courier',
        providerMessageId: `m-${Math.random().toString(36).slice(2)}`,
        body: 'the code word is marmalade',
        timestamp: new Date().toISOString(),
      } as InboundEvent,
    ]);
    const { resolveLineChatByName } = await import('@/lib/assistant/tools-chats');
    const owner = await groupsViewer(s.ws, s.ws, 'owner');
    const member = await groupsViewer(s.ws, s.w.member.id, 'member');
    // Por nombre, sí (exacto o parte del nombre).
    expect(await resolveLineChatByName(s.ws, member, 'Couriers ftm-resolve')).toBe(s.chat.id);
    expect(await resolveLineChatByName(s.ws, member, 'couriers')).toBe(s.chat.id);
    // Por lo que dicen los mensajes, nunca.
    expect(await resolveLineChatByName(s.ws, owner, 'marmalade')).toBeNull();
    expect(await resolveLineChatByName(s.ws, owner, 'parcel ships')).toBeNull();
    // Por teléfono: quien ve los teléfonos sí; a quien se le ocultan no le confirma de quién es.
    expect(await resolveLineChatByName(s.ws, owner, `+${SENDER}`)).not.toBeNull();
    expect(await resolveLineChatByName(s.ws, member, `+${SENDER}`)).toBeNull();
    // Otro workspace: nada.
    const stranger = await groupsViewer(s.w.stranger.id, s.w.stranger.id, 'owner');
    expect(await resolveLineChatByName(s.w.stranger.id, stranger, 'couriers')).toBeNull();
  });
});
