/**
 * Zona horaria de un proyecto de Analytics. Un proyecto tiene una zona IANA
 * (con horario de verano) o, si es de antes, un desfase fijo en minutos. Todas
 * las cuentas de días y cubetas pasan por acá: las de JS y las de SQL tienen
 * que dar la misma etiqueta.
 */
export type Tz = number | string;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    if (formatters.size > 500) formatters.clear();
    formatters.set(zone, f);
  }
  return f;
}

export function isTimeZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** Minutos que la zona está adelante de UTC en ese instante. */
function zoneOffsetMin(zone: string, at: number): number {
  const p: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(at))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((local - Math.floor(at / 1000) * 1000) / MIN);
}

/** Desfase en ms en ese instante. Una zona que no existe vale como UTC. */
export function offsetMsAt(tz: Tz, at: number): number {
  if (typeof tz === 'number') return tz * MIN;
  try {
    return zoneOffsetMin(tz, at) * MIN;
  } catch {
    return 0;
  }
}

/**
 * De una hora local (como si fuera UTC) al instante real. Una hora que no
 * existe (salto de primavera) cae después del salto; una repetida (otoño), en
 * la primera vez que pasa.
 */
export function fromLocal(local: number, tz: Tz): number {
  if (typeof tz === 'number') return local - tz * MIN;
  // Dos candidatos: con el desfase de un día antes y de un día después.
  const before = local - offsetMsAt(tz, local - DAY);
  const after = local - offsetMsAt(tz, local + DAY);
  const ok = (t: number) => t + offsetMsAt(tz, t) === local;
  if (ok(before) && ok(after)) return Math.min(before, after);
  if (ok(before)) return before;
  if (ok(after)) return after;
  // Hora inexistente: el instante del salto.
  return Math.max(before, after);
}

/** Cambios de desfase de un año, ordenados. Se recuerdan por zona y año: en cada consulta harían falta los mismos. */
const yearCache = new Map<string, Array<{ at: number; offset: number }>>();

function transitionsOfYear(zone: string, year: number): Array<{ at: number; offset: number }> {
  const key = `${zone}:${year}`;
  const hit = yearCache.get(key);
  if (hit) return hit;
  const out: Array<{ at: number; offset: number }> = [];
  const end = Date.UTC(year + 1, 0, 1);
  let t = Date.UTC(year, 0, 1);
  let off = offsetMsAt(zone, t);
  while (t < end) {
    const next = Math.min(t + DAY, end);
    const nextOff = offsetMsAt(zone, next);
    if (nextOff !== off) {
      // Búsqueda binaria hasta el minuto.
      let lo = t;
      let hi = next;
      while (hi - lo > MIN) {
        const mid = Math.floor((lo + hi) / 2 / MIN) * MIN;
        if (mid <= lo) break;
        if (offsetMsAt(zone, mid) === off) lo = mid;
        else hi = mid;
      }
      out.push({ at: hi, offset: nextOff });
      off = nextOff;
    }
    t = next;
  }
  if (yearCache.size > 2000) yearCache.clear();
  yearCache.set(key, out);
  return out;
}

/** Cambios de desfase dentro de un rango. */
export function transitionsIn(tz: Tz, from: number, to: number): Array<{ at: number; offset: number }> {
  if (typeof tz === 'number' || !isTimeZone(tz)) return [];
  const a = new Date(from).getUTCFullYear();
  const b = new Date(to).getUTCFullYear();
  const out: Array<{ at: number; offset: number }> = [];
  for (let y = Math.max(a, 1970); y <= b && y - a < 50; y++) {
    for (const x of transitionsOfYear(tz, y)) if (x.at > from && x.at <= to) out.push(x);
  }
  return out;
}

/**
 * Lo que hay que sumarle en SQL al desfase del inicio del rango para los
 * eventos que caen después de un cambio de hora: '' si no hay cambios. Son
 * números calculados acá, no datos de nadie, así que van en el texto.
 */
export function tzShiftSql(tz: Tz, from: number, to: number, col = 'e.ts'): string {
  const list = transitionsIn(tz, from, to);
  if (!list.length) return '';
  const base = offsetMsAt(tz, from);
  const whens = [...list]
    .reverse()
    .map((x) => `WHEN ${col} >= ${Math.trunc(x.at)} THEN ${Math.trunc(x.offset - base)}`)
    .join(' ');
  return ` + (CASE ${whens} ELSE 0 END)`;
}

/** Zona o desfase de un proyecto. */
export function projectTz(p: { tz_name?: string | null; tz_offset_min: number }): Tz {
  return p.tz_name ? p.tz_name : Number(p.tz_offset_min);
}

/** "UTC−3", "UTC+5:30" en un instante. */
export function offsetLabel(tz: Tz, at: number): string {
  const min = Math.round(offsetMsAt(tz, at) / MIN);
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${min >= 0 ? '+' : '−'}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}
