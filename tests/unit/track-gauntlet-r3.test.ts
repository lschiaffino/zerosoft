import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getClient, getDb } from '@/lib/db';
import { MIGRATIONS } from '@/lib/schema/migrations';
import { bulkEditIssues, findWorkspaceIssueByIdentifier } from '@/lib/track-bulk';
import { createCycle, createIssue, createProject, getIssue, listStatuses, updateProject } from '@/lib/track-data';
import { createLabel, deleteLabel, findOrCreateLabel, listLabels, parseIssueLabels, updateLabel } from '@/lib/track-labels';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const cycleRoute = await import('@/lib/routes/track/cycles/[id]/route');
const statusRoute = await import('@/lib/routes/track/statuses/[id]/route');
const labelRoute = await import('@/lib/routes/track/labels/[id]/route');
const projectRoute = await import('@/lib/routes/track/projects/[id]/route');

const json = (method: string, body?: unknown) =>
  new NextRequest('http://x/api', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const app = { source: 'app' as const };
const uid = () => crypto.randomUUID().slice(0, 6);

describe('Track gauntlet r3: cycles', () => {
  it('hay índice sobre track_issues(cycle_id) y el progreso no escanea la tabla', async () => {
    await makeUser('r3cy'); // asegura las migraciones
    const mig = MIGRATIONS.find((m) => m.id === '030_track_issues_cycle_index');
    expect(mig).toBeDefined();
    await mig!.up(getClient()); // idempotente
    const rows = (await getClient().execute('PRAGMA index_list(track_issues)')).rows.map((r) => String(r.name));
    expect(rows).toContain('idx_track_issues_cycle');
    const plan = (
      await getClient().execute(
        "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM track_issues i WHERE i.cycle_id = 'x'",
      )
    ).rows.map((r) => String(r.detail));
    expect(plan.join('\n')).toContain('idx_track_issues_cycle');
  });
});

describe('Track gauntlet r3: labels', () => {
  it('agregar un label masivo a un issue con 10 labels lo saltea en vez de recortarlo', async () => {
    const a = await makeUser('r3bl');
    const p = await createProject(a.id, null, { name: 'Bulk10' });
    const ten = [];
    for (let i = 0; i < 10; i++) ten.push({ name: `l${i}` });
    const full = await createIssue(p.id, a.id, { title: 'full', description: [], labels: ten }, app);
    const free = await createIssue(p.id, a.id, { title: 'free', description: [] }, app);
    const bug = await createLabel(a.id, { name: 'bug' });
    if (!bug.ok) throw new Error('setup');
    const res = await bulkEditIssues(
      { action: 'update', issueIds: [full.id, free.id], patch: { addLabelIds: [bug.label.id] } },
      { teamId: null, ownerId: a.id, actorId: a.id },
    );
    expect(res.updated).toEqual([free.id]);
    expect(res.skipped).toEqual([{ id: full.id, reason: 'too_many_labels' }]);
    expect(parseIssueLabels((await getIssue(free.id))!.labels).map((l) => l.name)).toEqual(['bug']);
  });

  it('crear el mismo label nuevo en paralelo no falla', async () => {
    const a = await makeUser('r3lc');
    const results = await Promise.all([
      findOrCreateLabel(a.id, 'soporte'),
      findOrCreateLabel(a.id, 'Soporte'),
      findOrCreateLabel(a.id, 'SOPORTE'),
    ]);
    expect(new Set(results.map((l) => l.id)).size).toBe(1);
    expect((await listLabels(a.id)).map((l) => l.name)).toEqual(['soporte']);
  });

  it('un INSERT que choca con el índice único devuelve duplicate, no una excepción', async () => {
    const a = await makeUser('r3ld');
    const first = await createLabel(a.id, { name: 'x' });
    expect(first.ok).toBe(true);
    // Simula la carrera: el nombre ya existe pero con otro case no detectado
    // por la búsqueda previa; forzamos el INSERT duplicado directamente.
    await expect(
      getDb().prepare('INSERT INTO track_labels (id, workspace_id, name, color) VALUES (?, ?, ?, ?)').run(
        crypto.randomUUID(),
        a.id,
        'X',
        '#666666',
      ),
    ).rejects.toThrow(/UNIQUE/);
    expect(await createLabel(a.id, { name: 'x' })).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('renombrar y borrar reescriben la copia en los issues sin tocar los otros labels', async () => {
    const a = await makeUser('r3lr');
    const b = await makeUser('r3lr2');
    const p = await createProject(a.id, null, { name: 'Rw' });
    const pb = await createProject(b.id, null, { name: 'RwB' });
    const i1 = await createIssue(p.id, a.id, { title: 'uno', description: [], labels: [{ name: 'bug' }, { name: 'ui' }] }, app);
    const i2 = await createIssue(p.id, a.id, { title: 'dos', description: [], labels: [{ name: 'api' }, { name: 'bug' }] }, app);
    const i3 = await createIssue(p.id, a.id, { title: 'tres', description: [], labels: [{ name: 'ui' }] }, app);
    const bug = parseIssueLabels(i1.labels)[0];
    // Un issue de otro workspace con el mismo id de label (copia vieja) no se toca.
    const foreign = await createIssue(pb.id, b.id, { title: 'x', description: [] }, app);
    await getDb().prepare('UPDATE track_issues SET labels = ? WHERE id = ?').run(JSON.stringify([bug]), foreign.id);

    const res = await updateLabel(a.id, bug.id, { name: 'Defecto', color: '#ff0000' });
    expect(res.ok).toBe(true);
    expect(parseIssueLabels((await getIssue(i1.id))!.labels).map((l) => [l.name, l.color])).toEqual([
      ['Defecto', '#ff0000'],
      ['ui', parseIssueLabels(i1.labels)[1].color],
    ]);
    expect(parseIssueLabels((await getIssue(i2.id))!.labels).map((l) => l.name)).toEqual(['api', 'Defecto']);
    expect((await getIssue(i3.id))!.labels).toBe(i3.labels);
    expect(parseIssueLabels((await getIssue(foreign.id))!.labels)[0].name).toBe('bug');

    expect(await deleteLabel(a.id, bug.id)).toBe(true);
    expect(parseIssueLabels((await getIssue(i1.id))!.labels).map((l) => l.name)).toEqual(['ui']);
    expect(parseIssueLabels((await getIssue(i2.id))!.labels).map((l) => l.name)).toEqual(['api']);
    expect((await listLabels(a.id)).map((l) => l.name)).toEqual(['api', 'ui']);
  });
});

describe('Track gauntlet r3: identificadores', () => {
  it('un slug reusado en el mismo workspace no repite identificadores', async () => {
    const a = await makeUser('r3id');
    const slug = `r3z${uid()}`;
    const pa = await createProject(a.id, null, { name: 'A', slug });
    const a1 = await createIssue(pa.id, a.id, { title: 'a1', description: [] }, app);
    await createIssue(pa.id, a.id, { title: 'a2', description: [] }, app);
    await updateProject(pa.id, { slug: `${slug}-core` });
    const pb = await createProject(a.id, null, { name: 'B', slug });
    expect(pb.slug).toBe(slug);
    const b1 = await createIssue(pb.id, a.id, { title: 'b1', description: [] }, app);
    // Cambiar la clave renombra los issues (como Linear): los de A pasan a -CORE y B arranca en 1.
    const a1now = (await getIssue(a1.id))!;
    expect(a1now.identifier).toBe(`${slug.toUpperCase()}-CORE-1`);
    expect(b1.identifier).toBe(`${slug.toUpperCase()}-1`);
    expect(b1.identifier).not.toBe(a1now.identifier);
    // El proyecto renombrado sigue numerando con su prefijo nuevo.
    const a3 = await createIssue(pa.id, a.id, { title: 'a3', description: [] }, app);
    expect(a3.identifier).toBe(`${slug.toUpperCase()}-CORE-3`);
  });

  it('la búsqueda por identifier no elige uno cualquiera si hay dos', async () => {
    const a = await makeUser('r3amb');
    const p1 = await createProject(a.id, null, { name: 'P1' });
    const p2 = await createProject(a.id, null, { name: 'P2' });
    const i1 = await createIssue(p1.id, a.id, { title: 'uno', description: [] }, app);
    const i2 = await createIssue(p2.id, a.id, { title: 'dos', description: [] }, app);
    expect((await findWorkspaceIssueByIdentifier(p2.id, i1.identifier.toLowerCase()))?.id).toBe(i1.id);
    // Datos viejos: dos issues con el mismo identifier en el workspace.
    await getDb().prepare('UPDATE track_issues SET identifier = ? WHERE id = ?').run(i1.identifier, i2.id);
    expect(await findWorkspaceIssueByIdentifier(p2.id, i1.identifier)).toBeUndefined();
  });
});

describe('Track gauntlet r3: permisos de configuración compartida', () => {
  it('borrar cycles y statuses, editar labels y slug/archivo/triage es de admin', async () => {
    const a = await makeUser('r3adm');
    const p = await createProject(a.id, null, { name: 'Adm', slug: `r3adm-${uid()}` });
    const cycle = await createCycle(p.id, { name: 'S1', startAt: '2026-01-01', endAt: '2026-01-14' });
    const [first, second] = await listStatuses(p.id);
    const label = await createLabel(a.id, { name: 'bug' });
    if (!label.ok) throw new Error('setup');

    session.user = { ...a, team: null, role: 'member' };
    expect((await cycleRoute.DELETE(json('DELETE'), params(cycle.id))).status).toBe(403);
    expect((await statusRoute.DELETE(json('DELETE', { reassignTo: second.id }), params(first.id))).status).toBe(403);
    expect((await labelRoute.PATCH(json('PATCH', { name: 'otro' }), params(label.label.id))).status).toBe(403);
    expect((await projectRoute.PATCH(json('PATCH', { slug: `r3x-${uid()}` }), params(p.id))).status).toBe(403);
    expect((await projectRoute.PATCH(json('PATCH', { status: 'archived' }), params(p.id))).status).toBe(403);
    expect((await projectRoute.PATCH(json('PATCH', { triageEnabled: true }), params(p.id))).status).toBe(403);
    // Lo que no es compartido (o no cambia) sigue abierto a miembros.
    const renamed = await projectRoute.PATCH(json('PATCH', { name: 'Nuevo', slug: p.slug, status: 'active' }), params(p.id));
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { name: string }).name).toBe('Nuevo');

    session.user = { ...a, team: null, role: 'owner' };
    expect((await labelRoute.PATCH(json('PATCH', { name: 'otro' }), params(label.label.id))).status).toBe(200);
    expect((await projectRoute.PATCH(json('PATCH', { triageEnabled: true }), params(p.id))).status).toBe(200);
    expect((await statusRoute.DELETE(json('DELETE', { reassignTo: second.id }), params(first.id))).status).toBe(200);
    expect((await cycleRoute.DELETE(json('DELETE'), params(cycle.id))).status).toBe(200);
  });
});
