'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';

export interface StepView {
  id?: string;
  key: string;
  type: 'email' | 'task' | 'wait';
  waitDays: number;
  templateId: string | null;
  subject: string;
  body: string;
  newThread: boolean;
}

export interface EnrollmentView {
  id: string;
  contactId: string;
  contactName: string;
  status: 'active' | 'paused' | 'finished' | 'exited';
  exitReason: string | null;
  step: number;
  stepCount: number;
  nextRun: string | null;
}

interface Props {
  sequence: {
    id: string;
    name: string;
    timezone: string;
    windowStart: string;
    windowEnd: string;
    businessDays: boolean;
  };
  steps: Array<Omit<StepView, 'key'>>;
  templates: Array<{ id: string; name: string }>;
  stats: Record<string, { sent: number; opened: number; clicked: number; replied: number }>;
  enrollments: EnrollmentView[];
  canEdit: boolean;
}

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : '—';
}

/** Editor de secuencia: horario, pasos (email / tarea / espera), stats por paso e inscripciones. */
export default function SequenceEditor({ sequence, steps: initialSteps, templates, stats, enrollments, canEdit }: Props) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [name, setName] = useState(sequence.name);
  const [timezone, setTimezone] = useState(sequence.timezone);
  const [windowStart, setWindowStart] = useState(sequence.windowStart);
  const [windowEnd, setWindowEnd] = useState(sequence.windowEnd);
  const [businessDays, setBusinessDays] = useState(sequence.businessDays);
  const [steps, setSteps] = useState<StepView[]>(() => initialSteps.map((s) => ({ ...s, key: s.id ?? newKey() })));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const timezones = useMemo(() => {
    try {
      const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
      return list.includes(timezone) ? list : [timezone, ...list];
    } catch {
      return [timezone];
    }
  }, [timezone]);

  function update(i: number, patch: Partial<StepView>) {
    setSteps((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    setStatus(null);
  }

  function add(type: StepView['type']) {
    setSteps((list) => [
      ...list,
      { key: newKey(), type, waitDays: type === 'wait' ? 2 : 0, templateId: null, subject: '', body: '', newThread: false },
    ]);
    setStatus(null);
  }

  function move(i: number, d: -1 | 1) {
    setSteps((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/sequences/${sequence.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        timezone,
        windowStart,
        windowEnd,
        businessDays,
        steps: steps.map((s) => ({
          id: s.id,
          type: s.type,
          waitDays: s.type === 'wait' ? s.waitDays : undefined,
          templateId: s.type === 'email' ? s.templateId : null,
          subject: s.subject,
          body: s.body,
          newThread: s.newThread,
        })),
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}` as 'errors.generic') : t('errors.generic'));
      return;
    }
    const data = (await res.json()) as { steps: Array<{ id: string }> };
    setSteps((list) => list.map((s, i) => ({ ...s, id: data.steps[i]?.id ?? s.id })));
    setStatus(t('sequences.saved'));
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    await fetch(`/api/crm/sequences/${sequence.id}`, { method: 'DELETE' }).catch(() => null);
    router.push('/app/crm/sequences');
  }

  async function act(id: string, action: 'pause' | 'resume' | 'exit') {
    setRowBusy(id);
    await fetch(`/api/crm/sequences/enrollments/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    setRowBusy(null);
    router.refresh();
  }

  let emailIndex = 0;

  return (
    <div className="seq-editor">
      <div className="seq-head">
        <input
          className="seq-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          readOnly={!canEdit}
          maxLength={200}
          aria-label={t('sequences.name')}
        />
        {canEdit && (
          <div className="seq-head-actions">
            {status && <span className="muted mono">{status}</span>}
            <button type="button" className="btn btn-solid btn-small" disabled={busy || !name.trim()} onClick={save}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        )}
      </div>
      {!canEdit && <p className="muted panel-desc">{t('sequences.readOnly')}</p>}
      {error && <p className="form-error">{error}</p>}

      <div className="seq-grid">
        <section className="seq-steps">
          <p className="section-label">{t('sequences.steps')}</p>
          {steps.length === 0 && <p className="muted">{t('sequences.noSteps')}</p>}
          <ol className="seq-step-list">
            {steps.map((s, i) => {
              const st = s.id ? stats[s.id] : undefined;
              const isFirstEmail = s.type === 'email' && emailIndex++ === 0;
              return (
                <li key={s.key} className={`seq-step seq-${s.type}`}>
                  <div className="seq-step-head">
                    <span className="seq-step-n mono">{i + 1}</span>
                    <span className="seq-step-type">{t(`sequences.stepTypes.${s.type}`)}</span>
                    {s.type === 'email' && st && (
                      <span className="seq-stats mono">
                        {t('sequences.stats.sent')} {st.sent} · {t('sequences.stats.opened')} {pct(st.opened, st.sent)} ·{' '}
                        {t('sequences.stats.clicked')} {pct(st.clicked, st.sent)} · {t('sequences.stats.replied')}{' '}
                        {pct(st.replied, st.sent)}
                      </span>
                    )}
                    {canEdit && (
                      <span className="seq-step-tools">
                        <button type="button" className="icon-btn" onClick={() => move(i, -1)} aria-label={t('sequences.moveUp')} title={t('sequences.moveUp')}>
                          ↑
                        </button>
                        <button type="button" className="icon-btn" onClick={() => move(i, 1)} aria-label={t('sequences.moveDown')} title={t('sequences.moveDown')}>
                          ↓
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={() => setSteps((list) => list.filter((_, j) => j !== i))}
                          aria-label={t('sequences.removeStep')}
                          title={t('sequences.removeStep')}
                        >
                          ✕
                        </button>
                      </span>
                    )}
                  </div>

                  {s.type === 'wait' && (
                    <label className="seq-wait-row">
                      {t('sequences.waitFor')}
                      <input
                        className="input seq-days"
                        type="number"
                        min={0}
                        max={365}
                        value={s.waitDays}
                        disabled={!canEdit}
                        onChange={(e) => update(i, { waitDays: Math.max(0, Number(e.target.value) || 0) })}
                      />
                      {t('sequences.days')}
                    </label>
                  )}

                  {s.type === 'task' && (
                    <div className="seq-fields">
                      <input
                        className="input"
                        value={s.subject}
                        onChange={(e) => update(i, { subject: e.target.value })}
                        placeholder={t('sequences.taskSubject')}
                        readOnly={!canEdit}
                        maxLength={500}
                      />
                      <input
                        className="input"
                        value={s.body}
                        onChange={(e) => update(i, { body: e.target.value })}
                        placeholder={t('sequences.taskBody')}
                        readOnly={!canEdit}
                      />
                    </div>
                  )}

                  {s.type === 'email' && (
                    <div className="seq-fields">
                      <select
                        className="filter-select"
                        value={s.templateId ?? ''}
                        disabled={!canEdit}
                        onChange={(e) => update(i, { templateId: e.target.value || null })}
                        aria-label={t('sequences.template')}
                      >
                        <option value="">{t('sequences.customEmail')}</option>
                        {templates.map((tp) => (
                          <option key={tp.id} value={tp.id}>
                            {t('sequences.template')}: {tp.name}
                          </option>
                        ))}
                      </select>
                      {!s.templateId && (
                        <>
                          {(isFirstEmail || s.newThread) && (
                            <input
                              className="input"
                              value={s.subject}
                              onChange={(e) => update(i, { subject: e.target.value })}
                              placeholder={t('templates.subject')}
                              readOnly={!canEdit}
                              maxLength={500}
                            />
                          )}
                          <textarea
                            className="textarea"
                            rows={5}
                            value={s.body}
                            onChange={(e) => update(i, { body: e.target.value })}
                            placeholder={t('templates.body')}
                            readOnly={!canEdit}
                            maxLength={20000}
                          />
                        </>
                      )}
                      {!isFirstEmail && (
                        <label className="em-check">
                          <input
                            type="checkbox"
                            checked={s.newThread}
                            disabled={!canEdit}
                            onChange={(e) => update(i, { newThread: e.target.checked })}
                          />
                          {t('sequences.newThread')}
                          {!s.newThread && <span className="muted"> — {t('sequences.replyThread')}</span>}
                        </label>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {canEdit && (
            <div className="seq-add">
              <button type="button" className="btn btn-small" onClick={() => add('email')}>
                + {t('sequences.addEmail')}
              </button>
              <button type="button" className="btn btn-small" onClick={() => add('wait')}>
                + {t('sequences.addWait')}
              </button>
              <button type="button" className="btn btn-small" onClick={() => add('task')}>
                + {t('sequences.addTask')}
              </button>
            </div>
          )}
        </section>

        <aside className="seq-side">
          <p className="section-label">{t('sequences.schedule')}</p>
          <label className="field">
            <span className="field-label mono">{t('sequences.timezone')}</span>
            <select className="filter-select" value={timezone} disabled={!canEdit} onChange={(e) => setTimezone(e.target.value)}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <div className="seq-window">
            <label className="field">
              <span className="field-label mono">{t('sequences.windowFrom')}</span>
              <input className="input" type="time" value={windowStart} disabled={!canEdit} onChange={(e) => setWindowStart(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label mono">{t('sequences.windowTo')}</span>
              <input className="input" type="time" value={windowEnd} disabled={!canEdit} onChange={(e) => setWindowEnd(e.target.value)} />
            </label>
          </div>
          <label className="em-check">
            <input type="checkbox" checked={businessDays} disabled={!canEdit} onChange={(e) => setBusinessDays(e.target.checked)} />
            {t('sequences.businessDays')}
          </label>
          <p className="muted seq-note">{t('sequences.cronNote')}</p>
          <p className="muted seq-note">{t('sequences.gmailNote')}</p>
          {canEdit &&
            (confirmDelete ? (
              <div className="cell-actions confirm">
                <span className="confirm-label">{t('sequences.deleteConfirm')}</span>
                <button type="button" className="icon-btn danger" onClick={remove}>
                  {t('common.yes')}
                </button>
                <button type="button" className="icon-btn" onClick={() => setConfirmDelete(false)}>
                  {t('common.no')}
                </button>
              </div>
            ) : (
              <button type="button" className="link-btn danger" onClick={() => setConfirmDelete(true)}>
                {t('sequences.deleteSequence')}
              </button>
            ))}
        </aside>
      </div>

      <section className="seq-enrollments">
        <p className="section-label">
          {t('sequences.enrollments')} <span className="tl-count">{enrollments.length}</span>
        </p>
        {enrollments.length === 0 ? (
          <p className="muted">{t('sequences.noEnrollments')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table crm-table">
              <thead>
                <tr>
                  <th>{t('sequences.contact')}</th>
                  <th>{t('sequences.status')}</th>
                  <th>{t('sequences.step')}</th>
                  <th>{t('sequences.nextRun')}</th>
                  <th aria-label={t('common.actions')} />
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e) => {
                  const live = e.status === 'active' || e.status === 'paused';
                  return (
                    <tr key={e.id} className={rowBusy === e.id ? 'row-busy' : undefined}>
                      <td>
                        <Link href={`/app/crm/contacts/${e.contactId}`} className="cell-name">
                          {e.contactName}
                        </Link>
                      </td>
                      <td>
                        <span className={`seq-status s-${e.status} mono`}>
                          {t(`sequences.statuses.${e.status}`)}
                          {e.exitReason && t.has(`sequences.reasons.${e.exitReason}`)
                            ? ` · ${t(`sequences.reasons.${e.exitReason}` as 'sequences.reasons.manual')}`
                            : ''}
                        </span>
                      </td>
                      <td className="mono">{t('sequences.stepOf', { n: e.step, total: e.stepCount })}</td>
                      <td className="mono muted cell-date">{live && e.status === 'active' ? (e.nextRun ?? '—') : '—'}</td>
                      <td>
                        {live && (
                          <div className="cell-actions">
                            <button type="button" className="link-btn" onClick={() => act(e.id, e.status === 'active' ? 'pause' : 'resume')}>
                              {e.status === 'active' ? t('sequences.pause') : t('sequences.resume')}
                            </button>
                            <button type="button" className="link-btn danger" onClick={() => act(e.id, 'exit')}>
                              {t('sequences.exit')}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
