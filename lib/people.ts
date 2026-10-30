/**
 * People (BambooHR): el contexto de quien mira, las fichas del directorio,
 * campos propios, visibilidad, sueldos cifrados, auditoría de lo sensible,
 * ⌘K, reportes y el CSV de nómina. Server-only.
 *
 * Las fichas son de las personas reales del workspace: cada miembro (no
 * guest) tiene una con su user_id (syncMembers la crea). HR puede crear una
 * ficha antes de que la persona se sume (un ingreso): queda con el email y se
 * enlaza sola cuando entra al workspace (personJoined → linkJoinedPerson).
 *
 * Quién ve qué lo deciden las funciones puras de lib/people-access.ts.
 */
import { getDb } from './db';
import { open as openSecret, seal } from './secret-box';
import { listOwnerSpacePeople } from './workspace';
import {
  canEditField,
  canSeeCustomField,
  canSeeField,
  canSeeSensitive,
  isManagerOf,
  isSelf,
  reportsOf,
  wouldCycle,
  CONFIGURABLE_FIELDS,
  type PeopleViewer,
  type VisibilityLevel,
  type VisibilitySettings,
} from './people-access';
import { isIsoDate, tenureYears, type PayPeriod } from './people-time';

// ---------- Errores y utilidades ----------

export class PeopleError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const db = () => getDb();

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contractor', 'intern'] as const;
export const EMPLOYEE_STATUSES = ['active', 'onboarding', 'offboarding', 'terminated'] as const;
export const PAY_PERIODS: PayPeriod[] = ['monthly', 'semimonthly', 'biweekly', 'weekly'];
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

// ---------- Contexto ----------

export interface PeopleCtx {
  ws: string;
  personId: string;
  /** Owner o admin del workspace. */
  wsAdmin: boolean;
  /** Rol en el workspace (owner, admin, member). */
  wsRole: string;
  viewer: PeopleViewer;
  visibility: VisibilitySettings;
  /** ¿La ficha de quien mira tiene manager? (aprobar lo propio). */
  hasManager: boolean;
}

interface SettingsRow {
  workspace_id: string;
  visibility: string;
  welcome: string;
  handbook_page_id: string | null;
  countries: string;
  updated_at: string;
}

export interface PeopleSettings {
  visibility: Record<string, VisibilityLevel>;
  welcome: string;
  handbookPageId: string | null;
  countries: string[];
  hrAdmins: string[];
}

