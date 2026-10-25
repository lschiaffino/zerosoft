'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ISSUE_SORTS, type IssueGroupBy, type IssueSort } from '@/lib/track-views';
import type { ViewType } from './ViewSwitcher';
import TrackIcon from './TrackIcon';
import { KeyMenu } from './IssueFilters';

export interface DisplayLabels {
  groupBy: string;
  sortBy: string;
  groups: Record<IssueGroupBy, string>;
  sorts: Record<IssueSort, string>;
}

/** Propiedades que se muestran en cada fila (Display properties de Linear). */
export const DISPLAY_PROPS = ['id', 'priority', 'status', 'labels', 'cycle', 'due', 'assignee', 'project', 'created'] as const;
export type DisplayProp = (typeof DISPLAY_PROPS)[number];
export const DEFAULT_DISPLAY_PROPS: DisplayProp[] = ['id', 'priority', 'status', 'labels', 'cycle', 'due', 'assignee', 'project'];

/** Propiedades visibles guardadas por persona (localStorage, con fallback). */
export function readDisplayProps(key: string, fallback: DisplayProp[] = DEFAULT_DISPLAY_PROPS): DisplayProp[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    return parsed.filter((p): p is DisplayProp => (DISPLAY_PROPS as readonly string[]).includes(p));
  } catch {
    return fallback;
  }
}

export function writeDisplayProps(key: string, props: DisplayProp[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(props));
  } catch {
    /* sin storage: queda en memoria */
  }
}

interface IssueDisplayOptionsProps {
  group: IssueGroupBy;
  /** Agrupados que ofrece la vista (el tablero no tiene "ninguno"; un team no agrupa por team). */
  groups: readonly IssueGroupBy[];
  sort: IssueSort;
  onGroupChange: (group: IssueGroupBy) => void;
  onSortChange: (sort: IssueSort) => void;
  labels: DisplayLabels;
  /** Lista / tablero (y calendario y cronograma como secundarios). */
  layout?: { value: ViewType; options: readonly ViewType[]; onChange: (v: ViewType) => void };
  /** "Sub-issues" (como Display options de Linear). */
  subIssues?: { show: boolean; onChange: (show: boolean) => void; label?: string };
  /** "Completed issues": mostrar u ocultar lo terminado y cancelado. */
  completed?: { show: boolean; onChange: (show: boolean) => void };
  properties?: { visible: DisplayProp[]; available: readonly DisplayProp[]; onChange: (props: DisplayProp[]) => void };
  /** Muestra el botón "Volver a lo predeterminado". */
  onReset?: () => void;
}

/** Grupo de opciones (agrupar, ordenar) como botón que despliega una lista de teclado. */
function Choice<T extends string>({
  label,
  value,
  options,
  optionLabel,
  onChange,
  testId,
}: {
  label: string;
  value: T;
  options: readonly T[];
  optionLabel: (v: T) => string;
  onChange: (v: T) => void;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <div
      className="track-display-row"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <span className="track-display-row-label">{label}</span>
      <span className="track-display-choice">
        <button
          ref={button}
          type="button"
          className="track-display-choice-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${label}: ${optionLabel(value)}`}
          onClick={() => setOpen((o) => !o)}
          data-testid={testId}
        >
          <span>{optionLabel(value)}</span>
          <TrackIcon name="chevronDown" size={10} />
        </button>
        {open && (
          <div className="track-display-choice-menu">
            <KeyMenu
              ariaLabel={label}
              searchable={false}
              items={options.map((o) => ({
                key: o,
                label: optionLabel(o),
                checked: o === value,
                testId: `${testId}-${o}`,
                onPick: () => {
                  onChange(o);
                  setOpen(false);
                  button.current?.focus();
                },
              }))}
            />
          </div>
        )}
      </span>
    </div>
  );
}

function Switch({ label, on, onChange, testId }: { label: string; on: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <div className="track-display-row">
      <span className="track-display-row-label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`track-display-switch${on ? ' is-on' : ''}`}
        onClick={() => onChange(!on)}
        data-testid={testId}
      >
        <span aria-hidden />
      </button>
    </div>
  );
}

/**
 * "Display" como en Linear: un botón junto a Filter que abre un panel con el
 * diseño (lista o tablero), agrupar, ordenar, sub-issues, completados y las
 * propiedades visibles de cada fila. Todo con teclado (Tab, flechas, Enter,
 * Esc cierra y devuelve el foco al botón).
 */
export default function IssueDisplayOptions({
  group,
  groups,
  sort,
  onGroupChange,
  onSortChange,
  labels,
  layout,
  subIssues,
  completed,
  properties,
  onReset,
}: IssueDisplayOptionsProps) {
  const t = useTranslations('track.ux.display');
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const layoutLabel = (v: ViewType) => t(v);

  return (
    <div
      className="track-display"
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className={`btn btn-ghost btn-sm track-display-btn${open ? ' is-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="track-display"
      >
        <TrackIcon name="settings" size={12} />
        {t('button')}
      </button>
      {open && (
        <div className="track-display-panel" role="dialog" aria-label={t('button')} ref={panel} data-testid="track-display-panel">
          {layout && (
            <div className="track-display-layouts" role="group" aria-label={t('layout')}>
              {layout.options.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`track-display-layout${v === layout.value ? ' is-on' : ''}${v === 'list' || v === 'board' ? '' : ' is-secondary'}`}
                  aria-pressed={v === layout.value}
                  onClick={() => layout.onChange(v)}
                  data-testid={`track-view-${v}`}
                >
                  <TrackIcon name={v === 'list' ? 'list' : v === 'board' ? 'views' : v === 'calendar' ? 'calendar' : 'plans'} size={14} />
                  <span>{layoutLabel(v)}</span>
                </button>
              ))}
            </div>
          )}
          <Choice
            label={t('grouping')}
            value={group}
            options={groups}
            optionLabel={(g) => labels.groups[g]}
            onChange={onGroupChange}
            testId="track-group-by"
          />
          <Choice
            label={t('ordering')}
            value={sort}
            options={ISSUE_SORTS}
            optionLabel={(s) => labels.sorts[s]}
            onChange={onSortChange}
            testId="track-sort-by"
          />
          {(subIssues || completed) && <div className="track-display-sep" />}
          {subIssues && (
            <Switch label={subIssues.label ?? t('showSub')} on={subIssues.show} onChange={subIssues.onChange} testId="track-show-subissues" />
          )}
          {completed && <Switch label={t('showCompleted')} on={completed.show} onChange={completed.onChange} testId="track-show-completed" />}
          {properties && (
            <>
              <div className="track-display-sep" />
              <p className="track-display-head">{t('properties')}</p>
              <div className="track-display-props" role="group" aria-label={t('properties')}>
                {properties.available.map((p) => {
                  const on = properties.visible.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      className={`track-display-prop${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() =>
                        properties.onChange(on ? properties.visible.filter((x) => x !== p) : [...properties.visible, p])
                      }
                      data-testid={`track-prop-${p}`}
                    >
                      {t(`prop.${p}`)}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {onReset && (
            <>
              <div className="track-display-sep" />
              <button type="button" className="btn btn-ghost btn-sm track-display-reset" onClick={onReset}>
                {t('reset')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
