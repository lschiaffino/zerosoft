/**
 * Hilos de comentarios en projects e iniciativas: acceso por mirada
 * (anónimo, otro workspace, invitado de Track, compañera y owner), editar y
 * borrar solo lo propio, responder, resolver, reaccionar, y avisos (las
 * @menciones solo a quien puede leer el hilo; el invitado no recibe nada).
 */
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { createProject } from '@/lib/track-data';
import { runAsTrackViewer, setGuest } from '@/lib/track-access';
import { createPlan } from '@/lib/track-plans';
import { createInitiative } from '@/lib/track-initiatives';
import { initiativeCreateSchema, planCreateSchema } from '@/lib/track-planning-schema';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const plans = await import('@/lib/routes/track/plans/[id]/comments/route');
const planComment = await import('@/lib/routes/track/plans/[id]/comments/[commentId]/route');
const planResolve = await import('@/lib/routes/track/plans/[id]/comments/[commentId]/resolve/route');
const planReact = await import('@/lib/routes/track/plans/[id]/comments/[commentId]/reactions/route');
const inits = await import('@/lib/routes/track/initiatives/[id]/comments/route');

/** La sesión dentro del workspace, como la arma getCurrentUser. */
const inTeam = (u: SessionUser, teamId: string) => ({ ...u, team: { id: teamId } }) as unknown as SessionUser;
const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/x', { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** Corre como `who` (sesión y quien mira Track). */
async function run<T>(who: SessionUser | null, viewerId: string | null, fn: () => Promise<T>): Promise<T> {
  session.user = who;
  return viewerId ? runAsTrackViewer(viewerId, fn, 'app') : fn();
}

async function setup() {
  const w = await workspaceWithMember('ent-c');
  const guest = await makeUser('ent-c-guest');
  const { addMember } = await import('@/lib/teams');
  await addMember(w.team.id, guest.id, 'member');
  const team = await createProject(w.owner.id, w.team.id, { name: 'Team' });
  await setGuest(w.team.id, guest.email, [team.id], w.owner.id);
  const scope = { teamId: w.team.id, ownerId: w.owner.id };
  const created = await createPlan(scope, w.owner.id, planCreateSchema.parse({ name: 'Launch plan' }));
  if (!created.ok) throw new Error(created.error);
  const initiative = await createInitiative(scope, w.owner.id, initiativeCreateSchema.parse({ name: 'Grow' }));
  const owner = inTeam(asOwner(w.owner), w.team.id);
  const member = inTeam(asMember(w.owner, w.member), w.team.id);
  const guestUser = inTeam(asMember(w.owner, guest), w.team.id);
  return { w, guest, plan: created.plan, initiative, owner, member, guestUser };
}

const P = (id: string, commentId = '') => ({ params: Promise.resolve({ id, commentId }) });

describe('hilos de projects e iniciativas: acceso', () => {
  it('anónimo 401; otro workspace e invitado 404; compañera y owner leen y comentan', async () => {
    const { w, guest, plan, initiative, owner, member, guestUser } = await setup();
    expect((await run(null, null, () => plans.GET(req('GET'), P(plan.id)))).status).toBe(401);
    expect((await run(null, null, () => plans.POST(req('POST', { body: 'x' }), P(plan.id)))).status).toBe(401);
    expect((await run(asOwner(w.stranger), w.stranger.id, () => plans.GET(req('GET'), P(plan.id)))).status).toBe(404);
    expect((await run(asOwner(w.stranger), w.stranger.id, () => plans.POST(req('POST', { body: 'x' }), P(plan.id)))).status).toBe(404);
    expect((await run(guestUser, guest.id, () => plans.GET(req('GET'), P(plan.id)))).status).toBe(404);
    expect((await run(guestUser, guest.id, () => inits.POST(req('POST', { body: 'x' }), P(initiative.id)))).status).toBe(404);

    const posted = await run(member, w.member.id, () => plans.POST(req('POST', { body: 'First thought' }), P(plan.id)));
    expect(posted.status).toBe(201);
    const list = await run(owner, w.owner.id, () => plans.GET(req('GET'), P(plan.id)));
    expect(list.status).toBe(200);
    const body = (await list.json()) as { rows: Array<{ type: string; meta: string }>; members: Array<{ id: string }>; me: string };
    expect(body.me).toBe(w.owner.id);
    expect(body.rows.map((r) => (JSON.parse(r.meta) as { body: string }).body)).toEqual(['First thought']);
    // Para mencionar: personas del workspace, sin el invitado.
    expect(body.members.map((m) => m.id)).toContain(w.member.id);
    expect(body.members.map((m) => m.id)).not.toContain(guest.id);
    // Un comentario de un project no aparece en otro ni en una iniciativa.
    const ini = (await (await run(owner, w.owner.id, () => inits.GET(req('GET'), P(initiative.id)))).json()) as { rows: unknown[] };
    expect(ini.rows).toHaveLength(0);
  });
});

