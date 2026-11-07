import { ease, lerp, smooth, type Figure } from '../engine';

interface BoardSpec {
  columns: number;
  counts: number[];
  cardH: number;
  /** Pasos del ciclo: de una columna a otra; -1 es afuera del tablero. */
  moves: [number, number][];
}

const SPECS: Record<string, BoardSpec> = {
  // Track: cuatro columnas, las issues avanzan de a una y salen por la última.
  track: {
    columns: 4,
    counts: [4, 3, 3, 3],
    cardH: 6,
    moves: [[0, 1], [1, 2], [2, 3], [3, -1], [-1, 0], [1, 2], [0, 1], [2, 3], [3, -1], [-1, 0]],
  },
  // CRM: el embudo, cinco etapas que se angostan.
  crm: {
    columns: 5,
    counts: [5, 4, 3, 2, 1],
    cardH: 5,
    moves: [[0, 1], [1, 2], [2, 3], [3, 4], [4, -1], [-1, 0], [2, 3], [1, 2], [0, 1], [3, 4], [4, -1], [-1, 0]],
  },
  // Hiring: muchas personas al principio, pocas al final.
  hiring: {
    columns: 4,
    counts: [5, 3, 2, 1],
    cardH: 5,
    moves: [[0, 1], [1, 2], [2, 3], [3, -1], [-1, 0], [1, 2], [0, 1], [2, 3], [3, -1], [-1, 0]],
  },
};

const COLS = 72;
const ROWS = 34;
const TOP = 3;
const GAP = 2;
const STEP = 1.5;

export function boardFigure(variant: string): Figure {
  const spec = SPECS[variant] ?? SPECS.track;
  const colW = Math.floor((COLS - GAP * (spec.columns - 1)) / spec.columns);
  const colX = (n: number) => n * (colW + GAP);
  const cardY = (n: number) => TOP + n * (spec.cardH + 1);
  const PERIOD = STEP * spec.moves.length;

  // Las tarjetas son iguales entre sí: alcanza con saber cuántas hay en cada
  // columna en cada paso. Al final del ciclo vuelven los mismos conteos.
  const countsAt: number[][] = [spec.counts.slice()];
  for (const [from, to] of spec.moves) {
    const next = countsAt[countsAt.length - 1].slice();
    if (from >= 0) next[from]--;
    if (to >= 0) next[to]++;
    countsAt.push(next);
  }

  return {
    cols: COLS,
    rows: ROWS,
    fps: 20,
    still: STEP * 2 + 0.72,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const step = Math.floor(t / STEP);
      // La tarjeta se queda un momento quieta y cruza en el resto del paso.
      const p = ease(((t - step * STEP) / STEP - 0.18) / 0.72);
      const [from, to] = spec.moves[step];
      const counts = countsAt[step];

      for (let n = 0; n < spec.columns; n++) {
        const x = colX(n);
        // El rótulo de la columna y un carril tenue hasta abajo.
        for (let i = 0; i < Math.min(colW - 2, 6); i++) c.lift(x + i, 0, 0.42);
        for (let i = 0; i < colW; i++) c.lift(x + i, 1, 0.12);
        // La de arriba se va y las de abajo suben; a la columna que recibe, bajan.
        for (let k = 0; k < counts[n]; k++) {
          if (n === from && k === 0) continue;
          const y1 = n === from ? cardY(k - 1) : n === to ? cardY(k + 1) : cardY(k);
          c.card(x, lerp(cardY(k), y1, smooth(p)), colW, spec.cardH);
        }
      }
      // La que se mueve va encima y más clara.
      if (from >= 0 && to >= 0) {
        c.slab(lerp(colX(from), colX(to), p), cardY(0) - Math.sin(p * Math.PI) * 1.4, colW, spec.cardH, 0.66, true);
      } else if (from >= 0) {
        c.slab(colX(from), cardY(0), colW, spec.cardH, 0.72 * (1 - smooth(p)), true);
      } else if (to >= 0) {
        c.slab(colX(to), cardY(0), colW, spec.cardH, 0.5 * smooth(p), true);
      }
    },
  };
}
