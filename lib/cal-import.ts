/**
 * Cal — import desde Calendly con un token de acceso personal (API v2).
 *
 * Lee (en pasos): la cuenta, los horarios de disponibilidad, los tipos de
 * evento (duración, descripción, color, ubicaciones y preguntas) y, si se
 * pidió, las reservas próximas con su invitado. Escribe en ese orden:
 * horarios → tipos de evento (con el horario por defecto importado) →
 * reservas (confirmadas, sin mandar emails: el invitado ya tiene la de
 * Calendly). Lo que ya se importó (por URI de Calendly) se saltea.
 */
import { getDb } from './db';
import {
  getExternalId,
  getExternalIds,
  ImportError,
  setExternalId,
  sourceBase,
  sourceFetch,
  type ImportJob,
  type StagedItem,
} from './import-jobs';
import type { FetchStepResult } from './track-import-sources';
import { CalendarError, createEventType, newManageToken } from './calendar';
import { createSchedule } from './calendar-schedules';
import { eventTypeCreateSchema } from './calendar-schema';
import { locationProblem, type LocationOption } from './calendar-locations';
import type { QuestionType } from './calendar-questions';

// ---------- Tipos normalizados ----------

export interface CalScheduleItem {
  extId: string;
  name: string;
  timezone: string;
  isDefault: boolean;
  rules: Array<{ dayOfWeek: number; startTime: string; endTime: string }>;
  overrides: Array<{ date: string; startTime: string | null; endTime: string | null }>;
}

export interface CalQuestionItem {
  name: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options?: string[];
}

export interface CalEventTypeItem {
  extId: string;
  title: string;
  slug: string;
  durationMin: number;
  description: string;
  color: string | null;
  active: boolean;
  locations: LocationOption[];
  /** Ubicaciones de Calendly sin equivalente (se informan en la vista previa). */
  unmapped: string[];
  questions: CalQuestionItem[];
}

export interface CalBookingItem {
  extId: string;
  eventTypeExtId: string;
  startsAt: string;
  endsAt: string;
  inviteeEmail: string;
  inviteeName: string;
  timezone: string;
  answers: Record<string, string>;
  location: string;
}

// ---------- Mapeo (puro) ----------

const WDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function hhmm(raw: unknown): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(raw ?? ''));
  if (!m) return null;
  const h = Number(m[1]);
  if (h >= 24) return '23:59';
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

interface CalendlyRule {
  type: 'wday' | 'date';
  wday?: string;
  date?: string;
  intervals?: Array<{ from: string; to: string }>;
}

export function mapCalendlySchedule(s: { uri: string; name?: string; timezone?: string; default?: boolean; rules?: CalendlyRule[] }): CalScheduleItem {
  const rules: CalScheduleItem['rules'] = [];
  const overrides: CalScheduleItem['overrides'] = [];
  for (const r of s.rules ?? []) {
    const intervals = (r.intervals ?? [])
      .map((i) => ({ startTime: hhmm(i.from), endTime: hhmm(i.to) }))
      .filter((i): i is { startTime: string; endTime: string } => !!i.startTime && !!i.endTime && i.endTime > i.startTime);
    if (r.type === 'wday') {
      const day = WDAYS.indexOf(String(r.wday ?? '').toLowerCase());
      if (day === -1) continue;
      for (const i of intervals) rules.push({ dayOfWeek: day, ...i });
    } else if (r.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '')) {
      if (intervals.length === 0) overrides.push({ date: r.date!, startTime: null, endTime: null });
      else for (const i of intervals) overrides.push({ date: r.date!, ...i });
    }
  }
  return {
    extId: s.uri,
    name: (s.name || 'Calendly').slice(0, 80),
    timezone: s.timezone || 'UTC',
    isDefault: s.default === true,
    rules: rules.slice(0, 100),
    overrides: overrides.slice(0, 366),
  };
}

interface CalendlyLocation {
  kind: string;
  location?: string | null;
  phone_number?: string | null;
}

function isUrl(v: string): boolean {
  return /^https?:\/\/\S+$/i.test(v);
}

/** Ubicación de Calendly → la nuestra (o null si no tiene equivalente). */
export function mapCalendlyLocation(l: CalendlyLocation): LocationOption | null {
  const value = String(l.location ?? '').trim();
  let opt: LocationOption | null = null;
  switch (l.kind) {
    case 'physical':
      opt = value ? { kind: 'in_person', value } : null;
      break;
    case 'zoom_conference':
      opt = { kind: 'zoom', value: '' };
      break;
    case 'google_conference':
      opt = { kind: 'google_meet', value: '' };
      break;
    case 'microsoft_teams_conference':
      opt = { kind: 'teams', value: '' };
      break;
    case 'outbound_call':
      opt = { kind: 'phone_host', value: '' };
      break;
    case 'inbound_call':
      opt = { kind: 'phone_invitee', value: String(l.phone_number ?? '').trim() };
      break;
    case 'custom':
    case 'webex_conference':
    case 'gotomeeting_conference':
      opt = value ? (isUrl(value) ? { kind: 'link', value } : { kind: 'in_person', value }) : null;
      break;
    default:
      opt = null;
  }
  return opt && !locationProblem(opt) ? opt : null;
}

