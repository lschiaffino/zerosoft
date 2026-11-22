'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useDismiss } from '@/components/groups/wa/useDismiss';
import { CUSTOM_RANGE, DATE_PRESETS, NO_DATE, isDay } from '@/lib/crm-date-presets';

export interface QuickOption {
  value: string;
  label: string;
}

/**
 * Un filtro rápido de la fila de filtros del listado (como los de HubSpot:
 * Owner, Fecha de creación, Fecha de última actividad, Estado del lead…).
 * - `select`: una opción de una lista (con búsqueda si es larga);
 * - `date`: un rango relativo ("Últimos 7 días") o a medida (desde / hasta).
 */
export type QuickFilterDef =
  | {
      kind: 'select';
      id: string;
      param: string;
      label: string;
      value: string;
      options: QuickOption[];
    }
  | {
      kind: 'date';
      id: string;
      /** Param de la clave del rango (`created`); From/To van en `fromParam` / `toParam`. */
      param: string;
      fromParam: string;
      toParam: string;
      label: string;
      preset: string;
      from: string;
      to: string;
      /** Ofrece "Sin actividad" (registros sin fecha). */
      allowNone?: boolean;
    };

export type QuickPatch = Record<string, string | undefined>;

/** Con más opciones que esto, el menú trae un buscador. */
const SEARCH_FROM = 8;

/**
 * Fila de filtros rápidos: un botón por filtro que abre su menú debajo. El
 * menú cierra con Esc, con un clic afuera y al elegir. Elegir cambia la URL
 * (`onChange`); el listado se filtra en el server.
 */
export default function QuickFilters({ filters, onChange }: { filters: QuickFilterDef[]; onChange: (patch: QuickPatch) => void }) {
  return (
    <>
      {filters.map((f) => (
        <QuickFilterButton key={f.id} filter={f} onChange={onChange} />
      ))}
    </>
  );
}

function QuickFilterButton({ filter, onChange }: { filter: QuickFilterDef; onChange: (patch: QuickPatch) => void }) {
  const t = useTranslations('crm.listBar');
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const popId = useId();
  useDismiss(open, (reason) => {
    setOpen(false);
    if (reason === 'escape') btn.current?.focus();
  }, [wrap]);

  const locale = useLocale();
  const valueLabel = activeLabel(filter, (k, v) => t(k as 'presets.today', v), (d) => formatDay(d, locale));
  const pop = useRef<HTMLDivElement>(null);
  // Al abrir, el foco va al buscador o a la opción elegida (o la primera).
  useEffect(() => {
    if (!open) return;
    const el = pop.current;
    (el?.querySelector<HTMLElement>('.qf-search, [aria-selected="true"]') ?? el?.querySelector<HTMLElement>('button, input'))?.focus();
  }, [open]);
  const active = valueLabel !== null;

  function pick(patch: QuickPatch) {
    setOpen(false);
    onChange(patch);
    btn.current?.focus();
  }

  return (
    <div className={`qf${open ? ' is-open' : ''}`} ref={wrap} data-testid={`qf-${filter.id}`}>
      <button
        ref={btn}
        type="button"
        className={`qf-btn${active ? ' on' : ''}`}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="qf-label">{filter.label}</span>
        {active && <span className="qf-value">{valueLabel}</span>}
        <svg className="qf-chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="qf-pop" id={popId} role="dialog" aria-label={filter.label} ref={pop}>
          {filter.kind === 'select' ? (
            <SelectMenu filter={filter} onPick={pick} />
          ) : (
            <DateMenu filter={filter} onPick={pick} />
          )}
        </div>
      )}
    </div>
  );
}

/** El texto del valor elegido para el botón; null sin filtro. */
/** YYYY-MM-DD en el formato corto del idioma (sin mover de día: se lee en UTC). */
function formatDay(day: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
  } catch {
    return day;
  }
}

