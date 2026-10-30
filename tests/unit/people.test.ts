import { beforeAll, describe, expect, it, vi } from 'vitest';

// La salida "sacar del workspace" tiene que pasar por personRemoved: se espía
// sin cambiar lo demás del módulo (personJoined sigue siendo el real).
const removed = vi.hoisted(() => [] as Array<{ ownerId: string; userId: string }>);
vi.mock('@/lib/workspace-lifecycle', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/workspace-lifecycle')>();
  return {
    ...real,
    personRemoved: vi.fn(async (e: { ownerId: string; teamId: string; userId: string }) => {
      removed.push({ ownerId: e.ownerId, userId: e.userId });
      return real.personRemoved(e);
    }),
  };
});

import { getDb, upsertUser } from '@/lib/db';
import { addMember } from '@/lib/teams';
import { ensureWorkspace } from '@/lib/workspace';
import { open as openSecret } from '@/lib/secret-box';
import {
  accrualEvents,
  addDays,
  computeBalance,
  countLeaveDays,
  dueDateFor,
  seededHolidays,
  seededYears,
  tenureYears,
  HOLIDAY_COUNTRIES,
  type AccrualPolicy,
} from '@/lib/people-time';
import {
  canApprove,
  canEditField,
  canSeeCustomField,
  canSeeDocument,
  canSeeField,
  canSeeOneOnOne,
  canSeeSensitive,
  reportsOf,
  wouldCycle,
  type PeopleViewer,
} from '@/lib/people-access';
import {
  addCompensation,
  createEmployee,
  getEmployee,
  listCompensation,
  listEmployees,
  openComp,
  payrollCsv,
  peopleContext,
  searchPeople,
  updateEmployee,
  type PeopleCtx,
} from '@/lib/people';
import { createRequest, decideRequest, balancesFor, listPolicies, teamCalendar } from '@/lib/people-timeoff';
import { listTemplates, offboard, planTasks, startChecklist } from '@/lib/people-onboarding';
import { createCycle, launchCycle, listReviews, submitReview, updateCycle } from '@/lib/people-perf';
import { toolsFor } from '@/lib/assistant/tools';
import { peopleTools } from '@/lib/assistant/tools-people';

const uid = () => Math.random().toString(36).slice(2, 10);

/** Un lunes entre 30 y 60 días adelante cuyos lunes a miércoles no son feriado en AR. */
function futureMonday(): string {
  let d = addDays(new Date().toISOString().slice(0, 10), 30);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
  const off = (x: string) => seededHolidays('AR', Number(x.slice(0, 4))).some((h) => h.date === x);
  while ([0, 1, 2].some((i) => off(addDays(d, i)))) d = addDays(d, 7);
  return d;
}

const policy = (p: Partial<AccrualPolicy> = {}): AccrualPolicy => ({ accrual: 'annual', daysPerYear: 15, carryoverMax: null, capDays: null, ...p });

// ---------- Cuentas de licencias ----------

describe('días de licencia', () => {
  it('cuenta lunes a viernes, sin feriados, y medio día vale 0,5', () => {
    // 2026-12-21 (lun) al 2026-12-27 (dom): 5 hábiles; con Navidad (vie 25) son 4.
    expect(countLeaveDays('2026-12-21', '2026-12-27')).toBe(5);
    expect(countLeaveDays('2026-12-21', '2026-12-27', ['2026-12-25'])).toBe(4);
    expect(countLeaveDays('2026-12-22', '2026-12-22', [], 'am')).toBe(0.5);
    expect(countLeaveDays('2026-12-22', '2026-12-22', [], 'pm')).toBe(0.5);
    // Medio día en un feriado o fin de semana no cuenta nada.
    expect(countLeaveDays('2026-12-25', '2026-12-25', ['2026-12-25'], 'am')).toBe(0);
    expect(countLeaveDays('2026-12-26', '2026-12-26', [], 'am')).toBe(0);
    expect(countLeaveDays('2026-12-28', '2026-12-21')).toBe(0);
  });

  it('el seed de feriados trae AR, BR, MX, US, ES y CO, con fechas válidas y sin repetir', () => {
    expect([...HOLIDAY_COUNTRIES]).toEqual(['AR', 'BR', 'MX', 'US', 'ES', 'CO']);
    expect(seededYears()).toEqual(expect.arrayContaining([2026, 2027]));
    for (const c of HOLIDAY_COUNTRIES) {
      for (const y of [2026, 2027]) {
        const list = seededHolidays(c, y);
        expect(list.length, `${c} ${y}`).toBeGreaterThanOrEqual(7);
        for (const h of list) {
          expect(h.date.startsWith(String(y))).toBe(true);
          expect(Number.isNaN(new Date(`${h.date}T00:00:00Z`).getTime())).toBe(false);
        }
        expect(new Set(list.map((h) => h.date + h.name)).size).toBe(list.length);
      }
    }
    // Fechas conocidas: Thanksgiving (4.º jueves) y Tiradentes.
    expect(seededHolidays('US', 2026).find((h) => h.name === 'Thanksgiving Day')?.date).toBe('2026-11-26');
    expect(seededHolidays('BR', 2027).find((h) => h.name === 'Tiradentes')?.date).toBe('2027-04-21');
  });
});

