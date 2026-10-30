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
 * Todo es de una persona en un workspace (`owner` = "<persona>:<workspace>"):
 * las claves llevan el dueño, lo de otra persona se descarta y al cerrar
 * sesión se borra (lib/offline-queue.ts clearOfflineData).
 *
 * localStorage puede fallar (modo privado): todo va en try/catch y sin él
 * solo se pierde el borrador local.
 */
import type { DocsBlock, DocsPage } from './docs-types';
import type { CoeditDraftBlock } from './docs-coedit-client';

export interface DocsDraft {
  owner: string;
  patch: Partial<DocsPage>;
  base: { updated_at: string; title: string; content: DocsBlock[] };
  at: number;
  /**
   * Edición simultánea: texto confirmado por el servidor de cada bloque
   * cambiado (y la operación en vuelo), para mandar lo escrito sin red como
   * operaciones al volver aunque se haya recargado la pestaña.
   */
  coedit?: { session: string; blocks: Record<string, CoeditDraftBlock> };
}

/** Prefijo de todo lo de Docs en localStorage (se borra entero al cerrar sesión). */
export const DOCS_LOCAL_PREFIX = 'zs-docs-';
/** Persona:workspace que usó la app por última vez en este dispositivo. */
export const OFFLINE_IDENTITY_KEY = 'zs-identity';
const DRAFT_PREFIX = 'zs-docs-draft:';
const OFFLINE_PREFIX = 'zs-docs-offline:';
/** Tope del borrador (localStorage suele dar 5 MB por origen). */
const DRAFT_MAX_CHARS = 2_000_000;

const draftKey = (owner: string, pageId: string) => `${DRAFT_PREFIX}${owner}|${pageId}`;

export function loadDraft(owner: string, pageId: string): DocsDraft | null {
  if (!owner) return null;
  try {
    const raw = localStorage.getItem(draftKey(owner, pageId));
    if (!raw) return null;
    const d = JSON.parse(raw) as DocsDraft;
    // Un borrador de otra persona nunca se usa.
    return d && d.patch && d.base && d.owner === owner ? d : null;
  } catch {
    return null;
  }
}

/** Suma `patch` al borrador (la base es la del primer cambio sin red). */
export function saveDraft(owner: string, pageId: string, patch: Partial<DocsPage>, base: DocsDraft['base'], coedit?: DocsDraft['coedit']): boolean {
  if (!owner) return false;
  try {
    const prev = loadDraft(owner, pageId);
    const next: DocsDraft = { owner, patch: { ...(prev?.patch ?? {}), ...patch }, base: prev?.base ?? base, at: Date.now() };
    // Lo que tiene el motor ahora: su base ya suma lo ajeno que llegó (el stream
    // puede seguir vivo sin red) y lo propio en vuelo ya está transformado. Mezclarlo
    // con una base vieja volvía a mandar como propio el texto de otra persona.
    const co = coedit ?? prev?.coedit;
    if (co) next.coedit = { session: co.session, blocks: { ...co.blocks } };
    const raw = JSON.stringify(next);
    if (raw.length > DRAFT_MAX_CHARS) return false;
    localStorage.setItem(draftKey(owner, pageId), raw);
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(owner: string, pageId: string): void {
  try {
    localStorage.removeItem(draftKey(owner, pageId));
  } catch {
    /* sin storage */
  }
}

/** Texto plano del borrador (para copiarlo si ya no se puede guardar). */
export function draftText(d: DocsDraft): string {
  const lines: string[] = [];
  if (d.patch.title) lines.push(d.patch.title);
  for (const b of d.patch.content ?? []) {
    const text = (b.content ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    if (text.trim()) lines.push(text);
  }
  return lines.join('\n\n');
}

export function offlinePages(owner: string): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(OFFLINE_PREFIX + owner) ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 200) : [];
  } catch {
    return [];
  }
}

export function setOfflinePage(owner: string, pageId: string, on: boolean): string[] {
  const list = offlinePages(owner).filter((id) => id !== pageId);
  if (on) list.unshift(pageId);
  try {
    localStorage.setItem(OFFLINE_PREFIX + owner, JSON.stringify(list.slice(0, 200)));
  } catch {
    /* sin storage */
  }
  return list;
}

/** Borra lo de Docs que no es de `owner` (otra persona usó este dispositivo). Sin owner: todo. */
export function forgetOtherOfflineData(owner: string | null): void {
  try {
    const drop: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(DOCS_LOCAL_PREFIX)) continue;
      const mine = owner && (k.startsWith(`${DRAFT_PREFIX}${owner}|`) || k === OFFLINE_PREFIX + owner);
      if (!mine) drop.push(k);
    }
    for (const k of drop) localStorage.removeItem(k);
  } catch {
    /* sin storage */
  }
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

/** Valor de la cookie zs_who (la pone el middleware con la sesión): el service worker la compara para servir lo guardado. */
export function whoCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const m = /(?:^|;\s*)zs_who=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Pide al service worker que guarde estas URLs (navegación de cada página) para `owner`. */
export function warmOffline(owner: string, urls: string[]): boolean {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : null;
  if (!sw || !owner) return false;
  sw.postMessage({ type: 'zs-warm', user: owner, who: whoCookie(), urls });
  return true;
}
