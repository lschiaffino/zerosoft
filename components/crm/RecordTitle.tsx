'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface RecordTitleProps {
  name: string;
  /** Endpoint PATCH del registro (recibe { name }). */
  endpoint: string;
  readOnly?: boolean;
}

/**
 * Título editable de una ficha (como Notion/HubSpot): clic en el nombre o en
 * "Rename" lo vuelve un input; Enter o salir del campo guarda, Esc cancela.
 */
export default function RecordTitle({ name, endpoint, readOnly }: RecordTitleProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef(false);
  const refocus = useRef(false);

  // Al salir de la edición el foco vuelve al botón (también tras el refresh del server).
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    buttonRef.current?.focus();
  });

  function start() {
    if (readOnly) return;
    doneRef.current = false;
    setDraft(name);
    setError(false);
    setEditing(true);
  }

  function stop() {
    refocus.current = true;
    setEditing(false);
  }

  async function save() {
    if (doneRef.current) return;
    doneRef.current = true;
    const next = draft.trim();
    if (!next || next === name) {
      stop();
      return;
    }
    setSaving(true);
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: next }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      doneRef.current = false;
      setError(true);
      return;
    }
    stop();
    router.refresh();
  }

  if (editing) {
    return (
      <span className="record-title-edit">
        <input
          className="input record-title-input"
          value={draft}
          autoFocus
          maxLength={500}
          disabled={saving}
          aria-label={t('record.rename')}
          aria-invalid={error || undefined}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              doneRef.current = true;
              stop();
            }
          }}
        />
        {error && (
          <span className="ui-error record-title-error" role="alert">
            {t('errors.generic')}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="record-title">
      <span className="record-title-text" onClick={start}>
        {name}
      </span>
      {!readOnly && (
        <button
          ref={buttonRef}
          type="button"
          className="icon-btn record-title-rename"
          onClick={start}
          title={t('record.rename')}
          aria-label={t('record.rename')}
          data-testid="record-rename"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
          </svg>
        </button>
      )}
    </span>
  );
}
