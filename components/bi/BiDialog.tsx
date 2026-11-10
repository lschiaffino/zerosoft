'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Modal nativo: Esc y el telón cierran, el foco vuelve a quien lo abrió. */
export default function BiDialog({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
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
      className={`ui-modal${wide ? ' bi-modal-wide' : ''}`}
      aria-labelledby={`${id}-t`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <>
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id={`${id}-t`}>
              {title}
            </h2>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}

/** Modal de un campo: Enter guarda, Esc cancela, arranca con el foco en el campo. */
export function NameDialog({
  open,
  title,
  label,
  initial = '',
  submitLabel,
  cancelLabel,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  submitLabel: string;
  cancelLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <BiDialog open={open} title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = String(new FormData(e.currentTarget).get('name') ?? '').trim();
          if (v && !busy) onSubmit(v);
        }}
      >
        <div className="ui-modal-body ui-fields">
          <label className="ui-field">
            <span className="label">{label}</span>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input className="input" name="name" defaultValue={initial} onFocus={(e) => e.currentTarget.select()} autoFocus maxLength={200} required />
          </label>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="submit" className="btn btn-sm btn-primary" disabled={busy} aria-busy={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </BiDialog>
  );
}
