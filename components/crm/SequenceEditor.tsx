'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import AdvancedSection from '@/components/ui/AdvancedSection';
import EmptyState from '@/components/ui/EmptyState';
import RowTools from './RowTools';

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
  return d > 0 ? `${Math.round((n / d) * 100)}%` : '0%';
}

const STATUS_TONE: Record<EnrollmentView['status'], string> = {
  active: 'badge-ok',
  paused: 'badge-warn',
  finished: '',
  exited: 'badge-outline',
};

/**
 * Editor de secuencia: los pasos como estaciones de la línea (email, tarea,
 * espera), el horario de envío colapsado en un resumen y un solo Guardar.
 * Debajo, las inscripciones.
 */
export default function SequenceEditor({ sequence, steps: initialSteps, templates, stats, enrollments, canEdit }: Props) {
  const t = useTranslations('crm');
  const router = useRouter();
  const idBase = useId();
  const [name, setName] = useState(sequence.name);
  const [timezone, setTimezone] = useState(sequence.timezone);
  const [windowStart, setWindowStart] = useState(sequence.windowStart);
  const [windowEnd, setWindowEnd] = useState(sequence.windowEnd);
  const [businessDays, setBusinessDays] = useState(sequence.businessDays);
  const [steps, setSteps] = useState<StepView[]>(() => initialSteps.map((s) => ({ ...s, key: s.id ?? newKey() })));
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'dirty' | 'saved'>('idle');
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

  const dirty = () => setState('dirty');

  function update(i: number, patch: Partial<StepView>) {
    setSteps((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    dirty();
  }

  function add(type: StepView['type']) {
    setSteps((list) => [
      ...list,
      { key: newKey(), type, waitDays: type === 'wait' ? 2 : 0, templateId: null, subject: '', body: '', newThread: false },
    ]);
    dirty();
  }

  function move(i: number, d: -1 | 1) {
    setSteps((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    dirty();
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (busy || !canEdit) return;
    if (!name.trim()) {
      setError(t('sequences.nameRequired'));
      return;
    }
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
    setState('saved');
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/crm/sequences/${sequence.id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) router.push('/app/crm/sequences');
    else {
      setBusy(false);
      setError(t('errors.generic'));
    }
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

  const schedule = t('sequences.scheduleSummary', {
    days: businessDays ? t('sequences.weekdays') : t('sequences.everyDay'),
    from: windowStart,
    to: windowEnd,
    tz: timezone,
  });

  let emailIndex = 0;
  const fid = (k: string) => `${idBase}-${k}`;
  const note = busy
    ? t('common.saving')
    : error
      ? error
      : state === 'saved'
        ? t('sequences.saved')
        : state === 'dirty'
          ? t('sequences.unsaved')
          : !canEdit
            ? t('sequences.readOnly')
            : null;

  return (
    <div className="seq-editor">
      <form className="seq-form" onSubmit={save} noValidate>
        <section className="ui-section">
          <div className="ui-section-body">
            <div className="ui-field">
              <label className="label" htmlFor={fid('name')}>
                {t('sequences.name')}
              </label>
              <input
                id={fid('name')}
                className="input"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  dirty();
                }}
                readOnly={!canEdit}
                maxLength={200}
                aria-invalid={!name.trim() || undefined}
              />
            </div>
            <AdvancedSection storageKey="crm.sequence.schedule" label={t('sequences.schedule')} hint={schedule}>
              <div className="ui-fields-2">
                <div className="ui-field">
                  <label className="label" htmlFor={fid('from')}>
                    {t('sequences.windowFrom')}
                  </label>
                  <input
                    id={fid('from')}
                    className="input data"
                    type="time"
                    value={windowStart}
                    disabled={!canEdit}
                    onChange={(e) => {
                      setWindowStart(e.target.value);
                      dirty();
                    }}
                  />
                </div>
                <div className="ui-field">
                  <label className="label" htmlFor={fid('to')}>
                    {t('sequences.windowToLabel')}
                  </label>
                  <input
                    id={fid('to')}
                    className="input data"
                    type="time"
                    value={windowEnd}
                    disabled={!canEdit}
                    onChange={(e) => {
                      setWindowEnd(e.target.value);
                      dirty();
                    }}
                  />
                </div>
              </div>
              <div className="ui-field">
                <label className="label" htmlFor={fid('tz')}>
                  {t('sequences.timezone')}
                </label>
                <select
                  id={fid('tz')}
                  className="select"
                  value={timezone}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setTimezone(e.target.value);
                    dirty();
                  }}
                >
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
              <label className="ui-check">
                <input
                  type="checkbox"
                  checked={businessDays}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setBusinessDays(e.target.checked);
                    dirty();
                  }}
                />
                {t('sequences.businessDays')}
              </label>
              <p className="ui-help">{t('sequences.cronNote')}</p>
              <p className="ui-help">{t('sequences.gmailNote')}</p>
            </AdvancedSection>
          </div>
        </section>

        <section className="seq-steps" aria-labelledby={fid('steps')}>
          <h2 className="crm-panel-title" id={fid('steps')}>
            {t('sequences.steps')}
          </h2>
          <ol className="crm-line">
            {steps.length === 0 && (
              <li className="crm-stop">
                <span className="crm-station crm-station-ghost" aria-hidden="true" />
                <p className="ui-help">{t('sequences.noSteps')}</p>
              </li>
            )}
            {steps.map((s, i) => {
              const st = s.id ? stats[s.id] : undefined;
              const isFirstEmail = s.type === 'email' && emailIndex++ === 0;
              const typeLabel = t(`sequences.stepTypes.${s.type}`);
              return (
                <li key={s.key} className={`crm-stop seq-step seq-${s.type}`}>
                  <span className={`crm-station${s.type === 'wait' ? ' crm-station-ghost' : ''}`} aria-hidden="true">
                    {s.type !== 'wait' && <span className="crm-station-n">{i + 1}</span>}
                  </span>
                  <div className="crm-stop-body">
                    <div className="crm-stop-head">
                      <span className="seq-step-type">{typeLabel}</span>
                      {s.type === 'email' && st && st.sent > 0 && (
                        <span className="seq-stats data">
                          {t('sequences.statsLine', {
                            sent: st.sent,
                            opened: pct(st.opened, st.sent),
                            clicked: pct(st.clicked, st.sent),
                            replied: pct(st.replied, st.sent),
                          })}
                        </span>
                      )}
                      {canEdit && (
                        <RowTools
                          index={i}
                          count={steps.length}
                          onMove={(d) => move(i, d)}
                          onRemove={() => {
                            setSteps((list) => list.filter((_, j) => j !== i));
                            dirty();
                          }}
                          name={`${i + 1}. ${typeLabel}`}
                        />
                      )}
                    </div>

                    {s.type === 'wait' && (
                      <div className="seq-wait-row">
                        <label htmlFor={fid(`wait-${i}`)}>{t('sequences.waitFor')}</label>
                        <input
                          id={fid(`wait-${i}`)}
                          className="input data seq-days"
                          type="number"
                          min={0}
                          max={365}
                          value={s.waitDays}
                          disabled={!canEdit}
                          onChange={(e) => update(i, { waitDays: Math.max(0, Number(e.target.value) || 0) })}
                        />
                        <span>{t('sequences.days')}</span>
                      </div>
                    )}

                    {s.type === 'task' && (
                      <div className="ui-fields-2">
                        <div className="ui-field">
                          <label className="label" htmlFor={fid(`ts-${i}`)}>
                            {t('sequences.taskSubject')}
                          </label>
                          <input
                            id={fid(`ts-${i}`)}
                            className="input"
                            value={s.subject}
                            onChange={(e) => update(i, { subject: e.target.value })}
                            readOnly={!canEdit}
                            maxLength={500}
                          />
                        </div>
                        <div className="ui-field">
                          <label className="label" htmlFor={fid(`tb-${i}`)}>
                            {t('sequences.taskBody')}
                          </label>
                          <input
                            id={fid(`tb-${i}`)}
                            className="input"
                            value={s.body}
                            onChange={(e) => update(i, { body: e.target.value })}
                            readOnly={!canEdit}
                          />
                        </div>
                      </div>
                    )}

                    {s.type === 'email' && (
                      <div className="seq-fields">
                        <div className="ui-field">
                          <label className="label" htmlFor={fid(`tpl-${i}`)}>
                            {t('sequences.content')}
                          </label>
                          <select
                            id={fid(`tpl-${i}`)}
                            className="select"
                            value={s.templateId ?? ''}
                            disabled={!canEdit}
                            onChange={(e) => update(i, { templateId: e.target.value || null })}
                          >
                            <option value="">{t('sequences.customEmail')}</option>
                            {templates.length > 0 && (
                              <optgroup label={t('sequences.template')}>
                                {templates.map((tp) => (
                                  <option key={tp.id} value={tp.id}>
                                    {tp.name}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </div>
                        {!s.templateId && (
                          <>
                            {(isFirstEmail || s.newThread) && (
                              <div className="ui-field">
                                <label className="label" htmlFor={fid(`sub-${i}`)}>
                                  {t('templates.subject')}
                                </label>
                                <input
                                  id={fid(`sub-${i}`)}
                                  className="input"
                                  value={s.subject}
                                  onChange={(e) => update(i, { subject: e.target.value })}
                                  readOnly={!canEdit}
                                  maxLength={500}
                                />
                              </div>
                            )}
                            <div className="ui-field">
                              <label className="label" htmlFor={fid(`body-${i}`)}>
                                {t('templates.body')}
                              </label>
                              <textarea
                                id={fid(`body-${i}`)}
                                className="textarea"
                                rows={5}
                                value={s.body}
                                onChange={(e) => update(i, { body: e.target.value })}
                                readOnly={!canEdit}
                                maxLength={20000}
                              />
                            </div>
                          </>
                        )}
                        {!isFirstEmail && (
                          <label className="ui-check">
                            <input
                              type="checkbox"
                              checked={s.newThread}
                              disabled={!canEdit}
                              onChange={(e) => update(i, { newThread: e.target.checked })}
                            />
                            {t('sequences.newThread')}
                          </label>
                        )}
                        {!isFirstEmail && !s.newThread && <p className="ui-help">{t('sequences.replyThread')}</p>}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
            {canEdit && (
              <li className="crm-stop crm-stop-add">
                <span className="crm-station crm-station-ghost" aria-hidden="true" />
                <span className="seq-add">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => add('email')}>
                    {t('sequences.addEmailStep')}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => add('wait')}>
                    {t('sequences.addWaitStep')}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => add('task')}>
                    {t('sequences.addTaskStep')}
                  </button>
                </span>
              </li>
            )}
          </ol>
        </section>

        <div className="crm-savebar">
          <p className="ui-section-note" role="status" aria-live="polite" data-tone={error ? 'error' : state === 'saved' ? 'ok' : undefined}>
            {note}
          </p>
          {canEdit && (
            <span className="crm-savebar-actions">
              {confirmDelete ? (
                <>
                  <button type="button" className="btn btn-primary btn-danger btn-sm" onClick={remove} disabled={busy}>
                    {t('sequences.confirmDeleteCta')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
                    {t('common.cancel')}
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
                  {t('sequences.deleteSequence')}
                </button>
              )}
              <button type="submit" className="btn btn-primary btn-sm" aria-busy={busy || undefined} data-testid="sequence-save">
                {t('sequences.saveSequence')}
              </button>
            </span>
          )}
        </div>
      </form>

      <section className="seq-enrollments" aria-labelledby={fid('enr')}>
        <h2 className="crm-panel-title" id={fid('enr')}>
          {t('sequences.enrollments')} <span className="data seq-count">{enrollments.length}</span>
        </h2>
        {enrollments.length === 0 ? (
          <EmptyState quiet title={t('sequences.noEnrollmentsTitle')} body={t('sequences.noEnrollments')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('sequences.enrollments')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('sequences.contact')}</th>
                  <th scope="col">{t('sequences.status')}</th>
                  <th scope="col">{t('sequences.step')}</th>
                  <th scope="col">{t('sequences.nextRun')}</th>
                  <th scope="col">
                    <span className="sr-only">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e) => {
                  const live = e.status === 'active' || e.status === 'paused';
                  return (
                    <tr key={e.id} aria-busy={rowBusy === e.id || undefined}>
                      <td>
                        <Link href={`/app/crm/contacts/${e.contactId}`} className="cell-link">
                          {e.contactName}
                        </Link>
                      </td>
                      <td>
                        <span className={`badge ${STATUS_TONE[e.status]}`.trim()}>{t(`sequences.statuses.${e.status}`)}</span>
                        {e.exitReason && t.has(`sequences.reasons.${e.exitReason}`) && (
                          <span className="ui-help seq-reason">{t(`sequences.reasons.${e.exitReason}` as 'sequences.reasons.manual')}</span>
                        )}
                      </td>
                      <td className="data">{t('sequences.stepOf', { n: e.step, total: e.stepCount })}</td>
                      <td className="data">{e.status === 'active' ? (e.nextRun ?? '') : ''}</td>
                      <td className="crm-row-actions">
                        {live && (
                          <>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(e.id, e.status === 'active' ? 'pause' : 'resume')}>
                              {e.status === 'active' ? t('sequences.pause') : t('sequences.resume')}
                            </button>
                            <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => act(e.id, 'exit')}>
                              {t('sequences.exit')}
                            </button>
                          </>
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
