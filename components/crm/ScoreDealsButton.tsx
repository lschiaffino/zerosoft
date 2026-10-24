'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { aiErrorKey } from './aiShared';

/**
 * "Score deals with AI" del board: pide el score de los deals abiertos del
 * pipeline que no tienen o que tuvieron actividad después, de a tandas, y
 * refresca el board al terminar.
 */
export default function ScoreDealsButton({ pipelineId, locale }: { pipelineId: string; locale: string }) {
  const t = useTranslations('crm.ai');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    let total = 0;
    for (let round = 0; round < 20; round++) {
      const res = await fetch('/api/crm/ai/deal-score/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pipelineId, locale }),
      }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { scored?: number; remaining?: number; error?: string } | null;
      if (!res?.ok || !data) {
        setMessage({ text: t(aiErrorKey(data?.error)), error: true });
        break;
      }
      total += data.scored ?? 0;
      setMessage({ text: t('board.progress', { done: total, left: data.remaining ?? 0 }), error: false });
      if (!data.remaining || !data.scored) {
        setMessage({ text: total ? t('board.done', { count: total }) : t('board.upToDate'), error: false });
        break;
      }
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <span className="ai-board">
      <button type="button" className="btn btn-secondary btn-sm" onClick={run} disabled={busy} aria-describedby="ai-board-status">
        {busy ? t('working') : t('board.scoreDeals')}
      </button>
      <span id="ai-board-status" className={message?.error ? 'form-error' : 'muted'} role="status">
        {message?.text ?? ''}
      </span>
    </span>
  );
}
