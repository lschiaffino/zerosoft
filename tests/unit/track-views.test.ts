import { describe, expect, it } from 'vitest';
import {
  escapeLike,
  groupIssues,
  groupPreset,
  issueOrderBy,
  parseIssueGroup,
  parseIssueSort,
  STATUS_NAME_KEY,
} from '@/lib/track-views';

const issue = (over: Record<string, unknown>) =>
  ({
    id: crypto.randomUUID(),
    project_id: 'p1',
    status_id: null,
    status_name: null,
    status_color: null,
    status_category: null,
    priority: 'medium',
    assignee_id: null,
    assignee_name: null,
    assignee_email: null,
    cycle_id: null,
    cycle_name: null,
    labels: '[]',
    ...over,
  }) as Parameters<typeof groupIssues>[0][number];

describe('track-views', () => {
  it('escapeLike escapa comodines y la barra', () => {
    expect(escapeLike('100%_a\\b')).toBe('100\\%\\_a\\\\b');
  });

  it('parsea orden y agrupado con valores por defecto', () => {
    expect(parseIssueSort('due')).toBe('due');
    expect(parseIssueSort('drop table')).toBe('newest');
    expect(parseIssueGroup('label')).toBe('label');
    expect(parseIssueGroup('x')).toBe('none');
    expect(parseIssueGroup('none', ['status', 'priority'])).toBe('status');
    expect(issueOrderBy('due')).toMatch(/^i\.due_date IS NULL, i\.due_date ASC/);
  });

  it('agrupa por prioridad en orden y deja "sin valor" al final', () => {
    const list = [issue({ priority: 'low' }), issue({ priority: 'urgent' }), issue({ priority: 'low' })];
    const groups = groupIssues(list, 'priority');
    expect(groups.map((g) => [g.key, g.issues.length])).toEqual([
      ['urgent', 1],
      ['low', 2],
    ]);
    expect(groupIssues(list, 'priority', { includeEmpty: true }).map((g) => g.key)).toEqual([
      'urgent',
      'high',
      'medium',
      'low',
    ]);

    const byAssignee = groupIssues(
      [issue({}), issue({ assignee_id: 'u2', assignee_name: 'Zoe' }), issue({ assignee_id: 'u1', assignee_name: 'Ana' })],
      'assignee',
    );
    expect(byAssignee.map((g) => g.key)).toEqual(['u1', 'u2', '']);
  });

  it('por label un issue aparece en cada label; sin labels va a su grupo', () => {
    const labels = JSON.stringify([
      { id: 'l1', name: 'bug', color: '#f00' },
      { id: 'l2', name: 'api', color: '#00f' },
    ]);
    const groups = groupIssues([issue({ labels }), issue({})], 'label');
    expect(groups.map((g) => [g.name, g.issues.length])).toEqual([
      ['api', 1],
      ['bug', 1],
      ['', 1],
    ]);
  });

  it('por status sigue el orden del proyecto o junta por nombre entre proyectos', () => {
    const statuses = [
      { id: 's1', name: 'Todo', color: '#000', category: 'todo' },
      { id: 's2', name: 'Done', color: '#000', category: 'done' },
    ];
    const list = [issue({ status_id: 's2', status_name: 'Done', status_category: 'done' })];
    expect(groupIssues(list, 'status', { statuses, includeEmpty: true }).map((g) => g.key)).toEqual(['s1', 's2']);

    const cross = groupIssues(
      [
        issue({ status_id: 'a2', status_name: 'Done', status_category: 'done' }),
        issue({ status_id: 'a1', status_name: 'Todo', status_category: 'todo' }),
        issue({ status_id: 'b1', status_name: 'Todo', status_category: 'todo', project_id: 'p2' }),
      ],
      'status',
      { statusByName: true },
    );
    expect(cross.map((g) => [g.key, g.issues.length])).toEqual([
      [`${STATUS_NAME_KEY}Todo`, 2],
      [`${STATUS_NAME_KEY}Done`, 1],
    ]);
  });

  it('groupPreset da el valor asignable de cada grupo', () => {
    expect(groupPreset('status', 's1')).toEqual({ statusId: 's1' });
    expect(groupPreset('status', `${STATUS_NAME_KEY}Todo`)).toBeNull();
    expect(groupPreset('priority', 'high')).toEqual({ priority: 'high' });
    expect(groupPreset('assignee', '')).toEqual({ assigneeId: null });
    expect(groupPreset('cycle', 'c1')).toEqual({ cycleId: 'c1' });
    expect(groupPreset('cycle', 'c1', { movable: true })).toBeNull();
    expect(groupPreset('label', 'l1')).toBeNull();
  });
});
