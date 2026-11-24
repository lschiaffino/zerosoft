import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createIssue, createProject, getIssue, updateProject } from '@/lib/track-data';
import { resolveTriage } from '@/lib/track-bulk';
import { loadInsightIssues, runInsight } from '@/lib/track-insights';
import { aggregateInsight, type InsightIssue } from '@/lib/track-planning-core';
import { makeUser } from './helpers';

describe('Insights: triage time', () => {
  it('aceptar o rechazar desde triage guarda cuándo salió; el issue creado en la app no tiene dato', async () => {
    const owner = await makeUser('trg-time');
    const team = await createProject(owner.id, null, { name: 'Triage time' });
    await updateProject(team.id, { triageEnabled: true });
    const fromApi = await createIssue(team.id, owner.id, { title: 'From API', priority: 'low', description: [] }, { source: 'api' });
    const declined = await createIssue(team.id, owner.id, { title: 'Declined', priority: 'low', description: [] }, { source: 'api' });
    const inApp = await createIssue(team.id, owner.id, { title: 'In app', priority: 'low', description: [] }, { source: 'app' });
    expect(fromApi.triage).toBe(1);
    // Llegaron hace dos días.
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await getDb().prepare('UPDATE track_issues SET created_at = ? WHERE id IN (?, ?)').run(twoDaysAgo, fromApi.id, declined.id);

    expect((await resolveTriage((await getIssue(fromApi.id))!, { action: 'accept' }, owner.id)).ok).toBe(true);
    expect((await resolveTriage((await getIssue(declined.id))!, { action: 'decline' }, owner.id)).ok).toBe(true);
    expect((await getIssue(fromApi.id))!.triage_resolved_at).toBeTruthy();
    expect((await getIssue(inApp.id))!.triage_resolved_at ?? null).toBeNull();

    const scope = { teamId: null, ownerId: owner.id };
    const issues = await loadInsightIssues(scope, { teamIds: [team.id] });
    expect(issues.find((i) => i.id === inApp.id)?.triageResolvedAt).toBeNull();
    const r = await runInsight(scope, { measure: 'triage_time', slice: 'none', segment: 'none', filters: { teamIds: [team.id] } } as never);
    expect(r.unit).toBe('days');
    expect(r.issueCount).toBe(2);
    expect(r.buckets[0].value).toBeGreaterThanOrEqual(1.9);
    expect(r.buckets[0].value).toBeLessThanOrEqual(2.1);
  });

  it('agregado: solo cuentan los issues que salieron de triage', () => {
    const base: Omit<InsightIssue, 'id' | 'triageResolvedAt'> = {
      identifier: 'X-1',
      title: 't',
      projectId: 'p',
      projectName: 'P',
      statusName: 'Todo',
      category: 'todo',
      priority: 'none',
      assigneeId: null,
      assigneeName: null,
      labels: [],
      planId: null,
      planName: null,
      cycleId: null,
      cycleName: null,
      estimate: null,
      createdAt: '2026-11-01T00:00:00Z',
      startedAt: null,
      completedAt: null,
    };
    const r = aggregateInsight(
      [
        { ...base, id: 'a', triageResolvedAt: '2026-11-02T00:00:00Z' },
        { ...base, id: 'b', triageResolvedAt: '2026-11-04T00:00:00Z' },
        { ...base, id: 'c', triageResolvedAt: null },
      ],
      { measure: 'triage_time', slice: 'none', segment: 'none' },
    );
    expect(r.issueCount).toBe(2);
  });
});
