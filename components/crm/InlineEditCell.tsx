'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface InlineEditCellProps {
  /** Endpoint PATCH del registro (ej. /api/crm/contacts/{id}). */
  endpoint: string;
  /** Campo del schema (camelCase, ej. 'email', 'phone', 'domain'). */
  field: string;
  value: string;
  className?: string;
  inputType?: string;
}

/**
 * Celda editable inline (firma Twenty): click → input, Enter/blur guarda
 * (PATCH { [field]: value }), Esc cancela. Si la API rechaza (ej. email
 * inválido) revierte al valor original.
 */
export default function InlineEditCell({
  endpoint,
  field,
  value,
  className = '',
  inputType = 'text',
}: InlineEditCellProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    const v = draft.trim();
    if (v === value) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [field]: v }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) {
      setEditing(false);
      router.refresh();
      return;
    }
    setDraft(value);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        className={`cell-inline-input${busy ? ' row-busy' : ''}`}
        type={inputType}
        value={draft}
        autoFocus
        disabled={busy}
        aria-label={field}
        maxLength={500}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

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
      {value || '—'}
    </button>
  );
}
