'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Modal de Voice sobre <dialog class="ui-modal">: foco atrapado, Esc y clic
 * en el telón cierran. Se abre al montarse.
 */
export default function VoiceModal({
  title,
  onClose,
  closeLabel,
  children,
  footer,
  wide = false,
  testId,
}: {
  title: ReactNode;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  testId?: string;
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
      className={`ui-modal vc-modal${wide ? ' ui-modal-wide' : ''}`}
      aria-labelledby={titleId}
      data-testid={testId}
      onCancel={(e) => {
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="ui-modal-body">{children}</div>
      {footer && <div className="ui-modal-foot">{footer}</div>}
    </dialog>
  );
}
