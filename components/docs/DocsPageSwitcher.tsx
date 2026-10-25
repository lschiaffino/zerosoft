'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { DocsPageSummary } from '@/lib/docs-types';
import { highlightParts, isPageSwitcherHotkey, searchTokens, type DocsSearchHit } from '@/lib/docs-search';
import DocsGlyph from './DocsGlyphs';
import DocsPageIcon from './DocsPageIcon';

/** Evento para abrirlo desde un botón (el del sidebar de Docs). */
export const DOCS_SWITCHER_EVENT = 'zs:docs-switcher';

interface SwitcherItem {
  id: string;
  title: string;
  icon: string | null;
  snippet: string | null;
  /** Fila de una base (se abre con ?row=). */
  row_id?: string | null;
}

function Highlighted({ text, tokens }: { text: string; tokens: string[] }) {
  return (
    <>
      {highlightParts(text, tokens).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

/**
 * Switcher de páginas de Docs (Cmd+P / Ctrl+P), como el "Quick find" de
 * Notion: sin texto muestra las páginas editadas hace poco; con texto busca
 * en títulos y en el contenido de los bloques y muestra el fragmento. Vive
 * solo dentro de Docs; el Cmd+K global (CommandSearch) sigue igual.
 */
export default function DocsPageSwitcher({ pages }: { pages: DocsPageSummary[] }) {
  const t = useTranslations('docs');
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SwitcherItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPageSwitcherHotkey(e)) return;
      // En Docs, Cmd+P abre el switcher en vez de imprimir (el PDF tiene su botón).
      e.preventDefault();
      setOpen((v) => !v);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(DOCS_SWITCHER_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(DOCS_SWITCHER_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      setQ('');
      setHits(null);
      setSel(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(id);
    }
    prevFocusRef.current?.focus?.();
    prevFocusRef.current = null;
  }, [open]);

  // Búsqueda con debounce; una respuesta vieja nunca pisa a la nueva.
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (!query) {
      setHits(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const id = window.setTimeout(() => {
      fetch(`/api/docs/search?content=1&q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((data: { rows?: DocsSearchHit[] }) => {
          setHits((data.rows ?? []).map((h) => ({ id: h.id, title: h.title, icon: h.icon, snippet: h.snippet, row_id: h.row_id })));
          setSel(0);
        })
        .catch(() => {})
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 150);
    return () => {
      ctrl.abort();
      window.clearTimeout(id);
    };
  }, [q, open]);

  const recent = useMemo<SwitcherItem[]>(
    () =>
      [...pages]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 8)
        .map((p) => ({ id: p.id, title: p.title, icon: p.icon, snippet: null })),
    [pages],
  );

  const items = hits ?? (q.trim() ? [] : recent);
  const tokens = useMemo(() => searchTokens(q), [q]);

  const go = useCallback(
    (item: SwitcherItem) => {
      setOpen(false);
      prevFocusRef.current = null;
      router.push(item.row_id ? `/app/docs/${item.id}?row=${encodeURIComponent(item.row_id)}` : `/app/docs/${item.id}`);
    },
    [router],
  );

  if (!open) return null;

  const listId = `${uid}-list`;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && items[sel]) {
      e.preventDefault();
      go(items[sel]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      inputRef.current?.focus();
    }
  };

  return (
    <div className="cmdk-backdrop" onMouseDown={() => setOpen(false)}>
      <div
        className="cmdk docs-switcher"
        role="dialog"
        aria-modal="true"
        aria-label={t('switcher.title')}
        data-testid="docs-switcher"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="cmdk-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items[sel] ? `${listId}-${sel}` : undefined}
          aria-autocomplete="list"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('switcher.placeholder')}
          aria-label={t('switcher.title')}
        />
        <div className="cmdk-results" role="listbox" id={listId} aria-label={t('switcher.title')}>
          {!q.trim() && recent.length > 0 && (
            <p className="cmdk-group" role="presentation">
              {t('switcher.recent')}
            </p>
          )}
          {loading && hits === null && <p className="cmdk-state">{t('switcher.loading')}</p>}
          {!loading && q.trim() && items.length === 0 && <p className="cmdk-state">{t('switcher.empty')}</p>}
          {!q.trim() && recent.length === 0 && <p className="cmdk-state">{t('switcher.noPages')}</p>}
          {items.map((item, i) => (
            <button
              key={`${item.id}:${item.row_id ?? ''}`}
              type="button"
              role="option"
              id={`${listId}-${i}`}
              aria-selected={i === sel}
              tabIndex={-1}
              className={`cmdk-item docs-switcher-item${i === sel ? ' sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => go(item)}
            >
              <span className="docs-switcher-icon" aria-hidden="true">
                <DocsPageIcon icon={item.icon} pageId={item.id} size={16} fallback />
              </span>
              <span className="docs-switcher-text">
                <span className="docs-switcher-title">
                  <Highlighted text={item.title || t('untitled')} tokens={tokens} />
                </span>
                {item.snippet && (
                  <span className="docs-switcher-snippet">
                    <Highlighted text={item.snippet} tokens={tokens} />
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
        <p className="docs-switcher-foot" aria-hidden="true">
          {t('switcher.hint')}
        </p>
      </div>
    </div>
  );
}
