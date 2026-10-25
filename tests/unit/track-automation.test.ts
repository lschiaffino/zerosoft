import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCycle, createIssue, createProject, getIssue, listCycles, listStatuses, updateIssue } from '@/lib/track-data';
import { firstRunOn, localDayIn, localHourIn, nextOccurrence, nextRunAfter, planAutoCycles } from '@/lib/track-recurrence';
import { createRecurring, runRecurringIssues, updateRecurring, getRecurring } from '@/lib/track-recurring';
import { syncAutoCycles, runAutoCycles } from '@/lib/track-auto-cycles';
import { createMilestone, deleteMilestone, listMilestones } from '@/lib/track-milestones';
import { upcomingMilestone } from '@/lib/track-milestone-utils';
import {
  buildTrackEmail,
  digestDue,
  fireIssueReminders,
  getNotifyPrefs,
  IssueReminderError,
  sendImmediateTrackEmails,
  sendTrackDigests,
  setIssueReminder,
  setNotifyPrefs,
} from '@/lib/track-notify';
import { countUnreadNotifications, createNotification, listNotifications, snoozeNotification } from '@/lib/notifications';
import { snoozeAt } from '@/lib/track-snooze';
import { addDays } from '@/lib/track-tasks';
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
  after: (task: () => Promise<void>) => {
    void task().catch(() => {});
  },
}));
vi.mock('@/lib/events', () => ({ emitEvent: async () => {} }));
const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string; text: string }> }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: async (opts: { to: string; subject: string; text: string }) => {
    mail.sent.push(opts);
    return { ok: true };
  },
}));

const templatesRoute = await import('@/app/api/track/projects/[id]/templates/route');
const projectRoute = await import('@/app/api/track/projects/[id]/route');
const reminderRoute = await import('@/app/api/track/issues/[id]/reminder/route');
const notificationRoute = await import('@/app/api/notifications/[id]/route');

