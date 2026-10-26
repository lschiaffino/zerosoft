'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/** Evento que avisa al sidebar que cambiaron videos o carpetas (crear, renombrar, mover, borrar). */
export const REC_CHANGED = 'zs:rec-changed';
export function notifyRecChanged() {
  window.dispatchEvent(new Event(REC_CHANGED));
}

export interface RecFolder {
  id: string;
  name: string;
  space: 'personal' | 'workspace';
  created_by: string;
}

function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return ref;
}

/** Modal con un campo de nombre (carpeta nueva, renombrar). Enter guarda, Esc cierra. */
export function RecNameDialog({
  open,
  title,
  label,
  initial = '',
  submitLabel,
  extra,
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
  extra?: ReactNode;
  busy?: boolean;
  error?: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('rec.common');
  const ref = useModal(open);
  const id = useId();
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  return (
    <dialog
      ref={ref}
      className="ui-modal"
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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onSubmit(value.trim());
          }}
        >
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id={`${id}-t`}>
              {title}
            </h2>
          </div>
          <div className="ui-modal-body">
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-n`}>
                {label}
              </label>
              <input id={`${id}-n`} className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus maxLength={200} />
            </div>
            {extra}
            {error && (
              <p className="ui-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-sm" onClick={onClose}>
              {t('cancel')}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !value.trim()} aria-busy={busy || undefined}>
              {submitLabel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

export type MoveTarget = { space: 'personal' | 'workspace'; folderId: string | null };

/** Mover un video: a la raíz de Mis videos o del workspace, o a una carpeta. */
export function RecMoveDialog({
  open,
  folders,
  current,
  busy,
  onMove,
  onClose,
}: {
  open: boolean;
  folders: RecFolder[];
  current: MoveTarget;
  busy?: boolean;
  onMove: (t: MoveTarget) => void;
  onClose: () => void;
}) {
  const t = useTranslations('rec.library');
  const tc = useTranslations('rec.common');
  const ref = useModal(open);
  const id = useId();
  const key = (m: MoveTarget) => m.folderId ?? `root:${m.space}`;
  const curKey = key(current);
  const [sel, setSel] = useState(curKey);
  useEffect(() => {
    if (open) setSel(curKey);
  }, [open, curKey]);
  const options: Array<{ k: string; label: string; target: MoveTarget; group: 'personal' | 'workspace' }> = [
    { k: 'root:personal', label: t('mine'), target: { space: 'personal', folderId: null }, group: 'personal' },
    ...folders.filter((f) => f.space === 'personal').map((f) => ({ k: f.id, label: f.name, target: { space: 'personal' as const, folderId: f.id }, group: 'personal' as const })),
    { k: 'root:workspace', label: t('workspace'), target: { space: 'workspace', folderId: null }, group: 'workspace' },
    ...folders.filter((f) => f.space === 'workspace').map((f) => ({ k: f.id, label: f.name, target: { space: 'workspace' as const, folderId: f.id }, group: 'workspace' as const })),
  ];
  return (
    <dialog
      ref={ref}
      className="ui-modal"
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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const o = options.find((x) => x.k === sel);
            if (o) onMove(o.target);
          }}
        >
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id={`${id}-t`}>
              {t('moveTitle')}
            </h2>
          </div>
          <div className="ui-modal-body">
            <fieldset className="rec-move-list">
              <legend className="sr-only">{t('moveTitle')}</legend>
              {options.map((o) => (
                <label key={o.k} className={`ui-check rec-move-opt${o.target.folderId ? ' nested' : ''}`}>
                  <input type="radio" name={`${id}-dest`} checked={sel === o.k} onChange={() => setSel(o.k)} />
                  <span>{o.label}</span>
                </label>
              ))}
            </fieldset>
            <p className="ui-help">{t('moveHelp')}</p>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-sm" onClick={onClose}>
              {tc('cancel')}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy} data-testid="rec-move-submit">
              {t('move')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
