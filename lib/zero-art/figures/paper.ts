import { Cells, clamp, ease, lerp, seeded, smooth, type Figure } from '../engine';

const COLS = 72;
const ROWS = 34;

/** Un renglón partido en palabras: true donde hay carácter. */
function words(rand: () => number, width: number): boolean[] {
  const out: boolean[] = [];
  while (out.length < width) {
    const len = 2 + Math.floor(rand() * 7);
    for (let i = 0; i < len && out.length < width; i++) out.push(true);
    if (out.length < width) out.push(false);
  }
  // Que el renglón no termine en una letra suelta.
  if (out[width - 2] === false) out[width - 1] = false;
  return out;
}

function run(c: Cells, x: number, y: number, line: boolean[], value: number, upto = line.length) {
  for (let i = 0; i < Math.min(upto, line.length); i++) if (line[i]) c.lift(x + i, y, value);
}

/** Docs: una página que se escribe sola, con su árbol de páginas al costado. */
function docs(): Figure {
  const rand = seeded(9);
  const X = 18;
  const W = COLS - X;
  const PERIOD = 17;
  // Título en dos renglones de alto, párrafos, un subtítulo y otro párrafo.
  const rows: { y: number; line: boolean[]; value: number; heavy?: boolean }[] = [];
  const add = (y: number, width: number, value: number, heavy = false) => rows.push({ y, line: words(rand, width), value, heavy });
  add(3, 30, 0.98, true);
  [8, 10, 12, 14].forEach((y, n) => add(y, n === 3 ? 31 : W, 0.56));
  add(18, 18, 0.9);
  [21, 23, 25].forEach((y, n) => add(y, n === 2 ? 38 : W, 0.56));
  [29, 31].forEach((y, n) => add(y, n === 1 ? 22 : W - 4, 0.56));
  const total = rows.reduce((sum, r) => sum + r.line.length, 0);
  const tree = [[0, 9], [2, 7], [2, 8], [0, 10], [2, 6], [4, 7], [2, 8], [0, 8]];
  return {
    cols: COLS,
    rows: ROWS,
    fps: 20,
    still: 8.2,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const typed = clamp((t - 0.6) / 12.5) * total;
      const fade = 1 - smooth((t - 15) / 1.3);
      tree.forEach(([indent, len], n) => {
        for (let i = 0; i < len; i++) c.lift(indent + i + 1, 3 + n * 2, n === 4 ? 0.75 : 0.22);
      });
      for (let j = 1; j < ROWS - 1; j += 2) c.lift(14, j, 0.12);
      let left = typed;
      for (const r of rows) {
        const upto = Math.min(left, r.line.length);
        if (upto > 0) {
          run(c, X, r.y, r.line, r.value * fade, upto);
          if (r.heavy) run(c, X, r.y + 1, r.line, r.value * fade, upto);
          // El cursor, justo después de la última letra.
          if (upto < r.line.length && fade === 1) {
            c.lift(X + Math.floor(upto), r.y, 1);
            if (r.heavy) c.lift(X + Math.floor(upto), r.y + 1, 1);
          }
        }
        left -= r.line.length;
        if (left <= 0) break;
      }
    },
  };
}

/** Notes: una lista que se va tildando. Lo hecho se apaga. */
function notes(): Figure {
  const rand = seeded(23);
  const ITEMS = 6;
  const H = 5;
  const Y0 = 3;
  const PERIOD = ITEMS * 1.5 + 4;
  const items = Array.from({ length: ITEMS }, (_, n) => ({
    a: words(rand, 28 + Math.floor(rand() * 26)),
    b: n % 2 === 0 ? words(rand, 14 + Math.floor(rand() * 18)) : null,
  }));
  return {
    cols: COLS,
    rows: ROWS,
    fps: 15,
    still: 5.4,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const out = smooth((t - (PERIOD - 1.6)) / 1.2);
      items.forEach((item, n) => {
        const y = Y0 + n * H;
        const done = smooth((t - 1 - n * 1.5) / 0.6) * (1 - out);
        c.card(4, y, 6, 3, 0);
        if (done > 0) c.slab(4, y, 6, 3, 0.3 + done * 0.5, true);
        const tone = lerp(0.62, 0.14, done);
        run(c, 14, y, item.a, tone);
        if (item.b) run(c, 14, y + 2, item.b, tone * 0.5);
      });
    },
  };
}

