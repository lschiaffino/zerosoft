/**
 * Docs: fusión de tres vías del contenido de una página (puro, sin DOM).
 *
 * Es el único mecanismo de fusión de Docs y lo usan los dos lados:
 * - el servidor, al guardar sobre una versión vieja (PATCH con
 *   `base_updated_at`): `base` = la revisión que vio el editor
 *   (docs_page_revisions), `theirs` = lo guardado ahora (otra persona, otra
 *   pestaña, una automatización), `ours` = lo que llega;
 * - el editor, para sumar a lo que tiene en pantalla lo que cambió en el
 *   servidor (la respuesta fusionada de su propio guardado o el pulso en
 *   vivo con la versión de otra persona): `base` = la última versión del
 *   servidor que incorporó, `theirs` = la nueva, `ours` = la pantalla.
 *
 * Reglas (las mismas en los dos lados):
 * - listas con id (bloques, filas, propiedades, vistas): lo nuevo, lo
 *   borrado y lo movido de cada lado se respeta;
 * - el mismo bloque cambiado de los dos lados se fusiona por campo y su
 *   texto por tramos (cada uno editó otra parte de la frase: quedan los dos);
 * - una base se fusiona por propiedad, vista, fila y celda;
 * - si los dos tocaron el mismo tramo (o el mismo campo) gana `ours` y el id
 *   del bloque queda en `conflicts` (el servidor guarda antes una versión
 *   con lo otro, así no se pierde);
 * - un bloque borrado de un lado y editado del otro se queda (no se pierde
 *   lo escrito); una fila borrada se va aunque el otro la haya editado
 *   (como borrar una fila en Notion).
 */
import type { DbProperty, DbRow, DocsBlock, DocsDatabase } from './docs-types';
import { databasePatch, normalizeDatabase } from './docs-database';

/** JSON con claves ordenadas (dos objetos iguales con otro orden de claves comparan igual). */
function stable(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}

const eq = (a: unknown, b: unknown) => a === b || stable(a) === stable(b);

/** Dónde se anotan los choques (ids de bloque). */
type Sink = { conflicts: Set<string>; id: string };

function pick<T>(base: T, theirs: T, ours: T, sink?: Sink): T {
  if (eq(ours, base)) return theirs;
  if (eq(theirs, base) || eq(theirs, ours)) return ours;
  sink?.conflicts.add(sink.id);
  return ours;
}

// ---------- Texto ----------

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
 * Fusión de tres vías de un texto (HTML-lite o plano). `conflict` = los dos
 * tocaron el mismo tramo y quedó `ours`.
 */
export function mergeText(base: string, theirs: string, ours: string): { text: string; conflict: boolean } {
  if (ours === theirs) return { text: ours, conflict: false };
  if (ours === base) return { text: theirs, conflict: false };
  if (theirs === base) return { text: ours, conflict: false };
  const o = editRegion(base, ours);
  const t = editRegion(base, theirs);
  const disjoint = o.end <= t.start || t.end <= o.start;
  const bothInsertAt = o.start === o.end && t.start === t.end && o.start === t.start;
  if (!disjoint && !bothInsertAt) return { text: ours, conflict: true };
  if (bothInsertAt) {
    // Las dos escribieron en el mismo punto: lo de ellos primero (ya estaba guardado).
    return { text: base.slice(0, o.start) + t.text + o.text + base.slice(o.end), conflict: false };
  }
  // En orden; si empiezan en el mismo punto, primero la inserción (tramo vacío).
  const oFirst = o.start < t.start || (o.start === t.start && o.end === o.start);
  const [first, second] = oFirst ? [o, t] : [t, o];
  const text = base.slice(0, first.start) + first.text + base.slice(first.end, second.start) + second.text + base.slice(second.end);
  return { text, conflict: false };
}

// ---------- Listas con id ----------

/** Para cada id de `list`, el anterior que también está en `keep` (ignora nuevos y borrados). */
function prevKept<T extends { id: string }>(list: T[], keep: Set<string>): Map<string, string | null> {
  const out = new Map<string, string | null>();
  let prev: string | null = null;
  for (const x of list) {
    out.set(x.id, prev);
    if (keep.has(x.id)) prev = x.id;
  }
  return out;
}

/**
 * Listas con id (bloques, filas, propiedades, vistas). Orden: el de `theirs`
 * con lo que movió o agregó `ours` en su lugar (detrás de su anterior en
 * `ours`). Lo borrado de un lado que el otro no tocó se va; lo borrado de un
 * lado y editado del otro lo decide `onDeleteEdited` (null = se va).
 */
