'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { CandidateProfile as Profile, ProfileApplication } from '@/lib/hiring/candidates';
import type { InterviewDto } from '@/lib/hiring/interviews';
import type { OfferDto } from '@/lib/hiring/offers';
import { OVERALL } from '@/lib/hiring/types';
import { VARIABLES } from './variables';
import { AppStatusBadge, HrDialog, api, money, useDate, useErrorText, useToast } from './ui';

type Tpl = { id: string; kind: string; name: string; subject: string; body: string };
const TABS = ['timeline', 'resume', 'scorecards', 'interviews', 'offers'] as const;

export default function CandidateProfile({
  initial,
  focusApp,
  me,
  isAdmin,
  templates,
  repliesEnabled,
}: {
  initial: Profile;
  focusApp: string | null;
  me: string;
  isAdmin: boolean;
  templates: Tpl[];
  repliesEnabled: boolean;
}) {
  const t = useTranslations('hiring');
  const locale = useLocale();
  const router = useRouter();
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [profile, setProfile] = useState(initial);
  const [appId, setAppId] = useState(focusApp && initial.applications.some((a) => a.id === focusApp) ? focusApp : initial.applications[0].id);
  const [tab, setTab] = useState<(typeof TABS)[number]>('timeline');
  const [busy, setBusy] = useState(false);
  const c = profile.candidate;
  const app = profile.applications.find((a) => a.id === appId) ?? profile.applications[0];

  const reload = useCallback(async () => {
    const res = await api<Profile>(`/api/hiring/candidates/${c.id}`);
    if (res.ok) setProfile(res.data);
  }, [c.id]);

  const act = async (url: string, method: string, json: unknown, okMsg?: string) => {
    setBusy(true);
    const res = await api(url, { method, json });
    setBusy(false);
    if (!res.ok) {
      push(errText(res.data.error), 'bad');
      return null;
    }
    if (okMsg) push(okMsg);
    await reload();
    return res.data;
  };

  // ---------- Etapa ----------
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectEmail, setRejectEmail] = useState(true);
  const [rejectTpl, setRejectTpl] = useState('');
  const stage = app.stages.find((s) => s.id === app.stageId);

  // ---------- Etiquetas ----------
  const [tagDraft, setTagDraft] = useState('');
  const saveTags = (tags: string[]) => act(`/api/hiring/candidates/${c.id}`, 'PATCH', { tags });

  // ---------- Notas y emails ----------
  const [note, setNote] = useState('');
  const [mailOpen, setMailOpen] = useState(false);
  const [mail, setMail] = useState({ subject: '', body: '' });
  const pickTemplate = (id: string) => {
    const tp = templates.find((x) => x.id === id);
    if (tp) setMail({ subject: tp.subject, body: tp.body });
  };

  // ---------- Scorecard ----------
  const scoreStage = app.stages.find((s) => s.id === app.stageId && s.criteria.length) ?? app.stages.find((s) => s.criteria.length && app.evaluators.some((e) => e.userId === me && e.stageId === s.id));
  const mine = app.scorecards.find((s) => s.userId === me && s.stageId === scoreStage?.id);
  const [ratings, setRatings] = useState<Record<string, number>>(mine?.ratings ?? {});
  const [overall, setOverall] = useState<string>(mine?.overall ?? '');
  const [scoreNotes, setScoreNotes] = useState(mine?.notes ?? '');
  // Un interviewer puntúa una vez la etapa que le asignaron; quien gestiona puede actualizar el suyo.
  const canScore = Boolean(scoreStage) && (app.amEvaluator || app.canManage) && (app.canManage || !mine);

  // ---------- Entrevistas y ofertas ----------
  const [interviews, setInterviews] = useState<InterviewDto[] | null>(null);
  const [offers, setOffers] = useState<OfferDto[] | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedule, setSchedule] = useState({ durationMin: 45, sendEmail: true });
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerDraft, setOfferDraft] = useState({ title: app.job.title, salary: '', currency: 'USD', startDate: '' });
  const [offerLink, setOfferLink] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (tab === 'interviews') void api<{ interviews: InterviewDto[] }>(`/api/hiring/applications/${app.id}/interviews`).then((r) => setInterviews(r.ok ? r.data.interviews : []));
    if (tab === 'offers' && app.canManage) void api<{ offers: OfferDto[] }>(`/api/hiring/applications/${app.id}/offers`).then((r) => setOffers(r.ok ? r.data.offers : []));
  }, [tab, app.id, app.canManage, profile]);

  useEffect(() => {
    const m = app.scorecards.find((s) => s.userId === me && s.stageId === scoreStage?.id);
    setRatings(m?.ratings ?? {});
    setOverall(m?.overall ?? '');
    setScoreNotes(m?.notes ?? '');
  }, [app.id, scoreStage?.id, me, app.scorecards]);

  const submitScore = async (e: FormEvent) => {
    e.preventDefault();
    if (!scoreStage || !overall) return;
    const done = await act(`/api/hiring/applications/${app.id}/scorecards`, 'POST', { stageId: scoreStage.id, ratings, overall, notes: scoreNotes }, t('score.submitted'));
    if (done) router.refresh();
  };

  const visibleTabs = TABS.filter((k) => k !== 'offers' || app.canManage);
  const resumeUrl = `/api/hiring/candidates/${c.id}/resume`;

  return (
    <div className="app-page ui-page hr-page hr-wide">
      <PageHeader
        title={c.name}
        description={
          <span className="hr-head-meta">
            <span>{c.email}</span>
            {c.phone && <span>{c.phone}</span>}
            {c.location && <span>{c.location}</span>}
            {c.headline && <span>{c.headline}</span>}
          </span>
        }
        back={{ href: '/app/hiring/candidates', label: t('nav.candidates') }}
        actions={
          profile.canDelete ? (
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>
              {t('profile.deleteData')}
            </button>
          ) : undefined
        }
      />

      {profile.applications.length > 1 && (
        <div className="ui-tabs" role="tablist" aria-label={t('profile.applications')}>
          {profile.applications.map((a) => (
            <button key={a.id} type="button" role="tab" className="ui-tab" aria-selected={a.id === app.id} onClick={() => setAppId(a.id)}>
              {a.job.title}
            </button>
          ))}
        </div>
      )}

      <div className="hr-stagebar panel">
        <div className="hr-stagebar-main">
          <span className="hr-stagebar-job">{app.job.title}</span>
          <AppStatusBadge status={app.status} />
          {app.knockedOut && <span className="badge badge-warn">{t('pipeline.knockout')}</span>}
          <span className="hr-rowmeta">
            {t(`sources.${app.source}`)}
            {app.utm.utm_source ? ` · utm_source=${app.utm.utm_source}` : ''}
            {app.utm.utm_campaign ? ` · utm_campaign=${app.utm.utm_campaign}` : ''} · {date(app.createdAt, false)}
          </span>
        </div>
        {app.canManage && (
          <div className="hr-stagebar-actions">
            <label className="sr-only" htmlFor="hr-stage-select">
              {t('profile.stage')}
            </label>
            <select id="hr-stage-select" className="select" value={app.stageId} disabled={busy} onChange={(e) => void act(`/api/hiring/applications/${app.id}`, 'PATCH', { action: 'move', stageId: e.target.value }, t('profile.movedTo', { stage: app.stages.find((s) => s.id === e.target.value)?.name ?? '' }))}>
              {app.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {app.status === 'rejected' ? (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void act(`/api/hiring/applications/${app.id}`, 'PATCH', { action: 'reactivate' }, t('profile.reactivated'))}>
                {t('profile.reactivate')}
              </button>
            ) : (
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setRejectOpen(true)}>
                {t('profile.reject')}
              </button>
            )}
          </div>
        )}
        {!app.canManage && stage && <span className="hr-rowmeta">{stage.name}</span>}
      </div>

      <div className="hr-profile">
        <div className="hr-profile-main">
          <div className="ui-tabs" role="tablist" aria-label={c.name}>
            {visibleTabs.map((k) => (
              <button key={k} type="button" role="tab" className="ui-tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                {t(`profile.tabs.${k}`)}
              </button>
            ))}
          </div>

          {tab === 'timeline' && (
            <section className="hr-section">
              <form
                className="hr-note-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!note.trim()) return;
                  const done = await act(`/api/hiring/applications/${app.id}/notes`, 'POST', { body: note });
                  if (done) setNote('');
                }}
              >
                <label className="sr-only" htmlFor="hr-note">
                  {t('profile.note')}
                </label>
                <textarea id="hr-note" className="textarea" rows={2} placeholder={t('profile.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={10000} />
                <div className="hr-actions-row">
                  <button type="submit" className="btn btn-secondary btn-sm" disabled={!note.trim() || busy}>
                    {t('profile.addNote')}
                  </button>
                  {app.canManage && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMailOpen(true)}>
                      {t('profile.sendEmail')}
                    </button>
                  )}
                </div>
                {app.canManage && !repliesEnabled && <p className="ui-help">{t('profile.repliesOff')}</p>}
              </form>
              <ol className="hr-timeline">
                {profile.timeline
                  .filter((e) => !e.applicationId || e.applicationId === app.id)
                  .map((e) => (
                    <li key={e.id} className={`hr-event hr-event-${e.kind}`}>
                      <div className="hr-event-head">
                        <span className="hr-event-kind">{t(`events.${e.kind}`, eventVars(e.data, t))}</span>
                        <span className="hr-event-meta">
                          {e.actorName ?? (e.kind === 'email_in' ? c.name : '')} · {date(e.createdAt)}
                        </span>
                      </div>
                      {typeof e.data.subject === 'string' && <p className="hr-event-subject">{e.data.subject}</p>}
                      {typeof e.data.body === 'string' && <p className="hr-event-body">{e.data.body}</p>}
                      {typeof e.data.reason === 'string' && e.data.reason && <p className="hr-event-body">{e.data.reason}</p>}
                    </li>
                  ))}
              </ol>
            </section>
          )}

          {tab === 'resume' && (
            <section className="hr-section">
              {!c.hasResume ? (
                <p className="ui-help">{t('profile.noResume')}</p>
              ) : c.resumeMime === 'application/pdf' ? (
                <>
                  <iframe className="hr-resume" src={resumeUrl} title={t('profile.resumeOf', { name: c.name })} />
                  <a className="btn btn-ghost btn-sm" href={`${resumeUrl}?download=1`}>
                    {t('profile.download')}
                  </a>
                </>
              ) : (
                <a className="btn btn-secondary" href={`${resumeUrl}?download=1`}>
                  {t('profile.downloadName', { name: c.resumeName ?? 'resume' })}
                </a>
              )}
            </section>
          )}

          {tab === 'scorecards' && (
            <section className="hr-section">
              {canScore && scoreStage && (
                <form className="panel hr-scoreform" onSubmit={submitScore} aria-label={t('score.formTitle', { stage: scoreStage.name })}>
                  <h3 className="hr-panel-title">{t('score.formTitle', { stage: scoreStage.name })}</h3>
                  {scoreStage.criteria.map((cr) => (
                    <fieldset key={cr.id} className="hr-criterion">
                      <legend className="label">{cr.label}</legend>
                      <div className="hr-rating">
                        {[1, 2, 3, 4].map((n) => (
                          <label key={n} className="hr-rating-opt">
                            <input type="radio" name={`r-${cr.id}`} value={n} checked={ratings[cr.id] === n} onChange={() => setRatings((r) => ({ ...r, [cr.id]: n }))} />
                            <span>{t(`score.rating.${n}`)}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                  <fieldset className="hr-criterion">
                    <legend className="label">{t('score.overall')}</legend>
                    <div className="hr-rating">
                      {OVERALL.map((o) => (
                        <label key={o} className="hr-rating-opt">
                          <input type="radio" name="overall" value={o} checked={overall === o} onChange={() => setOverall(o)} required />
                          <span>{t(`score.overallOpts.${o}`)}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="ui-field">
                    <span className="label">{t('score.notes')}</span>
                    <textarea className="textarea" rows={3} maxLength={10000} value={scoreNotes} onChange={(e) => setScoreNotes(e.target.value)} />
                  </label>
                  <div className="hr-actions-row">
                    <button type="submit" className="btn btn-primary" disabled={!overall || busy}>
                      {mine ? t('score.update') : t('score.submit')}
                    </button>
                  </div>
                </form>
              )}
              {mine && !app.canManage && <p className="ui-help">{t('score.locked')}</p>}
              {app.othersHidden > 0 && (
                <p className="ui-help hr-hidden-note" data-testid="hr-hidden-scores">
                  {t('score.hidden', { count: app.othersHidden })}
                </p>
              )}
              {app.scorecards.length === 0 && app.othersHidden === 0 ? (
                <p className="ui-help">{t('score.none')}</p>
              ) : (
                <ul className="hr-scorecards">
                  {app.scorecards.map((s) => {
                    const st = app.stages.find((x) => x.id === s.stageId);
                    return (
                      <li key={s.id} className="panel hr-scorecard" data-testid="hr-scorecard">
                        <div className="hr-event-head">
                          <span className="hr-event-kind">
                            {s.userName ?? '·'} · {st?.name}
                          </span>
                          <span className={`badge ${s.overall.includes('yes') ? 'badge-ok' : 'badge-bad'}`}>{t(`score.overallOpts.${s.overall}`)}</span>
                        </div>
                        <ul className="hr-ratings">
                          {(st?.criteria ?? []).map((cr) => (
                            <li key={cr.id}>
                              {cr.label}: <strong>{s.ratings[cr.id] ? t(`score.rating.${s.ratings[cr.id]}`) : '·'}</strong>
                            </li>
                          ))}
                        </ul>
                        {s.notes && <p className="hr-event-body">{s.notes}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {tab === 'interviews' && (
            <section className="hr-section">
              {app.canManage && (
                <div className="hr-actions-row">
                  <button type="button" className="btn btn-primary" onClick={() => setScheduleOpen(true)}>
                    {t('interviews.schedule')}
                  </button>
                </div>
              )}
              {interviews === null ? (
                <p className="ui-help">{t('common.loading')}</p>
              ) : interviews.length === 0 ? (
                <p className="ui-help">{t('interviews.none')}</p>
              ) : (
                <ul className="hr-list">
                  {interviews.map((iv) => (
                    <li key={iv.id} className="hr-list-row" data-testid="hr-interview">
                      <span className="hr-list-main">
                        {app.stages.find((s) => s.id === iv.stageId)?.name} · {t(`interviews.status.${iv.status}`)}
                      </span>
                      <span className="hr-list-meta">{iv.startsAt ? date(iv.startsAt) : t('interviews.waiting')}</span>
                      {iv.link && (
                        <input className="input hr-link-input" readOnly value={iv.link} aria-label={t('interviews.link')} onFocus={(e) => e.currentTarget.select()} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {tab === 'offers' && app.canManage && (
            <section className="hr-section">
              <div className="hr-actions-row">
                <button type="button" className="btn btn-primary" onClick={() => setOfferOpen(true)}>
                  {t('offers.new')}
                </button>
              </div>
              {offerLink && (
                <p className="hr-short">
                  <input className="input" readOnly value={offerLink} aria-label={t('offers.link')} onFocus={(e) => e.currentTarget.select()} />
                </p>
              )}
              {offers === null ? (
                <p className="ui-help">{t('common.loading')}</p>
              ) : offers.length === 0 ? (
                <p className="ui-help">{t('offers.none')}</p>
              ) : (
                <ul className="hr-scorecards">
                  {offers.map((o) => (
                    <li key={o.id} className="panel hr-offer" data-testid="hr-offer">
                      <div className="hr-event-head">
                        <span className="hr-event-kind">
                          {o.title} · {money(o.salary, o.currency, locale)}
                          {o.startDate ? ` · ${o.startDate}` : ''}
                        </span>
                        <span className="badge badge-outline" data-status={o.status}>
                          {t(`offers.status.${o.status}`)}
                        </span>
                      </div>
                      <pre className="hr-letter">{o.body}</pre>
                      {o.status === 'accepted' && <p className="ui-help">{t('offers.signed', { name: o.signedName ?? '', date: date(o.respondedAt), ip: o.signedIp ?? '' })}</p>}
                      {o.status === 'declined' && o.declineReason && <p className="ui-help">{o.declineReason}</p>}
                      <div className="hr-actions-row">
                        {o.status === 'pending_approval' && (isAdmin || app.myRole === 'hiring_manager') && (
                          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act(`/api/hiring/offers/${o.id}`, 'PATCH', { action: 'approve' }, t('offers.approved'))}>
                            {t('offers.approve')}
                          </button>
                        )}
                        {o.status === 'pending_approval' && !(isAdmin || app.myRole === 'hiring_manager') && <span className="ui-help">{t('offers.waitingApproval')}</span>}
                        {(o.status === 'approved' || o.status === 'sent') && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy}
                            onClick={async () => {
                              const data = (await act(`/api/hiring/offers/${o.id}`, 'PATCH', { action: 'send' }, t('offers.sent'))) as { link?: string } | null;
                              if (data?.link) setOfferLink(data.link);
                            }}
                          >
                            {o.status === 'sent' ? t('offers.resend') : t('offers.send')}
                          </button>
                        )}
                        {['pending_approval', 'approved', 'sent'].includes(o.status) && (
                          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void act(`/api/hiring/offers/${o.id}`, 'PATCH', { action: 'withdraw' }, t('offers.withdrawn'))}>
                            {t('offers.withdraw')}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <aside className="hr-profile-side">
          {(c.links.length > 0 || profile.documents.length > 0 || profile.duplicates.length > 0) && (
            <section className="panel">
              {c.links.length > 0 && (
                <>
                  <h2 className="hr-panel-title">{t('profile.links')}</h2>
                  <ul className="hr-list">
                    {c.links.map((l) => (
                      <li key={l}>
                        <a className="hr-list-row" href={l} target="_blank" rel="noreferrer nofollow">
                          <span className="hr-list-main">{l.replace(/^https?:\/\//, '')}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {profile.documents.length > 0 && (
                <>
                  <h2 className="hr-panel-title">{t('profile.documents')}</h2>
                  <ul className="hr-list">
                    {profile.documents.map((d) => (
                      <li key={d.id}>
                        <a className="hr-list-row" href={`${resumeUrl}?doc=${d.id}${d.mime === 'application/pdf' ? '' : '&download=1'}`} target="_blank" rel="noreferrer">
                          <span className="hr-list-main">{d.name}</span>
                          <span className="hr-list-meta">{date(d.createdAt, false)}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {profile.duplicates.length > 0 && (
                <>
                  <h2 className="hr-panel-title">{t('profile.duplicates')}</h2>
                  <ul className="hr-list">
                    {profile.duplicates.map((d) => (
                      <li key={d.id}>
                        <a className="hr-list-row" href={`/${locale}/app/hiring/candidates/${d.id}`}>
                          <span className="hr-list-main">{d.name}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          <section className="panel">
            <h2 className="hr-panel-title">{t('profile.tags')}</h2>
            <ul className="hr-tags">
              {c.tags.map((tg) => (
                <li key={tg} className="badge badge-outline">
                  {tg}
                  {app.canManage && (
                    <button type="button" className="hr-tag-x" aria-label={t('profile.removeTag', { tag: tg })} onClick={() => void saveTags(c.tags.filter((x) => x !== tg))}>
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {app.canManage && (
              <form
                className="hr-inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!tagDraft.trim()) return;
                  void saveTags([...c.tags, tagDraft.trim()]).then(() => setTagDraft(''));
                }}
              >
                <input className="input" aria-label={t('profile.addTag')} placeholder={t('profile.addTag')} maxLength={40} value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} />
                <button type="submit" className="btn btn-secondary btn-sm" disabled={!tagDraft.trim()}>
                  {t('common.add')}
                </button>
              </form>
            )}
          </section>

          {app.canManage && (
          <section className="panel">
            <h2 className="hr-panel-title">{t('ai.title')}</h2>
            <p className="ui-help">{t('ai.note')}</p>
            {c.aiSummary && <p className="hr-ai-summary" data-testid="hr-ai-summary">{c.aiSummary}</p>}
            {Array.isArray(c.aiFields.skills) && (c.aiFields.skills as string[]).length > 0 && (
              <p className="hr-rowmeta">
                {t('ai.skills')}: {(c.aiFields.skills as string[]).join(', ')}
              </p>
            )}
            <div className="hr-actions-row">
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !c.hasResume} onClick={() => void act(`/api/hiring/candidates/${c.id}/ai`, 'POST', { action: 'parse', locale }, t('ai.parsed'))}>
                {t('ai.parse')}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void act(`/api/hiring/candidates/${c.id}/ai`, 'POST', { action: 'summary', locale }, t('ai.summarized'))}>
                {t('ai.summarize')}
              </button>
            </div>
          </section>
          )}

          {app.answers.length > 0 && (
            <section className="panel">
              <h2 className="hr-panel-title">{t('profile.answers')}</h2>
              <dl className="hr-answers">
                {app.answers.map((a) => (
                  <div key={a.id}>
                    <dt>{a.label}</dt>
                    <dd>
                      {a.value === 'yes' ? t('common.yes') : a.value === 'no' ? t('common.no') : a.value}
                      {a.knockout && <span className="badge badge-warn hr-ml">{t('pipeline.knockout')}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section className="panel">
            <h2 className="hr-panel-title">{t('profile.evaluators')}</h2>
            {app.evaluators.length === 0 ? (
              <p className="ui-help">{t('profile.noEvaluators')}</p>
            ) : (
              <ul className="hr-list">
                {app.evaluators.map((e) => (
                  <li key={e.userId} className="hr-list-row">
                    <span className="hr-list-main">{e.name ?? '·'}</span>
                    <span className="hr-list-meta">{e.submitted ? t('profile.submitted') : t('profile.pendingScore')}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2 className="hr-panel-title">{t('profile.privacy')}</h2>
            <p className="ui-help">{c.consentAt ? t('profile.consentAt', { date: date(c.consentAt, false) }) : t('profile.noConsent')}</p>
            {app.canManage && (
              <label className="ui-check">
                <input type="checkbox" checked={c.keepConsent} onChange={(e) => void act(`/api/hiring/candidates/${c.id}`, 'PATCH', { keepConsent: e.target.checked })} />
                {t('profile.keepConsent')}
              </label>
            )}
          </section>
        </aside>
      </div>

      <HrDialog open={rejectOpen} title={t('reject.titleOne', { name: c.name })} onClose={() => setRejectOpen(false)}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setRejectOpen(false);
            await act(`/api/hiring/applications/${app.id}`, 'PATCH', { action: 'reject', reason: rejectReason, sendEmail: rejectEmail, templateId: rejectTpl || null }, t('profile.rejected'));
          }}
        >
          <div className="ui-modal-body ui-fields">
            <label className="ui-field">
              <span className="label">{t('reject.reason')}</span>
              <input className="input" maxLength={300} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} autoFocus />
            </label>
            <label className="ui-check">
              <input type="checkbox" checked={rejectEmail} onChange={(e) => setRejectEmail(e.target.checked)} />
              {t('reject.sendEmail')}
            </label>
            {rejectEmail && (
              <label className="ui-field">
                <span className="label">{t('reject.template')}</span>
                <select className="select" value={rejectTpl} onChange={(e) => setRejectTpl(e.target.value)}>
                  <option value="">{t('reject.defaultTemplate')}</option>
                  {templates
                    .filter((x) => x.kind === 'rejection')
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setRejectOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-danger">
              {t('profile.reject')}
            </button>
          </div>
        </form>
      </HrDialog>

      <HrDialog open={mailOpen} title={t('profile.sendEmail')} onClose={() => setMailOpen(false)} wide>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const done = await act(`/api/hiring/applications/${app.id}/emails`, 'POST', mail, t('profile.emailSent'));
            if (done) {
              setMailOpen(false);
              setMail({ subject: '', body: '' });
            }
          }}
        >
          <div className="ui-modal-body ui-fields">
            <label className="ui-field">
              <span className="label">{t('templates.use')}</span>
              <select className="select" defaultValue="" onChange={(e) => pickTemplate(e.target.value)}>
                <option value="">{t('templates.none')}</option>
                {templates
                  .filter((x) => x.kind !== 'offer_letter')
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="label">{t('templates.subject')}</span>
              <input className="input" required maxLength={300} value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} />
            </label>
            <label className="ui-field">
              <span className="label">{t('templates.body')}</span>
              <textarea className="textarea" required rows={10} maxLength={20000} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} />
              <span className="ui-help">
                  {t('templates.variablesHelp')} {VARIABLES.map((v) => `{{${v}}}`).join(', ')}
                </span>
            </label>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setMailOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t('profile.send')}
            </button>
          </div>
        </form>
      </HrDialog>

      <HrDialog open={scheduleOpen} title={t('interviews.schedule')} onClose={() => setScheduleOpen(false)}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const res = await api<{ link: string }>(`/api/hiring/applications/${app.id}/interviews`, { method: 'POST', json: { ...schedule, locale } });
            setBusy(false);
            if (!res.ok) return push(errText(res.data.error), 'bad');
            setScheduleOpen(false);
            push(schedule.sendEmail ? t('interviews.sent') : t('interviews.created'));
            const list = await api<{ interviews: InterviewDto[] }>(`/api/hiring/applications/${app.id}/interviews`);
            if (list.ok) setInterviews(list.data.interviews);
            await reload();
          }}
        >
          <div className="ui-modal-body ui-fields">
            <p className="ui-help">{t('interviews.help', { stage: stage?.name ?? '' })}</p>
            <label className="ui-field">
              <span className="label">{t('interviews.duration')}</span>
              <select className="select" value={schedule.durationMin} onChange={(e) => setSchedule({ ...schedule, durationMin: Number(e.target.value) })}>
                {[30, 45, 60, 90].map((m) => (
                  <option key={m} value={m}>
                    {t('interviews.minutes', { count: m })}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-check">
              <input type="checkbox" checked={schedule.sendEmail} onChange={(e) => setSchedule({ ...schedule, sendEmail: e.target.checked })} />
              {t('interviews.sendEmail')}
            </label>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setScheduleOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t('interviews.create')}
            </button>
          </div>
        </form>
      </HrDialog>

      <HrDialog open={offerOpen} title={t('offers.new')} onClose={() => setOfferOpen(false)}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const done = await act(
              `/api/hiring/applications/${app.id}/offers`,
              'POST',
              { title: offerDraft.title, salary: offerDraft.salary ? Math.round(Number(offerDraft.salary)) : null, currency: offerDraft.currency, startDate: offerDraft.startDate || null },
              t('offers.created'),
            );
            if (done) {
              setOfferOpen(false);
              const list = await api<{ offers: OfferDto[] }>(`/api/hiring/applications/${app.id}/offers`);
              if (list.ok) setOffers(list.data.offers);
            }
          }}
        >
          <div className="ui-modal-body ui-fields">
            <label className="ui-field">
              <span className="label">{t('offers.title')}</span>
              <input className="input" maxLength={160} value={offerDraft.title} onChange={(e) => setOfferDraft({ ...offerDraft, title: e.target.value })} />
            </label>
            <div className="ui-fields-2">
              <label className="ui-field">
                <span className="label">{t('offers.salary')}</span>
                <input className="input" inputMode="numeric" value={offerDraft.salary} onChange={(e) => setOfferDraft({ ...offerDraft, salary: e.target.value.replace(/[^\d]/g, '') })} />
              </label>
              <label className="ui-field">
                <span className="label">{t('job.currency')}</span>
                <input className="input" maxLength={3} value={offerDraft.currency} onChange={(e) => setOfferDraft({ ...offerDraft, currency: e.target.value.toUpperCase() })} />
              </label>
            </div>
            <label className="ui-field">
              <span className="label">{t('offers.startDate')}</span>
              <input className="input" type="date" value={offerDraft.startDate} onChange={(e) => setOfferDraft({ ...offerDraft, startDate: e.target.value })} />
            </label>
            <p className="ui-help">{t('offers.help')}</p>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setOfferOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t('offers.create')}
            </button>
          </div>
        </form>
      </HrDialog>

      <HrDialog open={confirmDelete} title={t('profile.deleteTitle')} onClose={() => setConfirmDelete(false)}>
        <div className="ui-modal-body">
          <p>{t('profile.deleteBody', { name: c.name })}</p>
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={async () => {
              const res = await api(`/api/hiring/candidates/${c.id}`, { method: 'DELETE' });
              if (!res.ok) return push(errText(res.data.error), 'bad');
              router.push('/app/hiring/candidates');
              router.refresh();
            }}
          >
            {t('profile.deleteData')}
          </button>
        </div>
      </HrDialog>
      {toast}
    </div>
  );
}

function eventVars(data: Record<string, unknown>, t: ReturnType<typeof useTranslations>): Record<string, string> {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const status = s(data.status);
  return {
    to: s(data.to),
    from: s(data.from),
    stage: s(data.stage),
    job: s(data.job),
    status: status && t.has(`events.statuses.${status}`) ? t(`events.statuses.${status}`) : status,
    overall: s(data.overall) && t.has(`score.overallOpts.${s(data.overall)}`) ? t(`score.overallOpts.${s(data.overall)}`) : '',
    source: s(data.source) && t.has(`sources.${s(data.source)}`) ? t(`sources.${s(data.source)}`) : s(data.source),
    title: s(data.title),
    tags: [...((data.added as string[]) ?? []).map((x) => `+${x}`), ...((data.removed as string[]) ?? []).map((x) => `-${x}`)].join(' '),
    action: s(data.action) && t.has(`ai.actions.${s(data.action)}`) ? t(`ai.actions.${s(data.action)}`) : s(data.action),
  };
}

export type { ProfileApplication };