describe('devengamiento', () => {
  it('anual: prorrateado el primer año, entero cada 1 de enero', () => {
    const ev = accrualEvents(policy({ daysPerYear: 12 }), '2026-07-10', '2027-03-01');
    expect(ev).toEqual([
      { date: '2026-07-10', days: 6 },
      { date: '2027-01-01', days: 12 },
    ]);
  });

  it('mensual: el mes de ingreso cuenta si entra hasta el 15', () => {
    expect(accrualEvents(policy({ accrual: 'monthly', daysPerYear: 12 }), '2026-01-10', '2026-03-31').map((e) => e.date)).toEqual(['2026-01-10', '2026-02-01', '2026-03-01']);
    expect(accrualEvents(policy({ accrual: 'monthly', daysPerYear: 12 }), '2026-01-20', '2026-03-31').map((e) => e.date)).toEqual(['2026-02-01', '2026-03-01']);
  });

  it('por período de pago: quincenal fija (15 y fin de mes), cada dos semanas y semanal', () => {
    const semi = accrualEvents(policy({ accrual: 'per_pay_period', daysPerYear: 24 }), '2026-01-01', '2026-02-28', 'semimonthly');
    expect(semi.map((e) => e.date)).toEqual(['2026-01-15', '2026-01-31', '2026-02-15', '2026-02-28']);
    expect(semi.every((e) => e.days === 1)).toBe(true);
    const bi = accrualEvents(policy({ accrual: 'per_pay_period', daysPerYear: 26 }), '2026-01-01', '2026-01-31', 'biweekly');
    expect(bi).toEqual([
      { date: '2026-01-14', days: 1 },
      { date: '2026-01-28', days: 1 },
    ]);
    expect(accrualEvents(policy({ accrual: 'per_pay_period', daysPerYear: 52 }), '2026-01-01', '2026-01-31', 'weekly')).toHaveLength(4);
  });

  it('saldo: usado, programado, pendiente y disponible', () => {
    const b = computeBalance({
      policy: policy({ daysPerYear: 15 }),
      startDate: '2025-01-01',
      asOf: '2026-06-01',
      approved: [
        { date: '2026-03-02', days: 3 },
        { date: '2026-07-01', days: 2 },
      ],
      pending: [{ date: '2026-08-01', days: 1.5 }],
    });
    expect(b.accrued).toBe(15);
    expect(b.used).toBe(3);
    expect(b.scheduled).toBe(2);
    expect(b.pending).toBe(1.5);
    // 15 del año anterior pasan enteros (sin tope de arrastre) + 15 - 3.
    expect(b.carriedOver).toBe(15);
    expect(b.balance).toBe(27);
    expect(b.available).toBe(23.5);
  });

  it('arrastre: al cambiar de año el saldo se recorta al tope', () => {
    const b = computeBalance({ policy: policy({ daysPerYear: 15, carryoverMax: 5 }), startDate: '2025-01-01', asOf: '2026-02-01', approved: [{ date: '2025-05-05', days: 4 }] });
    // 2025: 15 - 4 = 11 → pasan 5. 2026: 5 + 15.
    expect(b.carriedOver).toBe(5);
    expect(b.balance).toBe(20);
    expect(b.expiringAtYearEnd).toBe(15);
    const none = computeBalance({ policy: policy({ daysPerYear: 10, carryoverMax: 0 }), startDate: '2025-01-01', asOf: '2026-01-02', approved: [] });
    expect(none.carriedOver).toBe(0);
    expect(none.balance).toBe(10);
  });

  it('tope de saldo: deja de devengar al llegar y vuelve a devengar al usar', () => {
    const pol = policy({ accrual: 'monthly', daysPerYear: 24, capDays: 5 });
    const full = computeBalance({ policy: pol, startDate: '2026-01-01', asOf: '2026-12-31', approved: [] });
    expect(full.balance).toBe(5);
    expect(full.accrued).toBe(5);
    const used = computeBalance({ policy: pol, startDate: '2026-01-01', asOf: '2026-12-31', approved: [{ date: '2026-06-15', days: 4 }] });
    // Llega a 5 en marzo, baja a 1 en junio y vuelve a 5 con los créditos de julio y agosto.
    expect(used.balance).toBe(5);
    expect(used.used).toBe(4);
  });

  it('medio día descuenta 0,5 y los ajustes suman o restan', () => {
    const b = computeBalance({
      policy: policy({ daysPerYear: 10 }),
      startDate: '2026-01-01',
      asOf: '2026-12-31',
      approved: [{ date: '2026-04-06', days: countLeaveDays('2026-04-06', '2026-04-06', [], 'pm') }],
      adjustments: [
        { date: '2026-02-01', days: 2 },
        { date: '2026-03-01', days: -1 },
      ],
    });
    expect(b.used).toBe(0.5);
    expect(b.adjusted).toBe(1);
    expect(b.balance).toBe(10.5);
  });

  it('sin devengamiento solo registra lo usado', () => {
    const b = computeBalance({ policy: policy({ accrual: 'none' }), startDate: '2026-01-01', asOf: '2026-12-31', approved: [{ date: '2026-02-02', days: 2 }] });
    expect(b.accrued).toBe(0);
    expect(b.used).toBe(2);
    expect(b.balance).toBe(-2);
  });

  it('antigüedad y vencimientos relativos', () => {
    expect(tenureYears('2024-01-01', null, '2026-01-01')).toBe(2);
    expect(tenureYears('2024-01-01', '2025-01-01', '2026-01-01')).toBe(1);
    expect(dueDateFor('2026-11-02', -7)).toBe('2026-10-26');
    expect(dueDateFor('2026-11-02', 30)).toBe('2026-12-02');
  });
});

