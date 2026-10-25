'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ViewType } from './ViewSwitcher';
import type { FilterState } from '@/lib/track-filter';

interface SaveViewDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, shared: boolean) => Promise<void> | void;
  viewType: ViewType;
  filters: FilterState;
  labels: {
    title: string;
    name: string;
    namePlaceholder: string;
    save: string;
    cancel: string;
    error?: string;
    /** "Compartir con el equipo" (vista de equipo). */
    shared?: string;
    sharedHelp?: string;
  };
}

/** Guardar la vista actual (tipo, filtros y orden) con un nombre. */
export default function SaveViewDialog(props: SaveViewDialogProps) {
  if (!props.open) return null;
  return <SaveViewDialogBody {...props} />;
}

function SaveViewDialogBody({ onClose, onSave, labels }: SaveViewDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus?.();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="ui-modal"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || submitting) return;
          setSubmitting(true);
          setError(false);
          try {
            await onSave(name.trim(), shared);
          } catch {
            setError(true);
            setSubmitting(false);
          }
        }}
      >
        <div className="ui-modal-head">
          <h2 className="ui-modal-title" id={`${id}-title`}>
            {labels.title}
          </h2>
        </div>
        <div className="ui-modal-body">
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-name`}>
              {labels.name}
            </label>
            <input
              id={`${id}-name`}
              className="input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={labels.namePlaceholder}
              maxLength={100}
              autoFocus
            />
            {labels.shared && (
              <label className="ui-check track-save-view-shared">
                <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} data-testid="track-save-view-shared" />
                <span>{labels.shared}</span>
              </label>
            )}
            {labels.sharedHelp && <p className="ui-help">{labels.sharedHelp}</p>}
            {error && labels.error && (
              <p className="ui-error" role="alert">
                {labels.error}
              </p>
            )}
          </div>
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {labels.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()} aria-busy={submitting || undefined}>
            {labels.save}
          </button>
        </div>
      </form>
    </dialog>
  );
}
