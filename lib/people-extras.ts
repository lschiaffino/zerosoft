/**
 * People: historial de puesto, aprobación de cambios, importación por CSV,
 * cumpleaños y aniversarios, bandeja de pendientes, reportes a medida, encuestas
 * eNPS y evaluadores pares elegidos a mano. Las reglas de quién ve qué siguen en
 * lib/people-access.ts. Server-only.
 */
import { getDb } from './db';
import { localized } from './notification-copy';
import { open as unseal, seal } from './secret-box';
import { parseCsv, toCsv } from './hr-csv';
import {
  audit,
  createEmployee,
  getEmployeeRow,
  listFields,
  newId,
  nowIso,
  parseJson,
  PeopleError,
  readPersonal,
  requireHr,
  today,
  updateEmployee,
  type EmployeeInput,
  type PeopleCtx,
} from './people';
import { canSeeField, canSeeSensitive, isManagerOf } from './people-access';
import { hrPeople, notifyPeople } from './people-effects';
import { addDays, isIsoDate, tenureYears } from './people-time';

const db = () => getDb();

// ---------- Historial de puesto ----------

export const TRACKED_FIELDS = ['jobTitle', 'department', 'location', 'managerId', 'employmentType', 'status'] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export interface JobHistoryEntry {
  id: string;
  field: TrackedField;
  from: string;
  to: string;
  date: string;
  actorName: string;
}

/** Una fila por campo que cambió. La llama updateEmployee con la ficha de antes y de después. */
export async function recordJobChanges(ws: string, employeeId: string, actorId: string, changes: Array<{ field: TrackedField; from: string; to: string }>): Promise<void> {
  const now = nowIso();
  for (const c of changes) {
    if (c.from === c.to) continue;
    await db()
      .prepare('INSERT INTO people_job_history (id, workspace_id, employee_id, field, old_value, new_value, effective_date, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId('jhi'), ws, employeeId, c.field, c.from, c.to, now.slice(0, 10), actorId, now);
  }
}

/** Es un dato de carrera: HR, la persona y su cadena de managers (como las evaluaciones). */
export async function listJobHistory(ctx: PeopleCtx, employeeId: string): Promise<JobHistoryEntry[]> {
  if (!canSeeSensitive(ctx.viewer, employeeId, 'performance')) throw new PeopleError('forbidden', 403);
  const rows = (await db()
    .prepare(
      `SELECT h.id, h.field, h.old_value, h.new_value, h.effective_date, COALESCE(u.name, u.email, '') AS actor_name
       FROM people_job_history h LEFT JOIN users u ON u.id = h.actor_id
       WHERE h.workspace_id = ? AND h.employee_id = ? ORDER BY h.created_at DESC LIMIT 200`,
    )
    .all(ctx.ws, employeeId)) as Array<Record<string, string>>;
  const managerIds = [...new Set(rows.filter((r) => r.field === 'managerId').flatMap((r) => [r.old_value, r.new_value]).filter(Boolean))];
  const names = new Map<string, string>();
  for (const id of managerIds) names.set(id, (await getEmployeeRow(ctx.ws, id))?.name ?? '');
  const show = (r: Record<string, string>, v: string) => (r.field === 'managerId' ? names.get(v) ?? '' : v);
  return rows.map((r) => ({ id: r.id, field: r.field as TrackedField, from: show(r, r.old_value), to: show(r, r.new_value), date: r.effective_date, actorName: r.actor_name }));
}

// ---------- Aprobación de cambios ----------

/** Lo que entra en la cola cuando HR pide aprobar los cambios de la propia ficha. */
export interface QueuedChange {
  phone?: string;
  personal?: Record<string, unknown>;
}

export interface ChangeRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  status: 'pending' | 'approved' | 'denied';
  changes: Array<{ field: string; before: string; after: string }>;
  createdAt: string;
  note: string;
}

export async function approvalsOn(ws: string): Promise<boolean> {
  const r = (await db().prepare('SELECT approve_changes FROM people_settings WHERE workspace_id = ?').get(ws)) as { approve_changes: number } | undefined;
  return Number(r?.approve_changes) === 1;
}

