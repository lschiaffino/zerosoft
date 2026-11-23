/**
 * Track — Time in status (como Linear): cuánto lleva un issue en su status
 * actual y cuánto pasó en total en cada status. Los períodos los escriben
 * triggers sobre track_issues (migración 20261123_0228_track_status_time):
 * una fila por cada entrada a un status.
 *
 * Lo puro (summarizeStatusPeriods, durationParts) lo usan también los
 * componentes; la lectura de la base vive en lib/track-status-time-db.ts.
 */

export interface StatusLogEntry {
  status_id: string | null;
  status_name: string | null;
  status_category: string | null;
  entered_at: string;
}

export interface StatusTotal {
  /** id del status, o `name:<nombre>` si el status ya no existe. */
  key: string;
  statusId: string | null;
  name: string | null;
  color: string | null;
  category: string | null;
  ms: number;
  /** Veces que entró a ese status. */
  visits: number;
}

export interface StatusTime {
  /** Desde cuándo está en el status actual (ISO). */
  since: string | null;
  /** Milisegundos en el status actual. */
  currentMs: number;
  /** Total por status, en el orden en que entró por primera vez. */
  totals: StatusTotal[];
  /** `key` del status actual dentro de `totals`. */
  currentKey: string | null;
}

/** Fecha guardada (con o sin T/Z) a milisegundos UTC. */
export function parseStoredDate(v: string | null | undefined): number {
  if (!v) return NaN;
  const s = v.includes('T') ? (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`) : `${v.replace(' ', 'T')}Z`;
  return Date.parse(s);
}

/**
 * Suma el tiempo de cada período (hasta el siguiente, o hasta `now` el
 * último). Los nombres y colores actuales mandan sobre los guardados.
 */
export function summarizeStatusPeriods(
  entries: StatusLogEntry[],
  now: Date,
  current: Map<string, { name: string; color: string; category: string }> = new Map(),
): StatusTime {
  const sorted = entries
    .map((e) => ({ ...e, t: parseStoredDate(e.entered_at) }))
    .filter((e) => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t);
  const totals = new Map<string, StatusTotal>();
  const end = now.getTime();
  let currentKey: string | null = null;
  sorted.forEach((e, i) => {
    const next = i + 1 < sorted.length ? sorted[i + 1].t : end;
    const ms = Math.max(0, next - e.t);
    const live = e.status_id ? current.get(e.status_id) : undefined;
    const key = live && e.status_id ? e.status_id : e.status_id ?? `name:${e.status_name ?? ''}`;
    const row = totals.get(key) ?? {
      key,
      statusId: e.status_id,
      name: live?.name ?? e.status_name,
      color: live?.color ?? null,
      category: live?.category ?? e.status_category,
      ms: 0,
      visits: 0,
    };
    row.ms += ms;
    row.visits += 1;
    totals.set(key, row);
    currentKey = key;
  });
  const last = sorted[sorted.length - 1];
  return {
    since: last ? new Date(last.t).toISOString() : null,
    currentMs: last ? Math.max(0, end - last.t) : 0,
    totals: [...totals.values()],
    currentKey,
  };
}

export type DurationUnit = 'm' | 'h' | 'd' | 'w' | 'mo';

/**
 * Duración compacta como Linear ("45m", "3h", "4d", "2w", "5mo"): una sola
 * unidad, redondeada hacia abajo. Menos de un minuto cuenta como 1m.
 */
export function durationParts(ms: number): { value: number; unit: DurationUnit } {
  const min = Math.max(1, Math.floor(ms / 60_000));
  if (min < 60) return { value: min, unit: 'm' };
  const h = Math.floor(min / 60);
  if (h < 24) return { value: h, unit: 'h' };
  const d = Math.floor(h / 24);
  if (d < 14) return { value: d, unit: 'd' };
  if (d < 60) return { value: Math.floor(d / 7), unit: 'w' };
  return { value: Math.floor(d / 30), unit: 'mo' };
}

/** Días enteros desde `since` (para el filtro "más de N días"). */
export function daysSince(since: string | null | undefined, now: Date): number | null {
  const t = parseStoredDate(since);
  return Number.isFinite(t) ? Math.max(0, (now.getTime() - t) / 86_400_000) : null;
}
