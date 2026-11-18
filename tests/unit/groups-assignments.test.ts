import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/lib/session';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, updateChat } from '@/lib/groups';
import { createRule, setPresence } from '@/lib/groups-inbox';
import { setLineAccess } from '@/lib/groups-lines';
import { listAssignments, recordAssignment } from '@/lib/groups-assignments';
import { asMember, roles, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const route = await import('@/app/api/groups/assignments/route');

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  session.user = null;
  vi.unstubAllEnvs();
});

const inbound = (chatId: string, id: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: false,
  fromMe: false,
  senderPhone: chatId.replace('@c.us', ''),
  senderName: 'Demo',
  providerMessageId: id,
  body: 'hola',
});

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const n = await createNumber(w.owner.id, w.owner.id, { provider: 'fake', name: 'Line' });
  await connectNumber(w.owner.id, n.id);
  const line = (await getNumberRowById(n.id))!;
  return { w, line };
}

const get = (chatId: string) => route.GET(new Request(`http://x/api/groups/assignments?chat=${encodeURIComponent(chatId)}`));

describe('historial de asignaciones', () => {
  it('anota manual, automática y por desconexión, con quién, a quién y la regla', async () => {
    const { w, line } = await setup('asg-log');
    await createRule(w.owner.id, { name: 'Soporte', personIds: [w.member.id, w.friend.id], reassignOffline: true });
    await setPresence(w.owner.id, w.friend.id, 'away');
    await ingestEvents(line, [inbound('5490000000701@c.us', 'H-1')]);
    const chat = (await listChats(w.owner.id, w.owner.id)).rows[0];
    expect(chat.assignedTo).toBe(w.member.id);

    await setPresence(w.owner.id, w.friend.id, 'online');
    await setPresence(w.owner.id, w.member.id, 'offline');
    await updateChat(w.owner.id, chat.id, { assignedTo: w.owner.id }, w.owner.id);
    await updateChat(w.owner.id, chat.id, { assignedTo: null }, w.owner.id);

    const events = await listAssignments(w.owner.id, chat.id);
    expect(events.map((e) => [e.reason, e.from, e.to])).toEqual([
      ['manual', w.owner.id, null],
      ['manual', w.friend.id, w.owner.id],
      ['offline', w.member.id, w.friend.id],
      ['auto', null, w.member.id],
    ]);
    expect(events[0].actorId).toBe(w.owner.id);
    expect(events[2]).toMatchObject({ rule: 'Soporte', actorId: null });
    expect(events[3]).toMatchObject({ rule: 'Soporte', actorId: null });
  });

  it('no anota lo que no cambió', async () => {
    const { w, line } = await setup('asg-same');
    await ingestEvents(line, [inbound('5490000000702@c.us', 'S-1')]);
    const chat = (await listChats(w.owner.id, w.owner.id)).rows[0];
    await updateChat(w.owner.id, chat.id, { assignedTo: w.owner.id }, w.owner.id);
    await updateChat(w.owner.id, chat.id, { assignedTo: w.owner.id }, w.owner.id);
    await recordAssignment(w.owner.id, { chatId: chat.id, from: w.owner.id, to: w.owner.id, actorId: w.owner.id, reason: 'manual' });
    expect(await listAssignments(w.owner.id, chat.id)).toHaveLength(1);
  });

  it('GET: anónimo y otro workspace no lo ven; el workspace sí; sin la línea, tampoco', async () => {
    const { w, line } = await setup('asg-access');
    await ingestEvents(line, [inbound('5490000000703@c.us', 'A-1')]);
    const chat = (await listChats(w.owner.id, w.owner.id)).rows[0];
    await updateChat(w.owner.id, chat.id, { assignedTo: w.member.id }, w.owner.id);

    const expected = { anonymous: 401, other_workspace: 404, teammate: 200, owner: 200 };
    for (const r of roles(w)) {
      session.user = r.user;
      const res = await get(chat.id);
      expect(res.status, r.name).toBe(expected[r.name]);
      if (res.status === 200) {
        const body = (await res.json()) as { events: Array<{ to: string; reason: string }> };
        expect(body.events).toEqual([expect.objectContaining({ to: w.member.id, reason: 'manual' })]);
      }
    }

    // Línea restringida a otra persona: el compañero sin la línea ya no lo ve.
    await setLineAccess(w.owner.id, line.id, { ownerId: w.owner.id, visibility: 'restricted', personIds: [w.friend.id], teamIds: [] });
    await updateChat(w.owner.id, chat.id, { assignedTo: null }, w.owner.id);
    session.user = asMember(w.owner, w.member);
    expect((await get(chat.id)).status).toBe(404);
    session.user = asMember(w.owner, w.friend);
    expect((await get(chat.id)).status).toBe(200);
    expect((await get('../x')).status).toBe(400);
  });
});
