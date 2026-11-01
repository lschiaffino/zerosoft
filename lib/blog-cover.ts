/**
 * Portadas del blog: una imagen generada por post y, encima, la misma imagen
 * dibujada con ceros (más grandes y más claros donde hay más luz). Pura y
 * determinística: el mismo slug da siempre la misma portada, así la rutina
 * diaria no tiene que producir ni subir nada.
 */

export const BLOG_COVER_WIDTH = 1200;
export const BLOG_COVER_HEIGHT = 630;

const CELL = 25;
const LEVELS = 6;

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Generador con semilla (mulberry32): cada portada saca siempre la misma secuencia. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const smooth = (a: number, b: number, n: number) => {
  const t = clamp((n - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Luz de la escena en (x, y), con y de -1 a 1 y x proporcional al ancho. */
type Scene = (x: number, y: number) => number;

const ASPECT = BLOG_COVER_WIDTH / BLOG_COVER_HEIGHT;

/** Esfera con luz de costado: x e y normalizados al radio. */
function sphere(rand: () => number): Scene {
  const cx = (rand() > 0.5 ? 1 : -1) * (0.45 + rand() * 0.5);
  const cy = -0.05 + rand() * 0.2;
  const r = 0.95 + rand() * 0.3;
  const lx = -Math.sign(cx) * 0.55;
  const ly = -0.55;
  const lz = Math.sqrt(1 - lx * lx - ly * ly);
  return (x, y) => {
    const u = (x - cx) / r;
    const v = (y - cy) / r;
    const d = u * u + v * v;
    if (d > 1) return 0;
    const z = Math.sqrt(1 - d);
    const diffuse = Math.max(0, u * lx + v * ly + z * lz);
    return clamp(diffuse ** 1.4);
  };
}

/** Toroide de frente e inclinado, como el de la portada del sitio. */
function torus(rand: () => number): Scene {
  const pitch = 0.65 + rand() * 0.5;
  const roll = (rand() - 0.5) * 0.9;
  const cx = (rand() - 0.5) * 0.9;
  const scale = 0.72 + rand() * 0.14;
  const R = 1;
  const r = 0.46;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const steps = 44;
  // Marcha de rayos ortográfica por la distancia con signo al toroide.
  return (x, y) => {
    const px = ((x - cx) * cr + y * sr) / scale;
    const py = (-(x - cx) * sr + y * cr) / scale;
    const sdf = (a: number, b: number, c: number) => {
      const by = b * cp - c * sp;
      const bz = b * sp + c * cp;
      const q = Math.hypot(a, by) - R;
      return Math.hypot(q, bz) - r;
    };
    let z = -2;
    for (let i = 0; i < steps; i++) {
      const d = sdf(px, py, z);
      if (d < 0.002) {
        const e = 0.01;
        const nx = sdf(px + e, py, z) - sdf(px - e, py, z);
        const ny = sdf(px, py + e, z) - sdf(px, py - e, z);
        const nz = sdf(px, py, z + e) - sdf(px, py, z - e);
        const len = Math.hypot(nx, ny, nz) || 1;
        const diffuse = Math.max(0, (nx * -0.5 + ny * -0.6 + nz * -0.62) / len);
        return clamp(diffuse ** 1.25 * 0.95 + 0.06);
      }
      z += d;
      if (z > 2) break;
    }
    return 0;
  };
}

/** Lomas apiladas, de atrás hacia adelante, con la cresta iluminada. */
function dunes(rand: () => number): Scene {
  const layers = Array.from({ length: 5 }, (_, i) => ({
    base: -0.5 + i * 0.32,
    amp: 0.14 + rand() * 0.16,
    freq: 0.7 + rand() * 0.8,
    phase: rand() * Math.PI * 2,
  }));
  return (x, y) => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      const crest = l.base + Math.sin(x * l.freq + l.phase) * l.amp + Math.sin(x * l.freq * 2.3 + l.phase * 2) * l.amp * 0.3;
      if (y >= crest) {
        const depth = y - crest;
        return clamp((1 - depth * 2.1) * (0.5 + 0.5 * ((i + 1) / layers.length)));
      }
    }
    return 0;
  };
}

/** Arcos concéntricos que salen de una esquina, como un cero que no entra en el cuadro. */
function arcs(rand: () => number): Scene {
  const cx = (rand() > 0.5 ? 1 : -1) * (ASPECT + 0.1);
  const cy = (rand() > 0.5 ? 1 : -1) * (0.9 + rand() * 0.3);
  const gap = 0.42 + rand() * 0.2;
  return (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    const band = (d / gap) % 1;
    const fade = 1 - smooth(1.2, ASPECT * 2.3, d);
    return clamp(smooth(0, 0.55, band) * (1 - smooth(0.82, 1, band)) * (0.2 + fade * 0.95));
  };
}

/** El cero de la marca, grande y con volumen, cortado por el borde. */
function bigZero(rand: () => number): Scene {
  const cx = (rand() > 0.5 ? 1 : -1) * (0.3 + rand() * 0.75);
  const cy = (rand() - 0.5) * 0.3;
  const rx = 0.82 + rand() * 0.14;
  const ry = 1.12 + rand() * 0.16;
  const tilt = (rand() - 0.5) * 0.5;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const u = (dx * cos + dy * sin) / rx;
    const v = (-dx * sin + dy * cos) / ry;
    const d = Math.hypot(u, v);
    const band = 1 - Math.abs(d - 0.74) / 0.26;
    if (band <= 0) return 0;
    const a = Math.atan2(v, u);
    const light = 0.55 + 0.45 * Math.cos(a + 2.2);
    return clamp(band ** 0.6 * light);
  };
}

