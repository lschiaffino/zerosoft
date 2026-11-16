import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import {
  addDays,
  billableCents,
  cellPlan,
  entriesCsv,
  formatMinutes,
  isIsoDate,
  liveMinutes,
  monthRange,
  parseDuration,
  summarize,
  weekDays,
  weekStart,
  weekRows,
  TimeError,
  type ReportEntry,
} from '@/lib/time/types';
import {
  createClient,
  createEntry,
  createProject,
  createTask,
  deleteEntry,
  deleteProject,
  deleteTask,
  ensureDefaultTasks,
  getEntry,
  listMyEntries,
  listProjects,
  listTasks,
  recentWeekRows,
  reportEntries,
  searchTime,
  stopRunning,
  updateEntry,
  updateProject,
} from '@/lib/time/core';
import { timeActorOf } from '@/lib/time/http';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

describe('Time: reglas puras', () => {
  it('entiende las duraciones como Harvest', () => {
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('1.5')).toBe(90);
    expect(parseDuration('1,5')).toBe(90);
    expect(parseDuration('90m')).toBe(90);
    expect(parseDuration('2h')).toBe(120);
    expect(parseDuration('1h 30m')).toBe(90);
    expect(parseDuration('0:05')).toBe(5);
    expect(parseDuration('24')).toBe(1440);
    expect(parseDuration('25')).toBeNull();
    expect(parseDuration('1:75')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('-1')).toBeNull();
  });

  it('formatea minutos como h:mm', () => {
    expect(formatMinutes(0)).toBe('0:00');
    expect(formatMinutes(90)).toBe('1:30');
    expect(formatMinutes(605)).toBe('10:05');
  });

  it('arma la semana de lunes a domingo y el mes', () => {
    expect(weekStart('2026-11-15')).toBe('2026-11-09'); // domingo
    expect(weekStart('2026-11-09')).toBe('2026-11-09'); // lunes
    expect(weekDays('2026-11-11')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(monthRange('2024-02-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-02-28')).toBe(true);
  });

  it('cuenta el cronómetro hasta ahora, con tope de 24 horas', () => {
    const start = Date.parse('2026-01-01T10:00:00Z');
    expect(liveMinutes({ minutes: 10, timerStartedAt: null }, start)).toBe(10);
    expect(liveMinutes({ minutes: 10, timerStartedAt: '2026-01-01T10:00:00Z' }, start + 5 * 60_000 + 59_000)).toBe(15);
    expect(liveMinutes({ minutes: 0, timerStartedAt: '2026-01-01T10:00:00Z' }, start + 30 * 3600_000)).toBe(1440);
  });

  it('agrupa y calcula el monto solo de lo facturable', () => {
    const base: Omit<ReportEntry, 'id' | 'minutes' | 'billable' | 'projectId' | 'projectName'> = {
      date: '2026-11-10',
      personId: 'p1',
      personName: 'Ana',
      clientId: 'c1',
      clientName: 'Acme',
      taskId: 't1',
      taskName: 'Design',
      notes: '',
      rateCents: 8000,
    };
    const entries: ReportEntry[] = [
      { ...base, id: 'a', projectId: 'x', projectName: 'Web', minutes: 90, billable: true },
      { ...base, id: 'b', projectId: 'x', projectName: 'Web', minutes: 30, billable: false },
      { ...base, id: 'c', projectId: 'y', projectName: 'App', minutes: 60, billable: true, rateCents: null },
    ];
    const { rows, totals } = summarize(entries, 'project');
    expect(rows.map((r) => [r.label, r.minutes, r.billableMinutes, r.amountCents])).toEqual([
      ['Web', 120, 90, 12000],
      ['App', 60, 60, 0],
    ]);
    expect(totals).toEqual({ minutes: 180, billableMinutes: 150, amountCents: 12000 });
    expect(summarize(entries, 'client').rows).toHaveLength(1);
    expect(billableCents(45, 10000)).toBe(7500);
  });

  it('arma las filas de la semana por proyecto y tarea, con las agregadas a mano al final', () => {
    const days = weekDays('2026-11-11');
    const e = (id: string, date: string, projectId: string, taskId: string, minutes = 60) => ({ id, date, projectId, taskId, notes: '', minutes, timerStartedAt: null });
    const rows = weekRows(
      [e('a', '2026-11-10', 'p1', 't1'), e('b', '2026-11-10', 'p1', 't1', 30), e('c', '2026-11-12', 'p2', 't1'), e('old', '2026-11-02', 'p3', 't1')],
      days,
      [{ projectId: 'p2', taskId: 't1' }, { projectId: 'p4', taskId: 't2' }],
    );
    expect(rows.map((r) => r.key)).toEqual(['p1|t1', 'p2|t1', 'p4|t2']);
    expect(rows[0].cells['2026-11-10'].map((x) => x.id)).toEqual(['a', 'b']);
    expect(Object.keys(rows[2].cells)).toEqual(days);
    expect(rows[2].cells['2026-11-09']).toEqual([]);
  });

  it('decide qué hace una celda editada', () => {
    const one = { id: 'a', date: '2026-11-10', projectId: 'p', taskId: 't', notes: '', minutes: 60, timerStartedAt: null };
    expect(cellPlan([], null)).toEqual({ kind: 'none' });
    expect(cellPlan([], 0)).toEqual({ kind: 'none' });
    expect(cellPlan([], 90)).toEqual({ kind: 'create', minutes: 90 });
    expect(cellPlan([one], 60)).toEqual({ kind: 'none' });
    expect(cellPlan([one], 30)).toEqual({ kind: 'update', id: 'a', minutes: 30 });
    expect(cellPlan([one], null)).toEqual({ kind: 'delete', id: 'a' });
    // Con notas, vaciarla deja la entrada en 0 en lugar de borrar lo escrito.
    expect(cellPlan([{ ...one, notes: 'llamada' }], null)).toEqual({ kind: 'update', id: 'a', minutes: 0 });
    expect(cellPlan([one, { ...one, id: 'b' }], 30)).toEqual({ kind: 'locked' });
    expect(cellPlan([{ ...one, timerStartedAt: '2026-11-10T10:00:00Z' }], 30)).toEqual({ kind: 'locked' });
  });

  it('el CSV escapa comas y neutraliza fórmulas', () => {
    const csv = entriesCsv(
      [{ id: 'a', date: '2026-11-10', personId: 'p', personName: 'Ana', projectId: 'x', projectName: 'Web, v2', clientId: null, clientName: null, taskId: 't', taskName: '=cmd()', notes: 'say "hi"', minutes: 90, billable: true, rateCents: 1000 }],
      { date: 'Date', person: 'Person', client: 'Client', project: 'Project', task: 'Task', notes: 'Notes', hours: 'Hours', billable: 'Billable', amount: 'Amount' },
      'Yes',
      'No',
    );
    const line = csv.split('\r\n')[1];
    expect(line).toBe(`2026-11-10,Ana,,"Web, v2",'=cmd(),"say ""hi""",1.50,Yes,15.00`);
  });
});

