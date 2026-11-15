import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createPlan } from '@/lib/track-plans';
import { createPlanUpdate } from '@/lib/track-plan-updates';
import { createInitiative, listInitiatives } from '@/lib/track-initiatives';
import { createInitiativeUpdate, listInitiativeUpdates } from '@/lib/track-initiative-updates';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: () => {},
}));

const updatesRoute = await import('@/lib/routes/track/initiatives/[id]/updates/route');
const updateRoute = await import('@/lib/routes/track/initiative-updates/[id]/route');

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function notificationsOf(userId: string) {
  return (await getDb()
    .prepare("SELECT title, href, source_type FROM notifications WHERE user_id = ? AND source_type = 'track_initiative'")
    .all(userId)) as Array<{ title: string; href: string; source_type: string }>;
}

describe('updates de initiatives', () => {
  it('la salud de la initiative es la de su último update; sin updates, la peor de sus projects activos', async () => {
    const u = await makeUser('ini-up');
    const scope = { teamId: null, ownerId: u.id };
    const p = await createPlan(scope, u.id, { name: 'Mobile', status: 'in_progress' });
    if (!p.ok) throw new Error('plan');
    await createPlanUpdate(p.plan, u.id, { health: 'at_risk', body: 'slipping' });
    const ini = await createInitiative(scope, u.id, { name: 'Launch', planIds: [p.plan.id] });
    let row = (await listInitiatives(scope)).find((i) => i.id === ini.id)!;
    expect(row.health).toBe('at_risk');
    expect(row.projects_health).toBe('at_risk');
    expect(row.last_update).toBeNull();

    await createInitiativeUpdate(ini, u.id, { health: 'on_track', body: 'Back on plan after the scope cut' });
    row = (await listInitiatives(scope)).find((i) => i.id === ini.id)!;
    expect(row.health).toBe('on_track');
    expect(row.projects_health).toBe('at_risk');
    expect(row.last_update?.health).toBe('on_track');

    // El más nuevo manda.
    await getDb().prepare('UPDATE track_initiative_updates SET created_at = ? WHERE initiative_id = ?').run('2026-01-01T00:00:00.000Z', ini.id);
    await createInitiativeUpdate(ini, u.id, { health: 'off_track', body: 'Vendor blocked' });
    row = (await listInitiatives(scope)).find((i) => i.id === ini.id)!;
    expect(row.health).toBe('off_track');
    expect((await listInitiativeUpdates(ini.id)).map((x) => x.health)).toEqual(['off_track', 'on_track']);
  });

  it('avisa al responsable, a quien la creó y a los leads de sus projects, nunca al autor', async () => {
    const owner = await makeUser('ini-owner');
    const lead = await makeUser('ini-lead');
    const projectLead = await makeUser('ini-plead');
    const scope = { teamId: null, ownerId: owner.id };
    const p = await createPlan(scope, owner.id, { name: 'Billing', status: 'in_progress' });
    if (!p.ok) throw new Error('plan');
    await getDb().prepare('UPDATE track_plans SET lead_id = ? WHERE id = ?').run(projectLead.id, p.plan.id);
    const ini = await createInitiative(scope, owner.id, { name: 'Revenue', planIds: [p.plan.id] });
    await getDb().prepare('UPDATE track_initiatives SET lead_id = ? WHERE id = ?').run(lead.id, ini.id);
    const fresh = { ...ini, lead_id: lead.id };

    await createInitiativeUpdate(fresh, lead.id, { health: 'at_risk', body: 'Pricing page late' });
    expect(await notificationsOf(lead.id)).toHaveLength(0);
    const toOwner = await notificationsOf(owner.id);
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0].href).toBe(`/app/track/initiatives/${ini.id}#updates`);
    expect(await notificationsOf(projectLead.id)).toHaveLength(1);
  });

  it('la API: crear, solo el autor edita, el autor o un admin borra, y nada fuera del workspace', async () => {
    const author = await makeUser('ini-api-a');
    const other = await makeUser('ini-api-b');
    const stranger = await makeUser('ini-api-c');
    const scope = { teamId: null, ownerId: author.id };
    const ini = await createInitiative(scope, author.id, { name: 'Platform' });

    // Las personas del workspace actúan como el owner (id) con su identidad real (actingUser).
    session.user = { id: author.id, team: null, role: 'owner' };
    const created = await updatesRoute.POST(json('http://x', 'POST', { health: 'on_track', body: 'Kickoff done' }), params(ini.id));
    expect(created.status).toBe(201);
    const up = (await created.json()) as { id: string; health: string };
    expect(up.health).toBe('on_track');
    expect((await updatesRoute.POST(json('http://x', 'POST', { health: 'sideways', body: 'x' }), params(ini.id))).status).toBe(400);

    session.user = { id: author.id, team: null, role: 'member', actingUser: { id: other.id } };
    const list = (await (await updatesRoute.GET(json('http://x', 'GET'), params(ini.id))).json()) as { rows: Array<{ id: string }> };
    expect(list.rows.map((r) => r.id)).toEqual([up.id]);
    expect((await updateRoute.PATCH(json('http://x', 'PATCH', { body: 'mine now' }), params(up.id)))?.status).toBe(403);
    expect((await updateRoute.DELETE(json('http://x', 'DELETE'), params(up.id)))?.status).toBe(403);

    session.user = { id: stranger.id, team: null, role: 'owner' };
    expect((await updatesRoute.GET(json('http://x', 'GET'), params(ini.id))).status).toBe(404);
    expect((await updatesRoute.POST(json('http://x', 'POST', { health: 'at_risk', body: 'x' }), params(ini.id))).status).toBe(404);
    expect((await updateRoute.DELETE(json('http://x', 'DELETE'), params(up.id)))?.status).toBe(404);

    session.user = { id: author.id, team: null, role: 'owner' };
    const edited = (await updateRoute.PATCH(json('http://x', 'PATCH', { health: 'at_risk', body: 'Kickoff slipped a week' }), params(up.id)))!;
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { health: string; updated_at: string | null }).updated_at).not.toBeNull();

    // Un admin que no es el autor lo puede borrar.
    session.user = { id: author.id, team: null, role: 'admin', actingUser: { id: other.id } };
    expect((await updateRoute.DELETE(json('http://x', 'DELETE'), params(up.id)))?.status).toBe(200);
    expect(await listInitiativeUpdates(ini.id)).toHaveLength(0);
  });
});
