'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import type { Balance } from '@/lib/people-time';
import type { Policy, RequestDto } from '@/lib/people-timeoff';
import type { PeopleDocument } from '@/lib/people-docs';
import type { CompEntry } from '@/lib/people';
import type { Checklist } from '@/lib/people-onboarding';
import type { Goal, OneOnOne, ReviewDto } from '@/lib/people-perf';
import { api, Bar, Dialog, Field, useDay, useErrorText, useNumber, useToast } from './people-ui';
import RequestDialog from './RequestDialog';
import RequestsTable from './RequestsTable';
import ChecklistView from './ChecklistView';

/** Carga una URL de la API con estados de carga y error. */
export function useLoad<T>(url: string): { data: T | null; error: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(false);
    void api<T>(url).then((r) => {
      if (!alive) return;
      if (r.ok) setData(r.data);
      else setError(true);
    });
    return () => {
      alive = false;
    };
  }, [url, n]);
  return { data, error, reload: useCallback(() => setN((x) => x + 1), []) };
}

export function Loading() {
  const t = useTranslations('people.common');
  return (
    <div className="ui-loading-stack" aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading')}
      </span>
      {[0, 1, 2].map((i) => (
        <span key={i} className="ui-skeleton ui-skeleton-row" />
      ))}
    </div>
  );
}

export function LoadError({ retry }: { retry: () => void }) {
  const t = useTranslations('people.common');
  return (
    <div className="ppl-error-box" role="alert">
      <p>{t('loadError')}</p>
      <button type="button" className="btn btn-secondary btn-sm" onClick={retry}>
        {t('retry')}
      </button>
    </div>
  );
}