const req = (method: string, body?: unknown) =>
  new NextRequest('http://x/t', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function personal(label = 'own') {
  const owner = await makeUser(label);
  const project = await createProject(owner.id, null, { name: `P ${crypto.randomUUID().slice(0, 6)}` });
  session.user = { ...owner, team: null, role: 'owner' };
  return { owner, project };
}

const today = () => new Date().toISOString().slice(0, 10);

describe('Track: fechas de lo que se repite', () => {
  it('mensual conserva el día del ancla y cae en el último día de los meses cortos', () => {
    expect(nextOccurrence('2026-01-31', 'monthly', 1, '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence('2026-02-28', 'monthly', 1, '2026-01-31')).toBe('2026-03-31');
    expect(nextOccurrence('2026-11-15', 'monthly', 3, '2026-11-15')).toBe('2027-02-15');
  });

  it('anual con 29 de febrero, semanal y diario', () => {
    expect(nextOccurrence('2028-02-29', 'yearly', 1, '2028-02-29')).toBe('2029-02-28');
    expect(nextOccurrence('2029-02-28', 'yearly', 3, '2028-02-29')).toBe('2032-02-29');
    expect(nextOccurrence('2026-10-21', 'weekly', 2, '2026-10-21')).toBe('2026-11-04');
    expect(nextOccurrence('2026-10-21', 'daily', 1, '2026-10-21')).toBe('2026-10-22');
  });

  it('si el tick estuvo parado salta al futuro, y la primera corrida respeta el inicio', () => {
    expect(nextRunAfter('2026-10-01', '2026-10-21', 'weekly', 1, '2026-10-01')).toBe('2026-10-22');
    expect(firstRunOn('2026-11-01', '2026-10-21', 'monthly', 1)).toBe('2026-11-01');
    // Arrancó en el pasado: la próxima ocurrencia desde hoy (incluido).
    expect(firstRunOn('2026-10-14', '2026-10-21', 'weekly', 1)).toBe('2026-10-21');
    expect(firstRunOn('2026-10-15', '2026-10-21', 'weekly', 1)).toBe('2026-10-22');
  });

  it('día y hora locales por zona horaria', () => {
    const at = new Date('2026-10-21T02:30:00Z');
    expect(localDayIn('America/Argentina/Buenos_Aires', at)).toBe('2026-10-20');
    expect(localHourIn('America/Argentina/Buenos_Aires', at)).toBe(23);
    expect(localDayIn('nope/zone', at)).toBe('2026-10-21');
  });
});

describe('Track: plan de cycles automáticos', () => {
  it('sin cycles crea el actual desde hoy y el siguiente', () => {
    expect(planAutoCycles([], '2026-10-21', 2, 'Sprint')).toEqual([
      { name: 'Sprint 1', startAt: '2026-10-21', endAt: '2026-11-03' },
      { name: 'Sprint 2', startAt: '2026-11-04', endAt: '2026-11-17' },
    ]);
  });

  it('con uno en curso solo agrega el próximo, siguiendo la numeración', () => {
    const plan = planAutoCycles([{ name: 'Cycle 7', start_at: '2026-10-15', end_at: '2026-10-28' }], '2026-10-21', 1, '');
    expect(plan).toEqual([{ name: 'Cycle 8', startAt: '2026-10-29', endAt: '2026-11-04' }]);
  });

  it('si ya hay uno próximo, el actual termina antes de que empiece', () => {
    const plan = planAutoCycles([{ name: 'Ciclo 3', start_at: '2026-10-25', end_at: '2026-11-07' }], '2026-10-21', 2, 'Ciclo');
    expect(plan).toEqual([{ name: 'Ciclo 4', startAt: '2026-10-21', endAt: '2026-10-24' }]);
  });
});

describe('Track: cycles automáticos', () => {
  it('al activarlos se crean el actual y el próximo, solo admin', async () => {
    const { project, owner } = await personal();
    session.user = { ...owner, team: null, role: 'member' };
    expect((await projectRoute.PATCH(req('PATCH', { cycleAuto: true }), params(project.id))).status).toBe(403);
    session.user = { ...owner, team: null, role: 'owner' };
    const res = await projectRoute.PATCH(req('PATCH', { cycleAuto: true, cycleWeeks: 1, cycleName: 'Semana' }), params(project.id));
    expect(res.status).toBe(200);
    const cycles = await listCycles(project.id);
    expect(cycles.map((c) => c.name).sort()).toEqual(['Semana 1', 'Semana 2']);
  });

  it('lo sin terminar de un cycle vencido pasa al actual, una sola vez', async () => {
    const { project, owner } = await personal();
    const t = today();
    const old = await createCycle(project.id, { name: 'Cycle 1', startAt: addDays(t, -14), endAt: addDays(t, -1) });
    const statuses = await listStatuses(project.id);
    const done = statuses.find((s) => s.category === 'done')!;
    const open = await createIssue(project.id, owner.id, { title: 'Abierto', cycleId: old.id });
    const closed = await createIssue(project.id, owner.id, { title: 'Hecho', cycleId: old.id, statusId: done.id });
    await getDb().prepare('UPDATE track_projects SET cycle_auto = 1, cycle_weeks = 2 WHERE id = ?').run(project.id);
    const fresh = (await getDb().prepare('SELECT * FROM track_projects WHERE id = ?').get(project.id)) as never;
    const [a, b] = await Promise.all([syncAutoCycles(fresh, t), syncAutoCycles(fresh, t)]);
    expect(a.rolledOver + b.rolledOver).toBe(1);
    const cycles = await listCycles(project.id);
    const current = cycles.find((c) => c.start_at <= t && c.end_at >= t)!;
    expect(current.name).toBe('Cycle 2');
    expect((await getIssue(open.id))?.cycle_id).toBe(current.id);
    expect((await getIssue(closed.id))?.cycle_id).toBe(old.id);
    expect(cycles.find((c) => c.id === old.id)?.completed_at).toBeTruthy();
  });

  it('el tick revisa cada proyecto una vez por día', async () => {
    const { project } = await personal();
    await getDb().prepare('UPDATE track_projects SET cycle_auto = 1 WHERE id = ?').run(project.id);
    await runAutoCycles();
    const after = (await listCycles(project.id)).length;
    expect(after).toBe(2);
    await getDb().prepare('DELETE FROM track_cycles WHERE project_id = ?').run(project.id);
    await runAutoCycles();
    expect(await listCycles(project.id)).toHaveLength(0);
  });
});

describe('Track: issues que se repiten', () => {
  it('crea el issue el día que toca, una sola vez aunque corran dos ticks, y avanza', async () => {
    const { project, owner } = await personal();
    const t = today();
    const rule = await createRecurring(project, owner.id, {
      title: 'Revisión semanal',
      description: 'Mirar métricas',
      frequency: 'weekly',
      startOn: t,
      dueDays: 2,
      timezone: 'UTC',
      priority: 'high',
    });
    expect(rule.next_run_on).toBe(t);
    await Promise.all([runRecurringIssues(), runRecurringIssues()]);
    const issues = (await getDb()
      .prepare('SELECT * FROM track_issues WHERE project_id = ?')
      .all(project.id)) as Array<{ title: string; due_date: string; priority: string; source: string; triage: number }>;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ title: 'Revisión semanal', due_date: addDays(t, 2), priority: 'high', source: 'recurring', triage: 0 });
    const after = await getRecurring(rule.id);
    expect(after?.next_run_on).toBe(addDays(t, 7));
    expect(after?.last_issue_id).toBeTruthy();
    // Editar el título no reprograma: no se vuelve a crear hoy.
    await updateRecurring(project, after!, { title: 'Revisión', frequency: 'weekly', every: 1, startOn: t });
    expect((await getRecurring(rule.id))?.next_run_on).toBe(addDays(t, 7));
  });

  it('pausada no crea, y reanudar el mismo día no repite', async () => {
    const { project, owner } = await personal();
    const t = today();
    const rule = await createRecurring(project, owner.id, { title: 'Diario', frequency: 'daily', startOn: t, timezone: 'UTC' });
    await runRecurringIssues();
    const ran = (await getRecurring(rule.id))!;
    await updateRecurring(project, ran, { active: false });
    await updateRecurring(project, (await getRecurring(rule.id))!, { active: true });
    expect((await getRecurring(rule.id))?.next_run_on).toBe(addDays(t, 1));
    await runRecurringIssues();
    const count = (await getDb().prepare('SELECT COUNT(*) AS c FROM track_issues WHERE project_id = ?').get(project.id)) as { c: number };
    expect(count.c).toBe(1);
  });
});

describe('Track: plantillas', () => {
  it('crea con labels normalizados y rechaza un status de otro proyecto', async () => {
    const { project } = await personal();
    const other = await createProject(String(session.user!.id), null, { name: `Q ${crypto.randomUUID().slice(0, 6)}` });
    const foreign = (await listStatuses(other.id))[0];
    const bad = await templatesRoute.POST(req('POST', { name: 'Bug', statusId: foreign.id }), params(project.id));
    expect(bad.status).toBe(400);
    const res = await templatesRoute.POST(
      req('POST', { name: 'Bug', title: 'Bug: ', description: 'Pasos', priority: 'urgent', estimate: 3, labels: [{ name: 'bug' }] }),
      params(project.id),
    );
    expect(res.status).toBe(201);
    const tpl = (await res.json()) as { labels: string; priority: string; estimate: number };
    expect(JSON.parse(tpl.labels)[0].name).toBe('bug');
    expect(tpl).toMatchObject({ priority: 'urgent', estimate: 3 });
    const list = (await (await templatesRoute.GET(req('GET'), params(project.id))).json()) as { rows: unknown[] };
    expect(list.rows).toHaveLength(1);
  });
});

describe('Track: milestones', () => {
  it('progreso por issues asignados y borrar deja los issues sin milestone', async () => {
    const { project, owner } = await personal();
    const m = await createMilestone(project.id, { name: 'Beta', targetDate: addDays(today(), 10) });
    const done = (await listStatuses(project.id)).find((s) => s.category === 'done')!;
    const a = await createIssue(project.id, owner.id, { title: 'A', milestoneId: m.id });
    const b = await createIssue(project.id, owner.id, { title: 'B' });
    await updateIssue(b.id, { milestoneId: m.id, statusId: done.id }, owner.id);
    expect((await getIssue(a.id))?.milestone_name).toBe('Beta');
    const [row] = await listMilestones(project.id);
    expect(row).toMatchObject({ total: 2, done: 1 });
    expect(upcomingMilestone([row], today())?.id).toBe(m.id);
    await deleteMilestone(m.id);
    expect((await getIssue(a.id))?.milestone_id).toBeNull();
  });

  it('upcomingMilestone ignora los terminados y prefiere el de fecha próxima', () => {
    const list = [
      { id: 'a', target_date: '2026-01-01', total: 2, done: 2 },
      { id: 'b', target_date: '2026-01-05', total: 2, done: 1 },
      { id: 'c', target_date: '2026-12-01', total: 1, done: 0 },
    ];
    expect(upcomingMilestone(list, '2026-06-01')?.id).toBe('c');
    expect(upcomingMilestone(list.slice(0, 2), '2026-06-01')?.id).toBe('b');
  });
});

describe('Track: posponer y recordar', () => {
  it('los presets caen a las 9 de mañana y el lunes que viene', () => {
    const now = new Date(2026, 9, 21, 15, 30); // miércoles
    expect(snoozeAt('hour', now).getTime() - now.getTime()).toBe(3_600_000);
    const tomorrow = snoozeAt('tomorrow', now);
    expect([tomorrow.getDate(), tomorrow.getHours()]).toEqual([22, 9]);
    const monday = snoozeAt('nextWeek', now);
    expect([monday.getDay(), monday.getDate(), monday.getHours()]).toEqual([1, 26, 9]);
    expect(snoozeAt('nextWeek', new Date(2026, 9, 26, 8)).getDate()).toBe(2);
    // Domingo: mañana es lunes 26 y la semana que viene es el lunes 2.
    const sunday = new Date(2026, 9, 25, 11);
    expect(snoozeAt('tomorrow', sunday).getDate()).toBe(26);
    expect([snoozeAt('nextWeek', sunday).getMonth(), snoozeAt('nextWeek', sunday).getDate()]).toEqual([10, 2]);
  });

  it('un aviso pospuesto sale de la bandeja y del contador hasta que vence', async () => {
    const u = await makeUser('snz');
    const n = await createNotification({ userId: u.id, type: 'comment', title: 'x', sourceType: 'track_issue', sourceId: 'i1' });
    expect(await countUnreadNotifications(u.id)).toBe(1);
    session.user = { ...u, team: null, role: 'owner' };
    const later = new Date(Date.now() + 3_600_000).toISOString();
    expect((await notificationRoute.PATCH(req('PATCH', { snoozeUntil: later }), params(n.id))).status).toBe(200);
    expect(await countUnreadNotifications(u.id)).toBe(0);
    expect(await listNotifications(u.id)).toHaveLength(0);
    expect(await listNotifications(u.id, { snoozed: true })).toHaveLength(1);
    expect((await notificationRoute.PATCH(req('PATCH', { snoozeUntil: '2000-01-01T00:00:00Z' }), params(n.id))).status).toBe(400);
    // Otra persona no puede tocarlo.
    const other = await makeUser('oth');
    expect(await snoozeNotification(n.id, other.id, null)).toBe(false);
    await snoozeNotification(n.id, u.id, null);
    expect(await countUnreadNotifications(u.id)).toBe(1);
  });

  it('el recordatorio de un issue llega una vez a la bandeja de quien lo pidió', async () => {
    const { project, owner } = await personal('rem');
    const issue = await createIssue(project.id, owner.id, { title: 'Llamar' });
    const bad = await reminderRoute.PUT(req('PUT', { remindAt: '2000-01-01T00:00:00Z' }), params(issue.id));
    expect(bad.status).toBe(400);
    await expect(setIssueReminder(issue.id, owner.id, 'nope')).rejects.toBeInstanceOf(IssueReminderError);
    const at = new Date(Date.now() + 60_000).toISOString();
    expect((await reminderRoute.PUT(req('PUT', { remindAt: at }), params(issue.id))).status).toBe(200);
    expect(await fireIssueReminders()).toBe(0);
    const later = new Date(Date.now() + 120_000);
    const [x, y] = await Promise.all([fireIssueReminders({ now: later }), fireIssueReminders({ now: later })]);
    expect(x + y).toBe(1);
    const rows = await listNotifications(owner.id, { type: 'track_reminder' });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].meta).issueIdentifier).toBe(issue.identifier);
  });
});

