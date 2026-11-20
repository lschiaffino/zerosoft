import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

/** Lines: exportar (mensajes de un chat, chats o tickets a CSV) es solo de admins y del dueño. */

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const route = await import('@/app/api/groups/export/route');
const get = (q: string) => route.GET(new Request(`http://localhost/api/groups/export?${q}`));

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});
afterEach(() => {
  session.user = null;
});

describe('Lines › exportar', () => {
  it('miembro e invitado no exportan; admin y dueño sí', async () => {
    const w = await workspaceWithMember('lexp');
    for (const q of ['type=chats', 'type=tickets', 'type=messages&chat=nope']) {
      session.user = null;
      expect((await get(q)).status, `anónimo ${q}`).toBe(401);
      session.user = asMember(w.owner, w.member, 'member');
      expect((await get(q)).status, `miembro ${q}`).toBe(403);
      session.user = asMember(w.owner, w.member, 'guest');
      expect((await get(q)).status, `invitado ${q}`).toBe(403);
    }
    session.user = asMember(w.owner, w.member, 'admin');
    expect((await get('type=chats')).status).toBe(200);
    session.user = asOwner(w.owner);
    const res = await get('type=chats');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('csv');
  });
});
