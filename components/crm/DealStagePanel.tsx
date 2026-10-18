'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

const KNOWN_ERRORS = new Set(['missing_lost_reason', 'invalid_stage', 'not_found', 'generic']);
const LOST_REASON_KEYS = ['price', 'timing', 'competitor', 'no budget', 'went silent', 'other'] as const;

export interface StageOption {
  id: string;
  name: string;
  is_won: 0 | 1;
  is_lost: 0 | 1;
}

interface DealStagePanelProps {
  dealId: string;
  stages: StageOption[];
  currentStageId: string;
}

/** Select de stage del pipeline del deal → POST /move (lost pide motivo, won confirma). */
export default function DealStagePanel({ dealId, stages, currentStageId }: DealStagePanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [pending, setPending] = useState<StageOption | null>(null);
  const [reasonKey, setReasonKey] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function move(stageId: string, lostReason?: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/deals/${dealId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stageId,
        ...(lostReason !== undefined ? { lostReason } : {}),
      }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) {
      setPending(null);
      router.refresh();
      return;
    }
    const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = body?.error ?? 'generic';
    setError(t(KNOWN_ERRORS.has(code) ? `errors.${code}` : 'errors.generic'));
  }

  function onSelect(stageId: string) {
    const stage = stages.find((s) => s.id === stageId);
    if (!stage || stageId === currentStageId) return;
    setError(null);
    if (stage.is_lost) {
      setReasonKey('');
      setReasonText('');
      setPending(stage);
      return;
    }
    if (stage.is_won) {
      setPending(stage);
      return;
    }
    void move(stageId);
  }

  function confirmLost() {
    if (!pending) return;
    const reason = reasonText.trim() || reasonKey;
    if (!reason) {
      setError(t('errors.missing_lost_reason'));
      return;
    }
    const label = reasonText.trim() || t(`deals.lostDialog.reasons.${reasonKey}`);
    void move(pending.id, label);
  }

  const openStages = stages.filter((s) => !s.is_won && !s.is_lost);
  const wonStage = stages.find((s) => s.is_won);
  const lostStage = stages.find((s) => s.is_lost);
  const currentIdx = openStages.findIndex((s) => s.id === currentStageId);
  const closedWon = wonStage?.id === currentStageId;
  const closedLost = lostStage?.id === currentStageId;

  return (
    <div className="deal-stage">
      <div className="stage-row-wrap">
        <ol className={`stage-progress${closedLost ? ' is-lost' : ''}`} aria-label={t('deals.form.stage')}>
          {openStages.map((s, i) => {
            const state =
              s.id === currentStageId ? 'current' : closedWon || i < currentIdx ? 'done' : 'todo';
            return (
              <li key={s.id} className="stage-step" data-state={state}>
                <button
                  type="button"
                  className="stage-step-btn"
                  aria-current={s.id === currentStageId ? 'step' : undefined}
                  disabled={busy}
                  onClick={() => onSelect(s.id)}
                  title={s.name}
                >
                  <span className="stage-seg" aria-hidden="true" />
                  <span className="stage-name">{s.name}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="stage-close">
          {wonStage && (
            <button
              type="button"
              className={`btn btn-sm ${closedWon ? 'btn-primary' : 'btn-secondary'}`}
              aria-pressed={closedWon}
              disabled={busy || closedWon}
              onClick={() => onSelect(wonStage.id)}
            >
              {t('deals.won')}
            </button>
          )}
          {lostStage && (
            <button
              type="button"
              className={`btn btn-sm btn-danger ${closedLost ? 'btn-primary' : 'btn-secondary'}`}
              aria-pressed={closedLost}
              disabled={busy || closedLost}
              onClick={() => onSelect(lostStage.id)}
            >
              {t('deals.lost')}
            </button>
          )}
        </div>
      </div>
      {pending?.is_lost ? (
        <div className="stage-confirm" role="group" aria-label={t('deals.lostDialog.title')}>
          <p className="ui-help">{t('deals.lostDialog.sub')}</p>
          <div className="ui-fields-2">
            <select
              className="select"
              value={reasonKey}
              onChange={(e) => setReasonKey(e.target.value)}
              aria-label={t('deals.lostDialog.lostReason')}
            >
              <option value="">{t('deals.lostDialog.reasonPlaceholder')}</option>
              {LOST_REASON_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`deals.lostDialog.reasons.${k}`)}
                </option>
              ))}
            </select>
            <input
              className="input"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder={t('deals.lostDialog.lostReason')}
              aria-label={t('deals.lostDialog.lostReason')}
              maxLength={500}
            />
          </div>
          <div className="stage-confirm-actions">
            <button type="button" className="btn btn-primary btn-danger btn-sm" aria-busy={busy || undefined} disabled={busy} onClick={confirmLost}>
              {t('deals.lostDialog.confirm')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : pending?.is_won ? (
        <div className="stage-confirm" role="group" aria-label={t('deals.wonDialog.title')}>
          <p className="ui-help">{t('deals.wonDialog.sub')}</p>
          <div className="stage-confirm-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              aria-busy={busy || undefined}
              disabled={busy}
              onClick={() => void move(pending.id)}
            >
              {t('deals.wonDialog.confirm')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : null}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
