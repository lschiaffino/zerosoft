'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { AddPipelineChip } from './AddPipelineStage';

interface PipelineMenuProps {
  current: string;
  /** Pipelines con su link (conserva vista y pestaña activas). */
  pipelines: Array<{ id: string; name: string; href: { pathname: string; query: Record<string, string> } }>;
  currentId: string;
}

/**
 * Selector de pipeline del listado de deals (como en HubSpot, al lado del
 * cambio tabla/board). Esc y el click afuera lo cierran.
 */
export default function PipelineMenu({ current, pipelines, currentId }: PipelineMenuProps) {
  const t = useTranslations('crm');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        btnRef.current?.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      if (!items.length) return;
      e.preventDefault();
      const idx = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      items[next]?.focus();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    menuRef.current?.querySelector<HTMLElement>('[aria-current="page"], [role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="pipe-menu" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="filter-select filter-btn pipe-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('deals.pipelineLabel')}: ${current}`}
        onClick={() => setOpen((v) => !v)}
        data-testid="pipeline-menu"
      >
        {current}
      </button>
      {open && (
        <div ref={menuRef} className="pipe-menu-list" role="menu" aria-label={t('deals.pipelineLabel')}>
          {pipelines.map((p) => (
            <Link
              key={p.id}
              href={p.href}
              role="menuitem"
              className="pipe-menu-item"
              aria-current={p.id === currentId ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              {p.name}
            </Link>
          ))}
          <div className="pipe-menu-add">
            <AddPipelineChip />
          </div>
        </div>
      )}
    </div>
  );
}
