'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import FeedbackForm from '@/components/FeedbackForm';
import BoardVote from '@/components/board/BoardVote';
import { productFromPath } from '@/lib/product-taxonomy';
import { ROADMAP_VOTABLE_STATUSES } from '@/lib/roadmap-constants';

/**
 * Launcher de feedback: botón chico abajo a la derecha (a la izquierda del
 * chat de soporte si está) que abre un panel con tres pestañas:
 * - Ideas: buscar en el board y votar sin salir de la página.
 * - Enviar: idea o bug con el producto preseleccionado según la ruta.
 * - Novedades: últimas entradas del changelog; las no leídas (localStorage)
 *   suman al badge del botón.
 */

type Tab = 'ideas' | 'send' | 'news';

interface LauncherItem {
  id: string;
  ref: string;
  title: string;
  status: string;
  votes: number;
  voted: boolean;
}

interface NewsEntry {
  id: string;
  date: string;
  title: string;
}

const SEEN_KEY = 'zs_changelog_seen';

function readSeen(): string[] | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeSeen(ids: string[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-200)));
  } catch {
    // sin storage: el badge vuelve a aparecer, nada más
  }
}

export default function FeedbackLauncher({ locale, hasSupport = false }: { locale: string; hasSupport?: boolean }) {
  const t = useTranslations('feedbackBoard');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('ideas');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<LauncherItem[] | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [news, setNews] = useState<NewsEntry[]>([]);
  const [unread, setUnread] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  // Novedades: se cargan al montar para el badge. Primera visita: todo cuenta como visto.
  useEffect(() => {
    let alive = true;
    fetch(`/api/board/changelog?locale=${encodeURIComponent(locale)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { entries?: NewsEntry[] } | null) => {
        if (!alive || !data?.entries) return;
        setNews(data.entries);
        const ids = data.entries.map((e) => e.id);
        const seen = readSeen();
        if (seen === null) {
          writeSeen(ids);
          setUnread([]);
        } else {
          setUnread(ids.filter((id) => !seen.includes(id)));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [locale]);

  const search = useCallback(
    async (q: string) => {
      const params = new URLSearchParams({ sort: 'top', limit: '8' });
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`/api/board/items?${params.toString()}`).catch(() => null);
      const data = res?.ok ? ((await res.json().catch(() => null)) as { items?: LauncherItem[]; signedIn?: boolean } | null) : null;
      setItems(data?.items ?? []);
      setSignedIn(Boolean(data?.signedIn));
    },
    [],
  );

  // Búsqueda con debounce mientras el panel está abierto en "Ideas".
  useEffect(() => {
    if (!open || tab !== 'ideas') return;
    const id = setTimeout(() => void search(query), query ? 250 : 0);
    return () => clearTimeout(id);
  }, [open, tab, query, search]);

  // Email de la sesión (para no pedirlo en "Enviar").
  useEffect(() => {
    if (!open) return;
    fetch('/api/auth/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { user?: { email?: string } } | null) => setEmail(s?.user?.email ?? null))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // En el teléfono el botón tapa el texto de las filas: se esconde mientras
  // bajás y cuando el footer está a la vista; vuelve al subir.
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    let lastY = window.scrollY;
    let footerVisible = false;
    let frame = 0;
    const footer = document.querySelector('.site-footer');
    const io =
      footer && 'IntersectionObserver' in window
        ? new IntersectionObserver(([entry]) => {
            footerVisible = entry.isIntersecting;
            setTucked(mq.matches && footerVisible);
          })
        : null;
    if (footer && io) io.observe(footer);
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - lastY;
        lastY = y;
        if (!mq.matches) return setTucked(false);
        if (footerVisible) return setTucked(true);
        if (Math.abs(delta) < 4) return;
        setTucked(delta > 0 && y > 120);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      io?.disconnect();
    };
  }, []);

  function showNews() {
    setTab('news');
    if (unread.length > 0) {
      writeSeen([...(readSeen() ?? []), ...unread]);
      setUnread([]);
    }
  }

  const boardHref = `/${locale}/feedback-board`;
  const loginHref = `/${locale}/auth/signin?callbackUrl=${encodeURIComponent(`/${locale}${pathname}`)}`;
  const voteLabels = {
    upvote: t('vote.upvote'),
    voted: t('vote.voted'),
    error: t('vote.error'),
    loginToVote: t('vote.loginToVote'),
  };

  return (
    <div className={`fl-root${hasSupport ? ' has-support' : ''}${tucked && !open ? ' is-tucked' : ''}`} ref={panelRef}>
      {open && (
        <div className="fl-panel" role="dialog" aria-label={t('launcher.title')}>
          <div className="fl-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'ideas'} onClick={() => setTab('ideas')}>
              {t('launcher.tabs.ideas')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'send'} onClick={() => setTab('send')}>
              {t('launcher.tabs.send')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'news'} onClick={showNews}>
              {t('launcher.tabs.news')}
              {unread.length > 0 && <span className="fl-tab-dot" aria-label={t('launcher.unread', { count: unread.length })} />}
            </button>
          </div>

          {tab === 'ideas' && (
            <div className="fl-body">
              <input
                className="input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('launcher.searchPlaceholder')}
                aria-label={t('launcher.searchPlaceholder')}
                autoFocus
              />
              {items === null ? null : items.length === 0 ? (
                <p className="bp-hint">{query ? t('launcher.searchEmpty') : t('empty')}</p>
              ) : (
                <div>
                  {items.map((item) => (
                    <div key={item.id} className="fl-item">
                      <BoardVote
                        id={item.id}
                        votes={item.votes}
                        voted={item.voted}
                        closed={!ROADMAP_VOTABLE_STATUSES.includes(item.status)}
                        signedIn={signedIn}
                        loginHref={loginHref}
                        locale={locale}
                        labels={voteLabels}
                      />
                      <div>
                        <p className="fl-item-title">
                          <a href={`${boardHref}/i/${item.ref}`}>{item.title}</a>
                        </p>
                        <p className="bp-meta">
                          <span className="bp-status" data-status={item.status}>
                            {t(`status.${item.status}`)}
                          </span>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'send' && (
            <div className="fl-body">
              <FeedbackForm
                defaultProduct={productFromPath(`/${locale}${pathname}`)}
                signedInEmail={email}
                boardHref={boardHref}
                signedIn={signedIn}
                onDone={() => setOpen(false)}
              />
            </div>
          )}

          {tab === 'news' && (
            <div className="fl-body">
              {news.length === 0 ? (
                <p className="bp-hint">{t('launcher.newsEmpty')}</p>
              ) : (
                <ul className="fl-news">
                  {news.map((n) => (
                    <li key={n.id}>
                      <time dateTime={n.date}>{n.date}</time>
                      <a href={`/${locale}/changelog#${n.id}`}>{n.title}</a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="fl-foot">
            <a href={boardHref}>{t('launcher.seeBoard')}</a>
            <a href={`/${locale}/changelog`}>{t('launcher.seeChangelog')}</a>
          </div>
        </div>
      )}
      <button
        type="button"
        className="fl-button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? t('launcher.close') : t('launcher.open')}
        title={t('launcher.open')}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M3 3.5h12v8H8l-3.5 3v-3H3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        {unread.length > 0 && !open && <span className="fl-badge">{unread.length}</span>}
      </button>
    </div>
  );
}
