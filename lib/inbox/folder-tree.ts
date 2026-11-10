/**
 * Inbox: árbol de carpetas (sin base, lo usan el servidor y la pantalla).
 * Las carpetas son una lista plana con parentId y position; acá se arma el
 * orden de lectura (padres antes que hijos), la profundidad, los
 * descendientes, los no leídos que suben a los padres y los movimientos
 * válidos (ni dentro de sí misma, ni más hondo que MAX_FOLDER_DEPTH).
 */

/** Niveles de subcarpetas debajo de una carpeta de primer nivel (0 = primer nivel). */
export const MAX_FOLDER_DEPTH = 3;

export interface TreeFolder {
  id: string;
  parentId: string | null;
  position: number;
}

export interface TreeRow<F extends TreeFolder> {
  folder: F;
  depth: number;
  hasChildren: boolean;
}

function byPosition<F extends TreeFolder>(a: F, b: F): number {
  return a.position - b.position || a.id.localeCompare(b.id);
}

/** Hijos de cada carpeta (las huérfanas, cuyo padre no existe, van al primer nivel). */
export function childrenMap<F extends TreeFolder>(folders: F[]): Map<string | null, F[]> {
  const ids = new Set(folders.map((f) => f.id));
  const map = new Map<string | null, F[]>();
  for (const f of folders) {
    const p = f.parentId && ids.has(f.parentId) && f.parentId !== f.id ? f.parentId : null;
    map.set(p, [...(map.get(p) ?? []), f]);
  }
  for (const list of map.values()) list.sort(byPosition);
  return map;
}

/**
 * Orden de lectura: cada carpeta seguida de sus subcarpetas. Las de `collapsed`
 * muestran su fila pero no la de sus hijos. Un ciclo (dato roto) no cuelga:
 * cada carpeta sale una sola vez.
 */
export function flattenTree<F extends TreeFolder>(folders: F[], collapsed: ReadonlySet<string> = new Set()): TreeRow<F>[] {
  const kids = childrenMap(folders);
  const out: TreeRow<F>[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const f of kids.get(parent) ?? []) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const hasChildren = (kids.get(f.id) ?? []).length > 0;
      out.push({ folder: f, depth, hasChildren });
      if (!collapsed.has(f.id)) walk(f.id, depth + 1);
      else for (const d of descendantIds(folders, f.id)) seen.add(d);
    }
  };
  walk(null, 0);
  // Lo que quedó afuera por un ciclo, al final y en primer nivel.
  for (const f of folders) if (!seen.has(f.id)) out.push({ folder: f, depth: 0, hasChildren: false });
  return out;
}

/** Ids de todas las subcarpetas (hijos, nietos...), sin la carpeta. */
export function descendantIds<F extends TreeFolder>(folders: F[], id: string): string[] {
  const kids = childrenMap(folders);
  const out: string[] = [];
  const stack = [...(kids.get(id) ?? [])];
  const seen = new Set([id]);
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f.id);
    stack.push(...(kids.get(f.id) ?? []));
  }
  return out;
}

/** Profundidad (0 = primer nivel). */
export function depthOf<F extends TreeFolder>(folders: F[], id: string): number {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let d = 0;
  let p = byId.get(id)?.parentId ?? null;
  const seen = new Set([id]);
  while (p && byId.has(p) && !seen.has(p)) {
    seen.add(p);
    d++;
    p = byId.get(p)!.parentId;
  }
  return d;
}

/** Cuántos niveles tiene la rama de una carpeta debajo de ella (0 = sin hijos). */
export function subtreeHeight<F extends TreeFolder>(folders: F[], id: string): number {
  const kids = childrenMap(folders);
  const h = (fid: string, seen: Set<string>): number => {
    let best = 0;
    for (const c of kids.get(fid) ?? []) {
      if (seen.has(c.id)) continue;
      best = Math.max(best, 1 + h(c.id, new Set([...seen, c.id])));
    }
    return best;
  };
  return h(id, new Set([id]));
}

export type MoveCheck = 'ok' | 'invalid_parent' | 'too_deep';

/** ¿Se puede poner `id` dentro de `parentId`? (null = primer nivel). */
export function canMoveFolder<F extends TreeFolder>(folders: F[], id: string, parentId: string | null): MoveCheck {
  if (parentId === null) return 'ok';
  if (parentId === id || descendantIds(folders, id).includes(parentId)) return 'invalid_parent';
  if (!folders.some((f) => f.id === parentId)) return 'invalid_parent';
  if (depthOf(folders, parentId) + 1 + subtreeHeight(folders, id) > MAX_FOLDER_DEPTH) return 'too_deep';
  return 'ok';
}

/**
 * Posiciones nuevas de los hermanos después de mover `id` a `parentId`,
 * antes de `beforeId` (null = al final). Devuelve [id, position] de todos los
 * hermanos del destino, en orden.
 */
export function siblingOrder<F extends TreeFolder>(folders: F[], id: string, parentId: string | null, beforeId: string | null): Array<[string, number]> {
  const siblings = (childrenMap(folders).get(parentId) ?? []).filter((f) => f.id !== id).map((f) => f.id);
  const at = beforeId ? siblings.indexOf(beforeId) : -1;
  if (at >= 0) siblings.splice(at, 0, id);
  else siblings.push(id);
  return siblings.map((sid, i) => [sid, i]);
}

/**
 * No leídos que suben: cada carpeta cuenta los chats sin leer suyos y de todas
 * sus subcarpetas, sin contar dos veces un chat que está en varias.
 */
export function rollupUnread<F extends TreeFolder>(folders: F[], own: ReadonlyMap<string, ReadonlySet<string>>): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of folders) {
    const all = new Set(own.get(f.id) ?? []);
    for (const d of descendantIds(folders, f.id)) for (const t of own.get(d) ?? []) all.add(t);
    out.set(f.id, all.size);
  }
  return out;
}
