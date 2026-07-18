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

  return (
    <div className="deal-stage">
      <select
        className="select"
        value={pending?.id ?? currentStageId}
        disabled={busy}
        aria-label={t('deals.form.stage')}
        onChange={(e) => onSelect(e.target.value)}
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.is_won ? ` · ${t('deals.won')}` : s.is_lost ? ` · ${t('deals.lost')}` : ''}
          </option>
        ))}
      </select>

      {pending?.is_lost ? (
        <div className="stage-confirm">
          <p className="muted">{t('deals.lostDialog.sub')}</p>
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
            maxLength={500}
          />
          <div className="form-actions">
            <button type="button" className="btn btn-solid btn-small" disabled={busy} onClick={confirmLost}>
              {t('deals.lostDialog.confirm')}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : pending?.is_won ? (
        <div className="stage-confirm">
          <p className="muted">{t('deals.wonDialog.sub')}</p>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-solid btn-small"
              disabled={busy}
              onClick={() => void move(pending.id)}
            >
              {t('deals.wonDialog.confirm')}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
