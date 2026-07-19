'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

interface ResultItem {
  group: string;
  label: string;
  meta: string;
  href: string;
}

interface CrmSearchResponse {
  contacts?: Array<{ id: string; first_name: string; last_name: string; email: string }>;
  companies?: Array<{ id: string; name: string; domain: string }>;
  deals?: Array<{ id: string; name: string; amount: number; currency: string }>;
}

interface LinksResponse {
  links?: Array<{ id: string; slug: string; url: string; title: string | null; clicks: number }>;
}

/**
 * Búsqueda global estilo ⌘K (Twenty/Linear). Se abre con ⌘K / Ctrl+K o con el
 * evento 'zs:open-search' (botón de la sidebar). En CRM pega contra
 * /api/crm/search; en Link contra /api/links?q=.
 */
export default function CommandSearch() {
  const t = useTranslations('common.sidebar');
  const tc = useTranslations('crm');
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const product = pathname.includes('/app/crm') ? 'crm' : 'link';

  // Acciones rápidas (estilo Linear): se muestran cuando no hay query.
  const actionItems = useMemo<ResultItem[]>(() => {
    const group = t('actions');
    if (product === 'crm') {
      return [
        { group, label: t('newContact'), meta: '', href: '/app/crm/contacts/new' },
        { group, label: t('newCompany'), meta: '', href: '/app/crm/companies/new' },
        { group, label: t('newDeal'), meta: '', href: '/app/crm/deals/new' },
        { group, label: t('newTask'), meta: '', href: '/app/crm/tasks' },
      ];
    }
    return [{ group, label: t('newLink'), meta: '', href: '/app/links/new' }];
  }, [product, t]);

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
        if (product === 'crm') {
          const res = await fetch(`/api/crm/search?q=${encodeURIComponent(query)}`);
          const data = (await res.json()) as CrmSearchResponse;
          const out: ResultItem[] = [];
          for (const c of data.contacts ?? []) {
            out.push({
              group: tc('tabs.contacts'),
              label: `${c.first_name} ${c.last_name}`.trim() || c.email,
              meta: c.email,
              href: `/app/crm/contacts/${c.id}`,
            });
          }
          for (const c of data.companies ?? []) {
            out.push({
              group: tc('tabs.companies'),
              label: c.name,
              meta: c.domain,
              href: `/app/crm/companies/${c.id}`,
            });
          }
          for (const d of data.deals ?? []) {
            out.push({
              group: tc('tabs.deals'),
              label: d.name,
              meta: `${d.currency} ${d.amount}`,
              href: `/app/crm/deals/${d.id}`,
            });
          }
          setItems(out);
        } else {
          const res = await fetch(`/api/links?q=${encodeURIComponent(query)}&pageSize=8`);
          const data = (await res.json()) as LinksResponse;
          setItems(
            (data.links ?? []).map((l) => ({
              group: 'Links',
              label: l.title || l.slug,
              meta: `/${l.slug} → ${l.url}`,
              href: `/app/links/${l.id}`,
            })),
          );
        }
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
        setSel(0);
      }
    },
    [product, tc, actionItems],
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
          placeholder={product === 'crm' ? t('searchPlaceholder') : t('searchPlaceholderLinks')}
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
                    {item.group}
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