function questionName(label: string, taken: Set<string>): string {
  let base = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (!/^[a-z]/.test(base)) base = `q_${base}`.replace(/_+$/, '');
  let name = base || 'q';
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  taken.add(name);
  return name;
}

interface CalendlyQuestion {
  name: string;
  type: string;
  enabled?: boolean;
  required?: boolean;
  position?: number;
  answer_choices?: string[] | null;
}

export function mapCalendlyQuestions(list: CalendlyQuestion[]): CalQuestionItem[] {
  const taken = new Set<string>();
  return [...list]
    .filter((q) => q.enabled !== false && q.name?.trim())
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .slice(0, 20)
    .map((q) => {
      const options = (q.answer_choices ?? []).map((o) => String(o).trim().slice(0, 200)).filter(Boolean).slice(0, 50);
      const type: QuestionType =
        q.type === 'text' ? 'textarea' : q.type === 'phone_number' ? 'phone' : q.type === 'single_select' ? 'radio' : q.type === 'multi_select' ? 'checkbox' : 'text';
      const optioned = type === 'radio' || type === 'checkbox';
      return {
        name: questionName(q.name, taken),
        label: q.name.trim().slice(0, 200),
        type: optioned && options.length === 0 ? 'text' : type,
        required: q.required === true,
        ...(optioned && options.length ? { options } : {}),
      };
    });
}

export function calendlySlug(raw: string | null | undefined, fallback: string): string {
  const s = String(raw || fallback)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return s || 'event';
}

interface CalendlyEventType {
  uri: string;
  name?: string;
  slug?: string;
  duration?: number;
  description_plain?: string | null;
  color?: string | null;
  active?: boolean;
  type?: string;
  secret?: boolean;
  locations?: CalendlyLocation[] | null;
  custom_questions?: CalendlyQuestion[] | null;
}

export function mapCalendlyEventType(e: CalendlyEventType): CalEventTypeItem {
  const locations: LocationOption[] = [];
  const unmapped: string[] = [];
  for (const l of e.locations ?? []) {
    const mapped = mapCalendlyLocation(l);
    if (mapped && locations.length < 8) locations.push(mapped);
    else if (!mapped) unmapped.push(l.kind);
  }
  return {
    extId: e.uri,
    title: (e.name || 'Event').slice(0, 200),
    slug: calendlySlug(e.slug, e.name ?? 'event'),
    durationMin: Math.max(1, Math.round(Number(e.duration) || 30)),
    description: (e.description_plain ?? '').slice(0, 2000),
    color: /^#[0-9a-f]{6}$/i.test(e.color ?? '') ? e.color! : null,
    active: e.active !== false,
    locations,
    unmapped,
    questions: mapCalendlyQuestions(e.custom_questions ?? []),
  };
}

// ---------- Lectura ----------

interface Collection<T> {
  collection: T[];
  pagination?: { next_page_token?: string | null };
}

function calendlyHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

/** Último segmento de un URI de Calendly (uuid), para armar la URL con nuestra base. */
function uuidOf(uri: string): string | null {
  const id = uri.split('/').pop() ?? '';
  return /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null;
}

/**
 * Pasos: me → schedules → event_types (paginado) → events (paginado, con el
 * invitado de cada uno) si `includeBookings`.
 */