// ---------- Permisos ----------

const viewer = (v: Partial<PeopleViewer>): PeopleViewer => ({ personId: 'u', employeeId: null, hr: false, reports: new Set(), ...v });

describe('quién ve qué', () => {
  // Ana (HR) ← Bruno (manager) ← Carla y Dani; Eva no tiene relación.
  const managerOf = new Map<string, string | null>([
    ['ana', null],
    ['bruno', 'ana'],
    ['carla', 'bruno'],
    ['dani', 'bruno'],
    ['eva', 'ana'],
  ]);
  const hr = viewer({ employeeId: 'ana', hr: true, reports: reportsOf('ana', managerOf) });
  const bruno = viewer({ employeeId: 'bruno', reports: reportsOf('bruno', managerOf) });
  const carla = viewer({ employeeId: 'carla', reports: reportsOf('carla', managerOf) });
  const eva = viewer({ employeeId: 'eva', reports: reportsOf('eva', managerOf) });

  it('cadena de reportes y ciclos', () => {
    expect([...reportsOf('ana', managerOf)].sort()).toEqual(['bruno', 'carla', 'dani', 'eva']);
    expect([...reportsOf('bruno', managerOf)].sort()).toEqual(['carla', 'dani']);
    expect(wouldCycle('bruno', 'carla', managerOf)).toBe(true);
    expect(wouldCycle('carla', 'carla', managerOf)).toBe(true);
    expect(wouldCycle('carla', 'eva', managerOf)).toBe(false);
  });

  it('matriz de datos sensibles', () => {
    const table: Array<[string, PeopleViewer, string, Record<string, boolean>]> = [
      ['HR ve todo', hr, 'carla', { personal: true, compensation: true, performance: true, timeoff: true, exit: true }],
      ['la persona ve lo suyo (no la entrevista de salida)', carla, 'carla', { personal: true, compensation: true, performance: true, timeoff: true, exit: false }],
      ['el manager ve desempeño y licencias, no sueldo ni datos personales', bruno, 'carla', { personal: false, compensation: false, performance: true, timeoff: true, exit: false }],
      ['un par no ve nada sensible', eva, 'carla', { personal: false, compensation: false, performance: false, timeoff: false, exit: false }],
      ['un reporte no ve lo de su manager', carla, 'bruno', { personal: false, compensation: false, performance: false, timeoff: false, exit: false }],
    ];
    for (const [name, v, target, expected] of table) {
      for (const [group, allowed] of Object.entries(expected)) {
        expect(canSeeSensitive(v, target, group as 'personal'), `${name}: ${group}`).toBe(allowed);
      }
    }
  });

  it('campos configurables, propios, documentos y 1:1', () => {
    const vis = { phone: 'hr' as const, location: 'managers' as const };
    expect(canSeeField(eva, 'carla', 'phone', vis)).toBe(false);
    expect(canSeeField(carla, 'carla', 'phone', vis)).toBe(true);
    expect(canSeeField(hr, 'carla', 'phone', vis)).toBe(true);
    expect(canSeeField(bruno, 'carla', 'location', vis)).toBe(true);
    expect(canSeeField(eva, 'carla', 'location', vis)).toBe(false);
    expect(canSeeField(eva, 'carla', 'startDate', vis)).toBe(true);
    expect(canSeeCustomField(eva, 'carla', true)).toBe(false);
    expect(canSeeCustomField(carla, 'carla', true)).toBe(true);
    expect(canSeeCustomField(eva, 'carla', false)).toBe(true);
    expect(canSeeDocument(carla, { employeeId: 'carla', visibility: 'hr' })).toBe(false);
    expect(canSeeDocument(carla, { employeeId: 'carla', visibility: 'employee' })).toBe(true);
    expect(canSeeDocument(bruno, { employeeId: 'carla', visibility: 'employee' })).toBe(false);
    expect(canSeeDocument(eva, { employeeId: null, visibility: 'employee' })).toBe(true);
    expect(canSeeOneOnOne(bruno, { aId: 'bruno', bId: 'carla' })).toBe(true);
    expect(canSeeOneOnOne(hr, { aId: 'bruno', bId: 'carla' })).toBe(false);
    expect(canEditField(carla, 'carla', 'phone')).toBe(true);
    expect(canEditField(carla, 'carla', 'jobTitle')).toBe(false);
    expect(canEditField(bruno, 'carla', 'phone')).toBe(false);
  });

  it('aprobar: solo la cadena de managers o HR; nadie lo propio', () => {
    expect(canApprove(bruno, 'carla')).toBe(true);
    expect(canApprove(hr, 'carla')).toBe(true);
    expect(canApprove(hr, 'dani')).toBe(true);
    expect(canApprove(eva, 'carla')).toBe(false);
    expect(canApprove(carla, 'dani')).toBe(false);
    expect(canApprove(carla, 'bruno')).toBe(false);
    expect(canApprove(bruno, 'bruno')).toBe(false);
    // HR sin manager (el owner de un workspace chico) puede aprobar lo suyo.
    expect(canApprove(hr, 'ana', false)).toBe(true);
    expect(canApprove(hr, 'ana', true)).toBe(false);
  });
});

