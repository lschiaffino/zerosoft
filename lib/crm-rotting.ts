/**
 * Deals "rotting" (estilo Pipedrive): un deal abierto se marca cuando pasa
 * más días sin actividad que el umbral de su etapa. Cuentan como actividad
 * las actividades del deal y los emails (entrantes o salientes) de sus
 * contactos; si no hay ninguna, el último update del deal.
 *
 * Módulo puro: lo usan la page (server) y el board (client).
 */

export const DEFAULT_ROTTING_DAYS = 14;
export const MAX_ROTTING_DAYS = 365;

const DAY_MS = 86_400_000;

/** Fechas de la DB ('YYYY-MM-DD HH:MM:SS' en UTC) o ISO → epoch ms (0 si no hay). */
export function dbTimestamp(s: string | null | undefined): number {
  if (!s) return 0;
  const ms = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export interface RottingInput {
  updated_at: string;
  last_activity_at: string | null;
  last_email_at?: string | null;
}

/** Días desde la última actividad o email del deal (o su último update). */
export function dealIdleDays(deal: RottingInput, nowMs: number = Date.now()): number {
  const last = Math.max(dbTimestamp(deal.last_activity_at), dbTimestamp(deal.last_email_at));
  const ref = last || dbTimestamp(deal.updated_at);
  return Math.max(0, Math.floor((nowMs - ref) / DAY_MS));
}

/** Umbral de la etapa (null o inválido → default). */
export function stageRottingDays(stage: { rotting_days?: number | null }): number {
  const n = stage.rotting_days;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_ROTTING_DAYS;
}

export function isDealRotting(
  idleDays: number | undefined,
  stage: { rotting_days?: number | null; is_won: number; is_lost: number },
): boolean {
  if (stage.is_won || stage.is_lost) return false;
  return (idleDays ?? 0) > stageRottingDays(stage);
}
