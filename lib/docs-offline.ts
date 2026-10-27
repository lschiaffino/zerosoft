/**
 * Docs sin conexión (cliente).
 *
 * - Borrador local: lo que se escribe sin red queda en localStorage (con la
 *   versión del servidor sobre la que se escribió) y se guarda al volver la
 *   red, fusionado por bloque con lo que otros guardaron mientras tanto
 *   (el servidor fusiona contra esa versión; si ya no la tiene, el editor
 *   rebasa sobre la actual). Sobrevive a recargar o cerrar la pestaña.
 * - "Disponible sin conexión": la página y sus subpáginas se guardan en el
 *   service worker unificado (public/sw.js) para abrirlas sin red; se
 *   refrescan cada vez que se abre Docs con conexión.
 *
 * localStorage puede fallar (modo privado): todo va en try/catch y sin él
 * solo se pierde el borrador local.
 */
import type { DocsBlock, DocsPage } from './docs-types';

export interface DocsDraft {
  patch: Partial<DocsPage>;
  base: { updated_at: string; title: string; content: DocsBlock[] };
  at: number;
}

const DRAFT_PREFIX = 'zs-docs-draft:';
const OFFLINE_KEY = 'zs-docs-offline';
/** Tope del borrador (localStorage suele dar 5 MB por origen). */
const DRAFT_MAX_CHARS = 2_000_000;

export function loadDraft(pageId: string): DocsDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + pageId);
    if (!raw) return null;
    const d = JSON.parse(raw) as DocsDraft;
    return d && d.patch && d.base ? d : null;
  } catch {
    return null;
  }
}

/** Suma `patch` al borrador (la base es la del primer cambio sin red). */
export function saveDraft(pageId: string, patch: Partial<DocsPage>, base: DocsDraft['base']): boolean {
  try {
    const prev = loadDraft(pageId);
    const next: DocsDraft = { patch: { ...(prev?.patch ?? {}), ...patch }, base: prev?.base ?? base, at: Date.now() };
    const raw = JSON.stringify(next);
    if (raw.length > DRAFT_MAX_CHARS) return false;
    localStorage.setItem(DRAFT_PREFIX + pageId, raw);
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(pageId: string): void {
  try {
    localStorage.removeItem(DRAFT_PREFIX + pageId);
  } catch {
    /* sin storage */
  }
}

export function offlinePages(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(OFFLINE_KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 200) : [];
  } catch {
    return [];
  }
}

export function setOfflinePage(pageId: string, on: boolean): string[] {
  const list = offlinePages().filter((id) => id !== pageId);
  if (on) list.unshift(pageId);
  try {
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(list.slice(0, 200)));
  } catch {
    /* sin storage */
  }
  return list;
}

/** Ids de las subpáginas (en orden de árbol) a partir de la lista de páginas con su madre. */
export function descendantIds(rootId: string, pages: Array<{ id: string; parent_id: string | null }>, max = 50): string[] {
  const kids = new Map<string, string[]>();
  for (const p of pages) if (p.parent_id) kids.set(p.parent_id, [...(kids.get(p.parent_id) ?? []), p.id]);
  const out: string[] = [];
  const queue = [...(kids.get(rootId) ?? [])];
  const seen = new Set([rootId]);
  while (queue.length && out.length < max) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    queue.push(...(kids.get(id) ?? []));
  }
  return out;
}

/** Pide al service worker que guarde estas URLs (navegación de cada página). */
export function warmOffline(urls: string[]): boolean {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : null;
  if (!sw) return false;
  sw.postMessage({ type: 'zs-warm', urls });
  return true;
}
