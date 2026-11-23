import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createIssue, createProject, getIssue, listIssues, listStatuses, updateIssue } from '@/lib/track-data';
import { daysSince, durationParts, summarizeStatusPeriods } from '@/lib/track-status-time';
import { loadStatusTime } from '@/lib/track-status-time-db';
import { filterToSql } from '@/lib/track-filter';
import { aggregateInsight, type InsightIssue } from '@/lib/track-planning-core';
import { compareIssues } from '@/lib/track-views';
import { makeUser } from './helpers';

const H = 3_600_000;

describe('time in status: lo puro', () => {
  it('suma el tiempo de cada período hasta el siguiente y el último hasta ahora', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    const r = summarizeStatusPeriods(
      [
        { status_id: 'todo', status_name: 'Todo', status_category: 'todo', entered_at: '2026-11-10 12:00:00' },
        { status_id: 'doing', status_name: 'In Progress', status_category: 'in_progress', entered_at: '2026-11-12T12:00:00.000Z' },
        { status_id: 'todo', status_name: 'Todo', status_category: 'todo', entered_at: '2026-11-13T12:00:00.000Z' },
        { status_id: 'doing', status_name: 'In Progress', status_category: 'in_progress', entered_at: '2026-11-18T12:00:00.000Z' },
      ],
      now,
      new Map([['doing', { name: 'Doing', color: '#f00', category: 'in_progress' }]]),
    );
    expect(r.since).toBe('2026-11-18T12:00:00.000Z');
    expect(r.currentMs).toBe(48 * H);
    expect(r.currentKey).toBe('doing');
    const by = Object.fromEntries(r.totals.map((t) => [t.key, t]));
    expect(by.todo.ms).toBe((48 + 120) * H);
    expect(by.todo.visits).toBe(2);
    // El nombre actual manda sobre el guardado.
    expect(by.doing.name).toBe('Doing');
    expect(by.doing.ms).toBe((24 + 48) * H);
    expect(r.totals.map((t) => t.key)).toEqual(['todo', 'doing']);
  });

  it('un status borrado conserva el nombre guardado', () => {
    const r = summarizeStatusPeriods([{ status_id: null, status_name: 'Viejo', status_category: 'todo', entered_at: '2026-11-19T00:00:00Z' }], new Date('2026-11-20T00:00:00Z'));
    expect(r.totals[0]).toMatchObject({ key: 'name:Viejo', name: 'Viejo', ms: 24 * H });
  });

  it('duración compacta en una sola unidad', () => {
    expect(durationParts(20_000)).toEqual({ value: 1, unit: 'm' });
    expect(durationParts(59 * 60_000)).toEqual({ value: 59, unit: 'm' });
    expect(durationParts(5 * H)).toEqual({ value: 5, unit: 'h' });
    expect(durationParts(3 * 24 * H)).toEqual({ value: 3, unit: 'd' });
    expect(durationParts(15 * 24 * H)).toEqual({ value: 2, unit: 'w' });
    expect(durationParts(95 * 24 * H)).toEqual({ value: 3, unit: 'mo' });
    expect(daysSince('2026-11-18T00:00:00Z', new Date('2026-11-20T12:00:00Z'))).toBe(2.5);
  });

  it('filtro "más de N días" y orden por time in status', () => {
    const sql = filterToSql({ match: 'and', rules: [{ field: 'status_age', op: 'gte', values: ['7'] }] }, '2026-11-20');
    expect(sql?.sql).toContain('status_changed_at');
    expect(sql?.args).toEqual([7]);
    expect(filterToSql({ match: 'and', rules: [{ field: 'status_age', op: 'gte', values: ['x'] }] }, '2026-11-20')).toBeNull();
    const base = { created_at: '2026-01-01', updated_at: '2026-01-01', priority: 'none' as const, due_date: null, identifier: 'A-1' };
    const older = { ...base, id: 'a', status_changed_at: '2026-11-01T00:00:00.000Z' };
    const newer = { ...base, id: 'b', status_changed_at: '2026-11-10T00:00:00.000Z' };
    const unknown = { ...base, id: 'c', status_changed_at: null };
    expect([newer, unknown, older].sort((x, y) => compareIssues('status_time', x, y)).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('Insights: time in status de los abiertos, en días', () => {
    const now = new Date('2026-11-20T00:00:00Z');
    const issue = (id: string, statusChangedAt: string, category: InsightIssue['category']): InsightIssue => ({
      id,
      identifier: id,
      title: id,
      projectId: 'p',
      projectName: 'P',
      statusName: 'S',
      category,
      priority: 'none',
      assigneeId: null,
      assigneeName: null,
      labels: [],
      planId: null,
      planName: null,
      cycleId: null,
      cycleName: null,
      estimate: null,
      createdAt: '2026-10-01T00:00:00Z',
      startedAt: null,
      completedAt: null,
      statusChangedAt,
    });
    const r = aggregateInsight(
      [issue('a', '2026-11-10T00:00:00Z', 'in_progress'), issue('b', '2026-11-18T00:00:00Z', 'todo'), issue('c', '2026-11-01T00:00:00Z', 'done')],
      { measure: 'time_in_status', slice: 'none', segment: 'none' },
      now,
    );
    expect(r.unit).toBe('days');
    expect(r.issueCount).toBe(2);
  });
});

describe('time in status: registro en la base', () => {
  it('cada cambio de status queda registrado (también por SQL directo) y status_changed_at sigue al actual', async () => {
    const owner = await makeUser('sit');
    const team = await createProject(owner.id, null, { name: 'Status time' });
    const statuses = await listStatuses(team.id);
    const todo = statuses.find((s) => s.category === 'todo')!;
    const doing = statuses.find((s) => s.category === 'in_progress')!;
    const issue = await createIssue(team.id, owner.id, { title: 'Medir', priority: 'low', description: [], statusId: todo.id });
    const db = getDb();
    const first = (await getIssue(issue.id))!;
    expect(first.status_changed_at).toBeTruthy();

    // Viaje al pasado: entró a Todo hace 3 días.
    const past = new Date(Date.now() - 72 * H).toISOString();
    await db.prepare('UPDATE track_issue_status_log SET entered_at = ? WHERE issue_id = ?').run(past, issue.id);
    await db.prepare('UPDATE track_issues SET status_changed_at = ? WHERE id = ?').run(past, issue.id);

    // Filtro: más de 2 días en el status actual.
    const old = await listIssues(team.id, { filter: { match: 'and', rules: [{ field: 'status_age', op: 'gte', values: ['2'] }] } });
    expect(old.rows.map((r) => r.id)).toContain(issue.id);

    await updateIssue(issue.id, { statusId: doing.id }, owner.id);
    const moved = (await getIssue(issue.id))!;
    expect(moved.status_changed_at! > past).toBe(true);
    const recent = await listIssues(team.id, { filter: { match: 'and', rules: [{ field: 'status_age', op: 'gte', values: ['2'] }] } });
    expect(recent.rows.map((r) => r.id)).not.toContain(issue.id);
    const fresh = await listIssues(team.id, { filter: { match: 'and', rules: [{ field: 'status_age', op: 'lte', values: ['1'] }] } });
    expect(fresh.rows.map((r) => r.id)).toContain(issue.id);

    // Un cambio por SQL (bulk, importador) también queda.
    await db.prepare('UPDATE track_issues SET status_id = ? WHERE id = ?').run(todo.id, issue.id);
    // El mismo status otra vez no suma un período.
    await db.prepare('UPDATE track_issues SET status_id = ? WHERE id = ?').run(todo.id, issue.id);
    const st = await loadStatusTime(issue.id);
    const rows = (await db.prepare('SELECT status_id FROM track_issue_status_log WHERE issue_id = ? ORDER BY entered_at, id').all(issue.id)) as Array<{ status_id: string }>;
    expect(rows).toHaveLength(3);
    expect(st.currentKey).toBe(todo.id);
    const todoTotal = st.totals.find((x) => x.key === todo.id)!;
    expect(todoTotal.visits).toBe(2);
    expect(todoTotal.ms).toBeGreaterThanOrEqual(72 * H - 5_000);
    expect(st.totals.find((x) => x.key === doing.id)?.name).toBe(doing.name);

    // Borrar el issue borra su historial.
    await db.prepare('DELETE FROM track_issues WHERE id = ?').run(issue.id);
    const left = (await db.prepare('SELECT COUNT(*) AS c FROM track_issue_status_log WHERE issue_id = ?').get(issue.id)) as { c: number };
    expect(Number(left.c)).toBe(0);
  });

  it('el backfill reconstruye los períodos desde la actividad', async () => {
    const { default: migration } = await import('@/lib/schema/migration-files/20261123_0228_track_status_time');
    const owner = await makeUser('sbf');
    const team = await createProject(owner.id, null, { name: 'Backfill' });
    const statuses = await listStatuses(team.id);
    const todo = statuses.find((s) => s.category === 'todo')!;
    const doing = statuses.find((s) => s.category === 'in_progress')!;
    const issue = await createIssue(team.id, owner.id, { title: 'Viejo', priority: 'low', description: [], statusId: todo.id });
    await updateIssue(issue.id, { statusId: doing.id }, owner.id);
    const db = getDb();
    // Como un issue de antes de la migración: sin historial ni status_changed_at.
    await db.prepare('DELETE FROM track_issue_status_log WHERE issue_id = ?').run(issue.id);
    await db.prepare("UPDATE track_issues SET status_changed_at = NULL, created_at = '2026-11-01 10:00:00' WHERE id = ?").run(issue.id);
    await db.prepare("UPDATE track_issue_activities SET created_at = '2026-11-05 10:00:00' WHERE issue_id = ? AND type = 'status_change'").run(issue.id);
    const { getClient } = await import('@/lib/db');
    await migration.up(getClient());
    await migration.up(getClient());
    const log = (await db
      .prepare('SELECT status_id, entered_at FROM track_issue_status_log WHERE issue_id = ? ORDER BY entered_at')
      .all(issue.id)) as Array<{ status_id: string; entered_at: string }>;
    expect(log.map((l) => l.status_id)).toEqual([todo.id, doing.id]);
    expect(log[0].entered_at).toBe('2026-11-01T10:00:00.000Z');
    expect(log[1].entered_at).toBe('2026-11-05T10:00:00.000Z');
    expect((await getIssue(issue.id))!.status_changed_at).toBe('2026-11-05T10:00:00.000Z');
  });
});
