import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import { addMember } from '@/lib/teams';
import { ensureWorkspace } from '@/lib/workspace';
import { csvCell, parseCsv, toCsv } from '@/lib/hr-csv';
import { accrualEvents, daysPerYearAt } from '@/lib/people-time';
import { policyApplies, createPolicy, createRequest, balancesFor, listPolicies } from '@/lib/people-timeoff';
import { getEmployee, listEmployees, peopleContext, updateEmployee, updateSettings, type PeopleCtx } from '@/lib/people';
import {
  addPeerReviewer,
  answerSurvey,
  applyDueChanges,
  cancelScheduled,
  listScheduled,
  scheduleChange,
  celebrations,
  createSurvey,
  decideChange,
  enps,
  importEmployees,
  listChangeRequests,
  listJobHistory,
  closeSurvey,
  finishExits,
  deleteSurvey,
  listSurveys,
  mergeChange,
  nextOccurrence,
  readEmployeeCsv,
  reportCsv,
  runReport,
  SURVEY_MIN_RESPONSES,
} from '@/lib/people-extras';
import { createCycle, launchCycle } from '@/lib/people-perf';
import { listChecklists, listTemplates, offboard, startChecklist } from '@/lib/people-onboarding';
import { addHireToPeople } from '@/lib/people-hire';
import { canSeeJob, canSeeJobSalary, cleanCustomValues, failedKnockouts, autoRejected, type HiringActor, type Question } from '@/lib/hiring/types';
import { createJob, getJob, listJobs, listStages, setTeam, updateJob, updateSettings as updateHiringSettings, ensureSettings } from '@/lib/hiring/core';
import { addCandidateManually, applyPublic, getCandidateProfile, listApplications, manualAddSchema, moveApplication, rejectApplication, searchHiring, updateCandidate } from '@/lib/hiring/candidates';
import { actOnJobApproval, chainState, currentStep, listChain, myPendingApprovals, reassignApprover } from '@/lib/hiring/approvals';
import { actOnOffer, createOffer } from '@/lib/hiring/offers';
import { hiringReport } from '@/lib/hiring/reports';
import { applicationsCsv, copyToJob, importCandidates, mergeCandidates, readCandidateCsv } from '@/lib/hiring/transfer';
import { careersFeed, publishedJob, publishedJobs } from '@/lib/hiring/careers';
import { MAIL_CAPS, reserveCandidateMail } from '@/lib/hiring/mail-caps';
import { hiringTools } from '@/lib/assistant/tools-hiring';
import type { ToolCtx } from '@/lib/assistant/registry';

process.env.HIRING_FILES_DIR ??= path.join(os.tmpdir(), `zs-hr-extras-${process.pid}`);

const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- Puro ----------