function activeLabel(
  filter: QuickFilterDef,
  t: (key: string, values?: Record<string, string>) => string,
  fmt: (day: string) => string,
): string | null {
  if (filter.kind === 'select') {
    if (!filter.value) return null;
    return filter.options.find((o) => o.value === filter.value)?.label ?? null;
  }
  if ((DATE_PRESETS as readonly string[]).includes(filter.preset)) return t(`presets.${filter.preset}`);
  if (filter.preset === NO_DATE && filter.allowNone) return t('presets.none');
  const from = isDay(filter.from) ? filter.from : '';
  const to = isDay(filter.to) ? filter.to : '';
  if (from && to) return t('range', { from: fmt(from), to: fmt(to) });
  if (from) return t('since', { date: fmt(from) });
  if (to) return t('until', { date: fmt(to) });
  return null;
}

function SelectMenu({ filter, onPick }: { filter: Extract<QuickFilterDef, { kind: 'select' }>; onPick: (patch: QuickPatch) => void }) {
  const t = useTranslations('crm.listBar');
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle ? filter.options.filter((o) => o.label.toLowerCase().includes(needle)) : filter.options;
  return (
    <>
      {filter.options.length > SEARCH_FROM && (
        <input
          className="input qf-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
        />
      )}
      <div className="qf-list" role="listbox" aria-label={filter.label}>
        {shown.map((o) => (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={filter.value === o.value}
            className="qf-opt"
            onClick={() => onPick({ [filter.param]: filter.value === o.value ? undefined : o.value })}
          >
            <span className="qf-check" aria-hidden="true">{filter.value === o.value ? <Check /> : null}</span>
            <span className="qf-opt-label">{o.label}</span>
          </button>
        ))}
        {shown.length === 0 && <p className="qf-empty">{t('noMatch')}</p>}
      </div>
      {filter.value && (
        <div className="qf-foot">
          <button type="button" className="qf-clear" onClick={() => onPick({ [filter.param]: undefined })}>
            {t('clear')}
          </button>
        </div>
      )}
    </>
  );
}

function DateMenu({ filter, onPick }: { filter: Extract<QuickFilterDef, { kind: 'date' }>; onPick: (patch: QuickPatch) => void }) {
  const t = useTranslations('crm.listBar');
  const isCustom = !filter.preset || filter.preset === CUSTOM_RANGE;
  const [from, setFrom] = useState(isCustom && isDay(filter.from) ? filter.from : '');
  const [to, setTo] = useState(isCustom && isDay(filter.to) ? filter.to : '');
  const presets: string[] = [...DATE_PRESETS, ...(filter.allowNone ? [NO_DATE] : [])];
  const clear: QuickPatch = { [filter.param]: undefined, [filter.fromParam]: undefined, [filter.toParam]: undefined };
  const hasValue = !!filter.preset || !!filter.from || !!filter.to;
  const badRange = !!from && !!to && from > to;
  return (
    <>
      <div className="qf-list" role="listbox" aria-label={filter.label}>
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            role="option"
            aria-selected={filter.preset === p}
            className="qf-opt"
            onClick={() => onPick({ ...clear, [filter.param]: filter.preset === p ? undefined : p })}
          >
            <span className="qf-check" aria-hidden="true">{filter.preset === p ? <Check /> : null}</span>
            <span className="qf-opt-label">{t(`presets.${p}` as 'presets.today')}</span>
          </button>
        ))}
      </div>
      <form
        className="qf-custom"
        onSubmit={(e) => {
          e.preventDefault();
          if ((!from && !to) || badRange) return;
          onPick({ [filter.param]: CUSTOM_RANGE, [filter.fromParam]: from || undefined, [filter.toParam]: to || undefined });
        }}
      >
        <span className="qf-custom-title">{t('custom')}</span>
        <label className="qf-date">
          <span>{t('from')}</span>
          <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="qf-date">
          <span>{t('to')}</span>
          <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="qf-foot">
          {hasValue && (
            <button type="button" className="qf-clear" onClick={() => onPick(clear)}>
              {t('clear')}
            </button>
          )}
          <button type="submit" className="btn btn-primary btn-sm" disabled={(!from && !to) || badRange}>
            {t('apply')}
          </button>
        </div>
      </form>
    </>
  );
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}
