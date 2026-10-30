'use client';

import { useState, type DragEvent, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { JobDetail } from '@/lib/hiring/core';
import type { ApplicationListItem } from '@/lib/hiring/candidates';
import { HrDialog, JobStatusBadge, api, useDate, useErrorText, useToast } from './ui';
import BulkBar from './BulkBar';

export default function JobPipeline({
  detail,
  initial,
  view,
  status,
  careersUrl,
}: {
  detail: JobDetail;
  initial: ApplicationListItem[];
  view: 'board' | 'list';
  status: string;
  careersUrl: string;
}) {
  const t = useTranslations('hiring');
  const router = useRouter();
  const date = useDate();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [apps, setApps] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const { job, stages } = detail;

  const move = async (appId: string, stageId: string) => {
    const prev = apps;
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;
    setApps((xs) => xs.map((a) => (a.id === appId ? { ...a, stageId, stageName: stage.name, stageKind: stage.kind } : a)));
    const res = await api(`/api/hiring/applications/${appId}`, { method: 'PATCH', json: { action: 'move', stageId } });
    if (!res.ok) {
      setApps(prev);
      push(errText(res.data.error), 'bad');
      return;
    }
    const name = prev.find((a) => a.id === appId)?.name ?? '';
    push(t('pipeline.moved', { name, stage: stage.name }));
  };

  const onDrop = (e: DragEvent, stageId: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragging;
    setOver(null);
    setDragging(null);
    if (id && apps.find((a) => a.id === id)?.stageId !== stageId) void move(id, stageId);
  };

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAdding(true);
    const form = new FormData(e.currentTarget);
    form.set('jobId', job.id);
    const res = await api<{ candidateId: string; duplicate: boolean }>('/api/hiring/applications', { method: 'POST', body: form });
    setAdding(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setAddOpen(false);
    push(res.data.duplicate ? t('pipeline.addedDuplicate') : t('pipeline.added'));
    router.refresh();
    const list = await api<{ applications: ApplicationListItem[] }>(`/api/hiring/applications?jobId=${job.id}&status=${status}`);
    if (list.ok) setApps(list.data.applications);
  };

  const setView = (v: 'board' | 'list') => router.push(`/app/hiring/jobs/${job.id}?view=${v}${status !== 'active' ? `&status=${status}` : ''}`);
  const setStatus = (s: string) => router.push(`/app/hiring/jobs/${job.id}?view=${view}&status=${s}`);

  const header = (
    <PageHeader
      title={job.title}
      description={
        <span className="hr-head-meta">
          <JobStatusBadge status={job.status} />
          {[job.department, job.location].filter(Boolean).join(' · ')}
          {job.status === 'published' && (
            <a href={`${careersUrl}/${job.slug}`} target="_blank" rel="noreferrer">
              {t('jobEditor.viewPost')}
            </a>
          )}
        </span>
      }
      back={{ href: '/app/hiring/jobs', label: t('nav.jobs') }}
      actions={
        detail.canManage ? (
          <>
            <Link className="btn btn-secondary" href={`/app/hiring/jobs/${job.id}/edit`}>
              {t('pipeline.editJob')}
            </Link>
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
              {t('pipeline.addCandidate')}
            </button>
          </>
        ) : undefined
      }
    />
  );

  if (!detail.canManage) {
    return (
      <div className="app-page ui-page hr-page">
        {header}
        <EmptyState product="hiring" title={t('pipeline.notOnTeamTitle')} body={t(detail.myRole === 'interviewer' ? 'pipeline.interviewerBody' : 'pipeline.notOnTeamBody')} action={{ label: t('nav.home'), href: '/app/hiring' }} />
      </div>
    );
  }

  return (
    <div className="app-page ui-page hr-page hr-wide">
      {header}
      <div className="hr-toolbar">
        <div className="ui-tabs" role="tablist" aria-label={t('pipeline.view')}>
          <button type="button" role="tab" className="ui-tab" aria-selected={view === 'board'} onClick={() => setView('board')}>
            {t('pipeline.board')}
          </button>
          <button type="button" role="tab" className="ui-tab" aria-selected={view === 'list'} onClick={() => setView('list')}>
            {t('pipeline.list')}
          </button>
        </div>
        <select className="select hr-filter" aria-label={t('filters.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          {(['active', 'rejected', 'hired', 'all'] as const).map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? t('filters.all') : t(`appStatus.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {apps.length === 0 && view === 'list' ? (
        <EmptyState product="hiring" title={t('pipeline.emptyTitle')} body={t('pipeline.emptyBody')} action={<button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>{t('pipeline.addCandidate')}</button>} />
      ) : view === 'board' ? (
        <div className="hr-board" role="list" aria-label={t('pipeline.board')}>
          {stages.map((s) => {
            const cards = apps.filter((a) => a.stageId === s.id);
            return (
              <section
                key={s.id}
                role="listitem"
                className={`hr-col${over === s.id ? ' is-over' : ''}`}
                aria-label={s.name}
                data-stage={s.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (over !== s.id) setOver(s.id);
                }}
                onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
                onDrop={(e) => onDrop(e, s.id)}
              >
                <header className="hr-col-head">
                  <h2 className="hr-col-title">{s.name}</h2>
                  <span className="hr-col-count">{cards.length}</span>
                </header>
                <ul className="hr-cards">
                  {cards.map((a) => (
                    <li
                      key={a.id}
                      className={`hr-card${dragging === a.id ? ' is-dragging' : ''}`}
                      draggable
                      data-app={a.id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', a.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDragging(a.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                    >
                      <Link href={`/app/hiring/candidates/${a.candidateId}?app=${a.id}`} className="hr-card-name">
                        {a.name}
                      </Link>
                      <span className="hr-card-meta">
                        {t(`sources.${a.source}`)} · {date(a.createdAt, false)}
                      </span>
                      {(a.knockedOut || a.status !== 'active') && (
                        <span className="hr-card-flags">
                          {a.knockedOut && <span className="badge badge-warn">{t('pipeline.knockout')}</span>}
                          {a.status !== 'active' && <span className="badge badge-outline">{t(`appStatus.${a.status}`)}</span>}
                        </span>
                      )}
                      <select className="select hr-card-move" aria-label={t('pipeline.moveTo', { name: a.name })} value={a.stageId} onChange={(e) => void move(a.id, e.target.value)}>
                        {stages.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <>
          <BulkBar selected={[...selected]} stages={stages} onDone={() => { setSelected(new Set()); router.refresh(); void api<{ applications: ApplicationListItem[] }>(`/api/hiring/applications?jobId=${job.id}&status=${status}`).then((r) => r.ok && setApps(r.data.applications)); }} push={push} />
          <div className="table-wrap">
            <table className="table hr-table">
              <thead>
                <tr>
                  <th scope="col" className="hr-check-col">
                    <label className="ui-check">
                      <input type="checkbox" aria-label={t('bulk.selectAll')} checked={selected.size > 0 && selected.size === apps.length} onChange={(e) => setSelected(e.target.checked ? new Set(apps.map((a) => a.id)) : new Set())} />
                    </label>
                  </th>
                  <th scope="col">{t('candidates.colName')}</th>
                  <th scope="col">{t('candidates.colStage')}</th>
                  <th scope="col" className="hr-hide-sm">
                    {t('candidates.colSource')}
                  </th>
                  <th scope="col" className="hr-hide-sm">
                    {t('candidates.colApplied')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.id}>
                    <td className="hr-check-col">
                      <label className="ui-check">
                        <input
                          type="checkbox"
                          aria-label={t('bulk.select', { name: a.name })}
                          checked={selected.has(a.id)}
                          onChange={(e) =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(a.id);
                              else n.delete(a.id);
                              return n;
                            })
                          }
                        />
                      </label>
                    </td>
                    <th scope="row">
                      <Link href={`/app/hiring/candidates/${a.candidateId}?app=${a.id}`} className="hr-rowlink">
                        <span className="hr-rowtitle">{a.name}</span>
                        <span className="hr-rowmeta">{a.tags.join(', ')}</span>
                      </Link>
                    </th>
                    <td>
                      {a.stageName}
                      {a.knockedOut && <span className="badge badge-warn hr-ml">{t('pipeline.knockout')}</span>}
                    </td>
                    <td className="hr-hide-sm">{t(`sources.${a.source}`)}</td>
                    <td className="hr-hide-sm">{date(a.createdAt, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <HrDialog open={addOpen} title={t('pipeline.addCandidate')} onClose={() => setAddOpen(false)}>
        <form onSubmit={add}>
          <div className="ui-modal-body ui-fields">
            <label className="ui-field">
              <span className="label">{t('apply.name')}</span>
              <input className="input" name="name" required maxLength={160} autoFocus />
            </label>
            <label className="ui-field">
              <span className="label">{t('apply.email')}</span>
              <input className="input" name="email" type="email" required maxLength={254} />
            </label>
            <label className="ui-field">
              <span className="label">{t('candidates.colSource')}</span>
              <select className="select" name="source" defaultValue="manual">
                {(['manual', 'referral', 'linkedin', 'email', 'other'] as const).map((s) => (
                  <option key={s} value={s}>
                    {t(`sources.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="label">{t('apply.resume')}</span>
              <input className="input" name="resume" type="file" accept=".pdf,.doc,.docx,application/pdf" />
              <span className="ui-help">{t('apply.resumeHelp')}</span>
            </label>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setAddOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={adding}>
              {t('pipeline.add')}
            </button>
          </div>
        </form>
      </HrDialog>
      {toast}
    </div>
  );
}
