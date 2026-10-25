'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { TrackStatusRow } from '@/lib/db';
import type { ProjectMember } from '@/lib/track-data';
import {
  AI_SUGGESTION_KINDS,
  SLA_HOUR_OPTIONS,
  TRACK_PRIORITIES,
  type AiSuggestionMode,
  type RuleActions,
  type RuleCondition,
  type RuleField,
  type TriageRule,
  type TriageSettings,
} from '@/lib/track-triage-shared';
import { call } from './api';

type Settings = TriageSettings & { currentOwnerId: string | null; nextHandoffAt: string | null };
interface Label {
  id: string;
  name: string;
}
interface Cycle {
  id: string;
  name: string;
}

const SOURCES = ['api', 'chat', 'flow', 'github', 'agent', 'import'];

function memberName(m: ProjectMember | undefined): string {
  return m ? m.name || m.email : '?';
}

function hoursLabel(t: ReturnType<typeof useTranslations>, h: number): string {
  if (h % 168 === 0) return t('settings.weeks', { count: h / 168 });
  if (h % 24 === 0) return t('settings.days', { count: h / 24 });
  return t('settings.hours', { count: h });
}

// ---------- Responsable, SLA e IA ----------

function GeneralSettings({
  projectId,
  isAdmin,
  members,
}: {
  projectId: string;
  isAdmin: boolean;
  members: ProjectMember[];
}) {
  const t = useTranslations('trackTriage');
  const [s, setS] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [addId, setAddId] = useState('');

  const load = useCallback(async () => {
    const res = await call<Settings>(`/api/track/projects/${projectId}/triage-settings`);
    if (res.ok) setS(res.data);
    else setLoadError(true);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Partial<TriageSettings>) => {
    if (!s) return;
    const prev = s;
    setS({ ...s, ...patch } as Settings);
    const res = await call<Settings>(`/api/track/projects/${projectId}/triage-settings`, { method: 'PATCH', json: patch });
    if (res.ok) {
      setS(res.data);
      setStatus('saved');
    } else {
      setS(prev);
      setStatus('error');
    }
  };

  if (loadError) return <p className="ui-error">{t('settings.loadError')}</p>;
  if (!s) return <p className="ui-help">{t('settings.loading')}</p>;
  const byId = new Map(members.map((m) => [m.id, m]));
  const free = members.filter((m) => !s.ownerIds.includes(m.id));
  const move = (i: number, d: number) => {
    const ids = [...s.ownerIds];
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void save({ ownerIds: ids });
  };

  return (
    <div className="track-x-settings" data-testid="track-triage-general">
      <fieldset className="track-x-fieldset" disabled={!isAdmin}>
        <legend className="track-section-title">{t('settings.ownerTitle')}</legend>
        <p className="ui-help">{t('settings.ownerHelp')}</p>
        <label className="ui-field">
          <span className="label">{t('settings.ownerAction')}</span>
          <select
            className="select"
            value={s.ownerAction}
            onChange={(e) => void save({ ownerAction: e.target.value as Settings['ownerAction'] })}
            data-testid="track-triage-owner-action"
          >
            {(['off', 'notify', 'assign'] as const).map((a) => (
              <option key={a} value={a}>
                {t(`settings.ownerActions.${a}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="ui-field">
          <span className="label">{t('settings.rotation')}</span>
          <select className="select" value={s.ownerRotation} onChange={(e) => void save({ ownerRotation: e.target.value as Settings['ownerRotation'] })}>
            <option value="daily">{t('settings.rotations.daily')}</option>
            <option value="weekly">{t('settings.rotations.weekly')}</option>
          </select>
        </label>
        <div className="ui-field">
          <span className="label">{t('settings.members')}</span>
          {s.ownerIds.length === 0 ? (
            <p className="ui-help">{t('settings.noMembers')}</p>
          ) : (
            <ol className="track-x-rotation" data-testid="track-triage-rotation">
              {s.ownerIds.map((id, i) => (
                <li key={id} className={id === s.currentOwnerId ? 'is-current' : undefined}>
                  <span>
                    {memberName(byId.get(id))}
                    {id === s.currentOwnerId && <span className="track-x-muted"> · {t('settings.onDuty')}</span>}
                  </span>
                  <span className="track-x-row-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('settings.moveUp')}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => move(i, 1)}
                      disabled={i === s.ownerIds.length - 1}
                      aria-label={t('settings.moveDown')}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void save({ ownerIds: s.ownerIds.filter((x) => x !== id) })}
                      aria-label={`${t('settings.removeMember')}: ${memberName(byId.get(id))}`}
                    >
                      {t('settings.removeMember')}
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {free.length > 0 && (
            <span className="track-x-inline">
              <select className="select" value={addId} onChange={(e) => setAddId(e.target.value)} aria-label={t('settings.addMember')} data-testid="track-triage-add-owner">
                <option value="">{t('settings.pickMember')}</option>
                {free.map((m) => (
                  <option key={m.id} value={m.id}>
                    {memberName(m)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!addId}
                onClick={() => {
                  void save({ ownerIds: [...s.ownerIds, addId] });
                  setAddId('');
                }}
                data-testid="track-triage-add-owner-btn"
              >
                {t('settings.addMember')}
              </button>
            </span>
          )}
        </div>
      </fieldset>

      <fieldset className="track-x-fieldset" disabled={!isAdmin}>
        <legend className="track-section-title">{t('settings.slaTitle')}</legend>
        <p className="ui-help">{t('settings.slaHelp')}</p>
        <label className="ui-switch">
          <input
            type="checkbox"
            role="switch"
            checked={s.slaEnabled}
            onChange={(e) => void save({ slaEnabled: e.target.checked })}
            data-testid="track-sla-toggle"
          />
          {t('settings.slaEnable')}
        </label>
        {s.slaEnabled && (
          <div className="track-x-grid">
            {TRACK_PRIORITIES.map((p) => (
              <label key={p} className="ui-field">
                <span className="label">{t(`priorities.${p}`)}</span>
                <select
                  className="select"
                  value={s.slaHours[p] ?? ''}
                  onChange={(e) => void save({ slaHours: { ...s.slaHours, [p]: e.target.value ? Number(e.target.value) : null } })}
                  data-testid={`track-sla-hours-${p}`}
                >
                  <option value="">{t('settings.slaNone')}</option>
                  {SLA_HOUR_OPTIONS.map((h) => (
                    <option key={h} value={h}>
                      {hoursLabel(t, h)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="track-x-fieldset" disabled={!isAdmin}>
        <legend className="track-section-title">{t('settings.aiTitle')}</legend>
        <p className="ui-help">{t('settings.aiHelp')}</p>
        <div className="track-x-grid">
          {AI_SUGGESTION_KINDS.map((k) => (
            <label key={k} className="ui-field">
              <span className="label">{t(`ai.kinds.${k}`)}</span>
              <select
                className="select"
                value={s.aiModes[k]}
                onChange={(e) => void save({ aiModes: { ...s.aiModes, [k]: e.target.value as AiSuggestionMode } })}
                data-testid={`track-ai-mode-${k}`}
              >
                {(['show', 'auto', 'off'] as const)
                  .filter((m) => k !== 'duplicate' || m !== 'auto')
                  .map((m) => (
                    <option key={m} value={m}>
                      {t(`settings.aiModes.${m}`)}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>
      {!isAdmin && <p className="ui-help">{t('settings.adminOnly')}</p>}
      <p className={status === 'error' ? 'ui-error' : 'ui-help'} role="status" aria-live="polite">
        {status === 'saved' ? t('settings.saved') : status === 'error' ? t('settings.error') : ''}
      </p>
    </div>
  );
}

// ---------- Reglas ----------

interface Draft {
  id?: string;
  name: string;
  conditions: RuleCondition[];
  actions: RuleActions;
}

const EMPTY_DRAFT: Draft = { name: '', conditions: [{ field: 'text', op: 'contains', values: [] }], actions: {} };

function RuleEditor({
  draft,
  setDraft,
  members,
  statuses,
  labels,
  cycles,
  onSave,
  onCancel,
  busy,
  error,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  members: ProjectMember[];
  statuses: TrackStatusRow[];
  labels: Label[];
  cycles: Cycle[];
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useTranslations('trackTriage');
  const setCond = (i: number, c: Partial<RuleCondition>) =>
    setDraft({ ...draft, conditions: draft.conditions.map((x, j) => (j === i ? { ...x, ...c } : x)) });

  return (
    <form
      className="track-x-rule-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      data-testid="track-rule-form"
    >
      <label className="ui-field">
        <span className="label">{t('rules.name')}</span>
        <input className="input" value={draft.name} maxLength={120} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="track-rule-name" />
      </label>
      <div className="ui-field">
        <span className="label">{t('rules.when')}</span>
        <p className="ui-help">{t('rules.conditionsHelp')}</p>
        {draft.conditions.map((c, i) => (
          <div key={i} className="track-x-cond">
            <select
              className="select"
              aria-label={t('rules.field')}
              value={c.field}
              onChange={(e) => {
                const field = e.target.value as RuleField;
                setCond(i, { field, op: field === 'text' || field === 'customer' ? 'contains' : 'is', values: [] });
              }}
              data-testid="track-rule-field"
            >
              {(['text', 'source', 'priority', 'label', 'customer'] as const).map((f) => (
                <option key={f} value={f}>
                  {t(`rules.fields.${f}`)}
                </option>
              ))}
            </select>
            <select className="select" aria-label={t('rules.op')} value={c.op === 'is_not' ? 'is_not' : 'pos'} onChange={(e) => setCond(i, { op: e.target.value === 'is_not' ? 'is_not' : c.field === 'text' || c.field === 'customer' ? 'contains' : 'is' })}>
              <option value="pos">{t(c.field === 'text' || c.field === 'customer' ? 'rules.ops.contains' : 'rules.ops.is')}</option>
              <option value="is_not">{t(c.field === 'text' || c.field === 'customer' ? 'rules.ops.not_contains' : 'rules.ops.is_not')}</option>
            </select>
            {c.field === 'source' || c.field === 'priority' || c.field === 'label' ? (
              <span className="track-x-checks">
                {(c.field === 'source' ? SOURCES.map((v) => ({ v, l: t(`rules.sources.${v}`) })) : c.field === 'priority' ? TRACK_PRIORITIES.map((v) => ({ v, l: t(`priorities.${v}`) })) : labels.map((l) => ({ v: l.id, l: l.name }))).map(
                  (o) => (
                    <label key={o.v} className="ui-check">
                      <input
                        type="checkbox"
                        checked={c.values.includes(o.v)}
                        onChange={(e) => setCond(i, { values: e.target.checked ? [...c.values, o.v] : c.values.filter((x) => x !== o.v) })}
                      />
                      {o.l}
                    </label>
                  ),
                )}
              </span>
            ) : (
              <input
                className="input"
                aria-label={t('rules.values')}
                placeholder={t('rules.valuesPlaceholder')}
                value={c.values.join(', ')}
                onChange={(e) => setCond(i, { values: e.target.value.split(',').map((v) => v.trimStart()) })}
                data-testid="track-rule-values"
              />
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) })}
              aria-label={t('rules.removeCondition')}
            >
              {t('rules.removeCondition')}
            </button>
          </div>
        ))}
        {draft.conditions.length === 0 && <p className="ui-help">{t('rules.noConditions')}</p>}
        <button
          type="button"
          className="btn btn-ghost btn-sm track-x-self-start"
          onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, { field: 'source', op: 'is', values: [] }] })}
          disabled={draft.conditions.length >= 10}
        >
          <span aria-hidden>+</span> {t('rules.addCondition')}
        </button>
      </div>
      <div className="ui-field">
        <span className="label">{t('rules.then')}</span>
        <div className="track-x-grid">
          <label className="ui-field">
            <span className="label">{t('rules.setPriority')}</span>
            <select
              className="select"
              value={draft.actions.priority ?? ''}
              onChange={(e) => setDraft({ ...draft, actions: { ...draft.actions, priority: (e.target.value || undefined) as RuleActions['priority'] } })}
              data-testid="track-rule-priority"
            >
              <option value="">{t('rules.keep')}</option>
              {TRACK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priorities.${p}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            <span className="label">{t('rules.setAssignee')}</span>
            <select
              className="select"
              value={draft.actions.assigneeId ?? ''}
              onChange={(e) => setDraft({ ...draft, actions: { ...draft.actions, assigneeId: e.target.value || undefined } })}
              data-testid="track-rule-assignee"
            >
              <option value="">{t('rules.keep')}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {memberName(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            <span className="label">{t('rules.setCycle')}</span>
            <select className="select" value={draft.actions.cycleId ?? ''} onChange={(e) => setDraft({ ...draft, actions: { ...draft.actions, cycleId: e.target.value || undefined } })}>
              <option value="">{t('rules.keep')}</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            <span className="label">{t('rules.accept')}</span>
            <select
              className="select"
              value={draft.actions.acceptStatusId ?? ''}
              onChange={(e) => setDraft({ ...draft, actions: { ...draft.actions, acceptStatusId: e.target.value || undefined } })}
            >
              <option value="">{t('rules.stayInTriage')}</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {labels.length > 0 && (
          <div className="ui-field">
            <span className="label">{t('rules.addLabels')}</span>
            <span className="track-x-checks">
              {labels.map((l) => (
                <label key={l.id} className="ui-check">
                  <input
                    type="checkbox"
                    checked={draft.actions.labelIds?.includes(l.id) ?? false}
                    onChange={(e) => {
                      const ids = draft.actions.labelIds ?? [];
                      setDraft({ ...draft, actions: { ...draft.actions, labelIds: e.target.checked ? [...ids, l.id] : ids.filter((x) => x !== l.id) } });
                    }}
                    data-testid="track-rule-label"
                  />
                  {l.name}
                </label>
              ))}
            </span>
          </div>
        )}
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <div className="track-inline-form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t('rules.cancel')}
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !draft.name.trim()} data-testid="track-rule-save">
          {t('rules.save')}
        </button>
      </div>
    </form>
  );
}

function ruleSummary(t: ReturnType<typeof useTranslations>, r: TriageRule, members: ProjectMember[], statuses: TrackStatusRow[], labels: Label[]): string {
  const parts: string[] = [];
  if (r.actions.priority) parts.push(`${t('rules.setPriority')}: ${t(`priorities.${r.actions.priority}`)}`);
  if (r.actions.assigneeId) parts.push(`${t('rules.setAssignee')}: ${memberName(members.find((m) => m.id === r.actions.assigneeId))}`);
  if (r.actions.labelIds?.length) parts.push(`${t('rules.addLabels')}: ${r.actions.labelIds.map((id) => labels.find((l) => l.id === id)?.name ?? '?').join(', ')}`);
  if (r.actions.acceptStatusId) parts.push(`${t('rules.accept')}: ${statuses.find((s) => s.id === r.actions.acceptStatusId)?.name ?? '?'}`);
  if (r.actions.cycleId) parts.push(t('rules.setCycle'));
  const textual = (f: string) => f === 'text' || f === 'customer';
  const value = (field: string, v: string) =>
    field === 'label' ? (labels.find((l) => l.id === v)?.name ?? v) : field === 'priority' ? t(`priorities.${v}`) : field === 'source' ? t(`rules.sources.${v}`) : `"${v}"`;
  const when = r.conditions.length
    ? r.conditions
        .map((c) => {
          const op = c.op === 'is_not' ? (textual(c.field) ? 'not_contains' : 'is_not') : textual(c.field) ? 'contains' : 'is';
          return `${t(`rules.fields.${c.field}`)} ${t(`rules.ops.${op}`)} ${c.values.map((v) => value(c.field, v)).join(' / ') || '…'}`;
        })
        .join(' · ')
    : t('rules.noConditions');
  return `${when} → ${parts.join(' · ')}`;
}

function RulesSettings({
  projectId,
  isAdmin,
  members,
  statuses,
}: {
  projectId: string;
  isAdmin: boolean;
  members: ProjectMember[];
  statuses: TrackStatusRow[];
}) {
  const t = useTranslations('trackTriage');
  const [rules, setRules] = useState<TriageRule[] | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [confirm, setConfirm] = useState<TriageRule | null>(null);

  const load = useCallback(async () => {
    const [r, l, c] = await Promise.all([
      call<{ rows: TriageRule[] }>(`/api/track/projects/${projectId}/triage-rules`),
      call<{ rows: Label[] }>('/api/track/labels'),
      call<{ rows: Cycle[] }>(`/api/track/projects/${projectId}/cycles`),
    ]);
    if (r.ok) setRules(r.data.rows);
    else setLoadError(true);
    if (l.ok) setLabels(l.data.rows);
    if (c.ok) setCycles(c.data.rows);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const body = {
      name: draft.name.trim(),
      conditions: draft.conditions.map((c) => ({ ...c, values: c.values.map((v) => v.trim()).filter(Boolean) })).filter((c) => c.values.length > 0),
      actions: Object.fromEntries(Object.entries(draft.actions).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : Boolean(v)))),
    };
    const res = draft.id
      ? await call<TriageRule>(`/api/track/triage-rules/${draft.id}`, { method: 'PATCH', json: body })
      : await call<TriageRule>(`/api/track/projects/${projectId}/triage-rules`, { method: 'POST', json: body });
    setBusy(false);
    if (res.ok) {
      setDraft(null);
      void load();
    } else setError(res.error === 'missing_action' ? t('rules.missingAction') : t('rules.saveError'));
  };

  const patch = async (r: TriageRule, body: Record<string, unknown>) => {
    const res = await call<TriageRule>(`/api/track/triage-rules/${r.id}`, { method: 'PATCH', json: body });
    if (res.ok) void load();
    else setError(t('rules.saveError'));
  };

  const remove = async (r: TriageRule) => {
    setConfirm(null);
    const res = await call(`/api/track/triage-rules/${r.id}`, { method: 'DELETE' });
    if (res.ok) setRules((prev) => (prev ?? []).filter((x) => x.id !== r.id));
    else setError(t('rules.saveError'));
  };

  return (
    <section className="track-x-settings" data-testid="track-triage-rules">
      <div className="track-x-head">
        <h3 className="track-section-title">{t('rules.title')}</h3>
        {isAdmin && !draft && (
          <button type="button" className="btn btn-sm" onClick={() => setDraft({ ...EMPTY_DRAFT })} data-testid="track-rule-new">
            <span aria-hidden>+</span> {t('rules.add')}
          </button>
        )}
      </div>
      <p className="ui-help">{t('rules.help')}</p>
      {loadError && <p className="ui-error">{t('settings.loadError')}</p>}
      {!rules && !loadError && <p className="ui-help">{t('settings.loading')}</p>}
      {rules && rules.length === 0 && !draft && <p className="ui-help">{t('rules.empty')}</p>}
      {rules && rules.length > 0 && (
        <ol className="track-x-rules">
          {rules.map((r, i) => (
            <li key={r.id} className="track-x-rule" data-testid="track-rule">
              <div className="track-x-rule-main">
                <span className="track-x-rule-name">{r.name}</span>
                <span className="ui-help">{ruleSummary(t, r, members, statuses, labels)}</span>
              </div>
              {isAdmin && (
                <span className="track-x-row-actions">
                  <label className="ui-switch">
                    <input type="checkbox" role="switch" checked={r.enabled} onChange={(e) => void patch(r, { enabled: e.target.checked })} aria-label={`${t('rules.enabled')}: ${r.name}`} />
                  </label>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => void patch(r, { position: i - 1 })} aria-label={t('settings.moveUp')}>
                    ↑
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === rules.length - 1} onClick={() => void patch(r, { position: i + 1 })} aria-label={t('settings.moveDown')}>
                    ↓
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft({ id: r.id, name: r.name, conditions: r.conditions, actions: r.actions })} data-testid="track-rule-edit">
                    {t('rules.edit')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setConfirm(r)} data-testid="track-rule-delete">
                    {t('rules.delete')}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {draft && (
        <RuleEditor
          draft={draft}
          setDraft={setDraft}
          members={members}
          statuses={statuses}
          labels={labels}
          cycles={cycles}
          onSave={() => void save()}
          onCancel={() => {
            setDraft(null);
            setError(null);
          }}
          busy={busy}
          error={error}
        />
      )}
      {!draft && error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        title={t('rules.deleteTitle', { name: confirm?.name ?? '' })}
        confirmLabel={t('rules.delete')}
        cancelLabel={t('rules.cancel')}
        danger
        onConfirm={() => confirm && void remove(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}

/** Pestaña Triage de los ajustes del proyecto: responsable de turno, SLAs, IA y reglas. */
export default function TriageSettingsPanel(props: { projectId: string; isAdmin: boolean; members: ProjectMember[]; statuses: TrackStatusRow[] }) {
  return (
    <>
      <GeneralSettings projectId={props.projectId} isAdmin={props.isAdmin} members={props.members} />
      <RulesSettings {...props} />
    </>
  );
}
