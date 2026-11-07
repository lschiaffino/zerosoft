import { describe, expect, it } from 'vitest';
import {
  canonicalStatuses,
  expandStatusFilter,
  filterCompleted,
  listQuery,
  parseListPrefs,
  remapToCanonical,
  statusForTeam,
  type ListPrefs,
} from '@/lib/track-issue-list';
import { EMPTY_FILTERS, filterToSql } from '@/lib/track-filter';
import { compareIssues, groupIssues, groupPreset, issueOrderBy, PLAN_ISSUE_GROUPS, STATUS_NAME_KEY } from '@/lib/track-views';
import { planProgressSeries, sortPlans } from '@/lib/track-plan-metrics';

const statuses = [
  { id: 'a-todo', name: 'Todo', category: 'todo', color: '#000', position: 1 },
  { id: 'a-done', name: 'Done', category: 'done', color: '#000', position: 2 },
  { id: 'b-todo', name: 'Todo', category: 'todo', color: '#000', position: 1 },
  { id: 'b-prog', name: 'In Progress', category: 'in_progress', color: '#000', position: 2 },
];

const fallback: ListPrefs = {
  filters: EMPTY_FILTERS,
  group: 'status',
  sort: 'manual',
  layout: 'list',
  showSub: true,
  completed: 'all',
  emptyGroups: false,
  props: ['id'],
};

describe('lista de issues compartida', () => {
  it('arma la query del alcance con filtros y orden', () => {
    const q = new URLSearchParams(listQuery({ planId: 'p1' }, { match: 'and', rules: [{ field: 'priority', op: 'is', values: ['high'] }], q: 'x' }, 'priority', '2026-11-07'));
    expect(q.get('planId')).toBe('p1');
    expect(q.get('sort')).toBe('priority');
    expect(q.get('q')).toBe('x');
    expect(JSON.parse(q.get('filter')!).rules[0].field).toBe('priority');
    expect(new URLSearchParams(listQuery({ mine: 'created' }, EMPTY_FILTERS, 'manual', '2026-11-07')).get('mine')).toBe('created');
  });

  it('valida las preferencias guardadas contra la vista', () => {
    const p = parseListPrefs({ group: 'planMilestone', sort: 'estimate', layout: 'board', completed: 'week', props: ['id', 'nope'] }, fallback, PLAN_ISSUE_GROUPS);
    expect(p).toMatchObject({ group: 'planMilestone', sort: 'estimate', layout: 'board', completed: 'week', props: ['id'] });
    expect(parseListPrefs({ group: 'cycle', sort: 'bogus' }, fallback, PLAN_ISSUE_GROUPS)).toMatchObject({ group: 'status', sort: 'manual' });
    expect(parseListPrefs('nada', fallback, PLAN_ISSUE_GROUPS)).toBe(fallback);
  });

  it('junta los status de varios teams por nombre', () => {
    const canon = canonicalStatuses(statuses);
    expect(canon.map((s) => s.name)).toEqual(['Todo', 'In Progress', 'Done']);
    const rules = expandStatusFilter([{ field: 'status', op: 'is', values: ['a-todo'] }], statuses);
    expect(rules[0].values.sort()).toEqual(['a-todo', 'b-todo']);
    expect(statusForTeam(statuses.slice(2), 'todo')).toBe('b-todo');
    const [i] = remapToCanonical([{ id: '1', status_id: 'b-todo', status_name: 'Todo' }], canon);
    expect(i.status_id).toBe('a-todo');
  });

  it('completados: todos, última semana o ninguno', () => {
    const rows = [
      { id: 'open', status_category: 'todo', updated_at: '2026-01-01T00:00:00Z' },
      { id: 'old', status_category: 'done', updated_at: '2026-10-01T00:00:00Z' },
      { id: 'new', status_category: 'cancelled', updated_at: '2026-11-05T00:00:00Z' },
    ];
    expect(filterCompleted(rows, 'all', '2026-11-07').map((r) => r.id)).toEqual(['open', 'old', 'new']);
    expect(filterCompleted(rows, 'week', '2026-11-07').map((r) => r.id)).toEqual(['open', 'new']);
    expect(filterCompleted(rows, 'none', '2026-11-07').map((r) => r.id)).toEqual(['open']);
  });

  it('agrupa por milestone del project en su orden y el "+" lleva el milestone', () => {
    const base = { project_id: 't', status_id: null, status_name: null, status_color: null, status_category: null, priority: 'none' as const, assignee_id: null, assignee_name: null, assignee_email: null, cycle_id: null, cycle_name: null, labels: '[]' };
    const issues = [
      { ...base, id: '1', plan_milestone_id: 'm2', plan_milestone_name: 'Beta' },
      { ...base, id: '2', plan_milestone_id: null, plan_milestone_name: null },
      { ...base, id: '3', plan_milestone_id: 'm1', plan_milestone_name: 'Alpha' },
    ];
    const ms = [
      { id: 'm2', name: 'Beta' },
      { id: 'm1', name: 'Alpha' },
      { id: 'm3', name: 'GA' },
    ];
    expect(groupIssues(issues, 'planMilestone', { milestones: ms }).map((g) => g.key)).toEqual(['m2', 'm1', '']);
    expect(groupIssues(issues, 'planMilestone', { milestones: ms, includeEmpty: true }).map((g) => g.key)).toEqual(['m2', 'm1', 'm3', '']);
    expect(groupPreset('planMilestone', 'm1')).toEqual({ planMilestoneId: 'm1' });
    expect(groupPreset('planMilestone', '')).toEqual({ planMilestoneId: null });
    expect(groupPreset('status', `${STATUS_NAME_KEY}Todo`)).toEqual({ statusName: 'Todo' });
    expect(groupPreset('status', `${STATUS_NAME_KEY}Todo`, { movable: true })).toBeNull();
  });

  it('ordena por estimación (sin estimación al final)', () => {
    const mk = (id: string, estimate: number | null) => ({ id, estimate, created_at: '2026-01-01', updated_at: '2026-01-01', priority: 'none' as const, due_date: null, identifier: id });
    const list = [mk('a', null), mk('b', 1), mk('c', 5)].sort((x, y) => compareIssues('estimate', x, y));
    expect(list.map((i) => i.id)).toEqual(['c', 'b', 'a']);
    expect(issueOrderBy('estimate')).toContain('i.estimate IS NULL');
  });

  it('filtra por team y por project; en un project "Milestone" usa el milestone del project', () => {
    const sql = filterToSql({ match: 'and', rules: [{ field: 'team', op: 'is', values: ['t1'] }, { field: 'project', op: 'is', values: ['__none__'] }] }, '2026-11-07');
    expect(sql!.sql).toContain('i.project_id IN');
    expect(sql!.sql).toContain('i.plan_id IS NULL');
    const ms = filterToSql({ match: 'and', rules: [{ field: 'milestone', op: 'is', values: ['m1'] }] }, '2026-11-07', { milestoneColumn: 'i.plan_milestone_id' });
    expect(ms!.sql).toContain('i.plan_milestone_id');
  });
});

