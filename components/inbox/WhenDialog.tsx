'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { presetDate, SNOOZE_PRESETS, type SnoozePreset } from '@/lib/inbox/types';
import { localInputValue, longWhen } from './api';

export type WhenKind = 'snooze' | 'followUp' | 'sendLater';

/**
 * Elegir cuándo: posponer, recordar si no contesta o programar un envío.
 * Atajos del 1 al 6 para los presets (como Superhuman), una fecha propia
 * abajo. Esc o el telón cierran; Enter en la fecha confirma.
 */
export default function WhenDialog({ kind, onPick, onClose }: { kind: WhenKind | null; onPick: (iso: string) => void; onClose: () => void }) {
  const t = useTranslations('inbox.when');
  const locale = useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  const [custom, setCustom] = useState('');
  const [err, setErr] = useState('');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (kind && !d.open) {
      const n = new Date();
      setNow(n);
      setCustom(localInputValue(new Date(n.getTime() + 24 * 3600_000)));
      setErr('');
      d.showModal();
    }
    if (!kind && d.open) d.close();
  }, [kind]);

  const pick = (p: SnoozePreset) => onPick(presetDate(p, new Date()).toISOString());
  const submitCustom = () => {
    const at = new Date(custom);
    if (!custom || Number.isNaN(at.getTime()) || at.getTime() <= Date.now() + 30_000) {
      setErr(t('pastError'));
      return;
    }
    onPick(at.toISOString());
  };

  return (
    <dialog
      ref={ref}
      className="ui-modal ib-when"
      aria-label={kind ? t(`title.${kind}`) : ''}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        const n = Number(e.key);
        if (!(e.target instanceof HTMLInputElement) && n >= 1 && n <= SNOOZE_PRESETS.length) {
          e.preventDefault();
          pick(SNOOZE_PRESETS[n - 1]);
        }
      }}
    >
      {kind && (
        <>
          <div className="ui-modal-head">
            <h2 className="ui-modal-title">{t(`title.${kind}`)}</h2>
          </div>
          <div className="ui-modal-body ib-when-body">
            {kind === 'followUp' && <p className="ib-help">{t('followUpHelp')}</p>}
            <ul className="ib-when-list">
              {SNOOZE_PRESETS.map((p, i) => (
                <li key={p}>
                  <button type="button" className="ib-when-opt" onClick={() => pick(p)} autoFocus={i === 0}>
                    <span className="kbd" aria-hidden>
                      {i + 1}
                    </span>
                    <span className="ib-when-label">{t(`preset.${p}`)}</span>
                    <span className="ib-when-at">{longWhen(presetDate(p, now).toISOString(), locale)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="ib-when-custom"
              onSubmit={(e) => {
                e.preventDefault();
                submitCustom();
              }}
            >
              <label className="label" htmlFor="ib-when-input">
                {t('custom')}
              </label>
              <div className="ib-row">
                <input id="ib-when-input" className="input" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} />
                <button type="submit" className="btn btn-primary btn-sm">
                  {t('confirm')}
                </button>
              </div>
              {custom && !Number.isNaN(new Date(custom).getTime()) && <p className="ib-help">{longWhen(new Date(custom).toISOString(), locale)}</p>}
              {err && (
                <p className="ib-error" role="alert">
                  {err}
                </p>
              )}
            </form>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              {t('cancel')}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
