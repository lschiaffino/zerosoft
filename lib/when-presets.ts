/**
 * Presets de "cuándo" que comparten Inbox (posponer, recordar si no contesta,
 * enviar más tarde) y Lines (enviar más tarde, posponer). Funciones puras,
 * sirven en el navegador y en el servidor; todo en la zona local.
 *
 * Las opciones cambian con el momento: a la tarde no aparece "Más tarde hoy"
 * si ya cae de noche, el viernes aparece "El lunes a la mañana" y no "La
 * semana que viene", de madrugada "Mañana" es la mañana que viene. Dos modos:
 * - `snooze` (posponer, recordar): "Más tarde hoy", "Esta noche", mañana a
 *   las 8 y el fin de semana.
 * - `send` (enviar más tarde, cambiar la hora): horario de trabajo, mañana a
 *   las 9 y a las 14, el viernes a la tarde; nada cae en sábado o domingo
 *   salvo "Mañana a la mañana" (que el que escribe un viernes puede querer).
 * Nunca hay dos en el mismo minuto, ni en el pasado, y van en orden de fecha.
 */

export type WhenMode = "snooze" | "send";

export type WhenPreset =
  | "later"
  | "tonight"
  | "tomorrow"
  | "tomorrowAfternoon"
  | "twoDays"
  | "midweek"
  | "friday"
  | "weekend"
  | "monday"
  | "nextWeek";
/** Nombre viejo, por compatibilidad. */
export type SnoozePreset = WhenPreset;

/** Todos los presets posibles; cuáles se ven depende del momento (`visiblePresets`). */
export const WHEN_PRESETS: readonly WhenPreset[] = [
  "later",
  "tonight",
  "tomorrow",
  "tomorrowAfternoon",
  "twoDays",
  "midweek",
  "friday",
  "weekend",
  "monday",
  "nextWeek",
];
export const SNOOZE_PRESETS = WHEN_PRESETS;

/** Hora de "a la mañana": posponer vuelve a las 8 (antes de arrancar); un envío sale a las 9. */
export const MORNING: Record<WhenMode, number> = { snooze: 8, send: 9 };
const AFTERNOON = 14;
const EVENING = 20;
const WEEKEND_HOUR = 10;
/** Antes de las 5, "mañana" es la mañana que viene (el mismo día del calendario). */
const NIGHT_END = 5;
/** "Más tarde hoy" se ofrece mientras cae antes de esta hora. */
const LATER_UNTIL: Record<WhenMode, number> = { snooze: 19, send: 19 };

const SUN = 0,
  MON = 1,
  TUE = 2,
  WED = 3,
  THU = 4,
  FRI = 5,
  SAT = 6;

/** El "hoy" para contar días: de madrugada todavía es ayer. Al mediodía, así un cambio de hora no lo mueve de día. */
function baseDay(now: Date): Date {
  const d = new Date(now);
  if (d.getHours() < NIGHT_END) d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d;
}

function dayAt(base: Date, addDays: number, h: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(h, 0, 0, 0);
  return d;
}

/** Días hasta el próximo `to` (día de la semana), al menos `min`. */
function daysUntil(from: number, to: number, min: number): number {
  let n = (to - from + 7) % 7;
  while (n < min) n += 7;
  return n;
}

const isWeekend = (d: Date) => d.getDay() === SAT || d.getDay() === SUN;
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** La fecha de un preset a partir de `now`. Siempre en el futuro. */
export function presetDate(
  preset: WhenPreset,
  now = new Date(),
  mode: WhenMode = "snooze",
): Date {
  const base = baseDay(now);
  const dow = base.getDay();
  const m = MORNING[mode];
  switch (preset) {
    case "later": {
      // Tres horas, redondeado a la media hora que sigue: "15:30", no "15:17".
      const d = new Date(now.getTime() + 3 * 3600_000);
      if (d.getSeconds() || d.getMilliseconds() || d.getMinutes() % 30)
        d.setMinutes(Math.floor(d.getMinutes() / 30) * 30 + 30, 0, 0);
      return d;
    }
    case "tonight": {
      const d = new Date(now);
      d.setHours(EVENING, 0, 0, 0);
      if (d.getTime() <= now.getTime() + 30 * 60_000)
        d.setDate(d.getDate() + 1);
      return d;
    }
    case "tomorrow":
      return dayAt(base, 1, m);
    case "tomorrowAfternoon":
      return dayAt(base, 1, AFTERNOON);
    case "twoDays":
      return dayAt(base, 2, m);
    case "midweek":
      return dayAt(base, daysUntil(dow, WED, 2), m);
    case "friday":
      return dayAt(base, daysUntil(dow, FRI, 2), AFTERNOON);
    case "weekend":
      return dayAt(base, daysUntil(dow, SAT, 2), WEEKEND_HOUR);
    case "monday":
    case "nextWeek":
      return dayAt(base, daysUntil(dow, MON, 2), m);
  }
}