const SCENES = [torus, sphere, dunes, bigZero, arcs];

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const INK: [number, number, number] = [8, 8, 10];
const WHITE: [number, number, number] = [255, 255, 255];

/** La portada, en SVG. `color` es el de la app del post; sin app, en grises. */
export function blogCoverSVG(slug: string, color?: string | null): string {
  const seed = hash(slug);
  const scene = SCENES[seed % SCENES.length](random(seed));
  const base = rgb(color ?? '#a8a8ad');
  const W = BLOG_COVER_WIDTH;
  const H = BLOG_COVER_HEIGHT;

  const light = (px: number, py: number) => scene(((px / W) * 2 - 1) * ASPECT, (py / H) * 2 - 1);

  // La imagen de abajo: la misma escena a baja resolución y desenfocada, en el color de la app.
  // Baldosas pisadas entre sí y sin saltear las oscuras: si no, el desenfoque deja escalones.
  const GLOW = 30;
  let glow = '';
  for (let y = -GLOW; y < H + GLOW; y += GLOW) {
    for (let x = -GLOW; x < W + GLOW; x += GLOW) {
      const l = light(x + GLOW / 2, y + GLOW / 2);
      glow += `<rect x="${x}" y="${y}" width="${GLOW + 1}" height="${GLOW + 1}" fill="${mix(INK, base, 0.1 + l * 0.72)}"/>`;
    }
  }

  // Los ceros: un trazo por nivel de luz, así el archivo pesa poco y comprime bien.
  const paths: string[][] = Array.from({ length: LEVELS }, () => []);
  for (let row = 0; row * CELL < H + CELL; row++) {
    const y = row * CELL;
    // Filas corridas media celda: la trama se lee como tejido, no como planilla.
    const shift = row % 2 ? CELL / 2 : 0;
    for (let col = -1; col * CELL < W + CELL; col++) {
      const x = col * CELL + shift;
      const l = light(x, y);
      if (l < 0.07) continue;
      const level = Math.min(LEVELS - 1, Math.floor(l * LEVELS));
      const size = 0.38 + ((level + 1) / LEVELS) * 0.62;
      const rx = (CELL * 0.27 * size).toFixed(1);
      const ry = (CELL * 0.42 * size).toFixed(1);
      paths[level].push(`M${x - Number(rx)} ${y}a${rx} ${ry} 0 1 0 ${Number(rx) * 2} 0a${rx} ${ry} 0 1 0-${Number(rx) * 2} 0`);
    }
  }
  const zeros = paths
    .map((d, level) => {
      if (d.length === 0) return '';
      const t = (level + 1) / LEVELS;
      const stroke = level >= 3 ? mix(base, WHITE, (t - 0.5) * 1.7) : mix(INK, base, 0.45 + t);
      return `<path d="${d.join('')}" stroke="${stroke}" stroke-width="${(1.2 + t * 1.6).toFixed(2)}"/>`;
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<defs><filter id="b" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="38"/></filter></defs>` +
    `<rect width="${W}" height="${H}" fill="${mix(INK, base, 0.1)}"/>` +
    `<g filter="url(#b)">${glow}</g>` +
    `<g fill="none">${zeros}</g>` +
    `</svg>`
  );
}