/** Forms: los campos se completan uno por uno y se envía. */
function forms(): Figure {
  const rand = seeded(31);
  const FIELDS = 3;
  const PERIOD = 15;
  const X = 6;
  const W = 60;
  const fields = Array.from({ length: FIELDS }, (_, n) => ({
    y: 2 + n * 8,
    label: 6 + Math.floor(rand() * 9),
    value: words(rand, 18 + Math.floor(rand() * 26)),
    start: 0.6 + n * 3,
  }));
  return {
    cols: COLS,
    rows: ROWS,
    fps: 20,
    still: 5.1,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const fade = 1 - smooth((t - 13.2) / 1.2);
      for (const f of fields) {
        for (let i = 0; i < f.label; i++) c.lift(X + i, f.y, 0.42);
        const active = t >= f.start && t < f.start + 2.6;
        c.card(X, f.y + 1, W, 5, 0);
        if (active) for (let i = X + 1; i < X + W - 1; i++) c.set(i, f.y + 1, 0.75);
        const p = clamp((t - f.start) / 2.2) * f.value.length * fade;
        run(c, X + 2, f.y + 3, f.value, 0.82 * fade, p);
        if (active && p < f.value.length) c.lift(X + 2 + Math.floor(p), f.y + 3, 1);
      }
      const sent = smooth((t - 10) / 0.7) * fade;
      c.card(X, 26, 18, 5, 0);
      if (sent > 0) c.slab(X, 26, 18, 5, 0.2 + sent * 0.5, true);
      for (let i = 0; i < 8; i++) c.lift(X + 5 + i, 28, sent > 0.5 ? 0 : 0.5);
    },
  };
}

/** Send: una página que se lee renglón por renglón; al lado, el tiempo de cada página crece. */
function send(): Figure {
  const rand = seeded(47);
  const PAGES = 4;
  const STEP = 3.2;
  const PERIOD = PAGES * STEP + 2;
  const X = 6;
  const W = 32;
  const lines = Array.from({ length: PAGES }, () => Array.from({ length: 9 }, () => words(rand, 18 + Math.floor(rand() * 9))));
  // Cuánto se queda quien lee en cada página: unas interesan más que otras.
  const dwell = [0.55, 1, 0.3, 0.8];
  return {
    cols: COLS,
    rows: ROWS,
    fps: 20,
    still: 6.2,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const fade = 1 - smooth((t - PERIOD + 1.2) / 1);
      const n = Math.min(PAGES - 1, Math.floor(t / STEP));
      const local = clamp((t - n * STEP) / STEP);
      // La página actual, con la pila atrás.
      c.card(X + 2, 4, W, 27, 0);
      c.card(X, 2, W, 27, 0);
      const page = lines[n];
      const reading = Math.floor(local * page.length);
      page.forEach((line, i) => {
        const tone = i < reading ? 0.82 : i === reading ? 1 : 0.28;
        run(c, X + 3, 5 + i * 2, line, tone * fade);
      });
      // Tiempo por página: una barra por página.
      const BX = X + W + 6;
      const BW = 72 - BX - 3;
      for (let p = 0; p < PAGES; p++) {
        const y = 5 + p * 6;
        const grown = p < n ? 1 : p === n ? local : 0;
        const len = Math.round(BW * dwell[p] * ease(grown) * fade);
        for (let i = 0; i < 3; i++) c.lift(BX + i, y, p === n ? 0.9 : 0.45);
        for (let j = 0; j < 2; j++) for (let i = 0; i < len; i++) c.lift(BX + i, y + 1 + j, p === n ? 0.9 : 0.55);
      }
    },
  };
}

