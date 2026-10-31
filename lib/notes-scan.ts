/**
 * Notes — escaneo de documentos en el navegador: se recorta la hoja a los
 * cuatro bordes marcados (corrección de perspectiva con una homografía) y
 * se limpia para leer (escala de grises y niveles automáticos). Sin
 * dependencias; trabaja sobre ImageData (Uint8ClampedArray RGBA), así que
 * se testea en Node.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Resuelve A·x = b (8×8) por eliminación gaussiana con pivoteo. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    [m[c], m[piv]] = [m[piv], m[c]];
    const d = m[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / d;
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / (row[i] || 1e-12));
}

/**
 * Homografía que lleva los 4 puntos `from` a los 4 `to` (en orden). Devuelve
 * los 9 coeficientes (h33 = 1).
 */
export function homography(from: Pt[], to: Pt[]): number[] {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return [...solve(a, b), 1];
}

export function applyHomography(h: number[], p: Pt): Pt {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Tamaño de salida para la hoja (orden: arriba-izq, arriba-der, abajo-der, abajo-izq), con un tope. */
export function outputSize(quad: Pt[], max = 1800): { w: number; h: number } {
  const w = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
  const h = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]));
  const scale = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Endereza la hoja: cada píxel de salida toma el de la foto que le corresponde (bilineal). */
export function warpQuad(src: Pixels, quad: Pt[], outW: number, outH: number): Pixels {
  const rect: Pt[] = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ];
  const h = homography(rect, quad);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const { width: sw, height: sh, data: sd } = src;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyHomography(h, { x, y });
      const x0 = Math.min(sw - 1, Math.max(0, Math.floor(p.x)));
      const y0 = Math.min(sh - 1, Math.max(0, Math.floor(p.y)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = Math.min(1, Math.max(0, p.x - x0));
      const fy = Math.min(1, Math.max(0, p.y - y0));
      const o = (y * outW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = sd[(y0 * sw + x0) * 4 + c] * (1 - fx) + sd[(y0 * sw + x1) * 4 + c] * fx;
        const b = sd[(y1 * sw + x0) * 4 + c] * (1 - fx) + sd[(y1 * sw + x1) * 4 + c] * fx;
        out[o + c] = a * (1 - fy) + b * fy;
      }
    }
  }
  return { width: outW, height: outH, data: out };
}

/**
 * "Limpiar para leer": grises y niveles automáticos (el 2% más oscuro va a
 * negro y el 2% más claro a blanco), con una curva que blanquea el papel.
 */
export function enhanceDocument(px: Pixels): Pixels {
  const n = px.width * px.height;
  const gray = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const g = Math.round(0.299 * px.data[i * 4] + 0.587 * px.data[i * 4 + 1] + 0.114 * px.data[i * 4 + 2]);
    gray[i] = g;
    hist[g]++;
  }
  const cut = Math.max(1, Math.floor(n * 0.02));
  let lo = 0;
  for (let acc = 0; lo < 255 && acc + hist[lo] < cut; lo++) acc += hist[lo];
  let hi = 255;
  for (let acc = 0; hi > 0 && acc + hist[hi] < cut; hi--) acc += hist[hi];
  if (hi <= lo) hi = Math.min(255, lo + 1);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, (gray[i] - lo) / (hi - lo)));
    // Curva: los tonos claros (papel) suben más rápido a blanco.
    const v = Math.round(255 * Math.pow(t, 0.8));
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return { width: px.width, height: px.height, data: out };
}

/** Esquinas iniciales: un margen del 5% dentro de la foto. */
export function defaultQuad(w: number, h: number): Pt[] {
  const mx = w * 0.05;
  const my = h * 0.05;
  return [
    { x: mx, y: my },
    { x: w - mx, y: my },
    { x: w - mx, y: h - my },
    { x: mx, y: h - my },
  ];
}

/**
 * Bordes de la hoja: umbral de Otsu sobre una copia chica, la mancha clara más
 * grande y sus cuatro esquinas. Null si no hay una hoja clara sobre un fondo
 * más oscuro (quedan las esquinas de fábrica). `px` en RGBA.
 */
export function detectQuad(px: Pixels, maxSide = 240): Pt[] | null {
  const scale = Math.min(1, maxSide / Math.max(px.width, px.height));
  const w = Math.max(1, Math.round(px.width * scale));
  const h = Math.max(1, Math.round(px.height * scale));
  const gray = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(px.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(px.width - 1, Math.floor(x / scale));
      const i = (sy * px.width + sx) * 4;
      const g = Math.round(0.299 * px.data[i] + 0.587 * px.data[i + 1] + 0.114 * px.data[i + 2]);
      gray[y * w + x] = g;
      hist[g]++;
    }
  }
  // Otsu: el corte que más separa las dos clases.
  const total = w * h;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let cut = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const diff = sumB / wB - (sum - sumB) / wF;
    const between = wB * wF * diff * diff;
    if (between > best) {
      best = between;
      cut = i;
    }
  }
  // La mancha clara más grande (4 vecinos).
  const seen = new Uint8Array(total);
  const stack: number[] = [];
  let bestPixels: number[] = [];
  for (let start = 0; start < total; start++) {
    if (seen[start] || gray[start] <= cut) continue;
    const pixels: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      pixels.push(c);
      const x = c % w;
      const y = (c - x) / w;
      if (x > 0 && !seen[c - 1] && gray[c - 1] > cut) { seen[c - 1] = 1; stack.push(c - 1); }
      if (x < w - 1 && !seen[c + 1] && gray[c + 1] > cut) { seen[c + 1] = 1; stack.push(c + 1); }
      if (y > 0 && !seen[c - w] && gray[c - w] > cut) { seen[c - w] = 1; stack.push(c - w); }
      if (y < h - 1 && !seen[c + w] && gray[c + w] > cut) { seen[c + w] = 1; stack.push(c + w); }
    }
    if (pixels.length > bestPixels.length) bestPixels = pixels;
  }
  // Muy chica o casi toda la foto: no es una hoja recortable.
  if (bestPixels.length < total * 0.15 || bestPixels.length > total * 0.97) return null;
  let tl = { v: Infinity, x: 0, y: 0 };
  let br = { v: -Infinity, x: 0, y: 0 };
  let tr = { v: -Infinity, x: 0, y: 0 };
  let bl = { v: Infinity, x: 0, y: 0 };
  for (const c of bestPixels) {
    const x = c % w;
    const y = (c - x) / w;
    if (x + y < tl.v) tl = { v: x + y, x, y };
    if (x + y > br.v) br = { v: x + y, x, y };
    if (x - y > tr.v) tr = { v: x - y, x, y };
    if (x - y < bl.v) bl = { v: x - y, x, y };
  }
  return [tl, tr, br, bl].map((p) => ({ x: p.x / scale, y: p.y / scale }));
}
