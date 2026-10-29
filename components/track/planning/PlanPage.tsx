'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import { MarkdownView } from '@/components/track/MarkdownView';
import RichEditor from '@/components/track/RichEditor';
import KeyPicker from '@/components/track/KeyPicker';
import { PriorityIcon, StatusDot } from '@/components/track/InlineEditors';
import TrackIcon from '@/components/track/TrackIcon';
import { issueHref } from '@/components/track/trackCommands';
import { DateChip } from './pickers';
import type { PlanIssue, PlanMilestone, PlanSummary } from '@/lib/track-plans';
import { PLAN_PRIORITIES, PLAN_STATUSES } from '@/lib/track-planning-schema';
import { api, fmtDay, HealthDot, LoadingRows, PlanStatusIcon, ProgressBar, personName } from './shared';
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
  // "Write update" lleva a Updates con el foco en el texto.
  const [focusCompose, setFocusCompose] = useState(false);

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
    // Cambiar de pestaña no mueve el scroll (si no, el título queda bajo la banda).
    router.replace(`/app/track/projects/${planId}${q.toString() ? `?${q}` : ''}`, { scroll: false });
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
        <PlanChips plan={plan} meta={meta} onPatch={patch} locale={locale} />
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
          <Overview
            data={data}
            locale={locale}
            onPatch={patch}
            onReload={load}
            onWrite={() => {
              setFocusCompose(true);
              selectTab('updates');
            }}
          />
        )}
        {tab === 'issues' && <PlanIssues plan={plan} milestones={data.milestones} meta={meta} onChanged={load} />}
        {tab === 'updates' && <PlanUpdates plan={plan} meta={meta} composeOpen={focusCompose || sp.get('new') === '1'} onPosted={load} />}
      </div>

      <aside className="tp-plan-side" aria-label={t('plan.properties')}>
        <Properties plan={plan} onPatch={patch} following={data.following} onFollow={follow} />
        <button type="button" className="btn btn-sm btn-danger tp-danger-link" onClick={() => setConfirmDelete(true)} data-testid="tp-plan-delete">
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

/** Una lista que se tilda o destilda (miembros, teams, iniciativas). */
function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/**
 * Propiedades del proyecto como chips bajo el título (como Linear): estado,
 * prioridad, lead, miembros, inicio → objetivo, teams e iniciativas. Cada
 * chip abre un picker con filtro tipeado, flechas y Enter.
 */
