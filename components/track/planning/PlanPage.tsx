'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import { MarkdownView } from '@/components/track/MarkdownView';
import RichEditor from '@/components/track/RichEditor';
import KeyPicker from '@/components/track/KeyPicker';
import { PriorityIcon, TrackToast } from '@/components/track/InlineEditors';
import TrackIcon from '@/components/track/TrackIcon';
import TrackIssueList from '@/components/track/TrackIssueList';
import { TRACK_ISSUES_CHANGED } from '@/components/track/trackEvents';
import { pushUndo } from '@/components/track/trackUndo';
import { DateChip } from './pickers';
import { LineChart } from './charts';
import type { PlanMilestone, PlanSummary } from '@/lib/track-plans';
import type { PlanProgressSeries } from '@/lib/track-plan-metrics';
import { PLAN_PRIORITIES, PLAN_STATUSES } from '@/lib/track-planning-schema';
import { PLAN_ISSUE_GROUPS } from '@/lib/track-views';
import { api, copyText, fmtDay, fmtInstantDay, HealthDot, initialsOf, LoadingRows, PlanStatusIcon, personName } from './shared';
import type { PlansMeta } from './PlansList';
import PlanUpdates, { updateAuthor } from './PlanUpdates';
import { SaveTemplateDialog } from './PlanTemplates';
import TitleInput from '@/components/ui/TitleInput';

type Tab = 'overview' | 'issues' | 'updates';

interface PlanResponse {
  plan: PlanSummary;
  milestones: PlanMilestone[];
  following: boolean;
  series?: PlanProgressSeries;
}

interface LatestUpdate {
  health: string;
  body: string;
  user_name: string | null;
  user_email: string;
  meta?: string | null;
  created_at: string;
}

function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Página del project como en Linear: ícono y título, resumen, una fila de
 * propiedades (chips), pestañas Overview, Issues y Updates, y a la derecha el
 * resumen (propiedades, progreso, milestones, salud del último update). El
 * menú ⋯ tiene seguir, copiar link y borrar (con confirmación).
 */
