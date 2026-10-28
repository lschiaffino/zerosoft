/**
 * Lógica pura del editor de robots (sin React): presets de horario y nombres
 * técnicos derivados. Vive aparte para poder testearla.
 */
import type { RobotSchedule } from './robots-schema';

export const SCHEDULE_PRESETS = ['none', 'hourly', 'daily', 'weekdays', 'weekly', 'custom'] as const;
export type SchedulePreset = (typeof SCHEDULE_PRESETS)[number];

/** Presets que se arman con una hora del día. */
export function presetUsesTime(p: SchedulePreset): boolean {
  return p === 'daily' || p === 'weekdays' || p === 'weekly';
}

const CRON_AT = /^(\d{1,2}) (\d{1,2}) \* \* (1-5|1)$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Qué preset representa un horario guardado (o "custom" si no encaja en ninguno). */
export function schedulePreset(s: RobotSchedule): SchedulePreset {
  if (!s) return 'none';
  if (s.mode === 'daily') return 'daily';
  if (s.mode === 'interval') return s.unit !== 'minutes' && s.every === 1 ? 'hourly' : 'custom';
  const m = CRON_AT.exec((s.cron ?? '').trim());
  if (m && Number(m[1]) < 60 && Number(m[2]) < 24) return m[3] === '1-5' ? 'weekdays' : 'weekly';
  return 'custom';
}

/** Hora (HH:MM) de un horario: la de un cron de preset o la del modo diario. */
export function scheduleTime(s: RobotSchedule): string {
  if (!s) return '09:00';
  if (s.mode === 'cron') {
    const m = CRON_AT.exec((s.cron ?? '').trim());
    if (m) return `${pad(Number(m[2]))}:${pad(Number(m[1]))}`;
  }
  const [h, mi] = (s.time || '09:00').split(':').map(Number);
  return `${pad(h || 0)}:${pad(mi || 0)}`;
}

/** Arma el horario de un preset conservando hora, zona y lo demás del actual. */
export function scheduleFromPreset(
  preset: SchedulePreset,
  current: RobotSchedule,
  opts: { time?: string; timezone?: string } = {},
): RobotSchedule {
  if (preset === 'none') return null;
  const time = opts.time ?? scheduleTime(current);
  const timezone = opts.timezone ?? current?.timezone ?? 'UTC';
  const [h, m] = time.split(':').map((x) => Number(x) || 0);
  const base = {
    time,
    timezone,
    every: current?.every ?? 24,
    unit: current?.unit ?? ('hours' as const),
    cron: current?.cron,
  };
  switch (preset) {
    case 'hourly':
      return { ...base, mode: 'interval', every: 1, unit: 'hours' };
    case 'daily':
      return { ...base, mode: 'daily' };
    case 'weekdays':
      return { ...base, mode: 'cron', cron: `${m} ${h} * * 1-5` };
    case 'weekly':
      return { ...base, mode: 'cron', cron: `${m} ${h} * * 1` };
    case 'custom':
    default:
      // Si ya era personalizado se queda como está; si no, arranca como cron editable.
      if (current && schedulePreset(current) === 'custom') return current;
      return { ...base, mode: 'cron', cron: current?.mode === 'cron' && current.cron ? current.cron : `${m} ${h} * * 1-5` };
  }
}

/**
 * JSON con las claves ordenadas y sin undefined: compara "hay cambios sin
 * guardar" sin depender del orden en que la API o el editor arman los objetos.
 */
export function stableJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) {
        const x = (v as Record<string, unknown>)[k];
        if (x !== undefined) out[k] = norm(x);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

/**
 * Nombre técnico de una entrada a partir de su etiqueta: "Email del cliente"
 * → "email_del_cliente". Cumple el formato de la API (letra inicial, letras,
 * números y _; hasta 40).
 */
export function deriveInputName(label: string): string {
  const slug = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) return '';
  const named = /^[a-z]/.test(slug) ? slug : `input_${slug}`;
  return named.slice(0, 40).replace(/_+$/, '');
}

/** True si el nombre todavía sigue a la etiqueta (no lo editaron a mano). */
export function nameFollowsLabel(name: string, label: string): boolean {
  return name === '' || /^input\d+$/.test(name) || name === deriveInputName(label);
}

/**
 * Paso del log ("3", o "3.2.1" = paso 1 del loop del paso 3, elemento 2) →
 * índice en el robot: { index, child }.
 */
export function stepPath(label: string): { index: number; child: number | null } | null {
  const parts = label.split('.').map((p) => Number(p));
  if (!parts.length || parts.some((n) => !Number.isInteger(n) || n < 1)) return null;
  if (parts.length === 1) return { index: parts[0] - 1, child: null };
  if (parts.length === 3) return { index: parts[0] - 1, child: parts[2] - 1 };
  return null;
}