/** Deja el pedido pendiente (cifrado: lleva datos personales). Un pedido nuevo reemplaza al anterior. */
export async function queueChange(ctx: PeopleCtx, employeeId: string, change: QueuedChange): Promise<void> {
  const now = nowIso();
  await db().prepare("DELETE FROM people_change_requests WHERE workspace_id = ? AND employee_id = ? AND status = 'pending'").run(ctx.ws, employeeId);
  await db()
    .prepare("INSERT INTO people_change_requests (id, workspace_id, employee_id, requested_by, payload, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)")
    .run(newId('chg'), ctx.ws, employeeId, ctx.personId, seal(JSON.stringify(change)), now);
  const emp = await getEmployeeRow(ctx.ws, employeeId);
  const hr = (await hrPeople(ctx.ws)).filter((u) => u !== ctx.personId);
  await notifyPeople(hr, { title: localized('peopleChangeRequested', { name: emp?.name ?? '' }), href: '/app/people/settings?tab=changes', sourceId: employeeId });
}

export async function pendingChangeFor(ws: string, employeeId: string): Promise<boolean> {
  return Boolean(await db().prepare("SELECT 1 AS x FROM people_change_requests WHERE workspace_id = ? AND employee_id = ? AND status = 'pending'").get(ws, employeeId));
}

function readChange(payload: string): QueuedChange {
  return parseJson<QueuedChange>(unseal(payload), {});
}

function diffChange(row: { phone: string; personal: string }, change: QueuedChange): ChangeRequest['changes'] {
  const before = readPersonal(row.personal);
  const out: ChangeRequest['changes'] = [];
  if (change.phone !== undefined && change.phone !== row.phone) out.push({ field: 'phone', before: row.phone, after: String(change.phone) });
  for (const [k, v] of Object.entries(change.personal ?? {})) {
    const prev = (before as unknown as Record<string, unknown>)[k];
    const text = (x: unknown) => (Array.isArray(x) ? x.map((c: { name?: string; phone?: string }) => [c.name, c.phone].filter(Boolean).join(' ')).join(', ') : String(x ?? ''));
    if (text(prev) !== text(v)) out.push({ field: k, before: text(prev), after: text(v) });
  }
  return out;
}

/** Solo el número (para la bandeja y la pestaña): no lee datos personales ni deja rastro de auditoría. */
export async function countChangeRequests(ctx: PeopleCtx): Promise<number> {
  requireHr(ctx);
  const r = (await db().prepare("SELECT COUNT(*) AS n FROM people_change_requests WHERE workspace_id = ? AND status = 'pending'").get(ctx.ws)) as { n: number };
  return Number(r.n);
}

export async function listChangeRequests(ctx: PeopleCtx): Promise<ChangeRequest[]> {
  requireHr(ctx);
  const rows = (await db()
    .prepare(
      `SELECT c.id, c.employee_id, c.payload, c.status, c.note, c.created_at, e.name, e.phone, e.personal
       FROM people_change_requests c JOIN people_employees e ON e.id = c.employee_id
       WHERE c.workspace_id = ? AND c.status = 'pending' ORDER BY c.created_at LIMIT 100`,
    )
    .all(ctx.ws)) as Array<Record<string, string>>;
  for (const r of rows) await audit(ctx, 'view', 'personal:change-request', r.employee_id);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.name,
    status: 'pending' as const,
    changes: diffChange({ phone: r.phone, personal: r.personal }, readChange(r.payload)),
    createdAt: r.created_at,
    note: r.note,
  }));
}

