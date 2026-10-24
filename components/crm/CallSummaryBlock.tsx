'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { CallSummary } from '@/lib/crm-ai';
import { aiErrorKey, dayFromToday } from './aiShared';
import { useCrmAdmin } from './CrmViewer';

export interface CallSummaryState {
  content: CallSummary;
  updatedAt: string;
}

/**
 * Resumen con IA de una llamada o reunión del timeline: lo hablado, el tono y
 * los próximos pasos (cada uno se crea como tarea del mismo registro). Lee
 * las notas de la actividad y las transcripciones adjuntas (.txt, .vtt, .srt).
 */
export default function CallSummaryBlock({
  activityId,
  locale,
  initial,
  links,
}: {
  activityId: string;
  locale: string;
  initial: CallSummaryState | null;
  /** Registro al que se asocian las tareas de los próximos pasos. */
  links: { contactId?: string | null; companyId?: string | null; dealId?: string | null };
}) {
  const t = useTranslations('crm.ai');
  const isAdmin = useCrmAdmin();
  const router = useRouter();
  const [data, setData] = useState<CallSummaryState | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState(true);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/ai/call-summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ activityId, locale }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { summary?: CallSummaryState; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !json?.summary) {
      setError(t(aiErrorKey(json?.error, isAdmin)));
      return;
    }
    setData(json.summary);
    setAdded(new Set());
    setOpen(true);
  }

  async function addTask(i: number) {
    const step = data?.content.nextSteps[i];
    if (!step) return;
    const res = await fetch('/api/crm/activities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'task',
        subject: step.slice(0, 200),
        dueAt: `${dayFromToday(1)} 09:00`,
        contactId: links.contactId ?? undefined,
        companyId: links.companyId ?? undefined,
        dealId: links.dealId ?? undefined,
      }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(t('errors.generic'));
      return;
    }
    setAdded((s) => new Set(s).add(i));
    router.refresh();
  }

  if (!data) {
    return (
      <div className="ai-call">
        <button type="button" className="btn btn-ghost btn-sm" onClick={generate} disabled={busy}>
          {busy ? t('working') : t('call.generate')}
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="ai-call ai-call-filled" aria-busy={busy}>
      <div className="ai-call-head">
        <button type="button" className="ai-call-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {t('call.title')}
        </button>
        <span className={`ai-sentiment ai-sentiment-${data.content.sentiment}`}>{t(`call.sentiment.${data.content.sentiment}`)}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={generate} disabled={busy}>
          {busy ? t('working') : t('regenerate')}
        </button>
      </div>
      {open && (
        <>
          <p className="ai-text" data-testid="ai-call-summary">
            {data.content.summary}
          </p>
          {data.content.nextSteps.length > 0 && (
            <>
              <h4 className="ai-subtitle">{t('call.nextSteps')}</h4>
              <ul className="ai-plan">
                {data.content.nextSteps.map((s, i) => (
                  <li key={i}>
                    <span className="ai-plan-title">{s}</span>
                    {added.has(i) ? (
                      <span className="ai-plan-done">{t('score.added')}</span>
                    ) : (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => addTask(i)} aria-label={`${t('score.addTask')}: ${s}`}>
                        {t('score.addTask')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
