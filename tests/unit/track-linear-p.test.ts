import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createIssue, createProject, getIssue, getProject, listStatuses, updateIssue, updateProject } from '@/lib/track-data';
import { teamKeyCandidates, normalizeTeamKey } from '@/lib/track-team-key';
import { createLabel, LABEL_PALETTE, listLabels, updateLabel, deleteLabel } from '@/lib/track-labels';
import { snoozeAt } from '@/lib/track-snooze';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    void task().catch(() => {});
  },
}));
vi.mock('@/lib/events', () => ({ emitEvent: async () => {} }));

const projectRoute = await import('@/lib/routes/track/projects/[id]/route');
const req = (method: string, body?: unknown) =>
  new NextRequest('http://x/t', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function team(name = `Auto ${crypto.randomUUID().slice(0, 6)}`) {
  const owner = await makeUser('tlp');
  const project = await createProject(owner.id, null, { name });
  const statuses = await listStatuses(project.id);
  const by = (c: string) => statuses.find((s) => s.category === c)!.id;
  return { owner, project, by };
}

describe('Track: identificador del team como Linear', () => {
  it('tres letras del nombre, iniciales y alternativas', () => {
    expect(teamKeyCandidates('Mobile App')[0]).toBe('mob');
    expect(teamKeyCandidates('Mobile App')).toContain('ma');
    expect(teamKeyCandidates('Customer Success Team')).toContain('cst');
    expect(teamKeyCandidates('Ñandú Diseño')[0]).toBe('nan');
    const all = teamKeyCandidates('Design');
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((k) => /^[a-z0-9]{2,5}$/.test(k))).toBe(true);
    expect(normalizeTeamKey(' Mob ')).toBe('mob');
    expect(normalizeTeamKey('mob-app')).toBeNull();
  });

  it('crear sin clave usa una de tres letras libre; cambiarla renombra los IDs y deja alias', async () => {
    const name = `Zq${crypto.randomUUID().slice(0, 4)} Mobile`;
    const { owner, project } = await team(name);
    expect(project.slug.length).toBeLessThanOrEqual(5);
    const other = await createProject(owner.id, null, { name });
    expect(other.slug).not.toBe(project.slug);
    const issue = await createIssue(project.id, owner.id, { title: 'Uno' });
    expect(issue.identifier).toBe(`${project.slug.toUpperCase()}-1`);
    const key = `k${crypto.randomUUID().replace(/[^a-z0-9]/g, '').slice(0, 4)}`;
    await updateProject(project.id, { slug: key });
    expect((await getIssue(issue.id))!.identifier).toBe(`${key.toUpperCase()}-1`);
    const alias = await getDb().prepare('SELECT issue_id FROM track_issue_aliases WHERE identifier = ?').get(issue.identifier);
    expect(alias).toEqual({ issue_id: issue.id });
  });

  it('PATCH con una clave ocupada responde slug_taken', async () => {
    const a = await team();
    // La clave es única por workspace: otro team del mismo workspace la ocupa.
    const b = { project: await createProject(a.owner.id, null, { name: `Otro ${crypto.randomUUID().slice(0, 4)}` }) };
    session.user = { ...a.owner, team: null, role: 'owner' };
    const res = await projectRoute.PATCH(req('PATCH', { slug: b.project.slug }), params(a.project.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('slug_taken');
  });
});

describe('Track: auto-cerrar padre y sub-issues', () => {
  it('apagado no cambia nada', async () => {
    const { owner, project, by } = await team();
    const parent = await createIssue(project.id, owner.id, { title: 'Padre', statusId: by('todo') });
    const kid = await createIssue(project.id, owner.id, { title: 'Hijo', statusId: by('todo'), parentId: parent.id });
    await updateIssue(kid.id, { statusId: by('done') }, owner.id);
    expect((await getIssue(parent.id))!.status_category).toBe('todo');
  });

  it('el padre se cierra cuando terminan todos sus sub-issues (cancelado cuenta)', async () => {
    const { owner, project, by } = await team();
    await updateProject(project.id, { autoCloseParent: true });
    expect((await getProject(project.id))!.auto_close_parent).toBe(1);
    const parent = await createIssue(project.id, owner.id, { title: 'Padre', statusId: by('in_progress') });
    const a = await createIssue(project.id, owner.id, { title: 'A', statusId: by('todo'), parentId: parent.id });
    const b = await createIssue(project.id, owner.id, { title: 'B', statusId: by('todo'), parentId: parent.id });
    await updateIssue(a.id, { statusId: by('done') }, owner.id);
    expect((await getIssue(parent.id))!.status_category).toBe('in_progress');
    await updateIssue(b.id, { statusId: by('cancelled') }, owner.id);
    expect((await getIssue(parent.id))!.status_category).toBe('done');
    // Una sola línea, firmada por Track (no por quien cerró el último sub-issue).
    const acts = (await getDb()
      .prepare('SELECT type, meta FROM track_issue_activities WHERE issue_id = ? AND type IN (?, ?)')
      .all(parent.id, 'status_change', 'closed')) as Array<{ type: string; meta: string }>;
    expect(acts.map((x) => x.type)).toEqual(['closed']);
    expect(JSON.parse(acts[0].meta)).toMatchObject({ viaAuthor: 'Track', auto: 'sub_issues_done' });
  });

  it('al cerrar el padre se cierran sus sub-issues abiertos con el mismo estado', async () => {
    const { owner, project, by } = await team();
    await updateProject(project.id, { autoCloseChildren: true, autoCloseParent: true });
    const parent = await createIssue(project.id, owner.id, { title: 'Padre', statusId: by('todo') });
    const a = await createIssue(project.id, owner.id, { title: 'A', statusId: by('todo'), parentId: parent.id });
    const b = await createIssue(project.id, owner.id, { title: 'B', statusId: by('done'), parentId: parent.id });
    await updateIssue(parent.id, { statusId: by('cancelled') }, owner.id);
    expect((await getIssue(a.id))!.status_category).toBe('cancelled');
    expect((await getIssue(b.id))!.status_category).toBe('done');
    expect((await getIssue(parent.id))!.status_category).toBe('cancelled');
  });
});

describe('Track: labels con color al azar y grupos', () => {
  it('sin color elige uno de la paleta; con grupo de un nivel', async () => {
    const u = await makeUser('lbl');
    const ws = u.id;
    const group = await createLabel(ws, { name: 'Type' });
    expect(group.ok).toBe(true);
    if (!group.ok) return;
    expect(LABEL_PALETTE).toContain(group.label.color);
    const bug = await createLabel(ws, { name: 'Bug', parentId: group.label.id, color: '#eb5757' });
    expect(bug.ok && bug.label.parent_id).toBe(group.label.id);
    expect(bug.ok && bug.label.color).toBe('#eb5757');
    // Un hijo no puede ser grupo.
    if (!bug.ok) return;
    expect((await createLabel(ws, { name: 'Crash', parentId: bug.label.id })).ok).toBe(false);
    expect((await updateLabel(ws, group.label.id, { parentId: bug.label.id })).ok).toBe(false);
    // Borrar el grupo deja a sus labels sueltos.
    await deleteLabel(ws, group.label.id);
    expect((await listLabels(ws)).find((l) => l.id === bug.label.id)?.parent_id).toBeNull();
  });
});

describe('Track: posponer el triage', () => {
  it('un domingo, mañana y la semana que viene son días distintos', () => {
    const sunday = new Date(2026, 9, 25, 11);
    expect(snoozeAt('tomorrow', sunday).getDate()).not.toBe(snoozeAt('nextWeek', sunday).getDate());
  });
});

// ---------- Ronda 3: estimaciones por team, colores de estado, labels de team y de project ----------

import { estimateLabel, estimateOptions } from '@/lib/track-estimates';
import { STATUS_CATEGORY_COLORS, statusGlyphColor } from '@/lib/track-color';
import { createPlan, getPlanSummary } from '@/lib/track-plans';

const labelsRoute = await import('@/app/api/track/labels/route');
const planRoute = await import('@/lib/routes/track/plans/[id]/route');

describe('Track: escala de estimación por team', () => {
  it('opciones por escala y talles con su número', () => {
    expect(estimateOptions('fibonacci').map((o) => o.value)).toEqual([0, 1, 2, 3, 5, 8]);
    expect(estimateOptions('linear').map((o) => o.value)).toEqual([1, 2, 3, 4, 5]);
    expect(estimateOptions('exponential').map((o) => o.value)).toEqual([1, 2, 4, 8, 16]);
    expect(estimateOptions('tshirt').map((o) => o.label)).toEqual(['XS', 'S', 'M', 'L', 'XL']);
    expect(estimateOptions('none')).toEqual([]);
    expect(estimateOptions('raro').length).toBe(6);
    expect(estimateLabel(5, 'tshirt')).toBe('L');
  });

  it('se guarda por PATCH del team (solo admins)', async () => {
    const { owner, project } = await team();
    expect(project.estimate_scale).toBe('fibonacci');
    session.user = { ...owner, team: null, role: 'owner' };
    const res = await projectRoute.PATCH(req('PATCH', { estimateScale: 'tshirt' }), params(project.id));
    expect(res.status).toBe(200);
    expect((await getProject(project.id))!.estimate_scale).toBe('tshirt');
    session.user = { ...owner, team: null, role: 'member' };
    expect((await projectRoute.PATCH(req('PATCH', { estimateScale: 'linear' }), params(project.id))).status).toBe(403);
    expect((await projectRoute.PATCH(req('PATCH', { estimateScale: 'nope' }), params(project.id))).status).toBe(400);
  });
});

describe('Track: colores de estado como Linear', () => {
  it('los estados nuevos nacen con el color de su categoría y los viejos se pintan por categoría', async () => {
    const { project } = await team();
    const statuses = await listStatuses(project.id);
    expect(statuses.find((s) => s.category === 'in_progress')!.color).toBe(STATUS_CATEGORY_COLORS.in_progress);
    expect(statuses.find((s) => s.category === 'done')!.color).toBe(STATUS_CATEGORY_COLORS.done);
    expect(statusGlyphColor('#000000', 'done')).toBe(STATUS_CATEGORY_COLORS.done);
    expect(statusGlyphColor(null, 'in_progress')).toBe(STATUS_CATEGORY_COLORS.in_progress);
    expect(statusGlyphColor('#eb5757', 'todo')).toBe('#eb5757');
  });
});

describe('Track: labels de team y de project', () => {
  it('?projectId= devuelve los generales y los del team', async () => {
    const { owner, project } = await team();
    const other = await createProject(owner.id, null, { name: 'Otro team' });
    await createLabel(owner.id, { name: 'General' });
    await createLabel(owner.id, { name: 'Solo este', projectId: project.id });
    await createLabel(owner.id, { name: 'Del otro', projectId: other.id });
    session.user = { ...owner, team: null, role: 'owner' };
    const res = await labelsRoute.GET(new NextRequest(`http://x/api/track/labels?projectId=${project.id}`) as never);
    const names = ((await res.json()) as { rows: Array<{ name: string }> }).rows.map((l) => l.name);
    expect(names).toEqual(expect.arrayContaining(['General', 'Solo este']));
    expect(names).not.toContain('Del otro');
  });

  it('un project guarda sus labels (solo del workspace)', async () => {
    const { owner } = await team();
    const scope = { teamId: null, ownerId: owner.id };
    const res = await createPlan(scope, owner.id, { name: 'Con labels' });
    if (!res.ok) throw new Error('plan');
    const mine = await createLabel(owner.id, { name: 'Q4' });
    const stranger = await makeUser('tlp-x');
    const theirs = await createLabel(stranger.id, { name: 'Ajeno' });
    if (!mine.ok || !theirs.ok) throw new Error('labels');
    session.user = { ...owner, team: null, role: 'owner' };
    const patch = await planRoute.PATCH(
      new NextRequest(`http://x/api/track/plans/${res.plan.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ labelIds: [mine.label.id, theirs.label.id] }),
      }) as never,
      params(res.plan.id),
    );
    expect(patch.status).toBe(200);
    const summary = await getPlanSummary(res.plan.id, scope);
    expect(summary!.labels.map((l) => l.name)).toEqual(['Q4']);
  });
});
