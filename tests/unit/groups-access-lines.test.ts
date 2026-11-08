import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createLabel, createNumber, getNumberRowById, ingestEvents, listChats, listMessages, sendMessage, updateChat } from '@/lib/groups';
import { createRule, setAvailability } from '@/lib/groups-inbox';
import { canSeeChat, crmGroupsTaskFilter, groupsViewer, setLabelAccess, updatePlatformSettings } from '@/lib/groups-access';
import { chatLines, resolveReplyChat, setLineAccess, siblingChats, teamForViewer, teamOverview } from '@/lib/groups-lines';
import { createGroupTask, getGroupTask, listGroupTasks } from '@/lib/groups-tasks';
import { getBroadcast, listBroadcasts, createBroadcast } from '@/lib/groups-broadcasts';
import { notifyPerson, saveSubscription } from '@/lib/groups-push';
import { importPeriskope } from '@/lib/groups-periskope';
import { listTasks, searchTasks } from '@/lib/crm';
import { makeUser } from './helpers';

/** Refuerzos de acceso de Groups: nada de un chat que la persona no ve llega a ella por otro camino. */

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('VAPID_PUBLIC_KEY', '');
  resetFakeProvider();
});

async function addLine(ws: string, name: string, phone: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  await getDb().prepare("UPDATE groups_numbers SET phone = ?, status = 'connected' WHERE id = ?").run(phone, n.id);
  return (await getNumberRowById(n.id))!;
}

async function teammate(ownerId: string, label: string) {
  const mate = await makeUser(label);
  const db = getDb();
  const team = (await db.prepare('SELECT id FROM teams WHERE owner_id = ?').get(ownerId)) as { id: string } | undefined;
  const teamId = team?.id ?? crypto.randomUUID();
  if (!team) await db.prepare('INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)').run(teamId, 'T', ownerId);
  await db.prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')").run(teamId, mate.id);
  return mate;
}

const msg = (chatId: string, id: string, body: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  chatName: chatId.endsWith('@g.us') ? 'Clientes' : undefined,
  fromMe: false,
  senderPhone: '5491155550000',
  senderName: 'Ana',
  providerMessageId: id,
  body,
});

/** Mismo grupo en A y B; un miembro con acceso por etiqueta solo a la copia de A. */
async function scene(label: string) {
  const user = await makeUser(label);
  const a = await addLine(user.id, 'A', '5491100000001');
  const b = await addLine(user.id, 'B', '5491100000002');
  const m = await teammate(user.id, 'Zoe');
  const g = `1203630${Math.floor(Math.random() * 1e9)}@g.us`;
  await ingestEvents(a, [msg(g, `${label}-1`, 'hola')]);
  await ingestEvents(b, [msg(g, `${label}-1`, 'hola'), msg(g, `${label}-2`, 'SECRETO solo B')]);
  const rows = (await listChats(user.id, user.id, { merge: false })).rows;
  const chatA = rows.find((c) => c.numberId === a.id)!;
  const chatB = rows.find((c) => c.numberId === b.id)!;
  const vip = await createLabel(user.id, { name: `VIP ${label}` });
  await updateChat(user.id, chatA.id, { labelIds: [vip.id] });
  await setLabelAccess(user.id, vip.id, [m.id]);
  await updatePlatformSettings(user.id, { labelAccess: true });
  const viewer = await groupsViewer(user.id, m.id, 'member');
  return { user, a, b, m, chatA, chatB, viewer };
}