export async function calFetchStep(job: ImportJob): Promise<FetchStepResult> {
  const base = sourceBase('calendly', 'https://api.calendly.com');
  const headers = calendlyHeaders(job.secret);
  if (!job.secret) throw new ImportError('unauthorized');
  const c = job.cursor;
  const phase = (c.phase as string) || 'me';
  const user = c.user as string | undefined;
  const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

  if (phase === 'me') {
    const { data } = await sourceFetch<{ resource: { uri: string; timezone?: string } }>(`${base}/users/me`, { headers });
    return { items: [], cursor: { phase: 'schedules', user: data.resource.uri }, done: false };
  }
  if (!user) throw new ImportError('source_error');

  if (phase === 'schedules') {
    const { data } = await sourceFetch<Collection<Parameters<typeof mapCalendlySchedule>[0]>>(
      `${base}/user_availability_schedules?${q({ user })}`,
      { headers },
    );
    return { items: data.collection.map((s) => ({ kind: 'schedule', data: mapCalendlySchedule(s) })), cursor: { phase: 'event_types', user }, done: false };
  }

  if (phase === 'event_types') {
    const params: Record<string, string> = { user, count: '100' };
    if (c.token) params.page_token = String(c.token);
    const { data } = await sourceFetch<Collection<CalendlyEventType>>(`${base}/event_types?${q(params)}`, { headers });
    // Las reuniones de un solo uso (adhoc) de Calendly no son tipos de evento reutilizables.
    const items = data.collection.filter((e) => e.type !== 'AdhocEventType').map((e) => ({ kind: 'event_type', data: mapCalendlyEventType(e) }));
    const next = data.pagination?.next_page_token;
    if (next) return { items, cursor: { phase: 'event_types', user, token: next }, done: false };
    return { items, cursor: { phase: 'events', user }, done: job.options.includeBookings !== true };
  }

  // Reservas próximas (activas), de a 20 con su invitado principal.
  const params: Record<string, string> = { user, status: 'active', count: '20', sort: 'start_time:asc', min_start_time: new Date().toISOString() };
  if (c.token) params.page_token = String(c.token);
  const { data } = await sourceFetch<
    Collection<{ uri: string; start_time: string; end_time: string; event_type?: string; location?: { location?: string; join_url?: string } | null }>
  >(`${base}/scheduled_events?${q(params)}`, { headers });
  const items: FetchStepResult['items'] = [];
  for (const ev of data.collection) {
    const uuid = uuidOf(ev.uri);
    if (!uuid || !ev.event_type) continue;
    const { data: inv } = await sourceFetch<
      Collection<{ email: string; name?: string; timezone?: string; questions_and_answers?: Array<{ question: string; answer: string }> }>
    >(`${base}/scheduled_events/${uuid}/invitees?${q({ count: '5', status: 'active' })}`, { headers });
    const first = inv.collection[0];
    if (!first?.email) continue;
    const booking: CalBookingItem = {
      extId: ev.uri,
      eventTypeExtId: ev.event_type,
      startsAt: new Date(ev.start_time).toISOString(),
      endsAt: new Date(ev.end_time).toISOString(),
      inviteeEmail: first.email.slice(0, 320),
      inviteeName: (first.name ?? '').slice(0, 200),
      timezone: first.timezone || 'UTC',
      answers: Object.fromEntries((first.questions_and_answers ?? []).slice(0, 20).map((a) => [a.question.slice(0, 200), String(a.answer ?? '').slice(0, 2000)])),
      location: String(ev.location?.join_url || ev.location?.location || '').slice(0, 500),
    };
    items.push({ kind: 'booking', data: booking });
  }
  const next = data.pagination?.next_page_token;
  return { items, cursor: { phase: 'events', user, token: next ?? null }, done: !next };
}

// ---------- Vista previa ----------

export async function calPreview(job: ImportJob, items: StagedItem[]): Promise<Record<string, unknown>> {
  const ws = job.workspace_id;
  const of = <T>(kind: string) => items.filter((i) => i.kind === kind).map((i) => i.data as unknown as T);
  const schedules = of<CalScheduleItem>('schedule');
  const eventTypes = of<CalEventTypeItem>('event_type');
  const bookings = of<CalBookingItem>('booking');
  const [sDone, eDone, bDone] = await Promise.all([
    getExternalIds(ws, 'calendly', 'schedule', schedules.map((s) => s.extId)),
    getExternalIds(ws, 'calendly', 'event_type', eventTypes.map((e) => e.extId)),
    getExternalIds(ws, 'calendly', 'booking', bookings.map((b) => b.extId)),
  ]);
  return {
    schedules: schedules.map((s) => ({ name: s.name, timezone: s.timezone, rules: s.rules.length, isDefault: s.isDefault, already: sDone.has(s.extId) })),
    eventTypes: eventTypes.map((e) => ({
      title: e.title,
      slug: e.slug,
      durationMin: e.durationMin,
      locations: e.locations.length,
      questions: e.questions.length,
      unmapped: e.unmapped,
      active: e.active,
      already: eDone.has(e.extId),
    })),
    bookings: bookings.length,
    bookingsAlready: bDone.size,
    includeBookings: job.options.includeBookings === true,
  };
}

// ---------- Escritura ----------

export interface CalImportReport {
  [key: string]: unknown;
  schedules: number;
  eventTypes: number;
  bookings: number;
  skipped: number;
  failed: Array<{ title: string; reason: string }>;
  renamed: Array<{ from: string; to: string }>;
  defaultScheduleId: string | null;
}