// ---------- Con base ----------

interface Ws {
  owner: string;
  teamId: string;
  hr: PeopleCtx;
  users: Record<string, string>;
}

async function workspace(): Promise<Ws> {
  const owner = await upsertUser({ email: `ppl-owner-${uid()}@example.com`, name: 'Olga Owner', image: null });
  const team = await ensureWorkspace(owner.id);
  const users: Record<string, string> = {};
  for (const name of ['manager', 'carla', 'dani', 'eva']) {
    const u = await upsertUser({ email: `ppl-${name}-${uid()}@example.com`, name: name[0].toUpperCase() + name.slice(1), image: null });
    await addMember(team.id, u.id, 'member');
    users[name] = u.id;
  }
  return { owner: owner.id, teamId: team.id, hr: await peopleContext(owner.id, owner.id, 'owner'), users };
}

const ctxOf = (w: Ws, userId: string) => peopleContext(w.owner, userId, 'member');

describe('People con la base', () => {
  let w: Ws;
  let ids: Record<string, string>;

  beforeAll(async () => {
    w = await workspace();
    const all = await listEmployees(w.hr);
    const byUser = (u: string) => all.find((e) => e.userId === u)!.id;
    ids = { owner: byUser(w.owner), manager: byUser(w.users.manager), carla: byUser(w.users.carla), dani: byUser(w.users.dani), eva: byUser(w.users.eva) };
    await updateEmployee(w.hr, ids.manager, { managerId: ids.owner, jobTitle: 'Engineering lead', department: 'Engineering', country: 'AR', startDate: '2024-01-01' });
    for (const k of ['carla', 'dani']) await updateEmployee(w.hr, ids[k], { managerId: ids.manager, department: 'Engineering', country: 'AR', startDate: '2024-01-01' });
    await updateEmployee(w.hr, ids.eva, { managerId: ids.owner, department: 'Sales', startDate: '2024-01-01' });
  });

  it('cada miembro del workspace tiene su ficha; un ingreso se enlaza al sumarse', async () => {
    expect(Object.values(ids).every(Boolean)).toBe(true);
    const email = `ppl-newhire-${uid()}@example.com`;
    const hire = await createEmployee(w.hr, { name: 'Nina New', workEmail: email, managerId: ids.manager, startDate: '2099-01-05' });
    expect(hire.status).toBe('onboarding');
    expect(hire.hasAccount).toBe(false);
    const u = await upsertUser({ email, name: 'Nina', image: null });
    await addMember(w.teamId, u.id, 'member');
    const after = await getEmployee(w.hr, hire.id, { audit: false });
    expect(after?.hasAccount).toBe(true);
    expect((await listEmployees(w.hr)).filter((e) => e.userId === u.id)).toHaveLength(1);
  });

  it('un manager solo aprueba a sus reportes, y aprobar baja el saldo y bloquea Cal', async () => {
    const carla = await ctxOf(w, w.users.carla);
    const vacation = (await listPolicies(w.owner)).find((p) => p.kind === 'vacation')!;
    const before = (await balancesFor(carla, ids.carla)).find((b) => b.policy.id === vacation.id)!.balance.available;
    // Un lunes a miércoles futuro sin feriados de AR: 3 días hábiles.
    const mon = futureMonday();
    const req = await createRequest(carla, { policyId: vacation.id, startDate: mon, endDate: addDays(mon, 2) });
    expect(req.days).toBe(3);
    expect(req.status).toBe('pending');
    // Eva (de Sales) no puede; Dani (par) tampoco; Carla no se aprueba sola.
    await expect(decideRequest(await ctxOf(w, w.users.eva), req.id, 'approve')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(decideRequest(await ctxOf(w, w.users.dani), req.id, 'approve')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(decideRequest(carla, req.id, 'approve')).rejects.toMatchObject({ code: 'forbidden' });
    const done = await decideRequest(await ctxOf(w, w.users.manager), req.id, 'approve');
    expect(done.status).toBe('approved');
    await expect(decideRequest(w.hr, req.id, 'approve')).rejects.toMatchObject({ code: 'not_pending' });
    const after = (await balancesFor(carla, ids.carla)).find((b) => b.policy.id === vacation.id)!.balance;
    expect(after.available).toBe(before - 3);
    expect(after.scheduled).toBe(3);
    const slot = (await getDb().prepare('SELECT * FROM calendar_blocked_slots WHERE user_id = ? AND starts_at = ?').get(w.users.carla, `${mon}T00:00:00.000Z`)) as
      | { ends_at: string }
      | undefined;
    expect(slot?.ends_at).toBe(`${addDays(mon, 3)}T00:00:00.000Z`);
    // Eva ve que Carla está fuera, pero no el tipo de licencia.
    const cal = await teamCalendar(await ctxOf(w, w.users.eva), mon, addDays(mon, 6));
    expect(cal.entries.find((e) => e.employeeId === ids.carla)).toMatchObject({ policyName: null, status: 'approved' });
    // Eva no ve los saldos de Carla.
    await expect(balancesFor(await ctxOf(w, w.users.eva), ids.carla)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('el sueldo se guarda cifrado y solo lo ven HR y la persona (con auditoría)', async () => {
    const entry = await addCompensation(w.hr, ids.carla, { amount: 98765.43, currency: 'usd', period: 'year', effectiveDate: '2026-01-01', reason: 'Raise' });
    expect(entry.currency).toBe('USD');
    const row = (await getDb().prepare('SELECT data FROM people_compensation WHERE id = ?').get(entry.id)) as { data: string };
    expect(row.data.startsWith('enc:v1:')).toBe(true);
    expect(row.data).not.toContain('98765');
    expect(JSON.parse(openSecret(row.data))).toMatchObject({ amount: 98765.43, currency: 'USD' });
    expect(openComp(row.data)?.amount).toBe(98765.43);
    expect((await listCompensation(await ctxOf(w, w.users.carla), ids.carla))[0].amount).toBe(98765.43);
    await expect(listCompensation(await ctxOf(w, w.users.manager), ids.carla)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listCompensation(await ctxOf(w, w.users.eva), ids.carla)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(addCompensation(await ctxOf(w, w.users.carla), ids.carla, { amount: 1, effectiveDate: '2026-02-01' })).rejects.toMatchObject({ code: 'forbidden' });
    const audits = (await getDb().prepare("SELECT action, field FROM people_audit WHERE workspace_id = ? AND employee_id = ? AND field = 'compensation'").all(w.owner, ids.carla)) as Array<{ action: string }>;
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['change', 'view']));
    // CSV de nómina: solo HR, con el monto y sin fórmulas.
    expect(await payrollCsv(w.hr)).toContain('98765.43');
    await expect(payrollCsv(await ctxOf(w, w.users.eva))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('nada sensible sale por la ficha, ⌘K ni el asistente a quien no corresponde', async () => {
    await updateEmployee(w.hr, ids.carla, { personal: { address: 'Calle Falsa 123', nationalId: '30111222' } });
    const evaView = await getEmployee(await ctxOf(w, w.users.eva), ids.carla);
    expect(evaView?.personal).toBeNull();
    expect(JSON.stringify(evaView)).not.toContain('Calle Falsa');
    expect((await getEmployee(await ctxOf(w, w.users.carla), ids.carla))?.personal?.address).toBe('Calle Falsa 123');
    const raw = (await getDb().prepare('SELECT personal FROM people_employees WHERE id = ?').get(ids.carla)) as { personal: string };
    expect(raw.personal).not.toContain('Calle Falsa');
    const hits = await searchPeople(w.owner, 'Carla');
    expect(JSON.stringify(hits)).not.toMatch(/Calle Falsa|98765/);
    // El asistente: la herramienta de sueldo le contesta forbidden a Eva y el monto a Carla.
    const tool = peopleTools.find((t) => t.name === 'people_compensation')!;
    const evaUser = { id: w.owner, actingUser: { id: w.users.eva }, role: 'member', apps: '*' } as never;
    const carlaUser = { id: w.owner, actingUser: { id: w.users.carla }, role: 'member', apps: '*' } as never;
    const run = (user: never, personId: string) =>
      tool.kind === 'read' ? tool.run({ user, workspaceId: w.owner, personId, locale: 'en', isAdmin: false }, { name: 'Carla' }) : null;
    expect(await run(evaUser, w.users.eva)).toEqual({ error: 'forbidden' });
    expect(JSON.stringify(await run(carlaUser, w.users.carla))).toContain('98765.43');
    // Sin la app People, el asistente no recibe sus herramientas.
    const names = toolsFor({ id: w.owner, role: 'member', apps: ['crm'] } as never).map((t) => t.name);
    expect(names.some((n) => n.startsWith('people_') || n.startsWith('propose_people'))).toBe(false);
  });

  it('checklist de onboarding desde una plantilla: tareas por rol con vencimiento relativo al ingreso', async () => {
    const plan = planTasks(
      [
        { title: 'Laptop', description: '', assignee: 'it', offsetDays: -3 },
        { title: 'Contract', description: '', assignee: 'new_hire', offsetDays: 0 },
        { title: '1:1', description: '', assignee: 'manager', offsetDays: 7 },
      ],
      '2026-11-02',
      { newHire: 'u-new', manager: 'u-mgr' },
    );
    expect(plan.map((t) => [t.title, t.dueDate, t.assigneeId])).toEqual([
      ['Laptop', '2026-10-30', null],
      ['Contract', '2026-11-02', 'u-new'],
      ['1:1', '2026-11-09', 'u-mgr'],
    ]);
    const tpl = (await listTemplates(w.owner, 'onboarding'))[0];
    await updateEmployee(w.hr, ids.dani, { startDate: '2026-11-02' });
    const list = await startChecklist(w.hr, ids.dani, tpl.id);
    expect(list.total).toBe(tpl.tasks.length);
    const contract = list.tasks.find((t) => t.assignee === 'new_hire')!;
    expect(contract.dueDate).toBe('2026-11-02');
    expect(list.tasks.find((t) => t.assignee === 'it')?.dueDate).toBe('2026-10-30');
    // La persona marca la suya; Eva no puede.
    const { setTaskDone } = await import('@/lib/people-onboarding');
    await expect(setTaskDone(await ctxOf(w, w.users.eva), contract.id, true)).rejects.toMatchObject({ code: 'forbidden' });
    await setTaskDone(await ctxOf(w, w.users.dani), contract.id, true);
  });

  it('un ciclo de evaluación: autoevaluación y del manager; la persona ve la del manager al cerrar', async () => {
    const cycle = await createCycle(w.hr, { name: `H2 ${uid()}`, peerReview: true });
    const launched = await launchCycle(w.hr, cycle.id);
    expect(launched.status).toBe('active');
    const carla = await ctxOf(w, w.users.carla);
    const mine = await listReviews(carla, { mineToWrite: true });
    const self = mine.find((r) => r.cycleId === cycle.id && r.kind === 'self')!;
    expect(self).toBeTruthy();
    const answers = Object.fromEntries(self.questions.map((q) => [q.id, q.kind === 'rating' ? 4 : 'Shipped the thing']));
    await expect(submitReview(carla, self.id, { answers: {}, submit: true })).rejects.toMatchObject({ code: 'answers_required' });
    await submitReview(carla, self.id, { answers, submit: true });
    const mgr = await ctxOf(w, w.users.manager);
    const mgrReview = (await listReviews(mgr, { mineToWrite: true })).find((r) => r.subjectId === ids.carla && r.cycleId === cycle.id && r.kind === 'manager')!;
    await submitReview(mgr, mgrReview.id, { answers, submit: true });
    // Antes de cerrar, Carla ve su autoevaluación pero no la del manager; Eva no ve nada de Carla.
    expect((await listReviews(carla, { cycleId: cycle.id, subjectId: ids.carla })).map((r) => r.kind)).toEqual(['self']);
    expect(await listReviews(await ctxOf(w, w.users.eva), { cycleId: cycle.id, subjectId: ids.carla })).toEqual([]);
    await updateCycle(w.hr, cycle.id, { status: 'closed' });
    expect((await listReviews(carla, { cycleId: cycle.id, subjectId: ids.carla })).map((r) => r.kind).sort()).toEqual(['manager', 'self']);
  });

  it('offboarding con "sacar del workspace" pasa por personRemoved y deja la ficha como baja', async () => {
    removed.length = 0;
    const res = await offboard(w.hr, ids.eva, { endDate: '2026-01-15', removeFromWorkspace: true, templateId: (await listTemplates(w.owner, 'offboarding'))[0].id });
    expect(res.removed).toBe(true);
    expect(res.checklistId).toBeTruthy();
    expect(removed).toContainEqual({ ownerId: w.owner, userId: w.users.eva });
    const member = await getDb().prepare('SELECT 1 AS x FROM team_members WHERE team_id = ? AND user_id = ?').get(w.teamId, w.users.eva);
    expect(member).toBeUndefined();
    const row = (await getDb().prepare('SELECT status, end_date FROM people_employees WHERE id = ?').get(ids.eva)) as { status: string; end_date: string };
    expect(row).toEqual({ status: 'terminated', end_date: '2026-01-15' });
    // Sin "sacar", personRemoved no corre.
    removed.length = 0;
    await offboard(w.hr, ids.dani, { endDate: '2099-12-31' });
    expect(removed).toEqual([]);
    await expect(offboard(await ctxOf(w, w.users.manager), ids.carla, {})).rejects.toMatchObject({ code: 'forbidden' });
  });
});
