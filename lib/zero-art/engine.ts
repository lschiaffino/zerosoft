/**
 * El motor de las figuras hechas de ceros: una grilla de celdas de texto, cada
 * una con su luz de 0 a 1, que sale como texto con la rampa del toroide
 * (' ·°o0Ø'). Sin DOM ni azar: el mismo tiempo da el mismo texto en el servidor
 * y en el cliente. Lo que corre en el navegador está en ./runner.
 */

/** Ancho de un carácter mono y alto de línea, en em. También en .zero-art (globals.css). */
export const CHAR_W = 0.6;
export const LINE_H = 1.12;
/** Alto de una celda medido en anchos de celda: para que un círculo sea redondo. */
export const CELL_RATIO = LINE_H / CHAR_W;

const RAMP_CODES = [' ', '·', '°', 'o', '0', 'Ø'].map((c) => c.charCodeAt(0));
const NEWLINE = '\n'.charCodeAt(0);

export const clamp = (n: number, lo = 0, hi = 1) => (n < lo ? lo : n > hi ? hi : n);
export const smooth = (n: number) => {
  const x = clamp(n);
  return x * x * (3 - 2 * x);
};
/** Entra y sale suave: el paso de una tarjeta o de un pulso. */
export const ease = (n: number) => {
  const x = clamp(n);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const lerp = (a: number, b: number, n: number) => a + (b - a) * n;

/** Generador con semilla (mulberry32): cada figura saca siempre la misma secuencia. */
export function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lo que el usuario hace con la figura: arrastre acumulado y puntero en celdas. */
export interface FigureInput {
  dragX: number;
  dragY: number;
  /** Puntero sobre la figura, en celdas; null si está afuera. */
  x: number | null;
  y: number | null;
}

export const NO_INPUT: FigureInput = { dragX: 0, dragY: 0, x: null, y: null };

export interface Figure {
  cols: number;
  rows: number;
  /** Cuadros por segundo: el mínimo que se ve bien en esta figura. */
  fps: number;
  /** El instante que queda como cuadro quieto: sin JS y con movimiento reducido. */
  still: number;
  /** Se gira arrastrando. */
  draggable?: boolean;
  /** Ocupa el ancho que le den: el runner ajusta la grilla; sin JS, el sobrante se recorta. */
  fluid?: boolean;
  draw(c: Cells, t: number, input: FigureInput): void;
  /** Si dibuja por su cuenta (el toroide), devuelve el texto y `draw` no se usa. */
  text?(t: number, input: FigureInput): string;
}

export class Cells {
  cols: number;
  rows: number;
  v: Float32Array;
  private codes: Uint16Array;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.v = new Float32Array(cols * rows);
    this.codes = new Uint16Array((cols + 1) * rows);
  }

  clear() {
    this.v.fill(0);
  }

  /** Se queda con la luz mayor: lo de adelante no apaga lo de atrás. */
  lift(i: number, j: number, value: number) {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return;
    const k = i + j * this.cols;
    if (value > this.v[k]) this.v[k] = value;
  }

  /** Pisa la luz: para lo que va encima y tiene que recortar lo de abajo. */
  set(i: number, j: number, value: number) {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return;
    this.v[i + j * this.cols] = value;
  }

  /** Un tramo recto entre dos celdas. */
  line(x0: number, y0: number, x1: number, y1: number, value: number) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= n; s++) {
      this.lift(Math.round(lerp(x0, x1, s / n)), Math.round(lerp(y0, y1, s / n)), value);
    }
  }

  /**
   * Una losa iluminada: la luz baja en diagonal desde arriba a la izquierda,
   * como en el toroide, con un canto claro arriba y las esquinas comidas. La
   * posición puede caer entre celdas: el borde se atenúa según cuánto la cubre,
   * así el movimiento no salta de a un carácter.
   */
  slab(x: number, y: number, w: number, h: number, tone = 0.55, solid = false) {
    const i0 = Math.max(0, Math.floor(x));
    const i1 = Math.min(this.cols, Math.ceil(x + w));
    const j0 = Math.max(0, Math.floor(y));
    const j1 = Math.min(this.rows, Math.ceil(y + h));
    for (let j = j0; j < j1; j++) {
      const covY = clamp(Math.min(j + 1, y + h) - Math.max(j, y));
      const v = (j + 0.5 - y) / h;
      const edgeY = j + 0.5 - y < 1 || y + h - (j + 0.5) < 1;
      for (let i = i0; i < i1; i++) {
        const cov = covY * clamp(Math.min(i + 1, x + w) - Math.max(i, x));
        if (cov <= 0) continue;
        const edgeX = i + 0.5 - x < 1 || x + w - (i + 0.5) < 1;
        if (edgeX && edgeY && w > 3 && h > 2) {
          if (solid) this.set(i, j, 0);
          continue;
        }
        const u = (i + 0.5 - x) / w;
        const L = tone + (0.5 - (u + v) / 2) * 0.62 + (j + 0.5 - y < 1 ? 0.14 : 0);
        const value = clamp(L, 0.06, 1) * cov;
        if (solid) this.set(i, j, value);
        else this.lift(i, j, value);
      }
    }
  }

  /**
   * Una tarjeta en reposo: contorno tenue y un renglón de título. Lo que está
   * activo se dibuja con `slab`: así en cada momento manda una sola cosa.
   */
  card(x: number, y: number, w: number, h: number, title = 0.5) {
    const X = Math.round(x);
    const Y = Math.round(y);
    for (let i = X + 1; i < X + w - 1; i++) {
      this.set(i, Y, 0.3);
      this.set(i, Y + h - 1, 0.1);
    }
    for (let j = Y + 1; j < Y + h - 1; j++) {
      this.set(X, j, 0.22);
      this.set(X + w - 1, j, 0.1);
      for (let i = X + 1; i < X + w - 1; i++) this.set(i, j, 0);
    }
    if (h >= 4) {
      const len = Math.max(2, Math.floor((w - 4) * 0.62));
      for (let i = 0; i < len; i++) this.set(X + 2 + i, Y + 1 + (h > 4 ? 1 : 0), title);
    }
  }

  /** El contorno de un rectángulo, en una sola luz. */
  frame(x: number, y: number, w: number, h: number, value: number) {
    const x1 = x + w - 1;
    const y1 = y + h - 1;
    for (let i = x; i <= x1; i++) {
      this.lift(i, y, value);
      this.lift(i, y1, value);
    }
    for (let j = y; j <= y1; j++) {
      this.lift(x, j, value);
      this.lift(x1, j, value);
    }
  }

  text(): string {
    const { cols, rows, v, codes } = this;
    let n = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const value = v[i + j * cols];
        codes[n++] = RAMP_CODES[value < 0.03 ? 0 : value >= 1 ? 5 : 1 + Math.floor(value * 5)];
      }
      codes[n++] = NEWLINE;
    }
    return String.fromCharCode.apply(null, codes.subarray(0, n - 1) as unknown as number[]);
  }
}

/** El cuadro quieto de una figura: lo que sale del servidor. */
export function stillFrame(figure: Figure): string {
  const cells = new Cells(figure.cols, figure.rows);
  figure.draw(cells, figure.still, NO_INPUT);
  return cells.text();
}
