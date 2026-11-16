/**
 * Time (registro de horas, contra Harvest): tipos y reglas puras, sin base,
 * para que los tests las prueben solas.
 *
 * Reglas que importan:
 * - Una entrada es de una persona, en un día (`spent_date`, la fecha local de
 *   quien la carga) y contra un proyecto y una tarea del mismo workspace.
 * - Un cronómetro corriendo es una entrada con `timer_started_at`. Cada persona
 *   tiene como mucho uno: arrancar otro para el que estaba.
 * - Una entrada no pasa de 24 horas.
 * - Es facturable si el proyecto y la tarea lo son; el monto sale de la tarifa
 *   por hora del proyecto.
 *
 * Sin imports de Node: la interfaz usa las mismas funciones.
 */
export const MAX_ENTRY_MINUTES = 24 * 60;
export const MAX_NAME = 120;
export const MAX_NOTES = 2000;
/** Monedas de las tarifas (una por workspace). */
export const CURRENCIES = ['USD', 'EUR', 'ARS', 'BRL', 'MXN', 'CLP', 'COP', 'UYU', 'PEN', 'GBP', 'CAD', 'AUD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export type TimeErrorCode = 'invalid_input' | 'not_found' | 'forbidden' | 'project_archived' | 'task_archived' | 'too_long' | 'in_use' | 'duplicate';

export class TimeError extends Error {
  constructor(
    public code: TimeErrorCode,
    public status: number,
  ) {
    super(code);
  }
}

/** Quién actúa: workspace (id del dueño), persona y si administra. */
export interface TimeActor {
  ws: string;
  person: string;
  admin: boolean;
  name: string;
  email: string;
}

/** "YYYY-MM-DD" válido (fecha real, no solo el formato). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Suma días a una fecha "YYYY-MM-DD" (en UTC, sin husos de por medio). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana de una fecha. */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

/** Los siete días (lunes a domingo) de la semana de una fecha. */
export function weekDays(date: string): string[] {
  const start = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Primer y último día del mes de una fecha. */
export function monthRange(date: string): { from: string; to: string } {
  const from = `${date.slice(0, 7)}-01`;
  const [y, m] = from.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${date.slice(0, 7)}-${String(last).padStart(2, '0')}` };
}

/**
 * Lo que la persona escribe como duración, en minutos: "1:30", "1.5", "1,5",
 * "90m", "2h", "1h 30m", "45" (horas si es un número suelto, como en Harvest).
 * null si no se entiende, es negativo o pasa de 24 horas.
 */
export function parseDuration(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  let minutes: number | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2}):(\d{1,2})$/.exec(s))) {
    const mm = Number(m[2]);
    if (mm >= 60) return null;
    minutes = Number(m[1]) * 60 + mm;
  } else if ((m = /^(?:(\d+(?:[.,]\d+)?) ?h)? ?(?:(\d+) ?m(?:in)?)?$/.exec(s)) && (m[1] || m[2])) {
    minutes = Math.round(Number((m[1] ?? '0').replace(',', '.')) * 60) + Number(m[2] ?? 0);
  } else if ((m = /^(\d+(?:[.,]\d+)?)$/.exec(s))) {
    minutes = Math.round(Number(m[1].replace(',', '.')) * 60);
  }
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0 || minutes > MAX_ENTRY_MINUTES) return null;
  return minutes;
}

/** Minutos como "h:mm" (lo que muestra Harvest): 90 → "1:30". */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Minutos de una entrada contando el cronómetro que corre. */
export function liveMinutes(entry: { minutes: number; timerStartedAt: string | null }, now: number): number {
  if (!entry.timerStartedAt) return entry.minutes;
  const started = Date.parse(entry.timerStartedAt);
  if (Number.isNaN(started)) return entry.minutes;
  return Math.min(MAX_ENTRY_MINUTES, entry.minutes + Math.max(0, Math.floor((now - started) / 60_000)));
}

/** Monto facturable en centavos: minutos facturables por la tarifa por hora (centavos). */
export function billableCents(minutes: number, rateCents: number | null): number {
  if (!rateCents || minutes <= 0) return 0;
  return Math.round((minutes * rateCents) / 60);
}

export type ReportGroup = 'project' | 'client' | 'task' | 'person';
export const REPORT_GROUPS: readonly ReportGroup[] = ['project', 'client', 'task', 'person'];

/** Una fila de entrada para el reporte, ya con los nombres. */
export interface ReportEntry {
  id: string;
  date: string;
  personId: string;
  personName: string;
  projectId: string;
  projectName: string;
  clientId: string | null;
  clientName: string | null;
  taskId: string;
  taskName: string;
  notes: string;
  minutes: number;
  billable: boolean;
  rateCents: number | null;
}

export interface ReportRow {
  key: string;
  label: string;
  minutes: number;
  billableMinutes: number;
  amountCents: number;
}

export interface ReportTotals {
  minutes: number;
  billableMinutes: number;
  amountCents: number;
}

/** Agrupa entradas por proyecto, cliente, tarea o persona, de más a menos horas. */
export function summarize(entries: ReportEntry[], group: ReportGroup): { rows: ReportRow[]; totals: ReportTotals } {
  const map = new Map<string, ReportRow>();
  const totals: ReportTotals = { minutes: 0, billableMinutes: 0, amountCents: 0 };
  for (const e of entries) {
    const [key, label] =
      group === 'project' ? [e.projectId, e.projectName] : group === 'client' ? [e.clientId ?? '', e.clientName ?? ''] : group === 'task' ? [e.taskId, e.taskName] : [e.personId, e.personName];
    const row = map.get(key) ?? { key, label, minutes: 0, billableMinutes: 0, amountCents: 0 };
    const amount = e.billable ? billableCents(e.minutes, e.rateCents) : 0;
    row.minutes += e.minutes;
    totals.minutes += e.minutes;
    if (e.billable) {
      row.billableMinutes += e.minutes;
      totals.billableMinutes += e.minutes;
    }
    row.amountCents += amount;
    totals.amountCents += amount;
    map.set(key, row);
  }
  const rows = [...map.values()].sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label));
  return { rows, totals };
}

function csvCell(value: string | number): string {
  const s = String(value);
  // Una celda que empieza con =, +, - o @ se lee como fórmula en una planilla.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV del detalle (una fila por entrada), con encabezados en el idioma de la persona. */
export function entriesCsv(
  entries: ReportEntry[],
  headers: Record<'date' | 'person' | 'client' | 'project' | 'task' | 'notes' | 'hours' | 'billable' | 'amount', string>,
  yes: string,
  no: string,
): string {
  const head = [headers.date, headers.person, headers.client, headers.project, headers.task, headers.notes, headers.hours, headers.billable, headers.amount];
  const lines = [head.map(csvCell).join(',')];
  for (const e of entries) {
    const amount = e.billable ? billableCents(e.minutes, e.rateCents) / 100 : 0;
    lines.push([e.date, e.personName, e.clientName ?? '', e.projectName, e.taskName, e.notes, (e.minutes / 60).toFixed(2), e.billable ? yes : no, amount.toFixed(2)].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Nombre limpio: una línea, sin espacios de más, acotado. */
export function cleanName(raw: unknown, max = MAX_NAME): string {
  return String(raw ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/* ---------- Hoja semanal (vista Week de Harvest) ---------- */

/** Lo mínimo de una entrada que la grilla necesita. */
export interface GridEntry {
  id: string;
  date: string;
  projectId: string;
  taskId: string;
  notes: string;
  minutes: number;
  timerStartedAt: string | null;
}

/** Una fila de la grilla: un proyecto con una tarea. */
export interface RowKey {
  projectId: string;
  taskId: string;
}

export interface WeekRow<E extends GridEntry = GridEntry> extends RowKey {
  key: string;
  /** Entradas de cada día de la semana (puede haber varias en un día). */
  cells: Record<string, E[]>;
}

export const rowKey = (r: RowKey) => `${r.projectId}|${r.taskId}`;

/**
 * Filas de la semana: una por proyecto y tarea con horas, en el orden en que se
 * cargaron, y después las agregadas a mano (sin horas todavía) que no estén.
 */
export function weekRows<E extends GridEntry>(entries: E[], days: string[], extra: RowKey[] = []): WeekRow<E>[] {
  const map = new Map<string, WeekRow<E>>();
  const blank = (r: RowKey): WeekRow<E> => ({
    key: rowKey(r),
    projectId: r.projectId,
    taskId: r.taskId,
    cells: Object.fromEntries(days.map((d) => [d, [] as E[]])),
  });
  for (const e of entries) {
    if (!days.includes(e.date)) continue;
    const k = rowKey(e);
    const row = map.get(k) ?? blank(e);
    row.cells[e.date].push(e);
    map.set(k, row);
  }
  for (const r of extra) if (!map.has(rowKey(r))) map.set(rowKey(r), blank(r));
  return [...map.values()];
}

/**
 * Qué hacer al escribir en una celda (`minutes` null = la vació):
 * - varias entradas o un cronómetro corriendo: se edita en el día (`locked`);
 * - vacía y sin horas: nada; vacía con horas: entrada nueva;
 * - una entrada: se cambia; vaciarla la borra, salvo que tenga notas (queda en 0).
 */
export type CellPlan = { kind: 'none' } | { kind: 'locked' } | { kind: 'create'; minutes: number } | { kind: 'update'; id: string; minutes: number } | { kind: 'delete'; id: string };

export function cellPlan(cell: GridEntry[], minutes: number | null): CellPlan {
  if (cell.length > 1 || cell.some((e) => e.timerStartedAt)) return { kind: 'locked' };
  const next = minutes ?? 0;
  const cur = cell[0];
  if (!cur) return next > 0 ? { kind: 'create', minutes: next } : { kind: 'none' };
  if (next === cur.minutes) return { kind: 'none' };
  if (next === 0 && !cur.notes.trim()) return { kind: 'delete', id: cur.id };
  return { kind: 'update', id: cur.id, minutes: next };
}
