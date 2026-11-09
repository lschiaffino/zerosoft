import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createIssue, createProject, listAllIssues } from '@/lib/track-data';
import { makeUser } from './helpers';

/** La lista compartida usa /api/track/issues con ?mine= (Mis issues) y ?planId= (project), con los mismos filtros y orden. */
describe('track: alcances de la lista compartida', () => {
  it('mine=assigned|created y planId filtran sobre los issues del workspace', async () => {
    const u = await makeUser('scope');
    const team = await createProject(u.id, null, { name: 'Scopes' });
    const mine = await createIssue(team.id, u.id, { title: 'Mío', description: [], assigneeId: u.id }, { source: 'app' });
    const other = await createIssue(team.id, u.id, { title: 'Sin asignar', description: [] }, { source: 'app' });
    const planId = crypto.randomUUID();
    await getDb()
      .prepare("INSERT INTO track_plans (id, team_id, owner_id, name, created_at, updated_at) VALUES (?, NULL, ?, 'P', datetime('now'), datetime('now'))")
      .run(planId, u.id);
    await getDb().prepare('UPDATE track_issues SET plan_id = ? WHERE id = ?').run(planId, other.id);

    const assigned = await listAllIssues(null, u.id, { mine: { userId: u.id, tab: 'assigned' } });
    expect(assigned.rows.map((r) => r.id)).toEqual([mine.id]);
    const created = await listAllIssues(null, u.id, { mine: { userId: u.id, tab: 'created' }, sort: 'oldest' });
    expect(created.rows.map((r) => r.id)).toEqual([mine.id, other.id]);
    const inPlan = await listAllIssues(null, u.id, { planId });
    expect(inPlan.rows.map((r) => r.id)).toEqual([other.id]);
  });
});
