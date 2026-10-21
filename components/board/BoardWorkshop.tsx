'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { elementText, type SceneEl } from '@/lib/board-stickies';
import { formatCountdown } from '@/lib/board-view';
import type { TimerView, VotingView } from '@/lib/board-workshop';
import type { CanvasApi } from './ExcalidrawCanvas';
import NotesIcon from '@/components/notes/NotesIcon';
import { usePopover } from '@/components/notes/usePopover';

const PRESETS = [1, 3, 5, 10];

/** Milisegundos que faltan, recalculados cada segundo con el desfase del servidor. */
export function useCountdown(timer: TimerView | null, skew: number): number {
  const [, tick] = useState(0);
  const running = timer?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const h = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, [running]);
  if (!timer) return 0;
  if (timer.status === 'running' && timer.ends_at) return Math.max(0, Date.parse(timer.ends_at) - (Date.now() + skew));
  return timer.remaining_ms;
}

/** Cuenta regresiva en la barra: la ve todo el que tiene la pizarra abierta. */
export function TimerChip({ timer, skew }: { timer: TimerView | null; skew: number }) {
  const t = useTranslations('board.workshop');
  const left = useCountdown(timer, skew);
  if (!timer || timer.status === 'idle') return null;
  const done = timer.status === 'done' || (timer.status === 'running' && left <= 0);
  return (
    <span
      className={`board-timer-chip mono${done ? ' is-done' : ''}${timer.status === 'paused' ? ' is-paused' : ''}`}
      role="timer"
      aria-live={done ? 'assertive' : 'off'}
    >
      <NotesIcon name="timer" size={13} />
      {done ? t('timeUp') : formatCountdown(left)}
      {timer.status === 'paused' && <span className="sr-only">{t('paused')}</span>}
    </span>
  );
}

/**
 * Taller: timer compartido y votación con puntos. Quien edita maneja el timer
 * y abre/cierra votaciones; quien solo ve, vota y mira el timer.
 */