/** Compare-and-set: dos personas de HR a la vez no aplican el cambio dos veces. */
export async function decideChange(ctx: PeopleCtx, id: string, decision: 'approve' | 'deny', note = ''): Promise<void> {
  requireHr(ctx);
  const r = (await db().prepare('SELECT employee_id, payload, requested_by FROM people_change_requests WHERE id = ? AND workspace_id = ?').get(id, ctx.ws)) as
    | { employee_id: string; payload: string; requested_by: string }
    | undefined;
  if (!r) throw new PeopleError('not_found', 404);
  // Nadie aprueba lo propio.
  if (r.requested_by === ctx.personId) throw new PeopleError('own_request', 403);
  const res = await db()
    .prepare("UPDATE people_change_requests SET status = ?, note = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
    .run(decision === 'approve' ? 'approved' : 'denied', note.slice(0, 500), ctx.personId, nowIso(), id);
  if (!res.changes) throw new PeopleError('not_pending', 409);
  if (decision === 'approve') await updateEmployee(ctx, r.employee_id, readChange(r.payload) as EmployeeInput);
  await notifyPeople([r.requested_by], { title: localized(decision === 'approve' ? 'peopleChangeApproved' : 'peopleChangeDeclined'), body: note.slice(0, 200) || undefined, href: `/app/people/${r.employee_id}`, sourceId: id });
}

// ---------- Importar ----------

const IMPORT_HEADERS: Record<string, keyof EmployeeInput | 'managerEmail'> = {
  name: 'name', nombre: 'name', nome: 'name', 'full name': 'name',
  email: 'workEmail', 'work email': 'workEmail', 'e-mail': 'workEmail', correo: 'workEmail',
  'job title': 'jobTitle', title: 'jobTitle', puesto: 'jobTitle', cargo: 'jobTitle',
  department: 'department', area: 'department', 'área': 'department', departamento: 'department',
  location: 'location', ubicacion: 'location', 'ubicación': 'location',
  country: 'country', pais: 'country', 'país': 'country',
  phone: 'phone', telefono: 'phone', 'teléfono': 'phone', telefone: 'phone',
  'start date': 'startDate', ingreso: 'startDate', 'fecha de ingreso': 'startDate', 'data de início': 'startDate',
  type: 'employmentType', 'employment type': 'employmentType', tipo: 'employmentType',
  manager: 'managerEmail', 'manager email': 'managerEmail',
};

export const MAX_EMPLOYEE_IMPORT = 1000;

export interface EmployeeImportRow {
  line: number;
  values: EmployeeInput & { managerEmail?: string };
  error: string | null;
}

export function readEmployeeCsv(text: string): { rows: EmployeeImportRow[]; missing: string[] } {
  const all = parseCsv(text);
  if (!all.length) return { rows: [], missing: ['name'] };
  const cols = all[0].map((h) => IMPORT_HEADERS[h.trim().toLowerCase()] ?? null);
  if (!cols.includes('name')) return { rows: [], missing: ['name'] };
  const seen = new Set<string>();
  const rows = all.slice(1, MAX_EMPLOYEE_IMPORT + 1).map((cells, i) => {
    const values: Record<string, string> = {};
    cols.forEach((c, j) => {
      const v = (cells[j] ?? '').trim();
      if (c && v) values[c] = v;
    });
    let error: string | null = null;
    const email = (values.workEmail ?? '').toLowerCase();
    if (!values.name) error = 'name_required';
    else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) error = 'invalid_email';
    else if (values.startDate && !isIsoDate(values.startDate)) error = 'invalid_date';
    else if (values.employmentType && !['full_time', 'part_time', 'contractor', 'intern'].includes(values.employmentType)) error = 'invalid_type';
    else if (email && seen.has(email)) error = 'duplicate_in_file';
    if (email) seen.add(email);
    return { line: i + 2, values: { ...values, ...(email ? { workEmail: email } : {}) }, error };
  });
  return { rows, missing: [] };
}

/** Con email de trabajo conocido actualiza esa ficha; si no, crea una. Los managers van después, por email. No invita a nadie. */
export async function importEmployees(ctx: PeopleCtx, input: { csv: string; dryRun: boolean }) {
  requireHr(ctx);
  const { rows, missing } = readEmployeeCsv(input.csv);
  if (missing.length) throw new PeopleError('csv_columns');
  if (!rows.length) throw new PeopleError('csv_empty');
  const existing = (await db().prepare('SELECT id, work_email FROM people_employees WHERE workspace_id = ?').all(ctx.ws)) as Array<{ id: string; work_email: string }>;
  const byEmail = new Map(existing.filter((e) => e.work_email).map((e) => [e.work_email.toLowerCase(), e.id]));
  const failed = rows.filter((r) => r.error).map((r) => ({ line: r.line, code: r.error as string }));
  const good = rows.filter((r) => !r.error);
  const updates = good.filter((r) => r.values.workEmail && byEmail.has(r.values.workEmail)).length;
  if (input.dryRun) return { dryRun: true, creates: good.length - updates, updates, failed, preview: good.slice(0, 5).map((r) => ({ name: r.values.name ?? '', workEmail: r.values.workEmail ?? '', jobTitle: r.values.jobTitle ?? '' })) };
  const managers: Array<{ id: string; email: string; line: number }> = [];
  let created = 0;
  let updated = 0;
  for (const r of good) {
    const { managerEmail, ...values } = r.values;
    try {
      const known = values.workEmail ? byEmail.get(values.workEmail) : undefined;
      const emp = known ? await updateEmployee(ctx, known, values) : await createEmployee(ctx, values);
      if (known) updated++;
      else created++;
      if (values.workEmail) byEmail.set(values.workEmail, emp.id);
      if (managerEmail) managers.push({ id: emp.id, email: managerEmail.toLowerCase(), line: r.line });
    } catch (err) {
      failed.push({ line: r.line, code: err instanceof PeopleError ? err.code : 'generic' });
    }
  }
  for (const m of managers) {
    const mgr = byEmail.get(m.email);
    if (!mgr) {
      failed.push({ line: m.line, code: 'invalid_manager' });
      continue;
    }
    await updateEmployee(ctx, m.id, { managerId: mgr }).catch((err: unknown) => failed.push({ line: m.line, code: err instanceof PeopleError ? err.code : 'generic' }));
  }
  return { dryRun: false, created, updated, failed };
}

