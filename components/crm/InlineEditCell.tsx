'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

export type InlineEditType = 'text' | 'email' | 'number' | 'date' | 'select';

interface Option {
  value: string;
  label: string;
}

interface InlineEditCellProps {
  /** Endpoint PATCH del registro (ej. /api/crm/contacts/{id}). */
  endpoint: string;
  /** Campo del schema (camelCase, ej. 'email', 'phone', 'lifecycleStage'). */
  field: string;
  value: string;
  className?: string;
  type?: InlineEditType;
  /** Opciones para type='select'. */
  options?: Option[];
  /** Si true, el select incluye '—' y envía null al elegirlo. */
  nullOption?: boolean;
  /** Transforma el valor crudo antes de enviarlo al PATCH. */
  serialize?: (raw: string) => unknown;
  onSaved?: () => void;
}

/**
 * Celda editable inline (firma Twenty): click → input/select, Enter/blur guarda
 * (PATCH { [field]: value }), Esc cancela. Si la API rechaza revierte al valor original.
 */
export default function InlineEditCell({
  endpoint,
  field,
  value,
  className = '',
  type = 'text',
  options = [],
  nullOption = false,
  serialize,
  onSaved,
}: InlineEditCellProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  async function save(raw: string) {
    if (busy) return;
    const trimmed = raw.trim();
    if (trimmed === value) {
      setEditing(false);
      return;
    }
    // Los números vacíos no se guardan.
    if (type === 'number' && trimmed === '') {
      setEditing(false);
      return;
    }

    let payloadValue: unknown = trimmed;
    if (type === 'number') payloadValue = Number(trimmed);
    else if (type === 'select' && nullOption && trimmed === '') payloadValue = null;
    else if (serialize) payloadValue = serialize(trimmed);

    setBusy(true);
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [field]: payloadValue }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) {
      setEditing(false);
      onSaved?.();
      router.refresh();
      return;
    }
    setDraft(value);
    setEditing(false);
  }

  if (editing) {
    if (type === 'select') {
      return (
        <select
          className={`cell-inline-input${busy ? ' row-busy' : ''}`}
          value={draft}
          autoFocus
          disabled={busy}
          aria-label={field}
          onChange={(e) => {
            setDraft(e.target.value);
            void save(e.target.value);
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(value);
              setEditing(false);
            }
          }}
        >
          {nullOption && <option value="">—</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        className={`cell-inline-input${busy ? ' row-busy' : ''}`}
        type={type === 'email' ? 'email' : type}
        value={draft}
        autoFocus
        disabled={busy}
        aria-label={field}
        maxLength={type === 'number' ? undefined : 500}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => save(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save(draft);
          }
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  const display =
    type === 'select'
      ? options.find((o) => o.value === value)?.label ?? value
      : value;

  return (
    <button
      type="button"
      className={`cell-inline${value ? '' : ' empty'} ${className}`}
      title={t('common.edit')}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      {display || '—'}
    </button>
  );
}
