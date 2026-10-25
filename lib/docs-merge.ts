/**
 * Fusión de tres vías del contenido de una página (puro): `base` es la
 * versión sobre la que editó quien guarda, `theirs` lo que hay guardado
 * ahora (otra pestaña, otra persona, una automatización o una operación del
 * servidor) y `ours` lo que llega. Se fusiona por bloque y, dentro de una
 * base, por propiedad, vista y fila (y por celda dentro de una fila), así
 * una fila que agregó el servidor no se pierde porque esta pestaña editó otra.
 *
 * Lo usan el servidor al guardar con una base vieja (sin conflicto si lo de
 * los dos lados no choca) y el editor para sumar a lo que tiene en pantalla
 * lo que el servidor fusionó.
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

const eq = (a: unknown, b: unknown) => stable(a) === stable(b);

/** Ganador de un valor cambiado de los dos lados: `ours` (el editor) o conflicto (null). */
type Prefer = 'ours' | 'conflict';

class MergeConflict extends Error {}

function pick<T>(base: T, theirs: T, ours: T, prefer: Prefer): T {
  if (eq(ours, base)) return theirs;
  if (eq(theirs, base) || eq(theirs, ours)) return ours;
  if (prefer === 'conflict') throw new MergeConflict();
  return ours;
}

/**
 * Listas con id (bloques, filas, propiedades, vistas): el orden sale de
 * `ours`; lo que agregó `theirs` entra detrás de su vecino anterior; lo que
 * borró uno de los dos lados y el otro no tocó se va.
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
  const same = (a: T, b: T) => keyOf(a) === keyOf(b);
  const out: T[] = [];
  for (const o of ours) {
    const b = bm.get(o.id);
    const t = tm.get(o.id);
    if (!b) {
      out.push(o);
      continue;
    }
    if (!t) {
      // Lo borró el otro lado: si acá no se tocó, se va.
      if (same(o, b)) continue;
      const kept = onDeleteEdited(o, 'ours');
      if (kept) out.push(kept);
      continue;
    }
    out.push(item(b, t, o));
  }
  // Borrado acá y editado del otro lado.
  for (const b of base) {
    if (om.has(b.id)) continue;
    const t = tm.get(b.id);
    if (!t || same(t, b)) continue;
    const kept = onDeleteEdited(t, 'theirs');
    if (kept) insertAfterNeighbor(out, theirs, kept);
  }
  // Agregado del otro lado.
  for (const t of theirs) {
    if (bm.has(t.id) || om.has(t.id)) continue;
    insertAfterNeighbor(out, theirs, t);
  }
  return out;
}

function insertAfterNeighbor<T extends { id: string }>(out: T[], order: T[], item: T) {
  if (out.some((x) => x.id === item.id)) return;
  const at = order.findIndex((x) => x.id === item.id);
  for (let i = at - 1; i >= 0; i--) {
    const j = out.findIndex((x) => x.id === order[i].id);
    if (j !== -1) {
      out.splice(j + 1, 0, item);
      return;
    }
  }
  out.unshift(item);
}

function mergeRecord<V>(base: Record<string, V> | undefined, theirs: Record<string, V> | undefined, ours: Record<string, V> | undefined): Record<string, V> {
  const b = base ?? {};
  const t = theirs ?? {};
  const o = ours ?? {};
  const out: Record<string, V> = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(t), ...Object.keys(o)])) {
    // Dentro de una fila el último en guardar gana la celda (como Notion).
    const v = pick<V | undefined>(b[k], t[k], o[k], 'ours');
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
  const body = pick(b.body, t.body, o.body, 'ours');
  if (body?.length) out.body = body;
  else delete out.body;
  if (Object.keys(files).length) out.files = files;
  else delete out.files;
  return out;
}

function mergeProperty(b: DbProperty, t: DbProperty, o: DbProperty): DbProperty {
  // El contador de ID único sube de los dos lados: queda el mayor.
  const strip = (p: DbProperty) => ({ ...p, next_id: undefined });
  const merged = pick(strip(b), strip(t), strip(o), 'ours') as DbProperty;
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
    views: mergeList(base.views, theirs.views, ours.views, (b, t, o) => pick(b, t, o, 'ours'), keep),
    // Una fila borrada de un lado se va aunque el otro la haya editado (como borrar en Notion).
    rows: mergeList(base.rows, theirs.rows, ours.rows, mergeRow, () => null, rowKey),
  };
  const templates = mergeList(base.templates ?? [], theirs.templates ?? [], ours.templates ?? [], (b, t, o) => pick(b, t, o, 'ours'), keep);
  if (templates.length) out.templates = templates;
  else delete out.templates;
  for (const k of ['title', 'active_view', 'automations'] as const) {
    const v = pick(base[k], theirs[k], ours[k], 'ours');
    if (v === undefined) delete out[k];
    else (out as unknown as Record<string, unknown>)[k] = v;
  }
  // La vista abierta tiene que existir.
  if (out.active_view && !out.views.some((v) => v.id === out.active_view)) delete out.active_view;
  return out;
}

const isOwnDatabase = (b: DocsBlock | undefined) => !!b && b.type === 'database' && !b.linked;

function mergeBlock(b: DocsBlock, t: DocsBlock, o: DocsBlock, prefer: Prefer): DocsBlock {
  if (eq(o, b)) return t;
  if (eq(t, b) || eq(t, o)) return o;
  if (isOwnDatabase(b) && isOwnDatabase(t) && isOwnDatabase(o)) {
    const db = mergeDatabase(normalizeDatabase(b), normalizeDatabase(t), normalizeDatabase(o));
    return { ...o, ...databasePatch(db) };
  }
  if (prefer === 'conflict') throw new MergeConflict();
  return o;
}

/**
 * Bloques fusionados, o null si los dos lados cambiaron distinto el mismo
 * bloque de texto (o uno borró lo que el otro editó) y `prefer` es
 * 'conflict'. Con 'ours' gana lo de `ours` en esos choques (el editor, o
 * "Sobrescribir"), pero las bases igual se fusionan por fila.
 */
export function mergeBlocks(base: DocsBlock[], theirs: DocsBlock[], ours: DocsBlock[], prefer: Prefer = 'conflict'): DocsBlock[] | null {
  try {
    return mergeList(
      base,
      theirs,
      ours,
      (b, t, o) => mergeBlock(b, t, o, prefer),
      (kept, side) => {
        if (prefer === 'conflict') throw new MergeConflict();
        // Con 'ours': lo borrado acá queda borrado; lo editado acá que el otro borró, queda.
        return side === 'ours' ? kept : null;
      },
    );
  } catch (err) {
    if (err instanceof MergeConflict) return null;
    throw err;
  }
}

/** Un campo simple de la página (título, ícono, portada): null si chocan y `prefer` es 'conflict'. */
export function mergeField<T>(base: T, theirs: T, ours: T, prefer: Prefer = 'conflict'): { value: T } | null {
  try {
    return { value: pick(base, theirs, ours, prefer) };
  } catch (err) {
    if (err instanceof MergeConflict) return null;
    throw err;
  }
}

export const sameContent = (a: unknown, b: unknown) => eq(a, b);
