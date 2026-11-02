import { CELL_RATIO, Cells, clamp, ease, lerp, seeded, smooth, type Figure } from '../engine';

const COLS = 72;
const ROWS = 34;

type Sdf = (x: number, y: number) => number;

const circle: Sdf = (x, y) => Math.hypot(x, y) - 1;
const square: Sdf = (x, y) => {
  const dx = Math.abs(x) - 0.86;
  const dy = Math.abs(y) - 0.86;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
};
const triangle: Sdf = (x, y) => {
  const k = Math.sqrt(3);
  const yy = y - 0.28;
  let px = Math.abs(x) - 1.15;
  let py = -yy + 1.15 / k;
  if (px + k * py > 0) {
    const a = (px - k * py) / 2;
    const b = (-k * px - py) / 2;
    px = a;
    py = b;
  }
  px -= clamp(px, -2.3, 0);
  return -Math.hypot(px, py) * Math.sign(py);
};
const ring: Sdf = (x, y) => Math.abs(Math.hypot(x, y) - 0.72) - 0.34;

/** Luz sobre una forma plana inflada: el mismo sombreado del toroide. */
export function shade(c: Cells, sdf: Sdf, cx: number, cy: number, size: number, bevel: number) {
  const rx = size * 1.4;
  const ry = (size * 1.4) / CELL_RATIO;
  const e = 0.02;
  for (let j = Math.floor(cy - ry); j <= Math.ceil(cy + ry); j++) {
    for (let i = Math.floor(cx - rx); i <= Math.ceil(cx + rx); i++) {
      const x = (i + 0.5 - cx) / size;
      const y = ((j + 0.5 - cy) * CELL_RATIO) / size;
      const d = sdf(x, y);
      if (d > 0) continue;
      const gx = (sdf(x + e, y) - sdf(x - e, y)) / (2 * e);
      const gy = (sdf(x, y + e) - sdf(x, y - e)) / (2 * e);
      const len = Math.hypot(gx, gy) || 1;
      const h = clamp(-d / bevel);
      const nz = Math.sqrt(1 - (1 - h) * (1 - h));
      const k = 1 - h;
      const L = (-0.45 * gx * k) / len + (-0.6 * gy * k) / len + 0.66 * nz;
      c.lift(i, j, clamp(Math.pow(Math.max(0, L), 1.5) + 0.06));
    }
  }
}

/** Design: una forma en su mesa de trabajo, con los tiradores, que cambia. */
function design(): Figure {
  const X = 12;
  const W = 48;
  const Y = 2;
  const H = 30;
  const sequence: Sdf[] = [circle, square, triangle, ring];
  const HOLD = 2.4;
  const PERIOD = HOLD * sequence.length;
  return {
    cols: COLS,
    rows: ROWS,
    fps: 20,
    still: 1.1,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const n = Math.floor(t / HOLD);
      const p = ease(((t - n * HOLD) / HOLD - 0.55) / 0.45);
      const a = sequence[n];
      const b = sequence[(n + 1) % sequence.length];
      const mix: Sdf = (x, y) => lerp(a(x, y), b(x, y), p);
      shade(c, mix, X + W / 2, Y + H / 2, 19, 0.42);
      // El marco de selección y sus tiradores.
      for (let i = X; i < X + W; i += 2) {
        c.lift(i, Y, 0.3);
        c.lift(i, Y + H - 1, 0.3);
      }
      for (let j = Y; j < Y + H; j += 2) {
        c.lift(X, j, 0.3);
        c.lift(X + W - 1, j, 0.3);
      }
      for (const [i, j] of [[X, Y], [X + W - 3, Y], [X, Y + H - 2], [X + W - 3, Y + H - 2]]) {
        c.slab(i, j, 3, 2, 0.75, true);
      }
    },
  };
}

/** Shop: el catálogo. Cada producto, su forma y su precio; cuando se vende, salta. */
function shop(): Figure {
  const rand = seeded(83);
  const shapes = [circle, square, ring, triangle, ring, circle];
  const TW = 22;
  const TH = 16;
  const STEP = 1.6;
  const PERIOD = STEP * shapes.length;
  const prices = shapes.map(() => 5 + Math.floor(rand() * 5));
  return {
    cols: COLS,
    rows: ROWS,
    fps: 20,
    still: 3.75,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const current = [0, 4, 2, 5, 1, 3][Math.floor(t / STEP)];
      const local = (t % STEP) / STEP;
      const hop = Math.sin(clamp(local / 0.55) * Math.PI);
      const lit = smooth(local / 0.2) * (1 - smooth((local - 0.7) / 0.3));
      shapes.forEach((sdf, n) => {
        const x = (n % 3) * (TW + 3);
        const y = Math.floor(n / 3) * (TH + 2);
        const on = n === current;
        c.frame(x, y, TW, TH, on ? 0.2 + lit * 0.3 : 0.1);
        shade(c, sdf, x + TW / 2, y + 6.3 - (on ? hop * 1.2 : 0), 6.6, 0.5);
        for (let i = 0; i < prices[n]; i++) c.lift(x + 2 + i, y + TH - 2, on ? 0.45 + lit * 0.5 : 0.36);
      });
    },
  };
}

export function shapesFigure(variant: string): Figure {
  return variant === 'shop' ? shop() : design();
}
