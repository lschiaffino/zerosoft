'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

/** Un GIF del buscador (lo que devuelve /api/<app>/gifs; ver lib/wa-gifs.ts). */
export interface GifItem {
  id: string;
  title: string;
  preview: string;
  width: number;
  height: number;
  mp4: string;
  size?: number;
}

/** Lo que el panel de emojis necesita para mostrar la pestaña GIFs. */
export interface GifTab {
  /** /api/groups/gifs (Lines) o /api/inbox/gifs (Inbox). */
  api: string;
  /** Mandar al chat abierto. '' si salió; si no, el código de error. */
  onSend: (g: GifItem) => Promise<string>;
}

type Provider = 'giphy' | 'tenor' | 'fake' | null;
interface Page {
  provider: Provider;
  items: GifItem[];
  next: string;
}

/** Las categorías de WhatsApp: Tendencias y términos sugeridos (cada idioma busca su palabra). */
const CATS = ['trending', 'haha', 'sad', 'love', 'reaction', 'sports', 'tv'] as const;
const DEBOUNCE_MS = 300;
const COL_MIN = 112;
const GAP = 4;
/** Alto/ancho de los lugares mientras carga, por columna. */
const SKELETON = [
  [0.75, 1.2, 0.6, 0.9],
  [1, 0.65, 1.1, 0.8],
  [0.6, 0.95, 0.75, 1.15],
];

/**
 * Pestaña GIFs del panel de emojis, como en WhatsApp: búsqueda (en el idioma
 * de la persona), tendencias cuando está vacía, categorías, grilla tipo
 * mosaico con vistas previas animadas chicas (se cargan al verse) y un clic
 * lo manda como GIF (MP4 con gifPlayback). La búsqueda pasa por el servidor:
 * la clave de GIPHY o Tenor no llega al navegador.
 */