// ---------- Cumpleaños y aniversarios ----------

export interface Celebration {
  kind: 'birthday' | 'anniversary';
  employeeId: string;
  name: string;
  photo: string;
  date: string;
  years: number | null;
}

/** Próxima fecha (YYYY-MM-DD) con ese mes y día, desde `from`. 29 de febrero cae el 28 en años comunes. */
export function nextOccurrence(monthDay: string, from: string): string {
  const year = Number(from.slice(0, 4));
  for (const y of [year, year + 1]) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const md = monthDay === '02-29' && !leap ? '02-28' : monthDay;
    const d = `${y}-${md}`;
    if (d >= from) return d;
  }
  return `${year + 1}-${monthDay}`;
}

/**
 * Lo que viene en los próximos días. Cumpleaños y aniversarios respetan la
 * visibilidad de Ajustes: si el campo no se ve, la fecha tampoco. Nunca sale el año de nacimiento.
 */
export async function celebrations(ctx: PeopleCtx, days = 30, asOf = today()): Promise<Celebration[]> {
  const rows = (await db().prepare("SELECT id, name, photo_url, updated_at, start_date, personal FROM people_employees WHERE workspace_id = ? AND status IN ('active', 'offboarding')").all(ctx.ws)) as Array<
    Record<string, string | null>
  >;
  const until = addDays(asOf, days);
  const out: Celebration[] = [];
  for (const r of rows) {
    const id = String(r.id);
    const photo = r.photo_url ? `/api/people/employees/${id}/photo?v=${encodeURIComponent(String(r.updated_at))}` : '';
    if (canSeeField(ctx.viewer, id, 'birthday', ctx.visibility)) {
      const birth = readPersonal(String(r.personal ?? '')).birthDate;
      if (birth) {
        const date = nextOccurrence(birth.slice(5), asOf);
        if (date <= until) out.push({ kind: 'birthday', employeeId: id, name: String(r.name), photo, date, years: null });
      }
    }
    if (r.start_date && canSeeField(ctx.viewer, id, 'startDate', ctx.visibility)) {
      const date = nextOccurrence(r.start_date.slice(5), asOf);
      const years = Number(date.slice(0, 4)) - Number(r.start_date.slice(0, 4));
      if (years >= 1 && date <= until) out.push({ kind: 'anniversary', employeeId: id, name: String(r.name), photo, date, years });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)).slice(0, 20);
}

// ---------- Reportes a medida ----------

export const REPORT_COLUMNS = ['name', 'workEmail', 'jobTitle', 'department', 'location', 'country', 'manager', 'status', 'employmentType', 'startDate', 'endDate', 'tenureYears', 'payPeriod', 'phone'] as const;
export type ReportColumn = (typeof REPORT_COLUMNS)[number];
export const MAX_REPORT_COLUMNS = 30;

export interface ReportConfig {
  columns: string[];
  department?: string;
  location?: string;
  type?: string;
  status?: string;
  sort?: string;
}

export interface ReportResult {
  columns: Array<{ key: string; label: string; sensitive: boolean }>;
  rows: string[][];
  total: number;
}

/**
 * Lista de personas con las columnas elegidas (solo HR). No trae sueldos ni datos
 * personales: esos tienen su export auditado. Las columnas de campos sensibles
 * quedan en la auditoría.
 */
