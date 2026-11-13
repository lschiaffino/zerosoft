/**
 * Medidor del dictado: del pico del micrófono (0–1, cada 50 ms) a cuánto se mueven las barras.
 *
 * La voz normal en el micrófono de una notebook llega con picos de 0,02 a 0,2: con una escala
 * lineal las barras apenas se movían y no se sabía si el micrófono andaba. Acá:
 * - escala en decibeles (como oímos): -58 dBFS es silencio, -12 dBFS es lleno;
 * - ganancia automática: el techo sigue a la voz más fuerte reciente y baja despacio, así una voz
 *   baja también llena el medidor (con un piso, para que el ruido de la sala no lo llene);
 * - subida rápida y bajada lenta, como un vúmetro.
 */

export const FLOOR_DB = -58;
export const FULL_DB = -12;
/** El techo de la ganancia automática nunca baja de esto: el ruido de fondo queda chico. */
export const MIN_CEILING = 0.45;

/** Pico (0–1) → sonoridad (0–1) en escala de decibeles. */
export function loudness(peak: number): number {
  const p = Math.abs(Number(peak) || 0);
  if (p <= 0) return 0;
  const db = 20 * Math.log10(p);
  return Math.max(0, Math.min(1, (db - FLOOR_DB) / (FULL_DB - FLOOR_DB)));
}

export interface MeterState {
  /** Valor mostrado (0–1), suavizado. */
  value: number;
  /** Techo de la ganancia automática (0–1). */
  ceiling: number;
}

export const initialMeter = (): MeterState => ({ value: 0, ceiling: MIN_CEILING });

/** Un paso del medidor con un pico nuevo. Devuelve el estado siguiente (puro). */
export function stepMeter(prev: MeterState, peak: number): MeterState {
  const v = loudness(peak);
  // El techo sube enseguida con la voz y baja ~2 % por paso (unos 2 s hasta la mitad).
  const ceiling = Math.max(MIN_CEILING, v, prev.ceiling * 0.98);
  const target = Math.min(1, v / ceiling);
  const value = target > prev.value ? prev.value + (target - prev.value) * 0.7 : prev.value + (target - prev.value) * 0.25;
  return { value, ceiling };
}

/** Alto de cada barra (px), entre `min` y `max`, con una onda para que no suban todas iguales. */
export function barHeights(value: number, count: number, now: number, min = 3, max = 18): number[] {
  return Array.from({ length: count }, (_, i) => {
    // Las del medio un poco más altas, y cada una con su propia onda.
    const center = 1 - Math.abs(i - (count - 1) / 2) / count;
    const wave = 0.6 + 0.4 * Math.sin(now / 110 + i * 1.7);
    return Math.round(Math.max(min, Math.min(max, min + (max - min) * value * wave * (0.75 + 0.25 * center))));
  });
}
