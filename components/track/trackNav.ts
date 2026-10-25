'use client';

/**
 * Orden de la lista desde la que se abrió un issue, para el "4 / 12" y J/K
 * del header del issue (como Linear, que recorre la vista de origen). Se
 * guarda en sessionStorage al abrir una fila (clic o Enter): es una
 * comodidad de la pestaña, si no está, el issue usa sus hermanos.
 */

const KEY = 'track:list-nav';

export interface ListNav {
  ids: string[];
  /** Ruta de la lista (para volver con Esc). */
  href: string;
  at: number;
}

function isIssuePage(pathname: string): boolean {
  return /\/app\/track\/(issues\/[^/]+|issue\/)/.test(pathname);
}

/** Guarda las filas visibles de la lista actual (si es una lista y no un issue). */
export function rememberListOrder(): void {
  try {
    const path = window.location.pathname;
    if (isIssuePage(path)) return;
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const el of document.querySelectorAll<HTMLElement>('[data-issue-key]')) {
      const id = el.dataset.issueKey;
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    if (ids.length === 0) return;
    const nav: ListNav = { ids: ids.slice(0, 2000), href: `${path}${window.location.search}`, at: Date.now() };
    window.sessionStorage.setItem(KEY, JSON.stringify(nav));
  } catch {
    // Sin storage (modo privado): el issue navega por sus hermanos.
  }
}

export function readListNav(): ListNav | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const nav = JSON.parse(raw) as ListNav;
    return Array.isArray(nav.ids) && typeof nav.href === 'string' ? nav : null;
  } catch {
    return null;
  }
}

/**
 * Escucha (en captura) los clics y el Enter sobre filas de issues: justo
 * antes de navegar al issue, guarda el orden de la lista.
 */
export function installListMemory(): () => void {
  const onClick = (e: MouseEvent) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest?.('[data-issue-key]')) rememberListOrder();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (document.querySelector('[data-issue-key].is-kb-active') || (e.target as HTMLElement | null)?.closest?.('[data-issue-key]')) {
        rememberListOrder();
      }
    }
  };
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKey, true);
  return () => {
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true);
  };
}
