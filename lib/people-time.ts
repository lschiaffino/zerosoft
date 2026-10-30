/**
 * People: cuentas de tiempo libre, sin base ni red (las prueba
 * tests/unit/people-time.test.ts). Días hábiles con feriados y medio día,
 * devengamiento anual, mensual o por período de pago, con tope de saldo y
 * arrastre al cambiar de año.
 *
 * Fechas siempre 'YYYY-MM-DD' en UTC: un día de licencia es un día de
 * calendario, no un instante.
 */
import HOLIDAYS from './people-holidays.json';

export type AccrualKind = 'annual' | 'monthly' | 'per_pay_period' | 'none';
export type PayPeriod = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
export type HalfDay = '' | 'am' | 'pm';

export const HOLIDAY_COUNTRIES = ['AR', 'BR', 'MX', 'US', 'ES', 'CO'] as const;
export type HolidayCountry = (typeof HOLIDAY_COUNTRIES)[number];

export interface Holiday {
  date: string;
  name: string;
  country: string;
  custom?: boolean;
}

const DAY = 86_400_000;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  return iso(new Date(toDate(isoDate).getTime() + days * DAY));
}

export function diffDays(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
}

export function isWeekend(isoDate: string): boolean {
  const wd = toDate(isoDate).getUTCDay();
  return wd === 0 || wd === 6;
}

/** Feriados nacionales del seed (people-holidays.json) de un país y un año. */
export function seededHolidays(country: string, year: number): Holiday[] {
  const byCountry = (HOLIDAYS as unknown as Record<string, Record<string, Array<[string, string]>>>)[country.toUpperCase()];
  const rows = byCountry?.[String(year)] ?? [];
  return rows.map(([date, name]) => ({ date, name, country: country.toUpperCase() }));
}

/** Años que trae el seed (para avisar cuando falta el año siguiente). */
export function seededYears(): number[] {
  const years = new Set<number>();
  for (const [key, value] of Object.entries(HOLIDAYS as unknown as Record<string, unknown>)) {
    if (key.startsWith('_') || !value || typeof value !== 'object') continue;
    for (const y of Object.keys(value as Record<string, unknown>)) years.add(Number(y));
  }
  return [...years].sort();
}

/**
 * Días de licencia entre dos fechas (inclusive): lunes a viernes que no son
 * feriado. Un pedido de un solo día con medio día ('am' o 'pm') cuenta 0,5.
 */
export function countLeaveDays(start: string, end: string, holidays: Iterable<string> = [], half: HalfDay = ''): number {
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) return 0;
  const off = new Set(holidays);
  let days = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!isWeekend(d) && !off.has(d)) days += 1;
  }
  if (half && start === end && days === 1) return 0.5;
  return days;
}

