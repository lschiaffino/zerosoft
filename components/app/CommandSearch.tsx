'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface ResultItem {
  group: string;
  label: string;
  meta: string;
  href: string;
}

interface SearchResponse {
  q: string;
  items: ResultItem[];
}

function useGroupOrder() {
  return useMemo(() => ['actions', 'contacts', 'companies', 'deals', 'links', 'docs', 'tasks'], []);
}

function useGroupLabel(t: (key: string) => string) {
  return useCallback(
    (group: string) => {
      if (group === 'actions') return t('actions');
      const key = `group${group.charAt(0).toUpperCase()}${group.slice(1)}`;
      return t(key);
    },
    [t],
  );
}

/**
 * Búsqueda global estilo ⌘K (Twenty/Linear). Se abre con ⌘K / Ctrl+K o con el
 * evento 'zs:open-search' (botón de la sidebar). Busca en todos los productos
 * usando la API unificada /api/search.
 */
export default function CommandSearch() {
  const t = useTranslations('common.sidebar');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const groupOrder = useGroupOrder();
  const groupLabel = useGroupLabel(t);

  // Acciones rápidas globales: se muestran cuando no hay query.
  const actionItems = useMemo<ResultItem[]>(() => {
    const group = 'actions';
    return [
      { group, label: t('newContact'), meta: '', href: '/app/crm/contacts/new' },
      { group, label: t('newCompany'), meta: '', href: '/app/crm/companies/new' },
      { group, label: t('newDeal'), meta: '', href: '/app/crm/deals/new' },
      { group, label: t('newTask'), meta: '', href: '/app/crm/tasks' },
      { group, label: t('newLink'), meta: '', href: '/app/links/new' },
      { group, label: t('newDocPage'), meta: '', href: '/app/docs/new' },
      { group, label: t('newEventType'), meta: '', href: '/app/calendar/event-types/new' },
    ];
  }, [t]);

  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('zs:open-search', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('zs:open-search', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setItems(actionItems);
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, actionItems]);

  const search = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setItems(actionItems);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = (await res.json()) as SearchResponse;
        const sorted = [...(data.items ?? [])].sort(
          (a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group),
        );
        setItems(sorted);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
        setSel(0);
      }
    },
    [actionItems],
  );

  useEffect(() => {
    const id = setTimeout(() => search(q), 200);
    return () => clearTimeout(id);
  }, [q, search]);

  function go(item: ResultItem) {
    setOpen(false);
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, items.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    }
    if (e.key === 'Enter' && items[sel]) go(items[sel]);
  }

  if (!open) return null;

  let lastGroup = '';
  return (
    <div className="cmdk-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('searchPlaceholder')}
          aria-label={t('search')}
        />
        <div className="cmdk-results">
          {loading && <p className="cmdk-state">{t('searchLoading')}</p>}
          {!loading && q.trim() && items.length === 0 && (
            <p className="cmdk-state">{t('searchEmpty')}</p>
          )}
          {!loading &&
            items.map((item, i) => {
              const header =
                item.group !== lastGroup ? (
                  <p className="cmdk-group" key={`g-${item.group}`}>
                    {groupLabel(item.group)}
                  </p>
                ) : null;
              lastGroup = item.group;
              return (
                <div key={`${item.href}-${i}`}>
                  {header}
                  <button
                    type="button"
                    className={`cmdk-item${i === sel ? ' sel' : ''}`}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(item)}
                  >
                    <span>{item.label}</span>
                    <span className="cmdk-meta">{item.meta}</span>
                  </button>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
