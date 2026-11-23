'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { composeErrorKey } from '@/lib/ai-compose';
import type { ChatAnswer, ChatInsights, ChatProposal, ProposalKind } from '@/lib/groups-ai-rules';
import { Link } from '@/i18n/navigation';
import { Sparkle } from './icons';

export type AiResult<T> = { ok: true; data: T } | { ok: false; code: string };

export interface CreatedRef {
  kind: ProposalKind;
  href: string;
  /** "#12" de un ticket o el título de la tarea. */
  label: string;
}

interface Proposal extends ChatProposal {
  key: string;
  state: 'open' | 'busy' | 'created' | 'dismissed';
  created?: CreatedRef;
  error?: string;
}

const SUGGESTIONS = ['summary', 'asked', 'pending'] as const;

/**
 * La pestaña IA del panel de un chat, en Lines y en Inbox (como el AI de Periskope): preguntarle a la IA sobre el
 * chat, el sentimiento con su motivo y tareas propuestas que la persona aprueba una por una (nada se crea sin
 * "Crear"). La IA lee solo los mensajes del chat que la persona ve; cada app pone sus pedidos (`ask`, `analyze`,
 * `create`) y los tipos que puede crear (`kinds`: tarea, y ticket en Lines). Lo leído queda mientras el panel esté
 * montado; cambiar de chat lo vacía (la app le pone `key` con el id del chat).
 */