function mergeList<T extends { id: string }>(
  base: T[],
  theirs: T[],
  ours: T[],
  item: (b: T, t: T, o: T) => T,
  onDeleteEdited: (kept: T, side: 'ours' | 'theirs') => T | null,
  keyOf: (x: T) => string = stable,
): T[] {
  const bm = new Map(base.map((x) => [x.id, x]));
  const tm = new Map(theirs.map((x) => [x.id, x]));
  const om = new Map(ours.map((x) => [x.id, x]));
  const same = (a: T, b: T) => a === b || keyOf(a) === keyOf(b);
  // Referencias para detectar movimientos: lo que sigue en las tres versiones.
  const inAll = new Set([...bm.keys()].filter((id) => tm.has(id) && om.has(id)));
  const prevB = prevKept(base, inAll);
  const prevT = prevKept(theirs, inAll);
  const prevO = prevKept(ours, inAll);

  const resolve = (id: string): T | null => {
    const b = bm.get(id);
    const t = tm.get(id);
    const o = om.get(id);
    if (!b) return o ?? t ?? null;
    if (!o && !t) return null;
    if (!o) return t && !same(t, b) ? onDeleteEdited(t, 'theirs') : null;
    if (!t) return !same(o, b) ? onDeleteEdited(o, 'ours') : null;
    return item(b, t, o);
  };

  const out: T[] = [];
  const placed = new Set<string>();
  for (const t of theirs) {
    if (inAll.has(t.id)) {
      const movedByUs = prevO.get(t.id) !== prevB.get(t.id);
      const movedByThem = prevT.get(t.id) !== prevB.get(t.id);
      // Lo movió `ours` (y `theirs` no): va después, en el orden de `ours`.
      if (movedByUs && !movedByThem) continue;
    } else if (om.has(t.id) && !bm.has(t.id)) {
      // Nuevo con el mismo id de los dos lados: va en el orden de `ours`.
      continue;
    }
    const x = resolve(t.id);
    if (x) {
      out.push(x);
      placed.add(t.id);
    }
  }
  let index: Map<string, number> | null = null;
  for (let i = 0; i < ours.length; i++) {
    const id = ours[i].id;
    if (placed.has(id)) continue;
    const x = resolve(id);
    if (!x) continue;
    let at = 0;
    if (!index) index = new Map(out.map((y, k) => [y.id, k]));
    for (let j = i - 1; j >= 0; j--) {
      const k = index.get(ours[j].id);
      if (k !== undefined) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, x);
    placed.add(id);
    index = null;
  }
  return out;
}

// ---------- Bases ----------

