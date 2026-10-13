import { describe, expect, it } from 'vitest';
import {
  addDays,
  applyIssuePatch,
  dueBucket,
  findDoneStatus,
  findOpenStatus,
  formatDay,
  groupByDue,
  parseQuickTitle,
  toggleDoneStatus,
  toIsoDay,
} from '@/lib/track-tasks';
import {
  createIssue,
  createProject,
  listMyIssues,
  listProjectMetas,
  listStatuses,
  updateIssue,
  type TrackIssueWithStatus,
} from '@/lib/track-data';
import { makeUser } from './helpers';

const statuses = [
  { id: 'c', name: 'Cancelled', color: '#999', category: 'cancelled' as const, position: 4 },
  { id: 'd', name: 'Done', color: '#000', category: 'done' as const, position: 3 },
  { id: 'b', name: 'Backlog', color: '#666', category: 'backlog' as const, position: 0 },
  { id: 't', name: 'Todo', color: '#111', category: 'todo' as const, position: 1 },
  { id: 'p', name: 'In progress', color: '#222', category: 'in_progress' as const, position: 2 },
];

function fakeIssue(over: Partial<TrackIssueWithStatus> = {}): TrackIssueWithStatus {
  return {
    id: 'i1',
    project_id: 'p1',
    identifier: 'P-1',
    title: 'Hello',
    description: '[]',
    status_id: 't',
    priority: 'medium',
    assignee_id: null,
    creator_id: 'u',
    cycle_id: null,
    estimate: null,
    parent_id: null,
    start_date: null,
    due_date: null,
    labels: '[]',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    status_name: 'Todo',
    status_color: '#111',
    status_category: 'todo',
    assignee_name: null,
    assignee_email: null,
    cycle_name: null,
    child_count: 0,
    ...over,
  };
}

describe('track-tasks: tildar como hecha', () => {
  it('elige el primer status done por posición', () => {
    expect(findDoneStatus(statuses)?.id).toBe('d');
  });

  it('al destildar vuelve al primer todo, si no backlog, si no cualquier abierto', () => {
    expect(findOpenStatus(statuses)?.id).toBe('t');
    expect(findOpenStatus(statuses.filter((s) => s.category !== 'todo'))?.id).toBe('b');
    expect(findOpenStatus(statuses.filter((s) => s.id === 'p' || s.id === 'd'))?.id).toBe('p');
  });

  it('toggleDoneStatus alterna según la categoría actual', () => {
    expect(toggleDoneStatus('todo', statuses)?.id).toBe('d');
    expect(toggleDoneStatus('in_progress', statuses)?.id).toBe('d');
    expect(toggleDoneStatus('done', statuses)?.id).toBe('t');
    expect(toggleDoneStatus('cancelled', statuses)?.id).toBe('t');
    expect(toggleDoneStatus('todo', statuses.filter((s) => s.category !== 'done'))).toBeUndefined();
  });
});

describe('track-tasks: applyIssuePatch', () => {
  it('resuelve status y asignado y no muta el original', () => {
    const issue = fakeIssue();
    const next = applyIssuePatch(
      issue,
      { statusId: 'd', assigneeId: 'm1', priority: 'urgent', dueDate: '2026-10-20' },
      statuses,
      [{ id: 'm1', name: 'Ana', email: 'ana@x.com' }],
    );
    expect(next).toMatchObject({
      status_id: 'd',
      status_name: 'Done',
      status_category: 'done',
      assignee_id: 'm1',
      assignee_name: 'Ana',
      assignee_email: 'ana@x.com',
      priority: 'urgent',
      due_date: '2026-10-20',
    });
    expect(issue.status_id).toBe('t');
  });

  it('null limpia asignado y fecha', () => {
    const next = applyIssuePatch(
      fakeIssue({ assignee_id: 'm1', assignee_name: 'Ana', due_date: '2026-01-02' }),
      { assigneeId: null, dueDate: null },
    );
    expect(next.assignee_id).toBeNull();
    expect(next.assignee_name).toBeNull();
    expect(next.due_date).toBeNull();
  });
});

