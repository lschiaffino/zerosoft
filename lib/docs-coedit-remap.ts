/**
 * Docs, edición simultánea: cambios de estructura de otra persona sobre el
 * bloque donde se está escribiendo (puro, sin DOM: se prueba en vitest).
 *
 * Partir (Enter) y unir (Backspace al principio) viajan en dos partes: una
 * operación de texto sobre el bloque que queda (se corta la cola, o se suma
 * el texto del bloque unido) y el guardado de la estructura (el bloque nuevo,
 * o el bloque que se va). Quien estaba escribiendo en ese bloque ve primero
 * la operación: su texto en la cola cortada queda en el borde del corte, y el
 * bloque unido se borra con lo que escribió después de la copia. Al llegar la
 * estructura, esta función lo reubica:
 *
 * - Partir: un bloque nuevo justo después de `p` con exactamente el texto
 *   que una operación reciente borró de `p` (mientras había texto propio
 *   ahí). Lo propio que quedó después del corte pasa al bloque nuevo, en el
 *   lugar donde se escribió.
 * - Unir: `p` ya no está en el servidor y una operación reciente insertó en
 *   otro bloque una copia de su texto. Esa copia se reemplaza por el texto de
 *   `p` como está en esta pantalla (con lo propio) y `p` sale.
 *
 * Solo lo hace quien tenía texto propio en el bloque (`own`): las demás
 * pantallas reciben el resultado por operaciones, así nada se mueve dos veces.
 */
import { apply, diff, transformIndex, type TextOp } from './docs-ot';

/** Operación de otra persona tal como se aplicó en esta pantalla. */
export interface RemoteTrace {
  block: string;
  at: number;
  /** Texto en pantalla antes de la operación. */
  prev: string;
  op: TextOp;
  /** Había texto propio en el bloque (sin confirmar o escrito hace un momento). */
  own: boolean;
}

export interface RemapBlock {
  id: string;
  content?: unknown;
}

export interface RemapCaret {
  block: string;
  /** Posición en el HTML-lite del bloque. */
  index: number;
}

export interface RemapResult<B extends RemapBlock> {
  blocks: B[];
  caret: RemapCaret | null;
  /** Bloques que cambiaron de texto o salieron (para mandar las operaciones). */
  touched: string[];
}

/** Tramo borrado por una operación: dónde empieza, el texto borrado y si en el medio quedó algo (lo que la operación conservó). */
export function deletedSpan(prev: string, op: TextOp): { start: number; text: string; keptAt: number | null } | null {
  let i = 0;
  let start = -1;
  let text = '';
  let keptAt: number | null = null;
  let ended = false;
  for (let k = 0; k < op.length; k++) {
    const c = op[k];
    if (typeof c === 'string') {
      if (start >= 0) return null; // Inserta en el medio del corte: no es un corte simple.
      continue;
    }
    if (c > 0) {
      if (start >= 0 && !ended) {
        // Lo que se conserva en el medio del tramo (texto que la otra persona no vio).
        const rest = op.slice(k + 1).some((x) => typeof x === 'number' && x < 0);
        if (rest) {
          if (keptAt === null) keptAt = text.length;
        } else ended = true;
      }
      i += c;
      continue;
    }
    const n = -c;
    if (ended) return null;
    if (start < 0) start = i;
    text += prev.slice(i, i + n);
    i += n;
  }
  if (start < 0 || !text) return null;
  return { start, text, keptAt };
}

/** Inserción única de una operación (sin borrados): dónde y qué. */
export function singleInsert(op: TextOp): { at: number; text: string } | null {
  let i = 0;
  let found: { at: number; text: string } | null = null;
  for (const c of op) {
    if (typeof c === 'string') {
      if (found) return null;
      found = { at: i, text: c };
    } else if (c < 0) return null;
    else i += c;
  }
  return found;
}

const str = (b: RemapBlock | undefined): string | null => (b && typeof b.content === 'string' ? b.content : null);

/**
 * `prev`: los bloques en esta pantalla antes de la fusión. `theirs`: la
 * estructura del servidor. `merged`: el resultado de la fusión (lo que se va a
 * pintar). Devuelve `merged` con lo propio reubicado, o null si no hay nada
 * que mover.
 */
