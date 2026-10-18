'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';
import type { TrackCycleRow } from '@/lib/db';
import { cycleState, formatDay, nextCycleDraft, overlappingCycle } from '@/lib/track-tasks';

export type CycleWithProgress = TrackCycleRow & { total?: number; done?: number };

interface CyclesPanelProps {
  projectId: string;
  cycles: CycleWithProgress[];
  today: string;
  /** Recargar cycles + issues después de un cambio. */
  onChanged: () => void | Promise<void>;
}

const day = (s: string) => s.slice(0, 10);

const STATE_ORDER = { active: 0, upcoming: 1, past: 2 } as const;

/**
 * Ciclos del proyecto (vive en el drawer de ajustes): crear y editar en línea
 * (nombre, inicio, fin), progreso (terminados / totales) y "Completar", que
 * pasa los issues sin terminar al ciclo siguiente.
 */
export default function CyclesPanel({ projectId, cycles, today, onChanged }: CyclesPanelProps) {
  const t = useTranslations('track');
  const locale = useLocale();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ordered = [...cycles].sort((a, b) => a.start_at.localeCompare(b.start_at));
  const nextOf = (c: CycleWithProgress) => ordered.find((x) => x.id !== c.id && x.start_at > c.start_at) ?? null;
  // El activo primero, después los próximos (el más cercano arriba) y al final los terminados.
  const listed = [...cycles].sort((a, b) => {
    const sa = STATE_ORDER[cycleState(a, today)];
    const sb = STATE_ORDER[cycleState(b, today)];
    if (sa !== sb) return sa - sb;
    return sa === 1 ? a.start_at.localeCompare(b.start_at) : b.start_at.localeCompare(a.start_at);
  });
  const range = (c: CycleWithProgress) => `${formatDay(day(c.start_at), locale, today)} – ${formatDay(day(c.end_at), locale, today)}`;

  const saved = async () => {
    setEditing(null);
    await onChanged();
  };

  return (
    <div className="track-cycles" data-testid="track-cycles">
      <div className="track-pane-head">
        <p className="ui-help">{t('cycles.help')}</p>
        {editing !== 'new' && cycles.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => setEditing('new')} data-testid="track-new-cycle">
            {t('project.newCycle')}
          </button>
        )}
      </div>

      {notice && (
        <p className="ui-help track-pane-notice" role="status">
          {notice}
        </p>
      )}

      {editing === 'new' && (
        <CycleForm projectId={projectId} cycle={null} cycles={cycles} today={today} onCancel={() => setEditing(null)} onSaved={saved} />
      )}

      {cycles.length === 0 && editing !== 'new' ? (
        <EmptyState
          quiet
          title={t('cycles.emptyTitle')}
          body={t('cycles.emptyBody')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')} data-testid="track-new-cycle">
              {t('project.newCycle')}
            </button>
          }
        />
      ) : (
        <ul className="track-cycle-list">
          {listed.map((c) => {
            const total = c.total ?? 0;
            const done = c.done ?? 0;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const st = cycleState(c, today);
            const next = nextOf(c);
            if (editing === c.id) {
              return (
                <li key={c.id} className="track-cycle is-editing">
                  <CycleForm projectId={projectId} cycle={c} cycles={cycles} today={today} onCancel={() => setEditing(null)} onSaved={saved} />
                </li>
              );
            }
            return (
              <li key={c.id} className={`track-cycle is-${st}`} data-testid="track-cycle">
                <div className="track-cycle-head">
                  <span className="track-cycle-name">{c.name}</span>
                  <span className="track-cycle-state">{t(`cycles.state.${st}`)}</span>
                  <span className="track-cycle-dates">{range(c)}</span>
                </div>
                {st === 'upcoming' && total === 0 ? null : (
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
                  <span className="track-cycle-count">{t('cycles.progress', { done, total })}</span>
                </div>
                )}
                {completing === c.id ? (
                  <CompleteCycle
                    cycle={c}
                    next={next}
                    onCancel={() => setCompleting(null)}
                    onDone={async (moved, targetName) => {
                      setCompleting(null);
                      setNotice(
                        targetName
                          ? t('cycles.movedTo', { count: moved, name: targetName })
                          : t('cycles.movedOut', { count: moved }),
                      );
                      await onChanged();
                    }}
                  />
                ) : (
                  <div className="track-cycle-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(c.id)}>
                      {t('cycles.edit')}
                    </button>
                    {st !== 'upcoming' && total > done && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setCompleting(c.id)}
                        data-testid="track-complete-cycle"
                      >
                        {t('cycles.complete')}
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

function CycleForm({
  projectId,
  cycle,
  cycles,
  today,
  onCancel,
  onSaved,
}: {
  projectId: string;
  cycle: CycleWithProgress | null;
  cycles: CycleWithProgress[];
  today: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('track');
  const locale = useLocale();
  const [draft] = useState(() => nextCycleDraft(cycles, today));
  const defaultName = t('cycles.defaultName', { n: draft.n });
  const [name, setName] = useState(cycle?.name ?? defaultName);
  const [startAt, setStartAt] = useState(cycle ? day(cycle.start_at) : draft.startAt);
  const [endAt, setEndAt] = useState(cycle ? day(cycle.end_at) : draft.endAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalidRange = !!startAt && !!endAt && endAt < startAt;
  // Dos ciclos no pueden pisarse: un issue tendría dos "ciclos activos".
  const overlap =
    !invalidRange && startAt && endAt
      ? overlappingCycle(cycles, startAt, endAt, cycle?.id)
      : undefined;
  const problem = invalidRange
    ? t('cycles.invalidRange')
    : overlap
      ? t('cycles.overlap', {
          name: overlap.name,
          range: `${formatDay(day(overlap.start_at), locale, today)} – ${formatDay(day(overlap.end_at), locale, today)}`,
        })
      : null;
  const prefix = cycle ? `cycle-${cycle.id}` : 'cycle-new';
  const finalName = name.trim() || (cycle ? cycle.name : defaultName);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!startAt || !endAt || problem || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(cycle ? `/api/track/cycles/${cycle.id}` : `/api/track/projects/${projectId}/cycles`, {
      method: cycle ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: finalName, startAt, endAt }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      onSaved();
      return;
    }
    setError(res?.status === 409 ? t('errors.cycle_overlap') : t('errors.generic'));
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
      data-testid="track-cycle-form"
    >
      <div className="ui-field">
        <label className="label" htmlFor={`${prefix}-name`}>
          {t('cycles.form.name')} <span className="ui-optional">{t('common.optional')}</span>
        </label>
        <input
          id={`${prefix}-name`}
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={cycle ? cycle.name : defaultName}
          maxLength={200}
          autoFocus
        />
      </div>
      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor={`${prefix}-start`}>
            {t('cycles.form.startAt')}
          </label>
          <input
            id={`${prefix}-start`}
            className="input"
            type="date"
            lang={locale}
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            aria-invalid={Boolean(overlap) || undefined}
            aria-describedby={problem ? `${prefix}-err` : undefined}
            required
          />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${prefix}-end`}>
            {t('cycles.form.endAt')}
          </label>
          <input
            id={`${prefix}-end`}
            className="input"
            type="date"
            lang={locale}
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            aria-invalid={Boolean(problem) || undefined}
            aria-describedby={problem ? `${prefix}-err` : undefined}
            required
          />
        </div>
      </div>
      {(error || problem) && (
        <p className="ui-error" id={`${prefix}-err`} role="alert">
          {error ?? problem}
        </p>
      )}
      <div className="track-inline-form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={!startAt || !endAt || Boolean(problem)}
          aria-busy={busy || undefined}
        >
          {cycle ? t('cycles.save') : t('cycles.create')}
        </button>
      </div>
    </form>
  );
}

function CompleteCycle({
  cycle,
  next,
  onCancel,
  onDone,
}: {
  cycle: CycleWithProgress;
  next: CycleWithProgress | null;
  onCancel: () => void;
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
      body: JSON.stringify({ targetCycleId: next ? next.id : null }),
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
    <div className="track-cycle-confirm" role="group" aria-label={t('cycles.completeTitle', { name: cycle.name })}>
      <p>
        {next
          ? t('cycles.completeMove', { count: unfinished, name: next.name })
          : t('cycles.completeNoNext', { count: unfinished })}
      </p>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <div className="track-inline-form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => void submit()}
          aria-busy={busy || undefined}
          data-testid="track-complete-cycle-confirm"
        >
          {t('cycles.completeConfirm')}
        </button>
      </div>
    </div>
  );
}
