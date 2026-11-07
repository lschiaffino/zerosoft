import { Cells, ease, seeded, smooth, type Figure } from '../engine';

const COLS = 69;
const ROWS = 34;
const TILE_W = 9;
const TILE_H = 5;
const WEEKS = 5;
const TOP = 3;

const tileX = (d: number) => d * (TILE_W + 1);
const tileY = (w: number) => TOP + w * (TILE_H + 1);

function grid(c: Cells) {
  for (let d = 0; d < 7; d++) {
    // Los días de la semana: un trazo chico arriba de cada columna.
    for (let i = 0; i < 3; i++) c.lift(tileX(d) + 1 + i, 1, d >= 5 ? 0.22 : 0.42);
    // Cada día vacío: sus cuatro esquinas, como marcas de corte.
    for (let w = 0; w < WEEKS; w++) {
      const x1 = tileX(d) + TILE_W - 1;
      const y1 = tileY(w) + TILE_H - 1;
      for (const [i, j] of [[tileX(d), tileY(w)], [x1, tileY(w)], [tileX(d), y1], [x1, y1]]) c.lift(i, j, 0.12);
    }
  }
}

/** Cal: los días del mes se van ocupando, uno por uno, y el mes se vacía. */
function cal(): Figure {
  const rand = seeded(7);
  const PERIOD = 18;
  const tiles = Array.from({ length: 35 }, (_, n) => {
    const d = n % 7;
    const w = Math.floor(n / 7);
    return { d, w, free: d >= 5 && rand() < 0.75, start: 0.4 + n * 0.26 + rand() * 0.9, tone: 0.42 + rand() * 0.25 };
  });
  return {
    cols: COLS,
    rows: ROWS,
    fps: 15,
    still: 7.6,
    draw(c, time) {
      c.clear();
      grid(c);
      const t = time % PERIOD;
      const out = 1 - smooth((t - 14.6) / 2.2);
      for (const tile of tiles) {
        if (tile.free) continue;
        const p = ease((t - tile.start) / 0.7) * out;
        if (p <= 0) continue;
        const h = TILE_H * p;
        c.slab(tileX(tile.d), tileY(tile.w) + TILE_H - h, TILE_W, h, tile.tone);
      }
    },
  };
}

/** Social: el calendario de publicaciones. Lo planeado es un contorno; al publicarse, se enciende. */
function social(): Figure {
  const rand = seeded(5);
  const PERIOD = 15;
  const posts = Array.from({ length: 35 }, (_, n) => ({
    d: n % 7,
    w: Math.floor(n / 7),
    planned: rand() < 0.55,
    // Repartidas parejo y salteadas: siempre hay una por publicarse.
    at: 0.4 + (((n * 13) % 35) / 35) * 10.5,
    tone: 0.42 + rand() * 0.22,
  })).filter((post) => post.planned);
  return {
    cols: COLS,
    rows: ROWS,
    fps: 15,
    still: 6.2,
    draw(c, time) {
      c.clear();
      grid(c);
      const t = time % PERIOD;
      const out = 1 - smooth((t - 13) / 1.4);
      for (const post of posts) {
        const x = tileX(post.d);
        const y = tileY(post.w);
        if (out > 0.5) c.card(x, y, TILE_W, TILE_H);
        const p = smooth((t - post.at) / 0.5) * out;
        if (p > 0.05) c.slab(x, y, TILE_W, TILE_H, post.tone * p, true);
      }
    },
  };
}

/** People: cada persona en su fila, con su licencia marcada en la quincena. */
function people(): Figure {
  const rand = seeded(21);
  const PEOPLE = 6;
  const H = 5;
  const X0 = 14;
  const DAY = 4;
  const DAYS = Math.floor((COLS - X0) / DAY);
  const PERIOD = 14;
  const rows = Array.from({ length: PEOPLE }, (_, n) => {
    const len = 2 + Math.floor(rand() * 5);
    return { name: 5 + Math.floor(rand() * 3), d0: Math.floor(rand() * (DAYS - len)), len, at: 0.5 + n * 1.5 + rand() * 0.4 };
  });
  return {
    cols: COLS,
    rows: ROWS,
    fps: 15,
    still: 6.6,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const out = 1 - smooth((t - 12) / 1.4);
      for (let d = 0; d < DAYS; d++) c.lift(X0 + d * DAY, 1, d % 7 >= 5 ? 0.14 : 0.3);
      rows.forEach((row, n) => {
        const y = 3 + n * H;
        c.card(0, y, 5, 3, 0);
        for (let i = 0; i < row.name; i++) c.lift(6 + i, y + 1, 0.42);
        for (let d = 0; d < DAYS; d++) c.lift(X0 + d * DAY, y + 1, 0.12);
        const p = ease((t - row.at) / 0.9) * out;
        if (p > 0) c.slab(X0 + row.d0 * DAY, y, (row.len * DAY + 1) * p, 3, 0.56, true);
      });
    },
  };
}

export function daysFigure(variant: string): Figure {
  if (variant === 'people') return people();
  if (variant === 'social') return social();
  return cal();
}
