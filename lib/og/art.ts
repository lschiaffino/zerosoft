import { TORUS_RAMP, renderTorus } from '@/lib/torus';

/**
 * El dibujo de las tarjetas para compartir: el toroide de ceros (lib/torus)
 * en una grilla de caracteres que cubre la tarjeta, y ceros sueltos que se
 * desprenden hacia la izquierda, como polvo. Puro y determinístico: la misma
 * semilla da siempre el mismo dibujo, así la imagen se cachea para siempre.
 *
 * Devuelve una capa por nivel de luz (` ·°o0Ø`): cada capa es la grilla
 * entera con espacios donde no le toca, y el render la pinta con su opacidad.
 * Cinco bloques de texto en lugar de miles de nodos: la tarjeta sale en
 * menos de 200 ms.
 */

export interface ArtBox {
  /** Columnas y filas de la grilla que cubre la tarjeta. */
  cols: number;
  rows: number;
  /** Centro del toroide, en celdas. */
  cx: number;
  cy: number;
  /** Tamaño del toroide, en celdas (W×H de renderTorus; H ≈ W/2). */
  size: number;
  /** Cuánto polvo suelta hacia la izquierda (0 a 1). */
  drift?: number;
  /** Columna donde el polvo se apaga del todo (el texto vive a la izquierda). */
  driftEnd?: number;
}

export type ArtLayers = string[];

export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: la misma semilla, la misma secuencia. */
export function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LEVELS = TORUS_RAMP.length - 1; // sin el espacio

/**
 * Capas de la tarjeta. La semilla elige el ángulo del toroide (cada página
 * tiene su cero, apenas girado) y dónde cae el polvo.
 */
export function artLayers(seed: string, box: ArtBox): ArtLayers {
  const rnd = seeded(hashString(seed));
  const { cols, rows } = box;
  const grid = new Array<number>(cols * rows).fill(0);

  // El toroide, con un ángulo propio de la semilla dentro de un rango que se lee como un cero.
  const W = box.size;
  const H = Math.round(box.size / 2);
  const A = 1.0 + rnd() * 0.5;
  const B = 0.2 + rnd() * 0.5;
  const torus = renderTorus(W, H, A, B, 0.92).split('\n');
  const x0 = Math.round(box.cx - W / 2);
  const y0 = Math.round(box.cy - H / 2);
  for (let j = 0; j < H; j++) {
    const row = torus[j] ?? '';
    for (let i = 0; i < W; i++) {
      const level = TORUS_RAMP.indexOf(row[i] as (typeof TORUS_RAMP)[number]);
      if (level <= 0) continue;
      const x = x0 + i;
      const y = y0 + j;
      if (x >= 0 && x < cols && y >= 0 && y < rows) grid[x + y * cols] = level;
    }
  }

  // El polvo: ceros que se desprenden del borde izquierdo del toroide y se
  // apagan hacia el texto. Más denso cerca del cero, más tenue lejos.
  const drift = box.drift ?? 1;
  if (drift > 0) {
    const end = box.driftEnd ?? 0;
    const left = x0 + W * 0.18;
    for (let y = 0; y < rows; y++) {
      // Una banda: el polvo sale a la altura del cero, no de las esquinas.
      const dy = Math.abs(y - box.cy) / (H * 0.62);
      const band = Math.max(0, 1 - dy * dy);
      for (let x = Math.max(0, end); x < Math.min(cols, left); x++) {
        if (grid[x + y * cols]) continue;
        const d = (left - x) / Math.max(1, left - end);
        const p = 0.34 * drift * band * Math.pow(1 - d, 2.4);
        if (rnd() < p) {
          // Cerca del cero quedan partículas más brillantes; lejos, puntos.
          const bright = 1 - d;
          grid[x + y * cols] = Math.max(1, Math.min(LEVELS - 1, Math.round(1 + rnd() * 2.6 * bright)));
        }
      }
    }
    // Algunas partículas sueltas sobre y debajo del cero, para que respire.
    const extra = Math.round(28 * drift);
    for (let n = 0; n < extra; n++) {
      const x = Math.round(x0 + rnd() * W);
      const y = Math.round(rnd() * rows);
      if (x < end || x >= cols || y < 0 || y >= rows || grid[x + y * cols]) continue;
      grid[x + y * cols] = 1 + Math.floor(rnd() * 2);
    }
  }

  const layers: ArtLayers = [];
  for (let level = 1; level <= LEVELS; level++) {
    const lines: string[] = [];
    for (let y = 0; y < rows; y++) {
      let line = '';
      for (let x = 0; x < cols; x++) line += grid[x + y * cols] === level ? TORUS_RAMP[level] : ' ';
      lines.push(line.replace(/\s+$/, ''));
    }
    layers.push(lines.join('\n'));
  }
  return layers;
}
