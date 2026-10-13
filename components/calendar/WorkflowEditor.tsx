'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

type Unit = 'minutes' | 'hours' | 'days';

interface StepDraft {
  recipient: 'guest' | 'host';
  amount: number;
  unit: Unit;
  when: 'before' | 'after';
  subject: string;
  body: string;
}

export interface WorkflowStepView {
  recipient: 'guest' | 'host';
  offsetMin: number;
  subject: string;
  body: string;
}

const UNIT_MIN: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

const VARIABLES = ['{{guest.name}}', '{{guest.email}}', '{{host.name}}', '{{event.title}}', '{{start}}', '{{link}}', '{{manage}}'];

/** offset en minutos → la unidad más grande que lo divide exacto. */
function fromOffset(s: WorkflowStepView): StepDraft {
  const abs = Math.abs(s.offsetMin);
  const unit: Unit = abs > 0 && abs % 1440 === 0 ? 'days' : abs > 0 && abs % 60 === 0 ? 'hours' : 'minutes';
  return {
    recipient: s.recipient,
    amount: abs / UNIT_MIN[unit],
    unit,
    when: s.offsetMin > 0 ? 'after' : 'before',
    subject: s.subject,
    body: s.body,
  };
}

function toOffset(d: StepDraft): number {
  const minutes = Math.round(d.amount * UNIT_MIN[d.unit]);
  return d.when === 'after' ? minutes : -minutes;
}

export default function WorkflowEditor({ eventTypeId, initial }: { eventTypeId: string; initial: WorkflowStepView[] }) {
  const t = useTranslations('calendar');
  const [steps, setSteps] = useState<StepDraft[]>(initial.map(fromOffset));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(i: number, p: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...p } : s)));
    setSaved(false);
  }

  function add() {
    setSteps((prev) => [
      ...prev,
      {
        recipient: 'guest',
        amount: 1,
        unit: 'hours',
        when: 'before',
        // Las plantillas llevan {{…}}: se leen crudas para que el formateo de mensajes no las toque.
        subject: String(t.raw('workflows.defaultSubject')),
        body: String(t.raw('workflows.defaultBody')),
      },
    ]);
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/calendar/event-types/${eventTypeId}/workflows`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        steps: steps.map((s) => ({ recipient: s.recipient, offsetMin: toOffset(s), subject: s.subject, body: s.body })),
      }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) setSaved(true);
    else setError(t('errors.invalid_input'));
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <p className="section-label">{t('workflows.title')}</p>
        <div className="panel-actions cal-actions">
          <button type="button" className="btn btn-small btn-ghost" onClick={add} disabled={steps.length >= 10}>
            + {t('workflows.add')}
          </button>
          <button type="button" className="btn btn-solid btn-small" onClick={save} disabled={busy}>
            {busy ? t('common.saving') : saved ? t('common.saved') : t('common.save')}
          </button>
        </div>
      </div>
      <p className="muted cal-sched-hint">{t('workflows.sub')}</p>
      {steps.length === 0 ? (
        <p className="muted">{t('workflows.empty')}</p>
      ) : (
        <ol className="cal-wf-steps">
          {steps.map((s, i) => (
            <li key={i} className="cal-wf-step">
              <div className="cal-wf-when">
                <select
                  className="select"
                  aria-label={t('workflows.to')}
                  value={s.recipient}
                  onChange={(e) => update(i, { recipient: e.target.value as StepDraft['recipient'] })}
                >
                  <option value="guest">{t('workflows.guest')}</option>
                  <option value="host">{t('workflows.host')}</option>
                </select>
                <input
                  className="input mono"
                  type="number"
                  min={0}
                  value={s.amount}
                  onChange={(e) => update(i, { amount: Math.max(0, Number(e.target.value) || 0) })}
                />
                <select className="select" value={s.unit} onChange={(e) => update(i, { unit: e.target.value as Unit })}>
                  <option value="minutes">{t('workflows.minutes')}</option>
                  <option value="hours">{t('workflows.hours')}</option>
                  <option value="days">{t('workflows.days')}</option>
                </select>
                <select
                  className="select"
                  value={s.when}
                  onChange={(e) => update(i, { when: e.target.value as StepDraft['when'] })}
                >
                  <option value="before">{t('workflows.before')}</option>
                  <option value="after">{t('workflows.after')}</option>
                </select>
                <button
                  type="button"
                  className="cal-icon-btn cal-icon-danger"
                  onClick={() => {
                    setSteps((prev) => prev.filter((_, idx) => idx !== i));
                    setSaved(false);
                  }}
                  aria-label={t('common.remove')}
                  title={t('common.remove')}
                >
                  ×
                </button>
              </div>
              <label className="field">
                <span className="prop-label">{t('workflows.subject')}</span>
                <input className="input" value={s.subject} maxLength={200} onChange={(e) => update(i, { subject: e.target.value })} />
              </label>
              <label className="field">
                <span className="prop-label">{t('workflows.body')}</span>
                <textarea
                  className="textarea"
                  rows={5}
                  value={s.body}
                  maxLength={5000}
                  onChange={(e) => update(i, { body: e.target.value })}
                />
              </label>
            </li>
          ))}
        </ol>
      )}
      <p className="muted mono cal-sched-hint">{t('workflows.variables', { vars: VARIABLES.join(' ') })}</p>
      <p className="muted cal-sched-hint">{t('workflows.cronNote')}</p>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
