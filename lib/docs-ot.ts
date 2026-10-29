/**
 * Docs: operaciones de texto para la edición simultánea tecla por tecla
 * (transformación operacional, como ot.js / Google Docs). Puro, sin DOM:
 * corre igual en el navegador, en el servidor y en los tests.
 *
 * Una operación recorre el texto entero del bloque (el HTML-lite de
 * `content`) con tres tipos de paso:
 * - número positivo: dejar n caracteres como están;
 * - string: insertar ese texto;
 * - número negativo: borrar n caracteres.
 *
 * El diff trabaja por tokens (cada tag `<...>`, cada entidad `&...;` y cada
 * carácter, con los emojis enteros): ninguna operación corta un tag por la
 * mitad, y las transformadas tampoco, porque solo se mueven de a tokens
 * enteros. Lo que puede quedar desparejo (un `</b>` sin abrir cuando dos
 * personas tocan el mismo formato) lo arregla el servidor con el sanitizador
 * y una operación de corrección (lib/docs-coedit.ts).
 */

export type TextOp = Array<number | string>;

const isRetain = (c: number | string | undefined): c is number => typeof c === 'number' && c > 0;
const isDelete = (c: number | string | undefined): c is number => typeof c === 'number' && c < 0;
const isInsert = (c: number | string | undefined): c is string => typeof c === 'string';

/** Arma operaciones juntando pasos iguales seguidos (y la inserción antes del borrado). */
class Builder {
  ops: TextOp = [];
  retain(n: number) {
    if (n <= 0) return this;
    const last = this.ops[this.ops.length - 1];
    if (isRetain(last)) this.ops[this.ops.length - 1] = last + n;
    else this.ops.push(n);
    return this;
  }
  insert(s: string) {
    if (!s) return this;
    const ops = this.ops;
    const last = ops[ops.length - 1];
    if (isInsert(last)) ops[ops.length - 1] = last + s;
    else if (isDelete(last)) {
      // Forma canónica: insertar antes de borrar.
      const prev = ops[ops.length - 2];
      if (isInsert(prev)) ops[ops.length - 2] = prev + s;
      else ops.splice(ops.length - 1, 0, s);
    } else ops.push(s);
    return this;
  }
  delete(n: number) {
    if (n <= 0) return this;
    const last = this.ops[this.ops.length - 1];
    if (isDelete(last)) this.ops[this.ops.length - 1] = last - n;
    else this.ops.push(-n);
    return this;
  }
  done(): TextOp {
    // Un retain final no aporta nada al aplicar, pero se deja: la longitud base queda explícita.
    return this.ops;
  }
}

/** Largo del texto sobre el que se aplica la operación. */
export function baseLength(op: TextOp): number {
  let n = 0;
  for (const c of op) if (typeof c === 'number') n += Math.abs(c);
  return n;
}

/** Largo del texto que queda después de aplicarla. */
export function targetLength(op: TextOp): number {
  let n = 0;
  for (const c of op) {
    if (isRetain(c)) n += c;
    else if (isInsert(c)) n += c.length;
  }
  return n;
}

/** No cambia nada (solo retains). */
export function isNoop(op: TextOp): boolean {
  return op.every((c) => isRetain(c));
}

/** Forma válida: números enteros distintos de 0 y strings no vacíos, con tope de tamaño. */
export function isTextOp(v: unknown, maxParts = 5000): v is TextOp {
  if (!Array.isArray(v) || v.length > maxParts) return false;
  return v.every((c) => (typeof c === 'number' && Number.isInteger(c) && c !== 0 && Math.abs(c) <= 10_000_000) || (typeof c === 'string' && c.length > 0));
}

export class OpError extends Error {}

export function apply(text: string, op: TextOp): string {
  if (baseLength(op) !== text.length) throw new OpError(`base length ${baseLength(op)} != ${text.length}`);
  let out = '';
  let i = 0;
  for (const c of op) {
    if (isRetain(c)) {
      out += text.slice(i, i + c);
      i += c;
    } else if (isInsert(c)) out += c;
    else i -= c as number;
  }
  return out;
}

/**
 * Transformación: `a` y `b` salen del mismo texto; devuelve [a', b'] con
 * apply(apply(s, a), b') === apply(apply(s, b), a'). Si los dos insertan en
 * el mismo punto, lo de `a` queda primero. El servidor y el navegador la
 * llaman siempre igual: (lo propio pendiente, lo que el servidor ya aplicó).
 */
export function transform(a: TextOp, b: TextOp): [TextOp, TextOp] {
  if (baseLength(a) !== baseLength(b)) throw new OpError('transform: different base lengths');
  const ap = new Builder();
  const bp = new Builder();
  let i = 0;
  let j = 0;
  let x: number | string | undefined = a[i++];
  let y: number | string | undefined = b[j++];
  for (;;) {
    if (x === undefined && y === undefined) break;
    if (isInsert(x)) {
      ap.insert(x);
      bp.retain(x.length);
      x = a[i++];
      continue;
    }
    if (isInsert(y)) {
      ap.retain(y.length);
      bp.insert(y);
      y = b[j++];
      continue;
    }
    if (x === undefined || y === undefined) throw new OpError('transform: too short');
    const xl = Math.abs(x as number);
    const yl = Math.abs(y as number);
    const m = Math.min(xl, yl);
    if (isRetain(x) && isRetain(y)) {
      ap.retain(m);
      bp.retain(m);
    } else if (isDelete(x) && isDelete(y)) {
      // Los dos borraron lo mismo: ninguno lo vuelve a borrar.
    } else if (isDelete(x) && isRetain(y)) {
      ap.delete(m);
    } else if (isRetain(x) && isDelete(y)) {
      bp.delete(m);
    }
    x = xl > m ? (isRetain(x) ? xl - m : -(xl - m)) : a[i++];
    y = yl > m ? (isRetain(y) ? yl - m : -(yl - m)) : b[j++];
  }
  return [ap.done(), bp.done()];
}

