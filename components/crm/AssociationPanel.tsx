'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useDismiss } from '@/components/groups/wa/useDismiss';
import CrmIcon from './CrmIcon';

export interface AssociationRecord {
  id: string;
  name: string;
  meta?: string;
  href?: string;
  /** Asociación primaria (se marca con texto, no con una pastilla). */
  primary?: boolean;
  /** Label actual de la asociación ('' = sin label). */
  label?: string;
}

export interface AssociationOption {
  id: string;
  value: string;
}

/** Las server actions pueden devolver { error } con un código crm.errors.* (ej. hierarchy_cycle). */
type ActionResult = void | { error?: string } | undefined;

interface AssociationPanelProps {
  title?: string;
  records: AssociationRecord[];
  options: AssociationOption[];
  onAssociate: (id: string) => ActionResult | Promise<ActionResult>;
  onRemove: (id: string) => ActionResult | Promise<ActionResult>;
  /** Si viene, las filas no primarias muestran "Make primary". */
  onSetPrimary?: (id: string) => ActionResult | Promise<ActionResult>;
  /** Si viene junto con labelOptions, cada fila tiene un selector de label. */
  onSetLabel?: (id: string, label: string) => ActionResult | Promise<ActionResult>;
  labelOptions?: Array<{ value: string; label: string }>;
  addLabel: string;
  removeLabel?: string;
  emptyLabel: string;
  busy?: boolean;
  count?: number;
  /** Acción "Crear …": va al pie del selector "+ Agregar". */
  action?: React.ReactNode;
  /**
   * Con esto, el selector busca en el server entre todos los registros que la
   * persona ve (no solo en `options`, que trae los primeros).
   */
  searchType?: 'contact' | 'company' | 'deal';
  /** Ids que el selector nunca ofrece (el propio registro, por ejemplo). */
  exclude?: string[];
}

/**
 * Panel genérico de asociación estilo HubSpot: filas de registros asociados
 * (primaria marcada con texto, label opcional, quitar) y "+ Agregar", que abre
 * un selector con búsqueda (en el server si hay `searchType`) y, al pie,
 * crear uno nuevo. El selector cierra con Esc y con un clic afuera.
 */