export default function PlanPage({ planId }: { planId: string }) {
  const t = useTranslations('trackPlanning');
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const [data, setData] = useState<PlanResponse | null>(null);
  const [meta, setMeta] = useState<PlansMeta | null>(null);
  const [userId, setUserId] = useState('');
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [tab, setTab] = useState<Tab>(() => {
    const v = sp.get('tab');
    return v === 'issues' || v === 'updates' ? v : 'overview';
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [name, setName] = useState('');
  const [issueCount, setIssueCount] = useState<number | null>(null);
  // Esc descarta: el blur que le sigue no guarda (leería el borrador de antes de restaurarlo).
  const cancelled = useRef(false);
  const unlessCancelled = (fn: () => void) => () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    fn();
  };
  const [summary, setSummary] = useState('');
  // "Write update" lleva a Updates con el foco en el texto.
  const [focusCompose, setFocusCompose] = useState(false);
  const [latest, setLatest] = useState<LatestUpdate | null | undefined>(undefined);

  const load = useCallback(async () => {
    const [res, m] = await Promise.all([
      api<PlanResponse>(`/api/track/plans/${planId}?series=1&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}`),
      api<PlansMeta & { rows: unknown[] }>('/api/track/plans?meta=only'),
    ]);
    if (res.status === 404) return setState('missing');
    if (!res.ok) return setState('error');
    setData(res.data);
    setName(res.data.plan.name);
    setSummary(res.data.plan.summary);
    if (m.ok) {
      setMeta({ members: m.data.members, teams: m.data.teams, initiatives: m.data.initiatives, me: m.data.me });
      setUserId(m.data.me);
    }
    setState('ok');
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Los issues mueven el progreso: al arrastrar o editar en la lista, se recarga el resumen.
  useEffect(() => {
    const onChanged = () => void load();
    window.addEventListener(TRACK_ISSUES_CHANGED, onChanged);
    return () => window.removeEventListener(TRACK_ISSUES_CHANGED, onChanged);
  }, [load]);

  const lastUpdateAt = data?.plan.last_update_at;
  useEffect(() => {
    let alive = true;
    void api<{ rows: LatestUpdate[] }>(`/api/track/plans/${planId}/updates`).then((r) => alive && setLatest(r.ok ? (r.data.rows[0] ?? null) : null));
    return () => {
      alive = false;
    };
  }, [planId, lastUpdateAt]);

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

  // Archivar como Linear: al instante, con Deshacer en el toast (y ⌘Z); se desarchiva desde el ⋯ o el aviso.
  const archive = async (archived: boolean) => {
    if (!(await patch({ archived }))) return;
    const planName = data?.plan.name ?? '';
    pushUndo(
      archived ? t('plan.archivedToast', { name: planName }) : t('plan.unarchivedToast', { name: planName }),
      async () => {
        await patch({ archived: !archived });
      },
      async () => {
        await patch({ archived });
      },
    );
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
  const enter = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') (e.target as HTMLElement).blur();
    if (e.key === 'Escape') {
      cancelled.current = true;
      setName(plan.name);
      setSummary(plan.summary);
      (e.target as HTMLElement).blur();
    }
  };
  const writeUpdate = () => {
    setFocusCompose(true);
    selectTab('updates');
  };

  return (
    <div className={`tp-plan${tab === 'issues' ? ' tp-plan-wide' : ''}`} data-testid="tp-plan-page">
      <div className="tp-plan-main">
        <div className="tp-plan-topbar">
          <nav className="tp-crumbs" aria-label={t('plans.title')}>
            <Link href="/app/track/projects">{t('plans.title')}</Link>
            <span aria-hidden="true">›</span>
            <span className="tp-crumb-current">{plan.name}</span>
          </nav>
          <KeyPicker
            ariaLabel={t('plan.more')}
            className="btn btn-ghost btn-sm btn-icon tp-more"
            testId="tp-plan-more"
            options={[
              { value: 'follow', label: data.following ? t('plan.unfollow') : t('plan.followAction'), icon: <TrackIcon name="bell" size={13} /> },
              { value: 'update', label: t('plan.writeUpdate'), icon: <TrackIcon name="pencil" size={13} /> },
              { value: 'copy', label: t('common.copyLink'), icon: <TrackIcon name="link" size={13} /> },
              { value: 'template', label: t('templates.saveAction'), icon: <TrackIcon name="plans" size={13} /> },
              plan.archived_at
                ? { value: 'unarchive', label: t('plan.unarchive'), icon: <TrackIcon name="archive" size={13} /> }
                : { value: 'archive', label: t('plan.archive'), icon: <TrackIcon name="archive" size={13} /> },
              { value: 'delete', label: t('plan.delete'), icon: <TrackIcon name="close" size={13} /> },
            ]}
            onSelect={(v) => {
              if (v === 'follow') void follow(!data.following);
              else if (v === 'update') writeUpdate();
              else if (v === 'copy') void copyText(window.location.href.split('?')[0]).then((ok) => setNotice(ok ? t('common.linkCopied') : null));
              else if (v === 'template') setSavingTemplate(true);
              else if (v === 'archive' || v === 'unarchive') void archive(v === 'archive');
              else if (v === 'delete') setConfirmDelete(true);
            }}
            trigger={<TrackIcon name="more" size={14} />}
          />
        </div>
        {plan.archived_at && (
          <div className="tp-archived-note" role="status" data-testid="tp-archived-note">
            <TrackIcon name="archive" size={13} />
            <span>{t('plan.archivedNote', { date: fmtInstantDay(plan.archived_at, locale) })}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void archive(false)} data-testid="tp-unarchive">
              {t('plan.unarchive')}
            </button>
          </div>
        )}
        <div className="tp-plan-head">
          <PlanIconPicker plan={plan} onPatch={patch} />
          <TitleInput
            className="tp-title-input"
            aria-label={t('plans.nameLabel')}
            value={name}
            maxLength={200}
            onValueChange={setName}
            onBlur={unlessCancelled(() => void saveName())}
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
          onBlur={unlessCancelled(() => summary !== plan.summary && void patch({ summary }))}
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
              {k === 'issues' && <span className="ui-tab-count">{issueCount ?? plan.progress.total}</span>}
            </button>
          ))}
        </div>

        {tab === 'overview' && <Overview data={data} latest={latest} locale={locale} onPatch={patch} onReload={load} onWrite={writeUpdate} />}
        {tab === 'issues' && (
          <TrackIssueList
            scope={{ planId: plan.id }}
            viewKey={`plan:${plan.id}`}
            userId={userId}
            groups={PLAN_ISSUE_GROUPS}
            defaults={PLAN_LIST_DEFAULTS}
            createTeamIds={plan.teams.map((x) => x.id)}
            createDefaults={{ planId: plan.id, planName: plan.name }}
            milestones={data.milestones.map((m) => ({ id: m.id, name: m.name }))}
            empty={{ title: t('plan.noIssues'), body: t('plan.noIssuesBody') }}
            onCount={setIssueCount}
            testId="tp-plan-issues"
          />
        )}
        {tab === 'updates' && <PlanUpdates plan={plan} meta={meta} composeOpen={focusCompose || sp.get('new') === '1'} onPosted={load} />}
      </div>

      {tab !== 'issues' && (
        <aside className="tp-plan-side" aria-label={t('plan.properties')}>
          <SidePanel data={data} meta={meta} latest={latest} locale={locale} onPatch={patch} onWrite={writeUpdate} />
        </aside>
      )}

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
      <SaveTemplateDialog
        open={savingTemplate}
        planId={plan.id}
        planName={plan.name}
        onClose={() => setSavingTemplate(false)}
        onSaved={(tpl) => {
          setSavingTemplate(false);
          setNotice(t('templates.saved', { name: tpl.name }));
        }}
      />
      <TrackToast message={notice} onDismiss={() => setNotice(null)} dismissLabel={t('common.dismiss')} />
    </div>
  );
}

