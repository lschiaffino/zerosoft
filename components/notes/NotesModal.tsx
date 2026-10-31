'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import NotesIcon from './NotesIcon';

/**
 * Modal de Notes sobre <dialog class="ui-modal">: foco atrapado, Esc y clic
 * en el telón cierran. Se abre al montarse.
 */
export function NotesModal({
  title,
  onClose,
  closeLabel,
  children,
  footer,
  wide = false,
  className = '',
}: {
  title: ReactNode;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`ui-modal${wide ? ' ui-modal-wide' : ''} ${className}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Cancelar el selector de archivos también dispara `cancel` y sube hasta acá: no es cerrar el modal.
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ui-modal-head">
        <h2 id={titleId} className="ui-modal-title">
          {title}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label={closeLabel}>
          <NotesIcon name="close" size={16} />
        </button>
      </div>
      <div className="ui-modal-body">{children}</div>
      {footer && <div className="ui-modal-foot">{footer}</div>}
    </dialog>
  );
}

/** Pedir un nombre (guardar búsqueda o plantilla, renombrar): Enter confirma, Esc cancela. */
export function PromptDialog({
  title,
  label,
  hint,
  initial = '',
  placeholder,
  confirmLabel,
  cancelLabel,
  maxLength = 80,
  suggestions,
  onSubmit,
  onClose,
}: {
  title: ReactNode;
  label: string;
  hint?: ReactNode;
  initial?: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
  maxLength?: number;
  /** Opciones para el datalist (p. ej. pilas existentes). */
  suggestions?: string[];
  onSubmit: (value: string) => Promise<boolean | void> | boolean | void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const listId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // El modal se abre (showModal) después de montar el campo y movería el foco: se vuelve a poner acá.
  useEffect(() => {
    const h = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(h);
  }, []);
  async function submit() {
    if (!value.trim() || busy) return;
    setBusy(true);
    const ok = await onSubmit(value.trim());
    setBusy(false);
    if (ok !== false) onClose();
  }
  return (
    <NotesModal
      title={title}
      onClose={onClose}
      closeLabel={cancelLabel}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={!value.trim()} aria-busy={busy}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <label className="notes-field" htmlFor={inputId}>
        <span>{label}</span>
        <input
          id={inputId}
          ref={inputRef}
          className="input"
          autoFocus
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          list={suggestions?.length ? listId : undefined}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
        />
      </label>
      {suggestions?.length ? (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
      {hint && <p className="notes-field-hint">{hint}</p>}
    </NotesModal>
  );
}
