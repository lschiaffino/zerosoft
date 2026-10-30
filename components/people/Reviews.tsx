'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { Cycle, Question, ReviewDto } from '@/lib/people-perf';
import { api, Bar, Dialog, Field, useDay, useErrorText, useToast } from './people-ui';
import { ReviewAnswers } from './ProfileSections';

const STATUS_CLASS: Record<string, string> = { draft: 'badge-outline', active: 'badge-info', closed: 'badge-ok' };

export default function Reviews({ cycles, toWrite, hr }: { cycles: Cycle[]; toWrite: ReviewDto[]; hr: boolean }) {
  const t = useTranslations('people');
  const router = useRouter();
  const day = useDay();
  const errText = useErrorText();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const res = await api<{ cycle: { id: string } }>('/api/people/cycles', {
      method: 'POST',
      json: { name: fd.get('name'), dueDate: fd.get('dueDate') || null, selfReview: fd.get('self') === 'on', managerReview: fd.get('manager') === 'on', peerReview: fd.get('peer') === 'on' },
    });
    if (!res.ok) return setError(errText(res.data.error));
    setCreating(false);
    router.push(`/app/people/reviews/${res.data.cycle.id}`);
  };
  return (
    <div className="app-page ui-page ppl-page">
      <PageHeader
        title={t('nav.reviews')}
        description={t('reviews.desc')}
        actions={
          hr ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              {t('reviews.newCycle')}
            </button>
          ) : undefined
        }
      />
      <h2 className="ppl-subtitle">{t('reviews.toWrite')}</h2>
      {toWrite.length === 0 ? (
        <EmptyState compact quiet body={t('reviews.nothingToWrite')} />
      ) : (
        <ul className="ppl-list" data-testid="people-to-write">
          {toWrite.map((r) => (
            <li key={r.id}>
              <Link href={`/app/people/reviews/${r.cycleId}?review=${r.id}`}>{r.kind === 'self' ? t('reviews.yourSelf') : t('reviews.about', { name: r.subjectName })}</Link>
              <span className="ppl-muted">
                {' · '}
                {r.cycleName} · {t(`reviews.kinds.${r.kind}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h2 className="ppl-subtitle">{t('reviews.cycles')}</h2>
      {cycles.length === 0 ? (
        <EmptyState product="people" title={t('reviews.emptyTitle')} body={hr ? t('reviews.emptyBody') : t('reviews.emptyBodyMember')} />
      ) : (
        <div className="table-wrap">
          <table className="table ppl-table">
            <thead>
              <tr>
                <th scope="col">{t('fields.name')}</th>
                <th scope="col">{t('reviews.statusLabel')}</th>
                <th scope="col" className="ppl-hide-sm">
                  {t('reviews.due')}
                </th>
                <th scope="col">{t('reviews.progressLabel')}</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    <Link href={`/app/people/reviews/${c.id}`} className="ppl-rowtitle">
                      {c.name}
                    </Link>
                  </th>
                  <td>
                    <span className={`badge ${STATUS_CLASS[c.status]}`}>{t(`reviews.status.${c.status}`)}</span>
                  </td>
                  <td className="ppl-hide-sm">{c.dueDate ? day(c.dueDate) : ''}</td>
                  <td>
                    {c.status === 'draft' ? '' : t('reviews.progress', { done: c.progress.submitted, total: c.progress.total })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={creating} title={t('reviews.newCycle')} onClose={() => setCreating(false)}>
        <form onSubmit={create}>
          <div className="ui-modal-body ui-fields">
            <Field label={t('fields.name')} htmlFor="cy-name">
              <input id="cy-name" name="name" className="input" required maxLength={120} autoFocus placeholder={t('reviews.namePlaceholder')} />
            </Field>
            <Field label={t('reviews.due')} htmlFor="cy-due">
              <input id="cy-due" name="dueDate" type="date" className="input" />
            </Field>
            <fieldset className="ppl-fieldset">
              <legend className="label">{t('reviews.who')}</legend>
              <label className="ppl-check">
                <input type="checkbox" name="self" defaultChecked />
                <span>{t('reviews.kinds.self')}</span>
              </label>
              <label className="ppl-check">
                <input type="checkbox" name="manager" defaultChecked />
                <span>{t('reviews.kinds.manager')}</span>
              </label>
              <label className="ppl-check">
                <input type="checkbox" name="peer" />
                <span>{t('reviews.kinds.peer')}</span>
              </label>
            </fieldset>
            {error && (
              <p className="ppl-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('common.create')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/** Un ciclo: preguntas (en borrador), lanzar y cerrar (HR), y las evaluaciones que quien mira puede ver o escribir. */
export function CycleDetail({ cycle, reviews, hr, focus }: { cycle: Cycle; reviews: ReviewDto[]; hr: boolean; focus: string | null }) {
  const t = useTranslations('people');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [questions, setQuestions] = useState<Question[]>(cycle.questions);
  const [confirm, setConfirm] = useState(false);
  const draft = cycle.status === 'draft';

  const patch = async (body: Record<string, unknown>, msg: string) => {
    const res = await api(`/api/people/cycles/${cycle.id}`, { method: 'PATCH', json: body });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(msg);
    router.refresh();
  };
  const launch = async () => {
    const res = await api(`/api/people/cycles/${cycle.id}/launch`, { method: 'POST', json: {} });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(t('reviews.launched'));
    router.refresh();
  };
  const remove = async () => {
    const res = await api(`/api/people/cycles/${cycle.id}`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.push('/app/people/reviews');
    router.refresh();
  };
  const mine = reviews.filter((r) => r.canWrite);
  const others = reviews.filter((r) => !r.canWrite);
  const subjects = [...new Set(others.map((r) => r.subjectId))];

  return (
    <div className="app-page ui-page ppl-page">
      {toast}
      <PageHeader
        back={{ href: '/app/people/reviews', label: t('nav.reviews') }}
        title={cycle.name}
        description={`${t(`reviews.status.${cycle.status}`)}${cycle.status !== 'draft' ? ` · ${t('reviews.progress', { done: cycle.progress.submitted, total: cycle.progress.total })}` : ''}`}
        actions={
          hr ? (
            <>
              {draft && (
                <button type="button" className="btn btn-primary" onClick={launch}>
                  {t('reviews.launch')}
                </button>
              )}
              {cycle.status === 'active' && (
                <button type="button" className="btn btn-secondary" onClick={() => patch({ status: 'closed' }, t('reviews.closed'))}>
                  {t('reviews.close')}
                </button>
              )}
              <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
                {t('common.delete')}
              </button>
            </>
          ) : undefined
        }
      />
      {cycle.status !== 'draft' && <Bar value={cycle.progress.submitted} max={cycle.progress.total} label={t('reviews.progress', { done: cycle.progress.submitted, total: cycle.progress.total })} />}

      {hr && draft && (
        <section className="ppl-panel">
          <div className="ppl-panel-head">
            <h2 className="ppl-panel-title">{t('reviews.questions')}</h2>
          </div>
          <p className="ppl-hint">{t('reviews.draftHint')}</p>
          <ol className="ppl-stack">
            {questions.map((q, i) => (
              <li key={q.id} className="ppl-inline-form">
                <input
                  className="input"
                  value={q.text}
                  aria-label={t('reviews.questionN', { n: i + 1 })}
                  maxLength={300}
                  onChange={(e) => setQuestions((xs) => xs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                />
                <select
                  className="select"
                  value={q.kind}
                  aria-label={t('reviews.questionKind')}
                  onChange={(e) => setQuestions((xs) => xs.map((x, j) => (j === i ? { ...x, kind: e.target.value as Question['kind'] } : x)))}
                >
                  <option value="text">{t('reviews.kindText')}</option>
                  <option value="rating">{t('reviews.kindRating')}</option>
                </select>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setQuestions((xs) => xs.filter((_, j) => j !== i))}>
                  {t('common.delete')}
                </button>
              </li>
            ))}
          </ol>
          <div className="ppl-panel-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQuestions((xs) => [...xs, { id: `q${Date.now() % 100000}`, text: '', kind: 'text' }])}>
              {t('reviews.addQuestion')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => patch({ questions: questions.filter((q) => q.text.trim()) }, t('common.saved'))}>
              {t('common.save')}
            </button>
          </div>
        </section>
      )}

      {mine.map((r) => (
        <ReviewForm key={r.id} review={r} autoFocus={focus === r.id} onDone={() => router.refresh()} />
      ))}

      {subjects.length > 0 && <h2 className="ppl-subtitle">{t('reviews.results')}</h2>}
      {subjects.map((s) => {
        const rs = others.filter((r) => r.subjectId === s);
        return (
          <section key={s} className="ppl-panel" aria-label={rs[0].subjectName}>
            <h3 className="ppl-panel-title">
              <Link href={`/app/people/${s}?tab=performance`}>{rs[0].subjectName}</Link>
            </h3>
            {rs.map((r) => (
              <article key={r.id} className="ppl-review" data-testid="people-review">
                <h4 className="ppl-review-title">
                  {t(`reviews.kinds.${r.kind}`)}
                  {r.reviewerName && <span className="ppl-muted"> · {r.reviewerName}</span>}
                  <span className={`badge ${r.status === 'submitted' ? 'badge-ok' : 'badge-warn'}`}>{t(`reviews.reviewStatus.${r.status}`)}</span>
                </h4>
                {r.status === 'submitted' && <ReviewAnswers review={r} />}
              </article>
            ))}
          </section>
        );
      })}
      {!draft && mine.length === 0 && subjects.length === 0 && <EmptyState compact quiet body={t('reviews.nothingVisible')} />}

      <Dialog open={confirm} title={t('reviews.deleteCycle')} onClose={() => setConfirm(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void remove();
          }}
        >
          <div className="ui-modal-body">
            <p>{t('reviews.deleteBody', { name: cycle.name })}</p>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary btn-danger" autoFocus>
              {t('common.delete')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function ReviewForm({ review, autoFocus, onDone }: { review: ReviewDto; autoFocus: boolean; onDone: () => void }) {
  const t = useTranslations('people');
  const errText = useErrorText();
  const [answers, setAnswers] = useState<Record<string, string | number>>(review.answers);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const send = async (submit: boolean) => {
    setError('');
    setSaved('');
    const res = await api(`/api/people/reviews/${review.id}`, { method: 'PATCH', json: { answers, submit } });
    if (!res.ok) return setError(errText(res.data.error));
    if (submit) onDone();
    else setSaved(t('common.saved'));
  };
  return (
    <form
      className="ppl-panel"
      data-testid="people-review-form"
      onSubmit={(e) => {
        e.preventDefault();
        void send(true);
      }}
    >
      <h2 className="ppl-panel-title">{review.kind === 'self' ? t('reviews.yourSelf') : t('reviews.about', { name: review.subjectName })}</h2>
      <div className="ui-fields">
        {review.questions.map((q, i) => (
          <Field key={q.id} label={q.text} htmlFor={`rv-${review.id}-${q.id}`}>
            {q.kind === 'rating' ? (
              <select
                id={`rv-${review.id}-${q.id}`}
                className="select"
                required
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: Number(e.target.value) }))}
                autoFocus={autoFocus && i === 0}
              >
                <option value="">{t('reviews.pickRating')}</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {t(`reviews.ratings.r${n}`)}
                  </option>
                ))}
              </select>
            ) : (
              <textarea
                id={`rv-${review.id}-${q.id}`}
                className="textarea"
                required
                maxLength={4000}
                value={String(answers[q.id] ?? '')}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                autoFocus={autoFocus && i === 0}
              />
            )}
          </Field>
        ))}
      </div>
      {error && (
        <p className="ppl-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="ppl-hint" role="status">
          {saved}
        </p>
      )}
      <div className="ppl-panel-actions">
        <button type="button" className="btn btn-secondary" onClick={() => void send(false)}>
          {t('reviews.saveDraft')}
        </button>
        <button type="submit" className="btn btn-primary">
          {t('reviews.submit')}
        </button>
      </div>
    </form>
  );
}
