'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { DealScore } from '@/lib/crm-ai';
import { aiErrorKey, dayFromToday, formatAiWhen } from './aiShared';
import { useCrmAdmin } from './CrmViewer';

export interface DealScoreState {
  content: DealScore;
  updatedAt: string;
  stale: boolean;
}

export function scoreBand(score: number): 'high' | 'medium' | 'low' {
  return score >= 65 ? 'high' : score >= 35 ? 'medium' : 'low';
}

/**
 * Score del deal con IA (probabilidad de cerrar con razones) y plan del deal
 * (próximos pasos que se convierten en tareas con un click).
 */
export default function DealInsightCard({
  dealId,
  locale,
  initial,
  available,
  closed,
}: {
  dealId: string;
  locale: string;
  initial: DealScoreState | null;
  available: boolean;
  closed: boolean;
}) {
  const t = useTranslations('crm.ai');
  const isAdmin = useCrmAdmin();
  const router = useRouter();
  const [data, setData] = useState<DealScoreState | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | null>(null);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/ai/deal-score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: dealId, locale }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { score?: DealScoreState; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !json?.score) {
      setError(t(aiErrorKey(json?.error, isAdmin)));
      return;
    }
    setData(json.score);
  }

  async function addTask(i: number) {
    const step = data?.content.plan[i];
    if (!step || step.taskId || adding !== null) return;
    setAdding(i);
    setError(null);
    // El servidor crea la tarea y la marca en el plan guardado (una sola vez).
    const res = await fetch('/api/crm/ai/deal-score', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: dealId, index: i, dueAt: `${dayFromToday(step.dueInDays)} 09:00` }),
    }).catch(() => null);
    setAdding(null);
    const json = (await res?.json().catch(() => null)) as { taskId?: string; error?: string } | null;
    if (!res?.ok && json?.error !== 'already_added') {
      setError(t('errors.generic'));
      return;
    }
    const taskId = json?.taskId ?? 'pending';
    setData((d) => (d ? { ...d, content: { ...d.content, plan: d.content.plan.map((p, j) => (j === i ? { ...p, taskId } : p)) } } : d));
    router.refresh();
  }

  if (closed) return null;
  const band = data ? scoreBand(data.content.score) : null;

  return (
    <section className="record-summary-block ai-card" aria-labelledby={`ai-score-${dealId}`} aria-busy={busy}>
      <h2 className="record-summary-title" id={`ai-score-${dealId}`}>
        {t('score.title')}
        {data && (
          <span className={`ai-score ai-score-${band}`} data-testid="ai-deal-score" title={t(`score.band.${band}`)}>
            {data.content.score}
          </span>
        )}
      </h2>
      {data ? (
        <>
          <p className="ai-meta">{t(`score.band.${band}`)}</p>
          {data.content.reasons.length > 0 && (
            <ul className="ai-list ai-reasons">
              {data.content.reasons.map((r, i) => (
                <li key={i} className={`ai-reason-${r.effect}`}>
                  <span className="ai-reason-mark" aria-label={t(`score.effect.${r.effect}`)}>
                    {r.effect === 'positive' ? '+' : '−'}
                  </span>
                  {r.text}
                </li>
              ))}
            </ul>
          )}
          {data.content.plan.length > 0 && (
            <>
              <h3 className="ai-subtitle">{t('score.plan')}</h3>
              <ul className="ai-plan">
                {data.content.plan.map((p, i) => (
                  <li key={i}>
                    <span className="ai-plan-title">{p.title}</span>
                    <span className="ai-plan-due muted">{p.dueInDays === 0 ? t('score.today') : t('score.inDays', { days: p.dueInDays })}</span>
                    {p.taskId ? (
                      <span className="ai-plan-done">{t('score.added')}</span>
                    ) : (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => addTask(i)} disabled={adding !== null} aria-label={`${t('score.addTask')}: ${p.title}`}>
                        {t('score.addTask')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="ai-meta">
            {data.stale ? <span className="ai-stale">{t('score.stale')}</span> : null}
            <span>{t('updatedAt', { when: formatAiWhen(data.updatedAt, locale) })}</span>
          </p>
        </>
      ) : (
        <p className="muted ai-empty">{available ? t('score.empty') : t(aiErrorKey('ai_disabled', isAdmin))}</p>
      )}
      {busy && <p className="muted" role="status">{t('score.loading')}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="ai-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={generate} disabled={busy}>
          {busy ? t('working') : data ? t('score.rescore') : t('score.generate')}
        </button>
      </div>
    </section>
  );
}
