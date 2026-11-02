import { clamp, seeded, smooth, type Figure } from '../engine';

const COLS = 72;
const ROWS = 34;

/** Analytics: barras con datos que se mueven, sobre su grilla. */
function bars(): Figure {
  const rand = seeded(11);
  const N = 14;
  const BAR = 4;
  const phases = Array.from({ length: N }, () => [rand() * 6.28, rand() * 6.28]);
  return {
    cols: COLS,
    rows: ROWS,
    fps: 15,
    still: 4,
    draw(c, t) {
      c.clear();
      const base = ROWS - 2;
      for (let j = 3; j < base; j += 7) for (let i = 0; i < COLS; i += 2) c.lift(i, j, 0.1);
      for (let i = 0; i < COLS; i++) c.lift(i, base, 0.3);
      for (let n = 0; n < N; n++) {
        const trend = 0.25 + (n / (N - 1)) * 0.5;
        const wave = Math.sin(t * 0.55 + n * 0.5 + phases[n][0]) * 0.1 + Math.sin(t * 0.23 + phases[n][1]) * 0.1;
        const h = clamp(trend + wave, 0.08, 0.96) * (base - 3);
        c.slab(n * (BAR + 1) + 1, base - h, BAR, h, n === N - 1 ? 0.72 : 0.5);
      }
    },
  };
}

/** Voice: la forma de onda de una voz, con frases y silencios, en barras finas. */
function wave(): Figure {
  const rand = seeded(3);
  const CY = (ROWS - 1) / 2;
  const noise = Array.from({ length: 256 }, () => rand());
  const at = (k: number) => noise[((k % 256) + 256) % 256];
  const SPACING = 2;
  return {
    cols: COLS,
    rows: ROWS,
    fps: 20,
    still: 6.3,
    draw(c, t) {
      c.clear();
      // La onda corre de a dos columnas: cada barra conserva su forma al avanzar.
      const shift = t * 12;
      const whole = Math.floor(shift / SPACING);
      for (let n = 0; n < COLS / SPACING; n++) {
        const k = n - whole;
        const u = k * 0.46;
        const phrase = smooth(Math.sin(u * 0.33) * 1.1 + 0.6) * (0.65 + 0.35 * Math.sin(u * 0.09 + 1));
        const fade = smooth(Math.min(n, COLS / SPACING - 1 - n) / 5);
        const amp = (0.03 + phrase * (0.12 + at(k) * 0.88)) * fade * (CY - 1);
        const x = n * SPACING;
        const R = Math.round(amp);
        for (let d = -R; d <= R; d++) {
          c.lift(x, Math.round(CY) + d, clamp(1 - (Math.abs(d) / (R + 1)) * 0.82));
        }
        if (R === 0) c.lift(x, Math.round(CY), 0.14);
      }
    },
  };
}

export function chartFigure(variant: string): Figure {
  if (variant === 'wave') return wave();
  return bars();
}
