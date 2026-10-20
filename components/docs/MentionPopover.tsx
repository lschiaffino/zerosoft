'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { PageLinkCandidate } from '@/lib/docs-page-links';
import DocsGlyph from './DocsGlyphs';

interface MentionPopoverProps {
  query: string;
  /** Posición fija (viewport) calculada por el editor a partir del caret. */
  style?: CSSProperties;
  onSelect: (page: PageLinkCandidate) => void;
  onClose: () => void;
  /** Buscador propio (Notes busca notas); sin esto, páginas de Docs. */
  search?: (query: string) => Promise<PageLinkCandidate[]>;
}

export default function MentionPopover({ query, style, onSelect, onClose, search }: MentionPopoverProps) {
  const t = useTranslations('docs');
  const [pages, setPages] = useState<PageLinkCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setPages([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const run = search
      ? search(query)
      : fetch(`/api/docs/search?q=${encodeURIComponent(query)}`)
          .then((r) => r.json())
          .then((data: { rows?: PageLinkCandidate[] }) => data.rows ?? []);
    run
      .then((rows) => alive && setPages(rows))
      .catch(() => alive && setPages([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query, search]);

  // Nueva query: la selección vuelve al primer resultado.
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Teclado en fase de captura (gana al keydown del editor): ↑/↓ navega,
  // Enter elige el activo, Esc cierra. El caret del editor no se mueve.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (!pages.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) =>
          e.key === 'ArrowDown' ? (a + 1) % pages.length : (a - 1 + pages.length) % pages.length,
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const page = pages[Math.min(active, pages.length - 1)];
        if (page) onSelect(page);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pages, active, onSelect, onClose]);

  // El item activo queda visible dentro del scroll del popover.
  useEffect(() => {
    rootRef.current
      ?.querySelector('.docs-mention-item.sel')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!query.trim()) return null;

  const sel = Math.min(active, Math.max(0, pages.length - 1));

  return (
    <div
      ref={rootRef}
      className="docs-mention-popover"
      style={style}
      onMouseDown={(e) => e.preventDefault()}
    >
      {loading ? (
        <div className="docs-mention-empty" aria-busy="true"><span className="ui-skeleton ui-skeleton-text" /></div>
      ) : pages.length === 0 ? (
        <div className="docs-mention-empty">{t('mentions.noPages')}</div>
      ) : (
        pages.map((page, i) => (
          <button
            key={page.id}
            type="button"
            className={`docs-mention-item${i === sel ? ' sel' : ''}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => onSelect(page)}
          >
            {page.icon ? (
              <span className="docs-mention-icon" aria-hidden="true">{page.icon}</span>
            ) : (
              <span className="docs-mention-page" aria-hidden="true">
                <DocsGlyph name="page" size={16} />
              </span>
            )}
            <span className="docs-mention-title">{page.title || t('untitled')}</span>
          </button>
        ))
      )}
    </div>
  );
}