describe('projects: orden de la lista y gráfico de progreso', () => {
  const plan = (name: string, target: string | null, percent: number, created: string) => ({ name, target_date: target, created_at: created, progress: { percent } });

  it('ordena por nombre, fecha objetivo (sin fecha al final) y progreso', () => {
    const rows = [plan('B', null, 10, '2026-01-02'), plan('A', '2026-12-01', 80, '2026-01-01'), plan('C', '2026-11-20', 50, '2026-01-03')];
    expect(sortPlans(rows, 'manual')).toBe(rows);
    expect(sortPlans(rows, 'name').map((p) => p.name)).toEqual(['A', 'B', 'C']);
    expect(sortPlans(rows, 'target').map((p) => p.name)).toEqual(['C', 'A', 'B']);
    expect(sortPlans(rows, 'progress').map((p) => p.name)).toEqual(['A', 'C', 'B']);
    expect(sortPlans(rows, 'created').map((p) => p.name)).toEqual(['C', 'B', 'A']);
  });

  it('alcance contra terminado por día, desde el inicio del project hasta hoy', () => {
    const s = planProgressSeries({
      startDate: '2026-11-01',
      targetDate: '2026-12-01',
      createdAt: '2026-10-20T00:00:00Z',
      today: '2026-11-04',
      issues: [
        { id: '1', estimate: null, created_at: '2026-11-01T10:00:00Z', category: 'done', statusChanges: [{ at: '2026-11-03T09:00:00Z', from: 'todo', to: 'done' }] },
        { id: '2', estimate: null, created_at: '2026-11-02T10:00:00Z', category: 'todo', statusChanges: [] },
        { id: '3', estimate: null, created_at: '2026-11-02T11:00:00Z', category: 'cancelled', statusChanges: [] },
      ],
    });
    expect(s.start).toBe('2026-11-01');
    expect(s.points.map((p) => p.day)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
    expect(s.points.map((p) => p.scope)).toEqual([1, 2, 2, 2]);
    expect(s.points.map((p) => p.completed)).toEqual([0, 0, 1, 1]);
    expect(planProgressSeries({ startDate: null, targetDate: null, createdAt: '2026-11-01', today: '2026-11-04', issues: [] }).points).toEqual([]);
  });
});
