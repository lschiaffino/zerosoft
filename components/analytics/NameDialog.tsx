'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Modal de un campo (crear o renombrar): Enter guarda, Esc o el telón
 * cancelan, el foco arranca en el campo. `extra` suma campos debajo.
 */
export default function NameDialog({
  open,
  title,
  label,
  initial = '',
  submitLabel,
  busy = false,
  error,
  extra,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  extra?: ReactNode;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('analytics.common');
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const id = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setValue(initial);
      d.showModal();
      requestAnimationFrame(() => inputRef.current?.select());
    }
    if (!open && d.open) d.close();
  }, [open, initial]);

  return (
    <dialog
      ref={ref}
      className="ui-modal"
      aria-labelledby={`${id}-t`}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim() && !busy) onSubmit(value.trim());
          }}
        >
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id={`${id}-t`}>
              {title}
            </h2>
          </div>
          <div className="ui-modal-body ui-fields">
            <label className="ui-field">
              <span className="label">{label}</span>
              <input ref={inputRef} className="input" value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} required />
            </label>
            {extra}
            {error && (
              <p className="ui-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>
              {t('cancel')}
            </button>
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !value.trim()} aria-busy={busy}>
              {submitLabel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
