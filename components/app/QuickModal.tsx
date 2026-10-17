'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import '@/styles/quick-modal.css';

export interface QuickModalProps {
  open: boolean;
  onClose: () => void;
  /** Breadcrumb chico arriba a la izquierda (p. ej. "Link › New link"). Si es texto, también nombra el diálogo. */
  crumb: ReactNode;
  /** false: el crumb solo nombra el diálogo (aria-label) y no se dibuja. */
  showCrumb?: boolean;
  /** Contenido del formulario (campos). */
  children: ReactNode;
  onSubmit: () => void;
  submitLabel: string;
  cancelLabel: string;
  submitDisabled?: boolean;
  busy?: boolean;
  /** Error de servidor/validación para mostrar en el pie. */
  error?: string | null;
  /** Texto chico en el pie (p. ej. "⌘↵ to create"). Se oculta en mobile. */
  hint?: ReactNode;
  /** Elemento extra en el pie (p. ej. "Create more", "Open full form"). */
  footExtra?: ReactNode;
  width?: number;
}

/**
 * Modal liviano compartido por las apps para crear/editar sin salir de la
 * vista (mismo lenguaje visual que el quick-create de Track). Esc cierra,
 * Cmd/Ctrl+Enter envía, Enter en un input envía (submit del form) y el foco
 * queda atrapado dentro del diálogo.
 */
export default function QuickModal(props: QuickModalProps) {
  if (!props.open) return null;
  return <QuickModalBody {...props} />;
}

function QuickModalBody({
  onClose,
  crumb,
  showCrumb = true,
  children,
  onSubmit,
  submitLabel,
  cancelLabel,
  submitDisabled,
  busy,
  error,
  hint,
  footExtra,
  width = 560,
}: QuickModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      '[data-autofocus], input:not([type=hidden]):not([type=checkbox]), textarea, select',
    );
    first?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      returnFocus.current?.focus?.();
    };
  }, []);

  const submit = () => {
    if (submitDisabled || busy) return;
    onSubmit();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Tab' && dialogRef.current) {
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'input, textarea, select, button:not([disabled]), a[href]',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="qm-overlay" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="qm"
        role="dialog"
        aria-modal="true"
        aria-label={typeof crumb === 'string' ? crumb : undefined}
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {showCrumb && <div className="qm-head">{crumb}</div>}
          <div className="qm-body">{children}</div>
          {error && (
            <p className="qm-error" role="alert">
              {error}
            </p>
          )}
          <div className="qm-foot">
            {hint ? <span className="qm-hint">{hint}</span> : <span className="qm-hint" />}
            {footExtra}
            <button type="button" className="btn btn-small" onClick={onClose}>
              {cancelLabel}
            </button>
            <button type="submit" className="btn btn-small btn-solid" disabled={submitDisabled || busy}>
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Atajo de una tecla (por defecto "c") para la acción de crear principal de
 * una vista. Ignora la tecla con modificadores o si el foco está en un campo
 * editable, un diálogo o un menú.
 */
export function useKeyShortcut(key: string, handler: () => void, enabled = true): void {
  const cb = useRef(handler);
  useEffect(() => {
    cb.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable ||
          el.closest(
            'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"]',
          ))
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      cb.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, enabled]);
}
