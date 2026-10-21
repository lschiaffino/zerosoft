'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';
import type { TrackRecurringFrequency, TrackRecurringIssueRow, TrackStatusRow } from '@/lib/db';
import type { ProjectMember } from '@/lib/track-data';
import { formatDay } from '@/lib/track-tasks';
import IssuePresetFields, { presetLabels, savedLabelList, type IssuePreset } from './IssuePresetFields';

interface RecurringPanelProps {
  projectId: string;
  rules: TrackRecurringIssueRow[];
  statuses: TrackStatusRow[];
  members: ProjectMember[];
  today: string;
  onChanged: () => void | Promise<void>;
}

const FREQUENCIES: TrackRecurringFrequency[] = ['daily', 'weekly', 'monthly', 'yearly'];

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Issues que se repiten (drawer de ajustes): Track los crea en cada fecha
 * desde el tick horario. Se pueden pausar, editar y borrar; los issues ya
 * creados no cambian.
 */
export default function RecurringPanel({ projectId, rules, statuses, members, today, onChanged }: RecurringPanelProps) {
  const t = useTranslations('track');
  const locale = useLocale();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saved = async () => {
    setEditing(null);
    await onChanged();
  };

  async function send(url: string, method: string, body?: unknown) {
    setError(null);
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) setError(t('recurring.error'));
    await onChanged();
  }

  const form = (rule: TrackRecurringIssueRow | null) => (
    <RecurringForm
      projectId={projectId}
      rule={rule}
      statuses={statuses}
      members={members}
      today={today}
      onCancel={() => setEditing(null)}
      onSaved={saved}
    />
  );

  return (
    <div className="track-recurring" data-testid="track-recurring">
      <div className="track-pane-head">
        <p className="ui-help">{t('recurring.help')}</p>
        {editing !== 'new' && rules.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => setEditing('new')} data-testid="track-new-recurring">
            {t('recurring.new')}
          </button>
        )}
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {editing === 'new' && form(null)}
      {rules.length === 0 && editing !== 'new' ? (
        <EmptyState
          quiet
          title={t('recurring.emptyTitle')}
          body={t('recurring.emptyBody')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')} data-testid="track-new-recurring">
              {t('recurring.new')}
            </button>
          }
        />
      ) : (
        <ul className="track-cycle-list">
          {rules.map((rule) =>
            editing === rule.id ? (
              <li key={rule.id} className="track-cycle is-editing">
                {form(rule)}
              </li>
            ) : (
              <li key={rule.id} className={`track-cycle${rule.active ? '' : ' is-past'}`} data-testid="track-recurring-rule">
                <div className="track-cycle-head">
                  <span className="track-cycle-name">{rule.title}</span>
                  <span className="track-cycle-state">{t(`recurring.summary.${rule.frequency}`, { count: rule.every })}</span>
                  <span className="track-cycle-dates">
                    {rule.active
                      ? t('recurring.nextRun', { date: formatDay(rule.next_run_on, locale, today) })
                      : t('recurring.paused')}
                  </span>
                </div>
                {deleting === rule.id ? (
                  <div className="track-cycle-confirm" role="group" aria-label={t('recurring.delete')}>
                    <p>{t('recurring.deleteConfirm')}</p>
                    <div className="track-inline-form-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(null)}>
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-danger btn-sm"
                        onClick={() => {
                          setDeleting(null);
                          void send(`/api/track/recurring/${rule.id}`, 'DELETE');
                        }}
                      >
                        {t('recurring.delete')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="track-cycle-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        void send(`/api/track/recurring/${rule.id}`, 'PATCH', {
                          active: !rule.active,
                          ...(rule.active ? {} : { timezone: browserTimeZone() }),
                        })
                      }
                    >
                      {rule.active ? t('recurring.pause') : t('recurring.resume')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(rule.id)}>
                      {t('recurring.edit')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(rule.id)}>
                      {t('recurring.delete')}
                    </button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function RecurringForm({
  projectId,
  rule,
  statuses,
  members,
  today,
  onCancel,
  onSaved,
}: {
  projectId: string;
  rule: TrackRecurringIssueRow | null;
  statuses: TrackStatusRow[];
  members: ProjectMember[];
  today: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('track');
  const locale = useLocale();
  const [title, setTitle] = useState(rule?.title ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [frequency, setFrequency] = useState<TrackRecurringFrequency>(rule?.frequency ?? 'weekly');
  const [every, setEvery] = useState(String(rule?.every ?? 1));
  const [startOn, setStartOn] = useState(rule?.start_on ?? today);
  const [dueDays, setDueDays] = useState(rule?.due_days != null ? String(rule.due_days) : '');
  const [preset, setPreset] = useState<IssuePreset>({
    statusId: rule?.status_id ?? '',
    priority: rule?.priority ?? 'medium',
    assigneeId: rule?.assignee_id ?? '',
    labels: presetLabels(rule?.labels),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const prefix = rule ? `rec-${rule.id}` : 'rec-new';
  const everyN = Math.max(1, Math.min(365, Math.floor(Number(every)) || 1));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !startOn || busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch(rule ? `/api/track/recurring/${rule.id}` : `/api/track/projects/${projectId}/recurring`, {
      method: rule ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        description,
        frequency,
        every: everyN,
        startOn,
        dueDays: dueDays.trim() ? Number(dueDays) : null,
        statusId: preset.statusId || null,
        priority: preset.priority || 'medium',
        assigneeId: preset.assigneeId || null,
        labels: preset.labels,
        timezone: browserTimeZone(),
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) onSaved();
    else setError(true);
  }

  return (
    <form
      className="track-inline-form"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      data-testid="track-recurring-form"
    >
      <div className="ui-field">
        <label className="label" htmlFor={`${prefix}-title`}>
          {t('recurring.title')}
        </label>
        <input
          id={`${prefix}-title`}
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          autoFocus
        />
      </div>
      <div className="ui-field">
        <label className="label" htmlFor={`${prefix}-desc`}>
          {t('recurring.description')} <span className="ui-optional">{t('common.optional')}</span>
        </label>
        <textarea
          id={`${prefix}-desc`}
          className="textarea"
          rows={3}
          value={description}
          maxLength={5000}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor={`${prefix}-freq`}>
            {t('recurring.frequency')}
          </label>
          <select
            id={`${prefix}-freq`}
            className="select"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as TrackRecurringFrequency)}
          >
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {t(`recurring.freq.${f}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${prefix}-every`}>
            {t('recurring.every')}
          </label>
          <span className="track-property-unit">
            <input
              id={`${prefix}-every`}
              className="input"
              type="number"
              min={1}
              max={365}
              inputMode="numeric"
              value={every}
              onChange={(e) => setEvery(e.target.value)}
            />
            <span aria-hidden>{t(`recurring.unit.${frequency}`, { count: everyN })}</span>
          </span>
        </div>
      </div>
      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor={`${prefix}-start`}>
            {t('recurring.startOn')}
          </label>
          <input
            id={`${prefix}-start`}
            className="input"
            type="date"
            lang={locale}
            value={startOn}
            onChange={(e) => setStartOn(e.target.value)}
            required
          />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${prefix}-due`}>
            {t('recurring.dueDays')} <span className="ui-optional">{t('common.optional')}</span>
          </label>
          <input
            id={`${prefix}-due`}
            className="input"
            type="number"
            min={0}
            max={365}
            inputMode="numeric"
            value={dueDays}
            onChange={(e) => setDueDays(e.target.value)}
            aria-describedby={`${prefix}-due-help`}
          />
          <p className="ui-help" id={`${prefix}-due-help`}>
            {t('recurring.dueDaysHelp')}
          </p>
        </div>
      </div>
      <IssuePresetFields
        idPrefix={prefix}
        value={preset}
        onChange={setPreset}
        statuses={statuses}
        members={members}
        savedLabels={savedLabelList(rule?.labels)}
      />
      {error && (
        <p className="ui-error" role="alert">
          {t('recurring.error')}
        </p>
      )}
      <div className="track-inline-form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!title.trim() || !startOn} aria-busy={busy || undefined}>
          {rule ? t('recurring.save') : t('recurring.create')}
        </button>
      </div>
    </form>
  );
}