const PLAN_LIST_DEFAULTS = { group: 'status' as const, sort: 'manual' as const };

const PLAN_ICONS = ['🚀', '🎯', '📦', '🛠️', '📱', '💳', '📈', '🧪', '🔒', '🌎', '✨', '📣'];

/** Ícono del project (como Linear): clic abre la grilla; "Sin ícono" vuelve al de estado. */
function PlanIconPicker({ plan, onPatch }: { plan: PlanSummary; onPatch: (b: Record<string, unknown>) => Promise<boolean> }) {
  const t = useTranslations('trackPlanning');
  return (
    <KeyPicker
      ariaLabel={t('plan.icon')}
      className="tp-plan-icon"
      testId="tp-plan-icon"
      value={plan.icon ?? ''}
      options={[{ value: '', label: t('plan.noIcon'), icon: <PlanStatusIcon status={plan.status} /> }, ...PLAN_ICONS.map((i) => ({ value: i, label: i }))]}
      onSelect={(v) => void onPatch({ icon: v })}
      trigger={<span aria-hidden="true">{plan.icon || <PlanStatusIcon status={plan.status} />}</span>}
    />
  );
}

/**
 * Columna derecha (como Linear): propiedades en resumen, progreso, milestones
 * y la salud del último update; los recordatorios del update en una sección chica.
 */
