'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import EmptyState from '@/components/ui/EmptyState';
import type { PlanSummary } from '@/lib/track-plans';
import { PLAN_STATUSES, type PlanStatus } from '@/lib/track-planning-schema';
import { api, fmtDay, HealthDot, LoadingRows, Modal, PlanStatusIcon, ProgressBar, personName, type Person } from './shared';
import { projectPath } from '@/lib/track-routes';
import KeyPicker, { type KeyPickerHandle } from '@/components/track/KeyPicker';
import { isTypingTarget } from '@/components/track/trackCommands';
import TrackIcon from '@/components/track/TrackIcon';
import { DateChip } from './pickers';

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

  // F como en las listas de issues: elegir la propiedad y después el valor, todo con teclado.
  const filterRef = useRef<KeyPickerHandle>(null);
  const statusRef = useRef<KeyPickerHandle>(null);
  const leadRef = useRef<KeyPickerHandle>(null);
  const teamRef = useRef<KeyPickerHandle>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat || isTypingTarget(e.target)) return;
      if (document.querySelector('dialog[open], [role="dialog"], [role="menu"], .cmdk, .track-keypicker')) return;
      e.preventDefault();
      filterRef.current?.open();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    next.delete('new');
    router.replace(`/app/track/projects${next.toString() ? `?${next}` : ''}`);
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
        {/* Filtros como chips con menú tipeado (sin <select>), como el Filter de Linear. */}
        <KeyPicker
          ref={filterRef}
          ariaLabel={t('plans.filters')}
          className="btn btn-ghost btn-sm tp-filter-btn"
          testId="tp-filter"
          options={[
            { value: 'status', label: t('plans.filterStatus'), icon: <PlanStatusIcon status="in_progress" /> },
            { value: 'lead', label: t('plans.filterLead'), icon: <TrackIcon name="user" size={13} /> },
            { value: 'team', label: t('plans.filterTeam'), icon: <TrackIcon name="team" size={13} /> },
          ]}
          onSelect={(v) => {
            const next = v === 'status' ? statusRef : v === 'lead' ? leadRef : teamRef;
            // En el mismo tick (no se pierden letras tipeadas enseguida): el de valores toma el foco al montarse.
            next.current?.open();
          }}
          trigger={
            <>
              <TrackIcon name="filter" size={12} />
              <span>{t('plans.filters')}</span>
              <kbd className="kbd" aria-hidden>
                f
              </kbd>
            </>
          }
        />
        <KeyPicker
          ref={statusRef}
          ariaLabel={t('plans.filterStatus')}
          className={`tp-chip${status === 'all' ? ' is-empty' : ''}`}
          testId="tp-filter-status"
          value={status}
          options={[
            { value: 'all', label: t('plans.anyStatus') },
            { value: 'active', label: t('plans.activeOnly') },
            ...PLAN_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`), icon: <PlanStatusIcon status={s} /> })),
          ]}
          onSelect={(v) => setParam('status', v)}
          trigger={
            <>
              {status !== 'all' && status !== 'active' && <PlanStatusIcon status={status as PlanStatus} />}
              <span className="track-inline-text">
                {status === 'all' ? t('plans.anyStatus') : status === 'active' ? t('plans.activeOnly') : t(`status.${status}`)}
              </span>
            </>
          }
        />
        <KeyPicker
          ref={leadRef}
          ariaLabel={t('plans.filterLead')}
          className={`tp-chip${lead ? '' : ' is-empty'}`}
          testId="tp-filter-lead"
          value={lead}
          options={[{ value: '', label: t('plans.anyLead') }, ...(meta?.members ?? []).map((m) => ({ value: m.id, label: personName(m), keywords: m.email ?? '' }))]}
          onSelect={(v) => setParam('lead', v)}
          trigger={
            <span className="track-inline-text">{lead ? personName(meta?.members.find((m) => m.id === lead)) : t('plans.anyLead')}</span>
          }
        />
        <KeyPicker
          ref={teamRef}
          ariaLabel={t('plans.filterTeam')}
          className={`tp-chip${team ? '' : ' is-empty'}`}
          testId="tp-filter-team"
          value={team}
          options={[{ value: '', label: t('plans.anyTeam') }, ...(meta?.teams ?? []).map((m) => ({ value: m.id, label: m.name }))]}
          onSelect={(v) => setParam('team', v)}
          trigger={<span className="track-inline-text">{team ? (meta?.teams.find((m) => m.id === team)?.name ?? '') : t('plans.anyTeam')}</span>}
        />
        <span className="tp-toolbar-end">
          {/* Display: agrupación (y la vista de línea de tiempo), como el botón Display de Linear. */}
          <KeyPicker
            ariaLabel={t('plans.groupBy')}
            className="btn btn-ghost btn-sm track-display-btn"
            testId="tp-group"
            value={group}
            options={[
              { value: 'status', label: t('plans.groupStatus') },
              { value: 'lead', label: t('plans.groupLead') },
              { value: 'none', label: t('plans.groupNone') },
            ]}
            onSelect={(v) => setParam('group', v === 'status' ? '' : v)}
            trigger={
              <>
                <TrackIcon name="settings" size={12} />
                <span>{t('plans.display')}</span>
              </>
            }
          />
          <Link href="/app/track/roadmap" className="btn btn-sm btn-ghost">
            {t('plans.timeline')}
          </Link>
        </span>
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
                    <Link href={projectPath(p.id)} className="tp-row-link">
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
          router.push(projectPath(id));
        }}
      />
    </>
  );
}

// Borrador del project nuevo: Esc o Cancelar lo guardan (como Linear) y vuelve al abrir.
let planDraft: { name: string; summary: string } | null = null;

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
  const locale = useLocale();
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
      setName(planDraft?.name ?? '');
      setSummary(planDraft?.summary ?? '');
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
    planDraft = null;
    onCreated(res.data.id);
  };

  const closeKeeping = () => {
    planDraft = name.trim() || summary.trim() ? { name, summary } : null;
    onClose();
  };

  return (
    <Modal
      open={open}
      title={t('plans.new')}
      onClose={closeKeeping}
      testId="tp-new-plan-modal"
      footer={
        <>
          <button type="button" className="btn btn-sm" onClick={closeKeeping}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="tp-new-plan-form" className="btn btn-sm btn-primary" disabled={!name.trim() || busy} aria-busy={busy}>
            {t('plans.create')}
          </button>
        </>
      }
    >
      <form
        id="tp-new-plan-form"
        className="ui-fields"
        onSubmit={submit}
        onKeyDown={(e) => {
          // ⌘↵ crea desde cualquier campo, como el composer de issues.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      >
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
        {/* Propiedades como chips (como el "New project" de Linear): sin selects ni fechas mm/dd/yyyy. */}
        <div className="tp-new-plan-chips" role="group" aria-label={t('plan.properties')}>
          <KeyPicker
            ariaLabel={t('plan.status')}
            className="tp-chip"
            testId="tp-new-status"
            value={status}
            options={PLAN_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`), icon: <PlanStatusIcon status={s} /> }))}
            onSelect={(v) => setStatus(v as PlanStatus)}
            trigger={
              <>
                <PlanStatusIcon status={status} />
                <span className="track-inline-text">{t(`status.${status}`)}</span>
              </>
            }
          />
          <KeyPicker
            ariaLabel={t('plan.lead')}
            className={`tp-chip${lead ? '' : ' is-empty'}`}
            testId="tp-new-lead"
            value={lead}
            options={[
              { value: '', label: t('common.noLead'), icon: <span className="track-avatar track-avatar-empty" aria-hidden /> },
              ...(meta?.members ?? []).map((m) => ({
                value: m.id,
                label: personName(m),
                keywords: m.email,
                icon: <span className="track-avatar">{personName(m).charAt(0).toUpperCase()}</span>,
              })),
            ]}
            onSelect={(v) => setLead(v)}
            trigger={
              <>
                <TrackIcon name="user" size={13} />
                <span className="track-inline-text">{lead ? personName(meta?.members.find((m) => m.id === lead)) : t('plan.lead')}</span>
              </>
            }
          />
          <KeyPicker
            ariaLabel={t('plan.team')}
            className={`tp-chip${team ? '' : ' is-empty'}`}
            testId="tp-new-team"
            value={team}
            options={[{ value: '', label: t('common.none') }, ...(meta?.teams ?? []).map((m) => ({ value: m.id, label: m.name }))]}
            onSelect={(v) => setTeam(v)}
            trigger={
              <>
                <TrackIcon name="team" size={13} />
                <span className="track-inline-text">{team ? (meta?.teams.find((m) => m.id === team)?.name ?? '') : t('plan.team')}</span>
              </>
            }
          />
          <DateChip
            value={start || null}
            onChange={(d) => setStart(d ?? '')}
            label={t('plan.startDate')}
            emptyLabel={t('plan.startDate')}
            locale={locale}
            icon={<TrackIcon name="calendar" size={13} />}
            testId="tp-new-start"
          />
          <DateChip
            value={target || null}
            onChange={(d) => setTarget(d ?? '')}
            label={t('plan.targetDate')}
            emptyLabel={t('plan.targetDate')}
            locale={locale}
            icon={<TrackIcon name="flag" size={13} />}
            testId="tp-new-target"
          />
        </div>
      </form>
    </Modal>
  );
}