export function emptyCalReport(): CalImportReport {
  return { schedules: 0, eventTypes: 0, bookings: 0, skipped: 0, failed: [], renamed: [], defaultScheduleId: null };
}

async function exists(table: 'calendar_schedules' | 'calendar_event_types' | 'calendar_bookings', id: string | null): Promise<boolean> {
  if (!id) return false;
  return Boolean(await getDb().prepare(`SELECT 1 AS one FROM ${table} WHERE id = ?`).get(id));
}

async function writeEventType(job: ImportJob, e: CalEventTypeItem, report: CalImportReport): Promise<void> {
  const ws = job.workspace_id;
  const base = {
    title: e.title,
    durationMin: e.durationMin,
    description: e.description,
    color: e.color ?? undefined,
    active: e.active,
    locations: e.locations,
    fields: e.questions,
    ...(report.defaultScheduleId ? { scheduleId: report.defaultScheduleId } : {}),
  };
  // Si algo no valida (una ubicación o pregunta rara), se prueba sin eso antes de rendirse.
  let parsed = eventTypeCreateSchema.safeParse({ ...base, slug: e.slug });
  if (!parsed.success) parsed = eventTypeCreateSchema.safeParse({ ...base, slug: e.slug, locations: [], fields: [] });
  if (!parsed.success) {
    report.failed.push({ title: e.title, reason: 'invalid' });
    return;
  }
  for (let i = 1; i <= 20; i++) {
    const slug = i === 1 ? e.slug : `${e.slug.slice(0, 58)}-${i}`;
    try {
      const created = await createEventType(ws, { ...parsed.data, slug });
      await setExternalId(ws, 'calendly', 'event_type', e.extId, created.id);
      report.eventTypes += 1;
      if (i > 1) report.renamed.push({ from: e.slug, to: slug });
      return;
    } catch (err) {
      if (err instanceof CalendarError && err.code === 'slug_taken') continue;
      report.failed.push({ title: e.title, reason: err instanceof CalendarError ? err.code : 'error' });
      return;
    }
  }
  report.failed.push({ title: e.title, reason: 'slug_taken' });
}

export async function calWriteStep(job: ImportJob, items: StagedItem[], report: CalImportReport): Promise<void> {
  const ws = job.workspace_id;
  for (const item of items) {
    if (item.kind === 'schedule') {
      const s = item.data as unknown as CalScheduleItem;
      const mapped = await getExternalId(ws, 'calendly', 'schedule', s.extId);
      if (await exists('calendar_schedules', mapped)) {
        if (s.isDefault || !report.defaultScheduleId) report.defaultScheduleId = mapped;
        report.skipped += 1;
        continue;
      }
      try {
        const created = await createSchedule(ws, {
          name: s.name,
          timezone: s.timezone,
          rules: s.rules,
          overrides: s.overrides,
          isDefault: s.isDefault,
        });
        await setExternalId(ws, 'calendly', 'schedule', s.extId, created.id);
        if (s.isDefault || !report.defaultScheduleId) report.defaultScheduleId = created.id;
        report.schedules += 1;
      } catch {
        report.failed.push({ title: s.name, reason: 'invalid' });
      }
    } else if (item.kind === 'event_type') {
      const e = item.data as unknown as CalEventTypeItem;
      const mapped = await getExternalId(ws, 'calendly', 'event_type', e.extId);
      if (await exists('calendar_event_types', mapped)) {
        report.skipped += 1;
        continue;
      }
      await writeEventType(job, e, report);
    } else if (item.kind === 'booking') {
      const b = item.data as unknown as CalBookingItem;
      const mapped = await getExternalId(ws, 'calendly', 'booking', b.extId);
      if (await exists('calendar_bookings', mapped)) {
        report.skipped += 1;
        continue;
      }
      const eventTypeId = await getExternalId(ws, 'calendly', 'event_type', b.eventTypeExtId);
      if (!(await exists('calendar_event_types', eventTypeId))) continue;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await getDb()
        .prepare(
          `INSERT INTO calendar_bookings (id, event_type_id, invitee_email, invitee_name, starts_at, ends_at, timezone, status, answers,
             host_user_id, manage_token, locale, location, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          eventTypeId!,
          b.inviteeEmail,
          b.inviteeName,
          b.startsAt,
          b.endsAt,
          b.timezone,
          JSON.stringify(b.answers),
          job.user_id,
          newManageToken(),
          job.locale,
          b.location,
          now,
          now,
        );
      await setExternalId(ws, 'calendly', 'booking', b.extId, id);
      report.bookings += 1;
    }
  }
}
