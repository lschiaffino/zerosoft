/**
 * Sólidos para las figuras: eslabones (un toroide es un eslabón sin tramo
 * recto) proyectados con perspectiva y buffer de profundidad. Es el dibujo del
 * cero de la portada, generalizado para poder poner varios en la misma escena.
 */

import type { Cells } from './engine';
import { CELL_RATIO } from './engine';

export interface Mesh {
  /** x, y, z, nx, ny, nz por punto. */
  p: Float32Array;
}

/** La superficie de un eslabón: dos arcos de radio `R` unidos por rectas de largo `2 * s`. */
export function linkMesh(R: number, tube: number, s: number, stepsAlong = 150, stepsAround = 22): Mesh {
  const arc = Math.PI * R;
  const perimeter = 2 * arc + 4 * s;
  const data: number[] = [];
  for (let a = 0; a < stepsAlong; a++) {
    const d = ((a + 0.5) / stepsAlong) * perimeter;
    // El centro de la sección y su dirección radial, recorriendo el estadio.
    let cx: number, cy: number, rx: number, ry: number;
    if (d < arc) {
      const th = -Math.PI / 2 + d / R;
      rx = Math.cos(th);
      ry = Math.sin(th);
      cx = s + rx * R;
      cy = ry * R;
    } else if (d < arc + 2 * s) {
      rx = 0;
      ry = 1;
      cx = s - (d - arc);
      cy = R;
    } else if (d < 2 * arc + 2 * s) {
      const th = Math.PI / 2 + (d - arc - 2 * s) / R;
      rx = Math.cos(th);
      ry = Math.sin(th);
      cx = -s + rx * R;
      cy = ry * R;
    } else {
      rx = 0;
      ry = -1;
      cx = -s + (d - 2 * arc - 2 * s);
      cy = -R;
    }
    for (let b = 0; b < stepsAround; b++) {
      const ph = (b / stepsAround) * Math.PI * 2;
      const cp = Math.cos(ph);
      const sp = Math.sin(ph);
      data.push(cx + rx * tube * cp, cy + ry * tube * cp, tube * sp, rx * cp, ry * cp, sp);
    }
  }
  return { p: new Float32Array(data) };
}

function mul(a: number[], b: number[]): number[] {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++)
    for (let k = 0; k < 3; k++) out[r * 3 + k] = a[r * 3] * b[k] + a[r * 3 + 1] * b[k + 3] + a[r * 3 + 2] * b[k + 6];
  return out;
}

/** Matriz de rotación 3×3: `roll` sobre x, después `yaw` sobre y, `pitch` sobre x y `tilt` sobre z. */
export function rotation(roll: number, yaw: number, pitch: number, tilt: number): number[] {
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const a = [1, 0, 0, 0, cr, -sr, 0, sr, cr];
  const b = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const c = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
  const d = [ct, -st, 0, st, ct, 0, 0, 0, 1];
  return mul(d, mul(c, mul(b, a)));
}

// La luz: arriba, a la izquierda y del lado de quien mira. Normalizada.
const LX = -0.43, LY = 0.62, LZ = -0.655;

/**
 * Dibuja una malla. `m` la orienta, (ox, oy, oz) la ubica en la escena y
 * (sx, sy) es el centro en celdas; `scale` son celdas por unidad a distancia 1.
 * `z` es un buffer de profundidad del tamaño de la grilla, compartido en la escena.
 */
export function drawMesh(
  c: Cells,
  z: Float32Array,
  mesh: Mesh,
  m: number[],
  ox: number,
  oy: number,
  oz: number,
  sx: number,
  sy: number,
  scale: number,
) {
  const { p } = mesh;
  const { cols, rows, v } = c;
  const yScale = scale / CELL_RATIO;
  for (let n = 0; n < p.length; n += 6) {
    const x0 = p[n], y0 = p[n + 1], z0 = p[n + 2];
    const ooz = 1 / (m[6] * x0 + m[7] * y0 + m[8] * z0 + oz);
    const i = Math.floor(sx + scale * ooz * (m[0] * x0 + m[1] * y0 + m[2] * z0 + ox));
    const j = Math.floor(sy - yScale * ooz * (m[3] * x0 + m[4] * y0 + m[5] * z0 + oy));
    if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
    const k = i + j * cols;
    if (ooz <= z[k]) continue;
    z[k] = ooz;
    const nx = p[n + 3], ny = p[n + 4], nz = p[n + 5];
    const wnx = m[0] * nx + m[1] * ny + m[2] * nz;
    const wny = m[3] * nx + m[4] * ny + m[5] * nz;
    const wnz = m[6] * nx + m[7] * ny + m[8] * nz;
    const L = Math.max(0, wnx * LX + wny * LY + wnz * LZ);
    // Sombra amplia y brillo chico, como el cero de la portada. Nunca vacío sobre la pieza.
    v[k] = Math.min(1, 0.05 + Math.pow(L, 1.6));
  }
}
