'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { registerAppServiceWorker, serviceWorkerEnabled } from '@/lib/sw-client';
import { whoCookie } from '@/lib/docs-offline';
import { notesDbName } from '@/components/notes/notesOffline';

/**
 * Estado sin conexión en la banda de la app (toda la suite).
 *
 * - Registra el service worker (public/sw.js) en las apps que funcionan sin
 *   red (CRM, Docs, Notes, Track y el inicio) y le pasa la vista actual para
 *   que la guarde: así lo que la persona abrió se lee sin red.
 * - Muestra si no hay red y cuántos cambios esperan en este dispositivo: los
 *   de la cola del worker (CRM y Track), los borradores de Docs y los cambios
 *   de Notes. Al volver la red pide reenviar y refresca la vista.
 * - Un panel lista lo pendiente, lo que el servidor rechazó (reintentar o
 *   descartar) y lo que se guardó sobre una versión más nueva ("editado en
 *   otro lado").
 *
 * `owner` es persona:workspace (el mismo que components/app/OfflineIdentity).
 */

/** Rutas cuyas vistas se guardan para abrir sin red (las mismas que isOfflineNavigation en public/sw.js). */
export const OFFLINE_APP_PATH = /^\/(?:(?:en|es|pt)\/)?app(?:\/(?:crm|docs|track)(?:\/|$)|\/notes\/?$|\/?$)/;

interface Brief {
  id: number;
  url: string;
  method: string | null;
  label: string | null;
  status: number | null;
  at: number;
}

type SyncState = 'idle' | 'syncing' | 'synced';

const DOCS_DRAFT_PREFIX = 'zs-docs-draft:';

function docsDrafts(owner: string): number {
  try {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith(`${DOCS_DRAFT_PREFIX}${owner}|`)) n += 1;
    return n;
  } catch {
    return 0;
  }
}

/** Cambios de Notes que esperan (solo si la base de esta persona ya existe: no se crea una vacía). */
async function notesPending(owner: string): Promise<number> {
  const [userId, ws] = owner.split(':');
  if (!userId || !ws || typeof indexedDB === 'undefined' || !indexedDB.databases) return 0;
  const name = notesDbName({ userId, ws });
  try {
    const list = await indexedDB.databases();
    if (!list.some((d) => d.name === name)) return 0;
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    });
    if (!db) return 0;
    if (!db.objectStoreNames.contains('ops')) {
      db.close();
      return 0;
    }
    const n = await new Promise<number>((resolve) => {
      const q = db.transaction('ops', 'readonly').objectStore('ops').count();
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => resolve(0);
    });
    db.close();
    return n;
  } catch {
    return 0;
  }
}

