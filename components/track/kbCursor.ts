'use client';

/**
 * Cursor de teclado de las listas de Track (J/K), guardado por id de issue y
 * no por elemento del DOM: cuando un issue cambia de grupo (S, P, A, ⌘Z) la
 * fila se vuelve a montar en otro lado y el cursor la sigue; si el issue se
 * borró o salió de la vista, pasa al vecino (como Linear). La clase
 * `.is-kb-active` se re-aplica en cada mutación del DOM, así P/A/L y X siguen
 * actuando sobre la misma fila.
 */

let activeId: string | null = null;
/** Orden visible la última vez que el issue activo estaba en pantalla (para elegir vecino). */
let lastOrder: string[] = [];
let missingSince = 0;
let frame = 0;
let missTimer = 0;

/** Si se borra o sale de la vista, cuánto se espera antes de pasar al vecino (re-render en curso). */
const MISSING_GRACE_MS = 350;

export function visibleRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-issue-row]')).filter((el) => el.offsetParent !== null);
}

function rowFor(id: string, rows = visibleRows()): HTMLElement | null {
  return rows.find((r) => r.dataset.issueKey === id) ?? null;
}

export function getActiveIssueId(): string | null {
  return activeId;
}

/** Fila del cursor si está en pantalla. */
export function activeRowElement(): HTMLElement | null {
  return activeId ? rowFor(activeId) : null;
}

function paint(rows: HTMLElement[]) {
  for (const el of document.querySelectorAll<HTMLElement>('[data-issue-key].is-kb-active')) {
    if (el.dataset.issueKey !== activeId || !rows.includes(el)) {
      el.classList.remove('is-kb-active');
      el.removeAttribute('aria-current');
    }
  }
  const row = activeId ? rowFor(activeId, rows) : null;
  if (row && !row.classList.contains('is-kb-active')) {
    row.classList.add('is-kb-active');
    row.setAttribute('aria-current', 'true');
  }
}

export function setActiveIssue(id: string | null, opts: { scroll?: boolean } = {}): void {
  activeId = id;
  missingSince = 0;
  const rows = visibleRows();
  if (id) lastOrder = rows.map((r) => r.dataset.issueKey ?? '').filter(Boolean);
  paint(rows);
  if (opts.scroll && id) rowFor(id, rows)?.scrollIntoView({ block: 'nearest' });
}

/** J/K: mueve el cursor `delta` filas (arranca en la primera). */
export function moveActive(delta: number): string | null {
  const rows = visibleRows();
  if (rows.length === 0) return null;
  const ids = rows.map((r) => r.dataset.issueKey ?? '');
  const cur = activeId ? ids.indexOf(activeId) : -1;
  const next = cur === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, cur + delta));
  setActiveIssue(ids[next] || null, { scroll: true });
  return activeId;
}

/** Re-aplica el cursor tras un render; si el issue ya no está, pasa al vecino. */
export function syncCursor(): void {
  if (!activeId) return;
  const rows = visibleRows();
  const ids = rows.map((r) => r.dataset.issueKey ?? '');
  if (ids.includes(activeId)) {
    missingSince = 0;
    lastOrder = ids;
    paint(rows);
    return;
  }
  if (!missingSince) {
    missingSince = Date.now();
    window.clearTimeout(missTimer);
    missTimer = window.setTimeout(syncCursor, MISSING_GRACE_MS + 20);
    return;
  }
  if (Date.now() - missingSince < MISSING_GRACE_MS) return;
  // Borrado (o filtrado): el siguiente que siga en pantalla, si no el anterior.
  const at = lastOrder.indexOf(activeId);
  const present = new Set(ids);
  let next: string | null = null;
  if (at >= 0) {
    next = lastOrder.slice(at + 1).find((x) => present.has(x)) ?? [...lastOrder.slice(0, at)].reverse().find((x) => present.has(x)) ?? null;
  }
  setActiveIssue(next);
}

/** Observa el DOM y mantiene el cursor; devuelve la limpieza. */
export function installCursor(): () => void {
  const obs = new MutationObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      syncCursor();
    });
  });
  obs.observe(document.body, { childList: true, subtree: true });
  return () => {
    obs.disconnect();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    window.clearTimeout(missTimer);
  };
}

/** Al navegar a otra página, el cursor se suelta. */
export function resetCursor(): void {
  activeId = null;
  lastOrder = [];
  missingSince = 0;
}
