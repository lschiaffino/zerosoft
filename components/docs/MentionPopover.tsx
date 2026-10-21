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
  /** Crear el destino con la query como título (última opción de la lista). */
  create?: (title: string) => Promise<PageLinkCandidate | null>;
  /** Textos propios (Notes habla de notas, no de páginas). */
  labels?: { create: (query: string) => string; empty: string };
}

export default function MentionPopover({ query, style, onSelect, onClose, search, create, labels }: MentionPopoverProps) {
  const t = useTranslations('docs');
  const [pages, setPages] = useState<PageLinkCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [creating, setCreating] = useState(false);
  const trimmed = query.trim();
  // "Crear «query»" al final, salvo que ya haya uno con ese título exacto.
  const canCreate =
    Boolean(create) && trimmed !== '' && !loading &&
    !pages.some((p) => p.title.trim().toLowerCase() === trimmed.toLowerCase());
  const total = pages.length + (canCreate ? 1 : 0);

  const createAndSelect = async () => {
    if (!create || creating) return;
    setCreating(true);
    try {
      const created = await create(trimmed);
      if (created) onSelect(created);
    } finally {
      setCreating(false);
    }
  };

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
      if (!total) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % total : (a - 1 + total) % total));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const i = Math.min(active, total - 1);
        if (i < pages.length) onSelect(pages[i]);
        else void createAndSelect();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // El item activo queda visible dentro del scroll del popover.
  useEffect(() => {
    rootRef.current
      ?.querySelector('.docs-mention-item.sel')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!query.trim()) return null;

  const sel = Math.min(active, Math.max(0, total - 1));

  return (
    <div
      ref={rootRef}
      className="docs-mention-popover"
      style={style}
      onMouseDown={(e) => e.preventDefault()}
    >
      {loading ? (
        <div className="docs-mention-empty" aria-busy="true"><span className="ui-skeleton ui-skeleton-text" /></div>
      ) : pages.length === 0 && !canCreate ? (
        <div className="docs-mention-empty">{labels?.empty ?? t('mentions.noPages')}</div>
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
      {canCreate && (
        <button
          type="button"
          className={`docs-mention-item docs-mention-create${sel === pages.length ? ' sel' : ''}`}
          onMouseEnter={() => setActive(pages.length)}
          onClick={() => void createAndSelect()}
          disabled={creating}
          aria-busy={creating || undefined}
        >
          <span className="docs-mention-page" aria-hidden="true">
            <DocsGlyph name="plus" size={16} />
          </span>
          <span className="docs-mention-title">{labels ? labels.create(trimmed) : trimmed}</span>
        </button>
      )}
    </div>
  );
}
