/**
 * Escala Y de un conteo: paso entero "lindo" (1, 2, 5 × 10^n) para unas cuatro
 * divisiones, y tope múltiplo del paso. Los clicks no tienen decimales, así que
 * las marcas tampoco.
 */
export function chartTicks(max: number, divisions = 4): { top: number; step: number; ticks: number[] } {
  const raw = Math.max(max, 1) / divisions;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow);
  const top = Math.max(step, Math.ceil(Math.max(max, 1) / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, step, ticks };
}
