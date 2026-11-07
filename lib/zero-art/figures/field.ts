import { CELL_RATIO, type Figure } from '../engine';

/** Matriz de Bayer 4×4: reparte los niveles sin bandas, como ZeroEdge. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dither = (i: number, j: number) => BAYER[(i & 3) + (j & 3) * 4] / 16 - 0.5;

/** Más columnas de las que entran en cualquier pantalla: sin JS, el resto se recorta. */
const SSR_COLS = 240;

/**
 * Un campo de ceros que respira lento y se levanta donde está el puntero.
 * Casi todo es · y °: va detrás de texto y no tiene que competir con él.
 */
function field(): Figure {
  const RADIUS = 15;
  let px = -999;
  let py = -999;
  let strength = 0;
  return {
    cols: SSR_COLS,
    rows: 30,
    fps: 15,
    still: 12,
    fluid: true,
    draw(c, t, input) {
      const { cols, rows, v } = c;
      // El puntero llega con retraso: el campo sigue, no salta.
      if (input.x !== null && input.y !== null) {
        if (strength < 0.01) {
          px = input.x;
          py = input.y;
        }
        px += (input.x - px) * 0.18;
        py += (input.y - py) * 0.18;
        strength += (1 - strength) * 0.12;
      } else {
        strength *= 0.93;
      }
      for (let j = 0; j < rows; j++) {
        const y = j * CELL_RATIO;
        for (let i = 0; i < cols; i++) {
          const a = Math.sin(i * 0.05 + t * 0.2 + Math.sin(y * 0.07 - t * 0.13) * 1.6);
          const b = Math.sin(y * 0.11 + t * 0.09 + i * 0.021);
          // Cerca de cero en los valles: el campo se abre, no es una alfombra de puntos.
          let value = (a + b + 2) * 0.075 - 0.06 + dither(i, j) * 0.13;
          if (strength > 0.01) {
            const dx = i - px;
            const dy = (j - py) * CELL_RATIO;
            const d2 = (dx * dx + dy * dy) / (RADIUS * RADIUS);
            if (d2 < 4) value += Math.exp(-d2) * 0.62 * strength;
          }
          v[i + j * cols] = value;
        }
      }
    },
  };
}

export function fieldFigure(): Figure {
  return field();
}
