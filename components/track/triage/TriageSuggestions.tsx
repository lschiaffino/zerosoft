'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TriageSuggestion } from '@/lib/track-ai';
import { aiErrorKey, call } from './api';

/**
 * Sugerencias de triage con IA (asignado, label, prioridad, duplicado), como
 * Triage Intelligence de Linear: cada una con su porqué, se acepta o se
 * descarta con un clic. Las pide sola la primera vez que se muestran.
 */
export default function TriageSuggestions({ issueId, onApplied }: { issueId: string; onApplied?: () => void }) {
  const t = useTranslations('trackTriage.ai');
  const tr = useTranslations('trackTriage');
  const [list, setList] = useState<TriageSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await call<{ suggestions: TriageSuggestion[] }>(`/api/track/issues/${issueId}/ai/suggestions`, { method: 'POST' });
    setLoading(false);
    if (res.ok) {
      setList(res.data.suggestions);
      // Las de modo "auto" ya se aplicaron: el issue cambió.
      if (res.data.suggestions.some((s) => s.status === 'accepted')) onApplied?.();
    } else setError(tr(aiErrorKey(res.error, 'ai.error')));
  }, [issueId, onApplied, tr]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await call<{ suggestions: TriageSuggestion[]; generatedAt: string | null }>(`/api/track/issues/${issueId}/ai/suggestions`);
      if (cancelled) return;
      if (res.ok && res.data.generatedAt) setList(res.data.suggestions);
      else if (res.ok) void generate();
    })();
    return () => {
      cancelled = true;
    };
    // Solo al montar para este issue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId]);

  const decide = async (s: TriageSuggestion, decision: 'accept' | 'dismiss') => {
    setBusy(s.id);
    const res = await call<{ suggestions: TriageSuggestion[] }>(`/api/track/issues/${issueId}/ai/suggestions/${s.id}`, {
      method: 'POST',
      json: { decision },
    });
    setBusy(null);
    if (res.ok) {
      setList(res.data.suggestions);
      if (decision === 'accept') onApplied?.();
    } else setError(tr(aiErrorKey(res.error, 'ai.error')));
  };

  const pending = (list ?? []).filter((s) => s.status === 'pending');

  return (
    <div className="track-ai-suggest" data-testid="track-ai-suggestions" aria-live="polite">
      <span className="track-ai-suggest-label">{t('suggestions')}</span>
      {loading && <span className="track-ai-suggest-note">{t('loading')}</span>}
      {!loading && error && (
        <span className="ui-error" role="alert">
          {error}
        </span>
      )}
      {!loading && !error && list && pending.length === 0 && <span className="track-ai-suggest-note">{t('none')}</span>}
      {pending.map((s) => (
        <span key={s.id} className="track-ai-chip" data-testid="track-ai-suggestion" data-kind={s.kind} title={s.reason}>
          <span className="track-ai-chip-kind">{t(`kinds.${s.kind}`)}</span>
          <span className="track-ai-chip-value">{s.kind === 'priority' ? tr(`priorities.${s.value}`) : s.label}</span>
          <span className="sr-only">{s.reason}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy === s.id}
            onClick={() => void decide(s, 'accept')}
            data-testid="track-ai-accept"
          >
            {t('accept')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy === s.id}
            onClick={() => void decide(s, 'dismiss')}
            aria-label={`${t('dismiss')}: ${t(`kinds.${s.kind}`)} ${s.label}`}
            data-testid="track-ai-dismiss"
          >
            {t('dismiss')}
          </button>
        </span>
      ))}
      {!loading && (list !== null || error) && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void generate()} data-testid="track-ai-refresh">
          {list === null ? t('suggest') : t('refresh')}
        </button>
      )}
    </div>
  );
}
