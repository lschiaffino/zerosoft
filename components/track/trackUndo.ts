'use client';

/**
 * Deshacer de Track (⌘Z), como en Linear: cada cambio de propiedad, borrado
 * o movimiento deja una entrada; el toast "Deshacer" y ⌘Z deshacen la última.
 *
 * Los borrados se demoran: el issue desaparece de las listas al instante y el
 * DELETE se manda cuando vence el toast (o al cerrar la pestaña, con
 * keepalive). Deshacer antes de eso lo devuelve sin tocar el servidor.
 */

export interface UndoEntry {
  id: string;
  label: string;
  undo: () => void | Promise<void>;
  /** Vuelve a aplicar el cambio (⌘⇧Z después de deshacer). */
  redo?: () => void | Promise<void>;
  createdAt: number;
}

interface PendingDelete {
  ids: string[];
  commit: (keepalive?: boolean) => Promise<void>;
  timer: number;
}

const MAX_STACK = 30;
/** Cuánto vive el toast (y cuánto se demora un borrado). */
export const UNDO_WINDOW_MS = 8000;

let stack: UndoEntry[] = [];
/** Lo deshecho que se puede rehacer (se vacía con cada cambio nuevo). */
let redoStack: UndoEntry[] = [];
const pending = new Map<string, PendingDelete>();
const listeners = new Set<() => void>();
let counter = 0;

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeUndo(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function latestUndo(): UndoEntry | null {
  return stack[stack.length - 1] ?? null;
}

/** Registra una acción deshacible (y, si se puede, cómo rehacerla). Devuelve su id. */
export function pushUndo(label: string, undo: () => void | Promise<void>, redo?: () => void | Promise<void>): string {
  const id = `u${++counter}`;
  stack = [...stack.slice(-(MAX_STACK - 1)), { id, label, undo, redo, createdAt: Date.now() }];
  redoStack = [];
  emit();
  return id;
}

export function latestRedo(): UndoEntry | null {
  return redoStack[redoStack.length - 1] ?? null;
}

/** Rehace lo último que se deshizo (⌘⇧Z), como en Linear. */
export async function runRedo(): Promise<boolean> {
  const entry = redoStack[redoStack.length - 1];
  if (!entry?.redo) return false;
  redoStack = redoStack.slice(0, -1);
  await entry.redo();
  // Vuelve a quedar deshacible, sin vaciar lo que queda para rehacer.
  stack = [...stack.slice(-(MAX_STACK - 1)), { ...entry, id: `u${++counter}`, createdAt: Date.now() }];
  emit();
  return true;
}

/** Aviso corto sin deshacer ("ID copiado"): usa el mismo toast. */
let notice: UndoEntry | null = null;
export function pushNotice(label: string) {
  notice = { id: `n${++counter}`, label, undo: () => undefined, createdAt: Date.now() };
  emit();
}
export function latestNotice(): UndoEntry | null {
  return notice;
}

/** Deshace la última acción (o la indicada). */
export async function runUndo(id?: string): Promise<boolean> {
  const entry = id ? stack.find((e) => e.id === id) : stack[stack.length - 1];
  if (!entry) return false;
  stack = stack.filter((e) => e !== entry);
  if (entry.redo) redoStack = [...redoStack.slice(-(MAX_STACK - 1)), entry];
  emit();
  await entry.undo();
  return true;
}

/** Saca el toast sin deshacer (la entrada sigue para ⌘Z). */
export function dismissUndo(id: string) {
  const entry = stack.find((e) => e.id === id);
  if (entry) {
    entry.createdAt = 0;
    emit();
  }
}

/** Ids de issues con un borrado pendiente: las listas no los muestran. */
export function pendingDeleteIds(): Set<string> {
  const out = new Set<string>();
  pending.forEach((p) => p.ids.forEach((id) => out.add(id)));
  return out;
}

/**
 * Borrado con ventana para deshacer. `commit` manda el DELETE (con keepalive
 * si la pestaña se está cerrando); `restore` vuelve a mostrar los issues.
 */
export function scheduleDelete(opts: {
  ids: string[];
  label: string;
  commit: (keepalive?: boolean) => Promise<void>;
  restore: () => void;
}): void {
  const key = `d${++counter}`;
  const timer = window.setTimeout(() => {
    const p = pending.get(key);
    if (!p) return;
    pending.delete(key);
    void p.commit();
    emit();
  }, UNDO_WINDOW_MS);
  pending.set(key, { ids: opts.ids, commit: opts.commit, timer });
  pushUndo(opts.label, () => {
    const p = pending.get(key);
    if (!p) return;
    window.clearTimeout(p.timer);
    pending.delete(key);
    opts.restore();
    emit();
  });
}

/** Manda ya todos los borrados pendientes (al cerrar o recargar la pestaña). */
export function flushPendingDeletes(keepalive = true) {
  pending.forEach((p, key) => {
    window.clearTimeout(p.timer);
    pending.delete(key);
    void p.commit(keepalive);
  });
}

/** Solo para tests. */
export function resetUndoForTests() {
  stack = [];
  redoStack = [];
  pending.forEach((p) => window.clearTimeout(p.timer));
  pending.clear();
  emit();
}
