'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

export interface BulkEditField {
  /** Clave de lib/crm-bulk-fields.ts o `custom:<name>`. */
  key: string;
  label: string;
  /** multiselect: lista de opciones (reemplaza la selección del registro). */
  type: 'select' | 'multiselect' | 'text' | 'number' | 'date';
  options?: Array<{ value: string; label: string }>;
  /** Se puede vaciar (opción "Vacío" en selects; input vacío en el resto). */
  nullable?: boolean;
}

interface BulkEditControlsProps {
  /** p. ej. /api/crm/contacts/bulk */
  endpoint: string;
  ids: string[];
  fields: BulkEditField[];
  disabled?: boolean;
  /** Se llama al terminar bien (la tabla limpia la selección). */
  onDone?: (notice: string) => void;
}

function initialValue(field: BulkEditField | undefined): string {
  if (!field || field.type !== 'select' || field.nullable) return '';
  return field.options?.[0]?.value ?? '';
}

/** Bulk bar: elegir una propiedad (owner incluido) y un valor, y aplicarlo a los seleccionados. */
export default function BulkEditControls({ endpoint, ids, fields, disabled, onDone }: BulkEditControlsProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [fieldKey, setFieldKey] = useState(fields[0]?.key ?? '');
  const field = fields.find((f) => f.key === fieldKey);
  const [value, setValue] = useState(() => initialValue(fields[0]));
  const [multi, setMulti] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!fields.length || !field) return null;

  const canApply = field.nullable || (field.type === 'multiselect' ? multi.length > 0 : value !== '');

  async function apply() {
    if (!field || !canApply) return;
    setBusy(true);
    setError(null);
    const payload: string | number | string[] | null =
      field.type === 'multiselect'
        ? multi.length > 0
          ? multi
          : null
        : value === ''
          ? null
          : field.type === 'number'
            ? Number(value)
            : value;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'set_property', ids, field: field.key, value: payload }),
    }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as { error?: string; count?: number; failed?: number } | null;
    if (!res?.ok) {
      setError(data?.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}` as 'errors.generic') : t('errors.generic'));
      return;
    }
    const count = data?.count ?? 0;
    const failed = data?.failed ?? 0;
    onDone?.(failed ? t('bulkEdit.partial', { count, failed }) : t('bulkEdit.done', { count }));
    router.refresh();
  }

  return (
    <>
      <select
        className="filter-select"
        value={fieldKey}
        onChange={(e) => {
          const next = fields.find((f) => f.key === e.target.value);
          setFieldKey(e.target.value);
          setValue(initialValue(next));
          setMulti([]);
          setError(null);
        }}
        aria-label={t('bulkEdit.property')}
        disabled={disabled || busy}
      >
        {fields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
      {field.type === 'multiselect' ? (
        <details className="bulk-multi">
          <summary className="filter-select" aria-label={t('bulkEdit.value')}>
            {multi.length > 0 ? multi.join(', ') : t('bulkEdit.empty')}
          </summary>
          <div className="bulk-multi-menu">
            {(field.options ?? []).map((o) => (
              <label key={o.value} className="column-toggle-row">
                <input
                  type="checkbox"
                  checked={multi.includes(o.value)}
                  disabled={disabled || busy}
                  onChange={(e) =>
                    setMulti((prev) => (e.target.checked ? [...prev, o.value] : prev.filter((x) => x !== o.value)))
                  }
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </details>
      ) : field.type === 'select' ? (
        <select
          className="filter-select"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={t('bulkEdit.value')}
          disabled={disabled || busy}
        >
          {field.nullable && <option value="">{t('bulkEdit.empty')}</option>}
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="bulk-input"
          type={field.type}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={field.nullable ? t('bulkEdit.empty') : t('bulkEdit.value')}
          aria-label={t('bulkEdit.value')}
          disabled={disabled || busy}
          maxLength={field.type === 'text' ? 500 : undefined}
        />
      )}
      <button type="button" className="bulk-btn" disabled={disabled || busy || !canApply} onClick={apply}>
        {t('bulkEdit.apply')}
      </button>
      {error && (
        <span className="bulk-count bulk-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
