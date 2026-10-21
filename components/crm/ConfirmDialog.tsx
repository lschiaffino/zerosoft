'use client';

import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Acción destructiva (fusionar, borrar): el botón va en rojo. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmación en un diálogo del CRM (mismo modal que ganado/perdido), en vez
 * del confirm() del navegador. Abre con el foco en Confirmar: Enter confirma,
 * Esc o click afuera cancela, y Tab queda dentro del diálogo.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key === 'Tab' && cardRef.current) {
      const buttons = Array.from(cardRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
      if (!buttons.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        ref={cardRef}
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={message ? 'confirm-dialog-message' : undefined}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 className="modal-title" id="confirm-dialog-title">
          {title}
        </h2>
        {message && (
          <p className="muted" id="confirm-dialog-message">
            {message}
          </p>
        )}
        <div className="form-actions">
          <button
            ref={confirmRef}
            type="button"
            className={`btn btn-solid btn-small${danger ? ' btn-danger' : ''}`}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
            data-testid="confirm-dialog-confirm"
          >
            {confirmLabel}
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
