'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import DocsGlyph from './DocsGlyphs';
import { DOCS_FAVORITES_EVENT, type DocsFavoriteRow } from './favorites';

/**
 * Estrella de la barra de la página: agrega o quita de Favoritos (como en
 * Notion). El sidebar se entera por evento, sin recargar.
 */
export default function DocsFavoriteButton({ pageId, initial }: { pageId: string; initial: boolean }) {
  const t = useTranslations('docs');
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => setOn(initial), [initial, pageId]);
  useEffect(() => {
    const sync = (e: Event) => {
      const rows = (e as CustomEvent<DocsFavoriteRow[]>).detail;
      if (Array.isArray(rows)) setOn(rows.some((r) => r.id === pageId));
    };
    window.addEventListener(DOCS_FAVORITES_EVENT, sync);
    return () => window.removeEventListener(DOCS_FAVORITES_EVENT, sync);
  }, [pageId]);

  const toggle = async () => {
    const next = !on;
    setOn(next);
    setBusy(true);
    setError(false);
    const res = await fetch(next ? '/api/docs/favorites' : `/api/docs/favorites?page_id=${encodeURIComponent(pageId)}`, {
      method: next ? 'POST' : 'DELETE',
      headers: next ? { 'Content-Type': 'application/json' } : undefined,
      body: next ? JSON.stringify({ page_id: pageId }) : undefined,
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setOn(!next);
      setError(true);
      return;
    }
    const data = (await res.json().catch(() => null)) as { rows?: DocsFavoriteRow[] } | null;
    if (data?.rows) window.dispatchEvent(new CustomEvent(DOCS_FAVORITES_EVENT, { detail: data.rows }));
  };

  const label = error ? t('favorites.error') : on ? t('editor.unfavorite') : t('editor.favorite');
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-sm btn-icon docs-top-btn docs-favorite-btn${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={toggle}
      disabled={busy}
      data-testid="docs-favorite-button"
    >
      <DocsGlyph name={on ? 'starFilled' : 'star'} size={16} />
    </button>
  );
}