export default function GifPanel({ api, onSend, onSent }: GifTab & { onSent?: () => void }) {
  const t = useTranslations('groups.wa.gifs');
  const locale = useLocale();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState('');
  const [width, setWidth] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    searchRef.current?.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  // La búsqueda sale después de una pausa al escribir.
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(q.trim()), q.trim() ? DEBOUNCE_MS : 0);
    return () => window.clearTimeout(id);
  }, [q]);

  const fetchPage = useCallback(
    async (pos: string): Promise<Page | 'rate_limited' | null> => {
      try {
        const sp = new URLSearchParams({ q: query, pos, locale });
        const res = await fetch(`${api}?${sp}`);
        if (res.status === 429) return 'rate_limited';
        if (!res.ok) return null;
        return (await res.json()) as Page;
      } catch {
        return null;
      }
    },
    [api, query, locale],
  );

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setError('');
    const r = await fetchPage('');
    if (!alive.current || my !== seq.current) return;
    setLoading(false);
    if (r === 'rate_limited' || !r) {
      setError(r === 'rate_limited' ? t('rateLimited') : t('loadFailed'));
      return;
    }
    setPage(r);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [fetchPage, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!page?.next || more || loading) return;
    const my = seq.current;
    setMore(true);
    const r = await fetchPage(page.next);
    if (!alive.current || my !== seq.current) return;
    setMore(false);
    if (r && r !== 'rate_limited') setPage((p) => (p ? { ...r, items: [...p.items, ...r.items.filter((x) => !p.items.some((y) => y.id === x.id))] } : r));
  }, [page, more, loading, fetchPage]);

  // Más resultados al llegar al final de la grilla.
  useEffect(() => {
    const el = endRef.current;
    const root = scrollRef.current;
    if (!el || !root || !page?.next || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), { root, rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [page, loadMore]);

  // Columnas del mosaico según el ancho del panel.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(2, Math.floor((width + GAP) / (COL_MIN + GAP)) || 2);
  const columns = useMemo(() => {
    // Cada GIF va a la columna más corta (por proporción): el orden no salta al cargar más.
    const out: GifItem[][] = Array.from({ length: cols }, () => []);
    const heights = new Array<number>(cols).fill(0);
    for (const g of page?.items ?? []) {
      const i = heights.indexOf(Math.min(...heights));
      out[i].push(g);
      heights[i] += g.height / g.width + 0.05;
    }
    return out;
  }, [page, cols]);

  async function send(g: GifItem) {
    if (sending) return;
    setSending(g.id);
    setSendError('');
    const err = await onSend(g);
    if (!alive.current) return;
    setSending('');
    if (!err) onSent?.();
    else setSendError(err === 'gif_too_large' ? t('tooLarge') : t('sendFailed'));
  }

  const provider = page?.provider;
  const notSetUp = page !== null && provider === null;
  const term = (c: (typeof CATS)[number]) => (c === 'trending' ? '' : t(`terms.${c}`));
  const activeCat = CATS.find((c) => term(c).toLowerCase() === q.trim().toLowerCase());
  const placeholder = provider === 'giphy' ? t('searchGiphy') : provider === 'tenor' ? t('searchTenor') : t('search');

  if (notSetUp) {
    return (
      <div className="wa-gif-panel">
        <div className="wa-stk-empty wa-gif-unset" role="status">
          <p className="wa-stk-empty-title">{t('notSetupTitle')}</p>
          <p>{t('notSetupBody')}</p>
        </div>
      </div>
    );
  }

  const skeleton = Array.from({ length: cols }, (_, c) => (
    <div key={c} className="wa-gif-col">
      {SKELETON[c % SKELETON.length].map((r, i) => (
        <span key={i} className="wa-gif-skel" style={{ aspectRatio: `1 / ${r}` }} />
      ))}
    </div>
  ));

  return (
    <div className="wa-gif-panel">
      <input
        ref={searchRef}
        className="wa-emoji-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={50}
      />
      <div className="wa-gif-cats" role="group" aria-label={t('categories')}>
        {CATS.map((c) => (
          <button key={c} type="button" aria-pressed={activeCat === c} onClick={() => setQ(term(c))}>
            {t(`cats.${c}`)}
          </button>
        ))}
      </div>
      {sendError && (
        <p className="wa-stk-error" role="alert">
          {sendError}
        </p>
      )}
      <div className="wa-gif-scroll" ref={scrollRef}>
        {error ? (
          <div className="wa-stk-empty" role="alert">
            <p>{error}</p>
            <button type="button" className="wa-stk-action" onClick={() => void load()}>
              {t('retry')}
            </button>
          </div>
        ) : loading && !page ? (
          <div className="wa-gif-grid" aria-busy="true" aria-label={t('loading')}>
            {skeleton}
          </div>
        ) : page && page.items.length === 0 ? (
          <p className="wa-emoji-empty">{t('none', { q: query })}</p>
        ) : (
          <div className="wa-gif-grid" aria-busy={loading || undefined} aria-label={query ? t('results') : t('cats.trending')}>
            {columns.map((col, c) => (
              <div key={c} className="wa-gif-col">
                {col.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className="wa-gif-tile"
                    data-gif={g.id}
                    style={{ aspectRatio: `${g.width} / ${g.height}` }}
                    onClick={() => void send(g)}
                    aria-label={g.title ? t('send', { title: g.title }) : t('sendUntitled')}
                    title={g.title || undefined}
                    aria-busy={sending === g.id || undefined}
                    disabled={!!sending && sending !== g.id}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={g.preview} alt="" loading="lazy" decoding="async" draggable={false} referrerPolicy="no-referrer" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        <div ref={endRef} className="wa-gif-end" aria-hidden="true">
          {more ? '…' : ''}
        </div>
      </div>
      {provider && <p className="wa-gif-attrib">{provider === 'giphy' ? t('poweredGiphy') : provider === 'tenor' ? t('poweredTenor') : t('poweredFake')}</p>}
    </div>
  );
}
