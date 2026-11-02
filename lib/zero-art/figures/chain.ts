import type { Figure } from '../engine';
import { drawMesh, linkMesh, rotation } from '../solid';

const COLS = 92;
const ROWS = 42;
const COUNT = 3;
const PITCH = 2.3;

/** Link: una cadena de eslabones que gira sobre su eje. Se puede arrastrar. */
export function chainFigure(): Figure {
  const mesh = linkMesh(0.68, 0.2, 0.52, 190, 22);
  const z = new Float32Array(COLS * ROWS);
  return {
    cols: COLS,
    rows: ROWS,
    fps: 24,
    still: 3.2,
    draggable: true,
    draw(c, t, input) {
      c.clear();
      z.fill(0);
      const spin = t * 0.42 + input.dragX * 0.012;
      const tilt = 0.72 + Math.sin(t * 0.21) * 0.03;
      const pitch = 0.12 + input.dragY * 0.012;
      for (let k = 0; k < COUNT; k++) {
        const along = (k - (COUNT - 1) / 2) * PITCH;
        // Eslabones alternados a 90 grados, como en una cadena real.
        const m = rotation(spin + (k * Math.PI) / 2, 0, pitch, tilt);
        const oy = along * Math.sin(tilt);
        drawMesh(c, z, mesh, m, along * Math.cos(tilt), oy * Math.cos(pitch), 7.2 + oy * Math.sin(pitch), COLS / 2, ROWS / 2, 96);
      }
    },
  };
}