export default function AssociationPanel({
  title,
  records,
  options,
  onAssociate,
  onRemove,
  onSetPrimary,
  onSetLabel,
  labelOptions,
  addLabel,
  removeLabel,
  emptyLabel,
  busy,
  count,
  action,
  searchType,
  exclude = [],
}: AssociationPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const busyNow = busy || pending.size > 0;
  const associatedIds = new Set(records.map((r) => r.id));
  const excluded = new Set([...associatedIds, ...exclude]);
  const available = options.filter((o) => !excluded.has(o.id));
  const canAdd = available.length > 0 || !!action || !!searchType;

  async function wrap(action: () => ActionResult | Promise<ActionResult>, id: string) {
    setError(null);
    setPending((prev) => new Set(prev).add(id));
    try {
      const res = await action();
      if (res && typeof res === 'object' && res.error) {
        setError(t.has(`errors.${res.error}`) ? t(`errors.${res.error}` as 'errors.generic') : t('errors.generic'));
      } else {
        router.refresh();
      }
    } catch {
      setError(t('errors.generic'));
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div className="association-panel">
      {title && (
        <div className="assoc-head">
          <h2 className="assoc-title">{title}</h2>
          {count !== undefined && <span className="assoc-count num">{count}</span>}
        </div>
      )}

      {records.length === 0 ? (
        <p className="assoc-empty">{emptyLabel}</p>
      ) : (
        <ul className="assoc-list">
          {records.map((r) => (
            <li className={`assoc-row${pending.has(r.id) ? ' row-busy' : ''}`} key={r.id}>
              <span className="assoc-main">
                {r.href ? (
                  <Link href={r.href} className="assoc-name">
                    {r.name}
                  </Link>
                ) : (
                  <span className="assoc-name">{r.name}</span>
                )}
                {r.meta && <span className="assoc-meta">{r.meta}</span>}
              </span>
              {(r.primary !== undefined || (onSetLabel && labelOptions)) && (
                <span className="assoc-row-meta">
                  {r.primary ? (
                    <span className="assoc-primary">{t('assoc.primary')}</span>
                  ) : onSetPrimary ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busyNow}
                      onClick={() => wrap(() => onSetPrimary(r.id), r.id)}
                    >
                      {t('assoc.makePrimary')}
                    </button>
                  ) : null}
                  {onSetLabel && labelOptions && (
                    <select
                      className="select assoc-label-select"
                      value={r.label ?? ''}
                      disabled={busyNow}
                      aria-label={`${t('assoc.label')} ${r.name}`}
                      onChange={(e) => {
                        const v = e.target.value;
                        void wrap(() => onSetLabel(r.id, v), r.id);
                      }}
                    >
                      <option value="">{t('assoc.noLabel')}</option>
                      {labelOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                </span>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm assoc-remove"
                aria-label={`${removeLabel ?? t('assoc.remove')} ${r.name}`}
                title={removeLabel ?? t('assoc.remove')}
                disabled={busyNow || pending.has(r.id)}
                onClick={() => wrap(() => onRemove(r.id), r.id)}
              >
                <CrmIcon name="x" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!canAdd && <p className="muted assoc-none">{t('assoc.noneToAdd')}</p>}
      {canAdd && (
        <AssocPicker
          label={addLabel}
          options={available}
          searchType={searchType}
          exclude={[...excluded]}
          disabled={busyNow}
          onPick={(id) => void wrap(() => onAssociate(id), id)}
          footer={action}
        />
      )}

      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * "+ Agregar" y su selector: una búsqueda arriba, la lista (flechas y Enter)
 * y, al pie, crear uno nuevo. Sin texto muestra los primeros de `options`;
 * con texto busca en el server (`searchType`) o filtra `options`.
 */
function AssocPicker({
  label,
  options,
  searchType,
  exclude,
  disabled,
  onPick,
  footer,
}: {
  label: string;
  options: AssociationOption[];
  searchType?: 'contact' | 'company' | 'deal';
  exclude: string[];
  disabled?: boolean;
  onPick: (id: string) => void;
  footer?: React.ReactNode;
}) {
  const t = useTranslations('crm');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Array<{ id: string; name: string; meta?: string }> | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  // A lo sumo 200 en la URL (el registro propio va primero); los demás se sacan acá.
  const excludeKey = exclude.slice(-200).join(',');
  const excludeSet = new Set(exclude);

  function close(reason?: string) {
    setOpen(false);
    setQ('');
    setResults(null);
    if (reason === 'escape') {
      // El botón de la tarjeta ("+ Agregar" del encabezado) o el propio.
      const head = btn.current?.closest('.rec-card')?.querySelector<HTMLElement>('[data-testid="record-card-add"]');
      (head && head.offsetParent !== null ? head : btn.current)?.focus();
    }
  }
  useDismiss(open, (reason) => close(reason), [btn, pop]);

  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);

  // Búsqueda en el server, con una pausa corta mientras se escribe.
  useEffect(() => {
    if (!open || !searchType) return;
    const needle = q.trim();
    if (!needle) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      const qs = new URLSearchParams({ type: searchType, q: needle, exclude: excludeKey });
      fetch(`/api/crm/associations/search?${qs.toString()}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d: { results?: Array<{ id: string; name: string; meta?: string }> }) => {
          setResults(d.results ?? []);
          setActive(0);
          setLoading(false);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) {
            setResults([]);
            setLoading(false);
          }
        });
    }, 200);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [q, open, searchType, excludeKey]);

  const needle = q.trim().toLowerCase();
  const local = options
    .filter((o) => !needle || o.value.toLowerCase().includes(needle))
    .slice(0, 20)
    .map((o) => ({ id: o.id, name: o.value, meta: undefined as string | undefined }));
  const items = searchType && needle ? (results ?? []).filter((r) => !excludeSet.has(r.id)) : local;

  function pick(id: string) {
    close();
    onPick(id);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Mientras busca, los resultados son de la búsqueda anterior.
      if (loading) return;
      const it = items[active];
      if (it) pick(it.id);
    }
  }

  return (
    <div className="assoc-add-row assoc-picker-wrap">
      <button
        ref={btn}
        type="button"
        className="btn btn-ghost btn-sm assoc-add-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        data-card-add=""
        data-testid="assoc-add"
      >
        <CrmIcon name="plus" size={12} /> {t('record.cards.add')}
      </button>
      {open && (
        <div ref={pop} className="assoc-picker" role="dialog" aria-label={label} data-testid="assoc-picker">
          <input
            ref={input}
            className="input assoc-picker-search"
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items[active] ? `${listId}-${items[active].id}` : undefined}
            aria-label={label}
            placeholder={searchType ? t(`assoc.search.${searchType}`) : label}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            data-testid="assoc-picker-search"
          />
          <ul className="assoc-picker-list" role="listbox" id={listId} aria-label={label} aria-busy={loading || undefined}>
            {items.map((it, i) => (
              <li
                key={it.id}
                id={`${listId}-${it.id}`}
                role="option"
                aria-selected={i === active}
                className={`assoc-picker-item${i === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(it.id)}
                data-testid="assoc-picker-option"
              >
                <span className="assoc-picker-name">{it.name}</span>
                {it.meta && <span className="assoc-picker-meta">{it.meta}</span>}
              </li>
            ))}
          </ul>
          {!loading && items.length === 0 && <p className="assoc-picker-empty">{needle ? t('assoc.noMatches') : t('assoc.noneToAdd')}</p>}
          {loading && items.length === 0 && <p className="assoc-picker-empty">{t('assoc.searching')}</p>}
          {footer && <div className="assoc-picker-foot">{footer}</div>}
        </div>
      )}
    </div>
  );
}
