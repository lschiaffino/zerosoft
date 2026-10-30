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
import { apply, diff, tokens, transformIndex, type TextOp } from './docs-ot';

/** Operación de otra persona tal como se aplicó en esta pantalla. */
export interface RemoteTrace {
  block: string;
  at: number;
  /** Texto en pantalla antes de la operación. */
  prev: string;
  op: TextOp;
  /** Había texto propio en el bloque (sin confirmar o escrito hace un momento). */
  own: boolean;
  /**
   * Lo que la operación dejó después de su último borrado es todo propio (lo
   * que la otra persona no tenía): así se ve un corte con Enter. Un borrado en
   * el medio del texto (Backspace sobre una letra) deja texto de los dos y no
   * es un corte. Sin el dato, se toma como corte.
   */
  tailOwn?: boolean;
}

/**
 * ¿Lo que deja `op` en `screen` después de su último borrado es todo propio?
 * Propio: lo que `screen` tiene y `server` (lo confirmado) no.
 */
export function ownTail(server: string, screen: string, op: TextOp): boolean {
  let i = 0;
  let lastDel = -1;
  for (const c of op) {
    if (typeof c === 'string') continue;
    if (c < 0) {
      i += -c;
      lastDel = i;
    } else i += c;
  }
  if (lastDel < 0 || lastDel >= screen.length) return true;
  // Caracteres de `screen` que vienen de `server` (no insertados acá).
  const fromServer = new Uint8Array(screen.length);
  let k = 0;
  for (const c of diff(server, screen)) {
    if (typeof c === 'string') k += c.length;
    else if (c > 0) {
      fromServer.fill(1, k, k + c);
      k += c;
    }
  }
  for (let j = lastDel; j < screen.length; j++) if (fromServer[j]) return false;
  return true;
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

/** Letras (sin contar espacios) que tiene que tener una cola para reconocerla dentro de un bloque nuevo con más texto. */
const MIN_TAIL = 3;

/** Largo del final común de dos textos. */
function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** Solo formato (tags), sin texto. */
const isMarkup = (s: string) => /^(?:<[^>]*>)+$/.test(s);

/**
 * Tramo borrado por una operación: dónde empieza, el texto borrado, si en el
 * medio quedó texto (lo que la operación conservó: lo propio que la otra
 * persona no vio) y cuánto se conservó en el medio en total (también formato,
 * como el cierre de una negrita que quedó en el bloque). `start` es en `prev`;
 * `at`, el mismo lugar después de la operación (lo que insertó antes lo corre).
 */
export function deletedSpan(prev: string, op: TextOp): { start: number; at: number; text: string; keptAt: number | null; keptLen: number } | null {
  let i = 0;
  let ins = 0;
  let start = -1;
  let text = '';
  let keptAt: number | null = null;
  let keptLen = 0;
  let ended = false;
  for (let k = 0; k < op.length; k++) {
    const c = op[k];
    if (typeof c === 'string') {
      if (start >= 0) return null; // Inserta en el medio del corte: no es un corte simple.
      ins += c.length;
      continue;
    }
    if (c > 0) {
      if (start >= 0 && !ended) {
        // Lo que se conserva en el medio del tramo (texto que la otra persona no vio, o formato).
        const rest = op.slice(k + 1).some((x) => typeof x === 'number' && x < 0);
        if (rest) {
          keptLen += c;
          if (keptAt === null && !isMarkup(prev.slice(i, i + c))) keptAt = text.length;
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
  return { start, at: start + ins, text, keptAt, keptLen };
}

/**
 * Texto sin formato de un HTML-lite y, por cada carácter, su índice en el HTML
 * (más uno al final). El espacio duro cuenta como espacio: el navegador pone
 * uno al final de un bloque y lo cambia por uno común cuando sigue el texto.
 */
function plainOf(html: string): { text: string; at: number[] } {
  let text = '';
  const at: number[] = [];
  let i = 0;
  for (const raw of tokens(html)) {
    if (!(raw[0] === '<' && raw.length > 1)) {
      const t = raw === '&nbsp;' || raw === '\u00a0' ? ' ' : raw;
      for (let k = 0; k < t.length; k++) at.push(i);
      text += t;
    }
    i += raw.length;
  }
  at.push(html.length);
  return { text, at };
}

/**
 * Un borrado de corrido se puede describir corrido a izquierda o derecha cuando
 * el carácter de un borde se repite (borrar "ta gamma t" de "beta gamma tres"
 * es lo mismo que borrar "a gamma tr"): el diff elige uno, el bloque nuevo
 * tiene el otro. Devuelve todas las versiones equivalentes, la original primero.
 */
export function shiftedSpans(prev: string, sp: NonNullable<ReturnType<typeof deletedSpan>>): Array<NonNullable<ReturnType<typeof deletedSpan>>> {
  if (sp.keptLen) return [sp];
  const len = sp.text.length;
  let lo = sp.start;
  while (lo > 0 && prev[lo - 1] === prev[lo - 1 + len]) lo--;
  let hi = sp.start;
  while (hi + len < prev.length && prev[hi] === prev[hi + len]) hi++;
  const out = [sp];
  for (let d = 1; sp.start - d >= lo || sp.start + d <= hi; d++) {
    for (const s of [sp.start - d, sp.start + d]) {
      if (s < lo || s > hi) continue;
      out.push({ ...sp, start: s, at: sp.at + (s - sp.start), text: prev.slice(s, s + len) });
    }
  }
  return out;
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
  /** Desde cuándo se conoce el bloque (ms); null si no se sabe. Uno que todavía no llegó al servidor: Infinity. */
  bornAt: (id: string) => number | null = () => null,
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

  // Partir: bloques nuevos (no estaban acá) después de uno que sí estaba. Pueden ser varios
  // seguidos (la otra persona partió dos veces antes de que llegara la estructura): la cola
  // cortada puede estar en cualquiera de ellos, o repartida entre varios. El bloque cortado
  // puede no ser el de justo antes: los bloques que se partieron acá (Enter propio) quedan
  // en el medio.
  for (let i = 1; i < blocks.length; i++) {
    if (prevById.has(blocks[i].id) || !prevById.has(blocks[i - 1].id)) continue;
    let end = i;
    while (end < blocks.length && !prevById.has(blocks[end].id)) end++;
    const run = blocks.slice(i, end);
    if (run.some((b) => str(b) === null)) continue;
    // Se compara el texto sin formato: el corte de una negrita deja su cierre en el bloque de arriba.
    const plains = run.map((b) => plainOf(str(b)!));
    const joined = plains.map((x) => x.text).join('');
    if (!joined) continue;
    let span: ReturnType<typeof deletedSpan> = null;
    let spText = '';
    /** Largo del final de lo borrado que está al final de los bloques nuevos. */
    let matched = 0;
    let t: RemoteTrace | null = null;
    let p: B | null = null;
    /** Bloques entre el cortado y los nuevos (los más cercanos primero). */
    const between: B[] = [];
    for (let j = i - 1; j >= 0 && !t; j--) {
      const cand = blocks[j];
      if (!prevById.has(cand.id) || str(cand) === null) break;
      // Un corte: la operación se llevó la cola (lo que quedó después es solo lo propio)
      // y esa cola es el final de los bloques nuevos (allá se escribe antes de ella).
      t = latest(cand.id, (x) => {
        if (!x.own || x.tailOwn === false) return false;
        // Entre el bloque cortado y los nuevos solo puede haber bloques que se partieron acá
        // después del corte (Enter propio) o vacíos: un bloque de antes no es parte de este corte.
        if (between.some((b) => str(b) !== '' && (bornAt(b.id) ?? -Infinity) < x.at - 1000)) return false;
        const found = deletedSpan(x.prev, x.op);
        if (!found) return false;
        // Cuánto del final de lo borrado es el final de los bloques nuevos (la cola que se mudó).
        // Lo de antes pudo borrarse de verdad en la misma operación (borrar una palabra y Enter).
        let best: { v: NonNullable<typeof found>; text: string; m: number } | null = null;
        for (const v of shiftedSpans(x.prev, found)) {
          const text = plainOf(v.text).text;
          const m = commonSuffix(text, joined);
          if (!best || m > best.m) best = { v, text, m };
        }
        if (!best || !best.text.trim()) return false;
        // Una cola corta (una o dos letras) se confunde con cualquier bloque que termine igual: solo
        // cuenta si es todo el bloque nuevo (allá no se escribió nada más).
        const enough = best.m >= MIN_TAIL ? best.text.slice(best.text.length - best.m).trim().length >= MIN_TAIL : best.m === best.text.length && joined === best.text;
        if (!enough) return false;
        span = best.v;
        spText = best.text;
        matched = best.m;
        return true;
      });
      if (t) p = cand;
      else between.push(cand);
    }
    const sp = span as ReturnType<typeof deletedSpan>;
    if (!t || !sp || !p) continue;
    const pText = str(p)!;
    let cut: number;
    try {
      const after = apply(t.prev, t.op);
      // Sin texto propio en el medio, lo que quedó del tramo (formato) se queda arriba.
      cut = transformIndex(sp.at + (sp.keptAt === null ? sp.keptLen : 0), diff(after, pText));
    } catch {
      continue;
    }
    const orphan = pText.slice(cut);
    if (!orphan) continue;
    // Dónde va: donde se escribía (lo conservado en el medio del corte), o al final de la
    // cola cortada (lo que la otra persona escribió en los bloques nuevos queda en su lugar).
    const tailAt = joined.length - matched;
    const keptPlain = sp.keptAt === null ? spText.length : plainOf(sp.text.slice(0, sp.keptAt)).text.length;
    let pos = Math.min(joined.length, tailAt + Math.max(0, keptPlain - (spText.length - matched)));
    // El bloque del tramo donde cae esa posición (en un borde, el de antes: el que termina con la cola).
    let k = 0;
    while (k < run.length - 1 && pos > plains[k].text.length) {
      pos -= plains[k].text.length;
      k++;
    }
    const n = run[k];
    const nText = str(n)!;
    const at = plains[k].at[Math.min(pos, plains[k].text.length)];
    setContent(p.id, pText.slice(0, cut));
    setContent(n.id, nText.slice(0, at) + orphan + nText.slice(at));
    if (outCaret && outCaret.block === p.id && outCaret.index >= cut) outCaret = { block: n.id, index: at + (outCaret.index - cut) };
    i = end - 1;
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
      // La copia tiene que ser una versión de lo de acá (lo propio solo suma). La otra persona
      // pudo escribir en el borde de la unión en la misma operación ("MM" + la copia): la copia
      // es el final de lo insertado.
      let d: TextOp;
      try {
        d = diff(apply(x.prev, x.op), qText);
      } catch {
        continue;
      }
      for (let k = 0; k + 2 <= ins.text.length && !found; k++) {
        const copy = ins.text.slice(k);
        if (diff(copy, pText).some((c) => typeof c === 'number' && c < 0)) continue;
        // Lo que se escribió después en el mismo borde puede quedar antes o después del índice.
        for (const late of [false, true]) {
          const at = transformIndex(ins.at + k, d, late);
          if (qText.slice(at, at + copy.length) === copy) {
            found = { q, at, text: copy };
            break;
          }
        }
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
