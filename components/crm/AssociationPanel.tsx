'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';

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
}

/**
 * Panel genérico de asociación estilo HubSpot/Twenty: filas de registros
 * asociados (primaria marcada, label opcional, quitar) y un selector para
 * asociar uno existente.
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
}: AssociationPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const busyNow = busy || pending.size > 0;
  const associatedIds = new Set(records.map((r) => r.id));
  const available = options.filter((o) => !associatedIds.has(o.id));

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
                    <span className="badge badge-ink">{t('assoc.primary')}</span>
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <select
          className="select assoc-add"
          value=""
          disabled={busyNow}
          aria-label={addLabel}
          onChange={(e) => {
            const id = e.target.value;
            e.target.value = '';
            if (id) void wrap(() => onAssociate(id), id);
          }}
        >
          <option value="">{addLabel}</option>
          {available.map((o) => (
            <option key={o.id} value={o.id}>
              {o.value}
            </option>
          ))}
        </select>
      )}

      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
