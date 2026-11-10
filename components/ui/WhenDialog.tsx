'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { localInputValue, longWhen, presetDate, SNOOZE_PRESETS, type SnoozePreset } from '@/lib/when-presets';

export interface WhenLabels {
  /** Nombre de cada preset ("Mañana a la mañana"). */
  preset: (p: SnoozePreset) => string;
  custom: string;
  confirm: string;
  cancel: string;
  pastError: string;
}

/**
 * Elegir cuándo: posponer, recordar o programar un envío. Atajos del 1 al 6
 * para los presets (como Superhuman) y una fecha propia abajo. Esc o el telón
 * cierran; Enter en la fecha confirma. Lo usan Inbox y Lines: cada uno pasa
 * sus textos (`labels`) y, si quiere, una nota arriba (`help`) y algo más en
 * el pie (`extra`, por ejemplo "Repetir").
 */
export default function WhenDialog({
  open,
  title,
  labels,
  help,
  extra,
  initial,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  labels: WhenLabels;
  help?: ReactNode;
  extra?: ReactNode;
  /** Fecha que arranca en el campo (al cambiar la hora de algo ya programado). */
  initial?: string | null;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  const inputId = useId();
  const [custom, setCustom] = useState('');
  const [err, setErr] = useState('');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      const n = new Date();
      const start = initial ? new Date(initial) : null;
      setNow(n);
      setCustom(localInputValue(start && start.getTime() > n.getTime() + 60_000 ? start : new Date(n.getTime() + 24 * 3600_000)));
      setErr('');
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, initial]);

  const pick = (p: SnoozePreset) => onPick(presetDate(p, new Date()).toISOString());
  const submitCustom = () => {
    const at = new Date(custom);
    if (!custom || Number.isNaN(at.getTime()) || at.getTime() <= Date.now() + 30_000) {
      setErr(labels.pastError);
      return;
    }
    onPick(at.toISOString());
  };

  return (
    <dialog
      ref={ref}
      className="ui-modal ui-when"
      aria-label={open ? title : ''}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        const n = Number(e.key);
        if (!(e.target instanceof HTMLInputElement) && !e.metaKey && !e.ctrlKey && !e.altKey && n >= 1 && n <= SNOOZE_PRESETS.length) {
          e.preventDefault();
          pick(SNOOZE_PRESETS[n - 1]);
        }
      }}
    >
      {open && (
        <>
          <div className="ui-modal-head">
            <h2 className="ui-modal-title">{title}</h2>
          </div>
          <div className="ui-modal-body ui-when-body">
            {help && <div className="ui-help ui-when-help">{help}</div>}
            <ul className="ui-when-list">
              {SNOOZE_PRESETS.map((p, i) => (
                <li key={p}>
                  <button type="button" className="ui-when-opt" onClick={() => pick(p)} autoFocus={i === 0}>
                    <span className="kbd" aria-hidden>
                      {i + 1}
                    </span>
                    <span className="ui-when-label">{labels.preset(p)}</span>
                    <span className="ui-when-at">{longWhen(presetDate(p, now).toISOString(), locale)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="ui-when-custom"
              onSubmit={(e) => {
                e.preventDefault();
                submitCustom();
              }}
            >
              <label className="label" htmlFor={inputId}>
                {labels.custom}
              </label>
              <div className="ui-when-row">
                <input id={inputId} className="input" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} />
                <button type="submit" className="btn btn-primary btn-sm">
                  {labels.confirm}
                </button>
              </div>
              {custom && !Number.isNaN(new Date(custom).getTime()) && <p className="ui-help">{longWhen(new Date(custom).toISOString(), locale)}</p>}
              {err && (
                <p className="ui-error" role="alert">
                  {err}
                </p>
              )}
            </form>
          </div>
          <div className="ui-modal-foot">
            {extra}
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              {labels.cancel}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