/**
 * Dónde queda una posición del texto después de aplicar `op`. Con `after`,
 * una inserción justo en esa posición la empuja (el caret de quien escribió).
 */
export function transformIndex(index: number, op: TextOp, after = false): number {
  let pos = 0;
  let out = index;
  for (const c of op) {
    if (pos > index) break;
    if (isRetain(c)) pos += c;
    else if (isInsert(c)) {
      if (pos < index || after) out += c.length;
    } else {
      const n = -(c as number);
      out -= Math.min(n, Math.max(0, index - pos));
      pos += n;
    }
  }
  return out;
}

// ---------- Diff por tokens ----------

const TOKEN_RE = /<[^>]*>|&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]/g;

/** Tokens atómicos del HTML-lite: tags, entidades y caracteres (los pares sustitutos juntos). */
export function tokens(s: string): string[] {
  return s.match(TOKEN_RE) ?? [];
}

type Edit = { k: 0 | 1 | -1; t: string };

/** Myers O((N+M)·D) sobre tokens; null si la distancia pasa de `maxD` (se reemplaza el tramo entero). */
function myers(a: string[], b: string[], maxD: number): Edit[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxD);
  const off = max + 1;
  const trace: Int32Array[] = [];
  let v = new Int32Array(2 * max + 3);
  for (let d = 0; d <= max; d++) {
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
      else x = v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[off + k] = x;
      if (x >= n && y >= m) {
        trace.push(next);
        return backtrack(trace, a, b, off);
      }
    }
    trace.push(next);
    v = next;
  }
  return null;
}

function backtrack(trace: Int32Array[], a: string[], b: string[], off: number): Edit[] {
  const out: Edit[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = d > 0 ? trace[d - 1] : null;
    const k = x - y;
    let prevK: number;
    if (!v) prevK = 0;
    else if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = v ? v[off + prevK] : 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push({ k: 0, t: a[x - 1] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) out.push({ k: 1, t: b[y - 1] });
      else out.push({ k: -1, t: a[x - 1] });
    }
    x = prevX;
    y = prevY;
  }
  // d = 0: lo que queda es igual.
  while (x > 0 && y > 0) {
    out.push({ k: 0, t: a[x - 1] });
    x--;
    y--;
  }
  return out.reverse();
}

/** Operación que lleva de `a` a `b`, por tokens (lo mínimo que cambió). */
export function diff(a: string, b: string, maxD = 600): TextOp {
  const out = new Builder();
  if (a === b) return out.retain(a.length).done();
  const ta = tokens(a);
  const tb = tokens(b);
  let p = 0;
  while (p < ta.length && p < tb.length && ta[p] === tb[p]) p++;
  let s = 0;
  while (s < ta.length - p && s < tb.length - p && ta[ta.length - 1 - s] === tb[tb.length - 1 - s]) s++;
  const prefix = ta.slice(0, p).join('');
  const suffix = ta.slice(ta.length - s).join('');
  const ma = ta.slice(p, ta.length - s);
  const mb = tb.slice(p, tb.length - s);
  out.retain(prefix.length);
  const edits = ma.length && mb.length ? myers(ma, mb, maxD) : null;
  if (edits) {
    for (const e of edits) {
      if (e.k === 0) out.retain(e.t.length);
      else if (e.k === 1) out.insert(e.t);
      else out.delete(e.t.length);
    }
  } else {
    out.insert(mb.join(''));
    out.delete(ma.join('').length);
  }
  out.retain(suffix.length);
  return out.done();
}

// ---------- Huella del texto ----------

/** Huella corta de un texto (FNV-1a de 32 bits + largo): identifica la versión que vio cada lado. */
export function textHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${s.length.toString(36)}.${h.toString(36)}`;
}

// ---------- Offsets de texto plano ↔ HTML ----------

const isTag = (t: string) => t[0] === '<' && t.length > 1;
/** Largo en texto plano de un token (una entidad es un carácter; un tag, ninguno). */
const flatLen = (t: string) => (isTag(t) ? 0 : t.length > 1 && t[0] === '&' ? 1 : t.length);

/** Índice en el HTML que corresponde a un offset de texto plano (los tags no cuentan). */
export function htmlIndexOf(html: string, textOffset: number): number {
  let flat = 0;
  let i = 0;
  for (const t of tokens(html)) {
    if (isTag(t)) {
      i += t.length;
      continue;
    }
    if (flat >= textOffset) return i;
    const len = flatLen(t);
    if (flat + len > textOffset) return i;
    flat += len;
    i += t.length;
  }
  return i;
}

/** Offset de texto plano de un índice del HTML. */
export function textOffsetOf(html: string, index: number): number {
  let flat = 0;
  let i = 0;
  for (const t of tokens(html)) {
    if (i >= index) break;
    i += t.length;
    flat += flatLen(t);
  }
  return flat;
}

/** Corre un offset de texto plano a través de una operación sobre el HTML. */
export function transformTextOffset(html: string, offset: number, op: TextOp, after = false): number {
  const next = apply(html, op);
  return textOffsetOf(next, transformIndex(htmlIndexOf(html, offset), op, after));
}
