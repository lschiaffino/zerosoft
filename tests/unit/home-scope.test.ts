import { describe, expect, it, vi } from 'vitest';
import { createChatConversation, createChatMessage, createChatWidget, getOrCreateChatVisitor } from '@/lib/chat-data';
import { addMember, createTeam } from '@/lib/teams';
import { createActivity } from '@/lib/crm';
import { makeUser } from './helpers';

// Groups: se puede forzar que resolver el acceso falle (fail closed).
const groupsFail = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/groups-access', async (orig) => {
  const mod = await orig<typeof import('@/lib/groups-access')>();
  return {
    ...mod,
    groupsViewer: async (...args: Parameters<typeof mod.groupsViewer>) => {
      if (groupsFail.on) throw new Error('groups settings down');
      return mod.groupsViewer(...args);
    },
  };
});

const { homeCrmTasks, homeUnread } = await import('@/lib/home');

async function unreadConversation(widgetId: string) {
  const visitor = await getOrCreateChatVisitor(widgetId, `ext-${crypto.randomUUID()}`, { name: 'Ana', email: 'ana@x.com' });
  const conv = await createChatConversation(widgetId, visitor.id, 'Hola');
  await createChatMessage(conv.id, 'visitor', { body: 'Hola, ¿me ayudan?' });
}

describe('inicio: mismo alcance que cada app', () => {
  it('Sin leer de Chat cuenta solo los widgets que la persona ve en la bandeja', async () => {
    const owner = await makeUser('home-owner');
    const member = await makeUser('home-member');
    const team = await createTeam(owner.id, 'Ventas');
    await addMember(team.id, member.id, 'member');
    // Un widget del owner (sin equipo) y otro del equipo, cada uno con una conversación sin leer.
    const personal = await createChatWidget(owner.id, null, { name: 'Personal' });
    const shared = await createChatWidget(owner.id, team.id, { name: 'Equipo' });
    await unreadConversation(personal.id);
    await unreadConversation(shared.id);

    // El miembro actúa en el workspace del owner con el equipo activo: ve solo el widget del equipo.
    const asMember = { id: owner.id, team: { id: team.id }, actingUser: { id: member.id }, role: 'member' as const };
    expect((await homeUnread(asMember)).chat).toBe(1);
    // El owner en su workspace ve los dos (como listChatWidgets(owner, null)).
    expect((await homeUnread({ id: owner.id, team: null, actingUser: null, role: 'owner' })).chat).toBe(2);
  });

  it('si no se puede resolver el acceso de Groups, esa parte queda en error (no cuenta de más) y Chat se muestra igual', async () => {
    const owner = await makeUser('home-groups');
    const widget = await createChatWidget(owner.id, null, { name: 'Solo' });
    await unreadConversation(widget.id);
    groupsFail.on = true;
    try {
      const res = await homeUnread({ id: owner.id, team: null, actingUser: null, role: 'owner' });
      expect(res.groups).toBeNull();
      expect(res.chat).toBe(1);
    } finally {
      groupsFail.on = false;
    }
  });

  it('Tareas del CRM: por defecto las mías, con opción de ver todas', async () => {
    const owner = await makeUser('home-tasks');
    const member = await makeUser('home-tasks-m');
    const team = await createTeam(owner.id, 'Equipo');
    await addMember(team.id, member.id, 'member');
    const past = '2026-01-01 10:00:00';
    await createActivity(owner.id, { type: 'task', subject: 'Del owner', dueAt: past });
    await createActivity(owner.id, { type: 'task', subject: 'Del miembro', dueAt: past, ownerId: member.id });

    const asOwner = { id: owner.id, team: null, actingUser: null, role: 'owner' as const };
    const mine = await homeCrmTasks(asOwner);
    expect(mine.items.map((i) => i.subject)).toEqual(['Del owner']);
    expect(mine.items[0].overdue).toBe(true);
    const all = await homeCrmTasks(asOwner, { scope: 'all' });
    expect(all.items.map((i) => i.subject).sort()).toEqual(['Del miembro', 'Del owner']);

    const asMember = { id: owner.id, team: { id: team.id }, actingUser: { id: member.id }, role: 'member' as const };
    expect((await homeCrmTasks(asMember)).items.map((i) => i.subject)).toEqual(['Del miembro']);
  });
});
