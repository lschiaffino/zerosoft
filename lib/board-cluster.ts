/**
 * Board: acomodar stickies agrupados por tema (lo que devuelve la IA) en
 * columnas, una por grupo, con su título arriba. Puro, para testearlo: dice
 * dónde va cada sticky y cada título; el editor mueve los elementos.
 */

export interface ClusterBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClusterLayout {
  /** Posición nueva (x, y) de cada sticky. */
  moves: Map<string, { x: number; y: number }>;
  /** Títulos de columna: dónde escribirlos. */
  headers: Array<{ title: string; x: number; y: number }>;
  /** Dónde va el resumen (arriba de todo). */
  summaryAt: { x: number; y: number };
}

const GAP = 24;
const COL_GAP = 80;
const HEADER_H = 56;
const PER_ROW = 2;

/**
 * Columnas desde la esquina de arriba a la izquierda de los stickies
 * originales: cada grupo es una columna de PER_ROW stickies de ancho.
 */
export function clusterLayout(groups: Array<{ title: string; ids: string[] }>, boxes: ClusterBox[]): ClusterLayout {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const cellW = Math.max(...boxes.map((b) => b.width), 1);
  const cellH = Math.max(...boxes.map((b) => b.height), 1);
  const moves = new Map<string, { x: number; y: number }>();
  const headers: ClusterLayout['headers'] = [];
  let x = left;
  const y0 = top + HEADER_H;
  for (const g of groups) {
    const ids = g.ids.filter((id) => byId.has(id));
    if (!ids.length) continue;
    headers.push({ title: g.title, x, y: top });
    const cols = Math.min(PER_ROW, ids.length);
    ids.forEach((id, i) => {
      moves.set(id, { x: x + (i % PER_ROW) * (cellW + GAP), y: y0 + Math.floor(i / PER_ROW) * (cellH + GAP) });
    });
    x += cols * (cellW + GAP) - GAP + COL_GAP;
  }
  return { moves, headers, summaryAt: { x: left, y: top - HEADER_H - 40 } };
}
