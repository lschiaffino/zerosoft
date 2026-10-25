import { describe, expect, it } from 'vitest';
import { canAccessTrackProject, createProject, listAllIssues, listProjects, createIssue } from '@/lib/track-data';
import { makeUser } from './helpers';

describe('Track: aislamiento entre usuarios', () => {
  it('un proyecto personal solo lo ve su dueño', async () => {
    const p = { team_id: null, owner_id: 'a' };
    expect(await canAccessTrackProject(p, null, 'a')).toBe(true);
    expect(await canAccessTrackProject(p, null, 'b')).toBe(false);
    expect(await canAccessTrackProject(p, 'team-1', 'a')).toBe(false);
  });

  it('un proyecto de team lo ve el team, no los usuarios sueltos', async () => {
    const p = { team_id: 'team-1', owner_id: 'a' };
    expect(await canAccessTrackProject(p, 'team-1', 'x')).toBe(true);
    expect(await canAccessTrackProject(p, null, 'a')).toBe(false);
    expect(await canAccessTrackProject(p, 'team-2', 'a')).toBe(false);
  });

  it('listProjects y listAllIssues no filtran datos de otros usuarios', async () => {
    const a = await makeUser('a');
    const b = await makeUser('b');
    const pa = await createProject(a.id, null, { name: 'Secreto' });
    await createIssue(pa.id, a.id, { title: 'privado', priority: 'low', description: [] });

    const visibleToB = await listProjects(null, b.id);
    expect(visibleToB.rows.map((p) => p.id)).not.toContain(pa.id);
    const issuesB = await listAllIssues(null, b.id);
    expect(issuesB.rows).toHaveLength(0);

    const visibleToA = await listProjects(null, a.id);
    expect(visibleToA.rows.map((p) => p.id)).toContain(pa.id);
  });

  it('dos usuarios pueden tener un proyecto con el mismo nombre (y la misma clave, como Linear)', async () => {
    const a = await makeUser('a');
    const b = await makeUser('b');
    const p1 = await createProject(a.id, null, { name: 'Launch' });
    const p2 = await createProject(b.id, null, { name: 'Launch' });
    // La clave es única por workspace: los dos son LAU en su workspace.
    expect(p1.slug).toBe('lau');
    expect(p2.slug).toBe('lau');
    // En el mismo workspace, el segundo toma otra.
    const p3 = await createProject(a.id, null, { name: 'Launch' });
    expect(p3.slug).not.toBe('lau');
  });
});
