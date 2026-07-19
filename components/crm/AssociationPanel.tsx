'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';

export interface AssociationRecord {
  id: string;
  name: string;
  meta?: string;
  href?: string;
}

export interface AssociationOption {
  id: string;
  value: string;
}

interface AssociationPanelProps {
  title?: string;
  records: AssociationRecord[];
  options: AssociationOption[];
  onAssociate: (id: string) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  addLabel: string;
  removeLabel?: string;
  emptyLabel: string;
  busy?: boolean;
  count?: number;
}

/**
 * Panel genérico de asociación estilo HubSpot/Twenty:
 * chips de registros asociados con botón ✕, y un selector para asociar existente.
 */
export default function AssociationPanel({
  title,
  records,
  options,
  onAssociate,
  onRemove,
  addLabel,
  removeLabel,
  emptyLabel,
  busy,
  count,
}: AssociationPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);

  const busyNow = busy || pending.size > 0;
  const associatedIds = new Set(records.map((r) => r.id));
  const available = options.filter((o) => !associatedIds.has(o.id));

  async function wrap(action: () => void | Promise<void>, id: string) {
    setError(false);
    setPending((prev) => new Set(prev).add(id));
    try {
      await action();
      router.refresh();
    } catch {
      setError(true);
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
        <div className="panel-head">
          <h2 className="section-label">{title}</h2>
          {count !== undefined && <span className="panel-more">{count}</span>}
        </div>
      )}

      {records.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        <div className="chip-list">
          {records.map((r) => (
            <span className="chip-contact" key={r.id}>
              {r.href ? (
                <Link href={r.href}>{r.name}</Link>
              ) : (
                <span>{r.name}</span>
              )}
              {r.meta && <span className="muted chip-meta">{r.meta}</span>}
              <button
                type="button"
                className="chip-remove"
                aria-label={`${removeLabel ?? t('assoc.remove')} ${r.name}`}
                disabled={busyNow || pending.has(r.id)}
                onClick={() => wrap(() => onRemove(r.id), r.id)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {available.length > 0 && (
        <select
          className="filter-select"
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

      {error && <p className="form-error">{t('errors.generic')}</p>}
    </div>
  );
}
