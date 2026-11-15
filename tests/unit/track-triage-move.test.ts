import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createIssue, createProject, getIssue, listStatuses, updateProject } from '@/lib/track-data';
import { planTriageRules } from '@/lib/track-triage-shared';
import { createTriageRule, updateTriageSettings } from '@/lib/track-triage';
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
  after: () => {},
}));
vi.mock('@/lib/events', () => ({ emitEvent: async () => {}, emitEventSoon: async () => {} }));

const rulesRoute = await import('@/lib/routes/track/projects/[id]/triage-rules/route');
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: unknown) => new NextRequest('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never;

async function team(owner: { id: string }, name: string, triage = true) {
  const p = await createProject(owner.id, null, { name: `${name} ${crypto.randomUUID().slice(0, 6)}` });
  if (triage) await updateProject(p.id, { triageEnabled: true });
  return p;
}

describe('triage: regla que mueve a otro team', () => {
  it('mover gana sobre estado, cycle y asignado del team de origen', () => {
    const plan = planTriageRules(
      [
        { id: 'a', name: 'A', enabled: true, position: 0, conditions: [], actions: { priority: 'high', acceptStatusId: 's1', assigneeId: 'u1' } },
        { id: 'b', name: 'B', enabled: true, position: 1, conditions: [], actions: { moveToProjectId: 'ops', labelIds: ['l1'] } },
      ],
      { source: 'api', title: 'x', description: '', priority: 'none', labelIds: [], customers: [] },
    );
    expect(plan.actions).toEqual({ priority: 'high', moveToProjectId: 'ops', labelIds: ['l1'] });
  });

  it('un issue que entra a triage pasa a la cola del otro team, con identificador nuevo, y ahí corren sus reglas', async () => {
    const owner = await makeUser('mv');
    session.user = { ...owner, team: null, role: 'owner' };
    const support = await team(owner, 'Support');
    const billing = await team(owner, 'Billing');
    await createTriageRule(support.id, { name: 'Billing questions', conditions: [{ field: 'text', op: 'contains', values: ['invoice'] }], actions: { moveToProjectId: billing.id, priority: 'high' } }, owner.id);
    await createTriageRule(billing.id, { name: 'Tag', conditions: [], actions: { priority: 'urgent' } }, owner.id);
    await updateTriageSettings(billing.id, { ownerIds: [owner.id], ownerAction: 'assign' });

    const issue = await createIssue(support.id, owner.id, { title: 'Wrong invoice total', description: [] }, { source: 'chat' });
    const after = (await getIssue(issue.id))!;
    expect(after.project_id).toBe(billing.id);
    expect(after.triage).toBe(1);
    expect(after.identifier.startsWith(`${billing.slug.toUpperCase()}-`)).toBe(true);
    // La regla del team de destino corrió (urgent) y el responsable de turno de Billing lo tomó.
    expect(after.priority).toBe('urgent');
    expect(after.assignee_id).toBe(owner.id);

    // Lo que no cumple la condición queda en Support.
    const other = await createIssue(support.id, owner.id, { title: 'Login broken', description: [] }, { source: 'chat' });
    expect((await getIssue(other.id))!.project_id).toBe(support.id);
  });

  it('a un team sin triage, el issue entra directo a su estado por defecto', async () => {
    const owner = await makeUser('mv2');
    session.user = { ...owner, team: null, role: 'owner' };
    const intake = await team(owner, 'Intake');
    const ops = await team(owner, 'Ops', false);
    await createTriageRule(intake.id, { name: 'Ops', conditions: [], actions: { moveToProjectId: ops.id } }, owner.id);
    const issue = await createIssue(intake.id, owner.id, { title: 'Server disk full' }, { source: 'api' });
    const after = (await getIssue(issue.id))!;
    expect(after.project_id).toBe(ops.id);
    expect(after.triage).toBe(0);
    expect((await listStatuses(ops.id)).map((s) => s.id)).toContain(after.status_id);
  });

  it('dos teams que se mandan issues entre sí no giran para siempre', async () => {
    const owner = await makeUser('mv3');
    session.user = { ...owner, team: null, role: 'owner' };
    const a = await team(owner, 'Ping');
    const b = await team(owner, 'Pong');
    await createTriageRule(a.id, { name: 'to B', conditions: [], actions: { moveToProjectId: b.id } }, owner.id);
    await createTriageRule(b.id, { name: 'to A', conditions: [], actions: { moveToProjectId: a.id } }, owner.id);
    const issue = await createIssue(a.id, owner.id, { title: 'Loop' }, { source: 'api' });
    const after = (await getIssue(issue.id))!;
    expect([a.id, b.id]).toContain(after.project_id);
    expect(after.triage).toBe(1);
  });

  it('la ruta no deja mover al mismo team ni a un team de otro workspace', async () => {
    const owner = await makeUser('mv4');
    const stranger = await makeUser('mv5');
    session.user = { ...owner, team: null, role: 'owner' };
    const mine = await team(owner, 'Mine');
    const theirs = await team(stranger, 'Theirs');
    const same = await rulesRoute.POST(req({ name: 'Self', conditions: [], actions: { moveToProjectId: mine.id } }), params(mine.id));
    expect(same.status).toBe(400);
    expect((await same.json()).error).toBe('invalid_team');
    const other = await rulesRoute.POST(req({ name: 'Leak', conditions: [], actions: { moveToProjectId: theirs.id } }), params(mine.id));
    expect(other.status).toBe(400);
    expect((await other.json()).error).toBe('invalid_team');
    // Y nada quedó guardado.
    const rows = (await getDb().prepare('SELECT COUNT(*) AS n FROM track_triage_rules WHERE project_id = ?').get(mine.id)) as { n: number };
    expect(Number(rows.n)).toBe(0);
  });
});