export async function runReport(ctx: PeopleCtx, config: ReportConfig, asOf = today()): Promise<ReportResult> {
  requireHr(ctx);
  const fields = await listFields(ctx.ws);
  const known = new Set<string>([...REPORT_COLUMNS, ...fields.map((f) => `custom:${f.id}`)]);
  const picked = [...new Set((config.columns ?? []).map(String))].filter((c) => known.has(c)).slice(0, MAX_REPORT_COLUMNS);
  if (!picked.length) throw new PeopleError('report_columns');
  const rows = (await db().prepare('SELECT * FROM people_employees WHERE workspace_id = ? ORDER BY name COLLATE NOCASE').all(ctx.ws)) as Array<Record<string, string | null>>;
  const names = new Map(rows.map((r) => [String(r.id), String(r.name)]));
  const filtered = rows.filter(
    (r) =>
      (config.status ? r.status === config.status : r.status !== 'terminated') &&
      (!config.department || r.department === config.department) &&
      (!config.location || r.location === config.location) &&
      (!config.type || r.employment_type === config.type),
  );
  const cell = (r: Record<string, string | null>, c: string): string => {
    if (c.startsWith('custom:')) return String(parseJson<Record<string, string>>(r.custom, {})[c.slice(7)] ?? '');
    switch (c as ReportColumn) {
      case 'name': return String(r.name ?? '');
      case 'workEmail': return String(r.work_email ?? '');
      case 'jobTitle': return String(r.job_title ?? '');
      case 'department': return String(r.department ?? '');
      case 'location': return String(r.location ?? '');
      case 'country': return String(r.country ?? '');
      case 'manager': return r.manager_id ? names.get(r.manager_id) ?? '' : '';
      case 'status': return String(r.status ?? '');
      case 'employmentType': return String(r.employment_type ?? '');
      case 'startDate': return String(r.start_date ?? '');
      case 'endDate': return String(r.end_date ?? '');
      case 'tenureYears': return String(tenureYears(r.start_date, r.end_date, asOf));
      case 'payPeriod': return String(r.pay_period ?? '');
      case 'phone': return String(r.phone ?? '');
    }
  };
  const sensitive = fields.filter((f) => f.sensitive && picked.includes(`custom:${f.id}`));
  for (const f of sensitive) await audit(ctx, 'view', `report:custom:${f.label}`, null);
  const table = filtered.map((r) => picked.map((c) => cell(r, c)));
  const sortIdx = picked.indexOf(String(config.sort ?? ''));
  if (sortIdx > 0) table.sort((a, b) => a[sortIdx].localeCompare(b[sortIdx], undefined, { numeric: true }));
  return {
    columns: picked.map((key) => {
      const f = key.startsWith('custom:') ? fields.find((x) => x.id === key.slice(7)) : null;
      return { key, label: f?.label ?? key, sensitive: Boolean(f?.sensitive) };
    }),
    rows: table,
    total: table.length,
  };
}

export async function reportCsv(ctx: PeopleCtx, config: ReportConfig): Promise<string> {
  const r = await runReport(ctx, config);
  await audit(ctx, 'export', 'custom-report', null);
  return toCsv([r.columns.map((c) => c.label), ...r.rows]);
}

export interface SavedReport {
  id: string;
  name: string;
  config: ReportConfig;
}

export async function listSavedReports(ctx: PeopleCtx): Promise<SavedReport[]> {
  requireHr(ctx);
  const rows = (await db().prepare('SELECT id, name, config FROM people_saved_reports WHERE workspace_id = ? ORDER BY name COLLATE NOCASE').all(ctx.ws)) as Array<Record<string, string>>;
  return rows.map((r) => ({ id: r.id, name: r.name, config: parseJson<ReportConfig>(r.config, { columns: [] }) }));
}

