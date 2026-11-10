/** Calls: rangos del filtro de duración de la biblioteca (puro: lo usan el servidor y el cliente). */
const DURATIONS: Record<string, { min?: number; max?: number }> = { short: { max: 15 }, medium: { min: 15, max: 45 }, long: { min: 45 } };

export function durationRange(key: string): { minMinutes?: number; maxMinutes?: number } {
  const d = DURATIONS[key];
  return d ? { minMinutes: d.min, maxMinutes: d.max } : {};
}
