'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import PageHeader from '@/components/ui/PageHeader';
import { PROPERTY_OPS, type PropertyOp } from '@/lib/analytics/types';
import {
  SURVEY_MAX_CHOICES,
  SURVEY_MAX_QUESTIONS,
  SURVEY_POSITIONS,
  SURVEY_QUESTION_TYPES,
  surveyQuestionSchema,
  type SurveyAppearance,
  type SurveyDto,
  type SurveyQuestion,
  type SurveyStatus,
  type SurveyTargeting,
} from '@/lib/analytics/more-types';
import { dayToMs, msToDay, surveyDisplayStatus } from '@/lib/analytics/surveys-core';
import SurveyPreview from './SurveyPreview';
import { SurveyStatusBadge, SurveyTabs } from './SurveyStatusBadge';
import { ApiError, api, notifyChanged } from './client';

const NEEDS_VALUE: PropertyOp[] = ['eq', 'neq', 'contains', 'not_contains', 'gt', 'lt'];

function newId(): string {
  return `q_${Math.random().toString(36).slice(2, 10)}`;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="ui-field an-sv-color">
      <span className="label">{label}</span>
      <span className="an-row">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        <span className="an-mono an-muted">{value}</span>
      </span>
    </label>
  );
}

/** Una encuesta: preguntas, apariencia, a quién se le muestra y cuándo, con vista previa al lado. */
export default function SurveyEditor({
  survey,
  flagKeys,
  publicKey,
  tzOffsetMin,
  now,
}: {
  survey: SurveyDto;
  flagKeys: string[];
  publicKey: string;
  tzOffsetMin: number;
  now: number;
}) {
  const t = useTranslations('analyticsMore.surveys');
  const te = useTranslations('analyticsMore.editor');
  const tf = useTranslations('analytics.filters');
  const tc = useTranslations('analytics.common');
  const router = useRouter();
  const [name, setName] = useState(survey.name);
  const [status, setStatus] = useState<SurveyStatus>(survey.status);
  const [presentation, setPresentation] = useState(survey.presentation);
  const [questions, setQuestions] = useState<SurveyQuestion[]>(survey.questions);
  const [appearance, setAppearance] = useState<SurveyAppearance>(survey.appearance);
  const [targeting, setTargeting] = useState<SurveyTargeting>(survey.targeting);
  const [startDay, setStartDay] = useState(msToDay(survey.startAt, tzOffsetMin));
  const [endDay, setEndDay] = useState(msToDay(survey.endAt, tzOffsetMin));
  const [previewIndex, setPreviewIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [origin, setOrigin] = useState('https://zerosoft.ai');
  useEffect(() => setOrigin(window.location.origin), []);

  const startAt = startDay ? dayToMs(startDay, tzOffsetMin, 'start') : null;
  const endAt = endDay ? dayToMs(endDay, tzOffsetMin, 'end') : null;
  const display = surveyDisplayStatus({ status, startAt, endAt }, now);
  const endPassed = endAt !== null && endAt <= now;
  const setQ = (i: number, patch: Partial<SurveyQuestion>) => setQuestions((list) => list.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  /** La primera pregunta que no se puede guardar (para decirlo antes de ir al servidor). */
  const invalidIndex = questions.findIndex((q) => !surveyQuestionSchema.safeParse(q).success);

  const save = async (nextStatus?: SurveyStatus) => {
    setMsg(null);
    if (invalidIndex >= 0) {
      setMsg({ ok: false, text: te('invalidQuestion', { n: invalidIndex + 1 }) });
      return;
    }
    if (startAt !== null && endAt !== null && endAt <= startAt) {
      setMsg({ ok: false, text: te('invalidDates') });
      return;
    }
    setBusy(true);
    try {
      await api(`/api/analytics/surveys/${survey.id}`, {
        method: 'PATCH',
        body: { name, presentation, questions, appearance, targeting, startAt, endAt, ...(nextStatus ? { status: nextStatus } : {}) },
      });
      if (nextStatus) setStatus(nextStatus);
      setMsg({ ok: true, text: te('saved') });
      notifyChanged();
      router.refresh();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setMsg({ ok: false, text: code === 'invalid_dates' ? te('invalidDates') : code === 'invalid_input' ? te('invalidForm') : tc('error') });
    } finally {
      setBusy(false);
    }
  };

  const actions = (
    <>
      {status === 'draft' && (
        <button type="button" className="btn btn-primary" onClick={() => void save('running')} disabled={busy}>
          {te('start')}
        </button>
      )}
      {status === 'running' && (
        <>
          <button type="button" className="btn" onClick={() => void save('paused')} disabled={busy}>
            {te('pause')}
          </button>
          <button type="button" className="btn" onClick={() => void save('ended')} disabled={busy}>
            {te('end')}
          </button>
        </>
      )}
      {status === 'paused' && (
        <>
          <button type="button" className="btn btn-primary" onClick={() => void save('running')} disabled={busy}>
            {te('resume')}
          </button>
          <button type="button" className="btn" onClick={() => void save('ended')} disabled={busy}>
            {te('end')}
          </button>
        </>
      )}
      {status === 'ended' && (
        <button type="button" className="btn" onClick={() => void save('running')} disabled={busy}>
          {te('reopen')}
        </button>
      )}
      <button type="button" className="btn btn-ghost" onClick={() => setDeleting(true)}>
        {tc('delete')}
      </button>
    </>
  );

  const apiExample = `zs.getSurveys((surveys) => {
  const survey = surveys.find((s) => s.id === '${survey.id}');
  if (!survey) return;
  // Show it with your own UI, then send what the person answered:
  zs.capture('survey shown', { $survey_id: survey.id });
  zs.capture('survey sent', {
    $survey_id: survey.id,
    $survey_response_${questions[0]?.id ?? 'q1'}: 9,
  });
});`;
  const curlExample = `curl -X POST ${origin}/api/ingest/e \\
  -d '{"api_key":"${publicKey}","event":"survey sent","distinct_id":"user-123","properties":{"$survey_id":"${survey.id}","$survey_response_${questions[0]?.id ?? 'q1'}":9}}'`;

  return (
    <div className="app-page ui-page an-page">
      <PageHeader back={{ href: '/app/analytics/surveys', label: t('title') }} title={name || survey.name} description={<SurveyStatusBadge status={display} />} actions={actions} />
      <SurveyTabs id={survey.id} current="edit" />
      {status === 'running' && endPassed && <p className="an-callout an-note">{te('endPassed')}</p>}
      <div className="an-sv-grid">
        <form
          className="an-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <section className="an-panel an-form" aria-labelledby="an-sv-basics">
            <h2 id="an-sv-basics" className="an-h3">
              {te('basics')}
            </h2>
            <label className="ui-field">
              <span className="label">{t('name')}</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
            </label>
            <label className="ui-field">
              <span className="label">{te('presentation')}</span>
              <select className="select" value={presentation} onChange={(e) => setPresentation(e.target.value === 'api' ? 'api' : 'popover')}>
                <option value="popover">{te('presentationPopover')}</option>
                <option value="api">{te('presentationApi')}</option>
              </select>
              <span className="ui-help">{presentation === 'api' ? te('presentationApiHelp') : te('presentationPopoverHelp')}</span>
            </label>
          </section>

          <section className="an-panel an-form" aria-labelledby="an-sv-questions">
            <h2 id="an-sv-questions" className="an-h3">
              {te('questions')}
            </h2>
            {questions.map((q, i) => (
              <fieldset key={q.id} className="an-series" onFocus={() => setPreviewIndex(i)}>
                <legend className="an-series-legend">{te('questionN', { n: i + 1 })}</legend>
                <div className="ui-fields ui-fields-2">
                  <label className="ui-field">
                    <span className="label">{te('questionType')}</span>
                    <select
                      className="select"
                      value={q.type}
                      data-testid={`an-sv-type-${i}`}
                      onChange={(e) => {
                        const type = e.target.value as SurveyQuestion['type'];
                        setQ(i, { type, choices: (type === 'single' || type === 'multiple') && q.choices.length < 2 ? [te('choiceDefault', { n: 1 }), te('choiceDefault', { n: 2 })] : q.choices });
                      }}
                    >
                      {SURVEY_QUESTION_TYPES.map((ty) => (
                        <option key={ty} value={ty}>
                          {te(`types.${ty}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {q.type === 'rating' && (
                    <label className="ui-field">
                      <span className="label">{te('scale')}</span>
                      <select className="select" value={q.scale} onChange={(e) => setQ(i, { scale: Number(e.target.value) === 10 ? 10 : 5 })}>
                        <option value={5}>{te('scale5')}</option>
                        <option value={10}>{te('scale10')}</option>
                      </select>
                    </label>
                  )}
                </div>
                <label className="ui-field">
                  <span className="label">{te('questionText')}</span>
                  <input className="input" value={q.text} onChange={(e) => setQ(i, { text: e.target.value })} maxLength={500} required />
                </label>
                <label className="ui-field">
                  <span className="label">{te('questionDescription')}</span>
                  <input className="input" value={q.description} onChange={(e) => setQ(i, { description: e.target.value })} maxLength={500} />
                </label>
                {q.type === 'rating' && (
                  <div className="ui-fields ui-fields-2">
                    <label className="ui-field">
                      <span className="label">{te('lowLabel')}</span>
                      <input className="input" value={q.lowLabel} onChange={(e) => setQ(i, { lowLabel: e.target.value })} maxLength={60} />
                    </label>
                    <label className="ui-field">
                      <span className="label">{te('highLabel')}</span>
                      <input className="input" value={q.highLabel} onChange={(e) => setQ(i, { highLabel: e.target.value })} maxLength={60} />
                    </label>
                  </div>
                )}
                {(q.type === 'single' || q.type === 'multiple') && (
                  <label className="ui-field">
                    <span className="label">{te('choices')}</span>
                    <textarea
                      className="textarea"
                      rows={Math.min(SURVEY_MAX_CHOICES, q.choices.length + 1)}
                      value={q.choices.join('\n')}
                      data-testid={`an-sv-choices-${i}`}
                      onChange={(e) => setQ(i, { choices: e.target.value.split('\n').slice(0, SURVEY_MAX_CHOICES).map((c) => c.slice(0, 120)) })}
                      onBlur={() => setQ(i, { choices: [...new Set(q.choices.map((c) => c.trim()).filter(Boolean))] })}
                    />
                    <span className="ui-help">{te('choicesHelp', { max: SURVEY_MAX_CHOICES })}</span>
                  </label>
                )}
                <label className="ui-check">
                  <input type="checkbox" checked={q.optional} onChange={(e) => setQ(i, { optional: e.target.checked })} /> {te('optional')}
                </label>
                <div className="an-row an-wrap">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={i === 0}
                    onClick={() => setQuestions((list) => list.map((x, j) => (j === i - 1 ? list[i] : j === i ? list[i - 1] : x)))}
                  >
                    {te('moveUp')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={i === questions.length - 1}
                    onClick={() => setQuestions((list) => list.map((x, j) => (j === i + 1 ? list[i] : j === i ? list[i + 1] : x)))}
                  >
                    {te('moveDown')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={questions.length === 1}
                    title={questions.length === 1 ? te('atLeastOne') : undefined}
                    onClick={() => {
                      setQuestions((list) => list.filter((_, j) => j !== i));
                      setPreviewIndex(0);
                    }}
                  >
                    {tc('remove')}
                  </button>
                </div>
              </fieldset>
            ))}
            <div className="an-row an-wrap">
              <button
                type="button"
                className="btn btn-sm"
                disabled={questions.length >= SURVEY_MAX_QUESTIONS}
                onClick={() => {
                  setQuestions((list) => [...list, { id: newId(), type: 'open', text: te('newQuestionText'), description: '', scale: 5, lowLabel: '', highLabel: '', choices: [], optional: false }]);
                  setPreviewIndex(questions.length);
                }}
              >
                + {te('addQuestion')}
              </button>
              {questions.length >= SURVEY_MAX_QUESTIONS && <span className="an-note">{te('maxQuestions', { max: SURVEY_MAX_QUESTIONS })}</span>}
            </div>
            {survey.status !== 'draft' && <p className="an-note">{te('editLiveNote')}</p>}
          </section>

          {presentation === 'popover' && (
            <section className="an-panel an-form" aria-labelledby="an-sv-look">
              <h2 id="an-sv-look" className="an-h3">
                {te('appearance')}
              </h2>
              <label className="ui-field">
                <span className="label">{te('position')}</span>
                <select className="select" value={appearance.position} onChange={(e) => setAppearance({ ...appearance, position: e.target.value as SurveyAppearance['position'] })}>
                  {SURVEY_POSITIONS.map((p) => (
                    <option key={p} value={p}>
                      {te(`positions.${p}`)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="an-sv-colors">
                <ColorField label={te('colorBackground')} value={appearance.background} onChange={(background) => setAppearance({ ...appearance, background })} />
                <ColorField label={te('colorText')} value={appearance.text} onChange={(text) => setAppearance({ ...appearance, text })} />
                <ColorField label={te('colorButton')} value={appearance.button} onChange={(button) => setAppearance({ ...appearance, button })} />
                <ColorField label={te('colorButtonText')} value={appearance.buttonText} onChange={(buttonText) => setAppearance({ ...appearance, buttonText })} />
              </div>
              <div className="ui-fields ui-fields-2">
                <label className="ui-field">
                  <span className="label">{te('submitText')}</span>
                  <input className="input" value={appearance.submitText} onChange={(e) => setAppearance({ ...appearance, submitText: e.target.value })} maxLength={40} required />
                </label>
                <label className="ui-field">
                  <span className="label">{te('thankYou')}</span>
                  <input className="input" value={appearance.thankYou} onChange={(e) => setAppearance({ ...appearance, thankYou: e.target.value })} maxLength={200} />
                  <span className="ui-help">{te('thankYouHelp')}</span>
                </label>
              </div>
            </section>
          )}

          <section className="an-panel an-form" aria-labelledby="an-sv-target">
            <h2 id="an-sv-target" className="an-h3">
              {te('targeting')}
            </h2>
            <label className="ui-field">
              <span className="label">{te('urlContains')}</span>
              <input className="input an-mono" value={targeting.urlContains} onChange={(e) => setTargeting({ ...targeting, urlContains: e.target.value })} maxLength={300} placeholder="/pricing" />
              <span className="ui-help">{te('urlContainsHelp')}</span>
            </label>
            <label className="ui-field">
              <span className="label">{te('flag')}</span>
              <select className="select" value={targeting.flagKey ?? ''} onChange={(e) => setTargeting({ ...targeting, flagKey: e.target.value || null })} disabled={!flagKeys.length && !targeting.flagKey}>
                <option value="">{te('flagNone')}</option>
                {[...new Set([...flagKeys, ...(targeting.flagKey ? [targeting.flagKey] : [])])].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <span className="ui-help">{flagKeys.length ? te('flagHelp') : te('flagEmpty')}</span>
            </label>
            <div className="ui-field">
              <span className="label">{te('personFilter')}</span>
              {targeting.personFilter ? (
                <div className="an-filter" role="group" aria-label={te('personFilter')}>
                  <input
                    className="input an-filter-key"
                    aria-label={tf('property')}
                    placeholder={tf('property')}
                    value={targeting.personFilter.key}
                    onChange={(e) => setTargeting({ ...targeting, personFilter: { ...targeting.personFilter!, key: e.target.value } })}
                    maxLength={200}
                    spellCheck={false}
                  />
                  <select
                    className="select an-filter-op"
                    aria-label={tf('operator')}
                    value={targeting.personFilter.op}
                    onChange={(e) => setTargeting({ ...targeting, personFilter: { ...targeting.personFilter!, op: e.target.value as PropertyOp } })}
                  >
                    {PROPERTY_OPS.map((op) => (
                      <option key={op} value={op}>
                        {tf(`ops.${op}`)}
                      </option>
                    ))}
                  </select>
                  {NEEDS_VALUE.includes(targeting.personFilter.op) && (
                    <input
                      className="input an-filter-value"
                      aria-label={tf('value')}
                      placeholder={tf('value')}
                      value={targeting.personFilter.value === undefined || targeting.personFilter.value === null ? '' : String(targeting.personFilter.value)}
                      onChange={(e) => setTargeting({ ...targeting, personFilter: { ...targeting.personFilter!, value: e.target.value } })}
                      maxLength={500}
                    />
                  )}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTargeting({ ...targeting, personFilter: null })} aria-label={tf('remove')}>
                    ×
                  </button>
                </div>
              ) : (
                <div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTargeting({ ...targeting, personFilter: { key: '', op: 'eq', value: '' } })}>
                    + {tf('add')}
                  </button>
                </div>
              )}
              <span className="ui-help">{te('personFilterHelp')}</span>
            </div>
            <label className="ui-check">
              <input type="checkbox" checked={targeting.showOnce} onChange={(e) => setTargeting({ ...targeting, showOnce: e.target.checked })} /> {te('showOnce')}
            </label>
            <p className="ui-help">{te('showOnceHelp')}</p>
            <div className="ui-fields ui-fields-2">
              <label className="ui-field">
                <span className="label">{te('delay')}</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={600}
                  value={targeting.delaySeconds}
                  onChange={(e) => setTargeting({ ...targeting, delaySeconds: Math.min(600, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
                />
              </label>
              <label className="ui-field">
                <span className="label">{te('sampling')}</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={100}
                  value={targeting.sampling}
                  onChange={(e) => setTargeting({ ...targeting, sampling: Math.min(100, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
                />
                <span className="ui-help">{te('samplingHelp')}</span>
              </label>
            </div>
            <div className="ui-fields ui-fields-2">
              <label className="ui-field">
                <span className="label">{te('startDate')}</span>
                <input className="input" type="date" value={startDay} onChange={(e) => setStartDay(e.target.value)} />
              </label>
              <label className="ui-field">
                <span className="label">{te('endDate')}</span>
                <input className="input" type="date" value={endDay} onChange={(e) => setEndDay(e.target.value)} />
              </label>
            </div>
            <p className="ui-help">{te('datesHelp')}</p>
          </section>

          {presentation === 'api' && (
            <section className="an-panel an-form" aria-labelledby="an-sv-api">
              <h2 id="an-sv-api" className="an-h3">
                {te('apiTitle')}
              </h2>
              <p className="an-note">{te('apiBody')}</p>
              <pre className="an-code">
                <code>{apiExample}</code>
              </pre>
              <p className="an-note">{te('apiCurl')}</p>
              <pre className="an-code">
                <code>{curlExample}</code>
              </pre>
            </section>
          )}

          <div className="an-row an-wrap an-sv-savebar">
            <button type="submit" className="btn btn-primary" disabled={busy} data-testid="an-sv-save">
              {tc('save')}
            </button>
            {msg && (
              <span className={msg.ok ? 'an-saved' : 'ui-error'} role={msg.ok ? 'status' : 'alert'}>
                {msg.text}
              </span>
            )}
          </div>
        </form>
        <aside className="an-sv-side" aria-label={te('preview')}>
          <h2 className="an-h3">{te('preview')}</h2>
          {presentation === 'popover' ? (
            <SurveyPreview questions={questions} appearance={appearance} index={Math.min(previewIndex, questions.length - 1)} onIndex={setPreviewIndex} />
          ) : (
            <p className="an-note">{te('previewApi')}</p>
          )}
        </aside>
      </div>
      <ConfirmDialog
        open={deleting}
        title={t('deleteTitle', { name: survey.name })}
        body={t('deleteBody')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api(`/api/analytics/surveys/${survey.id}`, { method: 'DELETE' });
            notifyChanged();
            router.replace('/app/analytics/surveys');
          } catch {
            setBusy(false);
            setDeleting(false);
            setMsg({ ok: false, text: tc('error') });
          }
        }}
      />
    </div>
  );
}
