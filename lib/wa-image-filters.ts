/**
 * Filtros de color del editor de fotos (components/groups/wa/ImageEditor.tsx), como los de WhatsApp:
 * Pop, B&N, Frío, Cromo y Película. Cada uno es una matriz de color (3×3 más un desplazamiento) que se
 * aplica a los píxeles, igual en todos los navegadores (el `filter` del canvas no está en todos). Puro:
 * se prueba sin DOM.
 */

export const FILTERS = ['none', 'pop', 'bw', 'cool', 'chrome', 'film'] as const;
export type FilterId = (typeof FILTERS)[number];

/** Filas r, g, b: [r, g, b, desplazamiento 0..255]. */
export type ColorMatrix = [number, number, number, number][];

const IDENTITY: ColorMatrix = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
];

/** Saturación (como `saturate()` de CSS): 0 = gris, 1 = igual. */
export function saturate(s: number): ColorMatrix {
  return [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0],
  ];
}

/** Contraste alrededor del gris medio (como `contrast()` de CSS). */
export function contrast(c: number): ColorMatrix {
  const o = 127.5 * (1 - c);
  return [
    [c, 0, 0, o],
    [0, c, 0, o],
    [0, 0, c, o],
  ];
}

/** Cada canal por su factor, más un desplazamiento (tono frío o cálido, negros levantados). */
export function channels(r: number, g: number, b: number, lift = 0): ColorMatrix {
  return [
    [r, 0, 0, lift],
    [0, g, 0, lift],
    [0, 0, b, lift],
  ];
}

/** `a` después de `b` (primero se aplica b). */
export function compose(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  return a.map((row) => [
    row[0] * b[0][0] + row[1] * b[1][0] + row[2] * b[2][0],
    row[0] * b[0][1] + row[1] * b[1][1] + row[2] * b[2][1],
    row[0] * b[0][2] + row[1] * b[1][2] + row[2] * b[2][2],
    row[0] * b[0][3] + row[1] * b[1][3] + row[2] * b[2][3] + row[3],
  ]) as ColorMatrix;
}

const chain = (...ms: ColorMatrix[]) => ms.reduce((acc, m) => compose(m, acc), IDENTITY);

/** La matriz de cada filtro (null: sin filtro). */
export const FILTER_MATRIX: Record<FilterId, ColorMatrix | null> = {
  none: null,
  // Más color y un poco más de contraste.
  pop: chain(saturate(1.45), contrast(1.1)),
  // Blanco y negro con algo de contraste.
  bw: chain(saturate(0), contrast(1.12)),
  // Tono azulado.
  cool: chain(channels(0.9, 1, 1.12, 4), saturate(1.05)),
  // Metálico: contraste alto, color justo.
  chrome: chain(contrast(1.22), saturate(1.12), channels(1.02, 1.02, 1.04)),
  // Película: menos color, negros levantados y tono cálido.
  film: chain(saturate(0.72), contrast(0.88), channels(1.06, 1.01, 0.9, 10)),
};

export function isFilter(v: unknown): v is FilterId {
  return typeof v === 'string' && (FILTERS as readonly string[]).includes(v);
}

/** Aplica la matriz a píxeles RGBA (los de getImageData), en el lugar. La transparencia no cambia. */
export function applyColorMatrix(data: Uint8ClampedArray, m: ColorMatrix): void {
  const [r0, r1, r2] = m;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    data[i] = r0[0] * r + r0[1] * g + r0[2] * b + r0[3];
    data[i + 1] = r1[0] * r + r1[1] * g + r1[2] * b + r1[3];
    data[i + 2] = r2[0] * r + r2[1] * g + r2[2] * b + r2[3];
  }
}
