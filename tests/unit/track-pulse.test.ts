import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { createProject } from '@/lib/track-data';
import { setGuest } from '@/lib/track-access';
import { createPlan, setPlanFollow } from '@/lib/track-plans';
import { createPlanUpdate } from '@/lib/track-plan-updates';
import { createInitiative } from '@/lib/track-initiatives';
import { createInitiativeUpdate } from '@/lib/track-initiative-updates';
import { cursorOf, listPulse, parseCursor, type PulseItem } from '@/lib/track-pulse';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const route = await import('@/app/api/track/updates/route');
const get = (q = '') => new NextRequest(`http://x/api/track/updates${q}`) as never;
const uid = () => crypto.randomUUID().slice(0, 6);

async function setup() {
  const owner = await makeUser('pls-own');
  const member = await makeUser('pls-mem');
  const guest = await makeUser('pls-gst');
  const stranger = await makeUser('pls-str');
  const team = await createTeam(owner.id, 'Acme');
  await addMember(team.id, member.id);
  await addMember(team.id, guest.id);
  const eng = await createProject(owner.id, team.id, { name: 'Eng', slug: `pe-${uid()}` });
  await setGuest(team.id, guest.email, [eng.id], owner.id);
  const scope = { teamId: team.id, ownerId: owner.id };
  const mine = await createPlan(scope, owner.id, { name: 'Mobile app', leadId: member.id, status: 'in_progress' });
  const followed = await createPlan(scope, owner.id, { name: 'Billing', status: 'in_progress' });
  const other = await createPlan(scope, owner.id, { name: 'Website', status: 'in_progress' });
  const left = await createPlan(scope, owner.id, { name: 'Left', memberIds: [member.id], status: 'in_progress' });
  if (!mine.ok || !followed.ok || !other.ok || !left.ok) throw new Error('plan');
  await setPlanFollow(followed.plan.id, member.id, true);
  await setPlanFollow(left.plan.id, member.id, false);
  const u1 = await createPlanUpdate(mine.plan, member.id, { health: 'on_track', body: 'Beta shipped' });
  const u2 = await createPlanUpdate(followed.plan, owner.id, { health: 'at_risk', body: 'Vendor late' });
  const u3 = await createPlanUpdate(other.plan, owner.id, { health: 'off_track', body: 'Redesign stuck' });
  const u4 = await createPlanUpdate(left.plan, owner.id, { health: 'on_track', body: 'Unfollowed' });
  const ini = await createInitiative(scope, owner.id, { name: 'Launch', planIds: [mine.plan.id] });
  const iniOther = await createInitiative(scope, owner.id, { name: 'Brand', planIds: [other.plan.id] });
  const i1 = await createInitiativeUpdate(ini, owner.id, { health: 'on_track', body: 'All good' });
  const i2 = await createInitiativeUpdate(iniOther, owner.id, { health: 'at_risk', body: 'Brand risk' });
  // Fechas fijas para el orden.
  const at = (n: number) => `2026-11-2${n}T10:00:00.000Z`;
  const db = getDb();
  for (const [id, n] of [[u1.id, 1], [u2.id, 2], [u3.id, 3], [u4.id, 4]] as const) await db.prepare('UPDATE track_plan_updates SET created_at = ? WHERE id = ?').run(at(n), id);
  for (const [id, n] of [[i1.id, 5], [i2.id, 6]] as const) await db.prepare('UPDATE track_initiative_updates SET created_at = ? WHERE id = ?').run(at(n), id);
  const as = {
    owner: { ...owner, team, role: 'owner' },
    member: { ...member, id: owner.id, actingUser: member, team, role: 'member' },
    guest: { ...guest, id: owner.id, actingUser: guest, team, role: 'member' },
    stranger: { ...stranger, team: null, role: 'owner' },
  };
  return { owner, member, scope, as };
}

const bodies = (items: PulseItem[]) => items.map((i) => i.body);

describe('Track: Updates (Pulse)', () => {
  it('Para mí: lead, miembro o seguidor de projects (sin los que dejé de seguir) e initiatives con mis projects', async () => {
    const s = await setup();
    const { items } = await listPulse(s.scope, s.member.id, { tab: 'for_me' });
    expect(bodies(items)).toEqual(['All good', 'Vendor late', 'Beta shipped']);
    expect(items[0]).toMatchObject({ kind: 'initiative', parent_name: 'Launch' });
    expect(items[2]).toMatchObject({ kind: 'project', parent_name: 'Mobile app', health: 'on_track' });
  });

  it('Todos: el workspace entero, del más nuevo al más viejo, paginado sin repetir', async () => {
    const s = await setup();
    const all = await listPulse(s.scope, s.member.id, { tab: 'all' });
    expect(bodies(all.items)).toEqual(['Brand risk', 'All good', 'Unfollowed', 'Redesign stuck', 'Vendor late', 'Beta shipped']);
    const p1 = await listPulse(s.scope, s.member.id, { tab: 'all', limit: 4 });
    expect(p1.items).toHaveLength(4);
    expect(p1.nextBefore).toBe(cursorOf(p1.items[3]));
    const p2 = await listPulse(s.scope, s.member.id, { tab: 'all', limit: 4, before: p1.nextBefore });
    expect(bodies(p2.items)).toEqual(['Vendor late', 'Beta shipped']);
    expect(p2.nextBefore).toBeNull();
  });

  it('cursor: solo fecha|id', () => {
    expect(parseCursor('2026-11-21T10:00:00.000Z|abc-1')).toEqual({ at: '2026-11-21T10:00:00.000Z', id: 'abc-1' });
    expect(parseCursor("2026-11-21' OR 1=1 --|x")).toBeNull();
    expect(parseCursor(null)).toBeNull();
  });

  it('ruta: anónimo 401, otro workspace vacío, invitado vacío, miembro ve lo suyo', async () => {
    const s = await setup();
    session.user = null;
    expect((await route.GET(get())).status).toBe(401);
    session.user = s.as.stranger;
    expect(((await (await route.GET(get('?tab=all'))).json()) as { items: PulseItem[] }).items).toEqual([]);
    // Un invitado no ve planificación.
    session.user = s.as.guest;
    expect(((await (await route.GET(get('?tab=all'))).json()) as { items: PulseItem[] }).items).toEqual([]);
    session.user = s.as.member;
    const mine = (await (await route.GET(get())).json()) as { items: PulseItem[] };
    expect(bodies(mine.items)).toEqual(['All good', 'Vendor late', 'Beta shipped']);
    const all = (await (await route.GET(get('?tab=all&before=garbage'))).json()) as { items: PulseItem[] };
    expect(all.items).toHaveLength(6);
    session.user = null;
  });
});
