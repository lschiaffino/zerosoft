'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

interface Props {
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
}

/**
 * El formulario se monta al abrir con el valor inicial ya puesto (sin un
 * efecto que lo pise después): lo primero que se tipea nunca se pierde.
 */
function NameForm({ title, label, initial = '', submitLabel, busy = false, error, extra, onSubmit, onClose, titleId }: Omit<Props, 'open'> & { titleId: string }) {
  const t = useTranslations('analytics.common');
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() && !busy) onSubmit(value.trim());
      }}
    >
      <div className="ui-modal-head">
        <h2 className="ui-modal-title" id={titleId}>
          {title}
        </h2>
      </div>
      <div className="ui-modal-body ui-fields">
        <label className="ui-field">
          <span className="label">{label}</span>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.currentTarget.select()} autoFocus maxLength={200} required />
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
  );
}

/** Modal de un campo (crear o renombrar): Enter guarda, Esc o el telón cancelan, el foco arranca en el campo. */
export default function NameDialog(props: Props) {
  const { open, busy = false, onClose } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

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
      {open && <NameForm {...props} titleId={`${id}-t`} />}
    </dialog>
  );
}
