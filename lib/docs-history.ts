/**
 * Deshacer / rehacer del editor de bloques (Docs y Notes), como en Notion.
 *
 * El undo nativo del contentEditable no sirve: el editor reescribe el DOM de
 * los bloques por fuera del tipeo (split, merge, conversión, borrado) y la
 * pila del navegador, que es una sola para todo el documento, termina
 * deshaciendo pasos sobre bloques que ya no existen o vaciando otros. Acá el
 * historial es una pila de fotos del documento entero (título + bloques):
 *
 * - Un cambio de estructura (borrar, mover, duplicar, anidar, pegar, importar,
 *   cambiar el tipo, partir con Enter) es un paso propio.
 * - El tipeo en un mismo bloque (o en el título) se agrupa: las teclas que
 *   llegan con menos de DOCS_HISTORY_GROUP_MS entre sí son un solo paso.
 * - Deshacer guarda la foto actual en "rehacer"; cualquier cambio nuevo vacía
 *   "rehacer".
 *
 * Todo es puro (sin DOM ni React) para poder testearlo.
 */
import type { DocsBlock } from './docs-types';

export interface DocsSnapshot {
  title: string;
  blocks: DocsBlock[];
}

export interface DocsHistory {
  past: DocsSnapshot[];
  future: DocsSnapshot[];
  /** Último paso de tipeo (para agrupar): qué se tipeó y cuándo. */
  typing: { key: string; at: number } | null;
}

/** Pausa que corta un grupo de tipeo en un paso nuevo. */
export const DOCS_HISTORY_GROUP_MS = 1000;
/** Pasos que se recuerdan (los más viejos se descartan). */
export const DOCS_HISTORY_LIMIT = 200;

export function emptyHistory(): DocsHistory {
  return { past: [], future: [], typing: null };
}

export type DocsChange =
  | { kind: 'none' }
  /** Solo cambió el texto de un bloque (key = id) o el título (key = 'title'). */
  | { kind: 'text'; key: string }
  | { kind: 'structure' };

/** true si los dos bloques son iguales salvo por `content`. */
function sameExceptContent(a: DocsBlock, b: DocsBlock): boolean {
  if (a.id !== b.id) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === 'content') continue;
    const va = (a as unknown as Record<string, unknown>)[k];
    const vb = (b as unknown as Record<string, unknown>)[k];
    if (va === vb) continue;
    // Filas/columnas: se comparan por valor (se copian al editar).
    if (typeof va === 'object' && typeof vb === 'object' && JSON.stringify(va) === JSON.stringify(vb)) continue;
    return false;
  }
  return true;
}

/** Clasifica el cambio entre dos fotos. */
export function classifyChange(prev: DocsSnapshot, next: DocsSnapshot): DocsChange {
  const titleChanged = prev.title !== next.title;
  if (prev.blocks === next.blocks) return titleChanged ? { kind: 'text', key: 'title' } : { kind: 'none' };
  if (prev.blocks.length !== next.blocks.length) return { kind: 'structure' };
  let changed: string | null = null;
  for (let i = 0; i < prev.blocks.length; i++) {
    const a = prev.blocks[i];
    const b = next.blocks[i];
    if (a === b) continue;
    if (!sameExceptContent(a, b)) return { kind: 'structure' };
    if (a.content === b.content) continue;
    // Dos bloques con texto distinto a la vez: no es tipeo.
    if (changed !== null) return { kind: 'structure' };
    changed = a.id;
  }
  if (changed === null) return titleChanged ? { kind: 'text', key: 'title' } : { kind: 'none' };
  return titleChanged ? { kind: 'structure' } : { kind: 'text', key: changed };
}

/**
 * Registra el paso de `prev` a `next`. Devuelve el historial nuevo (o el
 * mismo si no hubo cambio o si es tipeo que se suma al grupo abierto).
 */
export function recordChange(h: DocsHistory, prev: DocsSnapshot, next: DocsSnapshot, now: number): DocsHistory {
  const change = classifyChange(prev, next);
  if (change.kind === 'none') return h;
  if (change.kind === 'text') {
    const grouped = h.typing !== null && h.typing.key === change.key && now - h.typing.at < DOCS_HISTORY_GROUP_MS;
    if (grouped && h.past.length > 0) {
      return { past: h.past, future: [], typing: { key: change.key, at: now } };
    }
    return { past: push(h.past, prev), future: [], typing: { key: change.key, at: now } };
  }
  return { past: push(h.past, prev), future: [], typing: null };
}

function push(list: DocsSnapshot[], snap: DocsSnapshot): DocsSnapshot[] {
  const next = [...list, snap];
  return next.length > DOCS_HISTORY_LIMIT ? next.slice(next.length - DOCS_HISTORY_LIMIT) : next;
}

/** Deshacer: la foto a la que volver y el historial nuevo; null si no hay nada. */
export function undoStep(h: DocsHistory, current: DocsSnapshot): { history: DocsHistory; snapshot: DocsSnapshot } | null {
  const snapshot = h.past[h.past.length - 1];
  if (!snapshot) return null;
  return {
    snapshot,
    history: { past: h.past.slice(0, -1), future: [...h.future, current], typing: null },
  };
}

/** Rehacer: inverso de undoStep. */
export function redoStep(h: DocsHistory, current: DocsSnapshot): { history: DocsHistory; snapshot: DocsSnapshot } | null {
  const snapshot = h.future[h.future.length - 1];
  if (!snapshot) return null;
  return {
    snapshot,
    history: { past: push(h.past, current), future: h.future.slice(0, -1), typing: null },
  };
}

/**
 * Dónde dejar el caret después de deshacer o rehacer: el primer bloque que
 * difiere entre la foto de antes y la de ahora (o -1 si solo cambió el título).
 */
export function firstChangedBlock(before: DocsBlock[], after: DocsBlock[]): number {
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i++) {
    const a = before[i];
    const b = after[i];
    if (!a || !b || a.id !== b.id || a.content !== b.content || !sameExceptContent(a, b)) {
      return Math.min(i, after.length - 1);
    }
  }
  return -1;
}

/** Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z y Ctrl/Cmd+Y. */
export function historyShortcut(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): 'undo' | 'redo' | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !e.shiftKey) return 'redo';
  return null;
}
