/**
 * Comentarios en línea sobre la descripción: el raíz guarda el texto elegido
 * (normalizado), una respuesta no; el texto sale en la actividad del issue
 * hasta que el hilo se resuelve (el cliente deja de resaltar). Acceso: el de
 * los comentarios del issue (anónimo, otro workspace, persona sin acceso al
 * team privado, compañera y owner).
 */
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/session';
import { createIssue, createProject, listIssueActivities } from '@/lib/track-data';
import { runAsTrackViewer, setProjectVisibility } from '@/lib/track-access';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const { POST } = await import('@/lib/routes/track/issues/[id]/comments/route');
const { POST: RESOLVE } = await import('@/lib/routes/track/issues/[id]/comments/[commentId]/resolve/route');

/** La sesión dentro del workspace (como la arma getCurrentUser). */
const inTeam = (u: SessionUser, teamId: string) => ({ ...u, team: { id: teamId } }) as unknown as SessionUser;

const post = (issueId: string, body: unknown) =>
  POST(new NextRequest(`http://localhost/api/track/issues/${issueId}/comments`, { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: issueId }),
  });

function anchors(rows: Awaited<ReturnType<typeof listIssueActivities>>) {
  return rows
    .filter((a) => a.type === 'comment')
    .map((a) => JSON.parse(a.meta) as { commentId: string; anchor: string | null; parentId: string | null; resolvedAt: string | null });
}

describe('comentarios en línea', () => {
  it('guarda el texto elegido en el raíz, no en una respuesta, y se resuelve', async () => {
    const w = await workspaceWithMember('inline-c');
    const team = await createProject(w.owner.id, w.team.id, { name: 'T' });
    const issue = await createIssue(team.id, w.owner.id, { title: 'x', priority: 'low', description: [] });
    session.user = inTeam(asMember(w.owner, w.member), w.team.id);
    const res = await post(issue.id, { body: 'Esto no cierra', anchor: '  el   login\n falla ' });
    expect(res.status).toBe(201);
    const root = (await res.json()) as { id: string; anchor_text: string };
    expect(root.anchor_text).toBe('el login falla');
    const reply = await post(issue.id, { body: 'Ya lo miro', parentId: root.id, anchor: 'otro texto' });
    expect(reply.status).toBe(201);
    expect(((await reply.json()) as { anchor_text: string | null }).anchor_text).toBeNull();

    let list = anchors(await listIssueActivities(issue.id));
    expect(list.find((c) => c.commentId === root.id)).toMatchObject({ anchor: 'el login falla', resolvedAt: null });
    expect(list.filter((c) => c.anchor)).toHaveLength(1);

    const r = await RESOLVE(
      new NextRequest(`http://localhost/x`, { method: 'POST', body: JSON.stringify({ resolved: true }) }),
      { params: Promise.resolve({ id: issue.id, commentId: root.id }) },
    );
    expect(r.status).toBe(200);
    list = anchors(await listIssueActivities(issue.id));
    expect(list.find((c) => c.commentId === root.id)?.resolvedAt).toBeTruthy();
  });

  it('rechaza un texto vacío o demasiado largo', async () => {
    const w = await workspaceWithMember('inline-v');
    const team = await createProject(w.owner.id, w.team.id, { name: 'T' });
    const issue = await createIssue(team.id, w.owner.id, { title: 'x', priority: 'low', description: [] });
    session.user = inTeam(asOwner(w.owner), w.team.id);
    expect((await post(issue.id, { body: 'a', anchor: '   ' })).status).toBe(400);
    expect((await post(issue.id, { body: 'a', anchor: 'x'.repeat(1001) })).status).toBe(400);
  });

  it('acceso: solo quien ve el issue comenta', async () => {
    const w = await workspaceWithMember('inline-a');
    const team = await createProject(w.owner.id, w.team.id, { name: 'Privado' });
    const issue = await createIssue(team.id, w.owner.id, { title: 'x', priority: 'low', description: [] });
    await setProjectVisibility(team.id, 'private', w.owner.id);
    const body = { body: 'hola', anchor: 'texto' };
    session.user = null;
    expect((await post(issue.id, body)).status).toBe(401);
    session.user = asOwner(w.stranger);
    expect((await post(issue.id, body)).status).toBe(404);
    // En el test la sesión no llega a lib/track-access por su import dinámico: se fija quién mira.
    session.user = inTeam(asMember(w.owner, w.member), w.team.id);
    expect((await runAsTrackViewer(w.member.id, () => post(issue.id, body), 'app')).status).toBe(404);
    session.user = inTeam(asOwner(w.owner), w.team.id);
    expect((await runAsTrackViewer(w.owner.id, () => post(issue.id, body), 'app')).status).toBe(201);
  });
});
