'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import type { SurveyDto } from '@/lib/people-extras';
import { api, Dialog, Field, useErrorText, useToast } from './people-ui';

const SCORES = Array.from({ length: 11 }, (_, i) => i);

function AnswerForm({ survey, onDone, hideQuestion }: { survey: SurveyDto; onDone: () => void; hideQuestion: boolean }) {
  const t = useTranslations('people');
  const errText = useErrorText();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (score === null) return;
    const res = await api(`/api/people/surveys/${survey.id}`, { method: 'POST', json: { score, comment } });
    if (!res.ok) return setError(errText(res.data.error));
    onDone();
  };
  return (
    <form className="ui-fields" onSubmit={submit} data-testid="people-survey-form">
      <fieldset className="ppl-scores">
        <legend className={hideQuestion ? 'label' : 'ppl-panel-title'}>{hideQuestion ? t('surveys.yourAnswer') : survey.question}</legend>
        {SCORES.map((n) => (
          <label key={n} className={`ppl-score${score === n ? ' ppl-score-on' : ''}`}>
            <input type="radio" className="sr-only" name={`score-${survey.id}`} value={n} checked={score === n} onChange={() => setScore(n)} />
            {n}
          </label>
        ))}
      </fieldset>
      <p className="ppl-hint">{t('surveys.scale')}</p>
      <Field label={t('surveys.comment')} htmlFor={`cm-${survey.id}`} hint={t('surveys.anonymous')}>
        <textarea id={`cm-${survey.id}`} className="input" rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={score === null}>
          {t('surveys.send')}
        </button>
      </div>
    </form>
  );
}

/** eNPS: HR abre una encuesta; cada persona responde una vez, sin nombre; el resultado se ve desde 3 respuestas. */
export default function Surveys({ surveys, hr }: { surveys: SurveyDto[]; hr: boolean }) {
  const t = useTranslations('people');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SurveyDto | null>(null);
  const refresh = (msg?: string) => {
    if (msg) push(msg);
    router.refresh();
  };
  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const res = await api('/api/people/surveys', { method: 'POST', json: { question: new FormData(e.currentTarget).get('question') } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setCreating(false);
    refresh();
  };
  const rename = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const res = await api(`/api/people/surveys/${editing.id}`, { method: 'PATCH', json: { question: new FormData(e.currentTarget).get('question') } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setEditing(null);
    refresh();
  };
  const act = async (id: string, method: 'PATCH' | 'DELETE') => {
    const res = await api(`/api/people/surveys/${id}`, { method, ...(method === 'PATCH' ? { json: { status: 'closed' } } : {}) });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    refresh();
  };
  if (!hr && !surveys.length) return null;
  return (
    <section id="surveys" aria-labelledby="ppl-surveys-title" data-testid="people-surveys">
      {toast}
      <div className="ppl-panel-head">
        <h2 id="ppl-surveys-title" className="ppl-subtitle">
          {t('surveys.title')}
        </h2>
        {hr && (
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setCreating(true)}>
            {t('surveys.new')}
          </button>
        )}
      </div>
      {surveys.length === 0 ? (
        <EmptyState compact quiet body={t('surveys.empty')} />
      ) : (
        surveys.map((s) => (
          <article key={s.id} className="ppl-panel">
            {hr && (
              <>
                <div className="ppl-panel-head">
                  <h3 className="ppl-panel-title">{s.question}</h3>
                  <span className={`badge ${s.status === 'open' ? 'badge-info' : 'badge-outline'}`}>{t(`surveys.status.${s.status}`)}</span>
                </div>
                {s.score === null ? (
                  <p className="ppl-hint">{t(s.status === 'closed' ? 'surveys.closedTooFew' : 'surveys.tooFew', { count: s.responses })}</p>
                ) : (
                  <>
                    <p className="ppl-survey-score">
                      <span className="ppl-card-value" data-testid="people-enps">
                        {s.score > 0 ? `+${s.score}` : s.score}
                      </span>
                      <span className="ppl-muted">{t('surveys.summary', { count: s.responses, promoters: s.promoters ?? 0, passives: s.passives ?? 0, detractors: s.detractors ?? 0 })}</span>
                    </p>
                    {s.comments.length > 0 && (
                      <ul className="ppl-list">
                        {s.comments.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                <div className="ppl-panel-actions">
                  {s.responses === 0 && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(s)}>
                      {t('common.edit')}
                    </button>
                  )}
                  {s.status === 'open' && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => void act(s.id, 'PATCH')}>
                      {t('surveys.close')}
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void act(s.id, 'DELETE')}>
                    {t('common.delete')}
                  </button>
                </div>
              </>
            )}
            {s.status === 'open' && (
              <div className={hr ? 'ppl-survey-answer' : undefined}>
                {s.answered ? (
                  <>
                    {!hr && <h3 className="ppl-panel-title">{s.question}</h3>}
                    <p className="ppl-hint">{t('surveys.thanks')}</p>
                  </>
                ) : (
                  <AnswerForm survey={s} hideQuestion={hr} onDone={() => refresh(t('surveys.thanks'))} />
                )}
              </div>
            )}
          </article>
        ))
      )}
      <Dialog open={editing !== null} title={t('common.edit')} onClose={() => setEditing(null)}>
        <form onSubmit={rename}>
          <div className="ui-modal-body ui-fields">
            <Field label={t('surveys.question')} htmlFor="svy-edit">
              <textarea key={editing?.id} id="svy-edit" name="question" className="input" rows={2} required maxLength={300} defaultValue={editing?.question ?? ''} autoFocus />
            </Field>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Dialog>
      <Dialog open={creating} title={t('surveys.new')} onClose={() => setCreating(false)}>
        <form onSubmit={create}>
          <div className="ui-modal-body ui-fields">
            <Field label={t('surveys.question')} htmlFor="svy-q" hint={t('surveys.newHint')}>
              <textarea id="svy-q" name="question" className="input" rows={2} required maxLength={300} defaultValue={t('surveys.defaultQuestion')} autoFocus />
            </Field>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('surveys.open')}
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
