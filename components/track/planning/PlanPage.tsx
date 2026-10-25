'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import { MarkdownView } from '@/components/track/MarkdownEditor';
import type { PlanIssue, PlanMilestone, PlanSummary } from '@/lib/track-plans';
import { PLAN_PRIORITIES, PLAN_STATUSES } from '@/lib/track-planning-schema';
import { api, CheckList, fmtDay, HealthDot, LoadingRows, PlanStatusIcon, ProgressBar, personName } from './shared';
import type { PlansMeta } from './PlansList';
import PlanUpdates from './PlanUpdates';

type Tab = 'overview' | 'issues' | 'updates';

interface PlanResponse {
  plan: PlanSummary;
  milestones: PlanMilestone[];
  following: boolean;
}

/** Página del plan (como un project de Linear): Overview, Issues y Updates, con propiedades a la derecha. */
export default function PlanPage({ planId }: { planId: string }) {
  const t = useTranslations('trackPlanning');
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const [data, setData] = useState<PlanResponse | null>(null);
  const [meta, setMeta] = useState<PlansMeta | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [tab, setTab] = useState<Tab>(() => {
    const v = sp.get('tab');
    return v === 'issues' || v === 'updates' ? v : 'overview';
  });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');

  const load = useCallback(async () => {
    const [res, m] = await Promise.all([
      api<PlanResponse>(`/api/track/plans/${planId}`),
      api<PlansMeta & { rows: unknown[] }>('/api/track/plans?meta=only'),
    ]);
    if (res.status === 404) return setState('missing');
    if (!res.ok) return setState('error');
    setData(res.data);
    setName(res.data.plan.name);
    setSummary(res.data.plan.summary);
    if (m.ok) setMeta({ members: m.data.members, teams: m.data.teams, initiatives: m.data.initiatives, me: m.data.me });
    setState('ok');
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectTab = (next: Tab) => {
    setTab(next);
    const q = new URLSearchParams(sp.toString());
    if (next === 'overview') q.delete('tab');
    else q.set('tab', next);
    q.delete('new');
    router.replace(`/app/track/projects/${planId}${q.toString() ? `?${q}` : ''}`);
  };

  const patch = async (body: Record<string, unknown>) => {
    setError(null);
    const res = await api<PlanSummary & { error?: string }>(`/api/track/plans/${planId}`, 'PATCH', body);
    if (!res.ok) {
      setError(res.data.error === 'invalid_range' ? t('plan.invalidRange') : t('common.saveError'));
      return false;
    }
    setData((d) => (d ? { ...d, plan: res.data } : d));
    return true;
  };

  const saveName = async () => {
    const v = name.trim();
    if (!data) return;
    if (!v) return setName(data.plan.name);
    if (v !== data.plan.name) await patch({ name: v });
  };

  const remove = async () => {
    const res = await api(`/api/track/plans/${planId}`, 'DELETE');
    setConfirmDelete(false);
    if (res.ok) router.push('/app/track/projects');
    else setError(t('common.saveError'));
  };

  const follow = async (following: boolean) => {
    const res = await api<{ following: boolean }>(`/api/track/plans/${planId}/follow`, 'PUT', { following });
    if (res.ok) setData((d) => (d ? { ...d, following: res.data.following } : d));
  };

  if (state === 'loading') return <LoadingRows rows={6} />;
  if (state === 'missing') {
    return <EmptyState title={t('plan.notFound')} action={{ label: t('plan.back'), href: '/app/track/projects' }} />;
  }
  if (state === 'error' || !data) {
    return (
      <EmptyState
        title={t('common.loadError')}
        action={
          <button type="button" className="btn btn-primary" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        }
      />
    );
  }
  const { plan } = data;
  const enter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') {
      setName(plan.name);
      setSummary(plan.summary);
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="tp-plan" data-testid="tp-plan-page">
      <div className="tp-plan-main">
        <nav className="tp-crumbs" aria-label={t('plans.title')}>
          <Link href="/app/track/projects">{t('plans.title')}</Link>
          <span aria-hidden="true">›</span>
          <span>{plan.name}</span>
        </nav>
        <div className="tp-plan-head">
          <span className="tp-plan-icon" aria-hidden="true">
            {plan.icon || <PlanStatusIcon status={plan.status} />}
          </span>
          <input
            className="tp-title-input"
            aria-label={t('plans.nameLabel')}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void saveName()}
            onKeyDown={enter}
            data-testid="tp-plan-name"
          />
        </div>
        <input
          className="tp-summary-input"
          aria-label={t('plans.summaryLabel')}
          placeholder={t('plans.summaryPlaceholder')}
          value={summary}
          maxLength={255}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={() => summary !== plan.summary && void patch({ summary })}
          onKeyDown={enter}
        />
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}

        <div className="ui-tabs" role="tablist" aria-label={plan.name}>
          {(['overview', 'issues', 'updates'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              className="ui-tab"
              aria-selected={tab === k}
              onClick={() => selectTab(k)}
              data-testid={`tp-tab-${k}`}
            >
              {t(`plan.tabs.${k}`)}
              {k === 'issues' && <span className="ui-tab-count">{plan.progress.total}</span>}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <Overview data={data} locale={locale} onPatch={patch} onReload={load} onWrite={() => selectTab('updates')} />
        )}
        {tab === 'issues' && <PlanIssues plan={plan} milestones={data.milestones} meta={meta} onChanged={load} />}
        {tab === 'updates' && <PlanUpdates plan={plan} meta={meta} composeOpen={sp.get('new') === '1'} onPosted={load} />}
      </div>

      <aside className="tp-plan-side" aria-label={t('plan.properties')}>
        <Properties plan={plan} meta={meta} onPatch={patch} following={data.following} onFollow={follow} />
        <button type="button" className="btn btn-sm btn-ghost tp-danger-link" onClick={() => setConfirmDelete(true)} data-testid="tp-plan-delete">
          {t('plan.delete')}
        </button>
      </aside>

      <ConfirmDialog
        open={confirmDelete}
        title={t('plan.deleteTitle', { name: plan.name })}
        body={t('plan.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function Properties({
  plan,
  meta,
  onPatch,
  following,
  onFollow,
}: {
  plan: PlanSummary;
  meta: PlansMeta | null;
  onPatch: (b: Record<string, unknown>) => Promise<boolean>;
  following: boolean;
  onFollow: (v: boolean) => void;
}) {
  const t = useTranslations('trackPlanning');
  const [open, setOpen] = useState<'members' | 'teams' | 'initiatives' | null>(null);
  const memberNames = plan.member_ids.map((id) => personName(meta?.members.find((m) => m.id === id))).filter(Boolean);
  return (
    <dl className="tp-props">
      <dt>
        <label htmlFor="tp-prop-status">{t('plan.status')}</label>
      </dt>
      <dd>
        <select id="tp-prop-status" className="select" value={plan.status} onChange={(e) => void onPatch({ status: e.target.value })} data-testid="tp-prop-status">
          {PLAN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
      </dd>
      <dt>{t('plan.health')}</dt>
      <dd>
        <HealthDot health={plan.health} label={t(`health.${plan.health}`)} />
      </dd>
      <dt>
        <label htmlFor="tp-prop-priority">{t('plan.priority')}</label>
      </dt>
      <dd>
        <select id="tp-prop-priority" className="select" value={plan.priority} onChange={(e) => void onPatch({ priority: e.target.value })}>
          {PLAN_PRIORITIES.map((s) => (
            <option key={s} value={s}>
              {t(`priority.${s}`)}
            </option>
          ))}
        </select>
      </dd>
      <dt>
        <label htmlFor="tp-prop-lead">{t('plan.lead')}</label>
      </dt>
      <dd>
        <select id="tp-prop-lead" className="select" value={plan.lead_id ?? ''} onChange={(e) => void onPatch({ leadId: e.target.value || null })} data-testid="tp-prop-lead">
          <option value="">{t('common.noLead')}</option>
          {meta?.members.map((m) => (
            <option key={m.id} value={m.id}>
              {personName(m)}
            </option>
          ))}
        </select>
      </dd>
      <dt>{t('plan.members')}</dt>
      <dd>
        <button type="button" className="tp-prop-btn" aria-expanded={open === 'members'} onClick={() => setOpen(open === 'members' ? null : 'members')}>
          {memberNames.length ? memberNames.join(', ') : t('common.none')}
        </button>
        {open === 'members' && meta && (
          <CheckList
            name="members"
            label={t('plan.members')}
            items={meta.members}
            selected={plan.member_ids}
            onChange={(ids) => void onPatch({ memberIds: ids })}
            render={(m) => personName(m)}
          />
        )}
      </dd>
      <dt>{t('plan.teams')}</dt>
      <dd>
        <button type="button" className="tp-prop-btn" aria-expanded={open === 'teams'} onClick={() => setOpen(open === 'teams' ? null : 'teams')}>
          {plan.teams.length ? plan.teams.map((x) => x.name).join(', ') : t('common.none')}
        </button>
        {open === 'teams' && meta && (
          <CheckList
            name="teams"
            label={t('plan.teams')}
            items={meta.teams}
            selected={plan.teams.map((x) => x.id)}
            onChange={(ids) => void onPatch({ teamIds: ids })}
            render={(m) => m.name}
          />
        )}
      </dd>
      <dt>
        <label htmlFor="tp-prop-start">{t('plan.startDate')}</label>
      </dt>
      <dd>
        <input id="tp-prop-start" type="date" className="input" value={plan.start_date ?? ''} onChange={(e) => void onPatch({ startDate: e.target.value || null })} />
      </dd>
      <dt>
        <label htmlFor="tp-prop-target">{t('plan.targetDate')}</label>
      </dt>
      <dd>
        <input
          id="tp-prop-target"
          type="date"
          className="input"
          value={plan.target_date ?? ''}
          onChange={(e) => void onPatch({ targetDate: e.target.value || null })}
          data-testid="tp-prop-target"
        />
      </dd>
      <dt>{t('plan.initiatives')}</dt>
      <dd>
        <button type="button" className="tp-prop-btn" aria-expanded={open === 'initiatives'} onClick={() => setOpen(open === 'initiatives' ? null : 'initiatives')}>
          {plan.initiatives.length ? plan.initiatives.map((x) => x.name).join(', ') : t('common.none')}
        </button>
        {open === 'initiatives' && meta && (
          meta.initiatives.length ? (
            <CheckList
              name="initiatives"
              label={t('plan.initiatives')}
              items={meta.initiatives}
              selected={plan.initiatives.map((x) => x.id)}
              onChange={(ids) => void onPatch({ initiativeIds: ids })}
              render={(m) => m.name}
            />
          ) : (
            <p className="ui-help">
              <Link href="/app/track/initiatives?new=1">{t('initiatives.new')}</Link>
            </p>
          )
        )}
      </dd>
      <dt>
        <label htmlFor="tp-prop-cadence">{t('plan.reminders')}</label>
      </dt>
      <dd className="tp-prop-pair">
        <select id="tp-prop-cadence" className="select" value={plan.update_cadence} onChange={(e) => void onPatch({ updateCadence: e.target.value })}>
          {(['weekly', 'biweekly', 'off'] as const).map((c) => (
            <option key={c} value={c}>
              {t(`plan.cadence.${c}`)}
            </option>
          ))}
        </select>
        {plan.update_cadence !== 'off' && (
          <select
            className="select"
            aria-label={t('plan.reminderDay')}
            value={plan.update_day}
            onChange={(e) => void onPatch({ updateDay: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <option key={d} value={d}>
                {t(`plan.days.${d}`)}
              </option>
            ))}
          </select>
        )}
      </dd>
      <dd className="tp-prop-note ui-help">
        {plan.update_cadence === 'off' ? t('plan.remindersOff') : t('plan.remindersHelp')}
      </dd>
      <dt>{t('plan.follow')}</dt>
      <dd>
        <button type="button" className="btn btn-sm" aria-pressed={following} onClick={() => onFollow(!following)} data-testid="tp-follow">
          {following ? t('plan.following') : t('plan.followAction')}
        </button>
      </dd>
    </dl>
  );
}

function Overview({
  data,
  locale,
  onPatch,
  onReload,
  onWrite,
}: {
  data: PlanResponse;
  locale: string;
  onPatch: (b: Record<string, unknown>) => Promise<boolean>;
  onReload: () => Promise<void>;
  onWrite: () => void;
}) {
  const t = useTranslations('trackPlanning');
  const { plan, milestones } = data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(plan.description);
  const [latest, setLatest] = useState<{ health: string; body: string; user_name: string | null; user_email: string; created_at: string } | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void api<{ rows: Array<{ health: string; body: string; user_name: string | null; user_email: string; created_at: string }> }>(
      `/api/track/plans/${plan.id}/updates`,
    ).then((r) => alive && setLatest(r.ok ? (r.data.rows[0] ?? null) : null));
    return () => {
      alive = false;
    };
  }, [plan.id, plan.last_update_at]);

  const p = plan.progress;
  return (
    <div className="tp-overview">
      <section className="tp-card" aria-labelledby="tp-progress-h">
        <h3 id="tp-progress-h" className="tp-card-title">
          {t('plan.progress')}
        </h3>
        <ProgressBar percent={p.percent} label={t('plan.progress')} />
        <p className="ui-help" data-testid="tp-progress-detail">
          {t('plan.progressDetail', { done: p.done, total: p.total, started: p.started })}
          {p.byPoints ? ` · ${t('plan.byPoints', { done: p.donePoints, total: p.points })}` : ''}
        </p>
      </section>

      <section className="tp-card" aria-labelledby="tp-latest-h">
        <div className="tp-card-head">
          <h3 id="tp-latest-h" className="tp-card-title">
            {t('plan.latestUpdate')}
          </h3>
          <button type="button" className="btn btn-sm" onClick={onWrite}>
            {t('plan.writeUpdate')}
          </button>
        </div>
        {latest === undefined ? (
          <span className="ui-skeleton ui-skeleton-text" />
        ) : latest === null ? (
          <p className="ui-help">{t('plan.noUpdateYet')}</p>
        ) : (
          <div className="tp-latest">
            <HealthDot health={latest.health as 'on_track'} label={t(`health.${latest.health}`)} />
            <span className="ui-help">
              {latest.user_name || latest.user_email} · {fmtDay(latest.created_at, locale)}
            </span>
            {latest.body && <MarkdownView source={latest.body} className="tp-update-body" />}
          </div>
        )}
      </section>

      <section className="tp-card" aria-labelledby="tp-desc-h">
        <div className="tp-card-head">
          <h3 id="tp-desc-h" className="tp-card-title">
            {t('plan.description')}
          </h3>
          {!editing && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setDraft(plan.description);
                setEditing(true);
              }}
              data-testid="tp-edit-description"
            >
              {t('common.edit')}
            </button>
          )}
        </div>
        {editing ? (
          <form
            className="tp-desc-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await onPatch({ description: draft })) setEditing(false);
            }}
          >
            <textarea
              className="textarea tp-desc-textarea"
              aria-label={t('plan.description')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('plan.descriptionPlaceholder')}
              rows={10}
              maxLength={20000}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }}
            />
            <div className="tp-form-actions">
              <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-sm btn-primary">
                {t('common.save')}
              </button>
            </div>
          </form>
        ) : plan.description ? (
          <MarkdownView source={plan.description} />
        ) : (
          <p className="ui-help">{t('plan.descriptionEmpty')}</p>
        )}
      </section>

      <Milestones planId={plan.id} milestones={milestones} locale={locale} onChanged={onReload} />
    </div>
  );
}