export function remapStructure<B extends RemapBlock>(
  prev: B[],
  theirs: RemapBlock[],
  merged: B[],
  traces: RemoteTrace[],
  caret: RemapCaret | null,
  /** Hay texto propio en ese bloque (sin confirmar o escrito hace un momento). */
  ownIn: (id: string) => boolean = () => false,
): RemapResult<B> | null {
  const prevById = new Map(prev.map((b) => [b.id, b]));
  const theirIds = new Set(theirs.map((b) => b.id));
  let blocks = merged;
  let outCaret = caret;
  const touched = new Set<string>();
  const latest = (block: string, test: (t: RemoteTrace) => boolean) => {
    for (let i = traces.length - 1; i >= 0; i--) if (traces[i].block === block && test(traces[i])) return traces[i];
    return null;
  };
  const setContent = (id: string, content: string) => {
    blocks = blocks.map((b) => (b.id === id ? { ...b, content } : b));
    touched.add(id);
  };

  // Partir: bloque nuevo (no estaba acá) justo después de uno que sí estaba.
  for (let i = 1; i < blocks.length; i++) {
    const n = blocks[i];
    const p = blocks[i - 1];
    const nText = str(n);
    const pText = str(p);
    if (prevById.has(n.id) || !prevById.has(p.id) || nText === null || pText === null || !nText) continue;
    let span: ReturnType<typeof deletedSpan> = null;
    const t = latest(p.id, (x) => {
      if (!x.own) return false;
      span = deletedSpan(x.prev, x.op);
      return !!span && span.text === nText;
    });
    const sp = span as ReturnType<typeof deletedSpan>;
    if (!t || !sp) continue;
    let cut: number;
    try {
      const after = apply(t.prev, t.op);
      cut = transformIndex(sp.start, diff(after, pText));
    } catch {
      continue;
    }
    const orphan = pText.slice(cut);
    if (!orphan) continue;
    // Dónde va en el bloque nuevo: donde se escribía (lo conservado en el medio del corte), o al final.
    const at = Math.min(nText.length, sp.keptAt ?? nText.length);
    setContent(p.id, pText.slice(0, cut));
    setContent(n.id, nText.slice(0, at) + orphan + nText.slice(at));
    if (outCaret && outCaret.block === p.id && outCaret.index >= cut) outCaret = { block: n.id, index: at + (outCaret.index - cut) };
  }

  // Unir: un bloque que estaba acá y ya no está en el servidor.
  for (const p of prev) {
    const pText = str(p);
    if (pText === null || !pText || theirIds.has(p.id)) continue;
    // Solo quien escribió ahí (las demás pantallas lo reciben por operaciones: nada se mueve dos veces).
    const mine = ownIn(p.id) || traces.some((x) => x.block === p.id && x.own);
    if (!mine) continue;
    let found: { q: B; at: number; text: string } | null = null;
    for (let i = traces.length - 1; i >= 0 && !found; i--) {
      const x = traces[i];
      if (x.block === p.id) continue;
      const ins = singleInsert(x.op);
      if (!ins || ins.text.length < 2) continue;
      const q = blocks.find((b) => b.id === x.block);
      const qText = str(q);
      if (!q || qText === null) continue;
      // La copia tiene que ser una versión de lo de acá (lo propio solo suma).
      if (diff(ins.text, pText).some((c) => typeof c === 'number' && c < 0)) continue;
      try {
        const after = apply(x.prev, x.op);
        const at = transformIndex(ins.at, diff(after, qText));
        if (qText.slice(at, at + ins.text.length) === ins.text) found = { q, at, text: ins.text };
      } catch {
        /* otra operación: sigue buscando */
      }
    }
    if (!found) continue;
    const qText = str(found.q)!;
    setContent(found.q.id, qText.slice(0, found.at) + pText + qText.slice(found.at + found.text.length));
    blocks = blocks.filter((b) => b.id !== p.id);
    touched.add(p.id);
    if (outCaret && outCaret.block === p.id) outCaret = { block: found.q.id, index: found.at + outCaret.index };
  }

  if (!touched.size) return null;
  return { blocks, caret: outCaret, touched: [...touched] };
}