function mergeRecord<V>(
  base: Record<string, V> | undefined,
  theirs: Record<string, V> | undefined,
  ours: Record<string, V> | undefined,
): Record<string, V> {
  const b = base ?? {};
  const t = theirs ?? {};
  const o = ours ?? {};
  const out: Record<string, V> = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(t), ...Object.keys(o)])) {
    // Dentro de una fila el último en guardar gana la celda (como Notion).
    const v = pick<V | undefined>(b[k], t[k], o[k]);
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

const rowKey = (r: DbRow) => {
  const { created_by: _c, updated_by: _u, updated_at: _a, ...rest } = r;
  void _c;
  void _u;
  void _a;
  return stable(rest);
};

function mergeRow(b: DbRow, t: DbRow, o: DbRow): DbRow {
  if (rowKey(o) === rowKey(b)) return t;
  if (rowKey(t) === rowKey(b) || rowKey(t) === rowKey(o)) return o;
  const files = mergeRecord(b.files, t.files, o.files);
  const out: DbRow = {
    ...o,
    values: mergeRecord(b.values, t.values, o.values),
    updated_at: t.updated_at > o.updated_at ? t.updated_at : o.updated_at,
  };
  // El cuerpo de la fila (su página) se fusiona como una página.
  const body = mergeBlocksDetailed(b.body ?? [], t.body ?? [], o.body ?? []).blocks;
  if (body.length) out.body = body;
  else delete out.body;
  if (Object.keys(files).length) out.files = files;
  else delete out.files;
  return out;
}

function mergeProperty(b: DbProperty, t: DbProperty, o: DbProperty): DbProperty {
  // El contador de ID único sube de los dos lados: queda el mayor.
  const strip = (p: DbProperty) => ({ ...p, next_id: undefined });
  const merged = pick(strip(b), strip(t), strip(o)) as DbProperty;
  const next = Math.max(t.next_id ?? 0, o.next_id ?? 0);
  const out: DbProperty = { ...merged };
  delete out.next_id;
  if (next > 0) out.next_id = next;
  return out;
}

/** Fusiona una base: propiedades, vistas, plantillas y filas por id; el resto por campo. */
export function mergeDatabase(base: DocsDatabase, theirs: DocsDatabase, ours: DocsDatabase): DocsDatabase {
  const keep = <T,>(x: T) => x;
  const out: DocsDatabase = {
    ...ours,
    properties: mergeList(base.properties, theirs.properties, ours.properties, mergeProperty, keep),
    views: mergeList(base.views, theirs.views, ours.views, (b, t, o) => pick(b, t, o), keep),
    // Una fila borrada de un lado se va aunque el otro la haya editado (como borrar en Notion).
    rows: mergeList(base.rows, theirs.rows, ours.rows, mergeRow, () => null, rowKey),
  };
  const templates = mergeList(base.templates ?? [], theirs.templates ?? [], ours.templates ?? [], (b, t, o) => pick(b, t, o), keep);
  if (templates.length) out.templates = templates;
  else delete out.templates;
  for (const k of ['title', 'active_view', 'automations'] as const) {
    const v = pick(base[k], theirs[k], ours[k]);
    if (v === undefined) delete out[k];
    else (out as unknown as Record<string, unknown>)[k] = v;
  }
  // La vista abierta tiene que existir.
  if (out.active_view && !out.views.some((v) => v.id === out.active_view)) delete out.active_view;
  return out;
}

// ---------- Bloques ----------

const TEXT_KEYS = new Set(['content', 'caption']);
const isOwnDatabase = (b: DocsBlock | undefined) => !!b && b.type === 'database' && !b.linked;

function mergeBlock(b: DocsBlock, t: DocsBlock, o: DocsBlock, conflicts: Set<string>): DocsBlock {
  if (eq(o, b)) return t;
  if (eq(t, b) || eq(t, o)) return o;
  const sink: Sink = { conflicts, id: o.id };
  const ownDb = isOwnDatabase(b) && isOwnDatabase(t) && isOwnDatabase(o);
  const rb = b as unknown as Record<string, unknown>;
  const rt = t as unknown as Record<string, unknown>;
  const ro = o as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { id: o.id };
  for (const k of new Set([...Object.keys(rb), ...Object.keys(rt), ...Object.keys(ro)])) {
    if (k === 'id') continue;
    // La base va aparte (por fila y celda); el formato viejo lo suelta databasePatch.
    if (ownDb && (k === 'db' || k === 'columns' || k === 'rows' || k === 'view')) continue;
    const vb = rb[k];
    const vt = rt[k];
    const vo = ro[k];
    if (TEXT_KEYS.has(k) && (typeof vb === 'string' || vb === undefined) && (typeof vt === 'string' || vt === undefined) && (typeof vo === 'string' || vo === undefined)) {
      const res = mergeText(vb ?? '', vt ?? '', vo ?? '');
      if (res.conflict) conflicts.add(o.id);
      if (res.text !== '' || vo !== undefined || vt !== undefined) out[k] = res.text;
      continue;
    }
    const v = pick(vb, vt, vo, sink);
    if (v !== undefined) out[k] = v;
  }
  if (ownDb) {
    const db = mergeDatabase(normalizeDatabase(b), normalizeDatabase(t), normalizeDatabase(o));
    Object.assign(out, databasePatch(db));
    for (const k of ['columns', 'rows', 'view']) if (out[k] === undefined) delete out[k];
  }
  return out as unknown as DocsBlock;
}

export interface BlocksMergeResult {
  blocks: DocsBlock[];
  /** Bloques donde los dos tocaron el mismo tramo o campo (quedó `ours`). */
  conflicts: string[];
}

/** Fusión de tres vías de los bloques de una página (ver arriba); en los choques queda `ours`. */
export function mergeBlocksDetailed(base: DocsBlock[], theirs: DocsBlock[], ours: DocsBlock[]): BlocksMergeResult {
  if (eq(ours, theirs) || eq(theirs, base)) return { blocks: ours, conflicts: [] };
  if (eq(ours, base)) return { blocks: theirs, conflicts: [] };
  const conflicts = new Set<string>();
  const blocks = mergeList(
    base,
    theirs,
    ours,
    (b, t, o) => mergeBlock(b, t, o, conflicts),
    (kept) => {
      // Borrado de un lado y editado del otro: se queda lo escrito.
      conflicts.add(kept.id);
      return kept;
    },
  );
  return { blocks, conflicts: [...conflicts] };
}

/**
 * Bloques fusionados. Con `prefer` 'conflict' devuelve null si hubo un
 * choque (los dos tocaron el mismo tramo, o uno borró lo que el otro
 * editó); con 'ours' (lo que usan el servidor y el editor) queda `ours`.
 */
export function mergeBlocks(
  base: DocsBlock[],
  theirs: DocsBlock[],
  ours: DocsBlock[],
  prefer: 'ours' | 'conflict' = 'conflict',
): DocsBlock[] | null {
  const res = mergeBlocksDetailed(base, theirs, ours);
  return prefer === 'conflict' && res.conflicts.length ? null : res.blocks;
}

/**
 * Un campo simple de la página. El título se fusiona como texto (por
 * tramos); ícono y portada, enteros. null solo con `prefer` 'conflict' y choque.
 */
export function mergeField<T>(base: T, theirs: T, ours: T, prefer: 'ours' | 'conflict' = 'conflict'): { value: T } | null {
  if (typeof base === 'string' && typeof theirs === 'string' && typeof ours === 'string') {
    const res = mergeText(base, theirs, ours);
    if (res.conflict && prefer === 'conflict') return null;
    return { value: res.text as T };
  }
  const sink: Sink = { conflicts: new Set(), id: 'field' };
  const value = pick(base, theirs, ours, sink);
  if (sink.conflicts.size && prefer === 'conflict') return null;
  return { value };
}

/** Título: mismo criterio que el texto de un bloque. */
export function mergeTitle(base: string, theirs: string, ours: string): string {
  return mergeText(base, theirs, ours).text;
}

export const sameContent = (a: unknown, b: unknown) => eq(a, b);
