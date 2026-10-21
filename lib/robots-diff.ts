/**
 * Robots — cambios de la salida entre dos corridas (puro). Lo usa
 * lib/robots.ts para emitir robot.output.changed con el diff.
 *
 * Compara variable por variable. Las listas de filas (extract_list,
 * extract_table, extract "all") se comparan por fila: qué filas aparecieron y
 * cuáles ya no están, sin importar el orden. Los archivos (download / pdf) se
 * comparan por nombre y tamaño: la URL cambia en cada corrida.
 */

/** Filas que se listan por variable en el diff (el total va aparte). */
export const MAX_DIFF_ROWS = 50;

export type RobotOutputChange =
  | { key: string; kind: 'added'; after: unknown }
  | { key: string; kind: 'removed'; before: unknown }
  | { key: string; kind: 'changed'; before: unknown; after: unknown }
  | {
      key: string;
      kind: 'rows';
      added: unknown[];
      removed: unknown[];
      addedCount: number;
      removedCount: number;
      before: number;
      after: number;
    };

export interface RobotOutputDiff {
  changed: boolean;
  changes: RobotOutputChange[];
}

/** Archivo guardado ({ url, filename, size }): sin la URL, que cambia siempre. */
function comparable(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.filename === 'string' && 'size' in o && ('url' in o || 'contentType' in o)) {
      return { filename: o.filename, size: o.size };
    }
  }
  return v;
}

/** JSON estable (claves ordenadas) para comparar filas y valores. */
export function stableJson(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`;
}

/** Filas de `a` que no están en `b` (como multiconjunto: los duplicados cuentan). */
function minus(a: unknown[], b: unknown[]): unknown[] {
  const counts = new Map<string, number>();
  for (const x of b) {
    const k = stableJson(x);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: unknown[] = [];
  for (const x of a) {
    const k = stableJson(x);
    const n = counts.get(k) ?? 0;
    if (n > 0) counts.set(k, n - 1);
    else out.push(x);
  }
  return out;
}

export function diffRobotOutputs(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): RobotOutputDiff {
  const prev = previous ?? {};
  const cur = next ?? {};
  const changes: RobotOutputChange[] = [];
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(cur)])].sort();
  for (const key of keys) {
    const has = Object.prototype.hasOwnProperty;
    const inPrev = has.call(prev, key);
    const inCur = has.call(cur, key);
    if (!inPrev) {
      changes.push({ key, kind: 'added', after: cur[key] });
      continue;
    }
    if (!inCur) {
      changes.push({ key, kind: 'removed', before: prev[key] });
      continue;
    }
    const a = comparable(prev[key]);
    const b = comparable(cur[key]);
    if (stableJson(a) === stableJson(b)) continue;
    if (Array.isArray(a) && Array.isArray(b)) {
      const added = minus(b, a);
      const removed = minus(a, b);
      // Mismas filas en otro orden: no es un cambio de datos.
      if (!added.length && !removed.length) continue;
      changes.push({
        key,
        kind: 'rows',
        added: added.slice(0, MAX_DIFF_ROWS),
        removed: removed.slice(0, MAX_DIFF_ROWS),
        addedCount: added.length,
        removedCount: removed.length,
        before: a.length,
        after: b.length,
      });
      continue;
    }
    changes.push({ key, kind: 'changed', before: prev[key], after: cur[key] });
  }
  return { changed: changes.length > 0, changes };
}