describe('Time: datos y permisos', () => {
  async function setup(label: string) {
    const w = await workspaceWithMember(label);
    const owner = timeActorOf(asOwner(w.owner));
    const member = timeActorOf(asMember(w.owner, w.member));
    const friend = timeActorOf(asMember(w.owner, w.friend));
    const stranger = timeActorOf(asOwner(w.stranger));
    await ensureDefaultTasks(owner.ws, 'es');
    const tasks = await listTasks(owner);
    const project = await createProject(owner, { name: 'Web', rateCents: 10000, budgetMinutes: 600 });
    return { w, owner, member, friend, stranger, tasks, project };
  }

  it('crea las tareas por defecto una sola vez, en el idioma pedido', async () => {
    const { owner, tasks } = await setup('time-tasks');
    expect(tasks.map((t) => t.name)).toContain('Desarrollo');
    await Promise.all([ensureDefaultTasks(owner.ws, 'en'), ensureDefaultTasks(owner.ws, 'en')]);
    expect(await listTasks(owner)).toHaveLength(5);
    expect(tasks.find((t) => t.name === 'Administración')?.billable).toBe(false);
  });

  it('solo quien administra maneja proyectos, clientes y tareas', async () => {
    const { member, project } = await setup('time-admin');
    await expect(createProject(member, { name: 'X' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(updateProject(member, project.id, { name: 'X' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(deleteProject(member, project.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(createClient(member, 'Acme')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(createTask(member, { name: 'QA' })).rejects.toMatchObject({ code: 'forbidden' });
    // Pero ve los proyectos para cargar horas.
    expect((await listProjects(member)).map((p) => p.id)).toContain(project.id);
  });

  it('cada persona ve, edita y borra solo sus entradas', async () => {
    const { member, friend, owner, tasks, project } = await setup('time-own');
    const e = await createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: tasks[0].id, minutes: 90, notes: 'hola' });
    expect(await listMyEntries(friend, '2026-11-09', '2026-11-15')).toHaveLength(0);
    expect(await getEntry(owner, e.id)).toBeNull();
    await expect(updateEntry(friend, e.id, { minutes: 1 })).rejects.toMatchObject({ code: 'not_found' });
    await expect(deleteEntry(owner, e.id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await listMyEntries(member, '2026-11-09', '2026-11-15')).map((x) => x.minutes)).toEqual([90]);
  });

  it('nada se filtra a otro workspace', async () => {
    const { member, stranger, tasks, project } = await setup('time-ws');
    const e = await createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: tasks[0].id, minutes: 60 });
    expect(await listProjects(stranger)).toHaveLength(0);
    expect(await searchTime(stranger, 'Web')).toHaveLength(0);
    expect(await reportEntries(stranger, { from: '2026-01-01', to: '2026-12-31' })).toHaveLength(0);
    // Un id de otro workspace no sirve para cargar horas ni para editar.
    await ensureDefaultTasks(stranger.ws, 'en');
    const strangerTask = (await listTasks(stranger))[0];
    await expect(createEntry(stranger, { date: '2026-11-10', projectId: project.id, taskId: strangerTask.id, minutes: 5 })).rejects.toMatchObject({ code: 'not_found' });
    await expect(updateProject(stranger, project.id, { name: 'X' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(updateEntry(stranger, e.id, { minutes: 1 })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('copia las filas de la última semana con horas de la persona, sin archivados', async () => {
    const { member, friend, owner, tasks, project } = await setup('time-copy-rows');
    const other = await createProject(owner, { name: 'Viejo' });
    expect(await recentWeekRows(member, '2026-11-16')).toEqual({ week: null, rows: [] });
    // Dos semanas atrás y la última (lunes 9): copia la última.
    await createEntry(member, { date: '2026-10-27', projectId: project.id, taskId: tasks[2].id, minutes: 30 });
    await createEntry(member, { date: '2026-11-13', projectId: project.id, taskId: tasks[1].id, minutes: 30 });
    await createEntry(member, { date: '2026-11-10', projectId: other.id, taskId: tasks[0].id, minutes: 30 });
    await createEntry(member, { date: '2026-11-11', projectId: other.id, taskId: tasks[0].id, minutes: 15 });
    // Lo de la semana pedida no cuenta, ni lo de otra persona.
    await createEntry(member, { date: '2026-11-17', projectId: project.id, taskId: tasks[3].id, minutes: 30 });
    await createEntry(friend, { date: '2026-11-12', projectId: project.id, taskId: tasks[4].id, minutes: 30 });
    const got = await recentWeekRows(member, '2026-11-18');
    expect(got.week).toBe('2026-11-09');
    expect(got.rows).toEqual([
      { projectId: other.id, taskId: tasks[0].id },
      { projectId: project.id, taskId: tasks[1].id },
    ]);
    await updateProject(owner, other.id, { archived: true });
    expect((await recentWeekRows(member, '2026-11-18')).rows).toEqual([{ projectId: project.id, taskId: tasks[1].id }]);
    expect(await recentWeekRows(friend, '2026-11-09')).toEqual({ week: null, rows: [] });
    await expect(recentWeekRows(member, 'nope')).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('el reporte de un miembro trae solo sus horas; el del admin, las de todos', async () => {
    const { member, friend, owner, tasks, project } = await setup('time-report');
    const billableTask = tasks.find((t) => t.billable)!;
    await createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: billableTask.id, minutes: 60 });
    await createEntry(friend, { date: '2026-11-11', projectId: project.id, taskId: billableTask.id, minutes: 30 });
    expect((await reportEntries(member, { from: '2026-11-01', to: '2026-11-30' })).map((e) => e.minutes)).toEqual([60]);
    // personId de otra persona no le abre nada a un miembro.
    expect((await reportEntries(member, { from: '2026-11-01', to: '2026-11-30', personId: friend.person })).map((e) => e.minutes)).toEqual([60]);
    const all = await reportEntries(owner, { from: '2026-11-01', to: '2026-11-30' });
    expect(summarize(all, 'project').totals).toEqual({ minutes: 90, billableMinutes: 90, amountCents: 15000 });
  });

  it('un cronómetro por persona: arrancar otro para el primero', async () => {
    const { member, friend, tasks, project } = await setup('time-timer');
    const a = await createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: tasks[0].id, minutes: null });
    expect(a.timerStartedAt).not.toBeNull();
    const other = await createEntry(friend, { date: '2026-11-10', projectId: project.id, taskId: tasks[0].id, start: true });
    const b = await createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: tasks[1].id, start: true });
    expect((await getEntry(member, a.id))?.timerStartedAt).toBeNull();
    expect((await getEntry(member, b.id))?.timerStartedAt).not.toBeNull();
    // El de otra persona sigue corriendo.
    expect((await getEntry(friend, other.id))?.timerStartedAt).not.toBeNull();
    const stopped = await updateEntry(member, b.id, { running: false });
    expect(stopped.timerStartedAt).toBeNull();
    const restarted = await updateEntry(member, a.id, { running: true });
    expect(restarted.timerStartedAt).not.toBeNull();
    await stopRunning(member);
    expect((await getEntry(member, a.id))?.timerStartedAt).toBeNull();
  });

  it('las horas son facturables solo si el proyecto y la tarea lo son', async () => {
    const { owner, member, tasks, project } = await setup('time-billable');
    const nonBillableTask = tasks.find((t) => !t.billable)!;
    const billableTask = tasks.find((t) => t.billable)!;
    const internal = await createProject(owner, { name: 'Interno', billable: false });
    expect((await createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: billableTask.id, minutes: 10 })).billable).toBe(true);
    expect((await createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: nonBillableTask.id, minutes: 10 })).billable).toBe(false);
    expect((await createEntry(member, { date: '2026-11-10', projectId: internal.id, taskId: billableTask.id, minutes: 10 })).billable).toBe(false);
  });

  it('un proyecto archivado no recibe horas nuevas y una tarea con horas no se borra', async () => {
    const { owner, member, tasks, project } = await setup('time-archive');
    const e = await createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: tasks[0].id, minutes: 10 });
    await updateProject(owner, project.id, { archived: true });
    await expect(createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: tasks[0].id, minutes: 10 })).rejects.toMatchObject({ code: 'project_archived' });
    // La entrada vieja se sigue editando.
    expect((await updateEntry(member, e.id, { notes: 'ok' })).notes).toBe('ok');
    await expect(deleteTask(owner, tasks[0].id)).rejects.toMatchObject({ code: 'in_use' });
    await expect(createEntry(member, { date: '2026-11-10', projectId: project.id, taskId: tasks[0].id, minutes: 2000 })).rejects.toBeInstanceOf(TimeError);
    await deleteProject(owner, project.id);
    expect(await listMyEntries(member, '2026-11-01', '2026-11-30')).toHaveLength(0);
  });
});