describe('Track: avisos por email', () => {
  it('por defecto sin emails; los cambios se guardan por persona', async () => {
    const u = await makeUser('pref');
    expect((await getNotifyPrefs(u.id)).emailMode).toBe('off');
    const saved = await setNotifyPrefs(u.id, { emailMode: 'digest', timezone: 'Europe/Madrid', locale: 'es' });
    expect(saved).toEqual({ emailMode: 'digest', timezone: 'Europe/Madrid', locale: 'es' });
  });

  it('inmediato: sale una vez, pasado un minuto, solo lo sin leer', async () => {
    const u = await makeUser('imm');
    await setNotifyPrefs(u.id, { emailMode: 'immediate', locale: 'es' }, new Date(Date.now() - 10_000));
    await createNotification({
      userId: u.id,
      type: 'assigned',
      title: 'x',
      sourceType: 'track_issue',
      sourceId: 'i',
      href: '/app/track/issues/i',
      meta: { actorName: 'Ana', issueIdentifier: 'WEB-1' },
    });
    const mine = () => mail.sent.filter((m) => m.to === u.email);
    await sendImmediateTrackEmails();
    expect(mine()).toHaveLength(0);
    const later = new Date(Date.now() + 2 * 60_000);
    await Promise.all([sendImmediateTrackEmails({ now: later }), sendImmediateTrackEmails({ now: later })]);
    expect(mine()).toHaveLength(1);
    expect(mine()[0].subject).toBe('Ana te asignó WEB-1');
    await sendImmediateTrackEmails({ now: new Date(Date.now() + 5 * 60_000) });
    expect(mine()).toHaveLength(1);
  });

  it('resumen: a las 8 de su zona, una vez por día', async () => {
    const u = await makeUser('dig');
    await setNotifyPrefs(u.id, { emailMode: 'digest', timezone: 'UTC' });
    await createNotification({ userId: u.id, type: 'comment', title: 'x', sourceType: 'track_issue', sourceId: 'i', meta: { issueIdentifier: 'WEB-2' } });
    const mine = () => mail.sent.filter((m) => m.to === u.email);
    const base = new Date();
    const at = (h: number) => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), h, 17));
    // Los avisos son de "ahora": el resumen se prueba dentro de las 48 h.
    const day = at(0).getTime() > Date.now() ? 0 : 1;
    const hour = (h: number) => new Date(at(h).getTime() + day * 86_400_000);
    await sendTrackDigests({ now: hour(6) });
    expect(mine()).toHaveLength(0);
    await Promise.all([sendTrackDigests({ now: hour(8) }), sendTrackDigests({ now: hour(8) })]);
    expect(mine()).toHaveLength(1);
    expect(mine()[0].subject).toContain('1');
    await sendTrackDigests({ now: hour(9) });
    expect(mine()).toHaveLength(1);
  });

  it('digestDue respeta la ventana de 8 a 11 y el día ya enviado', () => {
    const at = new Date('2026-10-21T11:17:00Z'); // 8:17 en Buenos Aires
    expect(digestDue({ timezone: 'America/Argentina/Buenos_Aires', cal_timezone: null, digest_day: null }, at)).toBe('2026-10-21');
    expect(digestDue({ timezone: null, cal_timezone: 'America/Argentina/Buenos_Aires', digest_day: '2026-10-21' }, at)).toBeNull();
    expect(digestDue({ timezone: 'UTC', cal_timezone: null, digest_day: null }, at)).toBe('2026-10-21');
    expect(digestDue({ timezone: 'Asia/Tokyo', cal_timezone: null, digest_day: null }, at)).toBeNull();
  });

  it('el email arma una línea por aviso con su link', () => {
    const mailOut = buildTrackEmail(
      [
        { id: '1', type: 'mention', title: '', body: 'Login roto', href: '/app/track/issues/a', meta: '{"actorName":"Ana","issueIdentifier":"WEB-3"}', created_at: '' },
        { id: '2', type: 'track_reminder', title: '', body: null, href: '/app/track/issues/b', meta: '{"issueIdentifier":"WEB-4"}', created_at: '' },
      ],
      'en',
      'digest',
      5,
    );
    expect(mailOut.subject).toBe('Track: 5 unread');
    expect(mailOut.text).toContain('Ana mentioned you in WEB-3: Login roto');
    expect(mailOut.text).toContain('Reminder: WEB-4');
    expect(mailOut.text).toContain('/en/app/track/issues/a');
    expect(mailOut.text).toContain('And 3 more');
    expect(mailOut.html).toContain('zerosoft · track');
  });
});
