/**
 * Lógica pura de la UI de Notes (sin React), testeada en tests/unit/notes-ui.test.ts.
 */

export type NotesFilter =
  | { kind: 'all' }
  | { kind: 'pinned' }
  | { kind: 'trash' }
  | { kind: 'notebook'; id: string }
  | { kind: 'tag'; tag: string };

/** Query string de /api/notes para un filtro, una búsqueda y un orden. */
export function filterQuery(f: NotesFilter, q: string, sort: string): string {
  const sp = new URLSearchParams();
  if (f.kind === 'pinned' || f.kind === 'trash') sp.set('view', f.kind);
  if (f.kind === 'notebook') sp.set('notebook', f.id);
  if (f.kind === 'tag') sp.set('tag', f.tag);
  if (q.trim()) sp.set('q', q.trim());
  sp.set('sort', sort);
  return sp.toString();
}

/**
 * Clave de "qué lista se está mirando" sin la búsqueda: si cambia, la lista
 * visible es de otro filtro y se muestra el esqueleto en vez de datos viejos.
 * Mientras se tipea una búsqueda la lista anterior queda (sin parpadeo).
 */
export function listKey(f: NotesFilter, sort: string): string {
  return filterQuery(f, '', sort);
}

export function sameFilter(a: NotesFilter, b: NotesFilter): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'notebook' && b.kind === 'notebook') return a.id === b.id;
  if (a.kind === 'tag' && b.kind === 'tag') return a.tag === b.tag;
  return true;
}

/** Qué estado vacío corresponde a la lista. */
export type EmptyKind = 'search' | 'trash' | 'pinned' | 'notebook' | 'all';

export function emptyKind(f: NotesFilter, q: string): EmptyKind {
  if (q.trim()) return 'search';
  if (f.kind === 'trash') return 'trash';
  if (f.kind === 'pinned') return 'pinned';
  if (f.kind === 'notebook') return 'notebook';
  return 'all';
}

/**
 * Navegación con flechas en la lista: índice siguiente acotado a la lista
 * (no da la vuelta, como en Apple Notes). `current` -1 = nada enfocado.
 */
export function stepIndex(current: number, key: string, length: number): number | null {
  if (length === 0) return null;
  if (key === 'ArrowDown') return current < 0 ? 0 : Math.min(current + 1, length - 1);
  if (key === 'ArrowUp') return current < 0 ? length - 1 : Math.max(current - 1, 0);
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
