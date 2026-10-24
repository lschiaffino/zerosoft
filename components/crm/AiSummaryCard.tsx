'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { RecordSummary } from '@/lib/crm-ai';
import { aiErrorKey, formatAiWhen } from './aiShared';
import { useCrmAdmin } from './CrmViewer';

export interface SummaryState {
  content: RecordSummary;
  updatedAt: string;
  stale: boolean;
}

/**
 * Resumen con IA de un contacto, empresa o deal (arriba del panel lateral de
 * la ficha). Se genera a pedido, queda guardado y avisa cuando hay
 * actividad nueva desde el último resumen.
 */
export default function AiSummaryCard({
  entity,
  id,
  locale,
  initial,
  available,
}: {
  entity: 'contact' | 'company' | 'deal';
  id: string;
  locale: string;
  initial: SummaryState | null;
  available: boolean;
}) {
  const t = useTranslations('crm.ai');
  const isAdmin = useCrmAdmin();
  const [summary, setSummary] = useState<SummaryState | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/ai/summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity, id, locale }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { summary?: SummaryState; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !data?.summary) {
      setError(t(aiErrorKey(data?.error, isAdmin)));
      return;
    }
    setSummary(data.summary);
  }

  return (
    <section className="record-summary-block ai-card" aria-labelledby={`ai-summary-${id}`} aria-busy={busy}>
      <h2 className="record-summary-title" id={`ai-summary-${id}`}>
        {t('summary.title')}
      </h2>
      {summary ? (
        <>
          <p className="ai-text" data-testid="ai-summary-text">
            {summary.content.summary}
          </p>
          {summary.content.highlights.length > 0 && (
            <ul className="ai-list">
              {summary.content.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
          {summary.content.nextSteps.length > 0 && (
            <>
              <h3 className="ai-subtitle">{t('summary.nextSteps')}</h3>
              <ul className="ai-list">
                {summary.content.nextSteps.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </>
          )}
          <p className="ai-meta">
            {summary.stale ? <span className="ai-stale">{t('summary.stale')}</span> : null}
            <span>{t('updatedAt', { when: formatAiWhen(summary.updatedAt, locale) })}</span>
          </p>
        </>
      ) : (
        <p className="muted ai-empty">{available ? t('summary.empty') : t(aiErrorKey('ai_disabled', isAdmin))}</p>
      )}
      {busy && <p className="muted" role="status">{t('summary.loading')}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="ai-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={generate} disabled={busy}>
          {busy ? t('working') : summary ? t('regenerate') : t('summary.generate')}
        </button>
      </div>
    </section>
  );
}