function SidePanel({
  data,
  meta,
  latest,
  locale,
  onPatch,
  onWrite,
}: {
  data: PlanResponse;
  meta: PlansMeta | null;
  latest: LatestUpdate | null | undefined;
  locale: string;
  onPatch: (b: Record<string, unknown>) => Promise<boolean>;
  onWrite: () => void;
}) {
  const t = useTranslations('trackPlanning');
  const { plan, milestones } = data;
  const today = localDay();
  const memberNames = plan.member_ids
    .filter((id) => id !== plan.lead_id)
    .map((id) => personName(meta?.members.find((m) => m.id === id)))
    .filter(Boolean);
  return (
    <>
      <section className="tp-side-sec" aria-labelledby="tp-side-props">
        <h3 id="tp-side-props" className="tp-side-title">
          {t('plan.properties')}
        </h3>
        <dl className="tp-side-dl" data-testid="tp-side-props">
          <dt>{t('plan.status')}</dt>
          <dd>
            <PlanStatusIcon status={plan.status} /> {t(`status.${plan.status}`)}
          </dd>
          <dt>{t('plan.priority')}</dt>
          <dd>
            <PriorityIcon priority={plan.priority} /> {t(`priority.${plan.priority}`)}
          </dd>
          <dt>{t('plan.lead')}</dt>
          <dd>{plan.lead_id ? plan.lead_name || plan.lead_email : <span className="tp-muted">{t('common.noLead')}</span>}</dd>
          <dt>{t('plan.members')}</dt>
          <dd data-testid="tp-side-members">{memberNames.length ? memberNames.join(', ') : <span className="tp-muted">{t('common.none')}</span>}</dd>
          <dt>{t('plan.targetDate')}</dt>
          <dd>{plan.target_date ? fmtDay(plan.target_date, locale, true) : <span className="tp-muted">{t('common.noDate')}</span>}</dd>
          <dt>{t('plan.teams')}</dt>
          <dd>{plan.teams.length ? plan.teams.map((x) => x.name).join(', ') : <span className="tp-muted">{t('common.none')}</span>}</dd>
        </dl>
      </section>

      <ProgressSection data={data} locale={locale} />

      {milestones.length > 0 && (
        <section className="tp-side-sec" aria-labelledby="tp-side-ms">
          <h3 id="tp-side-ms" className="tp-side-title">
            {t('plan.milestones')}
          </h3>
          <ul className="tp-side-ms" role="list">
            {milestones.map((m) => (
              <li key={m.id} className={m.percent >= 100 && m.total > 0 ? 'tp-ms-done' : ''}>
                <span className="tp-ms-diamond" aria-hidden="true" />
                <span className="tp-side-ms-name">{m.name}</span>
                <span className={`tp-side-ms-pct${m.target_date && m.target_date < today && m.percent < 100 ? ' tp-overdue' : ''}`}>{m.percent}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="tp-side-sec" aria-labelledby="tp-side-health">
        <h3 id="tp-side-health" className="tp-side-title">
          {t('plan.health')}
        </h3>
        <div className="tp-side-health">
          <HealthDot health={plan.health} label={t(`health.${plan.health}`)} />
          {latest && <span className="ui-help">{t('plan.lastUpdateOn', { date: fmtInstantDay(latest.created_at, locale) })}</span>}
        </div>
        <button type="button" className="btn btn-sm" onClick={onWrite} data-testid="tp-side-write-update">
          {t('plan.writeUpdate')}
        </button>
      </section>

      <section className="tp-side-sec tp-side-reminders" aria-labelledby="tp-side-rem">
        <h3 id="tp-side-rem" className="tp-side-title">
          {t('plan.reminders')}
        </h3>
        <div className="tp-prop-pair">
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
        </div>
      </section>
    </>
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
  // Lead y miembros son personas distintas (como Linear): el chip de miembros no repite al lead.
  const memberIds = plan.member_ids.filter((id) => id !== plan.lead_id);
  const memberNames = memberIds.map((id) => personName(members.find((m) => m.id === id))).filter(Boolean);
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
        value={memberIds}
        options={members
          .filter((m) => m.id !== plan.lead_id)
          .map((m) => ({ value: m.id, label: personName(m), keywords: m.email, icon: <span className="track-avatar">{initials(personName(m))}</span> }))}
        onSelect={(id) => void onPatch({ memberIds: toggleId(memberIds, id) })}
        trigger={
          <>
            {memberNames.length ? (
              <span className="tp-chip-avatars" aria-hidden>
                {memberNames.slice(0, 3).map((n, i) => (
                  <span key={i} className="track-avatar">
                    {initials(n)}
                  </span>
                ))}
              </span>
            ) : (
              <TrackIcon name="users" size={13} />
            )}
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

function Overview({
  data,
  latest,
  locale,
  onPatch,
  onReload,
  onWrite,
}: {
  data: PlanResponse;
  latest: LatestUpdate | null | undefined;
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

  return (
    <div className="tp-overview">
      <section className="tp-desc" aria-label={t('plan.description')}>
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

      <Resources plan={plan} onPatch={onPatch} />

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
            <span className="ui-help tp-latest-by">
              <span className="track-avatar" aria-hidden>
                {initialsOf(updateAuthor(latest))}
              </span>
              {updateAuthor(latest)} · {fmtInstantDay(latest.created_at, locale)}
            </span>
            {latest.body && <MarkdownView source={latest.body} className="tp-update-body" />}
          </div>
        )}
      </section>

      <Milestones planId={plan.id} milestones={milestones} locale={locale} onChanged={onReload} />
    </div>
  );
}

/**
 * Progreso del project (columna derecha, como Linear): alcance, empezados y
 * terminados con el gráfico, todo en la misma unidad (puntos si hay
 * estimaciones, si no issues) y el mismo porcentaje: terminado / alcance
 * (ver computeProgress en lib/track-planning-core). Es el único panel de
 * progreso de la página.
 */
function ProgressSection({ data, locale }: { data: PlanResponse; locale: string }) {
  const t = useTranslations('trackPlanning');
  const p = data.plan.progress;
  const points = data.series?.points ?? [];
  const unit = p.byPoints ? 'points' : 'issues';
  const scope = p.byPoints ? p.points : p.total;
  const started = p.byPoints ? p.startedPoints : p.started;
  const done = p.byPoints ? p.donePoints : p.done;
  const pct = (n: number) => (scope > 0 ? Math.round((n / scope) * 100) : 0);
  return (
    <section className="tp-side-sec tp-progress-sec" aria-labelledby="tp-side-progress" data-testid="tp-progress">
      <h3 id="tp-side-progress" className="tp-side-title">
        {t('plan.progress')}
      </h3>
      {scope === 0 ? (
        <p className="ui-help">{t('plan.chartEmpty')}</p>
      ) : (
        <>
          <p className="ui-help" data-testid="tp-progress-detail">
            {t(`plan.progressOf.${unit}`, { done: fmtNum(done), total: fmtNum(scope), percent: p.percent })}
          </p>
          <dl className="tp-progress-stats">
            <div className="tp-progress-stat">
              <dt className="tp-progress-stat-label">
                <span className="tp-swatch is-scope" aria-hidden />
                {t('plan.scope')}
              </dt>
              <dd className="tp-progress-stat-num">{fmtNum(scope)}</dd>
            </div>
            <div className="tp-progress-stat">
              <dt className="tp-progress-stat-label">
                <span className="tp-swatch is-started" aria-hidden />
                {t('plan.started')}
              </dt>
              <dd className="tp-progress-stat-num">
                {fmtNum(started)} <span className="tp-progress-stat-pct">{pct(started)}%</span>
              </dd>
            </div>
            <div className="tp-progress-stat">
              <dt className="tp-progress-stat-label">
                <span className="tp-swatch is-completed" aria-hidden />
                {t('plan.completed')}
              </dt>
              <dd className="tp-progress-stat-num">
                {fmtNum(done)} <span className="tp-progress-stat-pct">{p.percent}%</span>
              </dd>
            </div>
          </dl>
          {points.length > 1 ? (
            <LineChart
              height={points.length <= 7 ? 140 : 180}
              legend={false}
              label={t('plan.progressChart')}
              labels={points.map((x) => fmtDay(x.day, locale))}
              series={[
                { key: 'scope', label: t('plan.scope'), color: 'var(--ink)', values: points.map((x) => x.scope) },
                { key: 'started', label: t('plan.started'), color: 'var(--c-notes)', values: points.map((x) => x.started + x.completed), area: true },
                { key: 'completed', label: t('plan.completed'), color: 'var(--accent)', values: points.map((x) => x.completed), area: true },
              ]}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

interface PlanLink {
  url: string;
  title: string;
}

function parseLinks(raw: string | undefined): PlanLink[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((l): l is PlanLink => Boolean(l) && typeof (l as PlanLink).url === 'string') : [];
  } catch {
    return [];
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Resources: links del project (docs, diseños, specs), como en Linear. */
function Resources({ plan, onPatch }: { plan: PlanSummary; onPatch: (b: Record<string, unknown>) => Promise<boolean> }) {
  const t = useTranslations('trackPlanning');
  const links = parseLinks(plan.links);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = (next: PlanLink[]) => onPatch({ links: next });
  const add = async (e: FormEvent) => {
    e.preventDefault();
    let v = url.trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
    try {
      new URL(v);
    } catch {
      setError(t('plan.invalidLink'));
      return;
    }
    if (await save([...links, { url: v, title: title.trim() }])) {
      setUrl('');
      setTitle('');
      setError(null);
      setAdding(false);
    }
  };
  return (
    <section className="tp-card tp-resources" aria-labelledby="tp-res-h">
      <div className="tp-card-head">
        <h3 id="tp-res-h" className="tp-card-title">
          {t('plan.resources')}
        </h3>
        {!adding && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAdding(true)} data-testid="tp-add-link">
            <TrackIcon name="plus" size={12} /> {t('plan.addLink')}
          </button>
        )}
      </div>
      {links.length === 0 && !adding && <p className="ui-help">{t('plan.resourcesEmpty')}</p>}
      {links.length > 0 && (
        <ul className="tp-links" role="list" data-testid="tp-links">
          {links.map((l, i) => (
            <li key={`${l.url}-${i}`} className="tp-link">
              <TrackIcon name="link" size={13} />
              <a href={l.url} target="_blank" rel="noreferrer noopener" className="tp-link-a">
                <span className="tp-link-title">{l.title || hostOf(l.url)}</span>
                {l.title && <span className="tp-link-host">{hostOf(l.url)}</span>}
              </a>
              <button
                type="button"
                className="btn btn-sm btn-ghost btn-icon"
                aria-label={t('plan.removeLink', { name: l.title || hostOf(l.url) })}
                onClick={() => void save(links.filter((_, j) => j !== i))}
              >
                <TrackIcon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form
          className="tp-inline-form"
          onSubmit={add}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setAdding(false);
            }
          }}
        >
          <input
            className="input"
            aria-label={t('plan.linkUrl')}
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
            data-testid="tp-link-url"
          />
          <input
            className="input"
            aria-label={t('plan.linkTitle')}
            placeholder={t('plan.linkTitle')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
          <button type="submit" className="btn btn-sm" disabled={!url.trim()}>
            {t('common.add')}
          </button>
        </form>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </section>
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
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
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
                <span className="tp-ms-bar" aria-hidden="true">
                  <span style={{ width: `${Math.max(0, Math.min(100, m.percent))}%` }} />
                </span>
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
