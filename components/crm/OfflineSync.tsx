'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { QUEUED_EVENT } from '@/lib/offline-queue';
import { listenInstallPrompt } from './installPrompt';

type SyncState = 'idle' | 'syncing' | 'synced' | 'failed';

/**
 * CRM offline: registra el service worker (public/sw.js), avisa cuando no hay
 * red, cuenta los cambios en cola y, al volver la red, pide al worker que los
 * reenvíe y refresca la vista. En `next dev` no se registra (el worker
 * cachearía los bundles de desarrollo), salvo con NEXT_PUBLIC_SW_DEV=1.
 */
export default function OfflineSync() {
  const t = useTranslations('crm');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? '';
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [sync, setSync] = useState<SyncState>('idle');
  const [failed, setFailed] = useState(0);
  const [queuedNotice, setQueuedNotice] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    if (!('serviceWorker' in navigator)) return;
    const enabled = process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_SW_DEV === '1';
    if (!enabled) return;

    const sw = navigator.serviceWorker;

    function onMessage(e: MessageEvent) {
      const data = (e.data ?? {}) as { type?: string; count?: number; done?: number; failed?: number };
      if (data.type === 'zs-queue') setPending(data.count ?? 0);
      else if (data.type === 'zs-sync-start') setSync('syncing');
      else if (data.type === 'zs-sync-done') {
        setFailed(data.failed ?? 0);
        setSync((data.failed ?? 0) > 0 ? 'failed' : 'synced');
        if ((data.done ?? 0) + (data.failed ?? 0) > 0) router.refresh();
      }
    }
    sw.addEventListener('message', onMessage);

    let cancelled = false;
    sw.register('/sw.js', { scope: '/' })
      .then(() => sw.ready)
      .then((reg) => {
        if (cancelled) return;
        const target = sw.controller ?? reg.active;
        // JS y CSS de esta carga (bajados antes de que el worker controlara la página) y la vista actual.
        const urls = performance
          .getEntriesByType('resource')
          .map((r) => r.name)
          .filter((u) => u.includes('/_next/static/'));
        urls.push(location.href);
        target?.postMessage({ type: 'zs-warm', urls });
        target?.postMessage({ type: 'zs-count' });
        if (navigator.onLine) target?.postMessage({ type: 'zs-sync' });
      })
      .catch(() => null);

    return () => {
      cancelled = true;
      sw.removeEventListener('message', onMessage);
    };
  }, [router]);

  // Navegación dentro del CRM (sin recarga): el worker guarda también la vista nueva.
  useEffect(() => {
    if (!navigator.onLine) return;
    const id = window.setTimeout(() => {
      navigator.serviceWorker?.controller?.postMessage({ type: 'zs-warm', urls: [location.href] });
    }, 1500);
    return () => window.clearTimeout(id);
  }, [pathname, search]);

  useEffect(() => listenInstallPrompt(), []);

  useEffect(() => {
    function goOnline() {
      setOnline(true);
      navigator.serviceWorker?.controller?.postMessage({ type: 'zs-sync' });
    }
    function goOffline() {
      setOnline(false);
      setSync('idle');
    }
    function onQueued() {
      setQueuedNotice(true);
    }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener(QUEUED_EVENT, onQueued);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener(QUEUED_EVENT, onQueued);
    };
  }, []);

  // "Sincronizado" se va solo; el aviso de guardado sin red se va al sincronizar.
  useEffect(() => {
    if (sync !== 'synced') return;
    setQueuedNotice(false);
    const id = window.setTimeout(() => setSync('idle'), 4000);
    return () => window.clearTimeout(id);
  }, [sync]);

  let text: string | null = null;
  if (!online) {
    text = pending > 0 ? t('offline.offlinePending', { count: pending }) : t('offline.offline');
  } else if (sync === 'syncing') {
    text = t('offline.syncing');
  } else if (sync === 'synced') {
    text = t('offline.synced');
  } else if (sync === 'failed') {
    text = t('offline.failed', { count: failed });
  } else if (pending > 0) {
    text = t('offline.pending', { count: pending });
  } else if (queuedNotice) {
    text = t('offline.savedOffline');
  }
  if (!text) return null;

  return (
    <div
      className={`crm-offline-bar${online ? '' : ' is-offline'}${sync === 'failed' ? ' is-failed' : ''}`}
      role="status"
      aria-live="polite"
      data-testid="crm-offline-bar"
    >
      <span className="crm-offline-dot" aria-hidden="true" />
      <span>{text}</span>
      {online && pending > 0 && sync !== 'syncing' && (
        <button
          type="button"
          className="link-btn"
          onClick={() => navigator.serviceWorker?.controller?.postMessage({ type: 'zs-sync' })}
        >
          {t('offline.retry')}
        </button>
      )}
      {sync === 'failed' && (
        <button type="button" className="link-btn" onClick={() => setSync('idle')}>
          {t('offline.dismiss')}
        </button>
      )}
    </div>
  );
}
