/**
 * Lógica pura de la UI de Notes (sin React), testeada en tests/unit/notes-ui.test.ts.
 */

export type NotesFilter =
  | { kind: 'all' }
  /** Inicio con widgets. */
  | { kind: 'home' }
  /** Tareas de todas las notas, por vencimiento. */
  | { kind: 'tasks' }
  | { kind: 'pinned' }
  | { kind: 'trash' }
  /** Notas de compañeros compartidas conmigo (directas o por libreta). */
  | { kind: 'shared' }
  | { kind: 'notebook'; id: string }
  /** Pila de libretas: las notas de todas sus libretas. */
  | { kind: 'stack'; stack: string }
  | { kind: 'tag'; tag: string };

/** Query string de /api/notes para un filtro, una búsqueda y un orden. */
export function filterQuery(f: NotesFilter, q: string, sort: string): string {
  const sp = new URLSearchParams();
  if (f.kind === 'pinned' || f.kind === 'trash' || f.kind === 'shared') sp.set('view', f.kind);
  if (f.kind === 'notebook') sp.set('notebook', f.id);
  if (f.kind === 'stack') sp.set('stack', f.stack);
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
  if (a.kind === 'stack' && b.kind === 'stack') return a.stack === b.stack;
  return true;
}

/** Qué estado vacío corresponde a la lista. */
export type EmptyKind = 'search' | 'trash' | 'pinned' | 'shared' | 'notebook' | 'all';

export function emptyKind(f: NotesFilter, q: string): EmptyKind {
  if (q.trim()) return 'search';
  if (f.kind === 'trash') return 'trash';
  if (f.kind === 'pinned') return 'pinned';
  if (f.kind === 'shared') return 'shared';
  if (f.kind === 'notebook' || f.kind === 'stack') return 'notebook';
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

/** Date → valor de <input type="datetime-local"> en la hora local ("2026-03-04T09:00"). */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type ReminderPresetKey = 'laterToday' | 'tomorrow' | 'nextWeek';

/**
 * Atajos del recordatorio, en hora local: en 3 horas (en punto, solo si
 * sigue siendo hoy), mañana a las 9:00 y el lunes que viene a las 9:00.
 */
export function reminderPresets(now: Date): Array<{ key: ReminderPresetKey; at: Date }> {
  const out: Array<{ key: ReminderPresetKey; at: Date }> = [];
  const later = new Date(now);
  later.setHours(later.getHours() + 3, 0, 0, 0);
  if (later.getDate() === now.getDate()) out.push({ key: 'laterToday', at: later });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  out.push({ key: 'tomorrow', at: tomorrow });
  const monday = new Date(now);
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
  monday.setHours(9, 0, 0, 0);
  out.push({ key: 'nextWeek', at: monday });
  return out;
}

/** Operadores de la ayuda de búsqueda (sintaxis y descripción en messages: notes.searchHelp.items.<key>). */
export const SEARCH_OPERATORS = ['tag', 'notTag', 'notebook', 'intitle', 'created', 'updated', 'todo'] as const;

/** Libretas agrupadas por pila (como Evernote): primero las sueltas, después cada pila por nombre. */
export function groupNotebooks<T extends { name: string; stack?: string | null }>(notebooks: T[]): { loose: T[]; stacks: Array<{ stack: string; notebooks: T[] }> } {
  const loose: T[] = [];
  const map = new Map<string, T[]>();
  for (const nb of notebooks) {
    if (!nb.stack) loose.push(nb);
    else map.set(nb.stack, [...(map.get(nb.stack) ?? []), nb]);
  }
  const stacks = [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([stack, list]) => ({ stack, notebooks: list }));
  return { loose, stacks };
}

/**
 * Selección en la lista (como Finder): clic con ⌘/Ctrl suma o saca una,
 * Shift suma el rango desde la última elegida.
 */
export function nextSelection(
  current: readonly string[],
  ids: readonly string[],
  id: string,
  mode: 'toggle' | 'range',
  anchor: string | null,
): string[] {
  if (mode === 'range' && anchor && ids.includes(anchor)) {
    const a = ids.indexOf(anchor);
    const b = ids.indexOf(id);
    const [from, to] = a < b ? [a, b] : [b, a];
    const range = ids.slice(from, to + 1);
    return [...new Set([...current, ...range])];
  }
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
}

/** Términos a resaltar en la nota abierta desde una búsqueda (sin operadores). */
export function highlightTerms(q: string): string[] {
  return q
    .replace(/-?[a-z]+:("[^"]*"|\S+)/gi, ' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
    .slice(0, 8);
}
