'use client';

import type { ReactNode } from 'react';
import { Close } from './icons';

export interface SelectionAction {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/**
 * Mensajes elegidos (Lines e Inbox), como WhatsApp: en lugar del campo de texto, la X para salir, cuántos van y
 * las acciones sobre todos (reenviar, copiar, destacar, borrar). Botones de ícono de 44 px con su nombre.
 */
export default function SelectionBar({ count, label, cancelLabel, onCancel, actions }: { count: number; label: string; cancelLabel: string; onCancel: () => void; actions: SelectionAction[] }) {
  return (
    <div className="wa-bar wa-selectbar" role="toolbar" aria-label={label} data-testid="selection-bar">
      <button type="button" className="wa-icon-btn" onClick={onCancel} aria-label={cancelLabel} title={cancelLabel}>
        <Close />
      </button>
      <span className="wa-rec-label" aria-live="polite">
        {label}
      </span>
      <span className="wa-selectbar-actions">
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`wa-icon-btn${a.danger ? ' is-danger' : ''}`}
            data-action={a.key}
            onClick={a.onClick}
            disabled={a.disabled || count === 0}
            aria-label={a.label}
            title={a.label}
          >
            {a.icon}
          </button>
        ))}
      </span>
    </div>
  );
}