function Milestones({
  planId,
  milestones,
  locale,
  onChanged,
}: {
  planId: string;
  milestones: PlanMilestone[];
  locale: string;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('trackPlanning');
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const next = milestones.find((m) => m.percent < 100);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const res = await api(`/api/track/plans/${planId}/milestones`, 'POST', { name: name.trim(), targetDate: date || null });
    if (!res.ok) return setError(t('common.saveError'));
    setName('');
    setDate('');
    setError(null);
    await onChanged();
  };
  const update = async (id: string, body: Record<string, unknown>) => {
    const res = await api(`/api/track/plan-milestones/${id}`, 'PATCH', body);
    if (!res.ok) setError(t('common.saveError'));
    await onChanged();
  };
  const remove = async (id: string) => {
    await api(`/api/track/plan-milestones/${id}`, 'DELETE');
    await onChanged();
  };

  return (
    <section className="tp-card" aria-labelledby="tp-ms-h">
      <h3 id="tp-ms-h" className="tp-card-title">
        {t('plan.milestones')}
      </h3>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {milestones.length === 0 ? (
        <p className="ui-help">{t('plan.milestonesEmpty')}</p>
      ) : (
        <ul className="tp-ms-list" role="list" data-testid="tp-milestones">
          {milestones.map((m) => (
            <li key={m.id} className={`tp-ms${m.id === next?.id ? ' tp-ms-next' : ''}${m.percent >= 100 && m.total > 0 ? ' tp-ms-done' : ''}`}>
              <span className="tp-ms-diamond" aria-hidden="true" />
              <input
                className="tp-inline-input"
                aria-label={t('plan.milestoneName')}
                defaultValue={m.name}
                maxLength={200}
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== m.name && void update(m.id, { name: e.target.value.trim() })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <input
                type="date"
                className="input tp-ms-date"
                aria-label={t('plan.milestoneDate')}
                value={m.target_date ?? ''}
                onChange={(e) => void update(m.id, { targetDate: e.target.value || null })}
              />
              <span className={`tp-ms-pct${m.target_date && m.target_date < today && m.percent < 100 ? ' tp-overdue' : ''}`}>
                {m.total ? `${m.percent}% · ${m.done}/${m.total}` : fmtDay(m.target_date, locale) || '—'}
              </span>
              <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={t('plan.deleteMilestone', { name: m.name })} onClick={() => void remove(m.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="tp-inline-form" onSubmit={add}>
        <input className="input" aria-label={t('plan.milestoneName')} placeholder={t('plan.addMilestone')} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} data-testid="tp-ms-name" />
        <input type="date" className="input tp-ms-date" aria-label={t('plan.milestoneDate')} value={date} onChange={(e) => setDate(e.target.value)} />
        <button type="submit" className="btn btn-sm" disabled={!name.trim()}>
          {t('common.add')}
        </button>
      </form>
    </section>
  );
}

function PlanIssues({
  plan,
  milestones,
  meta,
  onChanged,
}: {
  plan: PlanSummary;
  milestones: PlanMilestone[];
  meta: PlansMeta | null;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('trackPlanning');
  const [rows, setRows] = useState<PlanIssue[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PlanIssue[]>([]);
  const [title, setTitle] = useState('');
  const [team, setTeam] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ rows: PlanIssue[] }>(`/api/track/plans/${plan.id}/issues`);
    setFailed(!res.ok);
    setRows(res.ok ? res.data.rows : []);
  }, [plan.id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!q.trim()) return setFound([]);
    const id = setTimeout(async () => {
      const res = await api<{ rows: PlanIssue[] }>(`/api/track/plans/${plan.id}/issues?q=${encodeURIComponent(q)}`);
      setFound(res.ok ? res.data.rows : []);
    }, 200);
    return () => clearTimeout(id);
  }, [q, plan.id]);

  const teams = useMemo(() => (plan.teams.length ? plan.teams : (meta?.teams ?? [])), [plan.teams, meta?.teams]);
  useEffect(() => {
    if (!team && teams[0]) setTeam(teams[0].id);
  }, [team, teams]);

  const change = async (body: Record<string, unknown>) => {
    const res = await api<{ rows: PlanIssue[] }>(`/api/track/plans/${plan.id}/issues`, 'POST', body);
    if (!res.ok) return setError(t('common.saveError'));
    setError(null);
    setRows(res.data.rows);
    await onChanged();
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !team) return;
    const res = await api<{ id: string }>(`/api/track/projects/${team}/issues`, 'POST', { title: title.trim() });
    if (!res.ok) return setError(t('common.saveError'));
    setTitle('');
    await change({ action: 'add', issueIds: [res.data.id] });
  };

  const setMilestone = async (issueId: string, milestoneId: string) => {
    const res = await api(`/api/track/plans/${plan.id}/issues`, 'PATCH', { issueId, milestoneId: milestoneId || null });
    if (!res.ok) setError(t('common.saveError'));
    await load();
    await onChanged();
  };

  return (
    <div className="tp-issues">
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <form className="tp-inline-form" onSubmit={create}>
        <input
          className="input"
          aria-label={t('plan.newIssueTitle')}
          placeholder={t('plan.newIssueTitle')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={500}
          data-testid="tp-new-issue-title"
        />
        <select className="select tp-team-select" aria-label={t('plan.team')} value={team} onChange={(e) => setTeam(e.target.value)}>
          {teams.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!title.trim() || !team}>
          {t('plan.createIssue')}
        </button>
      </form>
      {teams.length === 0 && <p className="ui-help">{t('plan.noTeams')}</p>}

      <div className="tp-add-issues">
        <input
          type="search"
          className="input"
          aria-label={t('plan.addIssues')}
          placeholder={t('plan.searchIssues')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQ('')}
          data-testid="tp-issue-search"
        />
        {found.length > 0 && (
          <ul className="tp-found" role="list">
            {found.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  className="tp-found-btn"
                  onClick={async () => {
                    await change({ action: 'add', issueIds: [i.id] });
                    setQ('');
                  }}
                >
                  <span className="track-identifier">{i.identifier}</span> {i.title}
                  <span className="ui-help"> · {i.project_name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {rows === null ? (
        <LoadingRows />
      ) : failed ? (
        <EmptyState
          quiet
          title={t('common.loadError')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => void load()}>
              {t('common.retry')}
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState quiet title={t('plan.noIssues')} body={t('plan.noIssuesBody')} />
      ) : (
        <ul className="tp-issue-rows" role="list" data-testid="tp-plan-issues">
          {rows.map((i) => (
            <li key={i.id} className="tp-issue-row">
              <span className="tp-issue-status" style={{ color: i.status_color ?? undefined }} title={i.status_name ?? ''} aria-hidden="true">
                ●
              </span>
              <Link href={`/app/track/issues/${i.id}`} className="tp-issue-link">
                <span className="track-identifier">{i.identifier}</span>
                <span className="tp-issue-title">{i.title}</span>
              </Link>
              <span className="tp-issue-meta">{i.status_name}</span>
              <span className="tp-issue-meta">{i.assignee_name ?? ''}</span>
              {milestones.length > 0 && (
                <select
                  className="select tp-issue-ms"
                  aria-label={t('plan.milestoneFor', { id: i.identifier })}
                  value={i.plan_milestone_id ?? ''}
                  onChange={(e) => void setMilestone(i.id, e.target.value)}
                >
                  <option value="">{t('plan.milestoneNone')}</option>
                  {milestones.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="btn btn-sm btn-ghost btn-icon"
                aria-label={t('plan.removeFromPlan', { id: i.identifier })}
                onClick={() => void change({ action: 'remove', issueIds: [i.id] })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