describe('CSV', () => {
  it('lee comillas, saltos dentro de comillas y punto y coma', () => {
    expect(parseCsv('a,b\n"x, y","z""w"\n')).toEqual([['a', 'b'], ['x, y', 'z"w']]);
    expect(parseCsv('a;b\r\n1;2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('﻿a\n"l1\nl2"\n')).toEqual([['a'], ['l1\nl2']]);
  });
  it('no deja fórmulas ejecutables al exportar', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@me')).toBe("'@me");
    expect(toCsv([['a', 'b,c']])).toBe('a,"b,c"\n');
  });
  it('People: errores por fila sin tocar nada', () => {
    const { rows, missing } = readEmployeeCsv('Name,Email,Start date,Type\nAna,ana@x.co,2024-01-02,full_time\n,b@x.co,,\nCe,bad,,\nDi,ana@x.co,,\nEl,e@x.co,02/01/2024,\nFe,f@x.co,,boss\n');
    expect(missing).toEqual([]);
    expect(rows.map((r) => r.error)).toEqual([null, 'name_required', 'invalid_email', 'duplicate_in_file', 'invalid_date', 'invalid_type']);
    expect(readEmployeeCsv('Email\nx@y.co').missing).toEqual(['name']);
  });
  it('Hiring: pide nombre y email y detecta repetidos', () => {
    expect(readCandidateCsv('Name\nA').missing).toEqual(['email']);
    const { rows } = readCandidateCsv('Nombre,Correo,Etiquetas,Fuente\nAna,ANA@x.co,a|b,LinkedIn\nBeto,ana@x.co,,\n');
    expect(rows[0]).toMatchObject({ email: 'ana@x.co', tags: ['a', 'b'], source: 'linkedin', error: null });
    expect(rows[1].error).toBe('duplicate_in_file');
  });
});

describe('licencias: antigüedad y alcance', () => {
  const policy = { accrual: 'annual' as const, daysPerYear: 15, carryoverMax: null, capDays: null, levels: [{ afterYears: 3, daysPerYear: 18 }, { afterYears: 5, daysPerYear: 20 }] };
  it('los días suben al cumplir los años de cada nivel', () => {
    expect(daysPerYearAt(policy, '2020-03-01', '2023-02-28')).toBe(15);
    expect(daysPerYearAt(policy, '2020-03-01', '2023-03-01')).toBe(18);
    expect(daysPerYearAt(policy, '2020-03-01', '2026-01-01')).toBe(20);
  });
  it('el devengo usa el nivel de cada fecha', () => {
    const ev = accrualEvents(policy, '2020-01-01', '2026-01-01');
    expect(ev.find((e) => e.date === '2022-01-01')?.days).toBe(15);
    expect(ev.find((e) => e.date === '2023-01-01')?.days).toBe(18);
    expect(ev.find((e) => e.date === '2026-01-01')?.days).toBe(20);
    expect(accrualEvents({ ...policy, levels: [] }, '2020-01-01', '2026-01-01').at(-1)?.days).toBe(15);
  });
  it('una política vacía vale para todos; con listas, tiene que coincidir en cada una', () => {
    const emp = { department: 'Sales', location: 'BA', country: 'AR', employment_type: 'full_time' };
    expect(policyApplies({}, emp)).toBe(true);
    expect(policyApplies({ countries: ['ar'] }, emp)).toBe(true);
    expect(policyApplies({ countries: ['MX'] }, emp)).toBe(false);
    expect(policyApplies({ departments: ['Sales'], types: ['contractor'] }, emp)).toBe(false);
  });
});

describe('fechas y eNPS', () => {
  it('próxima fecha, con 29 de febrero', () => {
    expect(nextOccurrence('11-05', '2026-11-01')).toBe('2026-11-05');
    expect(nextOccurrence('01-05', '2026-11-01')).toBe('2027-01-05');
    expect(nextOccurrence('02-29', '2026-01-01')).toBe('2026-02-28');
    expect(nextOccurrence('02-29', '2028-01-01')).toBe('2028-02-29');
  });
  it('eNPS es promotores menos detractores en %', () => {
    expect(enps([10, 9, 8, 7, 3])).toEqual({ score: 20, promoters: 2, passives: 2, detractors: 1 });
    expect(enps([]).score).toBe(0);
  });
});

describe('reglas de visibilidad de un puesto', () => {
  it('fuera del equipo solo lo publicado y no confidencial', () => {
    const out = { admin: false, jobRole: null };
    expect(canSeeJob({ ...out, status: 'published', confidential: false })).toBe(true);
    for (const status of ['draft', 'closed', 'archived']) expect(canSeeJob({ ...out, status, confidential: false })).toBe(false);
    expect(canSeeJob({ ...out, status: 'published', confidential: true })).toBe(false);
    expect(canSeeJob({ admin: true, jobRole: null, status: 'draft', confidential: true })).toBe(true);
    expect(canSeeJob({ admin: false, jobRole: 'interviewer', status: 'draft', confidential: true })).toBe(true);
  });
  it('el salario oculto no llega a interviewers ni a gente de afuera', () => {
    expect(canSeeJobSalary({ admin: false, jobRole: 'interviewer', salaryPublic: false })).toBe(false);
    expect(canSeeJobSalary({ admin: false, jobRole: null, salaryPublic: false })).toBe(false);
    expect(canSeeJobSalary({ admin: false, jobRole: null, salaryPublic: true })).toBe(true);
    expect(canSeeJobSalary({ admin: false, jobRole: 'recruiter', salaryPublic: false })).toBe(true);
  });
  it('knock-out que rechaza solo', () => {
    const q: Question[] = [
      { id: 'a', label: 'A', type: 'yesno', required: true, options: [], knockout: { accepted: ['yes'], min: null, autoReject: true } },
      { id: 'b', label: 'B', type: 'yesno', required: true, options: [], knockout: { accepted: ['yes'], min: null, autoReject: false } },
    ];
    expect(autoRejected(q, failedKnockouts(q, { a: 'yes', b: 'no' }))).toBe(false);
    expect(autoRejected(q, failedKnockouts(q, { a: 'no', b: 'yes' }))).toBe(true);
  });
  it('cadena de aprobación', () => {
    const s = (status: 'pending' | 'approved' | 'rejected' | 'skipped', position: number) => ({ status, position });
    expect(chainState([])).toBe('none');
    expect(chainState([s('approved', 0), s('skipped', 1)])).toBe('approved');
    expect(chainState([s('approved', 0), s('pending', 1)])).toBe('pending');
    expect(chainState([s('rejected', 0), s('pending', 1)])).toBe('rejected');
    expect(currentStep([s('pending', 1), s('approved', 0), s('pending', 2)])?.position).toBe(1);
    expect(currentStep([s('rejected', 0), s('pending', 1)])).toBeNull();
  });
});

// ---------- Con la base: People ----------

interface PeopleWorld {
  owner: string;
  teamId: string;
  hr: PeopleCtx;
  users: Record<string, string>;
  ids: Record<string, string>;
}

async function peopleWorld(): Promise<PeopleWorld> {
  const owner = await upsertUser({ email: `hx-owner-${uid()}@example.com`, name: 'Olga', image: null });
  const team = await ensureWorkspace(owner.id);
  const users: Record<string, string> = {};
  for (const name of ['boss', 'emp', 'peer', 'hrp', 'gone']) {
    const u = await upsertUser({ email: `hx-${name}-${uid()}@example.com`, name, image: null });
    await addMember(team.id, u.id, 'member');
    users[name] = u.id;
  }
  const hr = await peopleContext(owner.id, owner.id, 'owner');
  const all = await listEmployees(hr);
  const by = (u: string) => all.find((e) => e.userId === u)!.id;
  const ids = Object.fromEntries(Object.entries(users).map(([k, v]) => [k, by(v)]));
  await updateEmployee(hr, ids.emp, { managerId: ids.boss, department: 'Sales', startDate: '2020-11-10' });
  await updateEmployee(hr, ids.peer, { managerId: ids.boss, department: 'Sales' });
  await updateSettings(hr, { hrAdmins: [users.hrp] });
  return { owner: owner.id, teamId: team.id, hr, users, ids };
}

const pctx = (w: PeopleWorld, who: string) => peopleContext(w.owner, w.users[who], 'member');

describe('People: bajas y salidas no se filtran', () => {
  let w: PeopleWorld;
  beforeAll(async () => {
    w = await peopleWorld();
    await updateEmployee(w.hr, w.ids.gone, { status: 'offboarding', managerId: w.ids.boss, endDate: '2099-01-01' });
  });

  it('un compañero ve a quien se va como activo; su manager y HR ven la salida', async () => {
    const peer = await pctx(w, 'peer');
    expect((await listEmployees(peer)).find((e) => e.id === w.ids.gone)?.status).toBe('active');
    expect((await getEmployee(peer, w.ids.gone, { audit: false }))?.status).toBe('active');
    expect((await listEmployees(await pctx(w, 'boss'))).find((e) => e.id === w.ids.gone)?.status).toBe('offboarding');
    expect((await listEmployees(w.hr)).find((e) => e.id === w.ids.gone)?.status).toBe('offboarding');
  });

  it('el filtro por estado es de HR, aunque se pida por la API', async () => {
    const peer = await pctx(w, 'peer');
    await updateEmployee(w.hr, w.ids.gone, { status: 'terminated' });
    expect((await listEmployees(peer, { status: 'terminated' })).some((e) => e.id === w.ids.gone)).toBe(false);
    expect((await listEmployees(peer, { includeTerminated: true })).some((e) => e.id === w.ids.gone)).toBe(false);
    expect((await listEmployees(w.hr, { status: 'terminated' })).some((e) => e.id === w.ids.gone)).toBe(true);
    expect(await getEmployee(peer, w.ids.gone, { audit: false })).toBeNull();
    expect(await getEmployee(await pctx(w, 'boss'), w.ids.gone, { audit: false })).not.toBeNull();
  });

  it('las salidas quedan en el historial: la que vence pasa a baja sola', async () => {
    const hrw = await peopleWorld();
    await offboard(hrw.hr, hrw.ids.emp, { endDate: '2098-01-01' });
    expect((await listJobHistory(hrw.hr, hrw.ids.emp)).find((h) => h.field === 'status')).toMatchObject({ from: 'active', to: 'offboarding' });
    expect(await finishExits('2098-01-01')).toBeGreaterThanOrEqual(1);
    expect((await getEmployee(hrw.hr, hrw.ids.emp, { audit: false }))?.status).toBe('terminated');
    expect((await listJobHistory(hrw.hr, hrw.ids.emp)).find((h) => h.to === 'terminated')).toMatchObject({ from: 'offboarding', actorName: '' });
  });

  it('de su propio offboarding, la persona ve solo sus tareas', async () => {
    const tpl = (await listTemplates(w.owner, 'offboarding'))[0];
    await startChecklist(w.hr, w.ids.peer, tpl.id, '2099-01-01');
    const own = (await listChecklists(await pctx(w, 'peer'), { employeeId: w.ids.peer })).find((c) => c.kind === 'offboarding');
    expect(own?.tasks.every((t) => t.assignee === 'new_hire')).toBe(true);
    const asBoss = (await listChecklists(await pctx(w, 'boss'), { employeeId: w.ids.peer })).find((c) => c.kind === 'offboarding');
    expect(asBoss!.tasks.length).toBeGreaterThan(own!.tasks.length);
  });
});

describe('People: historial y aprobación de cambios', () => {
  let w: PeopleWorld;
  beforeAll(async () => {
    w = await peopleWorld();
  });

  it('guarda cada cambio de puesto y solo lo ven HR, la persona y su cadena', async () => {
    await updateEmployee(w.hr, w.ids.emp, { jobTitle: 'Senior AE', managerId: w.ids.hrp });
    await updateEmployee(w.hr, w.ids.emp, { jobTitle: 'Senior AE' });
    await updateEmployee(w.hr, w.ids.emp, { managerId: w.ids.boss });
    const list = await listJobHistory(w.hr, w.ids.emp);
    expect(list.filter((h) => h.field === 'jobTitle')).toHaveLength(1);
    expect(list.find((h) => h.field === 'jobTitle')).toMatchObject({ from: '', to: 'Senior AE' });
    expect(list.find((h) => h.field === 'managerId')?.to).toBe('boss');
    expect((await listJobHistory(await pctx(w, 'emp'), w.ids.emp)).length).toBe(list.length);
    expect((await listJobHistory(await pctx(w, 'boss'), w.ids.emp)).length).toBe(list.length);
    await expect(listJobHistory(await pctx(w, 'peer'), w.ids.emp)).rejects.toMatchObject({ status: 403 });
  });

  it('apagada, el cambio se aplica; encendida, espera a HR y cifrado', async () => {
    const emp = await pctx(w, 'emp');
    await updateEmployee(emp, w.ids.emp, { phone: '111' });
    expect((await getEmployee(w.hr, w.ids.emp, { audit: false }))?.phone).toBe('111');
    await updateSettings(w.hr, { approveChanges: true });
    const after = await updateEmployee(emp, w.ids.emp, { phone: '222', bio: 'hola', personal: { address: 'Calle Falsa 123' } });
    expect(after.pendingChange).toBe(true);
    expect(after.phone).toBe('111');
    expect(after.bio).toBe('hola');
    expect(after.personal?.address).toBe('');
    const raw = (await getDb().prepare("SELECT payload FROM people_change_requests WHERE employee_id = ? AND status = 'pending'").get(w.ids.emp)) as { payload: string };
    expect(raw.payload).not.toContain('Calle Falsa');
  });

  it('solo HR lista y decide; un rechazo no aplica nada', async () => {
    await expect(listChangeRequests(await pctx(w, 'boss'))).rejects.toMatchObject({ status: 403 });
    const [req] = await listChangeRequests(w.hr);
    expect(req.changes.map((c) => c.field).sort()).toEqual(['address', 'phone']);
    await expect(decideChange(await pctx(w, 'emp'), req.id, 'approve')).rejects.toMatchObject({ status: 403 });
    await decideChange(w.hr, req.id, 'deny');
    expect((await getEmployee(w.hr, w.ids.emp, { audit: false }))?.phone).toBe('111');
    await expect(decideChange(w.hr, req.id, 'approve')).rejects.toMatchObject({ code: 'not_pending' });
  });

  it('aprobar aplica; quien lo pidió no se aprueba a sí mismo aunque sea HR', async () => {
    const emp = await pctx(w, 'emp');
    await updateEmployee(emp, w.ids.emp, { personal: { address: 'Nueva 1' } });
    const [req] = await listChangeRequests(w.hr);
    await decideChange(w.hr, req.id, 'approve');
    const row = await getEmployee(w.hr, w.ids.emp, { audit: false });
    expect(row?.personal?.address).toBe('Nueva 1');
    expect(row?.pendingChange).toBe(false);
    const hrp = await pctx(w, 'hrp');
    expect(hrp.viewer.hr).toBe(true);
    // HR edita lo suyo directo: no pasa por la cola.
    expect((await updateEmployee(hrp, w.ids.hrp, { phone: '999' })).phone).toBe('999');
    await updateSettings(w.hr, { approveChanges: false });
  });

  it('sin cambios reales no crea nada; un pedido nuevo se combina con el anterior', async () => {
    const empCtx = await pctx(w, 'emp');
    await updateSettings(w.hr, { approveChanges: true });
    const cur = (await getEmployee(w.hr, w.ids.emp, { audit: false }))!;
    await updateEmployee(empCtx, w.ids.emp, { phone: cur.phone ?? '', personal: { address: cur.personal?.address ?? '' } });
    expect((await listChangeRequests(w.hr)).filter((r) => r.employeeId === w.ids.emp)).toEqual([]);
    await updateEmployee(empCtx, w.ids.emp, { phone: '700' });
    await updateEmployee(empCtx, w.ids.emp, { personal: { address: 'Otra 2' } });
    const [req] = (await listChangeRequests(w.hr)).filter((r) => r.employeeId === w.ids.emp);
    expect(req.changes.map((c) => c.field).sort()).toEqual(['address', 'phone']);
    expect((await getEmployee(empCtx, w.ids.emp, { audit: false }))?.pendingValues?.phone).toBe('700');
    // Volver al valor actual saca ese campo.
    await updateEmployee(empCtx, w.ids.emp, { phone: cur.phone ?? '' });
    expect((await listChangeRequests(w.hr)).find((r) => r.employeeId === w.ids.emp)?.changes.map((c) => c.field)).toEqual(['address']);
    // HR cambia el dato: aprobar pide confirmar.
    await updateEmployee(w.hr, w.ids.emp, { personal: { address: 'De HR' } });
    const [stale] = (await listChangeRequests(w.hr)).filter((r) => r.employeeId === w.ids.emp);
    expect(stale.stale).toBe(true);
    await expect(decideChange(w.hr, stale.id, 'approve')).rejects.toMatchObject({ code: 'stale_change' });
    await decideChange(w.hr, stale.id, 'approve', '', true);
    expect((await getEmployee(w.hr, w.ids.emp, { audit: false }))?.personal?.address).toBe('Otra 2');
    await updateSettings(w.hr, { approveChanges: false });
  });

  it('un pedido que no corresponde no deja nada en la cola', async () => {
    await updateSettings(w.hr, { approveChanges: true });
    const empCtx = await pctx(w, 'emp');
    await expect(updateEmployee(empCtx, w.ids.emp, { phone: '999', jobTitle: 'CEO' })).rejects.toMatchObject({ status: 403 });
    await expect(updateEmployee(empCtx, w.ids.emp, { phone: '999', custom: { x: 'y' } })).rejects.toMatchObject({ status: 403 });
    expect((await listChangeRequests(w.hr)).filter((r) => r.employeeId === w.ids.emp)).toEqual([]);
    await updateSettings(w.hr, { approveChanges: false });
  });

  it('el documento de identidad sigue sin poder editarse por uno mismo', async () => {
    await updateSettings(w.hr, { approveChanges: true });
    await expect(updateEmployee(await pctx(w, 'emp'), w.ids.emp, { personal: { nationalId: '123' } })).rejects.toMatchObject({ status: 403 });
    await updateSettings(w.hr, { approveChanges: false });
  });
});

describe('People: importar, cumpleaños, reportes y encuestas', () => {
  let w: PeopleWorld;
  beforeAll(async () => {
    w = await peopleWorld();
  });

  it('importar es de HR, primero muestra y después crea y actualiza', async () => {
    const email = `imp-${uid()}@example.com`;
    const csv = `Name,Work email,Job title,Manager\nIma,${email},Dev,\nUna,una-${uid()}@example.com,QA,${email}\n,bad,,\n`;
    await expect(importEmployees(await pctx(w, 'emp'), { csv, dryRun: true })).rejects.toMatchObject({ status: 403 });
    const before = (await listEmployees(w.hr)).length;
    const dry = await importEmployees(w.hr, { csv, dryRun: true });
    expect(dry).toMatchObject({ creates: 2, updates: 0 });
    expect(dry.failed).toEqual([{ line: 4, code: 'name_required' }]);
    expect((await listEmployees(w.hr)).length).toBe(before);
    const real = await importEmployees(w.hr, { csv, dryRun: false });
    expect(real).toMatchObject({ created: 2, updated: 0 });
    const list = await listEmployees(w.hr);
    const ima = list.find((e) => e.workEmail === email)!;
    expect(list.find((e) => e.name === 'Una')?.managerId).toBe(ima.id);
    const again = await importEmployees(w.hr, { csv: `Name,Work email,Job title\nIma,${email},Lead\n`, dryRun: false });
    expect(again).toMatchObject({ created: 0, updated: 1 });
    expect((await getEmployee(w.hr, ima.id, { audit: false }))?.jobTitle).toBe('Lead');
  });

  it('cumpleaños y aniversarios respetan la visibilidad y no muestran el año de nacimiento', async () => {
    const asOf = '2026-11-01';
    await updateEmployee(w.hr, w.ids.emp, { personal: { birthDate: '1990-11-20' } });
    const peer = await pctx(w, 'peer');
    let list = await celebrations(peer, 30, asOf);
    expect(list.find((c) => c.kind === 'birthday' && c.employeeId === w.ids.emp)?.date).toBe('2026-11-20');
    expect(list.find((c) => c.kind === 'anniversary' && c.employeeId === w.ids.emp)).toMatchObject({ date: '2026-11-10', years: 6 });
    expect(JSON.stringify(list)).not.toContain('1990');
    await updateSettings(w.hr, { visibility: { birthday: 'hr', startDate: 'managers' } });
    list = await celebrations(await pctx(w, 'peer'), 30, asOf);
    expect(list.filter((c) => c.employeeId === w.ids.emp)).toEqual([]);
    const boss = await celebrations(await pctx(w, 'boss'), 30, asOf);
    expect(boss.filter((c) => c.employeeId === w.ids.emp).map((c) => c.kind)).toEqual(['anniversary']);
    expect(await celebrations(w.hr, 30, asOf)).not.toEqual([]);
    await updateSettings(w.hr, { visibility: { birthday: 'everyone', startDate: 'everyone' } });
  });

  it('el período de pago en un reporte es de quien lee sueldos', async () => {
    const admin = await peopleContext(w.owner, w.users.boss, 'admin');
    expect(admin.viewer.hr).toBe(true);
    expect(admin.viewer.comp).not.toBe(true);
    const asAdmin = await runReport(admin, { columns: ['name', 'payPeriod'] });
    expect(asAdmin.columns.map((c) => c.key)).toEqual(['name']);
    await expect(runReport(admin, { columns: ['payPeriod'] })).rejects.toMatchObject({ code: 'report_columns' });
    expect((await runReport(w.hr, { columns: ['name', 'payPeriod'] })).columns.map((c) => c.key)).toEqual(['name', 'payPeriod']);
  });

  it('el manager de un reporte no se suma a sí mismo de par', async () => {
    const cycle = await createCycle(w.hr, { name: `S ${uid()}`, selfReview: true });
    await launchCycle(w.hr, cycle.id);
    await expect(addPeerReviewer(await pctx(w, 'boss'), cycle.id, w.ids.emp, w.ids.boss)).rejects.toMatchObject({ code: 'invalid_reviewer' });
  });

  it('importar: la vista previa y la corrida dicen lo mismo, también con un manager que no existe', async () => {
    const csv = `Name,Work email,Manager\nUno,uno-${uid()}@example.com,nadie@nowhere.io\n`;
    const dry = await importEmployees(w.hr, { csv, dryRun: true });
    const real = await importEmployees(w.hr, { csv, dryRun: false });
    expect(dry.failed).toEqual([{ line: 2, code: 'invalid_manager' }]);
    expect(real.failed).toEqual(dry.failed);
    expect(real).toMatchObject({ created: 0 });
  });

  it('reporte a medida: solo HR, columnas conocidas, sin sueldos y auditado al exportar', async () => {
    await expect(runReport(await pctx(w, 'boss'), { columns: ['name'] })).rejects.toMatchObject({ status: 403 });
    await expect(runReport(w.hr, { columns: ['salary', 'personal'] })).rejects.toMatchObject({ code: 'report_columns' });
    const r = await runReport(w.hr, { columns: ['name', 'department', 'salary'], department: 'Sales' });
    expect(r.columns.map((c) => c.key)).toEqual(['name', 'department']);
    expect(r.rows.every((row) => row[1] === 'Sales')).toBe(true);
    expect(await reportCsv(w.hr, { columns: ['name'] })).toContain('name\n');
    const audited = await getDb().prepare("SELECT 1 AS x FROM people_audit WHERE workspace_id = ? AND field = 'custom-report'").get(w.owner);
    expect(audited).toBeTruthy();
  });

  it('eNPS: anónimo, una vez por persona; resultado solo al cerrar y desde el mínimo', async () => {
    await expect(createSurvey(await pctx(w, 'emp'), 'x')).rejects.toMatchObject({ status: 403 });
    const id = await createSurvey(w.hr, 'Recomendarías?');
    const emp = await pctx(w, 'emp');
    await answerSurvey(emp, id, { score: 10, comment: 'muy bien' });
    await expect(answerSurvey(emp, id, { score: 1 })).rejects.toMatchObject({ code: 'already_answered' });
    await expect(answerSurvey(await pctx(w, 'peer'), id, { score: 11 })).rejects.toMatchObject({ code: 'invalid_number' });
    await answerSurvey(await pctx(w, 'peer'), id, { score: 3 });
    await answerSurvey(await pctx(w, 'boss'), id, { score: 8 });
    await answerSurvey(await pctx(w, 'hrp'), id, { score: 9 });
    await answerSurvey(w.hr, id, { score: 7 });
    expect(SURVEY_MIN_RESPONSES).toBe(5);
    // Abierta: cuántos respondieron, nada más, aunque ya alcance el mínimo.
    let hr = (await listSurveys(w.hr)).find((s) => s.id === id)!;
    expect(hr).toMatchObject({ responses: 5, score: null, comments: [] });
    await closeSurvey(w.hr, id);
    hr = (await listSurveys(w.hr)).find((s) => s.id === id)!;
    expect(hr).toMatchObject({ responses: 5, score: 20, promoters: 2, detractors: 1, comments: ['muy bien'] });
    expect((await listSurveys(emp)).find((s) => s.id === id)).toBeUndefined();
    const few = await createSurvey(w.hr, 'Pocas');
    await answerSurvey(emp, few, { score: 10 });
    await closeSurvey(w.hr, few);
    expect((await listSurveys(w.hr)).find((s) => s.id === few)).toMatchObject({ responses: 1, score: null });
    const cols = (await getDb().prepare('SELECT * FROM people_survey_responses WHERE survey_id = ? LIMIT 1').get(id)) as Record<string, unknown>;
    expect(Object.keys(cols).sort()).toEqual(['comment', 'id', 'score', 'survey_id']);
  });

  it('borrar una encuesta de otro workspace no toca nada; quien se fue no responde', async () => {
    const other = await peopleWorld();
    const id = await createSurvey(other.hr, 'Ajena');
    await answerSurvey(await pctx(other, 'emp'), id, { score: 9 });
    expect(await deleteSurvey(w.hr, id)).toBe(false);
    expect(((await getDb().prepare('SELECT COUNT(*) AS n FROM people_survey_responses WHERE survey_id = ?').get(id)) as { n: number }).n).toBe(1);
    expect(((await getDb().prepare('SELECT COUNT(*) AS n FROM people_survey_participants WHERE survey_id = ?').get(id)) as { n: number }).n).toBe(1);
    expect(await deleteSurvey(other.hr, id)).toBe(true);
    expect(((await getDb().prepare('SELECT COUNT(*) AS n FROM people_survey_responses WHERE survey_id = ?').get(id)) as { n: number }).n).toBe(0);
    const open = await createSurvey(other.hr, 'Abierta');
    const peer = await pctx(other, 'peer');
    await updateEmployee(other.hr, other.ids.peer, { status: 'terminated' });
    await expect(answerSurvey(peer, open, { score: 5 })).rejects.toMatchObject({ status: 403 });
  });

  it('pares a mano: HR o la cadena, en un ciclo activo', async () => {
    const cycle = await createCycle(w.hr, { name: `C ${uid()}`, selfReview: true });
    await expect(addPeerReviewer(w.hr, cycle.id, w.ids.emp, w.ids.peer)).rejects.toMatchObject({ code: 'cycle_not_active' });
    await launchCycle(w.hr, cycle.id);
    await expect(addPeerReviewer(await pctx(w, 'peer'), cycle.id, w.ids.emp, w.ids.peer)).rejects.toMatchObject({ status: 403 });
    await expect(addPeerReviewer(await pctx(w, 'boss'), cycle.id, w.ids.emp, w.ids.emp)).rejects.toMatchObject({ code: 'invalid_reviewer' });
    await addPeerReviewer(await pctx(w, 'boss'), cycle.id, w.ids.emp, w.ids.peer);
    await expect(addPeerReviewer(w.hr, cycle.id, w.ids.emp, w.ids.peer)).rejects.toMatchObject({ code: 'already_reviewer' });
  });

  it('una política con alcance no aparece ni se puede pedir fuera de él', async () => {
    const pol = await createPolicy(w.hr, { name: `Solo MX ${uid()}`, kind: 'other', accrual: 'annual', daysPerYear: 5, appliesTo: { countries: ['MX'] }, levels: [{ afterYears: 2, daysPerYear: 7 }] });
    expect((await listPolicies(w.owner)).find((p) => p.id === pol.id)?.levels).toEqual([{ afterYears: 2, daysPerYear: 7 }]);
    const emp = await pctx(w, 'emp');
    expect((await balancesFor(emp, w.ids.emp)).some((b) => b.policy.id === pol.id)).toBe(false);
    await expect(createRequest(emp, { policyId: pol.id, startDate: '2099-03-02' })).rejects.toMatchObject({ code: 'invalid_policy' });
    await updateEmployee(w.hr, w.ids.emp, { country: 'MX' });
    expect((await balancesFor(emp, w.ids.emp)).some((b) => b.policy.id === pol.id)).toBe(true);
    await expect(createPolicy(w.hr, { name: 'x', levels: [{ afterYears: 0, daysPerYear: 2 }] })).rejects.toMatchObject({ code: 'invalid_number' });
  });
});

describe('People: cambios con fecha futura', () => {
  let w: PeopleWorld;
  beforeAll(async () => {
    w = await peopleWorld();
  });

  it('solo HR, fecha futura y al menos un cambio', async () => {
    await expect(scheduleChange(await pctx(w, 'boss'), w.ids.emp, { effectiveDate: '2099-01-01', changes: { jobTitle: 'X' } })).rejects.toMatchObject({ status: 403 });
    await expect(listScheduled(await pctx(w, 'emp'), w.ids.emp)).rejects.toMatchObject({ status: 403 });
    await expect(scheduleChange(w.hr, w.ids.emp, { effectiveDate: '2000-01-01', changes: { jobTitle: 'X' } })).rejects.toMatchObject({ code: 'invalid_dates' });
    await expect(scheduleChange(w.hr, w.ids.emp, { effectiveDate: '2099-01-01', changes: {} })).rejects.toMatchObject({ code: 'nothing_to_change' });
  });

  it('el cron aplica lo vencido una sola vez, deja historial y no adelanta lo futuro', async () => {
    await scheduleChange(w.hr, w.ids.emp, { effectiveDate: '2098-06-01', changes: { jobTitle: 'Director' } });
    await scheduleChange(w.hr, w.ids.peer, { effectiveDate: '2099-06-01', changes: { jobTitle: 'Later' } });
    expect((await getEmployee(w.hr, w.ids.emp, { audit: false }))?.jobTitle).not.toBe('Director');
    const first = await applyDueChanges('2098-06-01');
    expect(first.applied).toBeGreaterThanOrEqual(1);
    expect((await getEmployee(w.hr, w.ids.emp, { audit: false }))?.jobTitle).toBe('Director');
    expect((await listJobHistory(w.hr, w.ids.emp)).some((h) => h.to === 'Director')).toBe(true);
    expect((await listScheduled(w.hr, w.ids.emp))[0].status).toBe('applied');
    expect((await getEmployee(w.hr, w.ids.peer, { audit: false }))?.jobTitle).not.toBe('Later');
    const again = await getDb().prepare("SELECT COUNT(*) AS n FROM people_scheduled_changes WHERE employee_id = ? AND status = 'pending'").get(w.ids.emp) as { n: number };
    expect(Number(again.n)).toBe(0);
  });

  it('una fila trabada en applying se reintenta', async () => {
    await scheduleChange(w.hr, w.ids.hrp, { effectiveDate: '2098-05-01', changes: { jobTitle: 'Stuck' } });
    await getDb().prepare("UPDATE people_scheduled_changes SET status = 'applying', applied_at = ? WHERE employee_id = ? AND effective_date = '2098-05-01'").run(new Date(Date.now() - 3_600_000).toISOString(), w.ids.hrp);
    await applyDueChanges('2098-05-01');
    expect((await getEmployee(w.hr, w.ids.hrp, { audit: false }))?.jobTitle).toBe('Stuck');
  });

  it('uno que no se puede aplicar queda marcado, sin frenar a los demás', async () => {
    await scheduleChange(w.hr, w.ids.boss, { effectiveDate: '2098-07-01', changes: { managerId: w.ids.emp } });
    await scheduleChange(w.hr, w.ids.hrp, { effectiveDate: '2098-07-01', changes: { department: 'Ops' } });
    await applyDueChanges('2098-07-01');
    expect((await listScheduled(w.hr, w.ids.boss))[0]).toMatchObject({ status: 'failed', error: 'manager_cycle' });
    expect((await getEmployee(w.hr, w.ids.hrp, { audit: false }))?.department).toBe('Ops');
  });

  it('se cancela mientras esté pendiente', async () => {
    const id = await scheduleChange(w.hr, w.ids.peer, { effectiveDate: '2099-08-01', changes: { department: 'X' } });
    expect(await cancelScheduled(w.hr, id)).toBe(true);
    expect(await cancelScheduled(w.hr, id)).toBe(false);
  });
});

// ---------- Con la base: Hiring ----------

interface HiringWorld {
  owner: HiringActor;
  recruiter: HiringActor;
  interviewer: HiringActor;
  outsider: HiringActor;
  approver: HiringActor;
  handle: string;
}

async function hiringWorld(): Promise<HiringWorld> {
  const owner = await upsertUser({ email: `hh-owner-${uid()}@example.com`, name: 'Owner', image: null });
  const team = await ensureWorkspace(owner.id);
  const person = async (name: string): Promise<HiringActor> => {
    const u = await upsertUser({ email: `hh-${name}-${uid()}@example.com`, name, image: null });
    await addMember(team.id, u.id, 'member');
    await getDb().prepare('UPDATE team_members SET apps = ? WHERE team_id = ? AND user_id = ?').run('["hiring"]', team.id, u.id);
    return { ws: owner.id, person: u.id, admin: false };
  };
  const actor: HiringActor = { ws: owner.id, person: owner.id, admin: true };
  const settings = await ensureSettings(owner.id, 'en');
  await updateHiringSettings(actor, { published: true });
  return { owner: actor, recruiter: await person('recruiter'), interviewer: await person('interviewer'), outsider: await person('outsider'), approver: await person('approver'), handle: settings.handle };
}

async function jobFor(w: HiringWorld, extra: Record<string, unknown> = {}) {
  const d = await createJob(w.owner, { title: `Role ${uid()}`, description: 'Do things', salaryMin: 1000, salaryMax: 2000, ...extra });
  await setTeam(w.owner, d.job.id, [
    { userId: w.recruiter.person, role: 'recruiter' },
    { userId: w.interviewer.person, role: 'interviewer' },
  ]);
  return d.job;
}

function toolCtx(a: HiringActor): ToolCtx {
  return { workspaceId: a.ws, personId: a.person, isAdmin: a.admin, user: { id: a.ws, role: a.admin ? 'owner' : 'member' } } as unknown as ToolCtx;
}

describe('Hiring: quién ve qué puesto', () => {
  let w: HiringWorld;
  beforeAll(async () => {
    w = await hiringWorld();
  });

  it('borradores y cerrados no existen fuera del equipo, en ninguna lectura', async () => {
    const draft = await jobFor(w);
    expect((await listJobs(w.outsider, { status: 'all' })).some((j) => j.id === draft.id)).toBe(false);
    expect(await getJob(w.outsider, draft.id)).toBeNull();
    expect((await searchHiring(w.outsider, draft.title)).length).toBe(0);
    const tool = hiringTools.find((t) => t.name === 'hiring_jobs')! as { run: (c: ToolCtx, i: unknown) => Promise<unknown> };
    const res = (await tool.run(toolCtx(w.outsider), { query: draft.title })) as { jobs: unknown[] };
    expect(res.jobs).toEqual([]);
    expect((await listJobs(w.interviewer, { status: 'all' })).some((j) => j.id === draft.id)).toBe(true);
  });

  it('publicado: título y aviso, sin salario oculto, equipo, etapas ni reglas de knock-out', async () => {
    const q: Question[] = [{ id: 'visa', label: 'Visa?', type: 'yesno', required: true, options: [], knockout: { accepted: ['yes'], min: null, autoReject: false } }];
    const job = await jobFor(w, { questions: q });
    await updateJob(w.recruiter, job.id, { status: 'published' });
    const listed = (await listJobs(w.outsider)).find((j) => j.id === job.id)!;
    expect(listed).toMatchObject({ salaryMin: null, salaryMax: null, questions: [], activeCount: null, canManage: false });
    const d = (await getJob(w.outsider, job.id))!;
    expect(d.team).toEqual([]);
    expect(d.stages).toEqual([]);
    expect(d.job.salaryMax).toBeNull();
    const i = (await getJob(w.interviewer, job.id))!;
    expect(i.job.salaryMax).toBeNull();
    expect(i.team.length).toBe(2);
    expect((await getJob(w.recruiter, job.id))!.job.salaryMax).toBe(2000);
  });

  it('confidencial: fuera de la página de empleos, del feed, de postular y de quien no integra el equipo', async () => {
    const job = await jobFor(w, { confidential: true });
    await updateJob(w.recruiter, job.id, { status: 'published' });
    expect((await publishedJobs(w.owner.ws)).some((j) => j.id === job.id)).toBe(false);
    expect(await publishedJob(w.owner.ws, job.slug)).toBeNull();
    expect(await careersFeed(w.handle, (m) => m)).not.toContain(job.title);
    expect(await getJob(w.outsider, job.id)).toBeNull();
    expect((await listJobs(w.outsider)).some((j) => j.id === job.id)).toBe(false);
    await expect(applyPublic(w.handle, job.slug, { name: 'A', email: `a-${uid()}@x.co`, phone: '', linkedin: '', answers: {}, consent: true, keepConsent: false, utm: {}, referrer: '', source: null }, { bytes: Buffer.from('%PDF-1.4'), filename: 'a.pdf' })).rejects.toMatchObject({ status: 404 });
  });

  it('el reporte de puestos abiertos no cuenta candidatos de puestos ajenos', async () => {
    const job = await jobFor(w);
    await updateJob(w.recruiter, job.id, { status: 'published' });
    await addCandidateManually(w.recruiter, { jobId: job.id, name: 'Carla', email: `c-${uid()}@x.co`, source: 'manual' }, null);
    expect((await hiringReport(w.outsider, {})).openJobs).toEqual([]);
    expect((await hiringReport(w.recruiter, {})).openJobs.some((j) => j.id === job.id && j.total === 1)).toBe(true);
  });

  it('el feed publica lo público y escapa', async () => {
    const job = await jobFor(w, { title: `A & B ]]> ${uid()}`, salaryPublic: false });
    await updateJob(w.recruiter, job.id, { status: 'published' });
    const xml = (await careersFeed(w.handle, (m) => m))!;
    expect(xml).toContain('<referencenumber>');
    expect(xml).toContain(']]]]><![CDATA[>');
    expect(await careersFeed('no-such-handle', (m) => m)).toBeNull();
  });
});

describe('Hiring: importar, copiar, fusionar y exportar', () => {
  let w: HiringWorld;
  beforeAll(async () => {
    w = await hiringWorld();
  });

  it('importar pide gestionar el puesto y no le manda nada a nadie', async () => {
    const job = await jobFor(w);
    const csv = `Name,Email\nAna,ana-${uid()}@x.co\n,sin@x.co\n`;
    await expect(importCandidates(w.outsider, job.id, { csv, dryRun: true })).rejects.toMatchObject({ status: 403 });
    await expect(importCandidates(w.interviewer, job.id, { csv, dryRun: true })).rejects.toMatchObject({ status: 403 });
    expect(await importCandidates(w.recruiter, job.id, { csv, dryRun: true })).toMatchObject({ dryRun: true, valid: 1 });
    expect(await importCandidates(w.recruiter, job.id, { csv, dryRun: false })).toMatchObject({ added: 1, existing: 0, failed: [{ line: 3, code: 'name_required' }] });
    const events = (await getDb().prepare("SELECT COUNT(*) AS n FROM hiring_events WHERE workspace_id = ? AND kind = 'email_out'").get(w.owner.ws)) as { n: number };
    expect(Number(events.n)).toBe(0);
  });

  it('un email de otro puesto no se une al importar: no sirve para leer a un candidato ajeno', async () => {
    const [a, b] = [await jobFor(w), await createJob(w.owner, { title: `Other ${uid()}` })];
    const email = `shared-${uid()}@x.co`;
    const secret = await addCandidateManually(w.owner, { jobId: b.job.id, name: 'Secreto', email, source: 'manual' }, null);
    await importCandidates(w.recruiter, a.id, { csv: `Name,Email\nOtro,${email}\n`, dryRun: false });
    expect(await getCandidateProfile(w.recruiter, secret.candidateId)).toBeNull();
  });

  it('copiar pide gestionar los dos puestos; mover retira la original', async () => {
    const [a, b] = [await jobFor(w), await jobFor(w)];
    await expect(copyToJob(w.recruiter, (await addCandidateManually(w.recruiter, { jobId: a.id, name: 'Dft', email: `d-${uid()}@x.co`, source: 'manual' }, null)).applicationId, { jobId: b.id, move: false })).rejects.toMatchObject({ code: 'job_not_open' });
    await updateJob(w.recruiter, b.id, { status: 'published' });
    const other = (await createJob(w.owner, { title: `Foreign ${uid()}`, description: 'x', status: 'published' })).job;
    const c = await addCandidateManually(w.recruiter, { jobId: a.id, name: 'Mia', email: `m-${uid()}@x.co`, source: 'manual' }, null);
    await expect(copyToJob(w.recruiter, c.applicationId, { jobId: other.id, move: false })).rejects.toMatchObject({ status: 403 });
    await expect(copyToJob(w.interviewer, c.applicationId, { jobId: b.id, move: false })).rejects.toMatchObject({ status: 404 });
    const res = await copyToJob(w.recruiter, c.applicationId, { jobId: b.id, move: true });
    const apps = await listApplications(w.recruiter, { q: 'Mia', status: 'all' });
    expect(apps.find((x) => x.id === c.applicationId)?.status).toBe('withdrawn');
    expect(apps.find((x) => x.id === res.applicationId)?.jobId).toBe(b.id);
    await expect(copyToJob(w.recruiter, res.applicationId, { jobId: b.id, move: false })).rejects.toMatchObject({ code: 'same_job' });
  });

  it('mover a un puesto confidencial no deja su título en el puesto de origen', async () => {
    const [a, secret] = [await jobFor(w), await jobFor(w, { confidential: true })];
    await updateJob(w.recruiter, secret.id, { status: 'published' });
    await setTeam(w.owner, secret.id, [{ userId: w.outsider.person, role: 'recruiter' }, { userId: w.recruiter.person, role: 'recruiter' }]);
    const c = await addCandidateManually(w.recruiter, { jobId: a.id, name: 'Sec', email: `s-${uid()}@x.co`, source: 'manual' }, null);
    await copyToJob(w.recruiter, c.applicationId, { jobId: secret.id, move: true });
    const events = (await getDb().prepare("SELECT data FROM hiring_events WHERE application_id = ? AND kind = 'stage'").all(c.applicationId)) as Array<{ data: string }>;
    expect(events.some((e) => e.data.includes('movedJob'))).toBe(true);
    expect(JSON.stringify(events)).not.toContain(secret.title);
  });

  it('fusionar en el mismo puesto: queda la etapa más avanzada y se muda lo de la otra', async () => {
    const job = await jobFor(w);
    const email = `f-${uid()}@x.co`;
    const stages = await listStages(job.id);
    const k = await addCandidateManually(w.owner, { jobId: job.id, name: 'K', email, source: 'manual' }, null);
    const d = await addCandidateManually(w.owner, { jobId: job.id, name: 'D', email: `2${email}`, source: 'manual' }, null);
    const later = stages[2];
    await getDb().prepare('UPDATE hiring_applications SET stage_id = ? WHERE id = ?').run(later.id, d.applicationId);
    await createOffer(w.owner, d.applicationId, { salary: 1, currency: 'USD', startDate: null, templateId: null, body: 'Hi' });
    await mergeCandidates(w.owner, k.candidateId, d.candidateId);
    const p = (await getCandidateProfile(w.owner, k.candidateId))!;
    expect(p.applications).toHaveLength(1);
    expect(p.applications[0].stageId).toBe(later.id);
    expect(((await getDb().prepare('SELECT COUNT(*) AS n FROM hiring_offers WHERE application_id = ?').get(k.applicationId)) as { n: number }).n).toBe(1);
  });

  it('un nombre es una línea', async () => {
    const job = await jobFor(w);
    expect(readCandidateCsv('Name,Email\n"Ana\nBel",a@x.co\n').rows[0].name).toBe('Ana Bel');
    const c = await addCandidateManually(w.recruiter, manualAddSchema.parse({ jobId: job.id, name: 'Una\r\nDos', email: `l-${uid()}@x.co` }), null);
    expect((await getCandidateProfile(w.recruiter, c.candidateId))?.candidate.name).toBe('Una Dos');
  });

  it('una postulación retirada no se mueve ni se rechaza', async () => {
    const [a, b] = [await jobFor(w), await jobFor(w)];
    await updateJob(w.recruiter, b.id, { status: 'published' });
    const c = await addCandidateManually(w.recruiter, { jobId: a.id, name: 'Wd', email: `w-${uid()}@x.co`, source: 'manual' }, null);
    await copyToJob(w.recruiter, c.applicationId, { jobId: b.id, move: true });
    const stages = await listStages(a.id);
    await expect(moveApplication(w.recruiter, c.applicationId, stages[1].id)).rejects.toMatchObject({ code: 'application_withdrawn' });
    await expect(rejectApplication(w.recruiter, c.applicationId, { reason: '', sendEmail: false, templateId: null })).rejects.toMatchObject({ code: 'application_withdrawn' });
  });

  it('fusionar exige gestionar todas las postulaciones de los dos', async () => {
    const job = await jobFor(w);
    const foreign = (await createJob(w.owner, { title: `F ${uid()}` })).job;
    const email = `dup-${uid()}@x.co`;
    const keep = await addCandidateManually(w.owner, { jobId: job.id, name: 'Keep', email, source: 'manual', tags: ['a'] }, null);
    const drop = await addCandidateManually(w.owner, { jobId: foreign.id, name: 'Drop', email: `2${email}`, source: 'manual', phone: '555', tags: ['b'] }, null);
    await expect(mergeCandidates(w.recruiter, keep.candidateId, drop.candidateId)).rejects.toMatchObject({ status: 403 });
    await mergeCandidates(w.owner, keep.candidateId, drop.candidateId);
    const p = (await getCandidateProfile(w.owner, keep.candidateId))!;
    expect(p.applications).toHaveLength(2);
    expect(p.candidate.tags.sort()).toEqual(['a', 'b']);
    expect(p.candidate.phone).toBe('555');
    expect(await getCandidateProfile(w.owner, drop.candidateId)).toBeNull();
  });

  it('el CSV solo trae lo que la persona ve y neutraliza fórmulas', async () => {
    const job = await jobFor(w);
    const name = `=cmd${uid()}`;
    await addCandidateManually(w.recruiter, { jobId: job.id, name, email: `f-${uid()}@x.co`, source: 'manual' }, null);
    expect(await applicationsCsv(w.outsider, { status: 'all' })).not.toContain(name);
    expect(await applicationsCsv(w.recruiter, { status: 'all' })).toContain(`'${name}`);
  });

  it('una knock-out que rechaza sola: entra rechazada, con motivo y reactivable', async () => {
    const q: Question[] = [{ id: 'v', label: 'Visa?', type: 'yesno', required: true, options: [], knockout: { accepted: ['yes'], min: null, autoReject: true } }];
    const job = await jobFor(w, { questions: q });
    await updateJob(w.recruiter, job.id, { status: 'published' });
    const base = { name: 'K', phone: '', linkedin: '', consent: true, keepConsent: false, utm: {}, referrer: '', source: null };
    const pdf = () => ({ bytes: Buffer.from('%PDF-1.4 test'), filename: 'cv.pdf' });
    const no = await applyPublic(w.handle, job.slug, { ...base, email: `no-${uid()}@x.co`, answers: { v: 'no' } }, pdf());
    const yes = await applyPublic(w.handle, job.slug, { ...base, email: `yes-${uid()}@x.co`, answers: { v: 'yes' } }, pdf());
    const apps = await listApplications(w.recruiter, { jobId: job.id, status: 'all' });
    expect(apps.find((a) => a.id === no.applicationId)?.status).toBe('rejected');
    expect(apps.find((a) => a.id === yes.applicationId)?.status).toBe('active');
    const report = await hiringReport(w.recruiter, { jobId: job.id });
    expect(report.rejectReasons).toEqual([{ reason: 'knockout', count: 1 }]);
  });
});

describe('Hiring: cadenas de aprobación', () => {
  let w: HiringWorld;
  beforeAll(async () => {
    w = await hiringWorld();
    await updateHiringSettings(w.owner, { jobApprovers: [w.approver.person, w.owner.person], offerApprovers: [w.approver.person] });
  });

  it('nadie publica sin la cadena, tampoco un admin; cada uno decide en su turno', async () => {
    const job = await jobFor(w);
    await expect(updateJob(w.owner, job.id, { status: 'published' })).rejects.toMatchObject({ code: 'approval_required' });
    await expect(actOnJobApproval(w.outsider, job.id, { action: 'request', note: '' })).rejects.toMatchObject({ status: 403 });
    const req = await actOnJobApproval(w.recruiter, job.id, { action: 'request', note: '' });
    expect(req.status).toBe('pending');
    // El aprobador entra al equipo para poder ver el puesto.
    expect(await getJob(w.approver, job.id)).not.toBeNull();
    expect((await myPendingApprovals(w.approver)).some((a) => a.id === job.id)).toBe(true);
    expect((await myPendingApprovals(w.owner)).some((a) => a.id === job.id)).toBe(false);
    await expect(actOnJobApproval(w.owner, job.id, { action: 'approve', note: '' })).rejects.toMatchObject({ code: 'not_your_step' });
    await expect(actOnJobApproval(w.approver, job.id, { action: 'reject', note: ' ' })).rejects.toMatchObject({ code: 'reason_required' });
    await actOnJobApproval(w.approver, job.id, { action: 'approve', note: '' });
    expect((await myPendingApprovals(w.owner)).some((a) => a.id === job.id)).toBe(true);
    await expect(updateJob(w.owner, job.id, { status: 'published' })).rejects.toMatchObject({ code: 'approval_required' });
    expect((await actOnJobApproval(w.owner, job.id, { action: 'approve', note: '' })).status).toBe('approved');
    expect((await updateJob(w.recruiter, job.id, { status: 'published' })).job.status).toBe('published');
  });

  it('un rechazo corta la cadena; pedir de nuevo arranca de cero', async () => {
    const job = await jobFor(w);
    await actOnJobApproval(w.recruiter, job.id, { action: 'request', note: '' });
    expect((await actOnJobApproval(w.approver, job.id, { action: 'reject', note: 'No budget' })).status).toBe('rejected');
    await expect(actOnJobApproval(w.owner, job.id, { action: 'approve', note: '' })).rejects.toMatchObject({ status: 409 });
    expect((await actOnJobApproval(w.recruiter, job.id, { action: 'request', note: '' })).status).toBe('pending');
    expect((await listChain(w.owner.ws, 'job', job.id)).every((s) => s.status === 'pending')).toBe(true);
  });

  it('la oferta sigue su cadena y no se manda sin aprobar; un admin no la saltea', async () => {
    const job = await jobFor(w);
    const c = await addCandidateManually(w.recruiter, { jobId: job.id, name: 'Offer', email: `o-${uid()}@x.co`, source: 'manual' }, null);
    const offer = await createOffer(w.recruiter, c.applicationId, { salary: 100, currency: 'USD', startDate: null, templateId: null, body: 'Hi' });
    expect(offer.status).toBe('pending_approval');
    expect(offer.approval.map((s) => s.userId)).toEqual([w.approver.person]);
    await expect(actOnOffer(w.owner, offer.id, { action: 'approve', templateId: null, note: '' })).rejects.toMatchObject({ code: 'not_your_step' });
    await expect(actOnOffer(w.recruiter, offer.id, { action: 'send', templateId: null, note: '' })).rejects.toMatchObject({ code: 'offer_not_approved' });
    const done = await actOnOffer(w.approver, offer.id, { action: 'approve', templateId: null, note: '' });
    expect(done.offer.status).toBe('approved');
  });

  it('si el único aprobador es quien pide, se suma el owner: alguien más revisa', async () => {
    await updateHiringSettings(w.owner, { jobApprovers: [w.recruiter.person] });
    const job = await jobFor(w);
    const res = await actOnJobApproval(w.recruiter, job.id, { action: 'request', note: '' });
    expect(res.status).toBe('pending');
    expect(res.steps.map((s) => [s.userId, s.status, s.note])).toEqual([[w.recruiter.person, 'skipped', ''], [w.owner.person, 'pending', 'fallback']]);
    await expect(actOnJobApproval(w.recruiter, job.id, { action: 'approve', note: '' })).rejects.toMatchObject({ code: 'not_your_step' });
    await updateHiringSettings(w.owner, { jobApprovers: [w.approver.person, w.owner.person] });
  });

  it('cambiar título o salario después de aprobar pide aprobar de nuevo', async () => {
    const job = await jobFor(w);
    await actOnJobApproval(w.recruiter, job.id, { action: 'request', note: '' });
    await actOnJobApproval(w.approver, job.id, { action: 'approve', note: '' });
    await actOnJobApproval(w.owner, job.id, { action: 'approve', note: '' });
    expect((await updateJob(w.recruiter, job.id, { department: 'Ops' })).job.approvalStatus).toBe('approved');
    expect((await updateJob(w.recruiter, job.id, { salaryMax: 9999 })).job.approvalStatus).toBe('stale');
    await expect(updateJob(w.recruiter, job.id, { status: 'published' })).rejects.toMatchObject({ code: 'approval_required' });
    await actOnJobApproval(w.recruiter, job.id, { action: 'request', note: '' });
    await actOnJobApproval(w.approver, job.id, { action: 'approve', note: '' });
    await actOnJobApproval(w.owner, job.id, { action: 'approve', note: '' });
    await updateJob(w.recruiter, job.id, { status: 'published' });
    await expect(updateJob(w.recruiter, job.id, { title: 'Otro' })).rejects.toMatchObject({ code: 'close_to_edit' });
  });

  it('quien aprobaba y se va: su paso pasa al owner y sale de los ajustes', async () => {
    const job = await jobFor(w);
    await updateHiringSettings(w.owner, { jobApprovers: [w.approver.person] });
    await actOnJobApproval(w.recruiter, job.id, { action: 'request', note: '' });
    await reassignApprover(w.owner.ws, w.approver.person);
    expect((await listChain(w.owner.ws, 'job', job.id)).map((s) => [s.userId, s.note])).toEqual([[w.owner.person, 'reassigned']]);
    expect((await ensureSettings(w.owner.ws)).job_approvers).toBe('[]');
    await updateHiringSettings(w.owner, { jobApprovers: [w.approver.person, w.owner.person] });
  });

  it('quien arma la oferta no se aprueba a sí mismo: su paso queda salteado', async () => {
    await updateHiringSettings(w.owner, { offerApprovers: [w.recruiter.person, w.approver.person] });
    const job = await jobFor(w);
    const c = await addCandidateManually(w.recruiter, { jobId: job.id, name: 'Self', email: `s-${uid()}@x.co`, source: 'manual' }, null);
    const offer = await createOffer(w.recruiter, c.applicationId, { salary: 1, currency: 'USD', startDate: null, templateId: null, body: 'Hi' });
    expect(offer.approval.map((s) => s.status)).toEqual(['skipped', 'pending']);
    await updateHiringSettings(w.owner, { offerApprovers: [] });
  });
});

describe('Hiring: campos propios', () => {
  it('valores por tipo; lo no definido no entra; vacío borra', () => {
    const fields = [
      { id: 'n', label: 'N', type: 'number' as const, options: [], protected: false },
      { id: 'd', label: 'D', type: 'date' as const, options: [], protected: false },
      { id: 's', label: 'S', type: 'select' as const, options: ['a'], protected: true },
    ];
    expect(cleanCustomValues(fields, { n: '3', d: '2026-01-02', s: 'a', ghost: 'x' }, {})).toEqual({ n: '3', d: '2026-01-02', s: 'a' });
    expect(cleanCustomValues(fields, { n: '' }, { n: '3' })).toEqual({});
    for (const bad of [{ n: 'x' }, { d: '01/02/2026' }, { s: 'b' }]) expect(() => cleanCustomValues(fields, bad, {})).toThrow('invalid_field');
  });

  it('los protegidos no llegan a quien entrevista; editar es de quien gestiona', async () => {
    const w = await hiringWorld();
    await updateHiringSettings(w.owner, { candidateFields: [{ id: 'open', label: 'Open', type: 'text', options: [], protected: false }, { id: 'pay', label: 'Pay', type: 'text', options: [], protected: true }] });
    const job = await jobFor(w);
    const c = await addCandidateManually(w.recruiter, { jobId: job.id, name: 'F', email: `f-${uid()}@x.co`, source: 'manual' }, null);
    await updateCandidate(w.recruiter, c.candidateId, { custom: { open: 'yes', pay: '100' } });
    const rec = (await getCandidateProfile(w.recruiter, c.candidateId))!;
    expect(rec.customFields.map((f) => f.value)).toEqual(['yes', '100']);
    await getDb().prepare('INSERT INTO hiring_evaluators (application_id, user_id, stage_id, requested_at) VALUES (?, ?, ?, ?)').run(c.applicationId, w.interviewer.person, rec.applications[0].stageId, new Date().toISOString());
    const iv = (await getCandidateProfile(w.interviewer, c.candidateId))!;
    expect(iv.canEditCustom).toBe(false);
    expect(iv.customFields.map((f) => f.id)).toEqual(['open']);
    await expect(updateCandidate(w.interviewer, c.candidateId, { custom: { open: 'no' } })).rejects.toMatchObject({ status: 403 });
    await expect(updateHiringSettings(w.recruiter, { candidateFields: [] })).rejects.toMatchObject({ status: 403 });
  });
});

describe('Hiring: topes de email', () => {
  it('un acuse por dirección y por workspace al día, y tope por dirección', async () => {
    const u = await upsertUser({ email: `cap-${uid()}@example.com`, name: 'Cap', image: null });
    const to = `victim-${uid()}@x.co`;
    expect(await reserveCandidateMail(u.id, to, 'ack')).toBeNull();
    expect(await reserveCandidateMail(u.id, to.toUpperCase(), 'ack')).toBe('recipient_limit');
    const other = `other-${uid()}@x.co`;
    for (let i = 0; i < MAIL_CAPS.recipient; i++) expect(await reserveCandidateMail(u.id, other, 'custom')).toBeNull();
    expect(await reserveCandidateMail(u.id, other, 'custom')).toBe('recipient_limit');
  });

  it('un workspace nuevo tiene un tope más bajo', async () => {
    const u = await upsertUser({ email: `cap2-${uid()}@example.com`, name: 'Cap', image: null });
    let blocked = 0;
    for (let i = 0; i < MAIL_CAPS.newWorkspace + 2; i++) if (await reserveCandidateMail(u.id, `r${i}-${uid()}@x.co`, 'custom')) blocked++;
    expect(blocked).toBe(2);
  });
});

describe('De Hiring a People', () => {
  const event = (ws: string, applicationId: string) => ({
    workspaceId: ws,
    applicationId,
    hiredAt: new Date().toISOString(),
    hiredBy: null,
    candidate: { id: 'c', name: 'Nueva Persona', email: 'nueva@x.co', phone: '123', location: 'BA' },
    job: { id: 'j', title: 'Dev', department: 'Eng', location: '', workplace: 'remote', employmentType: 'contract' },
    offer: { title: 'Senior Dev', salary: 999, currency: 'USD', startDate: '2099-02-01' },
  });

  it('no enciende People si el workspace no lo usa', async () => {
    const u = await upsertUser({ email: `nop-${uid()}@example.com`, name: 'N', image: null });
    expect(await addHireToPeople(event(u.id, `app_${uid()}`))).toBeNull();
    expect(await getDb().prepare('SELECT 1 AS x FROM people_settings WHERE workspace_id = ?').get(u.id)).toBeUndefined();
  });

  it('de un puesto confidencial, la ficha no lleva título, área ni ubicación del puesto', async () => {
    const w = await peopleWorld();
    const e = event(w.owner, `app_${uid()}`);
    const id = await addHireToPeople({ ...e, candidate: { ...e.candidate, location: '' }, job: { ...e.job, title: 'CEO secreto', department: 'Board', location: 'HQ', confidential: true } });
    const row = (await getEmployee(w.hr, id!, { audit: false }))!;
    expect([row.jobTitle, row.department, row.location]).toEqual(['', '', '']);
    const notif = (await getDb().prepare("SELECT body FROM notifications WHERE source_id = ?").all(id!)) as Array<{ body: string | null }>;
    expect(JSON.stringify(notif)).not.toContain('CEO secreto');
  });

  it('crea la ficha en onboarding una sola vez, sin sueldo y con el email en lo personal', async () => {
    const w = await peopleWorld();
    const app = `app_${uid()}`;
    const id = await addHireToPeople(event(w.owner, app));
    expect(id).toBeTruthy();
    expect(await addHireToPeople(event(w.owner, app))).toBeNull();
    const row = (await getEmployee(w.hr, id!, { audit: false }))!;
    expect(row).toMatchObject({ status: 'onboarding', jobTitle: 'Senior Dev', department: 'Eng', startDate: '2099-02-01', employmentType: 'contractor' });
    expect(row.personal?.personalEmail).toBe('nueva@x.co');
    expect(row.workEmail).toBe('');
    expect(await getDb().prepare('SELECT 1 AS x FROM people_compensation WHERE employee_id = ?').get(id!)).toBeUndefined();
  });
});