describe('track-tasks: fechas y agrupación', () => {
  it('toIsoDay usa la fecha local y addDays cruza meses/años', () => {
    expect(toIsoDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('formatDay no se corre de día y omite el año si es el actual', () => {
    expect(formatDay('2026-10-14', 'en', '2026-10-13')).toBe('Oct 14');
    expect(formatDay('2027-01-02', 'en', '2026-10-13')).toBe('Jan 2, 2027');
    expect(formatDay('2026-10-14T23:00', 'es', '2026-10-13')).toMatch(/14/);
  });

  it('dueBucket clasifica respecto de hoy (acepta fecha con hora)', () => {
    const today = '2026-10-13';
    expect(dueBucket(null, today)).toBe('none');
    expect(dueBucket('2026-10-12', today)).toBe('overdue');
    expect(dueBucket('2026-10-13T10:00', today)).toBe('today');
    expect(dueBucket('2026-11-01', today)).toBe('upcoming');
  });

  it('groupByDue agrupa y ordena por fecha y prioridad', () => {
    const today = '2026-10-13';
    const g = groupByDue(
      [
        fakeIssue({ id: 'a', due_date: '2026-10-20', priority: 'low' }),
        fakeIssue({ id: 'b', due_date: null }),
        fakeIssue({ id: 'c', due_date: '2026-10-01' }),
        fakeIssue({ id: 'd', due_date: '2026-10-13' }),
        fakeIssue({ id: 'e', due_date: '2026-10-20', priority: 'urgent' }),
        fakeIssue({ id: 'f', due_date: '2026-10-15' }),
      ],
      today,
    );
    expect(g.overdue.map((i) => i.id)).toEqual(['c']);
    expect(g.today.map((i) => i.id)).toEqual(['d']);
    expect(g.upcoming.map((i) => i.id)).toEqual(['f', 'e', 'a']);
    expect(g.none.map((i) => i.id)).toEqual(['b']);
  });
});

describe('track-tasks: parseQuickTitle', () => {
  const today = '2026-10-13';

  it('extrae prioridad y vencimiento', () => {
    expect(parseQuickTitle('Fix login !high @tomorrow', today)).toEqual({
      title: 'Fix login',
      priority: 'high',
      dueDate: '2026-10-14',
    });
    expect(parseQuickTitle('Llamar a Ana !1 @hoy', today)).toEqual({
      title: 'Llamar a Ana',
      priority: 'urgent',
      dueDate: today,
    });
    expect(parseQuickTitle('Deploy @2026-11-02', today)).toEqual({ title: 'Deploy', dueDate: '2026-11-02' });
  });

  it('deja intactos los tokens desconocidos', () => {
    expect(parseQuickTitle('Ping @juan about !wow', today)).toEqual({ title: 'Ping @juan about !wow' });
    expect(parseQuickTitle('  spaced   out  ', today)).toEqual({ title: 'spaced out' });
  });
});

describe('track-data: My tasks y metas de proyecto', () => {
  it('listMyIssues trae solo lo asignado y abierto, ordenado por vencimiento', async () => {
    const a = await makeUser('a');
    const b = await makeUser('b');
    const p = await createProject(a.id, null, { name: 'Mine' });
    const st = await listStatuses(p.id);
    const done = st.find((s) => s.category === 'done')!;

    const late = await createIssue(p.id, a.id, { title: 'late', assigneeId: a.id, dueDate: '2026-01-01' });
    const nodate = await createIssue(p.id, a.id, { title: 'nodate', assigneeId: a.id });
    const soon = await createIssue(p.id, a.id, { title: 'soon', assigneeId: a.id, dueDate: '2026-02-01' });
    const closed = await createIssue(p.id, a.id, { title: 'closed', assigneeId: a.id });
    await updateIssue(closed.id, { statusId: done.id });
    await createIssue(p.id, a.id, { title: 'unassigned' });

    const mine = await listMyIssues(null, a.id, a.id);
    expect(mine.map((i) => i.id)).toEqual([late.id, soon.id, nodate.id]);

    const withClosed = await listMyIssues(null, a.id, a.id, { includeCompleted: true });
    expect(withClosed.map((i) => i.id)).toContain(closed.id);

    // b no ve los proyectos de a aunque se filtre por su id
    expect(await listMyIssues(null, b.id, a.id)).toHaveLength(0);
  });

  it('createIssue en paralelo no choca con el identificador único', async () => {
    const a = await makeUser('a');
    const p = await createProject(a.id, null, { name: 'Burst' });
    const created = await Promise.all(
      Array.from({ length: 6 }, (_, n) => createIssue(p.id, a.id, { title: `t${n}` })),
    );
    expect(new Set(created.map((i) => i.identifier)).size).toBe(6);
  });

  it('listProjectMetas devuelve status ordenados y miembros por proyecto', async () => {
    const a = await makeUser('a');
    await createProject(a.id, null, { name: 'Zeta' });
    await createProject(a.id, null, { name: 'Alfa' });
    const metas = await listProjectMetas(null, a.id);
    expect(metas.map((m) => m.name)).toEqual(['Alfa', 'Zeta']);
    expect(metas[0].statuses.map((s) => s.category)).toEqual(['backlog', 'todo', 'in_progress', 'done', 'cancelled']);
    expect(metas[0].members.map((m) => m.id)).toEqual([a.id]);

    const other = await makeUser('b');
    expect(await listProjectMetas(null, other.id)).toHaveLength(0);
  });
});