function Panel({ title, actions, children, testId }: { title: string; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="ppl-panel" data-testid={testId}>
      <div className="ppl-panel-head">
        <h2 className="ppl-panel-title">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function BalanceCards({ balances }: { balances: Array<{ policy: Policy; balance: Balance }> }) {
  const t = useTranslations('people.timeoff');
  const num = useNumber();
  if (!balances.length) return <EmptyState compact quiet body={t('noPolicies')} />;
  return (
    <div className="ppl-cards" data-testid="people-balances">
      {balances.map(({ policy, balance }) => (
        <div key={policy.id} className="ppl-card" data-policy={policy.name}>
          <span className="ppl-card-label">{policy.name}</span>
          {policy.accrual === 'none' ? (
            <span className="ppl-card-value">{t('usedDays', { days: num(balance.used + balance.scheduled) })}</span>
          ) : (
            <span className="ppl-card-value" data-testid="people-available">
              {num(balance.available)}
            </span>
          )}
          <span className="ppl-card-meta">
            {policy.accrual === 'none'
              ? t('noAccrual')
              : t('balanceMeta', { accrued: num(balance.accrued), used: num(balance.used + balance.scheduled), pending: num(balance.pending), carried: num(balance.carriedOver) })}
          </span>
          {balance.expiringAtYearEnd > 0 && <span className="ppl-card-meta ppl-warn">{t('expiring', { days: num(balance.expiringAtYearEnd) })}</span>}
        </div>
      ))}
    </div>
  );
}

// ---------- Licencias ----------

export function TimeOffSection({ employeeId, hr, isSelf }: { employeeId: string; hr: boolean; isSelf: boolean }) {
  const t = useTranslations('people');
  const [toast, push] = useToast();
  const errText = useErrorText();
  const bal = useLoad<{ balances: Array<{ policy: Policy; balance: Balance }> }>(`/api/people/employees/${employeeId}/balances`);
  const req = useLoad<{ requests: RequestDto[] }>(`/api/people/time-off?employeeId=${employeeId}`);
  const [requesting, setRequesting] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const reload = () => {
    bal.reload();
    req.reload();
  };
  const adjust = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const res = await api(`/api/people/employees/${employeeId}/balances`, { method: 'POST', json: { policyId: fd.get('policyId'), days: Number(fd.get('days')), note: fd.get('note') } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setAdjusting(false);
    push(t('common.saved'));
    reload();
  };
  if (bal.error || req.error) return <LoadError retry={reload} />;
  if (!bal.data || !req.data) return <Loading />;
  return (
    <div className="ppl-stack">
      {toast}
      <Panel
        title={t('timeoff.balances')}
        actions={
          <span className="ppl-panel-actions">
            {hr && (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAdjusting(true)}>
                {t('timeoff.adjust')}
              </button>
            )}
            {(hr || isSelf) && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setRequesting(true)}>
                {t('timeoff.request')}
              </button>
            )}
          </span>
        }
      >
        <BalanceCards balances={bal.data.balances} />
      </Panel>
      <Panel title={t('timeoff.history')}>
        <RequestsTable
          requests={req.data.requests}
          showPerson={false}
          empty={t('timeoff.noRequests')}
          onChange={(m, tone) => {
            push(m, tone);
            reload();
          }}
        />
      </Panel>
      {requesting && (
        <RequestDialog
          open
          employeeId={employeeId}
          policies={bal.data.balances.map((b) => ({ id: b.policy.id, name: b.policy.name, halfDay: b.policy.halfDay, available: b.policy.accrual === 'none' ? null : b.balance.available }))}
          onClose={() => setRequesting(false)}
          onDone={() => {
            setRequesting(false);
            push(t('timeoff.sent'));
            reload();
          }}
        />
      )}
      <Dialog open={adjusting} title={t('timeoff.adjust')} onClose={() => setAdjusting(false)}>
        <form onSubmit={adjust}>
          <div className="ui-modal-body ui-fields">
            <Field label={t('timeoff.type')} htmlFor="adj-policy">
              <select id="adj-policy" name="policyId" className="select" autoFocus>
                {bal.data.balances.map((b) => (
                  <option key={b.policy.id} value={b.policy.id}>
                    {b.policy.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('timeoff.adjustDays')} htmlFor="adj-days" hint={t('timeoff.adjustHint')}>
              <input id="adj-days" name="days" type="number" step="0.5" className="input" required />
            </Field>
            <Field label={t('timeoff.note')} htmlFor="adj-note">
              <input id="adj-note" name="note" className="input" maxLength={200} />
            </Field>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setAdjusting(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

// ---------- Documentos ----------

export function DocumentList({ docs, hr, onChange }: { docs: PeopleDocument[]; hr: boolean; onChange: (msg: string, tone?: 'ok' | 'bad') => void }) {
  const t = useTranslations('people');
  const day = useDay();
  const errText = useErrorText();
  const ack = async (id: string) => {
    const res = await api(`/api/people/documents/${id}/ack`, { method: 'POST' });
    if (!res.ok) return onChange(errText(res.data.error), 'bad');
    onChange(t('documents.acked'));
  };
  const remove = async (id: string) => {
    const res = await api(`/api/people/documents/${id}`, { method: 'DELETE' });
    if (!res.ok) return onChange(errText(res.data.error), 'bad');
    onChange(t('documents.deleted'));
  };
  if (!docs.length) return <EmptyState compact quiet body={t('documents.empty')} />;
  return (
    <ul className="ppl-doclist" data-testid="people-documents">
      {docs.map((d) => (
        <li key={d.id} className="ppl-doc">
          <span className="ppl-doc-main">
            {d.docsPageId ? (
              <Link href={`/app/docs/${d.docsPageId}`} className="ppl-rowtitle">
                {d.title}
              </Link>
            ) : d.url ? (
              <a href={d.url} target="_blank" rel="noopener" className="ppl-rowtitle">
                {d.title}
              </a>
            ) : (
              <span className="ppl-rowtitle">{d.title}</span>
            )}
            <span className="ppl-rowmeta">
              {t(`documents.kinds.${d.kind}`)} · {day(d.createdAt)}
              {hr && d.visibility === 'hr' && ` · ${t('documents.hrOnly')}`}
              {hr && d.requiresAck && d.ackCount != null && ` · ${t('documents.ackCount', { count: d.ackCount })}`}
            </span>
          </span>
          <span className="ppl-actions">
            {d.requiresAck &&
              (d.acked ? (
                <span className="badge badge-ok">{t('documents.read')}</span>
              ) : (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => ack(d.id)}>
                  {t('documents.ack')}
                </button>
              ))}
            {hr && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(d.id)} aria-label={t('documents.delete', { title: d.title })}>
                {t('common.delete')}
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function UploadDocumentDialog({ open, onClose, onDone, employeeId }: { open: boolean; onClose: () => void; onDone: () => void; employeeId: string | null }) {
  const t = useTranslations('people');
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (employeeId) fd.set('employeeId', employeeId);
    fd.set('requiresAck', fd.get('requiresAck') === 'on' ? '1' : '0');
    setBusy(true);
    setError('');
    const res = await api('/api/people/documents', { method: 'POST', body: fd });
    setBusy(false);
    if (!res.ok) return setError(errText(res.data.error));
    onDone();
  };
  return (
    <Dialog open={open} title={t('documents.upload')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="ui-modal-body ui-fields">
          <Field label={t('documents.file')} htmlFor="doc-file" hint={t('documents.fileHint')}>
            <input id="doc-file" name="file" type="file" className="input" required accept=".pdf,.png,.jpg,.jpeg,.webp,.docx" autoFocus />
          </Field>
          <Field label={t('documents.title')} htmlFor="doc-title">
            <input id="doc-title" name="title" className="input" maxLength={200} />
          </Field>
          <Field label={t('documents.kind')} htmlFor="doc-kind">
            <select id="doc-kind" name="kind" className="select" defaultValue={employeeId ? 'contract' : 'policy'}>
              {(['contract', 'id', 'policy', 'tax', 'other'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`documents.kinds.${k}`)}
                </option>
              ))}
            </select>
          </Field>
          {employeeId && (
            <Field label={t('documents.visibility')} htmlFor="doc-vis">
              <select id="doc-vis" name="visibility" className="select" defaultValue="employee">
                <option value="employee">{t('documents.shareWithEmployee')}</option>
                <option value="hr">{t('documents.hrOnly')}</option>
              </select>
            </Field>
          )}
          <label className="ppl-check">
            <input type="checkbox" name="requiresAck" />
            <span>{t('documents.requireAck')}</span>
          </label>
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
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t('documents.upload')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function DocumentsSection({ employeeId, hr }: { employeeId: string; hr: boolean; isSelf: boolean }) {
  const t = useTranslations('people');
  const [toast, push] = useToast();
  const docs = useLoad<{ documents: PeopleDocument[] }>(`/api/people/documents?employeeId=${employeeId}`);
  const [uploading, setUploading] = useState(false);
  if (docs.error) return <LoadError retry={docs.reload} />;
  if (!docs.data) return <Loading />;
  return (
    <div className="ppl-stack">
      {toast}
      <Panel
        title={t('profile.tabs.documents')}
        actions={
          hr ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setUploading(true)}>
              {t('documents.upload')}
            </button>
          ) : undefined
        }
      >
        <p className="ppl-hint">{t('documents.signNote')}</p>
        <DocumentList
          docs={docs.data.documents}
          hr={hr}
          onChange={(m, tone) => {
            push(m, tone);
            docs.reload();
          }}
        />
      </Panel>
      {uploading && (
        <UploadDocumentDialog
          open
          employeeId={employeeId}
          onClose={() => setUploading(false)}
          onDone={() => {
            setUploading(false);
            push(t('documents.uploaded'));
            docs.reload();
          }}
        />
      )}
    </div>
  );
}

// ---------- Desempeño ----------

export function ReviewAnswers({ review }: { review: ReviewDto }) {
  const t = useTranslations('people.reviews');
  return (
    <dl className="ppl-answers">
      {review.questions.map((q) => (
        <div key={q.id}>
          <dt>{q.text}</dt>
          <dd>{review.answers[q.id] == null ? <span className="ppl-muted">{t('noAnswer')}</span> : q.kind === 'rating' ? `${review.answers[q.id]} / 5` : String(review.answers[q.id])}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PerformanceSection({ employeeId }: { employeeId: string }) {
  const t = useTranslations('people');
  const day = useDay();
  const [toast, push] = useToast();
  const errText = useErrorText();
  const goals = useLoad<{ goals: Goal[] }>(`/api/people/employees/${employeeId}/goals`);
  const reviews = useLoad<{ reviews: ReviewDto[] }>(`/api/people/reviews?subjectId=${employeeId}`);
  const [title, setTitle] = useState('');
  const addGoal = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const res = await api(`/api/people/employees/${employeeId}/goals`, { method: 'POST', json: { title } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setTitle('');
    goals.reload();
  };
  const setProgress = async (g: Goal, progress: number) => {
    const res = await api(`/api/people/goals/${g.id}`, { method: 'PATCH', json: { progress } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    goals.reload();
  };
  const removeGoal = async (g: Goal) => {
    const res = await api(`/api/people/goals/${g.id}`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    goals.reload();
  };
  if (goals.error || reviews.error) return <LoadError retry={() => (goals.reload(), reviews.reload())} />;
  if (!goals.data || !reviews.data) return <Loading />;
  const submitted = reviews.data.reviews.filter((r) => r.status === 'submitted');
  return (
    <div className="ppl-stack">
      {toast}
      <Panel title={t('goals.title')}>
        {goals.data.goals.length === 0 && <EmptyState compact quiet body={t('goals.empty')} />}
        <ul className="ppl-goals">
          {goals.data.goals.map((g) => (
            <li key={g.id} className="ppl-goal">
              <span className="ppl-goal-title">{g.title}</span>
              <Bar value={g.progress} max={100} label={t('goals.progress', { pct: g.progress })} />
              <label className="ppl-goal-range">
                <span className="sr-only">{t('goals.progressLabel', { title: g.title })}</span>
                <input type="range" min={0} max={100} step={10} defaultValue={g.progress} onChange={(e) => void setProgress(g, Number(e.target.value))} />
                <span className="ppl-muted">{g.progress}%</span>
              </label>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeGoal(g)} aria-label={t('goals.delete', { title: g.title })}>
                {t('common.delete')}
              </button>
            </li>
          ))}
        </ul>
        <form className="ppl-inline-form" onSubmit={addGoal}>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('goals.new')} aria-label={t('goals.new')} maxLength={200} />
          <button type="submit" className="btn btn-secondary">
            {t('goals.add')}
          </button>
        </form>
      </Panel>
      <Panel title={t('reviews.received')}>
        {submitted.length === 0 ? (
          <EmptyState compact quiet body={t('reviews.noneReceived')} />
        ) : (
          submitted.map((r) => (
            <article key={r.id} className="ppl-review" data-testid="people-review">
              <h3 className="ppl-review-title">
                {r.cycleName} · {t(`reviews.kinds.${r.kind}`)}
                {r.reviewerName && <span className="ppl-muted"> · {r.reviewerName}</span>}
                {r.submittedAt && <span className="ppl-muted"> · {day(r.submittedAt)}</span>}
              </h3>
              <ReviewAnswers review={r} />
            </article>
          ))
        )}
      </Panel>
    </div>
  );
}

// ---------- Sueldo ----------

export function CompensationSection({ employeeId, hr }: { employeeId: string; hr: boolean }) {
  const t = useTranslations('people');
  const locale = useLocale();
  const day = useDay();
  const [toast, push] = useToast();
  const errText = useErrorText();
  const comp = useLoad<{ entries: CompEntry[] }>(`/api/people/employees/${employeeId}/compensation`);
  const [adding, setAdding] = useState(false);
  const money = (n: number, c: string) => {
    try {
      return n.toLocaleString(locale, { style: 'currency', currency: c, maximumFractionDigits: 2 });
    } catch {
      return `${c} ${n}`;
    }
  };
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const res = await api(`/api/people/employees/${employeeId}/compensation`, {
      method: 'POST',
      json: { amount: Number(fd.get('amount')), currency: fd.get('currency'), period: fd.get('period'), effectiveDate: fd.get('effectiveDate'), reason: fd.get('reason') },
    });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setAdding(false);
    comp.reload();
  };
  if (comp.error) return <LoadError retry={comp.reload} />;
  if (!comp.data) return <Loading />;
  return (
    <div className="ppl-stack">
      {toast}
      <Panel
        title={t('comp.title')}
        testId="people-compensation"
        actions={
          hr ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
              {t('comp.add')}
            </button>
          ) : undefined
        }
      >
        <p className="ppl-hint">{t('comp.privacy')}</p>
        {comp.data.entries.length === 0 ? (
          <EmptyState compact quiet body={t('comp.empty')} />
        ) : (
          <div className="table-wrap">
            <table className="table ppl-table">
              <thead>
                <tr>
                  <th scope="col">{t('comp.effective')}</th>
                  <th scope="col" className="num">
                    {t('comp.amount')}
                  </th>
                  <th scope="col">{t('comp.reason')}</th>
                </tr>
              </thead>
              <tbody>
                {comp.data.entries.map((c) => (
                  <tr key={c.id}>
                    <td>{day(c.effectiveDate)}</td>
                    <td className="num" data-testid="people-salary">
                      {money(c.amount, c.currency)} {t(`comp.per.${c.period}`)}
                    </td>
                    <td>{c.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Dialog open={adding} title={t('comp.add')} onClose={() => setAdding(false)}>
        <form onSubmit={add}>
          <div className="ui-modal-body ui-fields">
            <div className="ui-fields-2 ppl-fields">
              <Field label={t('comp.amount')} htmlFor="cmp-amount">
                <input id="cmp-amount" name="amount" type="number" min="0" step="0.01" className="input" required autoFocus />
              </Field>
              <Field label={t('comp.currency')} htmlFor="cmp-cur">
                <input id="cmp-cur" name="currency" className="input" defaultValue="USD" maxLength={3} pattern="[A-Za-z]{3}" required />
              </Field>
              <Field label={t('comp.period')} htmlFor="cmp-per">
                <select id="cmp-per" name="period" className="select" defaultValue="year">
                  {(['year', 'month', 'hour'] as const).map((p) => (
                    <option key={p} value={p}>
                      {t(`comp.periods.${p}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('comp.effective')} htmlFor="cmp-date">
                <input id="cmp-date" name="effectiveDate" type="date" className="input" required defaultValue={new Date().toISOString().slice(0, 10)} />
              </Field>
            </div>
            <Field label={t('comp.reason')} htmlFor="cmp-reason">
              <input id="cmp-reason" name="reason" className="input" maxLength={200} />
            </Field>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

// ---------- Onboarding de la ficha ----------

export function OnboardingSection({ employeeId, hr, templates }: { employeeId: string; hr: boolean; templates: Array<{ id: string; name: string; kind: string }> }) {
  const t = useTranslations('people');
  const [toast, push] = useToast();
  const errText = useErrorText();
  const lists = useLoad<{ checklists: Checklist[] }>(`/api/people/checklists?employeeId=${employeeId}`);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const start = async (e: FormEvent) => {
    e.preventDefault();
    const res = await api('/api/people/checklists', { method: 'POST', json: { employeeId, templateId } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(t('onboarding.started'));
    lists.reload();
  };
  if (lists.error) return <LoadError retry={lists.reload} />;
  if (!lists.data) return <Loading />;
  return (
    <div className="ppl-stack">
      {toast}
      {hr && templates.length > 0 && (
        <form className="ppl-inline-form" onSubmit={start}>
          <label className="sr-only" htmlFor="ob-start-tpl">
            {t('onboarding.template')}
          </label>
          <select id="ob-start-tpl" className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {templates.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({t(`onboarding.kinds.${x.kind}`)})
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-secondary">
            {t('onboarding.start')}
          </button>
        </form>
      )}
      {lists.data.checklists.length === 0 ? (
        <EmptyState compact quiet body={t('onboarding.noneForPerson')} />
      ) : (
        lists.data.checklists.map((c) => <ChecklistView key={c.id} checklist={c} onChange={lists.reload} />)
      )}
      {hr && <ExitInterview employeeId={employeeId} />}
    </div>
  );
}

function ExitInterview({ employeeId }: { employeeId: string }) {
  const t = useTranslations('people');
  const [toast, push] = useToast();
  const errText = useErrorText();
  const data = useLoad<{ interview: { reason: string; wouldRecommend: number | null; rehire: boolean | null; liked: string; improve: string; notes: string } | null }>(
    `/api/people/employees/${employeeId}/exit-interview`,
  );
  const [open, setOpen] = useState(false);
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const res = await api(`/api/people/employees/${employeeId}/exit-interview`, {
      method: 'PUT',
      json: {
        reason: fd.get('reason'),
        wouldRecommend: fd.get('wouldRecommend') === '' ? null : Number(fd.get('wouldRecommend')),
        rehire: fd.get('rehire') === 'yes' ? true : fd.get('rehire') === 'no' ? false : null,
        liked: fd.get('liked'),
        improve: fd.get('improve'),
        notes: fd.get('notes'),
      },
    });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setOpen(false);
    push(t('common.saved'));
    data.reload();
  };
  const iv = data.data?.interview ?? null;
  return (
    <Panel
      title={t('exit.title')}
      actions={
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOpen(true)}>
          {iv ? t('exit.edit') : t('exit.start')}
        </button>
      }
    >
      {toast}
      <p className="ppl-hint">{t('exit.privacy')}</p>
      {iv && (
        <dl className="ppl-answers">
          <div>
            <dt>{t('exit.reason')}</dt>
            <dd>{t(`exit.reasons.${iv.reason}`)}</dd>
          </div>
          {iv.liked && (
            <div>
              <dt>{t('exit.liked')}</dt>
              <dd>{iv.liked}</dd>
            </div>
          )}
          {iv.improve && (
            <div>
              <dt>{t('exit.improve')}</dt>
              <dd>{iv.improve}</dd>
            </div>
          )}
        </dl>
      )}
      <Dialog open={open} title={t('exit.title')} onClose={() => setOpen(false)} wide>
        <form onSubmit={save}>
          <div className="ui-modal-body ui-fields">
            <Field label={t('exit.reason')} htmlFor="ex-reason">
              <select id="ex-reason" name="reason" className="select" defaultValue={iv?.reason ?? 'new_job'} autoFocus>
                {(['new_job', 'compensation', 'growth', 'manager', 'relocation', 'personal', 'layoff', 'performance', 'other'] as const).map((r) => (
                  <option key={r} value={r}>
                    {t(`exit.reasons.${r}`)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="ui-fields-2 ppl-fields">
              <Field label={t('exit.recommend')} htmlFor="ex-rec">
                <input id="ex-rec" name="wouldRecommend" type="number" min={0} max={10} className="input" defaultValue={iv?.wouldRecommend ?? ''} />
              </Field>
              <Field label={t('exit.rehire')} htmlFor="ex-rehire">
                <select id="ex-rehire" name="rehire" className="select" defaultValue={iv?.rehire == null ? '' : iv.rehire ? 'yes' : 'no'}>
                  <option value="" />
                  <option value="yes">{t('common.yes')}</option>
                  <option value="no">{t('common.no')}</option>
                </select>
              </Field>
            </div>
            <Field label={t('exit.liked')} htmlFor="ex-liked">
              <textarea id="ex-liked" name="liked" className="textarea" defaultValue={iv?.liked ?? ''} maxLength={4000} />
            </Field>
            <Field label={t('exit.improve')} htmlFor="ex-improve">
              <textarea id="ex-improve" name="improve" className="textarea" defaultValue={iv?.improve ?? ''} maxLength={4000} />
            </Field>
            <Field label={t('exit.notes')} htmlFor="ex-notes">
              <textarea id="ex-notes" name="notes" className="textarea" defaultValue={iv?.notes ?? ''} maxLength={4000} />
            </Field>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Dialog>
    </Panel>
  );
}

// ---------- 1:1 ----------

export function OneOnOneSection({ employeeId, name }: { employeeId: string; name: string }) {
  const t = useTranslations('people');
  const day = useDay();
  const [toast, push] = useToast();
  const errText = useErrorText();
  const notes = useLoad<{ notes: OneOnOne[] }>(`/api/people/employees/${employeeId}/one-on-ones`);
  const [text, setText] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const res = await api(`/api/people/employees/${employeeId}/one-on-ones`, { method: 'POST', json: { notes: text } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setText('');
    notes.reload();
  };
  const remove = async (id: string) => {
    const res = await api(`/api/people/one-on-ones/${id}`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    notes.reload();
  };
  if (notes.error) return <LoadError retry={notes.reload} />;
  if (!notes.data) return <Loading />;
  return (
    <Panel title={t('oneOnOne.title', { name })}>
      {toast}
      <p className="ppl-hint">{t('oneOnOne.privacy')}</p>
      <form className="ppl-stack" onSubmit={add}>
        <label className="sr-only" htmlFor="one-text">
          {t('oneOnOne.new')}
        </label>
        <textarea id="one-text" className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('oneOnOne.new')} maxLength={20000} />
        <div>
          <button type="submit" className="btn btn-secondary">
            {t('oneOnOne.add')}
          </button>
        </div>
      </form>
      {notes.data.notes.length === 0 ? (
        <EmptyState compact quiet body={t('oneOnOne.empty')} />
      ) : (
        <ul className="ppl-notes">
          {notes.data.notes.map((n) => (
            <li key={n.id} className="ppl-note-item">
              <div className="ppl-panel-head">
                <strong>{day(n.date)}</strong>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(n.id)}>
                  {t('common.delete')}
                </button>
              </div>
              <p className="ppl-pre">{n.notes}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