/** Calls: dos voces en sus pistas; lo que dice cada una baja a la transcripción, renglón por renglón. */
function calls(): Figure {
  const rand = seeded(53);
  const X = 8;
  const W = COLS - X - 2;
  const PERIOD = 15;
  const PLAY = 12;
  // Quién habla en cada tramo de la llamada (0 = quien vende, 1 = quien compra) y cuánto dura.
  const turns = [
    [0, 0.08],
    [1, 0.16],
    [0, 0.06],
    [1, 0.2],
    [0, 0.1],
    [1, 0.14],
    [0, 0.12],
    [1, 0.14],
  ] as const;
  let at = 0;
  const segs = turns.map(([who, len]) => {
    const seg = { who, from: at, to: at + len, line: words(rand, 26 + Math.floor(rand() * 32)) };
    at += len;
    return seg;
  });
  return {
    cols: COLS,
    rows: ROWS,
    fps: 20,
    still: 9.4,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const fade = 1 - smooth((t - PERIOD + 1.2) / 1);
      const head = clamp(t / PLAY);
      // Las dos pistas: una por voz, con el tramo que suena más claro.
      for (let track = 0; track < 2; track++) {
        const y = 2 + track * 4;
        c.slab(0, y, 4, 2, (track === 0 ? 0.85 : 0.5) * fade, true);
        for (let i = 0; i < W; i += 2) c.lift(X + i, y + 1, 0.1);
        for (const seg of segs) {
          if (seg.who !== track) continue;
          const a = Math.round(X + seg.from * W);
          const b = Math.round(X + Math.min(seg.to, head) * W);
          const now = head >= seg.from && head < seg.to;
          for (let i = a; i < b; i++) {
            c.lift(i, y, (now ? 0.9 : 0.5) * fade);
            c.lift(i, y + 1, (now ? 0.9 : 0.5) * fade);
          }
        }
      }
      // El cabezal de reproducción.
      const hx = Math.round(X + head * W);
      for (let j = 1; j < 8; j++) c.lift(hx, j, 0.35 * fade);
      for (let i = 0; i < COLS; i++) c.lift(i, 10, 0.18);
      // La transcripción: cada tramo es un renglón con la marca de quien habla.
      segs.forEach((seg, n) => {
        if (head < seg.from) return;
        const row = 14 + n * 2;
        const typed = clamp((head - seg.from) / (seg.to - seg.from));
        const now = head < seg.to;
        c.slab(0, row, 4, 1, (seg.who === 0 ? 0.85 : 0.5) * fade, true);
        run(c, X, row, seg.line, (now ? 1 : 0.5) * fade, Math.ceil(typed * seg.line.length));
      });
    },
  };
}

interface Bubble {
  mine: boolean;
  lines: boolean[][];
  w: number;
  at: number;
}

/** Chat: una conversación, con el que escribe y el que contesta a cada lado. */
function chat(): Figure {
  const rand = seeded(13);
  const STEP = 1.9;
  const shape: [boolean, number][] = [[false, 1], [true, 1], [false, 2], [true, 1], [false, 1], [true, 2], [false, 2], [true, 1]];
  const bubbles: Bubble[] = shape.map(([mine, n], k) => {
    const w = 26 + Math.floor(rand() * 18);
    return { mine, w, at: 0.5 + k * STEP, lines: Array.from({ length: n }, (_, l) => words(rand, l === n - 1 ? w - 12 : w - 6)) };
  });
  const heightOf = (b: Bubble) => b.lines.length * 2 + 3;
  const PERIOD = 0.5 + bubbles.length * STEP + 2.2;
  return {
    cols: COLS,
    rows: ROWS,
    fps: 20,
    still: 8.2,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const fade = 1 - smooth((t - PERIOD + 1.1) / 0.9);
      // Altura total hasta acá: lo viejo sube cuando no entra.
      let total = 0;
      for (const b of bubbles) {
        const p = ease((t - b.at) / 0.45);
        total += p * (heightOf(b) + 1);
      }
      let y = 1 - Math.max(0, total - (ROWS - 2));
      for (const b of bubbles) {
        const p = ease((t - b.at) / 0.45);
        if (p <= 0) break;
        const h = heightOf(b);
        const x = b.mine ? COLS - b.w : 0;
        const Y = Math.round(y);
        if (fade > 0.05) {
          if (b.mine) {
            c.slab(x, Y, b.w, h, 0.5 * fade * p, true);
            // El texto, calado en la burbuja.
            b.lines.forEach((line, l) => line.forEach((on, i) => on && c.set(x + 3 + i, Y + 2 + l * 2, 0)));
          } else {
            c.card(x, Y, b.w, h, 0);
            b.lines.forEach((line, l) => run(c, x + 3, Y + 2 + l * 2, line, 0.56 * fade * p));
          }
        }
        y += p * (h + 1);
      }
      // El que está por contestar: tres ceros que suben y bajan.
      const next = bubbles.find((b) => t < b.at && t > b.at - 1.2 && !b.mine);
      if (next && fade === 1) {
        for (let n = 0; n < 3; n++) {
          const bob = Math.sin(t * 7 - n * 0.9) > 0.3;
          c.lift(3 + n * 3, Math.round(y) + 1, bob ? 0.95 : 0.4);
        }
      }
    },
  };
}

