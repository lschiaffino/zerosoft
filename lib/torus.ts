/**
 * El cero en 3D, dibujado con ceros: un toroide renderizado en ASCII.
 * La rampa va de vacío a cero barrado; cada carácter es la luz de ese punto.
 * Sin dependencias del DOM: lo usan ZeroTorus y los tests.
 */

export const TORUS_RAMP = [' ', '·', '°', 'o', '0', 'Ø'] as const;

/** Devuelve el toroide como `H` filas de `W` caracteres, centrado por caja. */
export function renderTorus(W: number, H: number, A: number, B: number, k = 0.8): string {
  const ramp = TORUS_RAMP;
  const out: string[] = new Array(W * H).fill(' ');
  const zb: number[] = new Array(W * H).fill(0);
  const cA = Math.cos(A), sA = Math.sin(A), cB = Math.cos(B), sB = Math.sin(B);
  const K2 = 5;
  const K1 = ((W * K2 * 3) / (8 * 3.0)) * k;
  for (let th = 0; th < 6.283; th += 0.07) {
    const ct = Math.cos(th), st = Math.sin(th);
    for (let ph = 0; ph < 6.283; ph += 0.022) {
      const cp = Math.cos(ph), sp = Math.sin(ph);
      const cx = 2 + ct, cy = st;
      const x = cx * (cB * cp + sA * sB * sp) - cy * cA * sB;
      const y = cx * (sB * cp - sA * cB * sp) + cy * cA * cB;
      const z = K2 + cA * cx * sp + cy * sA;
      const ooz = 1 / z;
      const xp = Math.floor(W / 2 + K1 * ooz * x);
      const yp = Math.floor(H / 2 - K1 * ooz * y * 0.5);
      const L = cp * ct * sB - cA * ct * sp - sA * st + cB * (cA * st - ct * sA * sp);
      if (xp >= 0 && xp < W && yp >= 0 && yp < H) {
        const idx = xp + yp * W;
        if (ooz > zb[idx]) {
          zb[idx] = ooz;
          const n = Math.max(0, L);
          out[idx] = ramp[Math.min(ramp.length - 1, 1 + Math.floor(Math.pow(n / 1.42, 1.6) * (ramp.length - 1) * 0.999))];
        }
      }
    }
  }
  // Centrar por caja: la perspectiva corre el toro según el ángulo.
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++)
      if (out[i + j * W] !== ' ') {
        if (i < x0) x0 = i;
        if (i > x1) x1 = i;
        if (j < y0) y0 = j;
        if (j > y1) y1 = j;
      }
  const dx = Math.round((W - 1 - x1 - x0) / 2);
  const dy = Math.round((H - 1 - y1 - y0) / 2);
  const rows: string[] = [];
  for (let j = 0; j < H; j++) {
    let r = '';
    for (let i = 0; i < W; i++) {
      const si = i - dx, sj = j - dy;
      r += si >= 0 && si < W && sj >= 0 && sj < H ? out[si + sj * W] : ' ';
    }
    rows.push(r);
  }
  return rows.join('\n');
}
