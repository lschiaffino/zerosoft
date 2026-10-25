'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Confirmación con el modal de la app (<dialog class="ui-modal">), en lugar
 * del confirm() del navegador: foco atrapado, Esc y clic en el telón cancelan,
 * Enter confirma (el foco arranca en el botón de confirmar). Si la acción es
 * destructiva (danger) el foco arranca en Cancelar, como en macOS y Linear:
 * un Enter de más no borra nada.
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      (danger ? cancelRef : confirmRef).current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open, danger]);

  return (
    <dialog
      ref={ref}
      className="ui-modal ui-confirm"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={body ? bodyId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      {open && (
        <>
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id={titleId}>
              {title}
            </h2>
          </div>
          {body && (
            <div className="ui-modal-body" id={bodyId}>
              {body}
            </div>
          )}
          <div className="ui-modal-foot">
            <button ref={cancelRef} type="button" className="btn btn-sm" data-testid="confirm-dialog-cancel" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
              type="button"
              data-testid="confirm-dialog-confirm"
              className={`btn btn-sm btn-primary${danger ? ' btn-danger' : ''}`}
              onClick={onConfirm}
              aria-busy={busy}
              disabled={busy}
            >
              {confirmLabel}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