export async function saveReport(ctx: PeopleCtx, name: string, config: ReportConfig, id?: string): Promise<SavedReport> {
  requireHr(ctx);
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new PeopleError('name_required');
  const now = nowIso();
  const reportId = id || newId('rpt');
  if (id) {
    const res = await db().prepare('UPDATE people_saved_reports SET name = ?, config = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').run(clean, JSON.stringify(config), now, id, ctx.ws);
    if (!res.changes) throw new PeopleError('not_found', 404);
  } else {
    await db().prepare('INSERT INTO people_saved_reports (id, workspace_id, name, config, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(reportId, ctx.ws, clean, JSON.stringify(config), ctx.personId, now, now);
  }
  return { id: reportId, name: clean, config };
}

export async function deleteReport(ctx: PeopleCtx, id: string): Promise<boolean> {
  requireHr(ctx);
  return (await db().prepare('DELETE FROM people_saved_reports WHERE id = ? AND workspace_id = ?').run(id, ctx.ws)).changes > 0;
}

// ---------- Encuestas eNPS ----------

/** Menos respuestas que esto y no se muestra nada: con pocas, se adivina quién dijo qué. */
export const SURVEY_MIN_RESPONSES = 3;

export interface SurveyDto {
  id: string;
  question: string;
  status: 'open' | 'closed';
  createdAt: string;
  answered: boolean;
  responses: number;
  /** null hasta llegar al mínimo de respuestas. */
  score: number | null;
  promoters: number | null;
  passives: number | null;
  detractors: number | null;
  comments: string[];
}

/** eNPS: % de promotores (9-10) menos % de detractores (0-6). */
export function enps(scores: number[]): { score: number; promoters: number; passives: number; detractors: number } {
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  return { score: scores.length ? Math.round(((promoters - detractors) / scores.length) * 100) : 0, promoters, passives: scores.length - promoters - detractors, detractors };
}

export async function listSurveys(ctx: PeopleCtx): Promise<SurveyDto[]> {
  const rows = (await db().prepare('SELECT id, question, status, created_at FROM people_surveys WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50').all(ctx.ws)) as Array<Record<string, string>>;
  const out: SurveyDto[] = [];
  for (const s of rows) {
    const responses = (await db().prepare('SELECT score, comment FROM people_survey_responses WHERE survey_id = ?').all(s.id)) as Array<{ score: number; comment: string }>;
    const answered = ctx.viewer.employeeId ? Boolean(await db().prepare('SELECT 1 AS x FROM people_survey_participants WHERE survey_id = ? AND employee_id = ?').get(s.id, ctx.viewer.employeeId)) : false;
    // El resultado es de HR. Con menos del mínimo, ni HR lo ve.
    const show = ctx.viewer.hr && responses.length >= SURVEY_MIN_RESPONSES;
    const summary = show ? enps(responses.map((r) => Number(r.score))) : null;
    if (!ctx.viewer.hr && s.status !== 'open') continue;
    out.push({
      id: s.id,
      question: s.question,
      status: s.status === 'closed' ? 'closed' : 'open',
      createdAt: s.created_at,
      answered,
      responses: ctx.viewer.hr ? responses.length : 0,
      score: summary?.score ?? null,
      promoters: summary?.promoters ?? null,
      passives: summary?.passives ?? null,
      detractors: summary?.detractors ?? null,
      // En orden alfabético: el orden de llegada podría delatar a alguien.
      comments: show ? responses.map((r) => (r.comment ? unseal(r.comment) : '')).filter(Boolean).sort() : [],
    });
  }
  return out;
}

export async function createSurvey(ctx: PeopleCtx, question: string): Promise<string> {
  requireHr(ctx);
  const q = question.trim().slice(0, 300);
  if (!q) throw new PeopleError('name_required');
  const id = newId('svy');
  await db().prepare("INSERT INTO people_surveys (id, workspace_id, question, status, created_by, created_at) VALUES (?, ?, ?, 'open', ?, ?)").run(id, ctx.ws, q, ctx.personId, nowIso());
  const people = (await db().prepare("SELECT user_id FROM people_employees WHERE workspace_id = ? AND status IN ('active', 'onboarding') AND user_id IS NOT NULL").all(ctx.ws)) as Array<{ user_id: string }>;
  await notifyPeople(people.map((p) => p.user_id).filter((u) => u !== ctx.personId), { title: q.slice(0, 180), href: '/app/people/reviews#surveys', sourceId: id });
  return id;
}

export async function closeSurvey(ctx: PeopleCtx, id: string): Promise<boolean> {
  requireHr(ctx);
  return (await db().prepare("UPDATE people_surveys SET status = 'closed', closed_at = ? WHERE id = ? AND workspace_id = ? AND status = 'open'").run(nowIso(), id, ctx.ws)).changes > 0;
}

export async function deleteSurvey(ctx: PeopleCtx, id: string): Promise<boolean> {
  requireHr(ctx);
  const res = await db().prepare('DELETE FROM people_surveys WHERE id = ? AND workspace_id = ?').run(id, ctx.ws);
  await db().prepare('DELETE FROM people_survey_responses WHERE survey_id = ?').run(id);
  await db().prepare('DELETE FROM people_survey_participants WHERE survey_id = ?').run(id);
  return res.changes > 0;
}

/**
 * Responder. Quién respondió y qué respondió van en tablas separadas, sin hora ni
 * orden de llegada (WITHOUT ROWID e id al azar): no hay cómo cruzarlas. Una sola vez por persona.
 */
export async function answerSurvey(ctx: PeopleCtx, id: string, input: { score: unknown; comment?: unknown }): Promise<void> {
  const me = ctx.viewer.employeeId;
  if (!me) throw new PeopleError('no_profile', 409);
  const s = (await db().prepare('SELECT status FROM people_surveys WHERE id = ? AND workspace_id = ?').get(id, ctx.ws)) as { status: string } | undefined;
  if (!s) throw new PeopleError('not_found', 404);
  if (s.status !== 'open') throw new PeopleError('survey_closed', 409);
  const score = Number(input.score);
  if (!Number.isInteger(score) || score < 0 || score > 10) throw new PeopleError('invalid_number');
  const claim = await db().prepare('INSERT OR IGNORE INTO people_survey_participants (survey_id, employee_id) VALUES (?, ?)').run(id, me);
  if (!claim.changes) throw new PeopleError('already_answered', 409);
  const comment = String(input.comment ?? '').trim().slice(0, 1000);
  await db().prepare('INSERT INTO people_survey_responses (id, survey_id, score, comment) VALUES (?, ?, ?, ?)').run(newId('svr'), id, score, comment ? seal(comment) : '');
}

// ---------- Evaluadores pares a mano ----------

/** HR o un manager de la cadena suman un par a un ciclo activo. Nadie se elige a sí mismo de par. */
export async function addPeerReviewer(ctx: PeopleCtx, cycleId: string, subjectId: string, reviewerId: string): Promise<void> {
  const c = (await db().prepare('SELECT id, name, status, peer_review FROM people_cycles WHERE id = ? AND workspace_id = ?').get(cycleId, ctx.ws)) as { id: string; name: string; status: string } | undefined;
  if (!c) throw new PeopleError('not_found', 404);
  if (!ctx.viewer.hr && !isManagerOf(ctx.viewer, subjectId)) throw new PeopleError('forbidden', 403);
  if (c.status !== 'active') throw new PeopleError('cycle_not_active', 409);
  if (subjectId === reviewerId) throw new PeopleError('invalid_reviewer');
  const reviewer = await getEmployeeRow(ctx.ws, reviewerId);
  const subject = await getEmployeeRow(ctx.ws, subjectId);
  if (!subject || !reviewer || reviewer.status === 'terminated') throw new PeopleError('invalid_reviewer');
  const res = await db().prepare('INSERT OR IGNORE INTO people_reviews (id, workspace_id, cycle_id, subject_id, reviewer_id, kind) VALUES (?, ?, ?, ?, ?, ?)').run(newId('rev'), ctx.ws, cycleId, subjectId, reviewerId, 'peer');
  if (!res.changes) throw new PeopleError('already_reviewer', 409);
  await notifyPeople([reviewer.user_id], { title: localized('reviewCycle', { name: c.name }), href: '/app/people/reviews', sourceId: cycleId });
}

/** Saca a un par que todavía no respondió. */
export async function removePeerReviewer(ctx: PeopleCtx, reviewId: string): Promise<boolean> {
  const r = (await db().prepare("SELECT subject_id, kind, status FROM people_reviews WHERE id = ? AND workspace_id = ?").get(reviewId, ctx.ws)) as { subject_id: string; kind: string; status: string } | undefined;
  if (!r || r.kind !== 'peer') return false;
  if (!ctx.viewer.hr && !isManagerOf(ctx.viewer, r.subject_id)) throw new PeopleError('forbidden', 403);
  if (r.status !== 'pending') throw new PeopleError('already_submitted', 409);
  return (await db().prepare("DELETE FROM people_reviews WHERE id = ? AND status = 'pending'").run(reviewId)).changes > 0;
}

// ---------- Cambios de puesto con fecha futura ----------

export interface ScheduledChange {
  id: string;
  effectiveDate: string;
  status: 'pending' | 'applied' | 'failed';
  changes: Array<{ field: string; value: string }>;
  error: string;
}

const SCHEDULABLE = ['jobTitle', 'department', 'location', 'managerId', 'employmentType'] as const;

/** Solo HR: una promoción o un cambio de área anunciado a futuro no se ve antes de la fecha. */
export async function listScheduled(ctx: PeopleCtx, employeeId: string): Promise<ScheduledChange[]> {
  requireHr(ctx);
  const rows = (await db().prepare('SELECT id, changes, effective_date, status, error FROM people_scheduled_changes WHERE workspace_id = ? AND employee_id = ? ORDER BY effective_date DESC LIMIT 50').all(ctx.ws, employeeId)) as Array<Record<string, string>>;
  const out: ScheduledChange[] = [];
  for (const r of rows) {
    const input = parseJson<Record<string, string | null>>(r.changes, {});
    const changes = [];
    for (const [field, value] of Object.entries(input)) changes.push({ field, value: field === 'managerId' && value ? (await getEmployeeRow(ctx.ws, value))?.name ?? '' : String(value ?? '') });
    out.push({ id: r.id, effectiveDate: r.effective_date, status: r.status === 'applied' || r.status === 'failed' ? r.status : 'pending', changes, error: r.error });
  }
  return out;
}

export async function scheduleChange(ctx: PeopleCtx, employeeId: string, input: { effectiveDate?: unknown; changes?: Record<string, unknown> }): Promise<string> {
  requireHr(ctx);
  if (!(await getEmployeeRow(ctx.ws, employeeId))) throw new PeopleError('not_found', 404);
  const date = input.effectiveDate;
  if (!isIsoDate(date) || date <= today()) throw new PeopleError('invalid_dates');
  const picked: Record<string, string | null> = {};
  for (const k of SCHEDULABLE) {
    const v = input.changes?.[k];
    if (v === undefined || v === '') continue;
    picked[k] = v === null ? null : String(v).slice(0, 200);
  }
  if (!Object.keys(picked).length) throw new PeopleError('nothing_to_change');
  if (picked.managerId && !(await getEmployeeRow(ctx.ws, picked.managerId))) throw new PeopleError('invalid_manager');
  if (picked.employmentType && !['full_time', 'part_time', 'contractor', 'intern'].includes(picked.employmentType)) throw new PeopleError('invalid_type');
  const id = newId('sch');
  await db()
    .prepare("INSERT INTO people_scheduled_changes (id, workspace_id, employee_id, changes, effective_date, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)")
    .run(id, ctx.ws, employeeId, JSON.stringify(picked), date, ctx.personId, nowIso());
  return id;
}

export async function cancelScheduled(ctx: PeopleCtx, id: string): Promise<boolean> {
  requireHr(ctx);
  return (await db().prepare("DELETE FROM people_scheduled_changes WHERE id = ? AND workspace_id = ? AND status = 'pending'").run(id, ctx.ws)).changes > 0;
}

/**
 * Cron: aplica lo que venció. Cada fila se reclama con compare-and-set, así dos
 * corridas no la aplican dos veces; una que falla (un ciclo de managers, por
 * ejemplo) queda marcada y le avisa a quien la agendó. Pocas por corrida y por
 * workspace, con tope de tiempo: no le saca lugar al resto del cron.
 */
export async function applyDueChanges(asOf = today(), budgetMs = 20_000): Promise<{ applied: number; failed: number }> {
  const started = Date.now();
  const rows = (await db()
    .prepare(
      `SELECT id, workspace_id, employee_id, changes, created_by FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY effective_date, created_at) AS rn
         FROM people_scheduled_changes WHERE status = 'pending' AND effective_date <= ?
       ) WHERE rn <= 25 ORDER BY rn, effective_date LIMIT 200`,
    )
    .all(asOf)) as Array<Record<string, string>>;
  let applied = 0;
  let failed = 0;
  for (const r of rows) {
    if (Date.now() - started > budgetMs) break;
    const claim = await db().prepare("UPDATE people_scheduled_changes SET status = 'applying', applied_at = ? WHERE id = ? AND status = 'pending'").run(nowIso(), r.id);
    if (!claim.changes) continue;
    try {
      // Con los permisos de HR de quien la agendó si sigue siéndolo; si no, no se aplica.
      const { peopleContext } = await import('./people');
      const ctx = await peopleContext(r.workspace_id, r.created_by, r.created_by === r.workspace_id ? 'owner' : 'member');
      if (!ctx.viewer.hr) throw new PeopleError('forbidden', 403);
      await updateEmployee(ctx, r.employee_id, parseJson<EmployeeInput>(r.changes, {}));
      await db().prepare("UPDATE people_scheduled_changes SET status = 'applied' WHERE id = ?").run(r.id);
      applied++;
    } catch (err) {
      const code = err instanceof PeopleError ? err.code : 'generic';
      await db().prepare("UPDATE people_scheduled_changes SET status = 'failed', error = ? WHERE id = ?").run(code, r.id);
      await notifyPeople([r.created_by], { title: localized('peopleScheduledFailed'), href: `/app/people/${r.employee_id}?tab=history`, sourceId: r.id });
      failed++;
    }
  }
  return { applied, failed };
}
