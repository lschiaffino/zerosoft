/**
 * Menciones de fecha y recordatorios de Docs (@hoy, @mañana, @3/11,
 * @recordar mañana 9:00). Puro: lo usan el popover de @ del editor, el
 * saneado del servidor y la sincronización de recordatorios.
 *
 * En el HTML-lite de un bloque una mención de fecha es
 *   <span data-date="2026-10-25" [data-time="09:00"] [data-remind="<ISO>" data-rid="<id>"]>Oct 25, 2026</span>
 * y se trata como atómica (como los links a página). `data-remind` es el
 * instante UTC en que avisa; lo calcula el navegador con su zona horaria.
 */

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const RID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export interface DateSuggestion {
  key: string;
  date: string;
  time?: string;
  remind: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function dayString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

function strip(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').trim();
}

const TODAY = ['today', 'hoy', 'hoje', 'now'];
const TOMORROW = ['tomorrow', 'manana', 'amanha'];
const YESTERDAY = ['yesterday', 'ayer', 'ontem'];
const NEXT_WEEK = ['next week', 'proxima semana', 'semana que viene', 'semana que vem'];
const REMIND = ['remind', 'reminder', 'recordar', 'recordatorio', 'recordame', 'lembrar', 'lembrete', 'remind me'];
const WEEKDAYS: string[][] = [
  ['sunday', 'domingo', 'sun', 'dom'],
  ['monday', 'lunes', 'segunda', 'mon', 'lun', 'seg'],
  ['tuesday', 'martes', 'terca', 'tue', 'mar', 'ter'],
  ['wednesday', 'miercoles', 'quarta', 'wed', 'mie', 'qua'],
  ['thursday', 'jueves', 'quinta', 'thu', 'jue', 'qui'],
  ['friday', 'viernes', 'sexta', 'fri', 'vie', 'sex'],
  ['saturday', 'sabado', 'sat', 'sab'],
];
const MONTHS: string[][] = [
  ['jan', 'january', 'ene', 'enero', 'janeiro'],
  ['feb', 'february', 'febrero', 'fev', 'fevereiro'],
  ['mar', 'march', 'marzo', 'marco'],
  ['apr', 'april', 'abr', 'abril'],
  ['may', 'mayo', 'mai', 'maio'],
  ['jun', 'june', 'junio', 'junho'],
  ['jul', 'july', 'julio', 'julho'],
  ['aug', 'august', 'ago', 'agosto'],
  ['sep', 'sept', 'september', 'septiembre', 'set', 'setembro'],
  ['oct', 'october', 'octubre', 'out', 'outubro'],
  ['nov', 'november', 'noviembre', 'novembro'],
  ['dec', 'december', 'dic', 'diciembre', 'dez', 'dezembro'],
];

/** "9", "9am", "9:30", "21:15", "9.30pm" → "HH:MM"; null si no es una hora. */
export function parseTime(raw: string): string | null {
  const m = strip(raw).match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|hs|h)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  if (!m[2] && !m[3] && h > 23) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** Una fecha escrita ("hoy", "viernes", "3/11", "nov 3", "2026-11-03") relativa a `now`. */
export function parseDay(raw: string, now: Date, locale = 'en'): string | null {
  const q = strip(raw);
  if (!q) return null;
  if (TODAY.includes(q)) return dayString(now);
  if (TOMORROW.includes(q)) return dayString(addDays(now, 1));
  if (YESTERDAY.includes(q)) return dayString(addDays(now, -1));
  if (NEXT_WEEK.includes(q)) return dayString(addDays(now, 7));
  const wd = WEEKDAYS.findIndex((names) => names.includes(q));
  if (wd !== -1) {
    const diff = (wd - now.getDay() + 7) % 7 || 7;
    return dayString(addDays(now, diff));
  }
  if (DAY_RE.test(q)) {
    const d = new Date(`${q}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : q;
  }
  // 3/11 o 3/11/2026: día/mes salvo en inglés (mes/día).
  const num = q.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (num) {
    const a = Number(num[1]);
    const b = Number(num[2]);
    const [month, day] = locale.startsWith('en') ? [a, b] : [b, a];
    let year = num[3] ? Number(num[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    return validDay(year, month, day);
  }
  // "nov 3", "3 nov", "3 de noviembre", "november 3 2026".
  const words = q.replace(/,/g, ' ').replace(/\bde\b/g, ' ').split(/\s+/).filter(Boolean);
  let month = -1;
  let day = -1;
  let year = now.getFullYear();
  for (const w of words) {
    const mi = MONTHS.findIndex((names) => names.includes(w));
    if (mi !== -1 && month === -1) month = mi + 1;
    else if (/^\d{1,2}$/.test(w) && day === -1) day = Number(w);
    else if (/^\d{4}$/.test(w)) year = Number(w);
    else return null;
  }
  if (month !== -1 && day !== -1) return validDay(year, month, day);
  return null;
}

function validDay(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getMonth() !== month - 1) return null;
  return dayString(d);
}

/**
 * Opciones de fecha para el popover de @ según lo tipeado: vacío → hoy,
 * mañana y un recordatorio; "mañana 15:00", "viernes", "3/11"; con
 * "recordar …" delante son recordatorios. Sin coincidencia: [].
 */
export function dateSuggestions(query: string, now: Date, locale = 'en'): DateSuggestion[] {
  const q = strip(query);
  if (!q) {
    return [
      { key: 'today', date: dayString(now), remind: false },
      { key: 'tomorrow', date: dayString(addDays(now, 1)), remind: false },
      { key: 'remind', date: dayString(addDays(now, 1)), time: '09:00', remind: true },
    ];
  }
  let rest = q;
  let remind = false;
  for (const r of [...REMIND].sort((a, b) => b.length - a.length)) {
    if (rest === r || rest.startsWith(`${r} `)) {
      remind = true;
      rest = rest.slice(r.length).trim();
      break;
    }
    // "rec", "rem", "lemb": prefijo de la palabra mientras se escribe.
    if (r.startsWith(rest) && rest.length >= 3) {
      return [{ key: 'remind', date: dayString(addDays(now, 1)), time: '09:00', remind: true }];
    }
  }
  if (remind && !rest) return [{ key: 'remind', date: dayString(addDays(now, 1)), time: '09:00', remind: true }];
  // La hora al final ("mañana 9am", "viernes 15:30").
  let time: string | undefined;
  const parts = rest.split(/\s+/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    const lastTwo = parts.slice(-2).join('');
    const t = parseTime(last) ?? (parts.length > 2 ? parseTime(lastTwo) : null);
    if (t) {
      time = t;
      parts.splice(parseTime(last) ? -1 : -2);
      rest = parts.join(' ');
    }
  }
  let date = parseDay(rest, now, locale);
  // Prefijo de "hoy"/"mañana"/"tomorrow" mientras se escribe.
  if (!date && rest.length >= 2) {
    if (TODAY.some((w) => w.startsWith(rest))) date = dayString(now);
    else if (TOMORROW.some((w) => w.startsWith(rest))) date = dayString(addDays(now, 1));
    else if (YESTERDAY.some((w) => w.startsWith(rest))) date = dayString(addDays(now, -1));
  }
  if (!date) return [];
  if (remind) return [{ key: 'remind', date, time: time ?? '09:00', remind: true }];
  // "Hoy" y "Mañana" se muestran con su nombre (como Notion), el resto con la fecha.
  const key = date === dayString(now) ? 'today' : date === dayString(addDays(now, 1)) ? 'tomorrow' : 'date';
  const out: DateSuggestion[] = [{ key, date, time, remind: false }];
  out.push({ key: 'remind', date, time: time ?? '09:00', remind: true });
  return out;
}

/** Instante UTC (ISO) de una fecha y hora en la zona del navegador. */
export function localInstant(date: string, time = '09:00'): string {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min).toISOString();
}

/** Texto visible de una mención de fecha en el idioma de la página. */
export function dateLabel(date: string, time: string | undefined, locale: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const when = new Date(y, m - 1, d, ...(time ? (time.split(':').map(Number) as [number, number]) : [0, 0]));
  const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(when);
  if (!time) return day;
  const t = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(when);
  return `${day} ${t}`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** HTML de una mención de fecha (con recordatorio si `remindAt`). */
export function dateMentionHtml(opts: { date: string; time?: string; remindAt?: string; rid?: string; label: string }): string {
  const attrs = [`data-date="${opts.date}"`];
  if (opts.time && TIME_RE.test(opts.time)) attrs.push(`data-time="${opts.time}"`);
  if (opts.remindAt && opts.rid && RID_RE.test(opts.rid) && !Number.isNaN(Date.parse(opts.remindAt))) {
    attrs.push(`data-remind="${new Date(opts.remindAt).toISOString()}"`, `data-rid="${opts.rid}"`);
  }
  return `<span ${attrs.join(' ')}>${escapeAttr(opts.label)}</span>`;
}

export interface ParsedReminder {
  rid: string;
  remindAt: string;
  date: string;
  label: string;
}

/** Recordatorios de un HTML-lite (sin DOM: sirve en el servidor). */
export function remindersInHtml(html: string): ParsedReminder[] {
  if (!html || !html.includes('data-remind')) return [];
  const out: ParsedReminder[] = [];
  const re = /<span\b([^>]*)>([^<]*)<\/span>/gi;
  for (const m of html.matchAll(re)) {
    const attrs = m[1];
    const get = (name: string) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1];
    const date = get('data-date');
    const remindAt = get('data-remind');
    const rid = get('data-rid');
    if (!date || !DAY_RE.test(date) || !remindAt || !rid || !RID_RE.test(rid)) continue;
    if (Number.isNaN(Date.parse(remindAt))) continue;
    out.push({ rid, remindAt: new Date(remindAt).toISOString(), date, label: m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') });
  }
  return out;
}
