'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/** Rangos rápidos: pasados (creación, actividad) o por venir (fecha de cierre). */
const PRESETS = {
  past: ['today', 'last7', 'last30', 'thisMonth', 'lastMonth'],
  future: ['thisMonth', 'nextMonth', 'thisQuarter', 'next30', 'overdue'],
} as const;
type Preset = (typeof PRESETS)['past'][number] | (typeof PRESETS)['future'][number];

const pad = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Días (YYYY-MM-DD, en la hora local) de un rango rápido. Exportado para los unitarios. */
export function presetRange(preset: Preset, now = new Date()): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const plus = (n: number) => new Date(y, m, now.getDate() + n);
  switch (preset) {
    case 'today':
      return { from: day(now), to: day(now) };
    case 'last7':
      return { from: day(plus(-6)), to: day(now) };
    case 'last30':
      return { from: day(plus(-29)), to: day(now) };
    case 'next30':
      return { from: day(now), to: day(plus(29)) };
    case 'thisMonth':
      return { from: day(new Date(y, m, 1)), to: day(new Date(y, m + 1, 0)) };
    case 'lastMonth':
      return { from: day(new Date(y, m - 1, 1)), to: day(new Date(y, m, 0)) };
    case 'nextMonth':
      return { from: day(new Date(y, m + 1, 1)), to: day(new Date(y, m + 2, 0)) };
    case 'thisQuarter': {
      const q = Math.floor(m / 3) * 3;
      return { from: day(new Date(y, q, 1)), to: day(new Date(y, q + 3, 0)) };
    }
    case 'overdue':
      return { from: '', to: day(plus(-1)) };
  }
}

interface DateRangeFilterProps {
  /** Nombre de la propiedad (botón y título del menú). */
  label: string;
  kind: 'past' | 'future';
  from: string;
  to: string;
  locale: string;
  onChange: (from: string, to: string) => void;
  testId?: string;
}

/**
 * Filtro rápido por fecha (como "Create date" o "Close date" en HubSpot): un
 * botón que abre rangos rápidos y un rango a medida. Esc y el click afuera lo cierran.
 */
export default function DateRangeFilter({ label, kind, from, to, locale, onChange, testId }: DateRangeFilterProps) {
  const t = useTranslations('crm.dateFilter');
  const [open, setOpen] = useState(false);
  /** Corrimiento del menú (px, desde el borde izquierdo del botón) para que entre en la pantalla. */
  const [shift, setShift] = useState(0);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    setDraftFrom(from);
    setDraftTo(to);
  }, [from, to]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    menuRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // El menú arranca en el botón y se corre lo justo para quedar entero en la pantalla (teléfono).
  useLayoutEffect(() => {
    if (!open || !btnRef.current || !menuRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const w = menuRef.current.offsetWidth;
    setShift(Math.max(8, Math.min(r.left, window.innerWidth - 8 - w)) - r.left);
  }, [open]);

  const fmt = (d: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
    } catch {
      return d;
    }
  };
  const active = !!(from || to);
  const summary = from && to ? (from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`) : from ? `≥ ${fmt(from)}` : to ? `≤ ${fmt(to)}` : '';

  function apply(f: string, tt: string) {
    setOpen(false);
    onChange(f, tt);
  }

  return (
    <div className="dr-filter" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={`filter-select filter-btn dr-filter-btn${active ? ' on' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        data-testid={testId}
      >
        {label}
        {active && <span className="dr-filter-value">: {summary}</span>}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="dialog"
          aria-label={label}
          className="dr-filter-menu"
          style={{ left: shift }}
          data-testid={testId ? `${testId}-menu` : undefined}
        >
          <div className="dr-filter-presets">
            {PRESETS[kind].map((p) => {
              const r = presetRange(p);
              const on = r.from === from && r.to === to;
              return (
                <button key={p} type="button" className={`dr-filter-preset${on ? ' on' : ''}`} aria-pressed={on} onClick={() => apply(r.from, r.to)}>
                  {t(`presets.${p}`)}
                </button>
              );
            })}
          </div>
          <form
            className="dr-filter-custom"
            onSubmit={(e) => {
              e.preventDefault();
              apply(draftFrom, draftTo);
            }}
          >
            <label className="dr-filter-field">
              <span>{t('from')}</span>
              <input className="input" type="date" value={draftFrom} max={draftTo || undefined} onChange={(e) => setDraftFrom(e.target.value)} />
            </label>
            <label className="dr-filter-field">
              <span>{t('to')}</span>
              <input className="input" type="date" value={draftTo} min={draftFrom || undefined} onChange={(e) => setDraftTo(e.target.value)} />
            </label>
            <div className="dr-filter-actions">
              {active && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply('', '')}>
                  {t('clear')}
                </button>
              )}
              <button type="submit" className="btn btn-secondary btn-sm">
                {t('apply')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