export default function ChatAiPanel({
  kinds,
  where,
  ask,
  analyze,
  create,
}: {
  kinds: readonly ProposalKind[];
  /** Dónde van las que se crean (una línea de ayuda). */
  where: string;
  ask: (question: string) => Promise<AiResult<ChatAnswer>>;
  analyze: () => Promise<AiResult<ChatInsights & { canCreate?: boolean }>>;
  create: (p: ChatProposal) => Promise<AiResult<CreatedRef>>;
}) {
  const t = useTranslations('groups.wa.details.ai');
  const te = useTranslations('common.aiCompose.errors');
  const errorText = (code: string) => (code === 'no_messages' || code === 'nothing_to_summarize' ? t('noMessages') : te(composeErrorKey(code)));

  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<Array<{ id: number; question: string; answer: string; messages: number }>>([]);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  const seq = useRef(0);

  const [analyzing, setAnalyzing] = useState(false);
  const [insights, setInsights] = useState<(ChatInsights & { canCreate?: boolean }) | null>(null);
  const [analyzeError, setAnalyzeError] = useState('');
  const [proposals, setProposals] = useState<Proposal[]>([]);

  const runAsk = async (q: string) => {
    const clean = q.trim();
    if (!clean || asking) return;
    setAsking(true);
    setAskError('');
    const r = await ask(clean);
    setAsking(false);
    if (!r.ok) {
      setAskError(errorText(r.code));
      return;
    }
    seq.current += 1;
    setAnswers((list) => [...list, { id: seq.current, question: clean, answer: r.data.answer, messages: r.data.messages }].slice(-5));
    setQuestion('');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runAsk(question);
  };

  const runAnalyze = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalyzeError('');
    const r = await analyze();
    setAnalyzing(false);
    if (!r.ok) {
      setAnalyzeError(errorText(r.code));
      return;
    }
    setInsights(r.data);
    seq.current += 1;
    const base = seq.current;
    setProposals(r.data.proposals.map((p, i) => ({ ...p, key: `${base}-${i}`, state: 'open' })));
  };

  const patch = (key: string, change: Partial<Proposal>) => setProposals((list) => list.map((p) => (p.key === key ? { ...p, ...change } : p)));

  const approve = async (p: Proposal) => {
    if (!p.title.trim() || p.state !== 'open') return;
    patch(p.key, { state: 'busy', error: undefined });
    const r = await create({ title: p.title.trim(), notes: p.notes, kind: p.kind, priority: p.priority });
    if (r.ok) patch(p.key, { state: 'created', created: r.data });
    else patch(p.key, { state: 'open', error: t('createError') });
  };

  const canCreate = insights?.canCreate !== false;
  const visible = proposals.filter((p) => p.state !== 'dismissed');

  return (
    <div className="wa-ai" data-testid="chat-ai">
      <section className="gr-detail-section wa-ai-ask" aria-busy={asking || undefined}>
        <h3 className="gr-detail-title">{t('askTitle')}</h3>
        <form className="wa-ai-form" onSubmit={onSubmit}>
          <textarea
            className="input wa-ai-input"
            data-testid="chat-ai-question"
            rows={2}
            maxLength={500}
            value={question}
            placeholder={t('askPlaceholder')}
            aria-label={t('askLabel')}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              // Enter pregunta; Shift+Enter, otra línea.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void runAsk(question);
              }
            }}
          />
          <button type="submit" className="btn btn-secondary btn-sm" data-testid="chat-ai-ask" disabled={!question.trim() || asking}>
            {asking ? t('asking') : t('ask')}
          </button>
        </form>
        <div className="wa-ai-suggest" role="group" aria-label={t('suggestionsLabel')}>
          {SUGGESTIONS.map((k) => (
            <button key={k} type="button" className="btn btn-ghost btn-sm" data-testid={`chat-ai-suggest-${k}`} disabled={asking} onClick={() => void runAsk(t(`suggest.${k}`))}>
              {t(`suggest.${k}`)}
            </button>
          ))}
        </div>
        {askError && (
          <p className="ui-error" role="alert" data-testid="chat-ai-ask-error">
            {askError}
          </p>
        )}
        {answers.length > 0 && (
          <ol className="wa-ai-answers" aria-live="polite">
            {answers.map((a) => (
              <li key={a.id} className="wa-ai-answer" data-testid="chat-ai-answer">
                <p className="wa-ai-q" dir="auto">
                  {a.question}
                </p>
                <p className="wa-ai-a gr-pre" dir="auto">
                  {a.answer}
                </p>
                <p className="ui-help">{t('basedOn', { n: a.messages })}</p>
              </li>
            ))}
          </ol>
        )}
        <p className="ui-help">{t('askHint')}</p>
      </section>

      <section className="gr-detail-section wa-ai-insights" aria-busy={analyzing || undefined}>
        <h3 className="gr-detail-title">{t('analyzeTitle')}</h3>
        {!insights && <p className="ui-help">{t('analyzeHint')}</p>}
        {insights && (
          <div className="wa-ai-sentiment" data-testid="chat-ai-sentiment" data-sentiment={insights.sentiment}>
            <span className="wa-ai-sentiment-mark" aria-hidden="true" />
            <div>
              <p className="wa-ai-sentiment-label">
                {t('sentimentLabel')}: <strong>{t(`sentiment.${insights.sentiment}`)}</strong>
              </p>
              {insights.reason && (
                <p className="ui-help" dir="auto">
                  {insights.reason}
                </p>
              )}
            </div>
          </div>
        )}
        {analyzeError && (
          <p className="ui-error" role="alert" data-testid="chat-ai-analyze-error">
            {analyzeError}
          </p>
        )}
        <div>
          <button type="button" className={`btn btn-sm ${insights ? 'btn-ghost' : 'btn-secondary'}`} data-testid="chat-ai-analyze" onClick={() => void runAnalyze()} disabled={analyzing}>
            <Sparkle size={16} /> {analyzing ? t('analyzing') : insights ? t('reanalyze') : t('analyze')}
          </button>
        </div>
      </section>

      {insights && (
        <section className="gr-detail-section wa-ai-proposals" data-testid="chat-ai-proposals">
          <h3 className="gr-detail-title">{t('proposalsTitle')}</h3>
          {visible.length === 0 ? (
            <p className="ui-help">{t('noProposals')}</p>
          ) : (
            <ul className="wa-ai-plist">
              {visible.map((p) => (
                <li key={p.key} className="wa-ai-proposal" data-testid="chat-ai-proposal" data-state={p.state}>
                  {p.state === 'created' && p.created ? (
                    <p className="wa-ai-done" role="status">
                      <span>{p.created.kind === 'ticket' ? t('createdTicket') : t('createdTask')}</span>{' '}
                      <Link href={p.created.href} data-testid="chat-ai-created-link">
                        {p.created.label}
                      </Link>
                    </p>
                  ) : (
                    <>
                      <input
                        className="input"
                        data-testid="chat-ai-proposal-title"
                        value={p.title}
                        maxLength={200}
                        aria-label={t('titleLabel')}
                        disabled={p.state === 'busy' || !canCreate}
                        onChange={(e) => patch(p.key, { title: e.target.value })}
                      />
                      {p.notes && (
                        <p className="ui-help" dir="auto">
                          {p.notes}
                        </p>
                      )}
                      <div className="wa-ai-prow">
                        <span className="ui-help">
                          {t('priorityLabel')}: {t(`priority.${p.priority}`)}
                        </span>
                        {kinds.length > 1 && canCreate && (
                          <select
                            className="select wa-ai-kind"
                            data-testid="chat-ai-proposal-kind"
                            value={p.kind}
                            aria-label={t('kindLabel')}
                            disabled={p.state === 'busy'}
                            onChange={(e) => patch(p.key, { kind: e.target.value as ProposalKind })}
                          >
                            {kinds.map((k) => (
                              <option key={k} value={k}>
                                {t(`kind.${k}`)}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      {p.error && (
                        <p className="ui-error" role="alert">
                          {p.error}
                        </p>
                      )}
                      <div className="wa-ai-actions">
                        {canCreate && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            data-testid="chat-ai-create"
                            disabled={p.state === 'busy' || !p.title.trim()}
                            aria-busy={p.state === 'busy' || undefined}
                            onClick={() => void approve(p)}
                          >
                            {p.state === 'busy' ? t('creating') : t('create')}
                          </button>
                        )}
                        <button type="button" className="btn btn-ghost btn-sm" data-testid="chat-ai-dismiss" disabled={p.state === 'busy'} onClick={() => patch(p.key, { state: 'dismissed' })}>
                          {t('dismiss')}
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="ui-help">{canCreate ? where : t('crmOff')}</p>
        </section>
      )}
    </div>
  );
}