describe('el mismo chat en otra línea no abre lo que no se ve', () => {
  it('hilo, Responder desde e historial solo con las copias visibles', async () => {
    const { user, b, chatA, chatB, viewer } = await scene('acc-s1');
    expect(await canSeeChat(viewer, chatA.id)).toBe(true);
    expect(await canSeeChat(viewer, chatB.id)).toBe(false);
    const sibs = (await siblingChats(user.id, viewer, chatA.id)).map((c) => c.id);
    expect(sibs).toEqual([chatA.id]);
    const thread = await listMessages(user.id, chatA.id, { chatIds: sibs });
    expect(thread.some((x) => x.body.includes('SECRETO'))).toBe(false);
    expect((await chatLines(user.id, viewer, chatA.id)).map((l) => l.numberId)).not.toContain(b.id);
    await expect(resolveReplyChat(user.id, viewer, chatA.id, b.id)).rejects.toThrow('line_forbidden');
    // El admin sí ve las dos.
    expect((await siblingChats(user.id, null, chatA.id)).map((c) => c.id).sort()).toEqual([chatA.id, chatB.id].sort());
  });

  it('un 1:1 nuevo en otra línea hereda etiquetas y asignación y sigue visible', async () => {
    const user = await makeUser('acc-dm');
    const a = await addLine(user.id, 'A', '5491100000011');
    const b = await addLine(user.id, 'B', '5491100000012');
    const m = await teammate(user.id, 'Yago');
    await ingestEvents(a, [msg('5491100000999@c.us', 'dm-1', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    const vip = await createLabel(user.id, { name: 'VIP dm' });
    await updateChat(user.id, chat.id, { labelIds: [vip.id] });
    await setLabelAccess(user.id, vip.id, [m.id]);
    await updatePlatformSettings(user.id, { labelAccess: true });
    const viewer = await groupsViewer(user.id, m.id, 'member');
    const created = await resolveReplyChat(user.id, viewer, chat.id, b.id);
    expect(await canSeeChat(viewer, created)).toBe(true);
  });

  it('marcar leído no toca las copias que la persona no ve', async () => {
    const { user, m, chatA, chatB } = await scene('acc-s5');
    await updateChat(user.id, chatA.id, { read: true }, m.id);
    const row = (await getDb().prepare('SELECT unread_count FROM groups_chats WHERE id = ?').get(chatB.id)) as { unread_count: number };
    expect(row.unread_count).toBeGreaterThan(0);
  });
});

describe('tareas de chats que no se ven', () => {
  it('no se listan, no se abren, no se crean y no aparecen en el CRM ni en la búsqueda', async () => {
    const { user, m, chatB, viewer } = await scene('acc-s2');
    const secretMsg = (await listMessages(user.id, chatB.id)).find((x) => x.body.includes('SECRETO'))!;
    const task = await createGroupTask(user.id, user.id, { chatId: chatB.id, messageId: secretMsg.id, title: 'Tarea B' });
    expect((await listGroupTasks(user.id, m.id, { status: 'all', viewer })).some((t) => t.id === task.id)).toBe(false);
    expect(await getGroupTask(user.id, task.id, viewer)).toBeNull();
    await expect(createGroupTask(user.id, m.id, { chatId: chatB.id, messageId: secretMsg.id, title: 'robar', viewer })).rejects.toThrow('not_found');
    const extra = await crmGroupsTaskFilter(user.id, m.id, 'member');
    expect(extra).not.toBeNull();
    const all = [...(await listTasks(user.id, { bucket: 'upcoming', extra })), ...(await listTasks(user.id, { bucket: 'today', extra }))];
    expect(all.some((t) => t.id === task.activityId)).toBe(false);
    expect((await searchTasks(user.id, 'Tarea B', undefined, extra)).some((t) => t.id === task.activityId)).toBe(false);
    // El admin la ve.
    expect((await searchTasks(user.id, 'Tarea B')).some((t) => t.id === task.activityId)).toBe(true);
  });
});

describe('envíos masivos con destinatarios que no se ven', () => {
  it('no se listan ni se abren', async () => {
    const { user, b, chatB, viewer } = await scene('acc-bc');
    const bc = await createBroadcast(user.id, user.id, { numberId: b.id, body: 'promo B', chatIds: [chatB.id], scheduledAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await listBroadcasts(user.id, { viewer })).some((x) => x.id === bc.id)).toBe(false);
    expect(await getBroadcast(user.id, bc.id, viewer)).toBeNull();
    expect(await getBroadcast(user.id, bc.id)).not.toBeNull();
  });
});

describe('avisos y menciones', () => {
  it('una mención en un chat que no ve no le avisa', async () => {
    const { user, m, chatB } = await scene('acc-s4');
    await sendMessage(user.id, user.id, chatB.id, { body: '@Zoe mirá esto SECRETO', note: true });
    const n = (await getDb().prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND type = 'mention'").get(m.id)) as { c: number };
    expect(Number(n.c)).toBe(0);
  });

  it('push: nada de un chat que ya no ve', async () => {
    const { user, m, chatB } = await scene('acc-push');
    await saveSubscription(user.id, m.id, { endpoint: 'https://push.example.com/x', keys: { p256dh: 'a', auth: 'b' } } as never).catch(() => null);
    expect(await notifyPerson(user.id, m.id, { chatId: chatB.id, title: 'x', body: 'SECRETO' })).toBe(0);
    const pending = (await getDb().prepare('SELECT COUNT(*) AS c FROM groups_notifications WHERE person_id = ? AND chat_id = ?').get(m.id, chatB.id)) as { c: number };
    expect(Number(pending.c)).toBe(0);
  });
});

describe('quitar una línea saca las asignaciones', () => {
  it('al sacarle la línea, sus chats vuelven a las reglas', async () => {
    const user = await makeUser('acc-s3');
    const a = await addLine(user.id, 'A', '5491100000021');
    const m = await teammate(user.id, 'Xime');
    await ingestEvents(a, [msg('5491100000888@c.us', 's3-1', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    await updateChat(user.id, chat.id, { assignedTo: m.id });
    await updatePlatformSettings(user.id, { lineAccess: true });
    // Al prender el ajuste sin darle la línea, deja de tenerlo.
    expect((await listChats(user.id, user.id)).rows[0].assignedTo).toBeNull();
    await setLineAccess(user.id, user.id, a.id, { personIds: [m.id] });
    await updateChat(user.id, chat.id, { assignedTo: m.id });
    await setLineAccess(user.id, user.id, a.id, { personIds: [] });
    expect((await listChats(user.id, user.id)).rows[0].assignedTo).toBeNull();
  });

  it('desconectarse con una regla "todos" no le devuelve los chats', async () => {
    const user = await makeUser('acc-off');
    const a = await addLine(user.id, 'A', '5491100000031');
    const m = await teammate(user.id, 'Wanda');
    await createRule(user.id, { name: 'Todos', personIds: [m.id], availability: 'any' });
    await updatePlatformSettings(user.id, { reassignOnOffline: true });
    await ingestEvents(a, [msg('5491100000777@c.us', 'off-1', 'hola')]);
    expect((await listChats(user.id, user.id)).rows[0].assignedTo).toBe(m.id);
    await setAvailability(user.id, m.id, 'offline');
    expect((await listChats(user.id, user.id)).rows[0].assignedTo).toBeNull();
  });
});

describe('equipo para un miembro', () => {
  it('sin emails ni líneas', async () => {
    const user = await makeUser('acc-team');
    await teammate(user.id, 'Vera');
    const people = await teamOverview(user.id);
    const member = teamForViewer(people, false);
    expect(member.every((p) => p.email === '' && Array.isArray(p.lineIds) && p.lineIds.length === 0 && p.openChats === 0)).toBe(true);
    expect(teamForViewer(people, true).some((p) => p.email)).toBe(true);
  });
});

describe('importar de Periskope', () => {
  it('un Chat ID sin teléfono no se cruza con chats sin teléfono; el tope de tamaño', async () => {
    const user = await makeUser('acc-psk');
    const a = await addLine(user.id, 'A', '5491100000041');
    await ingestEvents(a, [{ ...msg('abc@lid', 'lid-1', 'hola') }]);
    const res = await importPeriskope(user.id, user.id, 'chats', 'Chat ID,Labels\nsin-numero,VIP\n@c.us,VIP\n');
    expect(res.applied).toBe(0);
    expect(res.issues.map((i) => i.reason)).toEqual(['invalid_phone', 'invalid_phone']);
    await expect(importPeriskope(user.id, user.id, 'labels', `Name\n${'x'.repeat(4 * 1024 * 1024 + 10)}\n`)).rejects.toThrow('file_too_large');
  });
});

describe('segunda ronda de refuerzos', () => {
  it('una tarea de un chat oculto no se abre por id ni llega a los asistentes ni al resumen AI', async () => {
    const { user, m, chatB } = await scene('acc-r2-crm');
    const { crmActivityHiddenFor, crmGroupsTaskFilterForPerson, crmGroupsSharedFilter } = await import('@/lib/groups-access');
    const task = await createGroupTask(user.id, user.id, { chatId: chatB.id, title: 'Tarea oculta r2' });
    expect(await crmActivityHiddenFor(user.id, m.id, 'member', task.activityId)).toBe(true);
    expect(await crmActivityHiddenFor(user.id, user.id, 'owner', task.activityId)).toBe(false);
    // Asistentes: el filtro por persona lee el rol del workspace.
    const extra = await crmGroupsTaskFilterForPerson(user.id, m.id);
    expect((await listTasks(user.id, { bucket: 'upcoming', extra })).some((t) => t.id === task.activityId)).toBe(false);
    // Resumen AI compartido: con acceso recortado, las tareas de chats quedan afuera para todos.
    const shared = await crmGroupsSharedFilter(user.id);
    expect(shared).not.toBeNull();
    expect((await listTasks(user.id, { bucket: 'upcoming', extra: shared })).some((t) => t.id === task.activityId)).toBe(false);
  });

  it('el 1:1 nuevo en otra línea no hereda un asignado que no ve esa línea; un intento rechazado no deja filas', async () => {
    const user = await makeUser('acc-r2-dm');
    const a = await addLine(user.id, 'A', '5491100000051');
    const b = await addLine(user.id, 'B', '5491100000052');
    const m = await teammate(user.id, 'Uma');
    await ingestEvents(a, [msg('5491100000555@c.us', 'r2-1', 'hola')]);
    const chat = (await listChats(user.id, user.id)).rows[0];
    await setLineAccess(user.id, user.id, a.id, { personIds: [m.id] });
    await updatePlatformSettings(user.id, { lineAccess: true });
    await updateChat(user.id, chat.id, { assignedTo: m.id });
    const count = async () => Number(((await getDb().prepare('SELECT COUNT(*) AS c FROM groups_chats WHERE user_id = ?').get(user.id)) as { c: number }).c);
    // El miembro no tiene B: rechazado antes de crear nada.
    const before = await count();
    await expect(resolveReplyChat(user.id, await groupsViewer(user.id, m.id, 'member'), chat.id, b.id)).rejects.toThrow('line_forbidden');
    expect(await count()).toBe(before);
    // El admin responde desde B: el chat nuevo queda sin el asignado que no ve B.
    const created = await resolveReplyChat(user.id, null, chat.id, b.id);
    const row = (await getDb().prepare('SELECT assigned_to FROM groups_chats WHERE id = ?').get(created)) as { assigned_to: string | null };
    expect(row.assigned_to).toBeNull();
  });

  it('cada línea nueva toma el siguiente color libre de la paleta', async () => {
    const { LINE_COLORS } = await import('@/lib/groups-lines-shared');
    const user = await makeUser('acc-r2-color');
    const a = await createNumber(user.id, user.id, { provider: 'fake', name: 'A' });
    const b = await createNumber(user.id, user.id, { provider: 'fake', name: 'B' });
    expect([a.color, b.color]).toEqual([LINE_COLORS[0], LINE_COLORS[1]]);
  });
});
