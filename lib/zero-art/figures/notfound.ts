import type { Figure } from '../engine';
import { drawMesh, linkMesh, rotation } from '../solid';
import { shade } from './shapes';

const COLS = 96;
const ROWS = 30;

/** Distancia a un tramo con grosor. */
function capsule(x: number, y: number, ax: number, ay: number, bx: number, by: number, r: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const h = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - dx * h, y - ay - dy * h) - r;
}

/** El 4: una diagonal, un travesaño y un palo. */
const four = (x: number, y: number) =>
  Math.min(
    capsule(x, y, 0.4, -1.35, -0.85, 0.45, 0.2),
    capsule(x, y, -0.85, 0.45, 0.95, 0.45, 0.2),
    capsule(x, y, 0.4, -1.35, 0.4, 1.35, 0.2),
  );

/** La página que no está: 404, y el cero del medio es el nuestro y gira. */
export function notFoundFigure(): Figure {
  const mesh = linkMesh(1, 0.46, 0, 90, 26);
  const z = new Float32Array(COLS * ROWS);
  return {
    cols: COLS,
    rows: ROWS,
    fps: 24,
    still: 2.4,
    draw(c, t) {
      c.clear();
      shade(c, four, 15, ROWS / 2, 12.5, 0.2);
      shade(c, four, COLS - 16, ROWS / 2, 12.5, 0.2);
      z.fill(0);
      // Se mece: de canto dejaría de leerse como el cero de 404.
      const m = rotation(Math.sin(t * 0.5) * 0.6, Math.sin(t * 0.37) * 0.55, 0, 0.1);
      drawMesh(c, z, mesh, m, 0, 0, 5, COLS / 2, ROWS / 2, 54);
    },
  };
}