function describe(b: Brief, fallback: string): string {
  if (b.label) return b.label;
  try {
    const path = new URL(b.url, location.origin).pathname.replace(/^\/api\//, '');
    return `${(b.method ?? '').toUpperCase()} ${path}`.trim() || fallback;
  } catch {
    return fallback;
  }
}

export default function OfflineStatus({ owner }: { owner: string }) {
  const t = useTranslations('common.offline');
  const helpHref = `/${useLocale()}/download#offline`;
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<{ pending: Brief[]; failed: Brief[]; conflicts: Brief[]; count: number }>({ pending: [], failed: [], conflicts: [], count: 0 });
  const [local, setLocal] = useState({ docs: 0, notes: 0 });
  const [sync, setSync] = useState<SyncState>('idle');
  const [open, setOpen] = useState(false);
  const [retryLater, setRetryLater] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const offlineApp = OFFLINE_APP_PATH.test(pathname);
  const warmedStatics = useRef(false);

  const post = useCallback((msg: Record<string, unknown>) => {
    navigator.serviceWorker?.controller?.postMessage(msg);
  }, []);

  // Mensajes del worker.
  useEffect(() => {
    setOnline(navigator.onLine);
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (!sw) return;
    function onMessage(e: MessageEvent) {
      const data = (e.data ?? {}) as {
        type?: string;
        count?: number;
        pending?: Brief[];
        failed?: Brief[];
        conflicts?: Brief[];
        done?: number;
        failedCount?: number;
        retry?: boolean;
      };
      if (data.type === 'zs-queue') {
        setQueue({ count: data.count ?? 0, pending: data.pending ?? [], failed: data.failed ?? [], conflicts: data.conflicts ?? [] });
      } else if (data.type === 'zs-sync-start') {
        setSync('syncing');
      } else if (data.type === 'zs-sync-done') {
        const d = e.data as { done?: number; failed?: number; retry?: boolean };
        setRetryLater(Boolean(d.retry));
        setSync((d.done ?? 0) > 0 ? 'synced' : 'idle');
        if ((d.done ?? 0) + (d.failed ?? 0) > 0) router.refresh();
      }
    }
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, [router]);

  // Registro y "guardar esta vista" en las apps que andan sin red.
  useEffect(() => {
    if (!offlineApp || !('serviceWorker' in navigator) || !serviceWorkerEnabled()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      registerAppServiceWorker()
        .then(() => navigator.serviceWorker.ready)
        .then((reg) => {
          if (cancelled) return;
          const target = navigator.serviceWorker.controller ?? reg.active;
          target?.postMessage({ type: 'zs-count' });
          if (!navigator.onLine) return;
          const urls: string[] = [];
          if (!warmedStatics.current) {
            // JS y CSS de esta carga (bajados antes de que el worker controlara la página).
            warmedStatics.current = true;
            for (const r of performance.getEntriesByType('resource')) if (r.name.includes('/_next/static/')) urls.push(r.name);
          }
          urls.push(location.href);
          target?.postMessage({ type: 'zs-warm', user: owner, who: whoCookie(), urls });
          target?.postMessage({ type: 'zs-sync' });
        })
        .catch(() => null);
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [offlineApp, pathname, owner]);

  // Red que va y viene.
  useEffect(() => {
    function goOnline() {
      setOnline(true);
      post({ type: 'zs-sync' });
    }
    function goOffline() {
      setOnline(false);
      setSync('idle');
    }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [post]);

  // Borradores de Docs y cambios de Notes (cada uno se sincroniza en su app; acá solo se cuentan).
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const docs = docsDrafts(owner);
      const notes = await notesPending(owner);
      if (alive) setLocal((prev) => (prev.docs === docs && prev.notes === notes ? prev : { docs, notes }));
    };
    void read();
    const id = window.setInterval(read, online && queue.count === 0 && local.docs + local.notes === 0 ? 30_000 : 4_000);
    window.addEventListener('storage', read);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener('storage', read);
    };
  }, [owner, online, queue.count, local.docs, local.notes]);

  // Con red y cambios esperando (el servidor no pudo antes): se reintenta solo cada tanto.
  useEffect(() => {
    if (!online || queue.count === 0) return;
    const id = window.setInterval(() => post({ type: 'zs-sync' }), 20_000);
    return () => window.clearInterval(id);
  }, [online, queue.count, post]);

  // "Sincronizado" se va solo.
  useEffect(() => {
    if (sync !== 'synced') return;
    const id = window.setTimeout(() => setSync('idle'), 4000);
    return () => window.clearTimeout(id);
  }, [sync]);

  // Panel: Esc y clic afuera cierran.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const el = e.target as Node;
      if (!panelRef.current?.contains(el) && !buttonRef.current?.contains(el)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    panelRef.current?.querySelector<HTMLElement>('button, a')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const pending = queue.count + local.docs + local.notes;
  const failed = queue.failed.length;
  const conflicts = queue.conflicts.length;

  let tone: 'off' | 'bad' | 'warn' | 'ok' | 'busy' = 'ok';
  let text: string | null = null;
  if (!online) {
    tone = 'off';
    text = pending > 0 ? t('offlinePending', { count: pending }) : t('offline');
  } else if (failed > 0) {
    tone = 'bad';
    text = t('failedShort', { count: failed });
  } else if (sync === 'syncing') {
    tone = 'busy';
    text = t('syncing');
  } else if (pending > 0) {
    tone = 'warn';
    text = t('pendingShort', { count: pending });
  } else if (conflicts > 0) {
    tone = 'warn';
    text = t('conflictShort', { count: conflicts });
  } else if (sync === 'synced') {
    tone = 'ok';
    text = t('synced');
  }
  if (!text) return null;

  return (
    <div className="band-offline">
      <button
        ref={buttonRef}
        type="button"
        className={`band-offline-btn is-${tone}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        data-testid="offline-status"
      >
        <span className="band-offline-dot" aria-hidden="true" />
        <span className="band-offline-text" role="status" aria-live="polite">
          {text}
        </span>
      </button>
      {open && (
        <div ref={panelRef} className="band-offline-panel" role="dialog" aria-label={t('panelTitle')} data-testid="offline-panel">
          <p className="band-offline-lead">{online ? (pending > 0 ? t('leadPending') : t('leadOnline')) : t('leadOffline')}</p>

          {queue.pending.length > 0 && (
            <section>
              <h3>{t('savedOnDevice')}</h3>
              <ul>
                {queue.pending.map((b) => (
                  <li key={`p${b.id}`}>
                    <span className="band-offline-item">{describe(b, t('change'))}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(local.docs > 0 || local.notes > 0) && (
            <section>
              <h3>{t('inApps')}</h3>
              <ul>
                {local.docs > 0 && <li>{t('docsDrafts', { count: local.docs })}</li>}
                {local.notes > 0 && <li>{t('notesPending', { count: local.notes })}</li>}
              </ul>
            </section>
          )}
          {failed > 0 && (
            <section>
              <h3>{t('failedTitle')}</h3>
              <ul>
                {queue.failed.map((b) => (
                  <li key={`f${b.id}`} className="band-offline-row">
                    <span className="band-offline-item">
                      {describe(b, t('change'))}
                      {b.status ? <span className="band-offline-code"> · {t(`status.${b.status === 403 ? 'forbidden' : b.status === 404 ? 'gone' : 'rejected'}`)}</span> : null}
                    </span>
                    <span className="band-offline-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => post({ type: 'zs-retry-failed', id: b.id })}>
                        {t('retry')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => post({ type: 'zs-discard-failed', id: b.id })}>
                        {t('discard')}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {conflicts > 0 && (
            <section>
              <h3>{t('conflictTitle')}</h3>
              <p className="band-offline-note">{t('conflictBody')}</p>
              <ul>
                {queue.conflicts.map((b) => (
                  <li key={`c${b.id}`}>
                    <span className="band-offline-item">{describe(b, t('change'))}</span>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => post({ type: 'zs-clear-conflicts' })}>
                {t('understood')}
              </button>
            </section>
          )}

          <div className="band-offline-foot">
            {online && queue.count > 0 && sync !== 'syncing' && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => post({ type: 'zs-sync' })}>
                {t('syncNow')}
              </button>
            )}
            {online && retryLater && queue.count > 0 && <span className="band-offline-note">{t('retryLater')}</span>}
            <a className="band-offline-help" href={helpHref}>
              {t('help')}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