/** Talk: canales al costado y mensajes que van llegando, cada uno con su persona. */
function talk(): Figure {
  const rand = seeded(41);
  const X = 18;
  const STEP = 1.5;
  const msgs = Array.from({ length: 9 }, (_, k) => {
    const n = 1 + Math.floor(rand() * 2);
    return { at: 0.4 + k * STEP, who: Math.floor(rand() * 3), name: 5 + Math.floor(rand() * 6), lines: Array.from({ length: n }, (_, l) => words(rand, l === n - 1 ? 22 + Math.floor(rand() * 14) : 42)), n };
  });
  const PERIOD = 0.4 + msgs.length * STEP + 2;
  const channels = [8, 6, 10, 7, 9, 5, 8];
  const heightOf = (m: { n: number }) => 3 + m.n;
  return {
    cols: COLS,
    rows: ROWS,
    fps: 15,
    still: 7.4,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const fade = 1 - smooth((t - PERIOD + 1.1) / 0.9);
      channels.forEach((len, n) => {
        c.lift(0, 2 + n * 2, n === 1 ? 0.95 : 0.3);
        for (let i = 0; i < len; i++) c.lift(2 + i, 2 + n * 2, n === 1 ? 0.8 : 0.24);
      });
      for (let j = 0; j < ROWS; j += 2) c.lift(14, j, 0.12);
      let total = 0;
      for (const m of msgs) total += ease((t - m.at) / 0.4) * heightOf(m);
      let y = 2 - Math.max(0, total - (ROWS - 3));
      for (const m of msgs) {
        const p = ease((t - m.at) / 0.4);
        if (p <= 0) break;
        const Y = Math.round(y);
        const tone = fade * p;
        c.slab(X, Y, 5, 3, (0.35 + m.who * 0.14) * tone);
        for (let i = 0; i < m.name; i++) c.lift(X + 7 + i, Y, 0.85 * tone);
        m.lines.forEach((line, l) => run(c, X + 7, Y + 1 + l, line, 0.42 * tone));
        y += p * heightOf(m);
      }
    },
  };
}

