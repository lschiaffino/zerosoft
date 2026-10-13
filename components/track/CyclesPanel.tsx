'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import QuickModal from '@/components/app/QuickModal';
import type { TrackCycleRow } from '@/lib/db';

export type CycleWithProgress = TrackCycleRow & { total?: number; done?: number };

interface CyclesPanelProps {
  projectId: string;
  cycles: CycleWithProgress[];
  today: string;
  /** Recargar cycles + issues después de un cambio. */
  onChanged: () => void | Promise<void>;
}

const day = (s: string) => s.slice(0, 10);

/**
 * Cycles del proyecto: crear / editar (nombre, inicio, fin), barra de progreso
 * (terminados / totales) y "Completar" que pasa los issues sin terminar al
 * siguiente cycle.
 */
export default function CyclesPanel({ projectId, cycles, today, onChanged }: CyclesPanelProps) {
  const t = useTranslations('track');
  const [editing, setEditing] = useState<CycleWithProgress | 'new' | null>(null);
  const [completing, setCompleting] = useState<CycleWithProgress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ordered = [...cycles].sort((a, b) => a.start_at.localeCompare(b.start_at));
  const nextOf = (c: CycleWithProgress) => ordered.find((x) => x.id !== c.id && x.start_at > c.start_at) ?? null;

  const state = (c: CycleWithProgress) =>
    day(c.end_at) < today ? 'past' : day(c.start_at) > today ? 'upcoming' : 'active';

  return (
    <section className="panel track-cycles" style={{ marginTop: 32 }} data-testid="track-cycles">
      <div className="track-section-header">
        <p className="section-label">{t('project.cycles')}</p>
        <button type="button" className="btn btn-small" onClick={() => setEditing('new')} data-testid="track-new-cycle">
          {t('project.newCycle')}
        </button>
      </div>
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
      {cycles.length === 0 ? (
        <p className="muted">{t('project.noCycles')}</p>
      ) : (
        <ul className="track-cycle-list">
          {[...cycles]
            .sort((a, b) => b.start_at.localeCompare(a.start_at))
            .map((c) => {
              const total = c.total ?? 0;
              const done = c.done ?? 0;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              const st = state(c);
              return (
                <li key={c.id} className={`track-cycle is-${st}`} data-testid="track-cycle">
                  <div className="track-cycle-head">
                    <span className="track-cycle-name">{c.name}</span>
                    <span className="track-cycle-badge mono">{t(`cycles.state.${st}`)}</span>
                    <span className="mono track-cycle-dates">
                      {day(c.start_at)} → {day(c.end_at)}
                    </span>
                  </div>
                  <div className="track-cycle-progress">
                    <div
                      className="track-cycle-bar"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={total}
                      aria-valuenow={done}
                      aria-label={t('cycles.progress', { done, total })}
                    >
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <span className="mono track-cycle-count">{t('cycles.progress', { done, total })}</span>
                  </div>
                  <div className="track-cycle-actions">
                    <button type="button" className="btn btn-small" onClick={() => setEditing(c)}>
                      {t('cycles.edit')}
                    </button>
                    {st !== 'upcoming' && total > done && (
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => setCompleting(c)}
                        data-testid="track-complete-cycle"
                      >
                        {t('cycles.complete')}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
        </ul>
      )}

      {editing && (
        <CycleForm
          projectId={projectId}
          cycle={editing === 'new' ? null : editing}
          today={today}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      )}

      {completing && (
        <CompleteCycleDialog
          cycle={completing}
          next={nextOf(completing)}
          onClose={() => setCompleting(null)}
          onDone={async (moved, targetName) => {
            setCompleting(null);
            setNotice(
              targetName ? t('cycles.movedTo', { count: moved, name: targetName }) : t('cycles.movedOut', { count: moved }),
            );
            await onChanged();
          }}
        />
      )}
    </section>
  );
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function CycleForm({
  projectId,
  cycle,
  today,
  onClose,
  onSaved,
}: {
  projectId: string;
  cycle: CycleWithProgress | null;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('track');
  const [name, setName] = useState(cycle?.name ?? '');
  const [startAt, setStartAt] = useState(cycle ? day(cycle.start_at) : today);
  const [endAt, setEndAt] = useState(cycle ? day(cycle.end_at) : addDays(today, 13));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalidRange = !!startAt && !!endAt && endAt < startAt;

  async function submit() {
    if (!name.trim() || !startAt || !endAt || invalidRange || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(cycle ? `/api/track/cycles/${cycle.id}` : `/api/track/projects/${projectId}/cycles`, {
      method: cycle ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), startAt, endAt }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      onSaved();
      return;
    }
    setError(t('errors.generic'));
  }

  return (
    <QuickModal
      open
      onClose={onClose}
      crumb={`Track › ${cycle ? t('cycles.editTitle') : t('project.newCycle')}`}
      onSubmit={submit}
      submitLabel={busy ? t('common.saving') : cycle ? t('common.save') : t('common.create')}
      cancelLabel={t('common.cancel')}
      submitDisabled={!name.trim() || !startAt || !endAt || invalidRange}
      busy={busy}
      error={error ?? (invalidRange ? t('cycles.invalidRange') : null)}
      width={480}
    >
      <input
        data-autofocus
        className="qm-title"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('cycles.form.namePlaceholder')}
        aria-label={t('cycles.form.name')}
        maxLength={200}
      />
      <div className="qm-row">
        <label className="qm-field">
          <span>{t('cycles.form.startAt')}</span>
          <input type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} required />
        </label>
        <label className="qm-field">
          <span>{t('cycles.form.endAt')}</span>
          <input type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} required />
        </label>
      </div>
    </QuickModal>
  );
}

function CompleteCycleDialog({
  cycle,
  next,
  onClose,
  onDone,
}: {
  cycle: CycleWithProgress;
  next: CycleWithProgress | null;
  onClose: () => void;
  onDone: (moved: number, targetName: string | null) => void;
}) {
  const t = useTranslations('track');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unfinished = (cycle.total ?? 0) - (cycle.done ?? 0);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/track/cycles/${cycle.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next ? { targetCycleId: next.id } : { targetCycleId: null }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t('errors.generic'));
      return;
    }
    const data = (await res.json()) as { moved: number };
    onDone(data.moved, next?.name ?? null);
  }

  return (
    <QuickModal
      open
      onClose={onClose}
      crumb={`Track › ${t('cycles.completeTitle', { name: cycle.name })}`}
      onSubmit={submit}
      submitLabel={busy ? t('common.saving') : t('cycles.complete')}
      cancelLabel={t('common.cancel')}
      busy={busy}
      error={error}
      width={480}
    >
      <p>
        {next
          ? t('cycles.completeMove', { count: unfinished, name: next.name })
          : t('cycles.completeNoNext', { count: unfinished })}
      </p>
    </QuickModal>
  );
}
