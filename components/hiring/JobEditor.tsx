'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { JobDetail } from '@/lib/hiring/core';
import type { Question, StageKind, TeamRole } from '@/lib/hiring/types';
import { descriptionHtml } from '@/lib/hiring/markdown';
import { HrDialog, JobStatusBadge, api, useErrorText, useToast } from './ui';

type Person = { id: string; email: string; name: string | null; role: string };
type StageDraft = { id?: string; name: string; kind: StageKind; criteria: string };

const TABS = ['details', 'form', 'team', 'stages'] as const;
const KINDS: StageKind[] = ['applied', 'review', 'interview', 'offer', 'hired'];
const ROLES: Array<TeamRole | ''> = ['', 'recruiter', 'hiring_manager', 'interviewer'];

function critId(label: string, i: number): string {
  return (
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 36) || `c${i}`
  );
}

export default function JobEditor({ detail, people, careersUrl, tab: initialTab }: { detail: JobDetail; people: Person[]; careersUrl: string; tab: string }) {
  const t = useTranslations('hiring');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [tab, setTab] = useState<(typeof TABS)[number]>((TABS as readonly string[]).includes(initialTab) ? (initialTab as (typeof TABS)[number]) : 'details');
  const [job, setJob] = useState(detail.job);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [questions, setQuestions] = useState<Question[]>(detail.job.questions);
  const [team, setTeam] = useState<Record<string, TeamRole | ''>>(() => Object.fromEntries(detail.team.map((m) => [m.userId, m.role])));
  const [stages, setStages] = useState<StageDraft[]>(detail.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, criteria: s.criteria.map((c) => c.label).join(', ') })));
  const [shareOpen, setShareOpen] = useState(false);
  const [share, setShare] = useState({ utmSource: 'linkedin', utmMedium: 'social', utmCampaign: '' });
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [docsQ, setDocsQ] = useState('');
  const [docsHits, setDocsHits] = useState<Array<{ id: string; title: string }>>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = <K extends keyof typeof job>(k: K, v: (typeof job)[K]) => setJob((j) => ({ ...j, [k]: v }));

  const saveDetails = async (e?: FormEvent, status?: string) => {
    e?.preventDefault();
    setBusy(true);
    const res = await api<{ job: typeof job }>(`/api/hiring/jobs/${job.id}`, {
      method: 'PATCH',
      json: {
        title: job.title,
        department: job.department,
        location: job.location,
        workplace: job.workplace,
        employmentType: job.employmentType,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        salaryCurrency: job.salaryCurrency,
        salaryPeriod: job.salaryPeriod,
        salaryPublic: job.salaryPublic,
        description: job.description,
        ...(status ? { status } : {}),
      },
    });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setJob(res.data.job);
    push(status ? t(`jobEditor.statusChanged.${status}`) : t('common.saved'));
    router.refresh();
  };

  const saveQuestions = async () => {
    setBusy(true);
    const res = await api<{ job: typeof job }>(`/api/hiring/jobs/${job.id}`, { method: 'PATCH', json: { questions } });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setQuestions(res.data.job.questions);
    push(t('common.saved'));
  };

  const saveTeam = async () => {
    setBusy(true);
    const members = Object.entries(team)
      .filter(([, r]) => r)
      .map(([userId, role]) => ({ userId, role }));
    const res = await api(`/api/hiring/jobs/${job.id}/team`, { method: 'PUT', json: { members } });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(t('common.saved'));
    router.refresh();
  };

  const saveStages = async () => {
    setBusy(true);
    const payload = stages.map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      name: s.name.trim(),
      kind: s.kind,
      criteria: s.criteria
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
        .slice(0, 10)
        .map((label, i) => ({ id: critId(label, i), label })),
    }));
    const res = await api<{ stages: Array<{ id: string; name: string; kind: StageKind; criteria: Array<{ label: string }> }> }>(`/api/hiring/jobs/${job.id}/stages`, { method: 'PUT', json: { stages: payload } });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setStages(res.data.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, criteria: s.criteria.map((c) => c.label).join(', ') })));
    push(t('common.saved'));
  };

  const makeLink = async (e: FormEvent) => {
    e.preventDefault();
    const res = await api<{ link: { shortUrl: string } }>(`/api/hiring/jobs/${job.id}/share-link`, { method: 'POST', json: share });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setShortUrl(res.data.link.shortUrl);
  };

  const searchDocs = async (e: FormEvent) => {
    e.preventDefault();
    const res = await api<{ pages: Array<{ id: string; title: string }> }>(`/api/hiring/docs-import?q=${encodeURIComponent(docsQ)}`);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setDocsHits(res.data.pages);
  };

  const importDoc = async (id: string) => {
    const res = await api<{ markdown: string }>(`/api/hiring/docs-import?pageId=${encodeURIComponent(id)}`);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    set('description', res.data.markdown);
    setDocsOpen(false);
    push(t('jobEditor.docsImported'));
  };

  const saveAsTemplate = async () => {
    const res = await api('/api/hiring/templates', {
      method: 'POST',
      json: { kind: 'job', name: job.title, subject: job.title, body: JSON.stringify({ department: job.department, employmentType: job.employmentType, workplace: job.workplace, description: job.description, questions }) },
    });
    push(res.ok ? t('jobEditor.templateSaved') : errText(res.data.error), res.ok ? 'ok' : 'bad');
  };

  const remove = async () => {
    const res = await api(`/api/hiring/jobs/${job.id}`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.push('/app/hiring/jobs');
    router.refresh();
  };

  const people2 = useMemo(() => people, [people]);
  const jobUrl = `${careersUrl}/${job.slug}`;

  return (
    <div className="app-page ui-page hr-page">
      <PageHeader
        title={job.title}
        description={
          <span className="hr-head-meta">
            <JobStatusBadge status={job.status} />
            {job.status === 'published' && (
              <a href={jobUrl} target="_blank" rel="noreferrer">
                {t('jobEditor.viewPost')}
              </a>
            )}
          </span>
        }
        back={{ href: `/app/hiring/jobs/${job.id}`, label: t('jobEditor.backToPipeline') }}
        actions={
          <>
            {job.status !== 'published' && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => saveDetails(undefined, 'published')}>
                {t('jobEditor.publish')}
              </button>
            )}
            {job.status === 'published' && (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => saveDetails(undefined, 'closed')}>
                {t('jobEditor.close')}
              </button>
            )}
            {job.status === 'published' && (
              <button type="button" className="btn btn-secondary" onClick={() => setShareOpen(true)}>
                {t('jobEditor.share')}
              </button>
            )}
          </>
        }
      />
      <div className="ui-tabs" role="tablist" aria-label={job.title}>
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" className="ui-tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {t(`jobEditor.tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <form className="ui-fields hr-form" onSubmit={saveDetails}>
          <label className="ui-field">
            <span className="label">{t('job.title')}</span>
            <input className="input" name="title" required maxLength={160} value={job.title} onChange={(e) => set('title', e.target.value)} />
          </label>
          <div className="ui-fields-2">
            <label className="ui-field">
              <span className="label">{t('job.department')}</span>
              <input className="input" maxLength={80} value={job.department} onChange={(e) => set('department', e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('job.location')}</span>
              <input className="input" maxLength={120} value={job.location} onChange={(e) => set('location', e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('job.workplace')}</span>
              <select className="select" value={job.workplace} onChange={(e) => set('workplace', e.target.value)}>
                {(['onsite', 'hybrid', 'remote'] as const).map((w) => (
                  <option key={w} value={w}>
                    {t(`workplace.${w}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="label">{t('job.employmentType')}</span>
              <select className="select" value={job.employmentType} onChange={(e) => set('employmentType', e.target.value)}>
                {(['full_time', 'part_time', 'contract', 'temporary', 'internship'] as const).map((w) => (
                  <option key={w} value={w}>
                    {t(`employment.${w}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="ui-field hr-fieldset">
            <legend className="label">{t('job.salary')}</legend>
            <div className="hr-salary">
              <input className="input" inputMode="numeric" aria-label={t('job.salaryMin')} placeholder={t('job.salaryMin')} value={job.salaryMin ?? ''} onChange={(e) => set('salaryMin', e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value) || 0)))} />
              <input className="input" inputMode="numeric" aria-label={t('job.salaryMax')} placeholder={t('job.salaryMax')} value={job.salaryMax ?? ''} onChange={(e) => set('salaryMax', e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value) || 0)))} />
              <input className="input hr-currency" aria-label={t('job.currency')} maxLength={3} value={job.salaryCurrency} onChange={(e) => set('salaryCurrency', e.target.value.toUpperCase())} />
              <select className="select" aria-label={t('job.period')} value={job.salaryPeriod} onChange={(e) => set('salaryPeriod', e.target.value)}>
                {(['year', 'month', 'hour'] as const).map((p) => (
                  <option key={p} value={p}>
                    {t(`period.${p}`)}
                  </option>
                ))}
              </select>
            </div>
            <label className="ui-check">
              <input type="checkbox" checked={job.salaryPublic} onChange={(e) => set('salaryPublic', e.target.checked)} />
              {t('job.salaryPublic')}
            </label>
          </fieldset>
          <div className="ui-field">
            <div className="hr-label-row">
              <label className="label" htmlFor="hr-desc">
                {t('job.description')}
              </label>
              <span className="hr-label-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDocsOpen(true)}>
                  {t('jobEditor.fromDocs')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
                  {preview ? t('jobEditor.edit') : t('jobEditor.preview')}
                </button>
              </span>
            </div>
            {preview ? (
              <div className="hr-prose panel" dangerouslySetInnerHTML={{ __html: descriptionHtml(job.description) }} />
            ) : (
              <textarea id="hr-desc" className="textarea hr-desc" rows={16} maxLength={20000} value={job.description} onChange={(e) => set('description', e.target.value)} />
            )}
            <span className="ui-help">{t('jobEditor.markdownHelp')}</span>
          </div>
          <div className="hr-actions-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t('common.save')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={saveAsTemplate}>
              {t('jobEditor.saveTemplate')}
            </button>
            {job.status === 'closed' && (
              <button type="button" className="btn btn-ghost" onClick={() => saveDetails(undefined, 'archived')}>
                {t('jobEditor.archive')}
              </button>
            )}
            <button type="button" className="btn btn-danger hr-push-right" onClick={() => setConfirmDelete(true)}>
              {t('jobEditor.delete')}
            </button>
          </div>
        </form>
      )}

      {tab === 'form' && (
        <section className="ui-fields hr-form">
          <p className="ui-help">{t('questions.help')}</p>
          <ol className="hr-questions">
            {questions.map((q, i) => (
              <li key={q.id} className="panel hr-question">
                <div className="ui-fields-2">
                  <label className="ui-field">
                    <span className="label">{t('questions.label')}</span>
                    <input className="input" value={q.label} maxLength={300} onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  </label>
                  <label className="ui-field">
                    <span className="label">{t('questions.type')}</span>
                    <select className="select" value={q.type} onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, type: e.target.value as Question['type'], knockout: null } : x)))}>
                      {(['text', 'textarea', 'yesno', 'select', 'number'] as const).map((k) => (
                        <option key={k} value={k}>
                          {t(`questions.types.${k}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {q.type === 'select' && (
                  <label className="ui-field">
                    <span className="label">{t('questions.options')}</span>
                    <input
                      className="input"
                      value={q.options.join(', ')}
                      onChange={(e) =>
                        setQuestions((qs) =>
                          qs.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  options: e.target.value
                                    .split(',')
                                    .map((o) => o.trim())
                                    .filter(Boolean)
                                    .slice(0, 20),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                )}
                <div className="hr-question-flags">
                  <label className="ui-check">
                    <input type="checkbox" checked={q.required} onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} />
                    {t('questions.required')}
                  </label>
                  {(q.type === 'yesno' || q.type === 'select' || q.type === 'number') && (
                    <label className="ui-check">
                      <input
                        type="checkbox"
                        checked={q.knockout !== null}
                        onChange={(e) =>
                          setQuestions((qs) =>
                            qs.map((x, j) => (j === i ? { ...x, knockout: e.target.checked ? { accepted: x.type === 'yesno' ? ['yes'] : x.type === 'select' ? x.options.slice(0, 1) : [], min: x.type === 'number' ? 1 : null } : null } : x)),
                          )
                        }
                      />
                      {t('questions.knockout')}
                    </label>
                  )}
                  {q.knockout && q.type === 'yesno' && (
                    <label className="ui-field hr-inline">
                      <span className="label">{t('questions.expected')}</span>
                      <select className="select" value={q.knockout.accepted[0] ?? 'yes'} onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, knockout: { accepted: [e.target.value], min: null } } : x)))}>
                        <option value="yes">{t('common.yes')}</option>
                        <option value="no">{t('common.no')}</option>
                      </select>
                    </label>
                  )}
                  {q.knockout && q.type === 'select' && (
                    <label className="ui-field hr-inline">
                      <span className="label">{t('questions.acceptedOptions')}</span>
                      <input
                        className="input"
                        value={q.knockout.accepted.join(', ')}
                        onChange={(e) =>
                          setQuestions((qs) =>
                            qs.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    knockout: {
                                      accepted: e.target.value
                                        .split(',')
                                        .map((o) => o.trim())
                                        .filter(Boolean),
                                      min: null,
                                    },
                                  }
                                : x,
                            ),
                          )
                        }
                      />
                    </label>
                  )}
                  {q.knockout && q.type === 'number' && (
                    <label className="ui-field hr-inline">
                      <span className="label">{t('questions.min')}</span>
                      <input className="input" inputMode="decimal" value={q.knockout.min ?? ''} onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, knockout: { accepted: [], min: e.target.value === '' ? null : Number(e.target.value) } } : x)))} />
                    </label>
                  )}
                  <button type="button" className="btn btn-ghost btn-sm hr-push-right" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}>
                    {t('common.remove')}
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className="hr-actions-row">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={questions.length >= 20}
              onClick={() => setQuestions((qs) => [...qs, { id: `q${Date.now().toString(36)}`, label: '', type: 'text', required: false, options: [], knockout: null }])}
            >
              {t('questions.add')}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || questions.some((q) => !q.label.trim())} onClick={saveQuestions}>
              {t('common.save')}
            </button>
          </div>
        </section>
      )}

      {tab === 'team' && (
        <section className="ui-fields hr-form">
          <p className="ui-help">{t('team.help')}</p>
          <div className="table-wrap">
            <table className="table hr-table">
              <thead>
                <tr>
                  <th scope="col">{t('team.person')}</th>
                  <th scope="col">{t('team.role')}</th>
                </tr>
              </thead>
              <tbody>
                {people2.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">
                      <span className="hr-rowtitle">{p.name || p.email}</span>
                      <span className="hr-rowmeta">{p.email}</span>
                    </th>
                    <td>
                      <select className="select" aria-label={t('team.roleFor', { name: p.name || p.email })} value={team[p.id] ?? ''} onChange={(e) => setTeam((tm) => ({ ...tm, [p.id]: e.target.value as TeamRole | '' }))}>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r ? t(`roles.${r}`) : t('team.none')}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hr-actions-row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={saveTeam}>
              {t('common.save')}
            </button>
          </div>
        </section>
      )}

      {tab === 'stages' && (
        <section className="ui-fields hr-form">
          <p className="ui-help">{t('stages.help')}</p>
          <ol className="hr-questions">
            {stages.map((s, i) => (
              <li key={s.id ?? `new-${i}`} className="panel hr-question">
                <div className="ui-fields-2">
                  <label className="ui-field">
                    <span className="label">{t('stages.name')}</span>
                    <input className="input" maxLength={60} value={s.name} onChange={(e) => setStages((ss) => ss.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  </label>
                  <label className="ui-field">
                    <span className="label">{t('stages.kind')}</span>
                    <select className="select" value={s.kind} onChange={(e) => setStages((ss) => ss.map((x, j) => (j === i ? { ...x, kind: e.target.value as StageKind } : x)))}>
                      {KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`stageKinds.${k}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="ui-field">
                  <span className="label">{t('stages.criteria')}</span>
                  <input className="input" value={s.criteria} placeholder={t('stages.criteriaPlaceholder')} onChange={(e) => setStages((ss) => ss.map((x, j) => (j === i ? { ...x, criteria: e.target.value } : x)))} />
                </label>
                <div className="hr-question-flags">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} aria-label={t('stages.up', { name: s.name })} onClick={() => setStages((ss) => { const n = [...ss]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>
                    ↑
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === stages.length - 1} aria-label={t('stages.down', { name: s.name })} onClick={() => setStages((ss) => { const n = [...ss]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}>
                    ↓
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm hr-push-right" disabled={stages.length <= 2} onClick={() => setStages((ss) => ss.filter((_, j) => j !== i))}>
                    {t('common.remove')}
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className="hr-actions-row">
            <button type="button" className="btn btn-secondary" disabled={stages.length >= 12} onClick={() => setStages((ss) => [...ss.slice(0, -1), { name: '', kind: 'review', criteria: '' }, ...ss.slice(-1)])}>
              {t('stages.add')}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || stages.some((s) => !s.name.trim())} onClick={saveStages}>
              {t('common.save')}
            </button>
          </div>
        </section>
      )}

      <HrDialog open={shareOpen} title={t('share.title')} onClose={() => setShareOpen(false)}>
        <form onSubmit={makeLink}>
          <div className="ui-modal-body ui-fields">
            <p className="ui-help">{t('share.help')}</p>
            <label className="ui-field">
              <span className="label">utm_source</span>
              <input className="input" value={share.utmSource} onChange={(e) => setShare({ ...share, utmSource: e.target.value })} />
            </label>
            <label className="ui-field">
              <span className="label">utm_medium</span>
              <input className="input" value={share.utmMedium} onChange={(e) => setShare({ ...share, utmMedium: e.target.value })} />
            </label>
            <label className="ui-field">
              <span className="label">utm_campaign</span>
              <input className="input" value={share.utmCampaign} onChange={(e) => setShare({ ...share, utmCampaign: e.target.value })} />
            </label>
            {shortUrl && (
              <p className="hr-short">
                <input className="input" readOnly value={shortUrl} aria-label={t('share.shortLink')} onFocus={(e) => e.currentTarget.select()} />
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setShareOpen(false)}>
              {t('common.close')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('share.create')}
            </button>
          </div>
        </form>
      </HrDialog>

      <HrDialog open={docsOpen} title={t('jobEditor.fromDocs')} onClose={() => setDocsOpen(false)}>
        <form onSubmit={searchDocs}>
          <div className="ui-modal-body ui-fields">
            <input className="input" type="search" autoFocus value={docsQ} onChange={(e) => setDocsQ(e.target.value)} placeholder={t('jobEditor.docsSearch')} aria-label={t('jobEditor.docsSearch')} />
            <ul className="hr-list">
              {docsHits.map((d) => (
                <li key={d.id}>
                  <button type="button" className="hr-list-row hr-list-button" onClick={() => importDoc(d.id)}>
                    <span className="hr-list-main">{d.title || t('common.untitled')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setDocsOpen(false)}>
              {t('common.close')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('common.search')}
            </button>
          </div>
        </form>
      </HrDialog>

      <HrDialog open={confirmDelete} title={t('jobEditor.deleteTitle')} onClose={() => setConfirmDelete(false)}>
        <div className="ui-modal-body">
          <p>{t('jobEditor.deleteBody')}</p>
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-danger" onClick={remove}>
            {t('jobEditor.delete')}
          </button>
        </div>
      </HrDialog>
      <p className="hr-foot-links">
        <Link href={`/app/hiring/jobs/${job.id}`}>{t('jobEditor.backToPipeline')}</Link>
      </p>
      {toast}
    </div>
  );
}