/** Groups: la bandeja de grupos. Cuando alguien escribe, ese grupo sube arriba. */
function groups(): Figure {
  const rand = seeded(55);
  const N = 6;
  const H = 5;
  const Y0 = 2;
  const STEP = 1.7;
  const PERIOD = N * STEP;
  const rows = Array.from({ length: N }, () => ({ name: words(rand, 16 + Math.floor(rand() * 14)), body: words(rand, 28 + Math.floor(rand() * 20)) }));
  const drawRow = (c: Cells, id: number, y: number, lit: number) => {
    const Y = Math.round(y);
    for (let j = Y; j < Y + H - 1; j++) for (let i = 0; i < COLS; i++) c.set(i, j, 0);
    c.slab(0, Y, 7, 3, 0.34 + lit * 0.4, true);
    run(c, 10, Y, rows[id].name, 0.5 + lit * 0.45);
    run(c, 10, Y + 2, rows[id].body, 0.22 + lit * 0.3);
    if (lit > 0.05) c.slab(COLS - 6, Y, 6, 3, 0.2 + lit * 0.5, true);
  };
  return {
    cols: COLS,
    rows: ROWS,
    fps: 20,
    still: 1.1,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const step = Math.floor(t / STEP);
      const p = ease(((t - step * STEP) / STEP - 0.1) / 0.5);
      const glow = 1 - smooth(((t - step * STEP) / STEP - 0.55) / 0.45);
      // Cada paso, la última fila pasa a la primera: en N pasos vuelve el orden.
      const order = Array.from({ length: N }, (_, n) => (n + N - step) % N);
      for (let n = 0; n < N - 1; n++) drawRow(c, order[n], Y0 + lerp(n, n + 1, p) * H, 0);
      drawRow(c, order[N - 1], Y0 + lerp(N - 1, 0, p) * H, glow);
    },
  };
}

/** Robots: recorre una página de arriba abajo y saca los datos a una tabla. */
function robots(): Figure {
  const rand = seeded(61);
  const PAGE_W = 42;
  const ROW_N = 5;
  const H = 5;
  const Y0 = 6;
  const TX = 50;
  const TW = COLS - TX;
  const PERIOD = 11;
  const items = Array.from({ length: ROW_N }, () => ({ a: words(rand, 18 + Math.floor(rand() * 10)), b: words(rand, 12 + Math.floor(rand() * 10)) }));
  return {
    cols: COLS,
    rows: ROWS,
    fps: 20,
    still: 5.6,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const fade = 1 - smooth((t - 9.6) / 1);
      c.frame(0, 0, PAGE_W, ROWS, 0.14);
      for (let i = 2; i < 18; i++) c.lift(i, 2, 0.5);
      for (let i = 30; i < PAGE_W - 2; i++) c.lift(i, 2, 0.22);
      const scan = lerp(4, ROWS - 3, clamp((t - 0.5) / 7.5));
      items.forEach((item, n) => {
        const y = Y0 + n * H;
        const read = t > 0.5 && scan >= y + 1;
        c.slab(2, y, 6, 3, read ? 0.6 * fade + 0.1 : 0.22);
        run(c, 10, y, item.a, read ? 0.72 * fade + 0.1 : 0.26);
        run(c, 10, y + 2, item.b, read ? 0.5 * fade + 0.08 : 0.16);
        // La fila leída salta a la tabla por un tramo de ceros.
        const since = (scan - (y + 1)) / 3;
        if (read && since < 1) {
          const head = lerp(PAGE_W, TX - 1, clamp(since));
          for (let i = PAGE_W; i <= head; i++) c.lift(i, y + 1, 0.9);
        }
        if (read) {
          const p = clamp(since);
          for (let i = 0; i < TW * p; i++) {
            c.lift(TX + i, y, (i < 10 ? 0.82 : 0.4) * fade);
            c.lift(TX + i, y + 2, 0.14 * fade);
          }
        }
      });
      for (let i = TX; i < COLS; i++) c.lift(i, 2, 0.5);
      for (let i = 0; i < PAGE_W; i++) {
        if (t > 0.5 && t < 8) c.lift(i, Math.round(scan), 0.34);
      }
    },
  };
}