function PlanChips({
  plan,
  meta,
  onPatch,
  locale,
}: {
  plan: PlanSummary;
  meta: PlansMeta | null;
  onPatch: (b: Record<string, unknown>) => Promise<boolean>;
  locale: string;
}) {
  const t = useTranslations('trackPlanning');
  const tp = useTranslations('trackPlanning.pickers');
  const members = meta?.members ?? [];
  const memberNames = plan.member_ids.map((id) => personName(members.find((m) => m.id === id))).filter(Boolean);
  const initials = (s: string) => (s.trim()[0] ?? '?').toUpperCase();
  return (
    <div className="tp-chips" role="group" aria-label={t('plan.properties')} data-testid="tp-chips">
      <KeyPicker
        ariaLabel={t('plan.status')}
        className="tp-chip"
        testId="tp-prop-status"
        value={plan.status}
        options={PLAN_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`), icon: <PlanStatusIcon status={s} /> }))}
        onSelect={(v) => void onPatch({ status: v })}
        trigger={
          <>
            <PlanStatusIcon status={plan.status} />
            <span className="track-inline-text">{t(`status.${plan.status}`)}</span>
          </>
        }
      />
      <KeyPicker
        ariaLabel={t('plan.priority')}
        className="tp-chip"
        testId="tp-prop-priority"
        value={plan.priority}
        options={PLAN_PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`), icon: <PriorityIcon priority={p} /> }))}
        onSelect={(v) => void onPatch({ priority: v })}
        trigger={
          <>
            <PriorityIcon priority={plan.priority} />
            <span className="track-inline-text">{t(`priority.${plan.priority}`)}</span>
          </>
        }
      />
      <KeyPicker
        ariaLabel={t('plan.lead')}
        className={`tp-chip${plan.lead_id ? '' : ' is-empty'}`}
        testId="tp-prop-lead"
        value={plan.lead_id ?? ''}
        options={[
          { value: '', label: t('common.noLead'), icon: <span className="track-avatar track-avatar-empty" aria-hidden /> },
          ...members.map((m) => ({ value: m.id, label: personName(m), keywords: m.email, icon: <span className="track-avatar">{initials(personName(m))}</span> })),
        ]}
        onSelect={(v) => void onPatch({ leadId: v || null })}
        trigger={
          <>
            {plan.lead_id ? (
              <span className="track-avatar">{initials(plan.lead_name || plan.lead_email || '?')}</span>
            ) : (
              <TrackIcon name="user" size={13} />
            )}
            <span className="track-inline-text">{plan.lead_id ? plan.lead_name || plan.lead_email : t('plan.lead')}</span>
          </>
        }
      />
      <KeyPicker
        ariaLabel={t('plan.members')}
        multi
        className={`tp-chip${memberNames.length ? '' : ' is-empty'}`}
        testId="tp-prop-members"
        value={plan.member_ids}
        options={members.map((m) => ({ value: m.id, label: personName(m), keywords: m.email, icon: <span className="track-avatar">{initials(personName(m))}</span> }))}
        onSelect={(id) => void onPatch({ memberIds: toggleId(plan.member_ids, id) })}
        trigger={
          <>
            <TrackIcon name="users" size={13} />
            <span className="track-inline-text">{memberNames.length ? (memberNames.length > 2 ? tp('people', { count: memberNames.length }) : memberNames.join(', ')) : t('plan.members')}</span>
          </>
        }
      />
      <span className="tp-chip-range">
        <DateChip
          value={plan.start_date}
          onChange={(d) => void onPatch({ startDate: d })}
          label={t('plan.startDate')}
          emptyLabel={t('plan.startDate')}
          locale={locale}
          icon={<TrackIcon name="calendar" size={13} />}
          testId="tp-prop-start"
        />
        <span className="tp-chip-arrow" aria-hidden="true">
          →
        </span>
        <DateChip
          value={plan.target_date}
          onChange={(d) => void onPatch({ targetDate: d })}
          label={t('plan.targetDate')}
          emptyLabel={t('plan.targetDate')}
          locale={locale}
          icon={<TrackIcon name="flag" size={13} />}
          testId="tp-prop-target"
        />
      </span>
      <KeyPicker
        ariaLabel={t('plan.teams')}
        multi
        className={`tp-chip${plan.teams.length ? '' : ' is-empty'}`}
        testId="tp-prop-teams"
        value={plan.teams.map((x) => x.id)}
        options={(meta?.teams ?? []).map((x) => ({ value: x.id, label: x.name, icon: <TrackIcon name="team" size={13} /> }))}
        onSelect={(id) => void onPatch({ teamIds: toggleId(plan.teams.map((x) => x.id), id) })}
        trigger={
          <>
            <TrackIcon name="team" size={13} />
            <span className="track-inline-text">{plan.teams.length ? plan.teams.map((x) => x.name).join(', ') : t('plan.teams')}</span>
          </>
        }
      />
      <KeyPicker
        ariaLabel={t('plan.initiatives')}
        multi
        className={`tp-chip${plan.initiatives.length ? '' : ' is-empty'}`}
        testId="tp-prop-initiatives"
        value={plan.initiatives.map((x) => x.id)}
        options={(meta?.initiatives ?? []).map((x) => ({ value: x.id, label: x.name, icon: <TrackIcon name="plans" size={13} /> }))}
        emptyLabel={tp('noInitiatives')}
        onSelect={(id) => void onPatch({ initiativeIds: toggleId(plan.initiatives.map((x) => x.id), id) })}
        trigger={
          <>
            <TrackIcon name="plans" size={13} />
            <span className="track-inline-text">{plan.initiatives.length ? plan.initiatives.map((x) => x.name).join(', ') : t('plan.initiatives')}</span>
          </>
        }
      />
      <PlanLabelsChip plan={plan} onPatch={onPatch} />
    </div>
  );
}

