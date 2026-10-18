/**
 * Texturas hechas de ceros: la rampa del toroide (' ·°o0Ø') usada como trama.
 * Sin DOM ni azar: el mismo texto sale en el servidor y en el cliente, así no
 * hay diferencias de hidratación. Las usan ZeroRule y ZeroEdge.
 */

import { TORUS_RAMP } from './torus';

/** Matriz de Bayer 4×4: reparte los niveles de la rampa sin bandas. */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

const level = (v: number) => {
  const n = TORUS_RAMP.length - 1;
  return TORUS_RAMP[Math.max(0, Math.min(n, Math.round(v * n)))];
};

/**
 * Un filete de ceros: una onda de la rampa que se repite (·°o0Ø0o°·).
 * `cols` caracteres en una sola línea.
 */
export function zeroRule(cols: number, period = 18): string {
  let out = '';
  for (let i = 0; i < cols; i++) {
    const t = (i % period) / period;
    // Triángulo de 0 a 1 a 0: sube hasta el cero barrado y vuelve.
    const v = 1 - Math.abs(t * 2 - 1);
    out += level(0.2 + v * 0.8);
  }
  return out;
}

/** Ruido fijo por celda (0..1): un hash entero, igual en servidor y cliente. */
function noise(i: number, j: number): number {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/**
 * Un degradé de ceros entre dos planos: `rows` filas de `cols` caracteres que
 * van de vacío (arriba) a lleno (abajo). Bayer más un poco de ruido, para que
 * el paso se lea como grano y no como escalones ni como un patrón repetido.
 */
export function zeroEdge(cols: number, rows: number): string {
  const lines: string[] = [];
  for (let j = 0; j < rows; j++) {
    let r = '';
    // Curva: casi vacío arriba, se cierra en las dos últimas filas.
    const base = Math.pow((j + 0.5) / rows, 1.6);
    for (let i = 0; i < cols; i++) {
      const d = (BAYER4[j % 4][i % 4] / 16 - 0.5) * 0.3 + (noise(i, j) - 0.5) * 0.45;
      r += level(base + d);
    }
    lines.push(r);
  }
  return lines.join('\n');
}