/** Rec: la pantalla que se graba, la cámara en su burbuja y la línea de tiempo que avanza. */
function rec(): Figure {
  const rand = seeded(71);
  const FRAME_H = 26;
  const CX = 17;
  const CY = 17;
  const R = 7;
  const PERIOD = 14;
  const lines = Array.from({ length: 5 }, () => words(rand, 34 + Math.floor(rand() * 26)));
  const noise = Array.from({ length: COLS }, () => rand());
  return {
    cols: COLS,
    rows: ROWS,
    fps: 15,
    still: 8.3,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      c.frame(0, 0, COLS, FRAME_H, 0.16);
      for (let i = 2; i < 10; i++) c.lift(i, 2, 0.42);
      lines.forEach((line, n) => run(c, 8, 5 + n * 2, line, 0.2));
      // La luz de grabación late.
      const on = Math.sin(time * 3.2) > -0.3;
      c.slab(COLS - 8, 1, 6, 3, on ? 0.8 : 0.24, true);
      // La burbuja de la cámara: una esfera iluminada que respira.
      const r = R + Math.sin(time * 2.1) * 0.2;
      for (let j = CY - R - 1; j <= CY + R + 1; j++)
        for (let i = CX - 2 * R - 2; i <= CX + 2 * R + 2; i++) {
          const u = (i + 0.5 - CX) / (r * 1.87);
          const w = (j + 0.5 - CY) / r;
          const d = u * u + w * w;
          if (d > 1) continue;
          const z = Math.sqrt(1 - d);
          c.set(i, j, clamp(Math.pow(Math.max(0, -u * 0.5 - w * 0.55 + z * 0.67), 1.5) + 0.05));
        }
      // Lo grabado hasta acá: la voz, en la línea de tiempo.
      const p = clamp(t / (PERIOD - 1)) * COLS;
      for (let i = 0; i < COLS; i += 2) {
        const recorded = i < p;
        const amp = recorded ? 0.6 + noise[i] * (Math.sin(i * 0.3) * 0.5 + 1.1) * 1.8 : 0;
        c.lift(i, 31, recorded ? 0.75 : 0.12);
        if (amp > 1) {
          c.lift(i, 30, 0.6);
          c.lift(i, 32, 0.6);
        }
        if (amp > 2) {
          c.lift(i, 29, 0.32);
          c.lift(i, 33, 0.32);
        }
      }
    },
  };
}

/** Books: los movimientos del banco se concilian uno por uno y el saldo crece. */
function books(): Figure {
  const rand = seeded(47);
  const N = 7;
  const H = 3;
  const Y0 = 3;
  const STEP = 1.3;
  const PERIOD = N * STEP + 3.4;
  const rows = Array.from({ length: N }, () => ({
    what: words(rand, 18 + Math.floor(rand() * 16)),
    amount: 5 + Math.floor(rand() * 7),
  }));
  return {
    cols: COLS,
    rows: ROWS,
    fps: 15,
    still: 5.6,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      const fade = 1 - smooth((t - PERIOD + 1.2) / 1);
      for (let i = 0; i < COLS; i++) c.lift(i, 1, 0.3);
      let total = 0;
      rows.forEach((row, n) => {
        const y = Y0 + n * H;
        const done = smooth((t - 0.6 - n * STEP) / 0.5) * fade;
        total += done * row.amount;
        c.slab(0, y, 4, 2, 0.14 + done * 0.62, true);
        for (let i = 0; i < 6; i++) c.lift(7 + i, y, 0.2);
        run(c, 16, y, row.what, 0.32 + done * 0.3);
        for (let i = 0; i < row.amount; i++) c.lift(COLS - 1 - i, y, 0.42 + done * 0.5);
      });
      const yTotal = Y0 + N * H + 1;
      for (let i = 0; i < COLS; i++) {
        c.lift(i, yTotal - 1, 0.3);
      }
      const width = (total / rows.reduce((sum, r) => sum + r.amount, 0)) * 44;
      if (width > 0) c.slab(COLS - width, yTotal + 1, width, 4, 0.56, true);
      for (let i = 0; i < 10; i++) c.lift(i, yTotal + 2, 0.5);
    },
  };
}

export function paperFigure(variant: string): Figure {
  switch (variant) {
    case 'books':
      return books();
    case 'notes':
      return notes();
    case 'forms':
      return forms();
    case 'send':
      return send();
    case 'calls':
      return calls();
    case 'chat':
      return chat();
    case 'talk':
      return talk();
    case 'groups':
      return groups();
    case 'robots':
      return robots();
    case 'rec':
      return rec();
    default:
      return docs();
  }
}
