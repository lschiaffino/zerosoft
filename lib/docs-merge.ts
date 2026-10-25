/**
 * Docs: fusión de tres vías para la edición simultánea.
 *
 * Dos personas editan la misma página a partir de la misma versión (`base`).
 * Cuando llega la versión de la otra (`theirs`) se combina con lo propio
 * (`ours`) bloque por bloque:
 * - bloques nuevos, borrados o movidos de cada lado se respetan;
 * - si las dos cambiaron el mismo bloque, el texto se fusiona por tramos
 *   (cada una editó una parte distinta de la frase: quedan las dos); si
 *   tocaron el mismo tramo gana lo propio y lo otro queda en el historial.
 * Puro y sin DOM: lo usan el editor (al recibir cambios) y los tests.
 */
import type { DocsBlock } from './docs-types';

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Ajusta un corte para que no caiga adentro de un tag `<...>` ni de una entidad `&...;`. */
function snapLeft(s: string, i: number): number {
  const lt = s.lastIndexOf('<', i - 1);
  const gt = s.lastIndexOf('>', i - 1);
  if (lt > gt) i = lt;
  const amp = s.lastIndexOf('&', i - 1);
  if (amp >= 0 && amp > i - 10 && s.indexOf(';', amp) >= i && !s.slice(amp, i).includes(' ')) i = amp;
  return i;
}

function snapRight(s: string, i: number): number {
  // i = inicio del sufijo común; si cae adentro de un tag, el sufijo empieza después.
  const lt = s.lastIndexOf('<', i - 1);
  const gt = s.lastIndexOf('>', i - 1);
  if (lt > gt) {
    const end = s.indexOf('>', i);
    if (end >= 0) i = end + 1;
  }
  const amp = s.lastIndexOf('&', i - 1);
  if (amp >= 0 && amp > i - 10) {
    const semi = s.indexOf(';', amp);
    if (semi >= i && semi - amp < 10) i = semi + 1;
  }
  return i;
}

/** Tramo de `base` que cambió en `other`: [start, end) en base y su reemplazo. */
function editRegion(base: string, other: string): { start: number; end: number; text: string } {
  let p = 0;
  const max = Math.min(base.length, other.length);
  while (p < max && base[p] === other[p]) p++;
  let s = 0;
  while (s < max - p && base[base.length - 1 - s] === other[other.length - 1 - s]) s++;
  let start = snapLeft(base, p);
  // El mismo retroceso en `other` (el prefijo es común).
  let endBase = snapRight(base, base.length - s);
  if (endBase < start) endBase = start;
  const suffix = base.length - endBase;
  let endOther = other.length - suffix;
  if (endOther < start) {
    start = Math.min(start, endOther);
    endOther = start;
  }
  return { start, end: endBase, text: other.slice(start, endOther) };
}

/**
 * Fusión de tres vías de un texto (HTML-lite o plano). `conflict` = las dos
 * tocaron el mismo tramo y ganó `ours`.
 */
export function mergeText(base: string, ours: string, theirs: string): { text: string; conflict: boolean } {
  if (ours === theirs) return { text: ours, conflict: false };
  if (ours === base) return { text: theirs, conflict: false };
  if (theirs === base) return { text: ours, conflict: false };
  const o = editRegion(base, ours);
  const t = editRegion(base, theirs);
  // Tramos separados (o inserciones en el mismo punto): se aplican los dos, de atrás para adelante.
  const disjoint = o.end <= t.start || t.end <= o.start;
  const bothInsertAt = o.start === o.end && t.start === t.end && o.start === t.start;
  if (!disjoint && !bothInsertAt) return { text: ours, conflict: true };
  if (bothInsertAt) {
    return { text: base.slice(0, o.start) + t.text + o.text + base.slice(o.end), conflict: false };
  }
  const [first, second] = o.start <= t.start ? [o, t] : [t, o];
  const text = base.slice(0, first.start) + first.text + base.slice(first.end, second.start) + second.text + base.slice(second.end);
  return { text, conflict: false };
}