/** Labels del project (como Linear): varios, con filtro tipeado y "Crear «…»". */
function PlanLabelsChip({ plan, onPatch }: { plan: PlanSummary; onPatch: (b: Record<string, unknown>) => Promise<boolean> }) {
  const t = useTranslations('trackPlanning');
  const [all, setAll] = useState<Array<{ id: string; name: string; color: string }>>([]);
  const load = useCallback(async () => {
    const res = await api<{ rows: Array<{ id: string; name: string; color: string }> }>('/api/track/labels');
    if (res.ok) setAll(res.data.rows);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const ids = (plan.labels ?? []).map((l) => l.id);
  const dot = (color: string) => <span className="track-label-dot" style={{ background: color }} aria-hidden />;
  return (
    <KeyPicker
      ariaLabel={t('plan.labels')}
      multi
      className={`tp-chip${ids.length ? '' : ' is-empty'}`}
      testId="tp-prop-labels"
      value={ids}
      options={all.map((l) => ({ value: l.id, label: l.name, icon: dot(l.color) }))}
      onSelect={(id) => void onPatch({ labelIds: toggleId(ids, id) })}
      createLabel={(q) => t('plan.createLabel', { name: q })}
      onCreate={async (q) => {
        const res = await api<{ id: string; name: string; color: string }>('/api/track/labels', 'POST', { name: q });
        if (!res.ok) return;
        setAll((cur) => [...cur, res.data]);
        await onPatch({ labelIds: [...ids, res.data.id] });
      }}
      trigger={
        <>
          {ids.length ? <span className="tp-chip-dots">{(plan.labels ?? []).slice(0, 3).map((l) => <span key={l.id}>{dot(l.color)}</span>)}</span> : <TrackIcon name="tag" size={13} />}
          <span className="track-inline-text">{ids.length ? (plan.labels ?? []).map((l) => l.name).join(', ') : t('plan.labels')}</span>
        </>
      }
    />
  );
}

/** Panel lateral: salud, recordatorios del update y seguir. */
function Properties({
  plan,
  onPatch,
  following,
  onFollow,
}: {
  plan: PlanSummary;
  onPatch: (b: Record<string, unknown>) => Promise<boolean>;
  following: boolean;
  onFollow: (v: boolean) => void;
}) {
  const t = useTranslations('trackPlanning');
  return (
    <dl className="tp-props">
      <dt>{t('plan.health')}</dt>
      <dd>
        <HealthDot health={plan.health} label={t(`health.${plan.health}`)} />
      </dd>
      <dt>{t('plan.reminders')}</dt>
      <dd className="tp-prop-pair">
        <KeyPicker
          ariaLabel={t('plan.reminders')}
          className="tp-chip"
          testId="tp-prop-cadence"
          value={plan.update_cadence}
          options={(['weekly', 'biweekly', 'off'] as const).map((c) => ({ value: c, label: t(`plan.cadence.${c}`) }))}
          onSelect={(v) => void onPatch({ updateCadence: v })}
          trigger={<span className="track-inline-text">{t(`plan.cadence.${plan.update_cadence}`)}</span>}
        />
        {plan.update_cadence !== 'off' && (
          <KeyPicker
            ariaLabel={t('plan.reminderDay')}
            className="tp-chip"
            value={String(plan.update_day)}
            options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: t(`plan.days.${d}`) }))}
            onSelect={(v) => void onPatch({ updateDay: Number(v) })}
            trigger={<span className="track-inline-text">{t(`plan.days.${plan.update_day}`)}</span>}
          />
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
  const [draft, setDraft] = useState(plan.description);
  const saved = useRef(plan.description);
  const draftRef = useRef(plan.description);
  const timer = useRef<number | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (draftRef.current === saved.current) return;
    const next = draftRef.current;
    if (await onPatch({ description: next })) saved.current = next;
  }, [onPatch]);
  const changeDraft = (md: string) => {
    draftRef.current = md;
    setDraft(md);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 900);
  };
  // Al salir del Overview con cambios sin guardar, se guardan.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);
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

      <section className="tp-card tp-desc" aria-labelledby="tp-desc-h">
        <h3 id="tp-desc-h" className="tp-card-title">
          {t('plan.description')}
        </h3>
        {/* Siempre editable, como en Linear: se guarda al dejar de tipear y al salir. */}
        <RichEditor
          key={plan.id}
          value={draft}
          onChange={changeDraft}
          onBlur={() => void flush()}
          ariaLabel={t('plan.description')}
          placeholder={t('plan.descriptionPlaceholder')}
          testId="tp-description"
          className="tp-desc-editor"
        />
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
              <DateChip
                value={m.target_date}
                onChange={(d) => void update(m.id, { targetDate: d })}
                label={t('plan.milestoneDate')}
                emptyLabel={t('common.noDate')}
                locale={locale}
                className="tp-ms-date"
              />
              <span className={`tp-ms-pct${m.target_date && m.target_date < today && m.percent < 100 ? ' tp-overdue' : ''}`}>
                {m.total ? `${m.percent}% · ${m.done}/${m.total}` : '0%'}
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
        <DateChip value={date || null} onChange={(d) => setDate(d ?? '')} label={t('plan.milestoneDate')} emptyLabel={t('plan.milestoneDate')} locale={locale} className="tp-ms-date" />
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
        <KeyPicker
          ariaLabel={t('plan.team')}
          className="tp-chip tp-team-select"
          testId="tp-new-issue-team"
          value={team}
          options={teams.map((x) => ({ value: x.id, label: x.name, icon: <TrackIcon name="team" size={13} /> }))}
          onSelect={setTeam}
          trigger={
            <>
              <TrackIcon name="team" size={13} />
              <span className="track-inline-text">{teams.find((x) => x.id === team)?.name ?? t('plan.team')}</span>
            </>
          }
        />
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
              <span className="tp-issue-status" title={i.status_name ?? ''}>
                <StatusDot color={i.status_color} category={i.status_category} />
              </span>
              <Link href={issueHref(i)} className="tp-issue-link">
                <span className="track-identifier">{i.identifier}</span>
                <span className="tp-issue-title">{i.title}</span>
              </Link>
              <span className="tp-issue-meta">{i.status_name}</span>
              <span className="tp-issue-meta">{i.assignee_name ?? ''}</span>
              {milestones.length > 0 && (
                <KeyPicker
                  ariaLabel={t('plan.milestoneFor', { id: i.identifier })}
                  className="tp-chip tp-issue-ms"
                  value={i.plan_milestone_id ?? ''}
                  options={[
                    { value: '', label: t('plan.milestoneNone') },
                    ...milestones.map((m) => ({ value: m.id, label: m.name, icon: <span className="tp-ms-diamond" aria-hidden="true" /> })),
                  ]}
                  onSelect={(v) => void setMilestone(i.id, v)}
                  trigger={
                    <>
                      <span className="tp-ms-diamond" aria-hidden="true" />
                      <span className="track-inline-text">{milestones.find((m) => m.id === i.plan_milestone_id)?.name ?? t('plan.milestoneNone')}</span>
                    </>
                  }
                />
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
