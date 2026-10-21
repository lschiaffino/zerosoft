'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';
import type { TrackMilestoneWithProgress } from '@/lib/track-milestones';
import { formatDay } from '@/lib/track-tasks';

interface MilestonesPanelProps {
  projectId: string;
  milestones: TrackMilestoneWithProgress[];
  today: string;
  canDelete: boolean;
  /** Recargar milestones (e issues) después de un cambio. */
  onChanged: () => void | Promise<void>;
}

/**
 * Milestones del proyecto (drawer de ajustes): crear, editar en línea y ver
 * el progreso de cada uno (issues terminados / asignados) con su fecha.
 */
export default function MilestonesPanel({ projectId, milestones, today, canDelete, onChanged }: MilestonesPanelProps) {
  const t = useTranslations('track');
  const locale = useLocale();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saved = async () => {
    setEditing(null);
    await onChanged();
  };

  async function remove(id: string) {
    const res = await fetch(`/api/track/milestones/${id}`, { method: 'DELETE' }).catch(() => null);
    setDeleting(null);
    if (!res?.ok) {
      setError(t('milestones.error'));
      return;
    }
    await onChanged();
  }

  return (
    <div className="track-milestones" data-testid="track-milestones">
      <div className="track-pane-head">
        <p className="ui-help">{t('milestones.help')}</p>
        {editing !== 'new' && milestones.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => setEditing('new')} data-testid="track-new-milestone">
            {t('milestones.new')}
          </button>
        )}
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {editing === 'new' && (
        <MilestoneForm projectId={projectId} milestone={null} onCancel={() => setEditing(null)} onSaved={saved} />
      )}
      {milestones.length === 0 && editing !== 'new' ? (
        <EmptyState
          quiet
          title={t('milestones.emptyTitle')}
          body={t('milestones.emptyBody')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')} data-testid="track-new-milestone">
              {t('milestones.new')}
            </button>
          }
        />
      ) : (
        <ul className="track-cycle-list">
          {milestones.map((m) => {
            if (editing === m.id) {
              return (
                <li key={m.id} className="track-cycle is-editing">
                  <MilestoneForm projectId={projectId} milestone={m} onCancel={() => setEditing(null)} onSaved={saved} />
                </li>
              );
            }
            const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
            const finished = m.total > 0 && m.done >= m.total;
            const overdue = !finished && Boolean(m.target_date) && m.target_date! < today;
            return (
              <li key={m.id} className="track-cycle" data-testid="track-milestone">
                <div className="track-cycle-head">
                  <span className="track-cycle-name">{m.name}</span>
                  <span className="track-cycle-dates">
                    {m.target_date ? formatDay(m.target_date, locale, today) : t('milestones.noDate')}
                  </span>
                  {overdue && <span className="track-cycle-state track-milestone-overdue">{t('milestones.overdue')}</span>}
                </div>
                {m.description && <p className="ui-help track-milestone-desc">{m.description}</p>}
                <div className="track-cycle-progress">
                  <div
                    className="track-cycle-bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={m.total}
                    aria-valuenow={m.done}
                    aria-label={t('milestones.progress', { done: m.done, total: m.total })}
                  >
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <span className="track-cycle-count">{t('milestones.progress', { done: m.done, total: m.total })}</span>
                </div>
                {deleting === m.id ? (
                  <div className="track-cycle-confirm" role="group" aria-label={t('milestones.delete')}>
                    <p>{t('milestones.deleteConfirm')}</p>
                    <div className="track-inline-form-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(null)}>
                        {t('common.cancel')}
                      </button>
                      <button type="button" className="btn btn-primary btn-danger btn-sm" onClick={() => void remove(m.id)}>
                        {t('milestones.delete')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="track-cycle-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(m.id)}>
                      {t('milestones.edit')}
                    </button>
                    {canDelete && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(m.id)}>
                        {t('milestones.delete')}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MilestoneForm({
  projectId,
  milestone,
  onCancel,
  onSaved,
}: {
  projectId: string;
  milestone: TrackMilestoneWithProgress | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('track');
  const locale = useLocale();
  const [name, setName] = useState(milestone?.name ?? '');
  const [description, setDescription] = useState(milestone?.description ?? '');
  const [targetDate, setTargetDate] = useState(milestone?.target_date ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const prefix = milestone ? `milestone-${milestone.id}` : 'milestone-new';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch(milestone ? `/api/track/milestones/${milestone.id}` : `/api/track/projects/${projectId}/milestones`, {
      method: milestone ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), description, targetDate: targetDate || null }),
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
      data-testid="track-milestone-form"
    >
      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor={`${prefix}-name`}>
            {t('milestones.name')}
          </label>
          <input
            id={`${prefix}-name`}
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            required
            autoFocus
          />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${prefix}-date`}>
            {t('milestones.targetDate')} <span className="ui-optional">{t('common.optional')}</span>
          </label>
          <input
            id={`${prefix}-date`}
            className="input"
            type="date"
            lang={locale}
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </div>
      </div>
      <div className="ui-field">
        <label className="label" htmlFor={`${prefix}-desc`}>
          {t('milestones.description')} <span className="ui-optional">{t('common.optional')}</span>
        </label>
        <textarea
          id={`${prefix}-desc`}
          className="textarea"
          rows={2}
          value={description}
          maxLength={5000}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('milestones.error')}
        </p>
      )}
      <div className="track-inline-form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()} aria-busy={busy || undefined}>
          {milestone ? t('milestones.save') : t('milestones.create')}
        </button>
      </div>
    </form>
  );
}
