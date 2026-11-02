import { Cells, clamp, ease, smooth, type Figure } from '../engine';
import { drawMesh, linkMesh, rotation } from '../solid';

const COLS = 72;
const ROWS = 34;

type Point = [number, number];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Las celdas de un camino, en orden. */
function path(points: Point[]): Point[] {
  const out: Point[] = [];
  for (let n = 0; n < points.length - 1; n++) {
    const [x0, y0] = points[n];
    const [x1, y1] = points[n + 1];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s < steps; s++) {
      out.push([Math.round(x0 + ((x1 - x0) * s) / steps), Math.round(y0 + ((y1 - y0) * s) / steps)]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Un pulso: una tira de ceros que se apaga detrás de la cabeza. */
function pulse(c: Cells, cells: Point[], p: number) {
  const head = p * (cells.length - 1);
  const TAIL = 7;
  for (let n = Math.max(0, Math.floor(head - TAIL)); n <= Math.min(cells.length - 1, Math.ceil(head)); n++) {
    const d = head - n;
    if (d < -0.5) continue;
    c.lift(cells[n][0], cells[n][1], clamp(1 - d / TAIL));
  }
}

/** Un nodo: en reposo es una tarjeta; al llegarle un pulso se enciende. */
function node_(c: Cells, b: Box, g: number) {
  c.card(b.x, b.y, b.w, b.h);
  if (g > 0.08) c.slab(b.x, b.y, b.w, b.h, 0.1 + g * 0.6, true);
}

const glowAfter = (t: number, at: number, period: number) => {
  const d = (((t - at) % period) + period) % period;
  return d < 1.3 ? 1 - smooth(d / 1.3) : 0;
};

/** Flow: un disparador, dos ramas y un final. El pulso recorre las aristas. */
function flow(): Figure {
  const W = 16;
  const H = 7;
  const nodes: Box[] = [
    { x: 0, y: 14, w: W, h: H },
    { x: 28, y: 3, w: W, h: H },
    { x: 28, y: 25, w: W, h: H },
    { x: 56, y: 14, w: W, h: H },
  ];
  const route = (a: Box, b: Box) => {
    const ya = a.y + 3;
    const yb = b.y + 3;
    const x0 = a.x + a.w;
    const x1 = b.x - 1;
    const mx = Math.round((x0 + x1) / 2);
    return path([[x0, ya], [mx, ya], [mx, yb], [x1, yb]]);
  };
  const PERIOD = 6;
  const edges = [
    { cells: route(nodes[0], nodes[1]), to: 1, start: 0.3, dur: 1.5 },
    { cells: route(nodes[0], nodes[2]), to: 2, start: 0.3, dur: 1.5 },
    { cells: route(nodes[1], nodes[3]), to: 3, start: 2.6, dur: 1.5 },
    { cells: route(nodes[2], nodes[3]), to: 3, start: 3.1, dur: 1.5 },
  ];
  return {
    cols: COLS,
    rows: ROWS,
    fps: 24,
    still: 1.2,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      for (const e of edges) for (const [i, j] of e.cells) c.lift(i, j, 0.1);
      for (const e of edges) {
        const p = (t - e.start) / e.dur;
        if (p >= 0 && p <= 1.2) pulse(c, e.cells, ease(Math.min(p, 1)));
      }
      nodes.forEach((node, n) => {
        let g = n === 0 ? glowAfter(t, 0.1, PERIOD) : 0;
        for (const e of edges) if (e.to === n) g = Math.max(g, glowAfter(t, e.start + e.dur, PERIOD));
        node_(c, node, g);
      });
    },
  };
}

/** Agents: el cero en el centro, que consulta y actúa sobre lo que tiene alrededor. */
function agents(): Figure {
  const CX = 36;
  const CY = 17;
  const W = 14;
  const H = 5;
  const sat: Box[] = [
    { x: 0, y: 1, w: W, h: H },
    { x: 29, y: 0, w: W, h: H },
    { x: 58, y: 1, w: W, h: H },
    { x: 0, y: 28, w: W, h: H },
    { x: 29, y: 29, w: W, h: H },
    { x: 58, y: 28, w: W, h: H },
  ];
  const PERIOD = 9;
  const SLOT = PERIOD / sat.length;
  const SEQ = [0, 4, 2, 3, 5, 1];
  const spokes = sat.map((n) => path([[CX, CY], [n.x + Math.floor(n.w / 2), n.y + Math.floor(n.h / 2)]]));
  const mesh = linkMesh(1, 0.46, 0, 90, 26);
  const z = new Float32Array(COLS * ROWS);
  return {
    cols: COLS,
    rows: ROWS,
    fps: 24,
    still: 2.05,
    draw(c, time) {
      c.clear();
      const t = time % PERIOD;
      for (const s of spokes) for (const [i, j] of s) c.lift(i, j, 0.1);
      SEQ.forEach((k, n) => {
        const local = t - n * SLOT;
        if (local >= 0 && local < 0.75) pulse(c, spokes[k], ease(local / 0.75));
        if (local >= 0.95 && local < 1.5) pulse(c, spokes[k], 1 - ease((local - 0.95) / 0.55));
      });
      sat.forEach((node, n) => {
        const g = glowAfter(t, SEQ.indexOf(n) * SLOT + 0.75, PERIOD);
        node_(c, node, g);
      });
      // El cero tapa los rayos que llegan al centro.
      for (let j = CY - 8; j <= CY + 8; j++)
        for (let i = CX - 16; i <= CX + 16; i++) {
          const dx = (i - CX) / 15;
          const dy = (j - CY) / 8;
          if (dx * dx + dy * dy < 1) c.set(i, j, 0);
        }
      z.fill(0);
      // Se mece: si girara del todo quedaría de canto y dejaría de leerse como un cero.
      const m = rotation(Math.sin(time * 0.5) * 0.55, Math.sin(time * 0.37) * 0.5, 0, 0.2);
      drawMesh(c, z, mesh, m, 0, 0, 5, CX, CY, 34);
    },
  };
}

export function graphFigure(variant: string): Figure {
  return variant === 'agents' ? agents() : flow();
}
