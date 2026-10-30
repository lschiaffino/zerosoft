'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { api, Dialog, Field, useErrorText } from './people-ui';

export interface PolicyOption {
  id: string;
  name: string;
  halfDay: boolean;
  available?: number | null;
}

/** Pedir licencia: tipo, fechas, medio día (si la política lo permite y es un solo día) y nota. */
export default function RequestDialog({
  open,
  onClose,
  onDone,
  policies,
  employeeId,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  policies: PolicyOption[];
  employeeId?: string;
}) {
  const t = useTranslations('people');
  const errText = useErrorText();
  const today = new Date().toISOString().slice(0, 10);
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? '');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [half, setHalf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const policy = policies.find((p) => p.id === policyId);
  const halfAllowed = Boolean(policy?.halfDay) && start === end;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    const res = await api('/api/people/time-off', {
      method: 'POST',
      json: { employeeId, policyId, startDate: start, endDate: end, half: halfAllowed ? half : '', note: String(fd.get('note') ?? '') },
    });
    setBusy(false);
    if (!res.ok) return setError(errText(res.data.error));
    onDone();
  };

  return (
    <Dialog open={open} title={t('timeoff.request')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="ui-modal-body ui-fields">
          <Field label={t('timeoff.type')} htmlFor="rq-policy">
            <select id="rq-policy" className="select" value={policyId} onChange={(e) => setPolicyId(e.target.value)} required autoFocus>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.available != null ? t('timeoff.policyWithBalance', { name: p.name, days: p.available }) : p.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="ui-fields-2 ppl-fields">
            <Field label={t('timeoff.from')} htmlFor="rq-start">
              <input
                id="rq-start"
                type="date"
                className="input"
                value={start}
                required
                onChange={(e) => {
                  setStart(e.target.value);
                  if (end < e.target.value) setEnd(e.target.value);
                }}
              />
            </Field>
            <Field label={t('timeoff.to')} htmlFor="rq-end">
              <input id="rq-end" type="date" className="input" value={end} min={start} required onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          {halfAllowed && (
            <Field label={t('timeoff.halfDay')} htmlFor="rq-half">
              <select id="rq-half" className="select" value={half} onChange={(e) => setHalf(e.target.value)}>
                <option value="">{t('timeoff.fullDay')}</option>
                <option value="am">{t('timeoff.morning')}</option>
                <option value="pm">{t('timeoff.afternoon')}</option>
              </select>
            </Field>
          )}
          <Field label={t('timeoff.note')} htmlFor="rq-note">
            <textarea id="rq-note" name="note" className="textarea" maxLength={500} />
          </Field>
          <p className="ppl-hint">{t('timeoff.workingDaysHint')}</p>
          {error && (
            <p className="ppl-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !policyId}>
            {t('timeoff.send')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