export default function BoardWorkshop({
  api,
  timer,
  voting,
  skew,
  canRun,
  error,
  send,
}: {
  api: CanvasApi | null;
  timer: TimerView | null;
  voting: VotingView | null;
  skew: number;
  canRun: boolean;
  error: boolean;
  send: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useTranslations('board.workshop');
  const pop = usePopover();
  const [minutes, setMinutes] = useState('5');
  const [perPerson, setPerPerson] = useState('3');
  const [busy, setBusy] = useState(false);
  const left = useCountdown(timer, skew);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    await send(body);
    setBusy(false);
  }

  const status = timer?.status ?? 'idle';
  const active = status === 'running' || status === 'paused' || voting?.status === 'open';

  /** Texto de un elemento votado (para la lista de resultados). */
  function label(id: string): string {
    if (!api) return id;
    const els = api.getSceneElements() as SceneEl[];
    const byId = new Map(els.map((e) => [e.id, e]));
    const el = byId.get(id);
    if (!el) return t('deletedElement');
    return elementText(el, byId).replace(/\s+/g, ' ').slice(0, 80) || t('untitledElement');
  }

  function focus(id: string) {
    if (!api) return;
    const el = (api.getSceneElements() as SceneEl[]).find((e) => e.id === id);
    if (!el) return;
    api.updateScene({ appState: { selectedElementIds: { [id]: true } } });
    api.scrollToContent([el], { fitToContent: false, animate: true });
  }

  const mins = Math.round(Number(minutes) * 60);

  return (
    <div className="board-share-wrap board-tool-wrap" ref={pop.wrapRef}>
      <button
        ref={pop.buttonRef}
        type="button"
        className={`btn btn-sm${pop.open || active ? ' is-on' : ''}`}
        onClick={pop.toggle}
        aria-expanded={pop.open}
        aria-haspopup="dialog"
      >
        <NotesIcon name="vote" size={14} />
        <span className="board-bar-label">{t('button')}</span>
      </button>
      {pop.open && (
        <div className="board-pop board-workshop-pop" role="dialog" aria-label={t('title')}>
          <p className="board-pop-title">{t('timerTitle')}</p>
          {status === 'idle' ? (
            canRun ? (
              <>
                <div className="board-pop-actions">
                  {PRESETS.map((m) => (
                    <button key={m} type="button" className="btn btn-sm" disabled={busy} onClick={() => void run({ timer: { action: 'start', seconds: m * 60 } })}>
                      {t('minutes', { count: m })}
                    </button>
                  ))}
                </div>
                <div className="board-share-row">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={240}
                    step={1}
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                    aria-label={t('customMinutes')}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={busy || !(mins >= 10 && mins <= 4 * 3600)}
                    onClick={() => void run({ timer: { action: 'start', seconds: mins } })}
                  >
                    {t('start')}
                  </button>
                </div>
              </>
            ) : (
              <p className="board-pop-hint">{t('noTimer')}</p>
            )
          ) : (
            <>
              <p className={`board-timer-big mono${status === 'done' || left <= 0 ? ' is-done' : ''}`} role="timer">
                {status === 'done' || (status === 'running' && left <= 0) ? t('timeUp') : formatCountdown(left)}
                {status === 'paused' && <span className="board-timer-state"> · {t('paused')}</span>}
              </p>
              {canRun && (
                <div className="board-pop-actions">
                  {status === 'running' && (
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run({ timer: { action: 'pause' } })}>
                      {t('pause')}
                    </button>
                  )}
                  {status === 'paused' && (
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run({ timer: { action: 'resume' } })}>
                      {t('resume')}
                    </button>
                  )}
                  {status !== 'done' && (
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run({ timer: { action: 'add', seconds: 60 } })}>
                      {t('addMinute')}
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void run({ timer: { action: 'stop' } })}>
                    {status === 'done' ? t('clear') : t('stop')}
                  </button>
                </div>
              )}
            </>
          )}

          <div className="board-pop-section">
            <p className="board-pop-title">{t('votingTitle')}</p>
            {!voting ? (
              canRun ? (
                <>
                  <p className="board-pop-hint">{t('votingHint')}</p>
                  <div className="board-share-row">
                    <label className="board-inline-label">
                      {t('perPerson')}
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={20}
                        value={perPerson}
                        onChange={(e) => setPerPerson(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busy || !(Number(perPerson) >= 1 && Number(perPerson) <= 20)}
                      onClick={() => void run({ vote: { action: 'start', votesPerPerson: Math.round(Number(perPerson)) } })}
                    >
                      {t('startVoting')}
                    </button>
                  </div>
                </>
              ) : (
                <p className="board-pop-hint">{t('noVoting')}</p>
              )
            ) : voting.status === 'open' ? (
              <>
                <p className="board-pop-hint">{t('votingOpen', { left: voting.left, total: voting.votes_per_person })}</p>
                <p className="board-pop-hint">{t('voters', { count: voting.voters })}</p>
                {canRun && (
                  <button type="button" className="btn btn-sm btn-primary board-pop-start" disabled={busy} onClick={() => void run({ vote: { action: 'close' } })}>
                    {t('closeVoting')}
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="board-pop-hint">{t('results', { count: voting.voters })}</p>
                {voting.results && voting.results.length > 0 ? (
                  <ol className="board-results">
                    {voting.results.slice(0, 10).map((r) => (
                      <li key={r.element_id}>
                        <button type="button" className="board-results-item" onClick={() => focus(r.element_id)}>
                          <span className="board-results-count num">{r.count}</span>
                          <span className="board-results-text">{label(r.element_id)}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="board-pop-hint">{t('noVotes')}</p>
                )}
                {canRun && (
                  <div className="board-pop-actions">
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run({ vote: { action: 'clear' } })}>
                      {t('clearResults')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          {error && (
            <p className="ui-error" role="alert">
              {t('error')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
