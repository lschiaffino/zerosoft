'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayCandidateDto, ReplayResultDto } from '@/lib/agents-sim';
import { api, errorText, toolName } from './agents-ui';

/**
 * Repetir conversaciones reales en lote: los mensajes de las últimas
 * conversaciones se mandan al borrador (simulado) y se ve lo que contestó
 * antes al lado de lo que contesta ahora, con la comparación de un juez.
 * Una conversación por request, como los tests.
 */
export default function AgentReplay({ agentId, aiEnabled, dirty }: { agentId: string; aiEnabled: boolean; dirty: boolean }) {
  const t = useTranslations('agents');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ReplayResultDto[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setResults([]);
    const list = await api<{ conversations?: ReplayCandidateDto[] }>(`/api/agents/${agentId}/replay?limit=10`);
    if (!list.ok) {
      setRunning(false);
      setError(errorText(t, list.data.error));
      return;
    }
    const convs = list.data.conversations ?? [];
    setProgress({ done: 0, total: convs.length });
    for (const [i, c] of convs.entries()) {
      const res = await api<{ result?: ReplayResultDto }>(`/api/agents/${agentId}/replay`, {
        method: 'POST',
        body: JSON.stringify({ conversationId: c.id }),
      });
      if (!res.ok || !res.data.result) {
        setError(errorText(t, res.data.error));
        if (res.data.error === 'ai_disabled' || res.data.error === 'quota_exceeded') break;
      } else {
        const r = res.data.result;
        setResults((prev) => [...(prev ?? []), r]);
      }
      setProgress({ done: i + 1, total: convs.length });
    }
    setRunning(false);
  }

  return (
    <section className="ag-block ag-replay" aria-labelledby="ag-replay-title">
      <div className="ag-section-head">
        <h3 id="ag-replay-title" className="ui-section-title">
          {t('replay.title')}
        </h3>
        <button type="button" className="btn btn-secondary btn-sm" disabled={running || !aiEnabled} aria-busy={running || undefined} onClick={() => void run()}>
          {running ? t('replay.running', { done: progress?.done ?? 0, total: progress?.total ?? 0 }) : t('replay.run')}
        </button>
      </div>
      <p className={dirty ? 'ui-error' : 'ui-help'}>{dirty ? t('tests.dirty') : t('replay.hint')}</p>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {results && !running && results.length === 0 && !error && <p className="ag-quiet">{t('replay.empty')}</p>}
      {results && results.length > 0 && (
        <ul className="ag-rows">
          {results.map((r) => (
            <li key={r.conversationId} className="ag-replay-item">
              <button
                type="button"
                className="ag-replay-row"
                aria-expanded={open === r.conversationId}
                onClick={() => setOpen(open === r.conversationId ? null : r.conversationId)}
              >
                <span className="ag-url-title">{r.title || t('conversations.untitled')}</span>
                {r.error ? (
                  <span className="badge badge-bad">{errorText(t, r.error)}</span>
                ) : (
                  r.verdict && <span className={`badge${r.verdict === 'better' ? ' badge-ok' : r.verdict === 'worse' ? ' badge-bad' : ''}`}>{t(`replay.verdict.${r.verdict}`)}</span>
                )}
              </button>
              {r.reason && <p className="ui-help">{r.reason}</p>}
              {open === r.conversationId && (
                <div className="ag-replay-turns">
                  {r.turns.map((turn, i) => (
                    <div key={i} className="ag-replay-turn">
                      <p className="ag-replay-visitor">
                        <span className="label">{t('replay.visitor')}</span> {turn.visitor}
                      </p>
                      <div className="ag-replay-compare">
                        <div>
                          <p className="label">{t('replay.before')}</p>
                          <p className="ag-msg-text">{turn.before || t('replay.noReply')}</p>
                        </div>
                        <div>
                          <p className="label">{t('replay.after')}</p>
                          <p className="ag-msg-text">{turn.after || t('replay.noReply')}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {r.tools.length > 0 && (
                    <p className="ui-help">
                      {t('tests.tools')}: {r.tools.map((c) => toolName(t, c.tool)).join(', ')}
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
