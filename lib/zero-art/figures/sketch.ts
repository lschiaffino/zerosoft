import { CELL_RATIO, Cells, clamp, lerp, seeded, smooth, type Figure } from '../engine';

const COLS = 72;
const ROWS = 34;

type Point = [number, number];

/** Un trazo a mano: los puntos con un temblor chico y fijo. */
function hand(points: Point[], seed: number, spacing = 0.4): Point[] {
  const rand = seeded(seed);
  const out: Point[] = [];
  let a = rand() * 6;
  let b = rand() * 6;
  for (let n = 0; n < points.length - 1; n++) {
    const [x0, y0] = points[n];
    const [x1, y1] = points[n + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.round(len / spacing));
    for (let s = 0; s < steps; s++) {
      a += 0.05;
      b += 0.037;
      const q = s / steps;
      out.push([lerp(x0, x1, q) + Math.sin(a) * 0.45, lerp(y0, y1, q) + Math.sin(b) * 0.3]);
    }
  }
  return out;
}

const box = (x: number, y: number, w: number, h: number): Point[] => [[x, y], [x + w, y + 0.4], [x + w - 0.3, y + h], [x + 0.2, y + h - 0.2], [x, y - 0.4]];

const ellipse = (cx: number, cy: number, rx: number, ry: number): Point[] =>
  Array.from({ length: 49 }, (_, n) => {
    const th = (n / 48) * Math.PI * 2.08 - 2.2;
    return [cx + Math.cos(th) * rx, cy + Math.sin(th) * ry] as Point;
  });

const arrow = (x0: number, y0: number, x1: number, y1: number): Point[][] => {
  const a = Math.atan2((y1 - y0) * CELL_RATIO, x1 - x0);
  const head = (da: number): Point => [x1 - Math.cos(a + da) * 3.6, y1 - (Math.sin(a + da) * 3.6) / CELL_RATIO];
  return [[[x0, y0], [x1, y1]], [head(0.55), [x1, y1], head(-0.55)]];
};

/** Dibuja los trazos hasta `length` puntos; la punta del lápiz, más clara. */
function ink(c: Cells, strokes: Point[][], length: number, value: number) {
  let left = length;
  for (const stroke of strokes) {
    const upto = Math.min(left, stroke.length);
    for (let n = 0; n < upto; n++) c.lift(Math.floor(stroke[n][0]), Math.floor(stroke[n][1]), value);
    if (upto > 0 && upto < stroke.length) {
      const [x, y] = stroke[Math.floor(upto)];
      c.lift(Math.floor(x), Math.floor(y), 1);
    }
    left -= stroke.length;
    if (left <= 0) break;
  }
}

/** Board: alguien dibuja en la pizarra, una caja, una flecha, una idea. */
function board(): Figure {
  const parts: Point[][] = [
    box(2, 3, 22, 9),
    ...arrow(26, 8, 42, 8),
    ellipse(57, 8, 13, 6),
    ...arrow(57, 15, 57, 21),
    box(42, 22, 28, 9),
    ...arrow(40, 26, 26, 26),
    ellipse(13, 26, 11, 5.5),
  ];
  const strokes = parts.map((p, n) => hand(p, 100 + n));
  const total = strokes.reduce((sum, s) => sum + s.length, 0);
  const PERIOD = 15;
  return {
    cols: COLS,
    rows: ROWS,
    fps: 20,
    still: 8.4,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const value = 0.72 * (1 - smooth((t - 13.2) / 1.2));
      ink(c, strokes, clamp((t - 0.4) / 11) * total, value);
      // Lo que dicen las cajas: renglones tenues, cuando la caja ya está.
      const p = clamp((t - 0.4) / 11);
      const label = (x: number, y: number, w: number, at: number) => {
        const q = clamp((p - at) / 0.05);
        for (let i = 0; i < w * q; i++) c.lift(x + i, y, value * 0.5);
      };
      label(7, 7, 12, 0.14);
      label(50, 8, 14, 0.42);
      label(49, 26, 14, 0.72);
      label(7, 26, 12, 0.98);
    },
  };
}

/** Sign: renglones de un contrato y, abajo, la firma que se escribe. */
function sign(): Figure {
  const rand = seeded(91);
  const X0 = 8;
  const X1 = 64;
  const BASE = 25;
  // Una firma: varias vueltas que avanzan y un rasgo final.
  const curve: Point[] = [];
  const N = 240;
  for (let n = 0; n <= N; n++) {
    const u = n / N;
    const fall = u < 0.8 ? 1 : 1 - (u - 0.8) / 0.2;
    const x = lerp(X0 + 3, X1 - 6, Math.pow(u, 0.9)) + Math.sin(u * 34) * 3.2 * fall;
    const y = BASE - 3.4 + Math.sin(u * 17 + 1) * Math.cos(u * 34) * 3.6 * fall + (u > 0.8 ? (u - 0.8) * 8 : 0);
    curve.push([x, y]);
  }
  const lines = Array.from({ length: 5 }, (_, n) => {
    const w = n === 4 ? 30 : 56;
    let gaps = '';
    while (gaps.length < w) gaps += '1'.repeat(2 + Math.floor(rand() * 7)) + '0';
    return gaps.slice(0, w);
  });
  const PERIOD = 10;
  return {
    cols: COLS,
    rows: ROWS,
    fps: 20,
    still: 3.85,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const fade = 1 - smooth((t - 8.8) / 1);
      lines.forEach((line, n) => {
        for (let i = 0; i < line.length; i++) if (line[i] === '1') c.lift(X0 + i, 2 + n * 2, 0.24);
      });
      for (let i = X0; i < X1; i++) c.lift(i, BASE + 3, 0.34);
      // La marca donde hay que firmar se apaga al firmar.
      const p = clamp((t - 0.8) / 5.5);
      ink(c, [curve], p * curve.length, 0.9 * fade);
      if (p >= 1) {
        const done = smooth((t - 6.5) / 0.5) * fade;
        c.slab(X0, BASE + 5, 14, 3, 0.2 + done * 0.5, true);
      }
    },
  };
}

export function sketchFigure(variant: string): Figure {
  return variant === 'sign' ? sign() : board();
}
