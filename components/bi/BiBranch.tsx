'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { useShellBranch } from '@/components/app/useShellBranch';
import { BI_CHANGED } from './client';

interface Item {
  id: string;
  kind: 'question' | 'dashboard';
  name: string;
}

/**
 * Tableros y preguntas en el sidebar, colgando de "Explorar": primero los
 * tableros, después las preguntas más nuevas. Se recarga al navegar y cuando
 * algo cambia; el abierto queda marcado.
 */
export default function BiBranch() {
  const t = useTranslations('bi.nav');
  const pathname = usePathname();
  const slot = useShellBranch();
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/bi/items', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<{ items: Item[] }>) : null))
        .then((d) => {
          if (alive && d) setItems(d.items);
        })
        .catch(() => null);
    void load();
    window.addEventListener(BI_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(BI_CHANGED, load);
    };
  }, [pathname]);

  if (!slot || !items) return null;
  const dashboards = items.filter((i) => i.kind === 'dashboard').slice(0, 15);
  const questions = items.filter((i) => i.kind === 'question').slice(0, 15);
  const row = (i: Item) => {
    const href = `/app/analytics/${i.kind === 'dashboard' ? 'dashboards' : 'questions'}/${i.id}`;
    const active = pathname === href;
    return (
      <li key={i.id} className={`docs-tree-row${active ? ' active' : ''}`}>
        <span className="docs-tree-chevron-spacer" aria-hidden="true" />
        <Link href={href} className="docs-tree-link" aria-current={active ? 'page' : undefined}>
          <span className="docs-tree-icon" aria-hidden="true">
            {i.kind === 'dashboard' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="3" width="8" height="8" />
                <rect x="13" y="3" width="8" height="5" />
                <rect x="13" y="10" width="8" height="11" />
                <rect x="3" y="13" width="8" height="8" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 20V10M10 20V4M16 20v-7" />
              </svg>
            )}
          </span>
          <span className="docs-tree-title">{i.name}</span>
        </Link>
      </li>
    );
  };
  return createPortal(
    <nav className="docs-branch" aria-label={t('branch')} data-testid="bi-branch">
      {items.length === 0 ? (
        <p className="docs-sidebar-empty">{t('branchEmpty')}</p>
      ) : (
        <ul className="docs-tree" role="list">
          {dashboards.map(row)}
          {questions.map(row)}
        </ul>
      )}
    </nav>,
    slot,
  );
}
