'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useDismiss } from '@/components/groups/wa/useDismiss';
import { QUICK_FILTERS, quickFiltersParam, type QuickFilterEntity } from '@/lib/crm-quick-filters';

/**
 * "Editar filtros rápidos", como en HubSpot: elegir qué filtros muestra la
 * fila de esta vista. Va a la URL (`qf`) y se guarda con la vista. Cierra
 * con Esc (vuelve el foco al botón) y con un clic afuera.
 */
export default function QuickFilterPicker({
  entity,
  shown,
  labels,
  onChange,
}: {
  entity: QuickFilterEntity;
  /** Los que la fila muestra ahora, en orden. */
  shown: string[];
  labels: Record<string, string>;
  /** Nuevo valor de `qf` (undefined = los de fábrica). */
  onChange: (qf: string | undefined) => void;
}) {
  const t = useTranslations('crm.quickFilterPicker');
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const popId = useId();
  useDismiss(open, (reason) => {
    setOpen(false);
    if (reason === 'escape') btn.current?.focus();
  }, [btn, pop]);

  // Al abrir, el foco va a la primera opción.
  useEffect(() => {
    if (open) pop.current?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
  }, [open]);

  function toggle(id: string) {
    const next = shown.includes(id) ? shown.filter((x) => x !== id) : [...shown, id];
    onChange(quickFiltersParam(entity, next));
  }

  return (
    <div className="dr-filter qf-picker">
      <button
        ref={btn}
        type="button"
        className="filter-more qf-picker-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen((v) => !v)}
        data-testid="quick-filter-picker"
        aria-label={t('button')}
        title={t('button')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="18" cy="18" r="2" />
        </svg>
      </button>
      {open && (
        <div ref={pop} id={popId} role="dialog" aria-label={t('title')} className="record-more-menu dr-filter-menu qf-picker-menu" data-testid="quick-filter-picker-menu">
          <p className="qf-picker-title">{t('title')}</p>
          <ul className="qf-picker-list">
            {QUICK_FILTERS[entity].map((id) => (
              <li key={id}>
                <label className="qf-picker-item">
                  <input type="checkbox" checked={shown.includes(id)} onChange={() => toggle(id)} data-testid={`quick-filter-toggle-${id}`} />
                  <span>{labels[id] ?? id}</span>
                </label>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(undefined)} data-testid="quick-filter-reset">
            {t('reset')}
          </button>
        </div>
      )}
    </div>
  );
}