function mergeBlock(base: DocsBlock, ours: DocsBlock, theirs: DocsBlock): { block: DocsBlock; conflict: boolean } {
  if (same(ours, base)) return { block: theirs, conflict: false };
  if (same(theirs, base)) return { block: ours, conflict: false };
  if (same(ours, theirs)) return { block: ours, conflict: false };
  const keys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  const out: Record<string, unknown> = { id: ours.id };
  let conflict = false;
  const b = base as unknown as Record<string, unknown>;
  const o = ours as unknown as Record<string, unknown>;
  const t = theirs as unknown as Record<string, unknown>;
  for (const k of keys) {
    if (k === 'id') continue;
    if (k === 'content' || k === 'caption') {
      const res = mergeText(String(b[k] ?? ''), String(o[k] ?? ''), String(t[k] ?? ''));
      conflict ||= res.conflict;
      if (res.text !== '' || o[k] !== undefined || t[k] !== undefined) out[k] = res.text;
      continue;
    }
    if (same(o[k], b[k])) {
      if (t[k] !== undefined) out[k] = t[k];
    } else {
      if (!same(t[k], b[k]) && !same(t[k], o[k])) conflict = true;
      if (o[k] !== undefined) out[k] = o[k];
    }
  }
  return { block: out as unknown as DocsBlock, conflict };
}

/** Id del bloque anterior que está en las tres versiones (ignora nuevos y borrados). */
function prevInBase(list: DocsBlock[], i: number, baseIds: Set<string>): string | null {
  for (let j = i - 1; j >= 0; j--) if (baseIds.has(list[j].id)) return list[j].id;
  return null;
}

export interface BlocksMergeResult {
  blocks: DocsBlock[];
  /** Bloques donde las dos tocaron el mismo tramo (ganó lo propio). */
  conflicts: string[];
}

/** Fusión de tres vías de la lista de bloques (ver arriba). */
export function mergeBlocks(base: DocsBlock[], ours: DocsBlock[], theirs: DocsBlock[]): BlocksMergeResult {
  if (same(ours, theirs)) return { blocks: ours, conflicts: [] };
  if (same(ours, base)) return { blocks: theirs, conflicts: [] };
  if (same(theirs, base)) return { blocks: ours, conflicts: [] };
  const baseById = new Map(base.map((b) => [b.id, b]));
  const oursById = new Map(ours.map((b) => [b.id, b]));
  const theirsById = new Map(theirs.map((b) => [b.id, b]));
  // Referencias para detectar movimientos: bloques que siguen en las tres versiones
  // (un borrado o un bloque nuevo al lado no cuenta como mover).
  const baseIds = new Set([...baseById.keys()].filter((id) => oursById.has(id) && theirsById.has(id)));
  const conflicts: string[] = [];

  /** Versión final de un bloque, o null si se borra. */
  const resolve = (id: string): DocsBlock | null => {
    const b = baseById.get(id);
    const o = oursById.get(id);
    const t = theirsById.get(id);
    if (!b) return o ?? t ?? null; // nuevo de un lado (mismo id de los dos: improbable)
    if (!o && !t) return null;
    if (!o) return t && !same(t, b) ? t : null; // borrado nuestro; si lo cambiaron, se conserva
    if (!t) return !same(o, b) ? o : null; // borrado de ellos; si lo cambiamos, se conserva
    const res = mergeBlock(b, o, t);
    if (res.conflict) conflicts.push(id);
    return res.block;
  };

  // Orden: el de ellos, y encima lo que movimos o agregamos nosotros.
  const result: DocsBlock[] = [];
  const placed = new Set<string>();
  for (const tb of theirs) {
    const id = tb.id;
    const o = oursById.get(id);
    const b = baseById.get(id);
    // Lo movimos nosotros (y ellos no): se ubica después, según nuestro orden.
    if (o && b) {
      const oi = ours.indexOf(o);
      const bi = base.indexOf(b);
      const ti = theirs.indexOf(tb);
      const movedByUs = prevInBase(ours, oi, baseIds) !== prevInBase(base, bi, baseIds);
      const movedByThem = prevInBase(theirs, ti, baseIds) !== prevInBase(base, bi, baseIds);
      if (movedByUs && !movedByThem) continue;
    }
    const block = resolve(id);
    if (block) {
      result.push(block);
      placed.add(id);
    }
  }
  // Nuestros bloques nuevos o movidos: después de su anterior en nuestra lista.
  for (let i = 0; i < ours.length; i++) {
    const id = ours[i].id;
    if (placed.has(id)) continue;
    const block = resolve(id);
    if (!block) continue;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = result.findIndex((x) => x.id === ours[j].id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    result.splice(at, 0, block);
    placed.add(id);
  }
  return { blocks: result, conflicts };
}

/** Título: mismo criterio que el texto de un bloque. */
export function mergeTitle(base: string, ours: string, theirs: string): string {
  return mergeText(base, ours, theirs).text;
}
