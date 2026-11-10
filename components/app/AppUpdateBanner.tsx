'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isNewBuild } from '@/lib/app-version';

const MINE = process.env.NEXT_PUBLIC_BUILD_ID ?? '';
const DISMISS_KEY = 'zs-app-update-dismissed';
const EVERY_MS = 10 * 60_000;
const MIN_GAP_MS = 60_000;

/**
 * Una pestaña abierta sigue con el código del deploy con el que cargó. Cuando
 * el servidor ya sirve otro, se avisa con un cartel flotante arriba y se ofrece
 * recargar; nunca se recarga sola, para no perder lo que se está escribiendo.
 * Se revisa al volver a la pestaña y cada 10 minutos. "Ahora no" lo esconde
 * hasta la versión siguiente.
 */
export default function AppUpdateBanner() {
  const t = useTranslations('settings.appUpdate');
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    if (!MINE) return;
    let alive = true;
    let last = 0;
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      fetch('/api/version', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { build?: unknown } | null) => {
          if (!alive || !d || !isNewBuild(MINE, d.build)) return;
          try {
            if (window.sessionStorage.getItem(DISMISS_KEY) === d.build) return;
          } catch {
            /* sin storage: se muestra */
          }
          setNext(d.build);
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(check, EVERY_MS);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  if (!next) return null;
  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, next);
    } catch {
      /* nada que guardar */
    }
    setNext(null);
  };
  return (
    <div className="zs-desk-update zs-app-update" role="status" data-testid="app-update-banner">
      <p>
        <strong>{t('title')}</strong> {t('body')}
      </p>
      <div className="zs-desk-update-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
          {t('reload')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
          {t('dismiss')}
        </button>
      </div>
    </div>
  );
}
