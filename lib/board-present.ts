/**
 * Board: presentar frames como slides y exportarlos. Lógica pura (sin
 * Excalidraw) para poder testearla: qué frames hay y en qué orden, y a qué
 * slide lleva cada tecla.
 */

export interface FrameLike {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string | null;
  isDeleted?: boolean;
}

/**
 * Frames de la escena en orden de lectura: por filas (de arriba hacia abajo) y
 * dentro de cada fila de izquierda a derecha. Dos frames están en la misma fila
 * si sus centros verticales quedan a menos de media altura del más bajo.
 */
export function orderFrames<T extends FrameLike>(elements: readonly unknown[]): T[] {
  // Solo frames: un frame de wireframe a código (magicframe) no es una slide.
  const frames = (elements as T[]).filter((e) => e && !e.isDeleted && e.type === 'frame');
  const byTop = [...frames].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
  const rows: T[][] = [];
  for (const f of byTop) {
    const cy = f.y + f.height / 2;
    const row = rows[rows.length - 1];
    if (row) {
      const ref = row[0];
      const tolerance = Math.min(ref.height, f.height) / 2;
      if (Math.abs(ref.y + ref.height / 2 - cy) <= tolerance) {
        row.push(f);
        continue;
      }
    }
    rows.push([f]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x));
}

export type SlideKey = 'next' | 'prev' | 'first' | 'last' | 'exit' | null;

/** Qué hace cada tecla en la presentación (como Keynote o Excalidraw+). */
export function slideKey(key: string): SlideKey {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
    case ' ':
    case 'Enter':
      return 'next';
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
    case 'Backspace':
      return 'prev';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'Escape':
      return 'exit';
    default:
      return null;
  }
}

export function nextSlide(index: number, count: number, key: Exclude<SlideKey, 'exit' | null>): number {
  if (count <= 0) return 0;
  if (key === 'first') return 0;
  if (key === 'last') return count - 1;
  if (key === 'next') return Math.min(count - 1, index + 1);
  return Math.max(0, index - 1);
}
