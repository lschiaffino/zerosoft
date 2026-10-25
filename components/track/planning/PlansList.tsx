'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import EmptyState from '@/components/ui/EmptyState';
import type { PlanSummary } from '@/lib/track-plans';
import { PLAN_STATUSES, type PlanStatus } from '@/lib/track-planning-schema';
import { api, fmtDay, HealthDot, LoadingRows, Modal, PlanStatusIcon, ProgressBar, personName, type Person } from './shared';

export interface PlansMeta {
  members: Person[];
  teams: Array<{ id: string; name: string; icon: string | null }>;
  initiatives: Array<{ id: string; name: string }>;
  me: string;
}

type Group = 'status' | 'lead' | 'none';

/**
 * Plans (los projects de Linear): lista agrupada por estado con salud, lead,
 * fecha objetivo y progreso; filtros por estado, lead y equipo en la URL.
 */
export default function PlansList() {
  const t = useTranslations('trackPlanning');
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const [rows, setRows] = useState<PlanSummary[] | null>(null);
  const [meta, setMeta] = useState<PlansMeta | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(sp.get('new') === '1');
  const wantsNew = sp.get('new') === '1';
  useEffect(() => {
    if (wantsNew) setCreating(true);
  }, [wantsNew]);
  const status = sp.get('status') ?? 'all';
  const lead = sp.get('lead') ?? '';
  const team = sp.get('team') ?? '';
  const group = (sp.get('group') as Group) || 'status';

  const load = useCallback(async () => {
    setFailed(false);
    const res = await api<{ rows: PlanSummary[] } & PlansMeta>('/api/track/plans?meta=1');
    if (!res.ok) {
      setFailed(true);
      setRows([]);
      return;
    }
    setRows(res.data.rows);
    setMeta({ members: res.data.members, teams: res.data.teams, initiatives: res.data.initiatives, me: res.data.me });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onNew = () => setCreating(true);
    window.addEventListener('zs:track-new-plan', onNew);
    return () => window.removeEventListener('zs:track-new-plan', onNew);
  }, []);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    next.delete('new');
    router.replace(`/app/track/plans${next.toString() ? `?${next}` : ''}`);
  };

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter((p) => {
      if (status === 'active' && !['planned', 'in_progress', 'paused'].includes(p.status)) return false;
      if (status !== 'all' && status !== 'active' && p.status !== status) return false;
      if (lead && p.lead_id !== lead) return false;
      if (team && !p.teams.some((x) => x.id === team)) return false;
      return true;
    });
  }, [rows, status, lead, team]);

  const groups = useMemo(() => {
    if (group === 'none') return [{ key: 'all', label: '', rows: filtered }];
    if (group === 'lead') {
      const keys = [...new Set(filtered.map((p) => p.lead_id ?? ''))];
      return keys.map((k) => ({
        key: k || 'none',
        label: k ? personName(meta?.members.find((m) => m.id === k)) || filtered.find((p) => p.lead_id === k)?.lead_name || '' : t('common.noLead'),
        rows: filtered.filter((p) => (p.lead_id ?? '') === k),
      }));
    }
    return PLAN_STATUSES.map((s) => ({ key: s, label: t(`status.${s}`), rows: filtered.filter((p) => p.status === s) })).filter((g) => g.rows.length);
  }, [filtered, group, meta, t]);

  return (
    <>
      <div className="tp-toolbar" role="toolbar" aria-label={t('plans.filters')}>
        <label className="sr-only" htmlFor="tp-filter-status">
          {t('plans.filterStatus')}
        </label>
        <select id="tp-filter-status" className="select select-sm" value={status} onChange={(e) => setParam('status', e.target.value)}>
          <option value="all">{t('plans.anyStatus')}</option>
          <option value="active">{t('plans.activeOnly')}</option>
          {PLAN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="tp-filter-lead">
          {t('plans.filterLead')}
        </label>
        <select id="tp-filter-lead" className="select select-sm" value={lead} onChange={(e) => setParam('lead', e.target.value)}>
          <option value="">{t('plans.anyLead')}</option>
          {meta?.members.map((m) => (
            <option key={m.id} value={m.id}>
              {personName(m)}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="tp-filter-team">
          {t('plans.filterTeam')}
        </label>
        <select id="tp-filter-team" className="select select-sm" value={team} onChange={(e) => setParam('team', e.target.value)}>
          <option value="">{t('plans.anyTeam')}</option>
          {meta?.teams.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="tp-group">
          {t('plans.groupBy')}
        </label>
        <select id="tp-group" className="select select-sm" value={group} onChange={(e) => setParam('group', e.target.value === 'status' ? '' : e.target.value)}>
          <option value="status">{t('plans.groupStatus')}</option>
          <option value="lead">{t('plans.groupLead')}</option>
          <option value="none">{t('plans.groupNone')}</option>
        </select>
        <Link href="/app/track/roadmap" className="btn btn-sm btn-ghost tp-toolbar-end">
          {t('plans.timeline')}
        </Link>
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
        <EmptyState
          title={t('plans.emptyTitle')}
          body={t('plans.emptyBody')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} data-testid="tp-new-plan-empty">
              {t('plans.new')}
            </button>
          }
          secondary={t('plans.linearNote')}
        />
      ) : filtered.length === 0 ? (
        <EmptyState quiet title={t('plans.noMatches')} />
      ) : (
        <div className="tp-list" data-testid="tp-plans-list">
          {groups.map((g) => (
            <section key={g.key} className="tp-group" aria-label={g.label || t('plans.title')}>
              {g.label && (
                <h2 className="tp-group-head">
                  {group === 'status' && <PlanStatusIcon status={g.key} />}
                  <span>{g.label}</span>
                  <span className="tp-group-count">{g.rows.length}</span>
                </h2>
              )}
              <ul className="tp-rows" role="list">
                {g.rows.map((p) => (
                  <li key={p.id} className="tp-row">
                    <Link href={`/app/track/plans/${p.id}`} className="tp-row-link">
                      <span className="tp-row-icon" aria-hidden="true">
                        {p.icon || <PlanStatusIcon status={p.status} />}
                      </span>
                      <span className="tp-row-name">{p.name}</span>
                      {p.summary && <span className="tp-row-summary">{p.summary}</span>}
                    </Link>
                    <span className="tp-row-cell tp-row-health">
                      <HealthDot health={p.health} label={t(`health.${p.health}`)} />
                    </span>
                    <span className="tp-row-cell tp-row-lead">{p.lead_name || p.lead_email || t('common.noLead')}</span>
                    <span className="tp-row-cell tp-row-date">{p.target_date ? fmtDay(p.target_date, locale) : ''}</span>
                    <span className="tp-row-cell tp-row-progress">
                      <ProgressBar percent={p.progress.percent} label={t('plan.progress')} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <NewPlanModal
        open={creating}
        meta={meta}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          router.push(`/app/track/plans/${id}`);
        }}
      />
    </>
  );
}

export function NewPlanModal({
  open,
  meta,
  onClose,
  onCreated,
  initiativeId,
}: {
  open: boolean;
  meta: PlansMeta | null;
  onClose: () => void;
  onCreated: (id: string) => void;
  initiativeId?: string;
}) {
  const t = useTranslations('trackPlanning');
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [status, setStatus] = useState<PlanStatus>('planned');
  const [lead, setLead] = useState('');
  const [team, setTeam] = useState('');
  const [start, setStart] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setSummary('');
      setStatus('planned');
      setLead(meta?.me ?? '');
      setTeam('');
      setStart('');
      setTarget('');
      setError(null);
    }
  }, [open, meta?.me]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await api<{ id: string; error?: string }>('/api/track/plans', 'POST', {
      name: name.trim(),
      summary: summary.trim() || undefined,
      status,
      leadId: lead || null,
      teamIds: team ? [team] : [],
      startDate: start || null,
      targetDate: target || null,
      initiativeIds: initiativeId ? [initiativeId] : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error === 'invalid_range' ? t('plan.invalidRange') : t('common.saveError'));
      return;
    }
    onCreated(res.data.id);
  };

  return (
    <Modal
      open={open}
      title={t('plans.new')}
      onClose={onClose}
      testId="tp-new-plan-modal"
      footer={
        <>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="tp-new-plan-form" className="btn btn-sm btn-primary" disabled={!name.trim() || busy} aria-busy={busy}>
            {t('plans.create')}
          </button>
        </>
      }
    >
      <form id="tp-new-plan-form" className="ui-fields" onSubmit={submit}>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        <div className="ui-field">
          <label className="label" htmlFor="tp-plan-name">
            {t('plans.nameLabel')}
          </label>
          <input
            id="tp-plan-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('plans.namePlaceholder')}
            maxLength={200}
            autoFocus
            required
          />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="tp-plan-summary">
            {t('plans.summaryLabel')} <span className="ui-optional">{t('common.optional')}</span>
          </label>
          <input
            id="tp-plan-summary"
            className="input"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={t('plans.summaryPlaceholder')}
            maxLength={255}
          />
        </div>
        <div className="tp-form-grid">
          <div className="ui-field">
            <label className="label" htmlFor="tp-plan-status">
              {t('plan.status')}
            </label>
            <select id="tp-plan-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as PlanStatus)}>
              {PLAN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="tp-plan-lead">
              {t('plan.lead')}
            </label>
            <select id="tp-plan-lead" className="select" value={lead} onChange={(e) => setLead(e.target.value)}>
              <option value="">{t('common.noLead')}</option>
              {meta?.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {personName(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="tp-plan-team">
              {t('plan.team')}
            </label>
            <select id="tp-plan-team" className="select" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">{t('common.none')}</option>
              {meta?.teams.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="tp-plan-start">
              {t('plan.startDate')}
            </label>
            <input id="tp-plan-start" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="tp-plan-target">
              {t('plan.targetDate')}
            </label>
            <input id="tp-plan-target" type="date" className="input" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
        </div>
      </form>
    </Modal>
  );
}