describe('hilos de projects e iniciativas: comentarios', () => {
  it('editar y borrar solo lo propio; responder, resolver y reaccionar', async () => {
    const { w, plan, owner, member } = await setup();
    const root = (await (await run(member, w.member.id, () => plans.POST(req('POST', { body: 'Root' }), P(plan.id)))).json()) as { id: string };
    // El owner no edita ni borra un comentario ajeno.
    expect((await run(owner, w.owner.id, () => planComment.PATCH(req('PATCH', { body: 'hack' }), P(plan.id, root.id)))).status).toBe(403);
    expect((await run(owner, w.owner.id, () => planComment.DELETE(req('DELETE'), P(plan.id, root.id)))).status).toBe(403);
    expect((await run(member, w.member.id, () => planComment.PATCH(req('PATCH', { body: 'Root edited' }), P(plan.id, root.id)))).status).toBe(200);

    const reply = await run(owner, w.owner.id, () => plans.POST(req('POST', { body: 'Reply', parentId: root.id }), P(plan.id)));
    expect(reply.status).toBe(201);
    expect(((await reply.json()) as { parent_id: string }).parent_id).toBe(root.id);

    expect((await run(owner, w.owner.id, () => planResolve.POST(req('POST', { resolved: true }), P(plan.id, root.id)))).status).toBe(200);
    const react = await run(owner, w.owner.id, () => planReact.POST(req('POST', { emoji: '👍' }), P(plan.id, root.id)));
    expect(react.status).toBe(200);
    expect(((await react.json()) as { reactions: Array<{ emoji: string }> }).reactions.map((r) => r.emoji)).toEqual(['👍']);
    expect((await run(owner, w.owner.id, () => planReact.POST(req('POST', { emoji: 'nope' }), P(plan.id, root.id)))).status).toBe(400);

    const list = (await (await run(owner, w.owner.id, () => plans.GET(req('GET'), P(plan.id)))).json()) as { rows: Array<{ meta: string }> };
    const metas = list.rows.map((r) => JSON.parse(r.meta) as { body: string; resolvedAt: string | null; parentId: string | null; editedAt: string | null });
    expect(metas[0]).toMatchObject({ body: 'Root edited', parentId: null });
    expect(metas[0].resolvedAt).toBeTruthy();
    expect(metas[0].editedAt).toBeTruthy();
    expect(metas[1]).toMatchObject({ body: 'Reply', parentId: root.id });

    // Borrar la raíz se lleva la respuesta.
    expect((await run(member, w.member.id, () => planComment.DELETE(req('DELETE'), P(plan.id, root.id)))).status).toBe(200);
    const after = (await (await run(owner, w.owner.id, () => plans.GET(req('GET'), P(plan.id)))).json()) as { rows: unknown[] };
    expect(after.rows).toHaveLength(0);
  });

  it('avisos: la mención llega a quien puede leer el hilo, nunca al invitado', async () => {
    const { w, guest, plan, member } = await setup();
    const name = (u: { name: string | null; email: string }) => u.name ?? u.email;
    const users = (await getDb().prepare('SELECT id, name, email FROM users WHERE id IN (?, ?)').all(w.friend.id, guest.id)) as Array<{
      id: string;
      name: string | null;
      email: string;
    }>;
    const friend = users.find((u) => u.id === w.friend.id)!;
    const g = users.find((u) => u.id === guest.id)!;
    await run(member, w.member.id, () => plans.POST(req('POST', { body: `Ping @${friend.email} and @${g.email} (${name(friend)})` }), P(plan.id)));
    const notes = (await getDb()
      .prepare("SELECT user_id, type, href, source_type, source_id FROM notifications WHERE source_type = 'track_plan' AND source_id = ?")
      .all(plan.id)) as Array<{ user_id: string; type: string; href: string; source_type: string; source_id: string }>;
    expect(notes.find((n) => n.user_id === w.friend.id)).toMatchObject({ type: 'mention', href: `/app/track/projects/${plan.id}#comments` });
    expect(notes.some((n) => n.user_id === guest.id)).toBe(false);
    expect(notes.some((n) => n.user_id === w.member.id)).toBe(false);
  });

  it('un comentario de un project no se toca desde otro; se borra con su project', async () => {
    const { w, plan, owner, member } = await setup();
    const { createPlan: mk, deletePlan } = await import('@/lib/track-plans');
    const other = await mk({ teamId: w.team.id, ownerId: w.owner.id }, w.owner.id, planCreateSchema.parse({ name: 'Other' }));
    if (!other.ok) throw new Error(other.error);
    const root = (await (await run(member, w.member.id, () => plans.POST(req('POST', { body: 'Mine' }), P(plan.id)))).json()) as { id: string };
    // Por la ruta de otro project: 404 en todo.
    expect((await run(member, w.member.id, () => planComment.PATCH(req('PATCH', { body: 'x' }), P(other.plan.id, root.id)))).status).toBe(404);
    expect((await run(member, w.member.id, () => planComment.DELETE(req('DELETE'), P(other.plan.id, root.id)))).status).toBe(404);
    expect((await run(owner, w.owner.id, () => planResolve.POST(req('POST', { resolved: true }), P(other.plan.id, root.id)))).status).toBe(404);
    expect((await run(owner, w.owner.id, () => planReact.POST(req('POST', { emoji: '👍' }), P(other.plan.id, root.id)))).status).toBe(404);
    // Una respuesta con un padre de otro project queda como comentario suelto de este.
    const stray = await run(owner, w.owner.id, () => plans.POST(req('POST', { body: 'Stray', parentId: root.id }), P(other.plan.id)));
    expect(((await stray.json()) as { parent_id: string | null }).parent_id).toBeNull();
    // Resolver una respuesta: 404.
    const reply = (await (await run(owner, w.owner.id, () => plans.POST(req('POST', { body: 'Re', parentId: root.id }), P(plan.id)))).json()) as { id: string };
    expect((await run(owner, w.owner.id, () => planResolve.POST(req('POST', { resolved: true }), P(plan.id, reply.id)))).status).toBe(404);
    // Borrar el project se lleva sus comentarios.
    await deletePlan(plan.id);
    const left = (await getDb().prepare('SELECT COUNT(*) AS c FROM track_entity_comments WHERE plan_id = ?').get(plan.id)) as { c: number };
    expect(left.c).toBe(0);
  });

  it('avisos a quienes siguen el project, no a quien dejó el workspace', async () => {
    const { w, plan, member } = await setup();
    const { setPlanFollow } = await import('@/lib/track-plans');
    const { addMember, removeMember } = await import('@/lib/teams');
    const leaver = await makeUser('ent-c-leaver');
    await addMember(w.team.id, leaver.id, 'member');
    await setPlanFollow(plan.id, w.friend.id, true);
    await setPlanFollow(plan.id, leaver.id, true);
    await removeMember(w.team.id, leaver.id);
    await run(member, w.member.id, () => plans.POST(req('POST', { body: 'Status' }), P(plan.id)));
    const notes = (await getDb()
      .prepare("SELECT user_id, type FROM notifications WHERE source_type = 'track_plan' AND source_id = ?")
      .all(plan.id)) as Array<{ user_id: string; type: string }>;
    expect(notes.find((n) => n.user_id === w.friend.id)?.type).toBe('comment');
    expect(notes.some((n) => n.user_id === leaver.id)).toBe(false);
  });
});