describe('Time: rutas por rol', () => {
  it('anónimo, otro workspace, compañero y owner', async () => {
    const w = await workspaceWithMember('time-routes');
    const projects = await import('@/app/api/time/projects/route');
    const entries = await import('@/app/api/time/entries/route');
    const req = (url: string, body?: unknown) =>
      new NextRequest(`http://localhost${url}`, body ? { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : undefined);

    session.user = null;
    expect((await projects.GET(req('/api/time/projects'))).status).toBe(401);
    expect((await entries.POST(req('/api/time/entries', { date: '2026-11-10', projectId: 'x', taskId: 'y', minutes: 1 }))).status).toBe(401);

    session.user = asOwner(w.owner);
    const created = await projects.POST(req('/api/time/projects', { name: 'Desde la API' }));
    expect(created.status).toBe(201);
    const { project } = (await created.json()) as { project: { id: string } };

    session.user = asMember(w.owner, w.member);
    expect((await projects.POST(req('/api/time/projects', { name: 'No' }))).status).toBe(403);
    const list = (await (await projects.GET(req('/api/time/projects'))).json()) as { projects: Array<{ id: string }> };
    expect(list.projects.map((p) => p.id)).toContain(project.id);
    // Un miembro sin Time en sus apps no entra.
    session.user = asMember(w.owner, w.member, 'member', ['docs']);
    expect((await projects.GET(req('/api/time/projects'))).status).toBe(401);
    // Un guest tampoco.
    session.user = asMember(w.owner, w.friend, 'guest');
    expect((await projects.GET(req('/api/time/projects'))).status).toBe(401);

    session.user = asOwner(w.stranger);
    const theirs = (await (await projects.GET(req('/api/time/projects'))).json()) as { projects: Array<{ id: string }> };
    expect(theirs.projects).toHaveLength(0);
    expect((await entries.POST(req('/api/time/entries', { date: '2026-11-10', projectId: project.id, taskId: 'nope', minutes: 1 }))).status).toBe(404);
    const rows = await entries.GET(req('/api/time/entries?rowsBefore=2026-11-16'));
    expect(rows.status).toBe(200);
    expect(await rows.json()).toEqual({ week: null, rows: [] });
    expect((await entries.GET(req('/api/time/entries?rowsBefore=bad'))).status).toBe(400);
    session.user = null;
    expect((await entries.GET(req('/api/time/entries?rowsBefore=2026-11-16'))).status).toBe(401);
  });
});
