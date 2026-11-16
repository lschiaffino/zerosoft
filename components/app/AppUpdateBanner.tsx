'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { isNewBuild } from '@/lib/app-version';

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? '';
/** Sin versión conocida (desarrollo, e2e) el aviso no corre; los e2e fijan una en sessionStorage para probarlo. */
const OVERRIDE_KEY = 'zs-app-build';
function mine(): string {
  if (BUILD) return BUILD;
  try {
    return window.sessionStorage.getItem(OVERRIDE_KEY) ?? '';
  } catch {
    return '';
  }
}

interface News {
  id: string;
  titles: string[];
}
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
  const locale = useLocale();
  const [next, setNext] = useState<string | null>(null);
  const [news, setNews] = useState<News | null>(null);

  useEffect(() => {
    const MINE = mine();
    if (!MINE) return;
    let alive = true;
    let last = 0;
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      fetch(`/api/version?locale=${encodeURIComponent(locale)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { build?: unknown; news?: News } | null) => {
          if (!alive || !d || !isNewBuild(MINE, d.build)) return;
          try {
            if (window.sessionStorage.getItem(DISMISS_KEY) === d.build) return;
          } catch {
            /* sin storage: se muestra */
          }
          setNext(d.build);
          const n = d.news;
          setNews(n && typeof n.id === 'string' && Array.isArray(n.titles) ? { id: n.id, titles: n.titles.filter((x) => typeof x === 'string').slice(0, 2) } : null);
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
  }, [locale]);

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
      <div className="zs-app-update-text">
        <p>
          <strong>{t('title')}</strong> {t('body')}
        </p>
        {news && news.titles.length > 0 && (
          // Qué trae: lo último del changelog, en una o dos líneas, y el enlace a todo.
          <p className="zs-app-update-news" data-testid="app-update-news">
            <span className="zs-app-update-news-text">{t('news', { titles: news.titles.join(' · ') })}</span>{' '}
            <Link href={`/changelog#${news.id}`} prefetch={false} target="_blank" className="zs-app-update-link">
              {t('seeNews')}
            </Link>
          </p>
        )}
      </div>
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