/** Si el preset tiene sentido ahora (sin mirar repetidos). */
function fits(p: WhenPreset, now: Date, mode: WhenMode, at: Date): boolean {
  const late = now.getHours() < NIGHT_END;
  const dow = baseDay(now).getDay();
  switch (p) {
    case "later":
      return (
        !late &&
        sameDay(at, now) &&
        at.getHours() >= MORNING[mode] &&
        at.getHours() < LATER_UNTIL[mode]
      );
    case "tonight":
      return mode === "snooze" && !late && now.getHours() < EVENING - 2;
    case "tomorrow":
      return true;
    case "tomorrowAfternoon":
      return mode === "send" && !isWeekend(at);
    case "twoDays":
      return !(mode === "send" && isWeekend(at));
    case "midweek":
      // Martes y miércoles el miércoles próximo queda después de "La semana que viene".
      return dow !== TUE && dow !== WED;
    case "friday":
      return (
        mode === "send" &&
        (dow === SUN || dow === MON || dow === TUE || dow === WED)
      );
    case "weekend":
      return mode === "snooze" && dow >= MON && dow <= THU;
    case "monday":
      return dow === THU || dow === FRI || dow === SAT;
    case "nextWeek":
      return dow === MON || dow === TUE || dow === WED;
  }
}

/** Un preset para mostrar: cuál es y cuándo cae. */
export interface WhenOption {
  preset: WhenPreset;
  at: Date;
}

/**
 * Las opciones a mostrar ahora, en orden de fecha (los atajos 1, 2, 3… van
 * en ese orden, sin huecos). "En dos días" se va si otra opción ya cae ese
 * día; si dos caen en el mismo minuto, queda una.
 */
export function whenOptions(
  now = new Date(),
  mode: WhenMode = "snooze",
): WhenOption[] {
  const fitting = WHEN_PRESETS.map((preset) => ({
    preset,
    at: presetDate(preset, now, mode),
  })).filter(
    (o) =>
      o.at.getTime() > now.getTime() + 60_000 &&
      fits(o.preset, now, mode, o.at),
  );
  const out: WhenOption[] = [];
  const seen = new Set<number>();
  for (const o of fitting) {
    if (
      o.preset === "twoDays" &&
      fitting.some((x) => x.preset !== "twoDays" && sameDay(x.at, o.at))
    )
      continue;
    const minute = Math.floor(o.at.getTime() / 60_000);
    if (seen.has(minute)) continue;
    seen.add(minute);
    out.push(o);
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Los presets a mostrar ahora, en orden (ver `whenOptions`). */
export function visiblePresets(
  now = new Date(),
  mode: WhenMode = "snooze",
): WhenPreset[] {
  return whenOptions(now, mode).map((o) => o.preset);
}

/** Fecha larga y corta a la vez: "mar, 11 nov, 08:00". */
export function longWhen(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Una fecha por venir, corta para una etiqueta en la fila: "lun 08:00" si es en la semana, si no "22 nov". */
export function aheadWhen(
  iso: string | null,
  locale: string,
  now = new Date(),
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const soon = d.getTime() - now.getTime() < 6 * 86_400_000;
  return soon
    ? d.toLocaleString(locale, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

/** Valor para <input type="datetime-local"> en la zona del navegador. */
export function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- Elegir día y hora a mano ---------- */

export interface ClockTime {
  h: number;
  m: number;
}

/**
 * Lee una hora escrita como la escribe la gente: "9", "9:30", "9.30", "930",
 * "0930", "21", "21hs", "9h", "9pm", "9:30 p. m.", "12am". Devuelve null si
 * no es una hora.
 */
export function parseTimeText(text: string): ClockTime | null {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/(\d)\.(\d)/g, "$1:$2")
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
  const m =
    /^(\d{1,4})(?::(\d{2}))?\s*(am|pm|a|p|a m|p m|hs|h|hrs|horas|hr)?$/.exec(s);
  if (!m) return null;
  let digits = m[1];
  let min = m[2] !== undefined ? Number(m[2]) : 0;
  if (m[2] === undefined && digits.length >= 3) {
    min = Number(digits.slice(-2));
    digits = digits.slice(0, -2);
  } else if (m[2] !== undefined && digits.length > 2) return null;
  let h = Number(digits);
  const suffix = (m[3] ?? "").replace(" ", "");
  if (suffix === "am" || suffix === "a" || suffix === "pm" || suffix === "p") {
    if (h < 1 || h > 12) return null;
    const pm = suffix.startsWith("p");
    h = (h % 12) + (pm ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

/** "Buenos Aires" a partir de la zona del navegador ("America/Argentina/Buenos_Aires"). */
export function zoneCity(timeZone: string): string {
  const last = timeZone.split("/").pop() ?? timeZone;
  return last.replace(/_/g, " ");
}

/** Primer día de la semana en el calendario (0 domingo, 1 lunes) según el idioma. */
export function weekStart(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info?.firstDay) return info.firstDay % 7;
  } catch {
    // Sin Intl.Locale: lo de abajo.
  }
  // en (Estados Unidos) y pt (Brasil) arrancan el domingo; es (Argentina, España) el lunes.
  return locale.startsWith("es") ? 1 : 0;
}

/** Las semanas del mes de `month` (una fecha cualquiera del mes), con los días de los meses vecinos en null. */
export function monthGrid(month: Date, firstDay: number): (Date | null)[][] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const days = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
    12,
  ).getDate();
  const lead = (first.getDay() - firstDay + 7) % 7;
  const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++)
    cells.push(new Date(month.getFullYear(), month.getMonth(), d, 12));
  while (cells.length % 7) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Une un día del calendario con una hora. */
export function atTime(day: Date, t: ClockTime): Date {
  const d = new Date(day);
  d.setHours(t.h, t.m, 0, 0);
  return d;
}

/** Día de calendario, para comparar: 2026-11-17. */
export function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