/** Redondeo a cuartos de día para no arrastrar decimales binarios (1/12 de 15 días…). */
export function roundDays(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface AccrualPolicy {
  accrual: AccrualKind;
  /** Días por año. */
  daysPerYear: number;
  /** Días que pasan al año siguiente; null = todos. */
  carryoverMax: number | null;
  /** Saldo máximo: al llegar, deja de devengar; null = sin tope. */
  capDays: number | null;
}

export interface LedgerUse {
  /** Fecha del pedido (el inicio): define el año al que se descuenta. */
  date: string;
  days: number;
}

export interface LedgerAdjustment {
  date: string;
  /** Positivo suma, negativo resta. */
  days: number;
}

export interface Balance {
  /** Devengado en el año en curso (hasta asOf). */
  accrued: number;
  /** Usado en el año en curso (pedidos aprobados que ya empezaron). */
  used: number;
  /** Aprobado con fecha futura (después de asOf). */
  scheduled: number;
  /** Pendiente de aprobación. */
  pending: number;
  /** Ajustes manuales del año en curso. */
  adjusted: number;
  /** Lo que pasó del año anterior. */
  carriedOver: number;
  /** Saldo a asOf. */
  balance: number;
  /** Saldo menos lo aprobado a futuro y lo pendiente: lo que se puede pedir. */
  available: number;
  /** Lo que se pierde al cerrar el año por el tope de arrastre (estimado sobre el saldo actual). */
  expiringAtYearEnd: number;
}

const PERIODS: Record<PayPeriod, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

/**
 * Fechas de crédito entre el ingreso y `to` (inclusive) y cuánto acredita cada una.
 * - annual: el 1 de enero (el primer año, el día de ingreso, prorrateado por los meses que quedan).
 * - monthly: el día 1 de cada mes (el mes de ingreso cuenta si entra hasta el 15).
 * - per_pay_period: cada fin de período (semanal o quincenal desde el ingreso; quincenal fija = 15 y fin de mes; mensual = fin de mes).
 */
export function accrualEvents(policy: AccrualPolicy, start: string, to: string, payPeriod: PayPeriod = 'monthly'): Array<{ date: string; days: number }> {
  const out: Array<{ date: string; days: number }> = [];
  if (policy.accrual === 'none' || !isIsoDate(start) || !isIsoDate(to) || to < start || policy.daysPerYear <= 0) return out;
  const per = policy.daysPerYear;
  const startY = toDate(start).getUTCFullYear();
  const endY = toDate(to).getUTCFullYear();
  if (policy.accrual === 'annual') {
    for (let y = startY; y <= endY; y++) {
      if (y === startY) {
        // Primer año: los meses que quedan contando el de ingreso.
        const month = toDate(start).getUTCMonth();
        out.push({ date: start, days: roundDays((per * (12 - month)) / 12) });
      } else {
        const d = `${y}-01-01`;
        if (d <= to) out.push({ date: d, days: per });
      }
    }
    return out;
  }
  if (policy.accrual === 'monthly') {
    // El mes de ingreso cuenta si entra hasta el 15; cada crédito cae el 1 del mes (el primero, el día de ingreso).
    const s = toDate(start);
    let y = s.getUTCFullYear();
    let m = s.getUTCMonth();
    if (s.getUTCDate() > 15) {
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
    for (;;) {
      const first = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const date = first < start ? start : first;
      if (date > to) break;
      out.push({ date, days: roundDays(per / 12) });
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
    return out;
  }
  // per_pay_period
  const amount = roundDays(per / PERIODS[payPeriod]);
  if (payPeriod === 'weekly' || payPeriod === 'biweekly') {
    const step = payPeriod === 'weekly' ? 7 : 14;
    for (let d = addDays(start, step - 1); d <= to; d = addDays(d, step)) out.push({ date: d, days: amount });
    return out;
  }
  // semimonthly (15 y último día) o monthly (último día).
  const s = toDate(start);
  let y = s.getUTCFullYear();
  let m = s.getUTCMonth();
  for (;;) {
    const first = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    if (first > to) break;
    const last = iso(new Date(Date.UTC(y, m + 1, 0)));
    const mid = `${y}-${String(m + 1).padStart(2, '0')}-15`;
    for (const d of payPeriod === 'semimonthly' ? [mid, last] : [last]) {
      if (d >= start && d <= to) out.push({ date: d, days: amount });
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/**
 * Saldo de una política para una persona a la fecha `asOf`. Recorre los
 * eventos en orden: al pasar el 1 de enero el saldo se recorta al tope de
 * arrastre; cada crédito respeta el tope de saldo; los usos y ajustes restan
 * o suman sin tope (el saldo puede quedar negativo si se aprobó de más).
 *
 * Una política sin devengamiento ('none') solo tiene ajustes (p. ej. licencia
 * por enfermedad sin saldo): `balance` es lo ajustado menos lo usado.
 */
export function computeBalance(input: {
  policy: AccrualPolicy;
  startDate: string;
  asOf: string;
  payPeriod?: PayPeriod;
  approved: LedgerUse[];
  pending?: LedgerUse[];
  adjustments?: LedgerAdjustment[];
}): Balance {
  const { policy, asOf } = input;
  const start = isIsoDate(input.startDate) ? input.startDate : asOf;
  const year = toDate(asOf).getUTCFullYear();
  type Ev = { date: string; order: number; days: number; kind: 'accrual' | 'adjust' | 'use' };
  const events: Ev[] = [
    ...accrualEvents(policy, start, asOf, input.payPeriod).map((e) => ({ ...e, order: 1, kind: 'accrual' as const })),
    ...(input.adjustments ?? []).filter((a) => a.date <= asOf).map((a) => ({ date: a.date, days: a.days, order: 2, kind: 'adjust' as const })),
    ...input.approved.filter((u) => u.date <= asOf).map((u) => ({ date: u.date, days: -u.days, order: 3, kind: 'use' as const })),
  ].sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1));

  let balance = 0;
  let currentYear = events.length ? toDate(events[0].date).getUTCFullYear() : year;
  let carriedOver = 0;
  let accrued = 0;
  let used = 0;
  let adjusted = 0;
  const rollTo = (y: number) => {
    while (currentYear < y) {
      currentYear += 1;
      const keep = policy.carryoverMax == null ? balance : Math.min(balance, Math.max(0, policy.carryoverMax));
      // Un saldo negativo pasa entero (se debe), uno positivo hasta el tope.
      balance = balance < 0 ? balance : keep;
      carriedOver = balance;
      accrued = 0;
      used = 0;
      adjusted = 0;
    }
  };
  for (const ev of events) {
    rollTo(toDate(ev.date).getUTCFullYear());
    if (ev.kind === 'accrual') {
      let add = ev.days;
      if (policy.capDays != null) add = Math.max(0, Math.min(add, policy.capDays - balance));
      balance += add;
      accrued += add;
    } else if (ev.kind === 'adjust') {
      balance += ev.days;
      adjusted += ev.days;
    } else {
      balance += ev.days;
      used += -ev.days;
    }
  }
  rollTo(year);
  const scheduled = input.approved.filter((u) => u.date > asOf).reduce((s, u) => s + u.days, 0);
  const pending = (input.pending ?? []).reduce((s, u) => s + u.days, 0);
  const keep = policy.carryoverMax == null ? balance : Math.min(balance, Math.max(0, policy.carryoverMax));
  return {
    accrued: roundDays(accrued),
    used: roundDays(used),
    scheduled: roundDays(scheduled),
    pending: roundDays(pending),
    adjusted: roundDays(adjusted),
    carriedOver: roundDays(carriedOver),
    balance: roundDays(balance),
    available: roundDays(balance - scheduled - pending),
    expiringAtYearEnd: roundDays(Math.max(0, balance - scheduled - keep)),
  };
}

/** Fechas de vencimiento de las tareas de una plantilla: relativas al día de ingreso (o de salida). */
export function dueDateFor(anchor: string, offsetDays: number): string {
  return addDays(anchor, Math.trunc(offsetDays));
}

/** Antigüedad en años con un decimal entre el ingreso y `asOf` (o la salida). */
export function tenureYears(start: string | null, end: string | null, asOf: string): number {
  if (!start || !isIsoDate(start)) return 0;
  const to = end && isIsoDate(end) && end < asOf ? end : asOf;
  return Math.max(0, Math.round((diffDays(start, to) / 365.25) * 10) / 10);
}