/** Lo que el workspace necesita la primera vez: ajustes, políticas y plantillas por defecto. Idempotente. */
export async function ensurePeople(ws: string): Promise<void> {
  if (await db().prepare('SELECT 1 AS x FROM people_settings WHERE workspace_id = ?').get(ws)) return;
  const res = await db()
    .prepare('INSERT OR IGNORE INTO people_settings (workspace_id, visibility, welcome, countries, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(ws, '{}', '', '[]', nowIso());
  if (res.changes === 0) return;
  const now = nowIso();
  const policies: Array<[string, string, string, number, number | null, number | null]> = [
    ['Vacation', 'vacation', 'annual', 15, 5, 30],
    ['Sick leave', 'sick', 'annual', 10, 0, null],
    ['Personal', 'personal', 'annual', 3, 0, null],
  ];
  for (const [name, kind, accrual, days, carry, cap] of policies) {
    await db()
      .prepare(
        `INSERT INTO people_policies (id, workspace_id, name, kind, accrual, days_per_year, carryover_max, cap_days, half_day, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      )
      .run(newId('pol'), ws, name, kind, accrual, days, carry, cap, now, now);
  }
  const onboarding = [
    { title: 'Send the welcome email and first-day plan', assignee: 'hr', offsetDays: -7 },
    { title: 'Prepare laptop and accounts', assignee: 'it', offsetDays: -3 },
    { title: 'Sign the contract and read the handbook', assignee: 'new_hire', offsetDays: 0 },
    { title: 'First 1:1 and 30-day goals', assignee: 'manager', offsetDays: 1 },
    { title: '30-day check-in', assignee: 'manager', offsetDays: 30 },
  ];
  const offboarding = [
    { title: 'Return laptop and equipment', assignee: 'new_hire', offsetDays: 0 },
    { title: 'Remove access to tools', assignee: 'it', offsetDays: 0 },
    { title: 'Hand over open work', assignee: 'manager', offsetDays: -3 },
    { title: 'Exit interview', assignee: 'hr', offsetDays: -1 },
  ];
  for (const [name, kind, tasks] of [
    ['New hire', 'onboarding', onboarding],
    ['Leaving the company', 'offboarding', offboarding],
  ] as const) {
    await db()
      .prepare('INSERT INTO people_templates (id, workspace_id, name, kind, tasks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId('tpl'), ws, name, kind, JSON.stringify(tasks.map((t) => ({ ...t, description: '' }))), now, now);
  }
}

/**
 * Cada persona del workspace (no guest) tiene su ficha. Las que faltan se
 * crean (o se enlazan por email a un ingreso que HR cargó antes).
 */
export async function syncMembers(ws: string): Promise<void> {
  const people = await listOwnerSpacePeople(ws);
  const rows = (await db().prepare('SELECT id, user_id, work_email FROM people_employees WHERE workspace_id = ?').all(ws)) as Array<{
    id: string;
    user_id: string | null;
    work_email: string;
  }>;
  const linked = new Set(rows.map((r) => r.user_id).filter(Boolean));
  for (const p of people) {
    if (linked.has(p.id)) continue;
    await linkOrCreate(ws, p.id, p.email, p.name, rows);
  }
}

async function linkOrCreate(
  ws: string,
  userId: string,
  email: string,
  name: string | null,
  rows?: Array<{ id: string; user_id: string | null; work_email: string }>,
  opts: { rejoin?: boolean } = {},
) {
  const list = rows ?? ((await db().prepare('SELECT id, user_id, work_email FROM people_employees WHERE workspace_id = ?').all(ws)) as Array<{ id: string; user_id: string | null; work_email: string }>);
  const own = list.find((r) => r.user_id === userId);
  if (own) {
    // Vuelve al workspace: la ficha de antes (baja) queda activa otra vez.
    if (opts.rejoin) {
      await db()
        .prepare("UPDATE people_employees SET status = 'active', end_date = NULL, updated_at = ? WHERE id = ? AND status IN ('terminated', 'offboarding')")
        .run(nowIso(), own.id);
    }
    return;
  }
  const pending = list.find((r) => !r.user_id && r.work_email && r.work_email.toLowerCase() === email.toLowerCase());
  if (pending) {
    await db().prepare('UPDATE people_employees SET user_id = ?, updated_at = ? WHERE id = ? AND user_id IS NULL').run(userId, nowIso(), pending.id);
    return;
  }
  const now = nowIso();
  await db()
    .prepare(
      `INSERT OR IGNORE INTO people_employees (id, workspace_id, user_id, name, work_email, status, start_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?)`,
    )
    .run(newId('emp'), ws, userId, (name || email.split('@')[0] || 'Person').slice(0, 120), email, now, now);
}

/** Paso de personJoined: la persona que se suma al workspace queda con su ficha. */
export async function linkJoinedPerson(ws: string, userId: string): Promise<void> {
  const exists = await db().prepare('SELECT 1 AS x FROM people_settings WHERE workspace_id = ?').get(ws);
  if (!exists) return; // el workspace todavía no usa People: la ficha se crea al abrirlo.
  const u = (await db().prepare('SELECT email, name FROM users WHERE id = ?').get(userId)) as { email: string; name: string | null } | undefined;
  if (u) await linkOrCreate(ws, userId, u.email, u.name, undefined, { rejoin: true });
}

/** Paso de personRemoved: la ficha queda como baja (no se borra: cuenta para rotación y antigüedad). */
export async function markRemovedPerson(ws: string, userId: string): Promise<void> {
  await db()
    .prepare(
      `UPDATE people_employees SET status = 'terminated', end_date = COALESCE(end_date, ?), updated_at = ?
       WHERE workspace_id = ? AND user_id = ? AND status != 'terminated'`,
    )
    .run(today(), nowIso(), ws, userId);
  await db().prepare('DELETE FROM people_hr_admins WHERE workspace_id = ? AND user_id = ?').run(ws, userId);
}

export async function isHrAdmin(ws: string, personId: string, wsAdmin: boolean): Promise<boolean> {
  if (wsAdmin || ws === personId) return true;
  return Boolean(
    await db()
      .prepare(
        `SELECT 1 AS x FROM people_hr_admins h WHERE h.workspace_id = ? AND h.user_id = ?
         AND EXISTS (SELECT 1 FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = h.workspace_id AND m.user_id = h.user_id AND m.role != 'guest')`,
      )
      .get(ws, personId),
  );
}

async function managerMap(ws: string): Promise<Map<string, string | null>> {
  const rows = (await db().prepare('SELECT id, manager_id FROM people_employees WHERE workspace_id = ?').all(ws)) as Array<{ id: string; manager_id: string | null }>;
  return new Map(rows.map((r) => [r.id, r.manager_id]));
}

/** Contexto de People para una persona del workspace (sesión, asistente, API). */
export async function peopleContext(ws: string, personId: string, wsRole: string): Promise<PeopleCtx> {
  await ensurePeople(ws);
  // Quien ya tiene ficha no dispara la sincronización: las altas llegan por
  // personJoined (JOIN_STEPS). Solo alguien sin ficha (miembro de antes de
  // People) la crea al entrar.
  const linked = await db().prepare('SELECT 1 AS x FROM people_employees WHERE workspace_id = ? AND user_id = ?').get(ws, personId);
  if (!linked) await syncMembers(ws);
  const wsAdmin = wsRole === 'owner' || wsRole === 'admin' || ws === personId;
  const [hr, me, map, settings] = await Promise.all([
    isHrAdmin(ws, personId, wsAdmin),
    db().prepare('SELECT id, manager_id FROM people_employees WHERE workspace_id = ? AND user_id = ?').get(ws, personId) as Promise<{ id: string; manager_id: string | null } | undefined>,
    managerMap(ws),
    db().prepare('SELECT visibility FROM people_settings WHERE workspace_id = ?').get(ws) as Promise<{ visibility: string } | undefined>,
  ]);
  const employeeId = me?.id ?? null;
  return {
    ws,
    personId,
    wsAdmin,
    wsRole: ws === personId ? 'owner' : wsRole,
    viewer: { personId, employeeId, hr, wsOwner: ws === personId, reports: employeeId ? reportsOf(employeeId, map) : new Set() },
    visibility: parseJson<VisibilitySettings>(settings?.visibility, {}),
    hasManager: Boolean(me?.manager_id),
  };
}

export function requireHr(ctx: PeopleCtx): void {
  if (!ctx.viewer.hr) throw new PeopleError('forbidden', 403);
}

// ---------- Auditoría de lo sensible ----------

export async function audit(ctx: Pick<PeopleCtx, 'ws' | 'personId'>, action: 'view' | 'change' | 'export', field: string, employeeId: string | null, via = 'app'): Promise<void> {
  await db()
    .prepare('INSERT INTO people_audit (id, workspace_id, actor_id, employee_id, action, field, via, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId('aud'), ctx.ws, ctx.personId, employeeId, action, field, via, nowIso())
    .catch((err: unknown) => console.error('[people] audit', err));
}

export interface AuditEntry {
  id: string;
  actorName: string;
  employeeName: string | null;
  action: string;
  field: string;
  via: string;
  createdAt: string;
}

export async function listAudit(ctx: PeopleCtx, limit = 100): Promise<AuditEntry[]> {
  requireHr(ctx);
  const rows = (await db()
    .prepare(
      `SELECT a.*, COALESCE(u.name, u.email, a.actor_id) AS actor_name, e.name AS employee_name
       FROM people_audit a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN people_employees e ON e.id = a.employee_id
       WHERE a.workspace_id = ? ORDER BY a.created_at DESC LIMIT ?`,
    )
    .all(ctx.ws, limit)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    actorName: String(r.actor_name),
    employeeName: (r.employee_name as string | null) ?? null,
    action: String(r.action),
    field: String(r.field),
    via: String(r.via),
    createdAt: String(r.created_at),
  }));
}

// ---------- Campos propios ----------

export interface CustomField {
  id: string;
  label: string;
  kind: 'text' | 'number' | 'date' | 'select';
  options: string[];
  sensitive: boolean;
  position: number;
}

export async function listFields(ws: string): Promise<CustomField[]> {
  const rows = (await db().prepare('SELECT * FROM people_fields WHERE workspace_id = ? ORDER BY position, created_at').all(ws)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    label: String(r.label),
    kind: (['text', 'number', 'date', 'select'].includes(String(r.kind)) ? r.kind : 'text') as CustomField['kind'],
    options: parseJson<string[]>(r.options, []),
    sensitive: Number(r.sensitive) === 1,
    position: Number(r.position),
  }));
}

function fieldInput(input: Record<string, unknown>): Omit<CustomField, 'id' | 'position'> {
  const label = str(input.label, 80);
  if (!label) throw new PeopleError('label_required');
  const kind = (['text', 'number', 'date', 'select'].includes(String(input.kind)) ? input.kind : 'text') as CustomField['kind'];
  const options = Array.isArray(input.options) ? input.options.map((o) => str(o, 80)).filter(Boolean).slice(0, 50) : [];
  if (kind === 'select' && !options.length) throw new PeopleError('options_required');
  return { label, kind, options, sensitive: input.sensitive === true };
}

export async function createField(ctx: PeopleCtx, input: Record<string, unknown>): Promise<CustomField> {
  requireHr(ctx);
  const f = fieldInput(input);
  const id = newId('fld');
  const pos = ((await db().prepare('SELECT COUNT(*) AS n FROM people_fields WHERE workspace_id = ?').get(ctx.ws)) as { n: number }).n;
  await db()
    .prepare('INSERT INTO people_fields (id, workspace_id, label, kind, options, sensitive, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ctx.ws, f.label, f.kind, JSON.stringify(f.options), f.sensitive ? 1 : 0, Number(pos), nowIso());
  return { id, ...f, position: Number(pos) };
}

export async function updateField(ctx: PeopleCtx, id: string, input: Record<string, unknown>): Promise<boolean> {
  requireHr(ctx);
  const f = fieldInput(input);
  const res = await db()
    .prepare('UPDATE people_fields SET label = ?, kind = ?, options = ?, sensitive = ? WHERE id = ? AND workspace_id = ?')
    .run(f.label, f.kind, JSON.stringify(f.options), f.sensitive ? 1 : 0, id, ctx.ws);
  return res.changes > 0;
}

export async function deleteField(ctx: PeopleCtx, id: string): Promise<boolean> {
  requireHr(ctx);
  return (await db().prepare('DELETE FROM people_fields WHERE id = ? AND workspace_id = ?').run(id, ctx.ws)).changes > 0;
}

// ---------- Fichas ----------

interface EmployeeRow {
  id: string;
  workspace_id: string;
  user_id: string | null;
  name: string;
  work_email: string;
  phone: string;
  job_title: string;
  department: string;
  location: string;
  country: string;
  manager_id: string | null;
  start_date: string | null;
  end_date: string | null;
  employment_type: string;
  pay_period: string;
  status: string;
  photo_url: string;
  pronouns: string;
  bio: string;
  personal: string;
  custom: string;
  created_at: string;
  updated_at: string;
}

export interface EmergencyContact {
  name: string;
  relation: string;
  phone: string;
}

/** Datos personales: cifrados en la base (secret-box), solo HR y la persona. */
export interface PersonalData {
  personalEmail: string;
  address: string;
  birthDate: string;
  nationalId: string;
  emergencyContacts: EmergencyContact[];
}

const EMPTY_PERSONAL: PersonalData = { personalEmail: '', address: '', birthDate: '', nationalId: '', emergencyContacts: [] };

export function readPersonal(raw: string): PersonalData {
  const plain = raw ? openSecret(raw) : '';
  return { ...EMPTY_PERSONAL, ...parseJson<Partial<PersonalData>>(plain, {}) };
}

function sealPersonal(p: PersonalData): string {
  return seal(JSON.stringify(p));
}

export interface EmployeeSummary {
  id: string;
  userId: string | null;
  name: string;
  jobTitle: string;
  department: string;
  workEmail: string;
  managerId: string | null;
  status: string;
  photo: string;
  /** null = no lo puede ver. */
  location: string | null;
  phone: string | null;
  startDate: string | null | undefined;
  employmentType: string | null;
  country: string;
}

export interface EmployeeDto extends EmployeeSummary {
  managerName: string | null;
  pronouns: string;
  bio: string;
  endDate: string | null;
  payPeriod: string;
  /** Cumpleaños (mes-día) según la visibilidad; la fecha completa va en personal. */
  birthday: string | null;
  custom: Record<string, string>;
  personal: PersonalData | null;
  reports: Array<{ id: string; name: string; jobTitle: string }>;
  can: {
    editJob: boolean;
    editSelf: boolean;
    seePersonal: boolean;
    seeCompensation: boolean;
    seePerformance: boolean;
    seeTimeOff: boolean;
    seeExit: boolean;
    isSelf: boolean;
    isManager: boolean;
  };
  hasAccount: boolean;
}

export function photoUrl(row: Pick<EmployeeRow, 'id' | 'photo_url' | 'updated_at'>): string {
  return row.photo_url ? `/api/people/employees/${row.id}/photo?v=${encodeURIComponent(row.updated_at)}` : '';
}

/** Lo que cualquiera del workspace ve en el directorio (más lo configurable, si corresponde). */
export function summarize(ctx: PeopleCtx, r: EmployeeRow): EmployeeSummary {
  const see = (f: (typeof CONFIGURABLE_FIELDS)[number]) => canSeeField(ctx.viewer, r.id, f, ctx.visibility);
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    jobTitle: r.job_title,
    department: r.department,
    workEmail: r.work_email,
    managerId: r.manager_id,
    status: r.status,
    photo: photoUrl(r),
    location: see('location') ? r.location : null,
    phone: see('phone') ? r.phone : null,
    startDate: see('startDate') ? r.start_date : undefined,
    employmentType: see('employmentType') ? r.employment_type : null,
    country: see('location') ? r.country : '',
  };
}

export interface ListFilters {
  q?: string;
  department?: string;
  location?: string;
  status?: string;
  type?: string;
  includeTerminated?: boolean;
}

async function rows(ws: string): Promise<EmployeeRow[]> {
  return (await db().prepare('SELECT * FROM people_employees WHERE workspace_id = ? ORDER BY name COLLATE NOCASE').all(ws)) as unknown as EmployeeRow[];
}

export async function listEmployees(ctx: PeopleCtx, f: ListFilters = {}): Promise<EmployeeSummary[]> {
  const q = (f.q ?? '').trim().toLowerCase();
  return (await rows(ctx.ws))
    .filter((r) => (f.status ? r.status === f.status : f.includeTerminated || r.status !== 'terminated'))
    .map((r) => summarize(ctx, r))
    .filter((e) => {
      if (f.department && e.department !== f.department) return false;
      // Filtrar por un campo que no se ve no puede revelar el valor.
      if (f.location && e.location !== f.location) return false;
      if (f.type && e.employmentType !== f.type) return false;
      if (!q) return true;
      return [e.name, e.jobTitle, e.department, e.workEmail, e.location ?? ''].some((v) => v.toLowerCase().includes(q));
    });
}

/** Valores para los filtros del directorio (solo de lo que quien mira puede ver). */
export async function directoryFacets(ctx: PeopleCtx): Promise<{ departments: string[]; locations: string[] }> {
  const list = await listEmployees(ctx);
  const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b));
  return { departments: uniq(list.map((e) => e.department)), locations: uniq(list.map((e) => e.location)) };
}

export async function getEmployeeRow(ws: string, id: string): Promise<EmployeeRow | null> {
  return ((await db().prepare('SELECT * FROM people_employees WHERE id = ? AND workspace_id = ?').get(id, ws)) as unknown as EmployeeRow | undefined) ?? null;
}

/** Ficha de una persona por su user_id (para Ajustes › Miembros y "mi ficha"). */
export async function employeeIdForUser(ws: string, userId: string): Promise<string | null> {
  const r = (await db().prepare('SELECT id FROM people_employees WHERE workspace_id = ? AND user_id = ?').get(ws, userId)) as { id: string } | undefined;
  return r?.id ?? null;
}

/** La ficha completa, filtrada para quien mira. Ver lo sensible queda en la auditoría. */
export async function getEmployee(ctx: PeopleCtx, id: string, opts: { via?: string; audit?: boolean } = {}): Promise<EmployeeDto | null> {
  const r = await getEmployeeRow(ctx.ws, id);
  if (!r) return null;
  const v = ctx.viewer;
  const [fields, manager, reports] = await Promise.all([
    listFields(ctx.ws),
    r.manager_id ? (db().prepare('SELECT name FROM people_employees WHERE id = ?').get(r.manager_id) as Promise<{ name: string } | undefined>) : Promise.resolve(undefined),
    db().prepare("SELECT id, name, job_title FROM people_employees WHERE workspace_id = ? AND manager_id = ? AND status != 'terminated' ORDER BY name COLLATE NOCASE").all(ctx.ws, id) as Promise<
      Array<{ id: string; name: string; job_title: string }>
    >,
  ]);
  const seePersonal = canSeeSensitive(v, id, 'personal');
  const customRaw = parseJson<Record<string, string>>(r.custom, {});
  const custom: Record<string, string> = {};
  for (const f of fields) if (canSeeCustomField(v, id, f.sensitive) && customRaw[f.id] != null) custom[f.id] = String(customRaw[f.id]);
  const personal = seePersonal ? readPersonal(r.personal) : null;
  if (seePersonal && opts.audit !== false) await audit(ctx, 'view', 'personal', id, opts.via);
  const birth = personal?.birthDate || (canSeeField(v, id, 'birthday', ctx.visibility) ? readPersonal(r.personal).birthDate : '');
  return {
    ...summarize(ctx, r),
    managerName: manager?.name ?? null,
    pronouns: r.pronouns,
    bio: r.bio,
    endDate: v.hr || isSelf(v, id) ? r.end_date : null,
    payPeriod: v.hr ? r.pay_period : '',
    birthday: birth ? birth.slice(5) : null,
    custom,
    personal,
    reports: reports.map((x) => ({ id: x.id, name: x.name, jobTitle: x.job_title })),
    can: {
      editJob: v.hr,
      editSelf: isSelf(v, id),
      seePersonal,
      seeCompensation: canSeeSensitive(v, id, 'compensation'),
      seePerformance: canSeeSensitive(v, id, 'performance'),
      seeTimeOff: canSeeSensitive(v, id, 'timeoff'),
      seeExit: canSeeSensitive(v, id, 'exit'),
      isSelf: isSelf(v, id),
      isManager: isManagerOf(v, id),
    },
    hasAccount: Boolean(r.user_id),
  };
}

export interface EmployeeInput {
  name?: string;
  workEmail?: string;
  phone?: string;
  jobTitle?: string;
  department?: string;
  location?: string;
  country?: string;
  managerId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  employmentType?: string;
  payPeriod?: string;
  status?: string;
  pronouns?: string;
  bio?: string;
  custom?: Record<string, unknown>;
  personal?: Partial<PersonalData>;
}

const JOB_COLUMNS: Record<string, keyof EmployeeRow> = {
  name: 'name',
  workEmail: 'work_email',
  jobTitle: 'job_title',
  department: 'department',
  location: 'location',
  country: 'country',
  managerId: 'manager_id',
  startDate: 'start_date',
  endDate: 'end_date',
  employmentType: 'employment_type',
  payPeriod: 'pay_period',
  status: 'status',
};

function normalizeValue(key: string, value: unknown): string | null {
  switch (key) {
    case 'startDate':
    case 'endDate':
      if (value == null || value === '') return null;
      if (!isIsoDate(value)) throw new PeopleError('invalid_date');
      return value;
    case 'managerId':
      return value ? String(value) : null;
    case 'employmentType':
      if (!(EMPLOYMENT_TYPES as readonly string[]).includes(String(value))) throw new PeopleError('invalid_type');
      return String(value);
    case 'payPeriod':
      if (!(PAY_PERIODS as string[]).includes(String(value))) throw new PeopleError('invalid_pay_period');
      return String(value);
    case 'status':
      if (!(EMPLOYEE_STATUSES as readonly string[]).includes(String(value))) throw new PeopleError('invalid_status');
      return String(value);
    case 'country':
      return str(value, 2).toUpperCase();
    case 'workEmail': {
      const e = str(value, 200).toLowerCase();
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new PeopleError('invalid_email');
      return e;
    }
    case 'name': {
      const n = str(value, 120);
      if (!n) throw new PeopleError('name_required');
      return n;
    }
    default:
      return str(value, key === 'bio' ? 2000 : 200);
  }
}

function cleanPersonal(input: Partial<PersonalData>, base: PersonalData): PersonalData {
  const out = { ...base };
  if (input.personalEmail !== undefined) out.personalEmail = str(input.personalEmail, 200);
  if (input.address !== undefined) out.address = str(input.address, 500);
  if (input.nationalId !== undefined) out.nationalId = str(input.nationalId, 60);
  if (input.birthDate !== undefined) {
    if (input.birthDate && !isIsoDate(input.birthDate)) throw new PeopleError('invalid_date');
    out.birthDate = input.birthDate || '';
  }
  if (input.emergencyContacts !== undefined) {
    out.emergencyContacts = (Array.isArray(input.emergencyContacts) ? input.emergencyContacts : [])
      .slice(0, 5)
      .map((c) => ({ name: str(c?.name, 120), relation: str(c?.relation, 60), phone: str(c?.phone, 40) }))
      .filter((c) => c.name || c.phone);
  }
  return out;
}

export async function createEmployee(ctx: PeopleCtx, input: EmployeeInput & { onboardingTemplateId?: string | null }): Promise<EmployeeDto> {
  requireHr(ctx);
  const id = newId('emp');
  const now = nowIso();
  const name = normalizeValue('name', input.name)!;
  const email = normalizeValue('workEmail', input.workEmail ?? '') ?? '';
  // Si el email es de alguien del workspace, la ficha es la suya.
  let userId: string | null = null;
  if (email) {
    const member = (await listOwnerSpacePeople(ctx.ws)).find((p) => p.email.toLowerCase() === email);
    if (member) {
      const existing = await employeeIdForUser(ctx.ws, member.id);
      if (existing) throw new PeopleError('already_exists', 409);
      userId = member.id;
    }
  }
  const managerId = input.managerId ? String(input.managerId) : null;
  if (managerId && !(await getEmployeeRow(ctx.ws, managerId))) throw new PeopleError('invalid_manager');
  const startDate = normalizeValue('startDate', input.startDate ?? null);
  const status = startDate && startDate > today() ? 'onboarding' : 'active';
  await db()
    .prepare(
      `INSERT INTO people_employees (id, workspace_id, user_id, name, work_email, phone, job_title, department, location, country, manager_id,
         start_date, employment_type, pay_period, status, pronouns, bio, personal, custom, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      ctx.ws,
      userId,
      name,
      email,
      str(input.phone, 40),
      str(input.jobTitle, 120),
      str(input.department, 80),
      str(input.location, 120),
      normalizeValue('country', input.country ?? '') ?? '',
      managerId,
      startDate,
      input.employmentType ? normalizeValue('employmentType', input.employmentType)! : 'full_time',
      input.payPeriod ? normalizeValue('payPeriod', input.payPeriod)! : 'monthly',
      status,
      str(input.pronouns, 40),
      str(input.bio, 2000),
      input.personal ? sealPersonal(cleanPersonal(input.personal, EMPTY_PERSONAL)) : '',
      JSON.stringify(await cleanCustom(ctx.ws, input.custom ?? {})),
      now,
      now,
    );
  if (input.personal) await audit(ctx, 'change', 'personal', id);
  if (input.onboardingTemplateId) {
    const { startChecklist } = await import('./people-onboarding');
    await startChecklist(ctx, id, String(input.onboardingTemplateId)).catch((err) => console.error('[people] onboarding', err));
  }
  const dto = (await getEmployee(ctx, id, { audit: false }))!;
  const { emitPeopleEvent } = await import('./people-effects');
  await emitPeopleEvent(ctx.ws, 'people.hired', {
    employee: { id, name: dto.name, jobTitle: dto.jobTitle, department: dto.department, workEmail: dto.workEmail, startDate: startDate, managerName: dto.managerName, url: `/app/people/${id}` },
  });
  return dto;
}

async function cleanCustom(ws: string, input: Record<string, unknown>, base: Record<string, string> = {}): Promise<Record<string, string>> {
  const fields = await listFields(ws);
  const out = { ...base };
  for (const f of fields) {
    if (!(f.id in input)) continue;
    const v = input[f.id];
    if (v == null || v === '') {
      delete out[f.id];
      continue;
    }
    const s = str(v, 500);
    if (f.kind === 'number' && Number.isNaN(Number(s))) throw new PeopleError('invalid_number');
    if (f.kind === 'date' && !isIsoDate(s)) throw new PeopleError('invalid_date');
    if (f.kind === 'select' && !f.options.includes(s)) throw new PeopleError('invalid_option');
    out[f.id] = s;
  }
  return out;
}

/**
 * Cambia una ficha. Cada campo pide su permiso (canEditField): HR todo, la
 * persona sus datos de contacto y personales. Los cambios a lo sensible
 * quedan en la auditoría.
 */
export async function updateEmployee(ctx: PeopleCtx, id: string, input: EmployeeInput): Promise<EmployeeDto> {
  const r = await getEmployeeRow(ctx.ws, id);
  if (!r) throw new PeopleError('not_found', 404);
  const sets: string[] = [];
  const args: Array<string | null> = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || key === 'custom' || key === 'personal') continue;
    if (!canEditField(ctx.viewer, id, key)) throw new PeopleError('forbidden', 403);
    const col = JOB_COLUMNS[key] ?? ({ phone: 'phone', pronouns: 'pronouns', bio: 'bio' } as Record<string, keyof EmployeeRow>)[key];
    if (!col) continue;
    const v = normalizeValue(key, value);
    if (key === 'managerId') {
      // Nadie se elige su propio manager (así no se saca de la cadena de aprobación); el owner sí.
      if (isSelf(ctx.viewer, id) && !ctx.viewer.wsOwner && (v ?? null) !== (r.manager_id ?? null)) throw new PeopleError('forbidden', 403);
      if (v && !(await getEmployeeRow(ctx.ws, v))) throw new PeopleError('invalid_manager');
      if (wouldCycle(id, v, await managerMap(ctx.ws))) throw new PeopleError('manager_cycle');
    }
    sets.push(`${col} = ?`);
    args.push(v);
  }
  if (input.custom) {
    const fields = await listFields(ctx.ws);
    for (const fid of Object.keys(input.custom)) {
      const f = fields.find((x) => x.id === fid);
      if (!f) continue;
      if (!ctx.viewer.hr) throw new PeopleError('forbidden', 403);
      if (f.sensitive) await audit(ctx, 'change', `custom:${f.label}`, id);
    }
    sets.push('custom = ?');
    args.push(JSON.stringify(await cleanCustom(ctx.ws, input.custom, parseJson<Record<string, string>>(r.custom, {}))));
  }
  if (input.personal) {
    for (const key of Object.keys(input.personal)) {
      if (!canEditField(ctx.viewer, id, key)) throw new PeopleError('forbidden', 403);
    }
    sets.push('personal = ?');
    args.push(sealPersonal(cleanPersonal(input.personal, readPersonal(r.personal))));
    await audit(ctx, 'change', `personal:${Object.keys(input.personal).join(',')}`, id);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    args.push(nowIso());
    await db().prepare(`UPDATE people_employees SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...args, id, ctx.ws);
  }
  return (await getEmployee(ctx, id, { audit: false }))!;
}

/** Borrar una ficha (cargada por error): solo HR. Sus reportes pasan a su manager. */
export async function deleteEmployee(ctx: PeopleCtx, id: string): Promise<boolean> {
  requireHr(ctx);
  const r = await getEmployeeRow(ctx.ws, id);
  if (!r) return false;
  if (r.user_id && r.user_id === ctx.ws) throw new PeopleError('owner_profile', 409);
  await db().prepare('UPDATE people_employees SET manager_id = ? WHERE workspace_id = ? AND manager_id = ?').run(r.manager_id, ctx.ws, id);
  const { cancelCalBlocksFor } = await import('./people-timeoff');
  await cancelCalBlocksFor(ctx.ws, id);
  await db().prepare('DELETE FROM people_employees WHERE id = ? AND workspace_id = ?').run(id, ctx.ws);
  return true;
}

export async function setPhoto(ctx: PeopleCtx, id: string, url: string): Promise<void> {
  const r = await getEmployeeRow(ctx.ws, id);
  if (!r) throw new PeopleError('not_found', 404);
  if (!canEditField(ctx.viewer, id, 'photo')) throw new PeopleError('forbidden', 403);
  await db().prepare('UPDATE people_employees SET photo_url = ?, updated_at = ? WHERE id = ?').run(url, nowIso(), id);
  // La foto anterior no queda huérfana en el storage.
  if (r.photo_url && r.photo_url !== url) {
    const { deleteUploads } = await import('./uploads');
    await deleteUploads([r.photo_url]).catch(() => undefined);
  }
}

// ---------- Ajustes ----------

export async function getSettings(ws: string): Promise<PeopleSettings> {
  await ensurePeople(ws);
  const r = (await db().prepare('SELECT * FROM people_settings WHERE workspace_id = ?').get(ws)) as unknown as SettingsRow;
  const admins = (await db().prepare('SELECT user_id FROM people_hr_admins WHERE workspace_id = ?').all(ws)) as Array<{ user_id: string }>;
  return {
    visibility: { ...Object.fromEntries(CONFIGURABLE_FIELDS.map((f) => [f, 'everyone'])), ...parseJson<Record<string, VisibilityLevel>>(r.visibility, {}) },
    welcome: r.welcome,
    handbookPageId: r.handbook_page_id,
    countries: parseJson<string[]>(r.countries, []),
    hrAdmins: admins.map((a) => a.user_id),
  };
}

export async function updateSettings(
  ctx: PeopleCtx,
  input: { visibility?: Record<string, unknown>; welcome?: string; handbookPageId?: string | null; countries?: unknown[]; hrAdmins?: unknown[] },
): Promise<PeopleSettings> {
  requireHr(ctx);
  const cur = await getSettings(ctx.ws);
  if (input.visibility) {
    const vis: Record<string, VisibilityLevel> = { ...cur.visibility };
    for (const f of CONFIGURABLE_FIELDS) {
      const v = input.visibility[f];
      if (v === 'everyone' || v === 'managers' || v === 'hr') vis[f] = v;
    }
    await db().prepare('UPDATE people_settings SET visibility = ? WHERE workspace_id = ?').run(JSON.stringify(vis), ctx.ws);
  }
  if (input.welcome !== undefined) await db().prepare('UPDATE people_settings SET welcome = ? WHERE workspace_id = ?').run(str(input.welcome, 4000), ctx.ws);
  if (input.handbookPageId !== undefined) await db().prepare('UPDATE people_settings SET handbook_page_id = ? WHERE workspace_id = ?').run(input.handbookPageId || null, ctx.ws);
  if (input.countries) {
    const list = [...new Set(input.countries.map((c) => str(c, 2).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
    await db().prepare('UPDATE people_settings SET countries = ? WHERE workspace_id = ?').run(JSON.stringify(list), ctx.ws);
  }
  if (input.hrAdmins) {
    // Solo owner y admins del workspace nombran HR admins.
    if (!ctx.wsAdmin) throw new PeopleError('forbidden', 403);
    const members = new Set((await listOwnerSpacePeople(ctx.ws)).map((p) => p.id));
    const ids = [...new Set(input.hrAdmins.map(String))].filter((id) => members.has(id));
    await db().prepare('DELETE FROM people_hr_admins WHERE workspace_id = ?').run(ctx.ws);
    for (const uid of ids) await db().prepare('INSERT OR IGNORE INTO people_hr_admins (workspace_id, user_id, created_at) VALUES (?, ?, ?)').run(ctx.ws, uid, nowIso());
  }
  await db().prepare('UPDATE people_settings SET updated_at = ? WHERE workspace_id = ?').run(nowIso(), ctx.ws);
  return getSettings(ctx.ws);
}

// ---------- Sueldos (cifrados) ----------

export interface CompEntry {
  id: string;
  effectiveDate: string;
  amount: number;
  currency: string;
  period: 'year' | 'month' | 'hour';
  reason: string;
  createdAt: string;
}

export const COMP_PERIODS = ['year', 'month', 'hour'] as const;

/** Lo que se guarda en people_compensation.data: el JSON cifrado (nunca el monto en claro). */
export function sealComp(entry: Omit<CompEntry, 'id' | 'createdAt' | 'effectiveDate'>): string {
  return seal(JSON.stringify(entry));
}

export function openComp(data: string): Omit<CompEntry, 'id' | 'createdAt' | 'effectiveDate'> | null {
  const plain = openSecret(data);
  if (!plain) return null;
  const v = parseJson<Record<string, unknown>>(plain, {});
  return { amount: Number(v.amount) || 0, currency: String(v.currency ?? 'USD'), period: (COMP_PERIODS as readonly string[]).includes(String(v.period)) ? (v.period as CompEntry['period']) : 'year', reason: String(v.reason ?? '') };
}

export async function listCompensation(ctx: PeopleCtx, employeeId: string, via = 'app'): Promise<CompEntry[]> {
  if (!canSeeSensitive(ctx.viewer, employeeId, 'compensation')) throw new PeopleError('forbidden', 403);
  if (!(await getEmployeeRow(ctx.ws, employeeId))) throw new PeopleError('not_found', 404);
  const list = (await db()
    .prepare('SELECT * FROM people_compensation WHERE workspace_id = ? AND employee_id = ? ORDER BY effective_date DESC, created_at DESC')
    .all(ctx.ws, employeeId)) as Array<{ id: string; effective_date: string; data: string; created_at: string }>;
  await audit(ctx, 'view', 'compensation', employeeId, via);
  return list.flatMap((r) => {
    const v = openComp(r.data);
    return v ? [{ id: r.id, effectiveDate: r.effective_date, createdAt: r.created_at, ...v }] : [];
  });
}

export async function addCompensation(ctx: PeopleCtx, employeeId: string, input: Record<string, unknown>): Promise<CompEntry> {
  requireHr(ctx);
  if (!(await getEmployeeRow(ctx.ws, employeeId))) throw new PeopleError('not_found', 404);
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e10) throw new PeopleError('invalid_amount');
  if (!isIsoDate(input.effectiveDate)) throw new PeopleError('invalid_date');
  const currency = str(input.currency, 3).toUpperCase() || 'USD';
  if (!/^[A-Z]{3}$/.test(currency)) throw new PeopleError('invalid_currency');
  const period = (COMP_PERIODS as readonly string[]).includes(String(input.period)) ? (input.period as CompEntry['period']) : 'year';
  const entry = { amount: Math.round(amount * 100) / 100, currency, period, reason: str(input.reason, 200) };
  const id = newId('cmp');
  const createdAt = nowIso();
  await db()
    .prepare('INSERT INTO people_compensation (id, workspace_id, employee_id, effective_date, data, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, ctx.ws, employeeId, input.effectiveDate, sealComp(entry), ctx.personId, createdAt);
  await audit(ctx, 'change', 'compensation', employeeId);
  return { id, effectiveDate: String(input.effectiveDate), createdAt, ...entry };
}

export async function deleteCompensation(ctx: PeopleCtx, employeeId: string, entryId: string): Promise<boolean> {
  requireHr(ctx);
  const res = await db().prepare('DELETE FROM people_compensation WHERE id = ? AND employee_id = ? AND workspace_id = ?').run(entryId, employeeId, ctx.ws);
  if (res.changes) await audit(ctx, 'change', 'compensation', employeeId);
  return res.changes > 0;
}

function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  // Fórmulas de planilla: nunca se ejecutan al abrir el CSV.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV de nómina (sin procesar pagos): fichas activas con el sueldo vigente. Solo HR; queda auditado. */
export async function payrollCsv(ctx: PeopleCtx, asOf = today()): Promise<string> {
  requireHr(ctx);
  const list = (await rows(ctx.ws)).filter((r) => r.status !== 'terminated' || (r.end_date ?? '') >= asOf.slice(0, 8) + '01');
  const comp = (await db()
    .prepare('SELECT employee_id, effective_date, data FROM people_compensation WHERE workspace_id = ? AND effective_date <= ? ORDER BY effective_date DESC, created_at DESC')
    .all(ctx.ws, asOf)) as Array<{ employee_id: string; effective_date: string; data: string }>;
  const latest = new Map<string, { effective_date: string; data: string }>();
  for (const c of comp) if (!latest.has(c.employee_id)) latest.set(c.employee_id, c);
  const header = ['employee_id', 'name', 'work_email', 'job_title', 'department', 'location', 'country', 'employment_type', 'pay_period', 'start_date', 'end_date', 'status', 'amount', 'currency', 'period', 'effective_date'];
  const lines = [header.join(',')];
  for (const r of list) {
    const c = latest.get(r.id);
    const v = c ? openComp(c.data) : null;
    lines.push(
      [r.id, r.name, r.work_email, r.job_title, r.department, r.location, r.country, r.employment_type, r.pay_period, r.start_date ?? '', r.end_date ?? '', r.status, v?.amount ?? '', v?.currency ?? '', v?.period ?? '', c?.effective_date ?? '']
        .map(csvCell)
        .join(','),
    );
  }
  await audit(ctx, 'export', 'compensation', null);
  return lines.join('\n') + '\n';
}

// ---------- ⌘K ----------

/** Búsqueda de ⌘K: solo nombre, puesto y área (nada sensible ni restringido). */
export async function searchPeople(ws: string, q: string, limit = 8): Promise<Array<{ id: string; label: string; meta: string }>> {
  const term = q.trim();
  if (!term) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const found = (await db()
    .prepare(
      `SELECT id, name, job_title, department FROM people_employees
       WHERE workspace_id = ? AND status != 'terminated' AND (name LIKE ? ESCAPE '\\' OR job_title LIKE ? ESCAPE '\\' OR department LIKE ? ESCAPE '\\')
       ORDER BY name COLLATE NOCASE LIMIT ?`,
    )
    .all(ws, like, like, like, limit)) as Array<{ id: string; name: string; job_title: string; department: string }>;
  return found.map((r) => ({ id: r.id, label: r.name, meta: [r.job_title, r.department].filter(Boolean).join(' · ') }));
}

// ---------- Organigrama ----------

export interface OrgNode {
  id: string;
  name: string;
  jobTitle: string;
  department: string;
  photo: string;
  managerId: string | null;
}

export async function orgChart(ctx: PeopleCtx): Promise<OrgNode[]> {
  const list = (await rows(ctx.ws)).filter((r) => r.status !== 'terminated');
  const ids = new Set(list.map((r) => r.id));
  return list.map((r) => ({ id: r.id, name: r.name, jobTitle: r.job_title, department: r.department, photo: photoUrl(r), managerId: r.manager_id && ids.has(r.manager_id) ? r.manager_id : null }));
}

// ---------- Reportes ----------

export interface PeopleReport {
  asOf: string;
  headcount: number;
  byDepartment: Array<{ key: string; count: number }>;
  byLocation: Array<{ key: string; count: number }>;
  byType: Array<{ key: string; count: number }>;
  monthly: Array<{ month: string; hires: number; exits: number; headcount: number }>;
  turnover12m: number | null;
  tenure: { average: number; buckets: Array<{ key: string; count: number }> };
  timeOff: Array<{ policy: string; days: number; requests: number }>;
}

function headcountAt(list: EmployeeRow[], date: string): number {
  return list.filter((r) => (r.start_date ?? r.created_at.slice(0, 10)) <= date && (!r.end_date || r.end_date > date) && !(r.status === 'terminated' && !r.end_date)).length;
}

/** Reportes de HR: dotación, rotación (12 meses), uso de licencias del año y antigüedad. */
export async function peopleReport(ctx: PeopleCtx, asOf = today()): Promise<PeopleReport> {
  requireHr(ctx);
  const all = await rows(ctx.ws);
  const active = all.filter((r) => r.status !== 'terminated');
  const group = (key: (r: EmployeeRow) => string) => {
    const m = new Map<string, number>();
    for (const r of active) m.set(key(r) || '', (m.get(key(r) || '') ?? 0) + 1);
    return [...m.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
  };
  const monthly: PeopleReport['monthly'] = [];
  const [y, mo] = asOf.split('-').map(Number);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, mo - 1 - i, 1));
    const month = d.toISOString().slice(0, 7);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    monthly.push({
      month,
      hires: all.filter((r) => (r.start_date ?? '').startsWith(month)).length,
      exits: all.filter((r) => (r.end_date ?? '').startsWith(month) && r.status === 'terminated').length,
      headcount: headcountAt(all, end < asOf ? end : asOf),
    });
  }
  const exits = monthly.reduce((s, m) => s + m.exits, 0);
  const avgHead = monthly.reduce((s, m) => s + m.headcount, 0) / monthly.length;
  const tenures = active.map((r) => tenureYears(r.start_date, r.end_date, asOf));
  const bucket = (t: number) => (t < 1 ? 'lt1' : t < 2 ? '1to2' : t < 5 ? '2to5' : '5plus');
  const buckets = ['lt1', '1to2', '2to5', '5plus'].map((key) => ({ key, count: tenures.filter((t) => bucket(t) === key).length }));
  const year = asOf.slice(0, 4);
  const usage = (await db()
    .prepare(
      `SELECT p.name AS policy, COALESCE(SUM(r.days), 0) AS days, COUNT(r.id) AS requests
       FROM people_policies p LEFT JOIN people_requests r ON r.policy_id = p.id AND r.status = 'approved' AND substr(r.start_date, 1, 4) = ?
       WHERE p.workspace_id = ? AND p.archived = 0 GROUP BY p.id ORDER BY p.name`,
    )
    .all(year, ctx.ws)) as Array<{ policy: string; days: number; requests: number }>;
  return {
    asOf,
    headcount: active.length,
    byDepartment: group((r) => r.department),
    byLocation: group((r) => r.location),
    byType: group((r) => r.employment_type),
    monthly,
    turnover12m: avgHead > 0 ? Math.round((exits / avgHead) * 1000) / 10 : null,
    tenure: { average: tenures.length ? Math.round((tenures.reduce((s, t) => s + t, 0) / tenures.length) * 10) / 10 : 0, buckets },
    timeOff: usage.map((u) => ({ policy: u.policy, days: Number(u.days), requests: Number(u.requests) })),
  };
}

/** Personas del workspace que pueden usar People (para avisos y selector de HR admins). */
export async function workspacePeople(ws: string) {
  return listOwnerSpacePeople(ws);
}

/**
 * ⌘K completo: personas (solo campos públicos), plantillas (HR) y ciclos de
 * evaluación que quien busca puede ver. Contexto liviano (sin sincronizar
 * miembros): la búsqueda corre en cada tecla.
 */
export async function searchPeopleForPalette(
  ws: string,
  personId: string,
  wsRole: string,
  q: string,
): Promise<Array<{ kind: 'person' | 'template' | 'cycle'; id: string; label: string; meta: string }>> {
  const term = q.trim();
  if (!term) return [];
  const exists = await db().prepare('SELECT 1 AS x FROM people_settings WHERE workspace_id = ?').get(ws);
  if (!exists) return [];
  const wsAdmin = wsRole === 'owner' || wsRole === 'admin' || ws === personId;
  const hr = await isHrAdmin(ws, personId, wsAdmin);
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const people = (await searchPeople(ws, term)).map((p) => ({ kind: 'person' as const, ...p }));
  const templates = hr
    ? ((await db()
        .prepare(`SELECT id, name, kind FROM people_templates WHERE workspace_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 5`)
        .all(ws, like)) as Array<{ id: string; name: string; kind: string }>).map((t) => ({ kind: 'template' as const, id: t.id, label: t.name, meta: t.kind }))
    : [];
  const me = await employeeIdForUser(ws, personId);
  const cycles = (await db()
    .prepare(
      `SELECT c.id, c.name, c.status FROM people_cycles c WHERE c.workspace_id = ? AND c.name LIKE ? ESCAPE '\\'
       AND (? = 1 OR (c.status != 'draft' AND EXISTS (SELECT 1 FROM people_reviews r WHERE r.cycle_id = c.id AND (r.reviewer_id = ? OR r.subject_id = ?))))
       ORDER BY c.created_at DESC LIMIT 5`,
    )
    .all(ws, like, hr ? 1 : 0, me ?? '-', me ?? '-')) as Array<{ id: string; name: string; status: string }>;
  return [...people, ...templates, ...cycles.map((c) => ({ kind: 'cycle' as const, id: c.id, label: c.name, meta: c.status }))];
}
