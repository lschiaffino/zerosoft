/**
 * Plazo para cancelar o reprogramar: el tipo de evento puede cerrar los
 * cambios del invitado desde su link N horas antes del inicio. El anfitrión
 * no tiene este límite (usa la app).
 */

export const MAX_CHANGE_CUTOFF_HOURS = 720;

/** Horas de plazo configuradas (0 = sin plazo). Ignora valores inválidos. */
export function changeCutoffHours(rules: Record<string, unknown> | null | undefined): number {
  const v = rules?.changeCutoffHours;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  return Math.min(Math.floor(v), MAX_CHANGE_CUTOFF_HOURS);
}

/** true si faltan menos horas que el plazo para el inicio de la reunión. */
export function isInsideChangeCutoff(
  rules: Record<string, unknown> | null | undefined,
  startsAt: Date,
  now: Date = new Date(),
): boolean {
  const hours = changeCutoffHours(rules);
  if (hours === 0) return false;
  return startsAt.getTime() - now.getTime() < hours * 3_600_000;
}
